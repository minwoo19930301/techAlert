let previousActiveTabId = null;
const CHATGPT_QUERY_ALARM_NAME_PREFIX = "queryAlarm_";
// ★★★ 변경된 고정 접두사 ★★★
const FIXED_PROMPT_PREFIX = "response this question in Korean and within 20 letters and one sentence. Search if necessary";

async function executeSingleChatGPTTask(task) {
    if (!task || !task.query || task.query.trim() === "") {
        return;
    }

    try {
        const { managedChatGPTQueryTabId } = await chrome.storage.local.get('managedChatGPTQueryTabId');
        if (managedChatGPTQueryTabId) {
            try { await chrome.tabs.remove(managedChatGPTQueryTabId); } catch (e) { /* ignore */ }
        }

        const fullPromptForChatGPT = FIXED_PROMPT_PREFIX + " " + task.query;

        await chrome.storage.local.set({
            chatGptQueryPending: true,
            currentFullQueryToChatGPT: fullPromptForChatGPT,
            currentProcessingTaskId: task.id
        });

        chrome.tabs.create({ url: "https://chatgpt.com/", active: false }, (newTab) => {
            if (chrome.runtime.lastError || !newTab || !newTab.id) return;
            chrome.storage.local.set({ managedChatGPTQueryTabId: newTab.id });
        });

    } catch (e) { /* Fail silently */ }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        scheduledQueries: [],
        latestQueryResponseUrl: null,
        latestQueryResponseText: "정보 없음"
    });
    chrome.alarms.getAll(alarms => {
        alarms.forEach(alarm => {
            if (alarm.name.startsWith(CHATGPT_QUERY_ALARM_NAME_PREFIX)) {
                chrome.alarms.clear(alarm.name);
            }
        });
    });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith(CHATGPT_QUERY_ALARM_NAME_PREFIX)) {
        const taskId = alarm.name.substring(CHATGPT_QUERY_ALARM_NAME_PREFIX.length);
        const result = await chrome.storage.local.get({scheduledQueries: []});
        const taskToRun = result.scheduledQueries.find(task => task.id === taskId);
        if (taskToRun) {
            executeSingleChatGPTTask(taskToRun);
        } else {
            chrome.alarms.clear(alarm.name);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "EXECUTE_AND_SCHEDULE_TASK") {
        const task = request.task;
        executeSingleChatGPTTask(task);

        const alarmName = `${CHATGPT_QUERY_ALARM_NAME_PREFIX}${task.id}`;
        chrome.alarms.clear(alarmName, () => {
            if (task.interval && task.interval > 0) {
                chrome.alarms.create(alarmName, {
                    delayInMinutes: task.interval,
                    periodInMinutes: task.interval
                });
                sendResponse({ status: "task_scheduled_and_running" });
            } else {
                sendResponse({ status: "task_started_no_schedule" });
            }
        });
        return true;
    } else if (request.type === "CANCEL_SCHEDULED_TASK") {
        const alarmName = `${CHATGPT_QUERY_ALARM_NAME_PREFIX}${request.taskId}`;
        chrome.alarms.clear(alarmName, (wasCleared) => {
            sendResponse({ status: wasCleared ? "schedule_cancelled" : "alarm_not_found" });
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
            title: "ChatGPT 응답",
            message: request.message,
            priority: 2,
            requireInteraction: true
        };
        if (isLinkType) {
            notificationOptions.buttons = [{ title: '링크 열기' }];
        }

        chrome.storage.local.set({
            latestQueryResponseUrl: isLinkType ? request.url : null,
            isLinkNotification: isLinkType
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
        const data = await chrome.storage.local.get(['latestQueryResponseUrl', 'isLinkNotification']);
        if (data.isLinkNotification && data.latestQueryResponseUrl) {
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