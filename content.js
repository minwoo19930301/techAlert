// content.js (전체 코드)

async function waitForElement(selector, timeout = 45000) {
    console.log(`[CS] waitForElement: Attempting to find selector "${selector}" with timeout ${timeout}ms`);
    return new Promise((resolve, reject) => {
        const intervalTime = 100;
        let elapsedTime = 0;
        const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                console.log(`[CS] waitForElement: Found selector "${selector}"`);
                clearInterval(interval);
                resolve(element);
            }
            elapsedTime += intervalTime;
            if (elapsedTime >= timeout) {
                clearInterval(interval);
                const errorMsg = `[CS] waitForElement: Timeout waiting for element: ${selector} after ${timeout}ms`;
                console.error(errorMsg);
                reject(new Error(errorMsg));
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
    console.log("[CS] performInitialChatActions: Starting initial chat actions.");
    try {
        const keysBeforeClear = Object.keys(localStorage);
        console.log(`[CS] performInitialChatActions: localStorage keys BEFORE clear for https://chatgpt.com: ${keysBeforeClear.length} keys.`, keysBeforeClear);
        localStorage.clear();
        const keysAfterClear = Object.keys(localStorage);
        console.log(`[CS] performInitialChatActions: localStorage for https://chatgpt.com CLEARED. Keys remaining immediately after clear: ${keysAfterClear.length} keys.`, keysAfterClear);

        setTimeout(() => {
            const keysAfterTimeout = Object.keys(localStorage);
            console.log(`[CS] performInitialChatActions: localStorage keys ~500ms AFTER clear: ${keysAfterTimeout.length} keys.`, keysAfterTimeout);
        }, 500);

        const prosemirrorDiv = await waitForElement('div.ProseMirror#prompt-textarea[contenteditable="true"]');
        console.log("[CS] performInitialChatActions: ProseMirror input div found:", prosemirrorDiv);

        await typeIntoProseMirror(prosemirrorDiv, "안녕");
        console.log("[CS] performInitialChatActions: Typed '안녕' into ProseMirror div.");

        await new Promise(resolve => setTimeout(resolve, 200));

        const sendButton = await waitForElement('button[data-testid="send-button"]', 5000);
        console.log("[CS] performInitialChatActions: Send button found:", sendButton, "Disabled:", sendButton.disabled);

        if (sendButton && !sendButton.disabled) {
            sendButton.click();
            console.log("[CS] performInitialChatActions: Send button clicked.");
            observeResponse();
        } else if (sendButton && sendButton.disabled) {
            console.warn("[CS] performInitialChatActions: Send button is initially disabled. Observing for enablement.");
            const buttonObserver = new MutationObserver((mutationsList, observer) => {
                if (!sendButton.disabled) {
                    observer.disconnect();
                    console.log("[CS] performInitialChatActions: Send button became enabled.");
                    sendButton.click();
                    console.log("[CS] performInitialChatActions: Send button clicked after becoming enabled.");
                    observeResponse();
                }
            });
            buttonObserver.observe(sendButton, { attributes: true, attributeFilter: ['disabled'] });
        } else {
            console.error("[CS] performInitialChatActions: Send button not found or not interactable. Trying to simulate Enter on input.");
            prosemirrorDiv.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true
            }));
            console.log("[CS] performInitialChatActions: Simulated Enter key press on ProseMirror div.");
            observeResponse();
        }
    } catch (error) {
        console.error("[CS] performInitialChatActions: Error in initial actions:", error);
    }
}

