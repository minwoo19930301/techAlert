chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getLatestPostInfoFromListPage") {
        const firstPostItemContainer = document.querySelector('#cMain div.article_skin div.list_content');
        if (firstPostItemContainer) {
            const linkElement = firstPostItemContainer.querySelector('a.link_post');
            const titleElement = firstPostItemContainer.querySelector('a.link_post strong.tit_post');
            if (linkElement && titleElement) {
                const relativeUrl = linkElement.getAttribute('href');
                const title = titleElement.innerText.trim();
                const fullUrl = new URL(relativeUrl, window.location.origin).href;
                sendResponse({ title: title, fullUrl: fullUrl, relativeUrl: relativeUrl });
            } else {
                sendResponse({ error: "목록 페이지: 링크/제목 요소를 list_content 내에서 찾을 수 없습니다." });
            }
        } else {
            sendResponse({ error: "목록 페이지: #cMain div.list_content 요소를 찾을 수 없습니다." });
        }
    } else if (request.action === "extractContentFromDevGmarketArticle") {
        const contentElement = document.querySelector('div.area_view div.contents_style');
        if (contentElement) {
            sendResponse({ content: contentElement.innerText });
        } else {
            sendResponse({ content: null, error: "글 상세: .area_view .contents_style 요소를 찾을 수 없습니다." });
        }
    }
    return true;
});