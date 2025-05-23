const TARGET_BLOG_URL = 'https://dev.gmarket.com/';
const CHECK_ALARM_NAME = 'checkDevGmarketAlarm_HtmlFetch';
const LAST_KNOWN_POST_KEY = 'lastKnownPostUrl_devgmarket_htmlfetch';
const POPUP_URL_KEY = 'latestProcessedPostUrlForPopup_devgmarket';

async function getLatestPostInfoFromListPage() {
    let listPageTab;
    try {
        listPageTab = await chrome.tabs.create({ url: TARGET_BLOG_URL, active: false });
        await waitForTabLoad(listPageTab.id, TARGET_BLOG_URL);
        await new Promise(resolve => setTimeout(resolve, 1500));

        const response = await chrome.tabs.sendMessage(listPageTab.id, { action: "getLatestPostInfoFromListPage" });
        if (response && response.title && response.fullUrl) {
            return response;
        }
        console.error("[BG] 블로그 목록 파싱 응답 오류:", response ? response.error : "응답 없음");
        return null;
    } catch (error) {
        console.error(`[BG] getLatestPostInfoFromListPage (${TARGET_BLOG_URL}) 오류:`, error);
        return null;
    } finally {
        if (listPageTab && listPageTab.id) {
            try { await chrome.tabs.remove(listPageTab.id); } catch (e) {  }
        }
    }
}

async function checkLatestPostAndNotify() {
    console.log(`[BG] [${new Date().toLocaleTimeString()}] dev.gmarket.com 처리 시작...`);
    try {
        const latestPostInfo = await getLatestPostInfoFromListPage();
        if (!latestPostInfo) {
            console.log('[BG] 최신 글 정보 가져오기 실패.');
            return;
        }

        const { title: newPostTitle, fullUrl: newPostFullUrl } = latestPostInfo;
        console.log(`[BG] 현재 최신 글: ${newPostTitle} (${newPostFullUrl})`);

        await chrome.storage.local.set({
            [LAST_KNOWN_POST_KEY]: newPostFullUrl,
            [POPUP_URL_KEY]: newPostFullUrl
        });
        const articleContent = await extractArticleContentFromDevGmarket(newPostFullUrl);
        if (!articleContent) {
            console.error('[BG] 글 내용 추출 실패:', newPostFullUrl);
            return;
        }

        console.log("[BG] Article content to summarize (first 200 chars):", articleContent.substring(0, 200));
        const summary = await getSummaryFromChatGPTViaHtmlFetch(articleContent);

        let messageForNotification = "요약 정보를 가져오지 못했습니다.";
        if (summary &&
            summary.trim() !== "" &&
            !summary.includes("요약을 가져오지 못했습니다") &&
            !summary.includes("요약 중 오류 발생") &&
            !summary.includes("응답 요소를 찾을 수 없습니다") &&
            !summary.includes("응답 내용이 비어있습니다")) {
            messageForNotification = summary;
        } else {
            console.warn('[BG] ChatGPT 요약 실패 또는 유효하지 않은 결과 수신:', summary);
        }

        chrome.notifications.create(newPostFullUrl + "_" + Date.now(), {
            type: 'basic',
            iconUrl: 'images/icon48.png',
            title: newPostTitle,
            message: messageForNotification,
            priority: 2,
            requireInteraction: true
        });
        console.log("[BG] 알림 생성 완료.");

    } catch (error) {
        console.error('[BG] 글 확인 중 전체 오류:', error);
    }
}

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[BG] G마켓 기술블로그 알리미 설치/업데이트됨.');
    await chrome.storage.local.set({
        [LAST_KNOWN_POST_KEY]: '',
        [POPUP_URL_KEY]: ''
    });

    chrome.alarms.create(CHECK_ALARM_NAME, {
        delayInMinutes: 0.1,
        periodInMinutes: 1
    });

    if (details.reason === 'install') {
        console.log('[BG] 설치 직후 첫 실행을 즉시 시작합니다.');
        await checkLatestPostAndNotify();
    } else if (details.reason === 'update') {
        console.log('[BG] 업데이트 직후 첫 실행을 즉시 시작합니다.');
        await checkLatestPostAndNotify();
    }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === CHECK_ALARM_NAME) {
        await checkLatestPostAndNotify();
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    const urlToOpen = notificationId.split("_")[0];
    if (urlToOpen && urlToOpen.startsWith("http")) {
        chrome.tabs.create({ url: urlToOpen, active: true });
    }
    chrome.notifications.clear(notificationId);
});

