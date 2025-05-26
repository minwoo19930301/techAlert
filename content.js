async function waitForElement(selector, timeout = 20000) {
    return new Promise((resolve, reject) => {
        const intervalTime = 100;
        let elapsedTime = 0;
        const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(interval);
                resolve(element);
            }
            elapsedTime += intervalTime;
            if (elapsedTime >= timeout) {
                clearInterval(interval);
                reject(new Error(`Timeout: ${selector}`));
            }
        }, intervalTime);
    });
}

async function typeIntoProseMirror(element, text) {
    element.focus();
    let pTag = element.querySelector('p');
    if (!pTag) {
        pTag = document.createElement('p');
        element.appendChild(pTag);
    }
    pTag.textContent = text;
    if (pTag.classList.contains('placeholder')) {
        pTag.classList.remove('placeholder');
    }
    const trailingBreak = pTag.querySelector('br.ProseMirror-trailingBreak');
    if (text && trailingBreak) {
        trailingBreak.remove();
    } else if (!text && !trailingBreak) {
        const newBr = document.createElement('br');
        newBr.className = 'ProseMirror-trailingBreak';
        pTag.appendChild(newBr);
    }
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

async function performInitialChatActions() {
    try {
        const prosemirrorDiv = await waitForElement('div.ProseMirror#prompt-textarea[contenteditable="true"]');
        const newPrompt = "오늘 서울 날씨는 뭐야? 15자 내외로 대답해줘";
        await typeIntoProseMirror(prosemirrorDiv, newPrompt);
        await new Promise(resolve => setTimeout(resolve, 200));
        const sendButton = await waitForElement('button[data-testid="send-button"]', 5000);

        const triggerResponseObservationAfterDelay = () => {
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: "ACTIVATE_CHATGPT_TAB_FOR_RESPONSE" });
                observeResponse();
            }, 5000);
        };

        if (sendButton && !sendButton.disabled) {
            sendButton.click();
            triggerResponseObservationAfterDelay();
        } else if (sendButton && sendButton.disabled) {
            const buttonObserver = new MutationObserver((mutationsList, observer) => {
                if (!sendButton.disabled) {
                    observer.disconnect();
                    sendButton.click();
                    triggerResponseObservationAfterDelay();
                }
            });
            buttonObserver.observe(sendButton, { attributes: true, attributeFilter: ['disabled'] });
        } else {
            prosemirrorDiv.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true
            }));
            triggerResponseObservationAfterDelay();
        }
    } catch (error) {
        // console.error("Error in performInitialChatActions:", error);
    }
}

function processAndSendSummary(rawText, observerToDisconnect, timeoutIdToClear) {
    let finalSummary = rawText.trim();
    if ((finalSummary.startsWith('"') && finalSummary.endsWith('"')) || (finalSummary.startsWith("'") && finalSummary.endsWith("'"))) {
        finalSummary = finalSummary.substring(1, finalSummary.length - 1).trim();
    }
    if (finalSummary && finalSummary.length > 1 && !finalSummary.toLowerCase().includes("test")) {
        if (observerToDisconnect) observerToDisconnect.disconnect();
        if (timeoutIdToClear) clearTimeout(timeoutIdToClear);
        chrome.runtime.sendMessage({ type: 'showNotification', message: finalSummary });
        return true;
    }
    return false;
}

let lastCheckedText = "";
let textStableConsecutiveChecks = 0;
const TEXT_STABLE_CHECKS_NEEDED = 2;
const MIN_VALID_LENGTH_FOR_STABILITY_CHECK = 2;

function checkResponseCompletionAndProcess(containerElement, observerToDisconnect, timeoutIdToClear) {
    if (!containerElement) return false;
    const turns = containerElement.querySelectorAll('article[data-testid^="conversation-turn-"]');
    if (turns.length < 2) return false;
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return false;
    const assistantMessageContainer = lastTurn.querySelector('div[data-message-author-role="assistant"]');
    if (!assistantMessageContainer) return false;
    const assistantMessageElement = assistantMessageContainer.querySelector('.markdown.prose, .result-streaming');
    if (!assistantMessageElement) return false;

    const stopGeneratingButton = lastTurn.querySelector('button[data-testid="stop-button"], button[aria-label*="스트리밍 중지"], button[aria-label*="Stop generating"]');
    if (stopGeneratingButton && stopGeneratingButton.offsetHeight > 0) {
        lastCheckedText = "";
        textStableConsecutiveChecks = 0;
        return false;
    }
    if (assistantMessageElement.classList.contains('result-thinking')) {
        lastCheckedText = "";
        textStableConsecutiveChecks = 0;
        return false;
    }
    if (assistantMessageElement.classList.contains('result-streaming')) {
        lastCheckedText = "";
        textStableConsecutiveChecks = 0;
        return false;
    }

    const copyButton = lastTurn.querySelector('button[data-testid="copy-turn-action-button"]');
    if (copyButton && copyButton.offsetHeight > 0) {
        const currentText = assistantMessageElement.innerText.trim();
        return processAndSendSummary(currentText, observerToDisconnect, timeoutIdToClear);
    }

    // Fallback to text stability if copy button isn't the only completion signal or appears late
    const currentText = assistantMessageElement.innerText.trim();
    if (currentText.length < MIN_VALID_LENGTH_FOR_STABILITY_CHECK) {
        lastCheckedText = "";
        textStableConsecutiveChecks = 0;
        return false;
    }
    if (currentText === lastCheckedText) {
        textStableConsecutiveChecks++;
    } else {
        lastCheckedText = currentText;
        textStableConsecutiveChecks = 1;
        return false;
    }
    if (textStableConsecutiveChecks >= TEXT_STABLE_CHECKS_NEEDED) {
        lastCheckedText = "";
        textStableConsecutiveChecks = 0;
        return processAndSendSummary(currentText, observerToDisconnect, timeoutIdToClear);
    }
    return false;
}

async function observeResponse() {
    let firstTurnArticle;
    let conversationContainer;
    let observer = null;
    let processingTimeoutId = null;
    const RESPONSE_MAX_WAIT_TIME_MS = 1000;

    lastCheckedText = "";
    textStableConsecutiveChecks = 0;

    const cleanupObserver = () => {
        if (observer) observer.disconnect();
        if (processingTimeoutId) clearTimeout(processingTimeoutId);
        observer = null;
        processingTimeoutId = null;
    };

    try {
        firstTurnArticle = await waitForElement('article[data-testid^="conversation-turn-"]');
        if (!firstTurnArticle) { cleanupObserver(); return; }
        conversationContainer = firstTurnArticle.parentElement;
        if (!conversationContainer) { cleanupObserver(); return; }
    } catch (error) {
        cleanupObserver();
        return;
    }

    observer = new MutationObserver(() => {
        if (checkResponseCompletionAndProcess(conversationContainer, observer, processingTimeoutId)) {
            observer = null;
            processingTimeoutId = null;
        }
    });

    try {
        observer.observe(conversationContainer, { childList: true, subtree: true, characterData: true });
        processingTimeoutId = setTimeout(() => {
            if (!checkResponseCompletionAndProcess(conversationContainer, observer, processingTimeoutId)) {
                // Final check failed
            }
            cleanupObserver();
        }, RESPONSE_MAX_WAIT_TIME_MS);
    } catch (error) {
        cleanupObserver();
    }
}

(async () => {
    const storage = await chrome.storage.local.get("chatGptInitialActionPending");
    if (storage.chatGptInitialActionPending) {
        await performInitialChatActions();
        await chrome.storage.local.remove("chatGptInitialActionPending");
    }
})();