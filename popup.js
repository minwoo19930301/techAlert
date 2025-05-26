document.addEventListener('DOMContentLoaded', () => {
    const mainPromptTextarea = document.getElementById('mainPrompt');
    const intervalInput = document.getElementById('scheduleIntervalValue');
    const decreaseButton = document.getElementById('decreaseInterval');
    const increaseButton = document.getElementById('increaseInterval');
    const startButton = document.getElementById('startScheduleButton');
    const statusMessage = document.getElementById('statusMessage');

    chrome.storage.local.get(['userMainQuery', 'queryScheduleIntervalMinutes'], (result) => {
        mainPromptTextarea.value = result.userMainQuery || ""; // 기본값 빈 문자열
        intervalInput.value = result.queryScheduleIntervalMinutes || 0;
    });

    decreaseButton.addEventListener('click', () => {
        let currentValue = parseInt(intervalInput.value, 10);
        currentValue = Math.max(0, currentValue - 10); // 0 이하로 내려가지 않도록
        intervalInput.value = currentValue;
    });

    increaseButton.addEventListener('click', () => {
        let currentValue = parseInt(intervalInput.value, 10);
        currentValue += 10;
        intervalInput.value = currentValue;
    });

    startButton.addEventListener('click', () => {
        const mainQuery = mainPromptTextarea.value.trim();
        const interval = parseInt(intervalInput.value, 10);

        if (!mainQuery) {
            statusMessage.textContent = '오류: 질문 내용을 입력해주세요.';
            statusMessage.style.color = 'red';
            return;
        }

        chrome.storage.local.set({
            userMainQuery: mainQuery,
            queryScheduleIntervalMinutes: interval
        }, () => {
            chrome.runtime.sendMessage({
                type: "START_CHATGPT_QUERY_TASK",
                scheduleIntervalMinutes: interval
            }, (response) => {
                if (chrome.runtime.lastError) {
                    statusMessage.textContent = '오류: ' + chrome.runtime.lastError.message;
                    statusMessage.style.color = 'red';
                } else if (response) {
                    if (response.status === "task_scheduled_and_running") {
                        statusMessage.textContent = `즉시 실행되고, ${interval}분 간격으로 반복됩니다.`;
                    } else if (response.status === "task_started_no_schedule") {
                        statusMessage.textContent = '즉시 실행됩니다. (반복 안함)';
                    } else {
                        statusMessage.textContent = '작업 시작됨: ' + (response.status || "알 수 없는 응답");
                    }
                    statusMessage.style.color = 'green';
                } else {
                    statusMessage.textContent = '백그라운드에서 응답이 없습니다.';
                    statusMessage.style.color = 'orange';
                }
            });
        });
    });
});