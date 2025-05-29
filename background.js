// background.js
let previousActiveTabId = null;
const CHATGPT_QUERY_ALARM_NAME_PREFIX = "queryAlarm_";

async function executeSingleChatGPTTask(task) {
    if (!task || !task.query || task.query.trim() === "") {
        return;
    }

    try {
        const { managedChatGPTQueryTabId } = await chrome.storage.local.get('managedChatGPTQueryTabId');
        if (managedChatGPTQueryTabId) {
            try { await chrome.tabs.remove(managedChatGPTQueryTabId); } catch (e) {}
        }

        const userMainQuery = task.query;
        const today = new Date();
        const dynamicDatePart = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(today);
        const instructionPart = "Response this question by the language in the user's query and within 20 letters and one sentence. " +
            "Always search necessary and return only one reference link (pick in official - news - blog order) in the end of the response: ";
        const fullPromptForChatGPT = `Today is ${dynamicDatePart}. ${instructionPart}${userMainQuery}`;

        await chrome.storage.local.set({
            chatGptQueryPending: true,
            currentFullQueryToChatGPT: fullPromptForChatGPT,
            currentProcessingTaskId: task.id,
            currentOriginalQuery: task.query
        });

        chrome.tabs.create({ url: "https://chatgpt.com/", active: false }, (newTab) => {
            if (chrome.runtime.lastError || !newTab || !newTab.id) {
                chrome.storage.local.remove(['chatGptQueryPending', 'currentFullQueryToChatGPT', 'currentProcessingTaskId', 'currentOriginalQuery']);
                return;
            }
            chrome.storage.local.set({ managedChatGPTQueryTabId: newTab.id, chatgptTabProgrammaticallyFocused: false });
        });

    } catch (e) {
        chrome.storage.local.remove(['chatGptQueryPending', 'currentFullQueryToChatGPT', 'currentProcessingTaskId', 'currentOriginalQuery']);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        scheduledQueries: [],
        latestQueryResponseUrl: null,
        latestQueryResponseText: "No information yet."
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
                    await chrome.storage.local.set({ chatgptTabProgrammaticallyFocused: tabIdToFocus });
                    sendResponse({ status: "focus_attempted_successfully" });
                } catch (e) { sendResponse({ status: "error_during_focus_op" }); }
            } else { sendResponse({ status: "no_tab_id_to_focus" }); }
        })();
        return true;
    } else if (request.type === "SHOW_FINAL_RESPONSE") {
        chrome.storage.local.remove(['chatGptQueryPending', 'currentFullQueryToChatGPT', 'currentProcessingTaskId', 'currentOriginalQuery']);

        const notificationOptions = {
            type: 'basic',
            iconUrl: chrome.runtime.getURL("images/icon48.png"),
            title: "ChatGPT Response",
            message: request.text,
            priority: 2,
            requireInteraction: true
        };

        chrome.storage.local.set({ latestQueryResponseUrl: request.url || null });

        chrome.notifications.create('chatGPTQueryNotification-' + Date.now(), notificationOptions, () => {});

        (async () => {
            const data = await chrome.storage.local.get(['managedChatGPTQueryTabId', 'chatgptTabProgrammaticallyFocused']);
            const tabIdThatResponded = data.managedChatGPTQueryTabId;
            const programmaticallyFocusedTabId = data.chatgptTabProgrammaticallyFocused;

            if (previousActiveTabId) {
                try {
                    const prevTabDetails = await chrome.tabs.get(previousActiveTabId);
                    if (prevTabDetails) await chrome.tabs.update(previousActiveTabId, { active: true });
                } catch(e) { }
                previousActiveTabId = null;
            }

            if (tabIdThatResponded && tabIdThatResponded === programmaticallyFocusedTabId) {
                setTimeout(async () => {
                    try {
                        await chrome.tabs.get(tabIdThatResponded);
                        await chrome.tabs.remove(tabIdThatResponded);
                        const currentData = await chrome.storage.local.get('managedChatGPTQueryTabId');
                        if (currentData.managedChatGPTQueryTabId === tabIdThatResponded) {
                            await chrome.storage.local.remove('managedChatGPTQueryTabId');
                        }
                    } catch (e) { }
                    await chrome.storage.local.remove('chatgptTabProgrammaticallyFocused');
                }, 5000);
            } else {
                await chrome.storage.local.remove('chatgptTabProgrammaticallyFocused');
            }
        })();
        sendResponse({status: "notification_processed"});
        return true;
    } else if (request.type === "CHATGPT_CONTENT_FAILED_PERMANENTLY") {
        (async () => {
            const { managedChatGPTQueryTabId, currentOriginalQuery } = await chrome.storage.local.get(['managedChatGPTQueryTabId', 'currentOriginalQuery']);
            if (managedChatGPTQueryTabId) {
                try { await chrome.tabs.remove(managedChatGPTQueryTabId); } catch(e) { }
            }
            await chrome.storage.local.remove([
                'chatGptQueryPending',
                'currentFullQueryToChatGPT',
                'currentProcessingTaskId',
                'managedChatGPTQueryTabId',
                'chatgptTabProgrammaticallyFocused',
                'currentOriginalQuery'
            ]);
            if (currentOriginalQuery) {
                chrome.notifications.create('chatGPTQueryFailNotification-' + Date.now(), {
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL("images/icon48.png"),
                    title: "ChatGPT Task Failed",
                    message: `Query "${currentOriginalQuery.substring(0,30)}..." failed after multiple attempts.`,
                    priority: 1
                });
            }
            sendResponse({status: "permanent_failure_acknowledged"});
        })();
        return true;
    }
    return false;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (notificationId.startsWith('chatGPTQueryNotification-') || notificationId.startsWith('chatGPTQueryFailNotification-')) {
        const data = await chrome.storage.local.get('latestQueryResponseUrl');
        if (data.latestQueryResponseUrl) {
            chrome.tabs.create({ url: data.latestQueryResponseUrl });
        }
    }
    chrome.notifications.clear(notificationId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get(['managedChatGPTQueryTabId', 'chatgptTabProgrammaticallyFocused']);
    if (data.managedChatGPTQueryTabId && tabId === data.managedChatGPTQueryTabId) {
        await chrome.storage.local.remove('managedChatGPTQueryTabId');
    }
    if (data.chatgptTabProgrammaticallyFocused && tabId === data.chatgptTabProgrammaticallyFocused) {
        await chrome.storage.local.remove('chatgptTabProgrammaticallyFocused');
    }
    if (previousActiveTabId === tabId) previousActiveTabId = null;
});