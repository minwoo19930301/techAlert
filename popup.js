document.addEventListener('DOMContentLoaded', () => {
    const postFrame = document.getElementById('postFrame');
    const messageDiv = document.getElementById('messageDiv');

    chrome.storage.local.get(['latestProcessedPostUrlForPopup_devgmarket'], (result) => {
        if (chrome.runtime.lastError) {
            messageDiv.textContent = '오류: 최신 글 정보를 가져올 수 없습니다.';
            console.error(chrome.runtime.lastError.message);
            return;
        }

        const latestUrl = result.latestProcessedPostUrlForPopup_devgmarket;
        if (latestUrl) {
            postFrame.src = latestUrl;
            postFrame.style.display = 'block';
            messageDiv.style.display = 'none';
        } else {
            messageDiv.textContent = '아직 확인된 새 글이 없습니다. 잠시 후 다시 시도해주세요.';
        }
    });
});