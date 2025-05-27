// content.js (전체 코드)

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

async function performTaskInPage() {
    try {
        const data = await chrome.storage.local.get(['currentFullQueryToChatGPT']);
        const fullPrompt = data.currentFullQueryToChatGPT;
        const fixedPrefixForCheck = "response this question in Korean and within 20 letters and one sentence. Search if necessary";

        if (!fullPrompt || fullPrompt.trim() === fixedPrefixForCheck.trim()) {
            return;
        }

        const prosemirrorDiv = await waitForElement('div.ProseMirror#prompt-textarea[contenteditable="true"]');
        await typeIntoProseMirror(prosemirrorDiv, fullPrompt);
        await new Promise(resolve => setTimeout(resolve, 200));
        const sendButton = await waitForElement('button[data-testid="send-button"]', 5000);

        const triggerResponseObservationAfterDelay = () => {
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: "ACTIVATE_CHATGPT_TAB_FOR_RESPONSE" });
                observeResponse();
            }, 10000); // ★★★ 포커싱 전 10초 딜레이 ★★★
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
    } catch (error) { /* Fail silently */ }
}

function processAndSendResult(assistantMessageElement, observerToDisconnect, timeoutIdToClear) {
    if (!assistantMessageElement) return false;

    let extractedText = assistantMessageElement.innerText.trim();

    // ★★★ "출처" 단어 및 그 앞의 공백, 콜론 등 제거 로직 ★★★
    const 출처Keywords = ["출처:", "출처 :", "출처"];
    for (const keyword of 출처Keywords) {
        if (extractedText.endsWith(keyword)) {
            extractedText = extractedText.substring(0, extractedText.lastIndexOf(keyword)).trim();
            break;
        }
    }
    // 추가적으로 끝에 붙은 단순 "출처" 단어만 제거
    if (extractedText.endsWith("출처")) {
        extractedText = extractedText.substring(0, extractedText.length - 2).trim();
    }


    let cleanText = extractedText;
    if ((cleanText.startsWith('"') && cleanText.endsWith('"')) || (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
        cleanText = cleanText.substring(1, cleanText.length - 1).trim();
    }

    if (!cleanText || cleanText.length < 1 ) { // "test" 필터는 일단 유지, 길이는 1글자도 허용
        return false;
    }
    if (cleanText.toLowerCase().includes("test")){
        return false;
    }


    const linkElement = assistantMessageElement.querySelector('span.ms-1 a[href]');

    if (observerToDisconnect) observerToDisconnect.disconnect();
    if (timeoutIdToClear) clearTimeout(timeoutIdToClear);

    if (linkElement && linkElement.href) {
        const href = linkElement.href;
        chrome.runtime.sendMessage({
            type: 'SHOW_LINK_NOTIFICATION',
            url: href,
            message: cleanText,
            title: "ChatGPT 응답"
        });
    } else {
        chrome.runtime.sendMessage({
            type: 'SHOW_TEXT_NOTIFICATION',
            message: cleanText,
            title: "ChatGPT 응답"
        });
    }
    return true;
}

let lastCheckedText = "";
let textStableConsecutiveChecks = 0;
const TEXT_STABLE_CHECKS_NEEDED = 2;
const MIN_VALID_LENGTH_FOR_STABILITY_CHECK = 1;

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
        return processAndSendResult(assistantMessageElement, observerToDisconnect, timeoutIdToClear);
    }

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
        return processAndSendResult(assistantMessageElement, observerToDisconnect, timeoutIdToClear);
    }
    return false;
}

async function observeResponse() {
    let firstTurnArticle;
    let conversationContainer;
    let observer = null;
    let processingTimeoutId = null;
    // ★★★ 포커스 후 응답 대기 시간 1.5초로 변경 ★★★
    const RESPONSE_MAX_WAIT_TIME_MS = 1500;

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
    const data = await chrome.storage.local.get("chatGptQueryPending");
    if (data.chatGptQueryPending) {
        await chrome.storage.local.remove("chatGptQueryPending");
        await performTaskInPage();
    }
})();