async function waitForTabLoad(tabId, targetUrl) {
    return new Promise((resolve, reject) => {
        const timeout = 30000;
        let settled = false;
        let timer;

        const onUpdatedListener = (updatedTabId, changeInfo, tab) => {
            if (settled) return;
            const targetUrlClean = targetUrl.endsWith('/') ? targetUrl.slice(0, -1) : targetUrl;
            const tabUrlClean = tab.url ? (tab.url.endsWith('/') ? tab.url.slice(0, -1) : tab.url) : "";

            if (updatedTabId === tabId && changeInfo.status === 'complete' && tab.url && (tab.url.startsWith(targetUrl) || tabUrlClean === targetUrlClean) ) {
                settled = true;
                chrome.tabs.onUpdated.removeListener(onUpdatedListener);
                clearTimeout(timer);
                resolve();
            }
        };

        chrome.tabs.onUpdated.addListener(onUpdatedListener);

        timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            chrome.tabs.onUpdated.removeListener(onUpdatedListener);
            reject(new Error(`Tab ${tabId} 로드 시간 초과: ${targetUrl}`));
        }, timeout);

        chrome.tabs.get(tabId, (tabInfo) => {
            if (chrome.runtime.lastError) {
                if(settled) return;
                settled = true;
                chrome.tabs.onUpdated.removeListener(onUpdatedListener);
                clearTimeout(timer);
                reject(new Error(`Tab ${tabId} 가져오기 실패: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (settled) return;
            const targetUrlCleanCheck = targetUrl.endsWith('/') ? targetUrl.slice(0, -1) : targetUrl;
            const tabUrlCleanCheck = tabInfo.url ? (tabInfo.url.endsWith('/') ? tabInfo.url.slice(0, -1) : tabInfo.url) : "";

            if (tabInfo && tabInfo.status === 'complete' && tabInfo.url && (tabInfo.url.startsWith(targetUrl) || tabUrlCleanCheck === targetUrlCleanCheck)) {
                settled = true;
                chrome.tabs.onUpdated.removeListener(onUpdatedListener);
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

async function extractArticleContentFromDevGmarket(postUrl) {
    let tempTab;
    try {
        tempTab = await chrome.tabs.create({ url: postUrl, active: false });
        await waitForTabLoad(tempTab.id, postUrl);
        await new Promise(resolve => setTimeout(resolve, 3000));

        const response = await chrome.tabs.sendMessage(tempTab.id, { action: "extractContentFromDevGmarketArticle" });
        if (response && response.content) {
            return response.content;
        }
        console.error("[BG] dev.gmarket 글 본문 응답 오류:", response ? response.error : "응답 없음");
        return null;
    } catch (error) {
        console.error(`[BG] extractArticleContent (${postUrl}) 오류:`, error);
        return null;
    } finally {
        if (tempTab && tempTab.id) {
            try { await chrome.tabs.remove(tempTab.id); } catch (e) {  }
        }
    }
}

async function getSummaryFromChatGPTViaHtmlFetch(textToSummarize) {
    let chatgptTab = null;
    const chatGPTUrl = 'https://chatgpt.com/';
    let summaryResult = "요약을 가져오지 못했습니다 (HTML Fetch 방식).";

    try {
        const tabs = await chrome.tabs.query({ url: `${chatGPTUrl}*` });
        if (tabs.length > 0) {
            chatgptTab = tabs[0];
            await chrome.tabs.update(chatgptTab.id, { active: false, url: chatGPTUrl });
        } else {
            chatgptTab = await chrome.tabs.create({ url: chatGPTUrl, active: false });
        }

        await waitForTabLoad(chatgptTab.id, chatGPTUrl);
        console.log(`[BG] ChatGPT 탭 ${chatgptTab.id} (백그라운드) 로드 완료. 프롬프트 제출 요청`);

        const prepResponse = await chrome.tabs.sendMessage(chatgptTab.id, { action: "submitPromptAndPrepareForScraping", data: textToSummarize });
        if (!prepResponse || !prepResponse.prepared) {
            console.error("[BG] ChatGPT 페이지 준비 실패:", prepResponse ? prepResponse.error : "알 수 없는 오류 또는 응답 없음");
            summaryResult = prepResponse && prepResponse.error ? prepResponse.error : "ChatGPT 페이지 준비에 실패했습니다.";
            // finally 블록에서 탭을 닫도록 여기서 바로 반환
            return summaryResult;
        }

        const WAIT_FOR_RESPONSE_HTML_FETCH = 7000;
        console.log(`[BG] ChatGPT 프롬프트 제출 완료 (백그라운드). ${WAIT_FOR_RESPONSE_HTML_FETCH / 1000}초 후 HTML 가져오기 시도`);
        await new Promise(resolve => setTimeout(resolve, WAIT_FOR_RESPONSE_HTML_FETCH));

        const results = await chrome.scripting.executeScript({
            target: { tabId: chatgptTab.id },
            func: () => document.documentElement.outerHTML
        });

        if (results && results[0] && results[0].result) {
            const htmlString = results[0].result;
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, "text/html");
            const responseElements = doc.querySelectorAll('div[data-message-author-role="assistant"] div.markdown');
            if (responseElements.length > 0) {
                const lastResponseElement = responseElements[responseElements.length - 1];
                if (lastResponseElement && lastResponseElement.textContent) {
                    summaryResult = lastResponseElement.textContent.trim();
                    console.log("[BG] HTML 직접 파싱으로 요약 추출:", summaryResult.substring(0,100));
                } else {
                    summaryResult = "HTML 파싱: 응답 내용은 찾았으나 비어있음.";
                }
            } else {
                summaryResult = "HTML 파싱: 응답 요소를 찾을 수 없음.";
            }
        } else {
            console.error("[BG] ChatGPT 페이지 HTML 가져오기 실패.");
            summaryResult = "HTML 파싱: ChatGPT 페이지 HTML을 가져오지 못했습니다.";
        }
    } catch (error) {
        console.error('[BG] getSummaryFromChatGPTViaHtmlFetch 전체 오류:', error);
        summaryResult = `요약 중 예외 발생 (HTML Fetch): ${error.message}`;
    } finally {
        if (chatgptTab && chatgptTab.id) {
            try {
                await chrome.tabs.remove(chatgptTab.id);
            } catch (e) {  }
        }
    }
    return summaryResult;
}