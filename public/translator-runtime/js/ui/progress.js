/**
 * Novel Translator Pro - Progress & UI Updates
 * Cập nhật tiến độ, toast, download
 */

// ============================================
// PROGRESS UPDATES
// ============================================
function updateProgress(current, total, status) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    document.getElementById('progressFill').style.width = `${percentage}%`;
    document.getElementById('progressText').textContent = `${percentage}%`;
    document.getElementById('progressDetails').textContent = `${current} / ${total} chunk`;
    document.getElementById('progressStatus').textContent = status;

    // Update download button text
    const downloadBtn = document.getElementById('downloadPartialBtn');
    if (downloadBtn && current > 0) {
        downloadBtn.innerHTML = `📥 Tải ${current} chunk đã dịch`;
    }
}

function updateProgressStats(speed, activeKeys, eta) {
    document.getElementById('speedStat').textContent = speed;
    document.getElementById('activeKeysStat').textContent = activeKeys;
    document.getElementById('etaStat').textContent = eta;
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================
// SLEEP UTILITIES - Đã chuyển sang js/worker-timer.js
// Sử dụng Web Worker timer để không bị throttle khi tab ẩn
// Các hàm sleep(), sleepWithCountdown() được định nghĩa trong worker-timer.js
// ============================================

// ============================================
// RESULT ACTIONS
// ============================================
function getDownloadableTranslatedText() {
    const textarea = document.getElementById('translatedText');
    const text = textarea ? textarea.value : '';
    const hasChunkData = Array.isArray(translatedChunks) && translatedChunks.length > 0;

    if (isTranslating &&
        hasChunkData &&
        typeof buildTranslatedTextFromChunks === 'function') {
        return buildTranslatedTextFromChunks(translatedChunks, '⏳ Đang dịch');
    }

    return text;
}

function copyResult() {
    const text = getDownloadableTranslatedText();
    if (!text) {
        showToast('Không có nội dung để sao chép!', 'warning');
        return;
    }

    navigator.clipboard.writeText(text).then(() => {
        showToast('Đã sao chép vào bộ nhớ tạm.', 'success');
    }).catch(() => {
        const textarea = document.getElementById('translatedText');
        textarea.select();
        document.execCommand('copy');
        showToast('Đã sao chép vào bộ nhớ tạm.', 'success');
    });
}

function downloadResult() {
    const text = getDownloadableTranslatedText();
    if (!text) {
        showToast('Không có nội dung để tải!', 'warning');
        return;
    }

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Đã tải file thành công!', 'success');
}

// Download partial - tải phần đã dịch được
// FIX: Bỏ map+filter thừa, dùng filter trực tiếp cho gọn và đúng
function downloadPartial() {
    const translatedParts = translatedChunks.filter(c => c !== null && c !== undefined);

    if (translatedParts.length === 0) {
        showToast('Chưa có nội dung nào được dịch!', 'warning');
        return;
    }

    const text = translatedParts.join('\n\n');
    const partialFileName = originalFileName.replace('.txt', `_partial_${completedChunks}chunks.txt`);

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = partialFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Đã tải ${completedChunks} chunk đã dịch.`, 'success');
}



// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = icons[type] || icons.info;
    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = String(message || '');
    toast.appendChild(icon);
    toast.appendChild(text);

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
