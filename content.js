// content.js
let responseStabilityTimerId = null;
let lastResponseLength = 0;
const RESPONSE_STABILITY_TIMEOUT_MS = 1500;

let _observerForStabilityCb;
let _mainTimeoutIdForStabilityCb;
let _elementForStabilityCb;

const CHATGPT_ERROR_MESSAGE_SELECTOR = 'div.text-token-text-error.border-token-surface-error\\/15';
const MAX_CONTENT_RETRIES = 1;
const RETRY_COUNTER_SESSION_KEY = 'chatGPTContentRetryCount_v2';

function cleanupObservingResources(observer, timeoutId) {
    if (observer) {
        observer.disconnect();
    }
    if (timeoutId) {
        clearTimeout(timeoutId);
    }
    resetStabilityState();
}

function handlePageErrorAndRetry(observer, mainTimeoutId) {
    const errorElement = document.querySelector(CHATGPT_ERROR_MESSAGE_SELECTOR);
    if (errorElement && errorElement.offsetParent !== null) {
        let retries = parseInt(sessionStorage.getItem(RETRY_COUNTER_SESSION_KEY) || '0');
        cleanupObservingResources(observer, mainTimeoutId);
        if (retries < MAX_CONTENT_RETRIES) {
            sessionStorage.setItem(RETRY_COUNTER_SESSION_KEY, (retries + 1).toString());
            window.location.reload();
        } else {
            sessionStorage.removeItem(RETRY_COUNTER_SESSION_KEY);
            chrome.runtime.sendMessage({ type: "CHATGPT_CONTENT_FAILED_PERMANENTLY" });
        }
        return true;
    }
    return false;
}

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
                reject(new Error(`Timeout waiting for element: ${selector}`));
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
    element.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
}

async function performTaskInPage() {
    try {
        const data = await chrome.storage.local.get(['currentFullQueryToChatGPT']);
        const fullPrompt = data.currentFullQueryToChatGPT;
        if (!fullPrompt) {
            return;
        }

        const prosemirrorDiv = await waitForElement('div.ProseMirror#prompt-textarea[contenteditable="true"]');
        await typeIntoProseMirror(prosemirrorDiv, fullPrompt);
        await new Promise(resolve => setTimeout(resolve, 200));

        const sendButton = await waitForElement('button[data-testid="send-button"]');

        const triggerResponseObservationAfterDelay = () => {
            setTimeout(() => {
                chrome.runtime.sendMessage({type: "ACTIVATE_CHATGPT_TAB_FOR_RESPONSE"}, (response) => {
                    if (chrome.runtime.lastError) {
                    }
                });
                observeResponse();
            }, 15000); // Increased delay to 15 seconds
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
            buttonObserver.observe(sendButton, {attributes: true, attributeFilter: ['disabled']});
        } else {
            prosemirrorDiv.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true
            }));
            triggerResponseObservationAfterDelay();
        }
    } catch (error) {
    }
}

function resetStabilityState() {
    if (responseStabilityTimerId) {
        clearTimeout(responseStabilityTimerId);
        responseStabilityTimerId = null;
    }
    lastResponseLength = 0;
}

