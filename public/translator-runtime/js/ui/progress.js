/**
 * Novel Translator Pro - Progress & UI Updates
 * Cập nhật tiến độ, toast, download
 */

// ============================================
// PROGRESS UPDATES
// ============================================
function updateProgress(current, total, status) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const countdownStatus = typeof getActiveTranslatorCountdownStatus === 'function'
        ? getActiveTranslatorCountdownStatus()
        : '';
    document.getElementById('progressFill').style.width = `${percentage}%`;
    document.getElementById('progressText').textContent = `${percentage}%`;
    document.getElementById('progressDetails').textContent = `${current} / ${total} chunk`;
    document.getElementById('progressStatus').textContent = countdownStatus || status;

    // Update download button text
    const downloadBtn = document.getElementById('downloadPartialBtn');
    if (downloadBtn && current > 0) {
        downloadBtn.innerHTML = `📥 Tải ${current} chunk đã dịch`;
    }
    if (isTranslating && typeof notifyStoryForgeTranslatorStatus === 'function') {
        notifyStoryForgeTranslatorStatus('running', { completed: current, total });
    }
}

function updateLargeFileProgress({ byteCursor = 0, fileSize = 0, completed = completedChunks, status = '' } = {}) {
    const safeFileSize = Math.max(1, Number(fileSize) || 1);
    const safeCursor = Math.max(0, Math.min(safeFileSize, Number(byteCursor) || 0));
    const percentage = Math.round((safeCursor / safeFileSize) * 100);
    const countdownStatus = typeof getActiveTranslatorCountdownStatus === 'function'
        ? getActiveTranslatorCountdownStatus()
        : '';
    document.getElementById('progressFill').style.width = `${percentage}%`;
    document.getElementById('progressText').textContent = `${percentage}%`;
    document.getElementById('progressDetails').textContent =
        `Đã xử lý ${completed.toLocaleString('vi-VN')} chunk • ${percentage}% file`;
    document.getElementById('progressStatus').textContent = countdownStatus || status || 'Đang dịch file lớn...';

    const downloadBtn = document.getElementById('downloadPartialBtn');
    if (downloadBtn && completed > 0) {
        downloadBtn.innerHTML = `📥 Tải ${completed.toLocaleString('vi-VN')} chunk đã dịch`;
    }
    if (isTranslating && typeof notifyStoryForgeTranslatorStatus === 'function') {
        notifyStoryForgeTranslatorStatus('running', {
            completed,
            total: totalChunksCount,
        });
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
const TRANSLATOR_OUTPUT_UPDATING_MESSAGE = 'Bản dịch đang được cập nhật. Hãy đợi tác vụ dịch lại kết thúc rồi tải file.';

function isTranslatorOutputDownloadLocked(sessionId = null) {
    if (typeof globalThis === 'undefined' || !globalThis.isChunkIssueRetryBusy) return false;
    const hasScopedRetry = Object.prototype.hasOwnProperty.call(globalThis, 'chunkIssueRetrySessionId');
    if (!sessionId || !hasScopedRetry) return true;
    const retrySessionId = globalThis.chunkIssueRetrySessionId;
    return retrySessionId ? String(retrySessionId) === String(sessionId) : false;
}

function refuseTranslatorOutputDownloadWhileUpdating(sessionId = null) {
    if (!isTranslatorOutputDownloadLocked(sessionId)) return false;
    showToast(TRANSLATOR_OUTPUT_UPDATING_MESSAGE, 'warning');
    return true;
}

function getCurrentTranslatorDownloadSessionId() {
    return typeof currentTranslatorSessionId !== 'undefined' && currentTranslatorSessionId
        ? String(currentTranslatorSessionId)
        : null;
}

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
        return false;
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
    return true;
}

function buildPartialTranslatorFileName(fileName, completedCount) {
    const safeName = String(fileName || 'translated_novel.txt');
    const suffix = `_partial_${Math.max(0, Number(completedCount) || 0)}chunks.txt`;
    return /\.txt$/i.test(safeName)
        ? safeName.replace(/\.txt$/i, suffix)
        : `${safeName}${suffix}`;
}

function buildIssueMarkedTranslatorFileName(fileName, issueCount) {
    const safeName = String(fileName || 'translated_novel.txt');
    const safeIssueCount = Math.max(0, Number(issueCount) || 0);
    const suffix = `_issues_${safeIssueCount}chunk${safeIssueCount === 1 ? '' : 's'}.txt`;
    return /\.txt$/i.test(safeName)
        ? safeName.replace(/\.txt$/i, suffix)
        : `${safeName}${suffix}`;
}

function hasTranslatorSessionOutputIssues(session) {
    return Math.max(0, Number(session?.failedChunks) || 0) > 0;
}

function didTranslatorOutputRevisionChange(before, after) {
    if (!before || !after) return false;
    const beforeRevision = Math.max(0, Number(before.outputRevision) || 0);
    const afterRevision = Math.max(0, Number(after.outputRevision) || 0);
    return beforeRevision !== afterRevision;
}

async function downloadTranslatorSessionResult(sessionId, fileName, options = {}) {
    if (!sessionId || typeof getTranslatorSessionOutputParts !== 'function') return false;
    if (refuseTranslatorOutputDownloadWhileUpdating(sessionId)) return false;

    const sessionBefore = typeof getTranslatorSession === 'function'
        ? await getTranslatorSession(sessionId)
        : null;
    const parts = await getTranslatorSessionOutputParts(sessionId, { includePending: false });
    if (refuseTranslatorOutputDownloadWhileUpdating(sessionId)) return false;
    const sessionAfter = typeof getTranslatorSession === 'function'
        ? await getTranslatorSession(sessionId)
        : sessionBefore;
    if (didTranslatorOutputRevisionChange(sessionBefore, sessionAfter)) {
        showToast('Bản dịch vừa thay đổi trong lúc chuẩn bị file. Hãy bấm tải lại để lấy bản mới nhất.', 'warning');
        return false;
    }

    const session = sessionAfter || sessionBefore;
    const completedCount = Math.max(0, Number(session?.completedChunks) || 0);
    const issueCount = Math.max(0, Number(session?.failedChunks) || 0);
    const partial = Boolean(options.partial) || !session?.isComplete;
    const marked = hasTranslatorSessionOutputIssues(session);
    const baseFileName = String(fileName || session?.outputFileName || 'translated_novel.txt');
    const partialFileName = partial ? buildPartialTranslatorFileName(baseFileName, completedCount) : baseFileName;
    const outputFileName = marked
        ? buildIssueMarkedTranslatorFileName(partialFileName, issueCount)
        : partialFileName;
    const successMessage = partial && marked
        ? `Đã tải bản tạm có đánh dấu ${issueCount.toLocaleString('vi-VN')} chunk lỗi.`
        : partial
            ? `Đã tải ${completedCount.toLocaleString('vi-VN')} chunk đã dịch.`
            : marked
                ? `Đã tải bản có đánh dấu ${issueCount.toLocaleString('vi-VN')} chunk lỗi.`
                : 'Đã tải bản dịch đầy đủ.';

    return downloadBlobParts(parts, outputFileName, successMessage);
}

async function downloadCurrentLargeFileResult({ partial = false } = {}) {
    if (refuseTranslatorOutputDownloadWhileUpdating(getCurrentTranslatorDownloadSessionId())) return false;
    if (
        currentTranslatorSessionId
        && (typeof currentTranslatorPersistenceAvailable === 'undefined' || currentTranslatorPersistenceAvailable)
        && typeof getTranslatorSessionOutputParts === 'function'
    ) {
        return downloadTranslatorSessionResult(currentTranslatorSessionId, originalFileName, { partial });
    }

    const chunks = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks) ? translatedChunks : [];
    const issueSummary = typeof summarizeTranslatorChunkIssues === 'function'
        ? summarizeTranslatorChunkIssues({ chunks, totalChunks: chunks.length })
        : null;
    const issueCount = issueSummary
        ? Math.max(0, Number(issueSummary.failedCount) || 0) + Math.max(0, Number(issueSummary.manualCount) || 0)
        : chunks.filter(chunk => typeof chunk === 'string' && (
            chunk.startsWith('[LỖI CHUNK') || chunk.includes('CẦN DỊCH THỦ CÔNG')
        )).length;
    const hasPending = issueSummary
        ? Math.max(0, Number(issueSummary.pendingCount) || 0) > 0
        : chunks.some(chunk => typeof chunk !== 'string' || chunk.length === 0);
    const partialOutput = Boolean(partial) || hasPending;
    const partialFileName = partialOutput
        ? buildPartialTranslatorFileName(originalFileName, completedChunks)
        : originalFileName;
    const fileName = issueCount > 0
        ? buildIssueMarkedTranslatorFileName(partialFileName, issueCount)
        : partialFileName;
    const successMessage = partialOutput && issueCount > 0
        ? `Đã tải bản tạm có đánh dấu ${issueCount.toLocaleString('vi-VN')} chunk lỗi.`
        : partialOutput
            ? `Đã tải ${completedChunks.toLocaleString('vi-VN')} chunk đã dịch.`
            : issueCount > 0
                ? `Đã tải bản có đánh dấu ${issueCount.toLocaleString('vi-VN')} chunk lỗi.`
                : 'Đã tải bản dịch file lớn.';
    return downloadBlobParts(
        getTranslatedBlobParts({ includePending: false }),
        fileName,
        successMessage
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
    if (refuseTranslatorOutputDownloadWhileUpdating(getCurrentTranslatorDownloadSessionId())) return false;
    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        return downloadCurrentLargeFileResult();
    }

    const text = getDownloadableTranslatedText();
    if (!text) {
        showToast('Không có nội dung để tải!', 'warning');
        return false;
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
    return true;
}

// Download partial - tải phần đã dịch được
// FIX: Bỏ map+filter thừa, dùng filter trực tiếp cho gọn và đúng
async function downloadPartial() {
    if (refuseTranslatorOutputDownloadWhileUpdating(getCurrentTranslatorDownloadSessionId())) return false;
    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        return downloadCurrentLargeFileResult({ partial: true });
    }

    const translatedParts = translatedChunks.filter(c => c !== null && c !== undefined);

    if (translatedParts.length === 0) {
        showToast('Chưa có nội dung nào được dịch!', 'warning');
        return false;
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
    return true;
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
