let previousActiveTabId = null;
const CHATGPT_QUERY_ALARM_NAME = "chatGPTQueryRepeatingAlarm";
// ★★★ 고정 접미사 내용 변경 ★★★
const FIXED_PROMPT_SUFFIX = " response this question in Korean and within 20 letters";

async function executeChatGPTQueryTask() {
    try {
        const settings = await chrome.storage.local.get(['managedChatGPTQueryTabId', 'userMainQuery']);

        if (settings.managedChatGPTQueryTabId) {
            try {
                await chrome.tabs.remove(settings.managedChatGPTQueryTabId);
            } catch (e) { /* Do nothing if tab already closed */ }
        }

        const userMainQuery = settings.userMainQuery;
        if (!userMainQuery || userMainQuery.trim() === "") {
            return;
        }
        const fullPromptForChatGPT = userMainQuery + FIXED_PROMPT_SUFFIX;

        await chrome.storage.local.set({
            chatGptQueryPending: true,
            currentFullQueryToChatGPT: fullPromptForChatGPT
        });

        chrome.tabs.create({ url: "https://chatgpt.com/", active: false }, (newTab) => {
            if (chrome.runtime.lastError || !newTab || !newTab.id) return;
            chrome.storage.local.set({ managedChatGPTQueryTabId: newTab.id });
        });
    } catch (e) { /* Fail silently */ }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        userMainQuery: "",
        queryScheduleIntervalMinutes: 0,
        latestQueryResponseUrl: null,
        latestQueryResponseText: "정보 없음"
    });
    chrome.alarms.clear(CHATGPT_QUERY_ALARM_NAME);
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHATGPT_QUERY_ALARM_NAME) {
        executeChatGPTQueryTask();
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "START_CHATGPT_QUERY_TASK") {
        executeChatGPTQueryTask();
        chrome.alarms.clear(CHATGPT_QUERY_ALARM_NAME, () => {
            if (request.scheduleIntervalMinutes && request.scheduleIntervalMinutes > 0) {
                chrome.alarms.create(CHATGPT_QUERY_ALARM_NAME, {
                    delayInMinutes: request.scheduleIntervalMinutes,
                    periodInMinutes: request.scheduleIntervalMinutes
                });
                sendResponse({ status: "task_scheduled_and_running" });
            } else {
                sendResponse({ status: "task_started_no_schedule" });
            }
        });
        return true;
    } else if (request.type === "ACTIVATE_CHATGPT_TAB_FOR_RESPONSE") {
        (async () => {
            const data = await chrome.storage.local.get('managedChatGPTQueryTabId');
            const tabIdToFocus = data.managedChatGPTQueryTabId;
            if (tabIdToFocus) {
                try {
                    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (activeTabs.length > 0 && activeTabs[0].id !== tabIdToFocus) {
                        previousActiveTabId = activeTabs[0].id;
                    } else {
                        previousActiveTabId = null;
                    }
                    await chrome.tabs.update(tabIdToFocus, { active: true });
                    const tabDetails = await chrome.tabs.get(tabIdToFocus);
                    if (tabDetails) await chrome.windows.update(tabDetails.windowId, { focused: true });
                    sendResponse({ status: "focus_attempted_successfully" });
                } catch (e) { sendResponse({ status: "error_during_focus_op" }); }
            } else { sendResponse({ status: "no_tab_id_to_focus" }); }
        })();
        return true;
    } else if (request.type === "SHOW_TEXT_NOTIFICATION" || request.type === "SHOW_LINK_NOTIFICATION") {
        const isLinkType = request.type === "SHOW_LINK_NOTIFICATION" && request.url;
        const notificationOptions = {
            type: 'basic',
            iconUrl: chrome.runtime.getURL("images/icon48.png"),
            title: request.title || (isLinkType ? 'ChatGPT 링크 발견' : 'ChatGPT 응답'),
            message: isLinkType ? (request.linkText || "링크를 클릭하여 확인하세요.") : request.message,
            priority: 2,
            requireInteraction: true
        };
        if (isLinkType) {
            notificationOptions.buttons = [{ title: '링크 열기' }];
        }

        chrome.storage.local.set({
            latestQueryResponseUrl: isLinkType ? request.url : null,
            latestQueryResponseText: isLinkType ? request.linkText : request.message,
        });

        chrome.notifications.create('chatGPTQueryNotification-' + Date.now(), notificationOptions, () => {});

        if (previousActiveTabId) {
            chrome.tabs.get(previousActiveTabId, (prevTabDetails) => {
                if (prevTabDetails) chrome.tabs.update(previousActiveTabId, { active: true });
                previousActiveTabId = null;
            });
        }
        sendResponse({status: "notification_processed"});
        return true;
    }
    return false;
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (notificationId.startsWith('chatGPTQueryNotification-') && buttonIndex === 0) {
        const data = await chrome.storage.local.get('latestQueryResponseUrl');
        if (data.latestQueryResponseUrl) {
            chrome.tabs.create({ url: data.latestQueryResponseUrl });
        }
    }
    chrome.notifications.clear(notificationId);
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (notificationId.startsWith('chatGPTQueryNotification-')) {
        const data = await chrome.storage.local.get('latestQueryResponseUrl');
        if (data.latestQueryResponseUrl) {
            chrome.tabs.create({ url: data.latestQueryResponseUrl });
        }
    }
    chrome.notifications.clear(notificationId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get('managedChatGPTQueryTabId');
    if (data.managedChatGPTQueryTabId && tabId === data.managedChatGPTQueryTabId) {
        await chrome.storage.local.remove('managedChatGPTQueryTabId');
        if (previousActiveTabId === tabId) previousActiveTabId = null;
    }
});