function processAndSendResult(assistantMessageElement, observerToDisconnect, mainProcessingTimeoutId) {
    if (!assistantMessageElement) return false;

    let extractedText = assistantMessageElement.innerText.trim();

    const sourceKeywords = ["출처:", "출처 :", "출처", "Source: ", "Source : ", "Source "];
    for (const keyword of sourceKeywords) {
        if (extractedText.endsWith(keyword)) {
            extractedText = extractedText.substring(0, extractedText.lastIndexOf(keyword)).trim();
            break;
        }
    }

    let cleanText = extractedText;
    if ((cleanText.startsWith('"') && cleanText.endsWith('"')) || (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
        cleanText = cleanText.substring(1, cleanText.length - 1).trim();
    }

    if (!cleanText || cleanText.length < 1 || cleanText.toLowerCase().includes("test")) {
        resetStabilityState();
        return false;
    }

    const linkElement = assistantMessageElement.querySelector('span.ms-1 a[href]');
    let foundUrl = null;
    if (linkElement && linkElement.href) {
        foundUrl = linkElement.href;
    }

    cleanupObservingResources(observerToDisconnect, mainProcessingTimeoutId);
    sessionStorage.removeItem(RETRY_COUNTER_SESSION_KEY);

    chrome.runtime.sendMessage({
        type: 'SHOW_FINAL_RESPONSE',
        text: cleanText,
        url: foundUrl
    }, (response) => {
        if (chrome.runtime.lastError) {
        }
    });
    return true;
}

function checkResponseCompletionAndProcess(containerElement, observer, mainTimeoutId) {
    if (handlePageErrorAndRetry(observer, mainTimeoutId)) {
        return true;
    }

    if (!containerElement) return false;
    const turns = containerElement.querySelectorAll('article[data-testid^="conversation-turn-"]');
    if (turns.length < 2) {
        resetStabilityState();
        return false;
    }
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) {
        resetStabilityState();
        return false;
    }
    const assistantMessageContainer = lastTurn.querySelector('div[data-message-author-role="assistant"]');
    if (!assistantMessageContainer) {
        resetStabilityState();
        return false;
    }
    const assistantMessageElement = assistantMessageContainer.querySelector('.markdown.prose, .result-streaming');
    if (!assistantMessageElement) {
        resetStabilityState();
        return false;
    }

    _observerForStabilityCb = observer;
    _mainTimeoutIdForStabilityCb = mainTimeoutId;
    _elementForStabilityCb = assistantMessageElement;

    const stopGeneratingButton = lastTurn.querySelector('button[data-testid="stop-button"], button[aria-label*="스트리밍 중지"], button[aria-label*="Stop generating"], button[aria-label*="Streaming answ"]');
    if (stopGeneratingButton && stopGeneratingButton.offsetHeight > 0) {
        resetStabilityState();
        return false;
    }
    if (assistantMessageElement.classList.contains('result-thinking')) {
        resetStabilityState();
        return false;
    }
    if (assistantMessageElement.classList.contains('result-streaming') && assistantMessageElement.innerText.trim().length === 0) {
        resetStabilityState();
        return false;
    }

    const copyButton = lastTurn.querySelector('button[data-testid="copy-turn-action-button"]');
    if (copyButton && copyButton.offsetHeight > 0) {
        return processAndSendResult(assistantMessageElement, observer, mainTimeoutId);
    }

    const currentText = assistantMessageElement.innerText.trim();

    if (currentText.length > 0) {
        if (currentText.length > lastResponseLength) {
            lastResponseLength = currentText.length;
            if (responseStabilityTimerId) clearTimeout(responseStabilityTimerId);
            responseStabilityTimerId = setTimeout(() => {
                if (handlePageErrorAndRetry(_observerForStabilityCb, _mainTimeoutIdForStabilityCb)) {
                    return;
                }
                processAndSendResult(_elementForStabilityCb, _observerForStabilityCb, _mainTimeoutIdForStabilityCb);
            }, RESPONSE_STABILITY_TIMEOUT_MS);
            return false;
        } else if (currentText.length === lastResponseLength && !responseStabilityTimerId) {
            if (responseStabilityTimerId) clearTimeout(responseStabilityTimerId);
            responseStabilityTimerId = setTimeout(() => {
                if (handlePageErrorAndRetry(_observerForStabilityCb, _mainTimeoutIdForStabilityCb)) {
                    return;
                }
                processAndSendResult(_elementForStabilityCb, _observerForStabilityCb, _mainTimeoutIdForStabilityCb);
            }, RESPONSE_STABILITY_TIMEOUT_MS);
            return false;
        }
        return false;
    } else {
        resetStabilityState();
        return false;
    }
}

async function observeResponse() {
    let firstTurnArticle;
    let conversationContainer;
    let observer = null;
    let mainProcessingTimeoutId = null;
    const RESPONSE_MAX_WAIT_TIME_MS = 15000;

    const localCleanup = () => {
        cleanupObservingResources(observer, mainProcessingTimeoutId);
        observer = null;
        mainProcessingTimeoutId = null;
        _observerForStabilityCb = null;
        _mainTimeoutIdForStabilityCb = null;
        _elementForStabilityCb = null;
    };

    await new Promise(resolve => setTimeout(resolve, 100));
    if (handlePageErrorAndRetry(null, null)) {
        return;
    }

    resetStabilityState();

    try {
        firstTurnArticle = await waitForElement('article[data-testid^="conversation-turn-"]');
        if (!firstTurnArticle) {
            localCleanup();
            return;
        }
        conversationContainer = firstTurnArticle.parentElement;
        if (!conversationContainer) {
            localCleanup();
            return;
        }
    } catch (error) {
        localCleanup();
        return;
    }

    observer = new MutationObserver(() => {
        if (checkResponseCompletionAndProcess(conversationContainer, observer, mainProcessingTimeoutId)) {
            observer = null;
            mainProcessingTimeoutId = null;
        }
    });

    try {
        observer.observe(conversationContainer, {childList: true, subtree: true, characterData: true});
        mainProcessingTimeoutId = setTimeout(() => {
            let handledInTimeout = false;
            if (observer && conversationContainer) {
                if (handlePageErrorAndRetry(observer, mainProcessingTimeoutId)) {
                    handledInTimeout = true;
                    observer = null; mainProcessingTimeoutId = null;
                } else if (checkResponseCompletionAndProcess(conversationContainer, observer, mainProcessingTimeoutId)) {
                    handledInTimeout = true;
                    observer = null; mainProcessingTimeoutId = null;
                }
            }
            if (!handledInTimeout) {
                localCleanup();
            }
        }, RESPONSE_MAX_WAIT_TIME_MS);
    } catch (error) {
        localCleanup();
    }
}

(async () => {
    try {
        const data = await chrome.storage.local.get("chatGptQueryPending");
        if (data.chatGptQueryPending) {
            sessionStorage.removeItem(RETRY_COUNTER_SESSION_KEY);
            await chrome.storage.local.remove("chatGptQueryPending");
            await performTaskInPage();
        }
    } catch (e) {
    }
})();