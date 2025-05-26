let previousActiveTabId = null;

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ "chatGptInitialActionPending": true });
    chrome.tabs.create({ url: "https://chatgpt.com/", active: false }, (newTab) => {
        if (newTab && newTab.id) {
            chrome.storage.local.set({ managedChatGPTTabId: newTab.id });
        }
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ACTIVATE_CHATGPT_TAB_FOR_RESPONSE") {
        (async () => {
            const data = await chrome.storage.local.get('managedChatGPTTabId');
            const tabIdToFocus = data.managedChatGPTTabId;
            if (tabIdToFocus) {
                try {
                    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (activeTabs.length > 0 && activeTabs[0].id !== tabIdToFocus) {
                        previousActiveTabId = activeTabs[0].id;
                    } else {
                        previousActiveTabId = null;
                    }
                    chrome.tabs.get(tabIdToFocus, async (tabDetails) => {
                        if (chrome.runtime.lastError || !tabDetails) {
                            await chrome.storage.local.remove('managedChatGPTTabId');
                            sendResponse({ status: "error_activating_tab" });
                            return;
                        }
                        if (tabDetails) {
                            await chrome.tabs.update(tabIdToFocus, { active: true });
                            await chrome.windows.update(tabDetails.windowId, { focused: true });
                            sendResponse({ status: "focus_attempted_successfully" });
                        }
                    });
                } catch (e) {
                    sendResponse({ status: "error_during_focus_op" });
                }
            } else {
                sendResponse({ status: "no_tab_id_to_focus" });
            }
        })();
        return true;
    } else if (request.type === "showNotification") {
        chrome.notifications.create('', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL("images/icon48.png"),
            title: 'ChatGPT 응답',
            message: request.message,
            priority: 2,
            requireInteraction: true
        }, (notificationId) => {
            if (chrome.runtime.lastError) {
                // console.error("Error creating notification:", chrome.runtime.lastError.message);
            }
        });

        if (previousActiveTabId) {
            chrome.tabs.get(previousActiveTabId, (prevTabDetails) => {
                if (prevTabDetails) {
                    chrome.tabs.update(previousActiveTabId, { active: true }, () => {
                        previousActiveTabId = null;
                    });
                } else {
                    previousActiveTabId = null;
                }
            });
        }
        sendResponse({status: "notification_processed"});
        return true;
    }
    return false;
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const data = await chrome.storage.local.get('managedChatGPTTabId');
    if (data.managedChatGPTTabId && tabId === data.managedChatGPTTabId) {
        await chrome.storage.local.remove('managedChatGPTTabId');
        if (previousActiveTabId === tabId) {
            previousActiveTabId = null;
        }
    }
});