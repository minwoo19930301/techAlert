chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "submitPromptAndPrepareForScraping") {
        console.log("[CS-ChatGPT] submitPromptAndPrepareForScraping 메시지 수신");
        const textToSummarize = request.data;
        const PROMPT_PREFIX = "다음 내용을 20자 내외로 매우 짧게 핵심만 요약해줘: ";
        const fullPrompt = PROMPT_PREFIX + textToSummarize;

        const attemptPromptSubmission = async () => {
            try {
                await new Promise(resolve => setTimeout(resolve, 2000));

                const keepLoggedInLink = Array.from(document.querySelectorAll('a.underline')).find(
                    a => a.textContent.includes('로그아웃 유지') || a.textContent.includes('Keep me logged in')
                );
                if (keepLoggedInLink) {
                    console.log("[CS-ChatGPT] '로그아웃 유지' 링크 클릭");
                    keepLoggedInLink.click();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                const initialModalsDoneMarker = document.querySelector('span[data-testid="blocking-initial-modals-done"]');
                if (!initialModalsDoneMarker || initialModalsDoneMarker.classList.contains('hidden')) {
                    const genericCloseButton = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Okay, let’s go') || btn.textContent.includes('다음에 하기') || btn.textContent.includes('나중에 하기') || btn.textContent.includes('확인'));
                    if(genericCloseButton){
                        console.log("[CS-ChatGPT] 초기 모달 닫기 버튼 클릭:", genericCloseButton.textContent);
                        genericCloseButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                const promptInputDiv = document.querySelector('div#prompt-textarea[contenteditable="true"]');
                let sendButton = document.querySelector('button#composer-submit-button[data-testid="send-button"]');

                if (promptInputDiv) {
                    promptInputDiv.focus();
                    promptInputDiv.innerHTML = `<p>${fullPrompt.replace(/\n/g, '</p><p>')}</p>`;
                    promptInputDiv.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log("[CS-ChatGPT] 프롬프트 입력 완료");

                    await new Promise(resolve => setTimeout(resolve, 1000));

                    if (!sendButton || sendButton.disabled) {
                        const form = promptInputDiv.closest('form');
                        if (form) {
                            const buttonsInForm = form.querySelectorAll('button');
                            for (let i = buttonsInForm.length - 1; i >= 0; i--) {
                                if (!buttonsInForm[i].disabled && buttonsInForm[i].offsetHeight > 0 && buttonsInForm[i].querySelector('svg')) {
                                    const svgPath = buttonsInForm[i].querySelector('svg path');
                                    if (svgPath && svgPath.getAttribute('d') && svgPath.getAttribute('d').startsWith('M7.99992')) {
                                        sendButton = buttonsInForm[i];
                                        break;
                                    }
                                }
                            }
                            if (!sendButton && buttonsInForm.length > 0){
                                for (let i = buttonsInForm.length - 1; i >= 0; i--) {
                                    if(!buttonsInForm[i].disabled && buttonsInForm[i].offsetHeight > 0){
                                        sendButton = buttonsInForm[i];
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if (sendButton && !sendButton.disabled) {
                        console.log("[CS-ChatGPT] 전송 버튼 클릭");
                        sendButton.click();
                    } else {
                        console.warn("[CS-ChatGPT] 유효한 전송 버튼 클릭 불가, Enter 시도");
                        promptInputDiv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                    window.scrollTo(0, document.body.scrollHeight);
                    console.log("[CS-ChatGPT] 첫 번째 스크롤 완료");

                    await new Promise(resolve => setTimeout(resolve, 500));
                    window.scrollTo(0, document.body.scrollHeight);
                    console.log("[CS-ChatGPT] 두 번째 스크롤 완료, 백그라운드로 작업 준비 완료 알림");
                    sendResponse({ prepared: true }); // 백그라운드에 준비 완료 알림

                } else {
                    sendResponse({ prepared: false, error: "ChatGPT 입력 필드를 찾을 수 없습니다." });
                }
            } catch (e) {
                console.error("[CS-ChatGPT] attemptPromptSubmission 중 오류:", e);
                sendResponse({ prepared: false, error: e.message });
            }
        };

        attemptPromptSubmission();
    }
    return true;
});