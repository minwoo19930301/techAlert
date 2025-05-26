chrome.runtime.onInstalled.addListener(() => {
    console.log("ChatGPT Auto Hello v2 extension installed.");
    chrome.storage.local.set({ "chatGptInitialActionPending": true }, () => {
        console.log("Initial action flag 'chatGptInitialActionPending' set to true.");
        chrome.tabs.create({ url: "https://chatgpt.com/", active: false }, (newTab) => {
            if (chrome.runtime.lastError) {
                console.error("Error creating tab:", chrome.runtime.lastError.message);
            } else {
                console.log("ChatGPT tab created in background:", newTab.id);
            }
        });
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "showNotification") {
        chrome.notifications.create('', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL("images/icon48.png"), // Use getURL for reliable path
            title: 'ChatGPT 응답',
            message: request.message
        }, (notificationId) => {
            if (chrome.runtime.lastError) {
                console.error("Error creating notification:", chrome.runtime.lastError.message);
            } else {
                console.log("Notification shown:", notificationId);
            }
        });
    }
});