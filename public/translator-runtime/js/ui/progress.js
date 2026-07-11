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

function updateLargeFileProgress({ byteCursor = 0, fileSize = 0, completed = completedChunks, status = '' } = {}) {
    const safeFileSize = Math.max(1, Number(fileSize) || 1);
    const safeCursor = Math.max(0, Math.min(safeFileSize, Number(byteCursor) || 0));
    const percentage = Math.round((safeCursor / safeFileSize) * 100);
    document.getElementById('progressFill').style.width = `${percentage}%`;
    document.getElementById('progressText').textContent = `${percentage}%`;
    document.getElementById('progressDetails').textContent =
        `Đã xử lý ${completed.toLocaleString('vi-VN')} chunk • ${percentage}% file`;
    document.getElementById('progressStatus').textContent = status || 'Đang dịch file lớn...';

    const downloadBtn = document.getElementById('downloadPartialBtn');
    if (downloadBtn && completed > 0) {
        downloadBtn.innerHTML = `📥 Tải ${completed.toLocaleString('vi-VN')} chunk đã dịch`;
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
    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        return document.getElementById('translatedText')?.value || '';
    }

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

function getTranslatedBlobParts({ includePending = false } = {}) {
    if (typeof buildBlobPartsFromChunks === 'function') {
        return buildBlobPartsFromChunks(translatedChunks, {
            includePending,
            pendingLabel: '⏳ Chưa dịch',
        });
    }

    const parts = [];
    translatedChunks.forEach((chunk, index) => {
        const hasText = typeof chunk === 'string' && chunk.length > 0;
        if (!hasText && !includePending) return;
        if (parts.length > 0) parts.push('\n\n');
        parts.push(hasText ? chunk : `[⏳ Chưa dịch chunk ${index + 1}]`);
    });
    return parts;
}

function downloadBlobParts(parts, fileName, successMessage) {
    if (!Array.isArray(parts) || parts.length === 0) {
        showToast('Không có nội dung để tải!', 'warning');
        return;
    }

    const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(successMessage || 'Đã tải file thành công!', 'success');
}

function buildPartialTranslatorFileName(fileName, completedCount) {
    const safeName = String(fileName || 'translated_novel.txt');
    const suffix = `_partial_${Math.max(0, Number(completedCount) || 0)}chunks.txt`;
    return /\.txt$/i.test(safeName)
        ? safeName.replace(/\.txt$/i, suffix)
        : `${safeName}${suffix}`;
}

async function downloadTranslatorSessionResult(sessionId, fileName, options = {}) {
    if (!sessionId || typeof getTranslatorSessionOutputParts !== 'function') return false;

    const session = typeof getTranslatorSession === 'function'
        ? await getTranslatorSession(sessionId)
        : null;
    const parts = await getTranslatorSessionOutputParts(sessionId, { includePending: false });
    const completedCount = Math.max(0, Number(session?.completedChunks) || 0);
    const partial = Boolean(options.partial) || !session?.isComplete;
    const outputFileName = partial
        ? buildPartialTranslatorFileName(fileName, completedCount)
        : String(fileName || session?.outputFileName || 'translated_novel.txt');
    const successMessage = partial
        ? `Đã tải ${completedCount.toLocaleString('vi-VN')} chunk đã dịch.`
        : 'Đã tải bản dịch đầy đủ.';

    downloadBlobParts(parts, outputFileName, successMessage);
    return true;
}

async function downloadCurrentLargeFileResult({ partial = false } = {}) {
    if (currentTranslatorSessionId && typeof getTranslatorSessionOutputParts === 'function') {
        await downloadTranslatorSessionResult(currentTranslatorSessionId, originalFileName, { partial });
        return;
    }

    const fileName = partial
        ? buildPartialTranslatorFileName(originalFileName, completedChunks)
        : originalFileName;
    downloadBlobParts(
        getTranslatedBlobParts({ includePending: false }),
        fileName,
        partial
            ? `Đã tải ${completedChunks.toLocaleString('vi-VN')} chunk đã dịch.`
            : 'Đã tải bản dịch file lớn.'
    );
}

function copyResult() {
    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        showToast('File lớn nên tải xuống thay vì copy toàn bộ để tránh trình duyệt bị đơ.', 'warning');
        return;
    }

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

async function downloadResult() {
    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        await downloadCurrentLargeFileResult();
        return;
    }

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
async function downloadPartial() {
    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        await downloadCurrentLargeFileResult({ partial: true });
        return;
    }

    const translatedParts = translatedChunks.filter(c => c !== null && c !== undefined);

    if (translatedParts.length === 0) {
        showToast('Chưa có nội dung nào được dịch!', 'warning');
        return;
    }

    const text = translatedParts.join('\n\n');
    const partialFileName = buildPartialTranslatorFileName(originalFileName, completedChunks);

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