async function observeResponse() {
    console.log("[CS] observeResponse: Function called.");
    let firstTurnArticle;
    let conversationContainer;

    try {
        console.log("[CS] observeResponse: Waiting for the first conversation turn 'article[data-testid^=\"conversation-turn-\"]' to appear.");
        firstTurnArticle = await waitForElement('article[data-testid^="conversation-turn-"]', 45000);

        if (!firstTurnArticle) {
            console.error("[CS] observeResponse: waitForElement resolved, but firstTurnArticle is falsy. Cannot determine container.");
            return;
        }
        console.log("[CS] observeResponse: First conversation turn article found:", firstTurnArticle);

        conversationContainer = firstTurnArticle.parentElement;
        if (!conversationContainer) {
            console.error("[CS] observeResponse: Parent element of the first turn article is null. Cannot observe.");
            return;
        }
        console.log("[CS] observeResponse: Selected observation target (parentElement of first article):", conversationContainer);

    } catch (error) {
        console.error("[CS] observeResponse: Error during waitForElement for the first article or getting its parent:", error);
        return;
    }

    const observer = new MutationObserver((mutationsList, obs) => {
        // ★★★ MutationObserver 콜백 시작 로그 추가 ★★★
        console.log(`[CS] observeResponse (MutationObserver): Callback fired! Number of mutations: ${mutationsList.length}`);
        let newAssistantMessageProcessedThisCallback = false;

        for (const mutation of mutationsList) {
            if (newAssistantMessageProcessedThisCallback) break;

            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                console.log(`[CS] observeResponse (MutationObserver): childList mutation with ${mutation.addedNodes.length} added node(s).`);

                mutation.addedNodes.forEach(addedNode => {
                    if (newAssistantMessageProcessedThisCallback) return;

                    let targetArticleElement = null;
                    if (addedNode.nodeType === Node.ELEMENT_NODE) {
                        // 추가된 노드 자체가 article인지, 또는 그 내부에 article이 있는지 확인 (subtree:true 때문)
                        if (addedNode.matches('article[data-testid^="conversation-turn-"]')) {
                            targetArticleElement = addedNode;
                            // console.log("[CS] observeResponse (MutationObserver): Added node IS an 'article[data-testid^=\"conversation-turn-\"]'.");
                        } else {
                            targetArticleElement = addedNode.querySelector('article[data-testid^="conversation-turn-"]');
                            // if (targetArticleElement) {
                            //   console.log("[CS] observeResponse (MutationObserver): Found 'article[data-testid^=\"conversation-turn-\"]' as a descendant of added node.");
                            // }
                        }
                    }

                    if (targetArticleElement) {
                        console.log("[CS] observeResponse (MutationObserver): Processing target article:", targetArticleElement);
                        const assistantMessageBlock = targetArticleElement.querySelector('div[data-message-author-role="assistant"]');

                        if (assistantMessageBlock) {
                            console.log("[CS] observeResponse (MutationObserver): Found assistant message block in target article:", assistantMessageBlock);

                            const markdownContent = assistantMessageBlock.querySelector('.markdown.prose');
                            if (markdownContent) {
                                console.log("[CS] observeResponse (MutationObserver): Found markdown.prose element:", markdownContent);
                                let responseText = "";
                                const paragraphs = markdownContent.querySelectorAll('p');

                                if (paragraphs.length > 0) {
                                    console.log(`[CS] observeResponse (MutationObserver): Found ${paragraphs.length} p tag(s).`);
                                    paragraphs.forEach(p => {
                                        responseText += p.innerText.trim() + "\n";
                                    });
                                    responseText = responseText.trim();
                                } else {
                                    console.warn("[CS] observeResponse (MutationObserver): No <p> tags found in .markdown.prose. Trying innerText of .markdown.prose itself.");
                                    responseText = markdownContent.innerText.trim();
                                }
                                console.log("[CS] observeResponse (MutationObserver): Extracted responseText: \"" + responseText + "\"");

                                if (responseText) {
                                    console.log("[CS] observeResponse (MutationObserver): Final responseText to send: \"" + responseText + "\"");
                                    chrome.runtime.sendMessage({ type: "showNotification", message: responseText }, (responseFromBg) => {
                                        if (chrome.runtime.lastError) {
                                            console.error("[CS] observeResponse (MutationObserver): Error sending message to background:", chrome.runtime.lastError.message);
                                        } else {
                                            console.log("[CS] observeResponse (MutationObserver): Message sent to background successfully. Response from background:", responseFromBg);
                                        }
                                    });
                                    newAssistantMessageProcessedThisCallback = true;
                                    obs.disconnect();
                                    console.log("[CS] observeResponse (MutationObserver): Observer disconnected.");
                                    return;
                                } else {
                                    console.warn("[CS] observeResponse (MutationObserver): Extracted responseText is empty.");
                                }
                            } else {
                                console.warn("[CS] observeResponse (MutationObserver): '.markdown.prose' not found in assistant message block.");
                            }
                        }
                    }
                });
            }
        }
    });

    try {
        // ★★★ subtree 옵션을 true로 변경 ★★★
        observer.observe(conversationContainer, { childList: true, subtree: true });
        console.log("[CS] observeResponse: MutationObserver started successfully on:", conversationContainer, "with subtree: true");
    } catch (error) {
        console.error("[CS] observeResponse: Error starting MutationObserver:", error, "on element:", conversationContainer);
    }
}

// --- Main Execution ---
(async () => {
    console.log("[CS] ChatGPT Auto Hello content script loaded.");
    const storage = await chrome.storage.local.get("chatGptInitialActionPending");
    if (storage.chatGptInitialActionPending) {
        console.log("[CS] 'chatGptInitialActionPending' flag is true. Proceeding with actions.");
        await performInitialChatActions();
        await chrome.storage.local.remove("chatGptInitialActionPending");
        console.log("[CS] 'chatGptInitialActionPending' flag removed.");
    } else {
        console.log("[CS] 'chatGptInitialActionPending' flag not found or false. No initial actions taken by content script.");
    }
})();