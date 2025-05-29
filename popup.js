// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const newQueryTextarea = document.getElementById('newQueryText');
    const newQueryIntervalInput = document.getElementById('newQueryInterval');
    const decreaseIntervalBtn = document.getElementById('decreaseIntervalBtn');
    const increaseIntervalBtn = document.getElementById('increaseIntervalBtn');
    const addScheduleButton = document.getElementById('addScheduleButton');
    const schedulesListContainer = document.getElementById('schedulesListContainer');
    const noSchedulesMessage = document.getElementById('noSchedules');
    const statusMessage = document.getElementById('statusMessage');

    function renderSchedules(schedules = []) {
        schedulesListContainer.innerHTML = '';
        if (schedules.length === 0) {
            schedulesListContainer.appendChild(noSchedulesMessage);
            noSchedulesMessage.style.display = 'block';
            return;
        }
        noSchedulesMessage.style.display = 'none';

        schedules.forEach(schedule => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'schedule-item';
            itemDiv.setAttribute('data-id', schedule.id);

            const textSpan = document.createElement('span');
            textSpan.className = 'schedule-text';
            textSpan.textContent = schedule.query.length > 25 ? schedule.query.substring(0, 22) + '...' : schedule.query;
            textSpan.title = schedule.query;

            const intervalSpan = document.createElement('span');
            intervalSpan.className = 'schedule-interval';
            intervalSpan.textContent = schedule.interval > 0 ? `Every ${schedule.interval} min` : 'No Repeat';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-schedule-btn';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => {
                deleteSchedule(schedule.id);
            });

            itemDiv.appendChild(textSpan);
            itemDiv.appendChild(intervalSpan);
            itemDiv.appendChild(deleteBtn);
            schedulesListContainer.appendChild(itemDiv);
        });
    }

    async function loadSchedulesFromStorage() {
        const result = await chrome.storage.local.get({scheduledQueries: []});
        renderSchedules(result.scheduledQueries);
    }

    decreaseIntervalBtn.addEventListener('click', () => {
        let currentValue = parseInt(newQueryIntervalInput.value, 10);
        currentValue = Math.max(0, currentValue - 1);
        newQueryIntervalInput.value = currentValue;
    });

    increaseIntervalBtn.addEventListener('click', () => {
        let currentValue = parseInt(newQueryIntervalInput.value, 10);
        currentValue += 1;
        newQueryIntervalInput.value = currentValue;
    });

    addScheduleButton.addEventListener('click', async () => {
        const query = newQueryTextarea.value.trim();
        const interval = parseInt(newQueryIntervalInput.value, 10);

        if (!query) {
            statusMessage.textContent = 'Error: Query content cannot be empty.';
            statusMessage.style.color = '#e06c75';
            return;
        }

        const newSchedule = {
            id: 'query_' + Date.now(),
            query: query,
            interval: interval
        };

        const result = await chrome.storage.local.get({scheduledQueries: []});
        const updatedSchedules = [...result.scheduledQueries, newSchedule];

        chrome.storage.local.set({scheduledQueries: updatedSchedules}, () => {
            loadSchedulesFromStorage();
            newQueryTextarea.value = '';

            chrome.runtime.sendMessage({
                type: "EXECUTE_AND_SCHEDULE_TASK",
                task: newSchedule
            }, (response) => {
                if (chrome.runtime.lastError) {
                    statusMessage.textContent = 'Error sending task.';
                    statusMessage.style.color = '#e06c75';
                } else if (response && response.status) {
                    if (response.status === "task_scheduled_and_running") {
                        statusMessage.textContent = `Running, repeats every ${newSchedule.interval} min.`;
                    } else if (response.status === "task_started_no_schedule") {
                        statusMessage.textContent = 'Running (no repeat).';
                    }
                    statusMessage.style.color = '#98c379';
                }
            });
        });
    });

    async function deleteSchedule(scheduleId) {
        const result = await chrome.storage.local.get({scheduledQueries: []});
        const updatedSchedules = result.scheduledQueries.filter(s => s.id !== scheduleId);
        chrome.storage.local.set({scheduledQueries: updatedSchedules}, () => {
            loadSchedulesFromStorage();
            statusMessage.textContent = 'Schedule deleted.';
            statusMessage.style.color = '#e5c07b';
            chrome.runtime.sendMessage({
                type: "CANCEL_SCHEDULED_TASK",
                taskId: scheduleId
            });
        });
    }

    loadSchedulesFromStorage();
});