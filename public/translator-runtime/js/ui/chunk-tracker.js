/**
 * Novel Translator Pro - Chunk Tracker
 * Theo dõi chi tiết từng chunk: input/output length, ratio, status, retry count
 * Cho phép dịch lại từng chunk đơn lẻ
 */

// ============================================
// CHUNK TRACKING DATA
// ============================================
let chunkTrackingData = []; // Array of { index, inputLen, outputLen, ratio, status, retryCount, model, timeMs, error }
let originalChunksRef = []; // Reference to original chunks (raw, no prompt)
let preparedChunksRef = []; // Reference to prepared chunks (with prompt)
let customPromptRef = ''; // Reference to custom prompt used
const CHUNK_TRACKER_RENDER_BATCH_SIZE = 100;
let chunkTrackerWindowStart = 0;
let chunkTrackerDynamicMode = false;
let chunkTrackerLargeFileMode = false;
let chunkTrackerSummaryState = {
    total: 0,
    success: 0,
    warning: 0,
    failed: 0,
    totalInput: 0,
    totalOutput: 0,
    totalRetries: 0,
};
let lastChunkIssueSummary = null;

// Status enum
const CHUNK_STATUS = {
    PENDING: 'pending',
    TRANSLATING: 'translating',
    SUCCESS: 'success',
    WARNING: 'warning', // ratio < 60%
    FAILED: 'failed',
    RETRYING: 'retrying',
    RETRANSLATING: 'retranslating'
};

const TRANSLATOR_CHUNK_ISSUE_TYPES = {
    FAILED: 'failed',
    MANUAL: 'manual',
    PENDING: 'pending',
};
const TRANSLATOR_CHUNK_BUSY_MESSAGE = 'Chỉ xử lý sau khi dừng hoặc hoàn tất bản dịch.';

function getSafeChunkIndex(chunk, fallbackIndex) {
    const rawIndex = chunk && typeof chunk === 'object' ? chunk.chunkIndex : fallbackIndex;
    const numeric = Number(rawIndex);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallbackIndex;
}

function getChunkOutputText(chunk) {
    if (chunk && typeof chunk === 'object') {
        if (typeof chunk.outputText === 'string') return chunk.outputText;
        if (typeof chunk.text === 'string') return chunk.text;
        return '';
    }
    return typeof chunk === 'string' ? chunk : '';
}

function getChunkErrorText(chunk) {
    if (chunk && typeof chunk === 'object') {
        return String(chunk.error || chunk.errorMessage || chunk.rawError || '');
    }
    return '';
}

function isSafetyRelatedTranslatorIssue(text = '', error = '') {
    const combined = `${text || ''} ${error || ''}`.toLowerCase();
    return combined.includes('content_blocked') ||
        combined.includes('safety') ||
        combined.includes('prohibited') ||
        combined.includes('kiểm duyệt') ||
        combined.includes('bộ lọc an toàn') ||
        combined.includes('chính sách');
}

function getChunkIssueType(chunk, outputText) {
    const status = chunk && typeof chunk === 'object' ? String(chunk.status || '') : '';
    const text = String(outputText || '').trim();

    if (status === 'skipped') return '';
    if (status === 'failed') return TRANSLATOR_CHUNK_ISSUE_TYPES.FAILED;
    if (!text) return TRANSLATOR_CHUNK_ISSUE_TYPES.PENDING;
    if (text.startsWith('[LỖI CHUNK')) return TRANSLATOR_CHUNK_ISSUE_TYPES.FAILED;
    if (/^\[❌\s*Chunk\s+\d+\s+thất bại\]/i.test(text)) return TRANSLATOR_CHUNK_ISSUE_TYPES.FAILED;
    if (text.includes('CẦN DỊCH THỦ CÔNG')) return TRANSLATOR_CHUNK_ISSUE_TYPES.MANUAL;
    if (/^\[⏳/i.test(text)) return TRANSLATOR_CHUNK_ISSUE_TYPES.PENDING;
    return '';
}

function summarizeTranslatorChunkIssues(options = {}) {
    const chunks = Array.isArray(options.chunks) ? options.chunks : [];
    const startChunkIndex = Math.max(0, Number(options.startChunkIndex) || 0);
    const totalChunks = Number.isFinite(Number(options.totalChunks))
        ? Math.max(0, Math.trunc(Number(options.totalChunks)))
        : chunks.length;
    const rowCount = Math.max(totalChunks, chunks.length);
    const issues = [];

    for (let fallbackIndex = 0; fallbackIndex < rowCount; fallbackIndex += 1) {
        const chunk = fallbackIndex < chunks.length ? chunks[fallbackIndex] : null;
        const chunkIndex = getSafeChunkIndex(chunk, fallbackIndex);
        if (chunkIndex < startChunkIndex) continue;

        const outputText = getChunkOutputText(chunk);
        const type = getChunkIssueType(chunk, outputText);
        if (!type) continue;

        const error = getChunkErrorText(chunk);
        issues.push({
            chunkIndex,
            displayIndex: chunkIndex + 1,
            type,
            status: chunk && typeof chunk === 'object' ? String(chunk.status || '') : '',
            error,
            outputText,
            safetyRelated: isSafetyRelatedTranslatorIssue(outputText, error),
        });
    }

    issues.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const failedCount = issues.filter(issue => issue.type === TRANSLATOR_CHUNK_ISSUE_TYPES.FAILED).length;
    const manualCount = issues.filter(issue => issue.type === TRANSLATOR_CHUNK_ISSUE_TYPES.MANUAL).length;
    const pendingCount = issues.filter(issue => issue.type === TRANSLATOR_CHUNK_ISSUE_TYPES.PENDING).length;
    const safetyCount = issues.filter(issue => issue.safetyRelated).length;

    return {
        totalChunks,
        startChunkIndex,
        issueCount: issues.length,
        failedCount,
        manualCount,
        pendingCount,
        safetyCount,
        firstIssueIndex: issues.length > 0 ? issues[0].chunkIndex : -1,
        issues,
        isClear: issues.length === 0,
    };
}

function isChunkIssueActionBusy() {
    return typeof isTranslating !== 'undefined' && isTranslating;
}

function notifyChunkIssueBusy() {
    if (typeof showToast === 'function') {
        showToast(TRANSLATOR_CHUNK_BUSY_MESSAGE, 'warning');
    }
}

function getIssueTypeLabel(type) {
    if (type === TRANSLATOR_CHUNK_ISSUE_TYPES.FAILED) return 'Lỗi';
    if (type === TRANSLATOR_CHUNK_ISSUE_TYPES.MANUAL) return 'Cần dịch thủ công';
    if (type === TRANSLATOR_CHUNK_ISSUE_TYPES.PENDING) return 'Chưa dịch';
    return 'Cần xử lý';
}

function renderChunkIssuePanel(summary = null) {
    const panel = document.getElementById('chunkIssuePanel');
    if (!panel) return summary;

    const renderedChunks = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks) ? translatedChunks : [];
    const safeSummary = summary || summarizeTranslatorChunkIssues({
        chunks: renderedChunks,
        totalChunks: renderedChunks.length,
    });
    lastChunkIssueSummary = safeSummary;

    if (!safeSummary || safeSummary.issueCount === 0) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        return safeSummary;
    }

    const busy = typeof isTranslating !== 'undefined' && isTranslating;
    const source = (typeof currentSourceMode !== 'undefined' &&
        typeof TRANSLATOR_SOURCE_MODES !== 'undefined' &&
        currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE)
        ? 'large-file'
        : 'text';
    const visibleIssues = safeSummary.issues.slice(0, 24);
    const hiddenCount = Math.max(0, safeSummary.issueCount - visibleIssues.length);
    const chips = visibleIssues.map(issue => (
        `<button class="chunk-issue-chip chunk-issue-chip--${issue.type}" type="button" data-click-action="viewChunkDetail" data-chunk-index="${issue.chunkIndex}" title="${escapeHtml(getIssueTypeLabel(issue.type))}">#${issue.displayIndex}</button>`
    )).join('');
    const safetyNote = safeSummary.safetyCount > 0
        ? '<p class="chunk-issue-note chunk-issue-note--warning">Có chunk nghi bị model kiểm duyệt gắt. Hãy thử đổi sang gemini-2.5-flash, giảm kích thước chunk hoặc chỉnh prompt nếu retry vẫn lỗi.</p>'
        : '';
    const busyNote = busy
        ? '<p class="chunk-issue-note">Đang dịch. Chỉ xử lý sau khi dừng hoặc hoàn tất bản dịch để không tranh request/RPM với job chính.</p>'
        : (source === 'large-file'
            ? '<p class="chunk-issue-note">File lớn chỉ retry batch nhỏ từ phiên lưu, không đọc lại toàn truyện và không tự dịch lại toàn bộ.</p>'
            : '<p class="chunk-issue-note">Hệ thống đã thử tự khôi phục trước. Các thao tác dưới đây chỉ chạy trên chunk cần xử lý.</p>');

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="chunk-issue-card">
            <div class="chunk-issue-main">
                <div class="chunk-issue-icon">⚠️</div>
                <div>
                    <h3>Còn ${safeSummary.issueCount} chunk cần xử lý</h3>
                    <p>${safeSummary.failedCount} lỗi · ${safeSummary.manualCount} cần dịch thủ công · ${safeSummary.pendingCount} chưa dịch</p>
                </div>
            </div>
            <div class="chunk-issue-actions">
                <button class="btn btn-warning btn-small" type="button" data-click-action="retryIssueChunks" data-issue-source="${source}" ${busy ? 'disabled' : ''}>Dịch lại chunk lỗi</button>
                <button class="btn btn-secondary btn-small" type="button" data-click-action="focusFirstIssueChunk">Xem chunk lỗi</button>
                <button class="btn btn-secondary btn-small" type="button" data-click-action="downloadMarkedIssueResult">Tải bản có đánh dấu</button>
            </div>
        </div>
        <div class="chunk-issue-list">
            ${chips}
            ${hiddenCount > 0 ? `<span class="chunk-issue-more">+${hiddenCount} chunk</span>` : ''}
        </div>
        ${busyNote}
        ${safetyNote}
    `;
    return safeSummary;
}

function buildTranslatedChunksText(chunksArray, pendingLabel = '⏳ Chưa dịch') {
    if (typeof buildTranslatedTextFromChunks === 'function') {
        return buildTranslatedTextFromChunks(chunksArray, pendingLabel);
    }
    return (Array.isArray(chunksArray) ? chunksArray : [])
        .map((chunk, index) => chunk !== null && chunk !== undefined ? chunk : `[${pendingLabel} chunk ${index + 1}]`)
        .join('\n\n');
}

function getCurrentChunkIssueStartIndex() {
    return Math.max(0, Number(
        typeof translationStartChunkIndex !== 'undefined' ? translationStartChunkIndex : 0
    ) || 0);
}

function getCurrentHistoryIdForChunkUpdate() {
    if (typeof currentHistoryId !== 'undefined' && currentHistoryId) return currentHistoryId;
    if (typeof lastTranslatorHistoryId !== 'undefined' && lastTranslatorHistoryId) return lastTranslatorHistoryId;
    return null;
}

function getCurrentSourceModeForIssuePanel() {
    if (typeof currentSourceMode !== 'undefined' &&
        typeof TRANSLATOR_SOURCE_MODES !== 'undefined' &&
        currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE) {
        return 'large-file';
    }
    return 'text';
}

async function persistTranslatedChunkUpdate(chunkIndex, outputText, options = {}) {
    const safeIndex = Math.max(0, Number(chunkIndex) || 0);
    const text = String(outputText || '');
    const status = options.status || 'done';
    const error = options.error || '';

    if (typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks)) {
        translatedChunks[safeIndex] = text;
    }

    if (typeof currentTranslatorSessionId !== 'undefined' &&
        currentTranslatorSessionId &&
        typeof updateTranslatorChunkResult === 'function') {
        await updateTranslatorChunkResult(currentTranslatorSessionId, safeIndex, {
            status,
            outputText: text,
            error,
        });
    }

    const resultEl = document.getElementById('translatedText');
    const allChunks = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks) ? translatedChunks : [];
    if (resultEl) {
        if (getCurrentSourceModeForIssuePanel() === 'large-file' && typeof buildLargeFileResultPreview === 'function') {
            resultEl.value = buildLargeFileResultPreview(status === 'failed' ? '⚠️ Cần xử lý' : '✅ Hoàn thành', 60000);
        } else if (getCurrentSourceModeForIssuePanel() !== 'large-file') {
            resultEl.value = buildTranslatedChunksText(allChunks, '❌ Chunk thất bại');
        }
    }

    const historyId = getCurrentHistoryIdForChunkUpdate();
    if (historyId && typeof updateHistoryProgress === 'function') {
        const startIndex = getCurrentChunkIssueStartIndex();
        const summary = summarizeTranslatorChunkIssues({
            chunks: allChunks,
            startChunkIndex: startIndex,
            totalChunks: allChunks.length,
        });
        const scopedTotal = Math.max(0, allChunks.length - startIndex);
        const completedForHistory = Math.max(0, scopedTotal - summary.issueCount);
        const translatedText = getCurrentSourceModeForIssuePanel() === 'large-file' && typeof buildLargeFileResultPreview === 'function'
            ? buildLargeFileResultPreview(summary.issueCount > 0 ? '⚠️ Cần xử lý' : '✅ Hoàn thành', 60000)
            : buildTranslatedChunksText(allChunks, '⏳ Chưa dịch');
        const sourceChunks = Array.isArray(originalChunksRef) ? originalChunksRef.slice(startIndex) : [];
        const translatedSnapshot = allChunks.slice(startIndex);
        updateHistoryProgress(
            historyId,
            translatedText,
            getCurrentSourceModeForIssuePanel() === 'large-file' ? [] : sourceChunks,
            completedForHistory,
            getCurrentSourceModeForIssuePanel() === 'large-file' ? null : translatedSnapshot,
            typeof document !== 'undefined' ? document.getElementById('chunkSize')?.value : null,
            {
                sessionId: typeof currentTranslatorSessionId !== 'undefined' ? currentTranslatorSessionId : null,
                startChunkIndex: startIndex,
                startByte: typeof translationStartByte !== 'undefined' ? translationStartByte : 0,
            }
        );
    }

    renderChunkIssuePanel(summarizeTranslatorChunkIssues({
        chunks: allChunks,
        startChunkIndex: getCurrentChunkIssueStartIndex(),
        totalChunks: allChunks.length,
    }));
}

// ============================================
// INITIALIZE TRACKER
// ============================================
function initChunkTracker(chunks, preparedChunks, customPrompt, options = {}) {
    chunkTrackerDynamicMode = Boolean(options.dynamic);
    chunkTrackerLargeFileMode = Boolean(options.largeFile);
    chunkTrackerWindowStart = 0;
    originalChunksRef = chunks;
    preparedChunksRef = Array.isArray(preparedChunks) ? preparedChunks : null;
    customPromptRef = customPrompt;

    chunkTrackingData = chunkTrackerDynamicMode ? [] : chunks.map((chunk, i) => ({
        index: i,
        inputLen: chunk.length,
        outputLen: 0,
        ratio: 0,
        status: CHUNK_STATUS.PENDING,
        retryCount: 0,
        model: '',
        keyLabel: '',
        timeMs: 0,
        error: '',
        startTime: 0
    }));
    chunkTrackerSummaryState = {
        total: chunkTrackingData.length,
        success: 0,
        warning: 0,
        failed: 0,
        totalInput: chunkTrackingData.reduce((sum, data) => sum + data.inputLen, 0),
        totalOutput: 0,
        totalRetries: 0,
    };

    renderChunkTracker();
    showChunkTrackerPanel();
}

function trackChunkDiscovered(chunkIndex, chunkText) {
    const text = String(chunkText || '');
    if (!chunkTrackingData[chunkIndex]) {
        chunkTrackingData[chunkIndex] = {
            index: chunkIndex,
            inputLen: text.length,
            outputLen: 0,
            ratio: 0,
            status: CHUNK_STATUS.PENDING,
            retryCount: 0,
            model: '',
            keyLabel: '',
            timeMs: 0,
            error: '',
            startTime: 0,
            originalPreview: text.slice(0, 2000),
            originalTruncated: text.length > 2000,
        };
        chunkTrackerSummaryState.total = Math.max(chunkTrackerSummaryState.total, chunkIndex + 1);
        chunkTrackerSummaryState.totalInput += text.length;
    }

    if (chunkTrackerLargeFileMode) {
        originalChunksRef[chunkIndex] = text.slice(0, 2000);
    } else {
        originalChunksRef[chunkIndex] = text;
    }

    const windowState = getChunkTrackerWindowState(chunkTrackingData);
    if (chunkIndex >= windowState.start && chunkIndex < windowState.end) {
        renderChunkTracker();
    } else {
        updateChunkSummary();
    }
}

function getPreparedChunkForTracker(chunkIndex, sourceTextOverride = null) {
    if (Array.isArray(preparedChunksRef) && preparedChunksRef[chunkIndex]) {
        return preparedChunksRef[chunkIndex];
    }
    const sourceText = sourceTextOverride !== null && sourceTextOverride !== undefined
        ? String(sourceTextOverride)
        : (originalChunksRef[chunkIndex] || '');
    if (typeof buildPromptedChunk === 'function') {
        const sourceLang = document.getElementById('sourceLang')?.value || 'auto';
        const promptText = customPromptRef || document.getElementById('customPrompt')?.value || '';
        return buildPromptedChunk(promptText, sourceText, sourceLang);
    }
    return `${customPromptRef || ''}${sourceText}`;
}

function applyChunkStatus(data, nextStatus) {
    if (!data || data.status === nextStatus) return;

    if (data.status === CHUNK_STATUS.SUCCESS) chunkTrackerSummaryState.success = Math.max(0, chunkTrackerSummaryState.success - 1);
    if (data.status === CHUNK_STATUS.WARNING) chunkTrackerSummaryState.warning = Math.max(0, chunkTrackerSummaryState.warning - 1);
    if (data.status === CHUNK_STATUS.FAILED) chunkTrackerSummaryState.failed = Math.max(0, chunkTrackerSummaryState.failed - 1);

    if (nextStatus === CHUNK_STATUS.SUCCESS) chunkTrackerSummaryState.success += 1;
    if (nextStatus === CHUNK_STATUS.WARNING) chunkTrackerSummaryState.warning += 1;
    if (nextStatus === CHUNK_STATUS.FAILED) chunkTrackerSummaryState.failed += 1;

    data.status = nextStatus;
}

// ============================================
// UPDATE TRACKER EVENTS (called from engine/retry)
// ============================================
function trackChunkStart(chunkIndex) {
    if (!chunkTrackingData[chunkIndex]) return;
    applyChunkStatus(chunkTrackingData[chunkIndex], CHUNK_STATUS.TRANSLATING);
    chunkTrackingData[chunkIndex].startTime = Date.now();
    renderChunkRow(chunkIndex);
}

function trackChunkProxyKey(chunkIndex, keyIndex) {
    if (!chunkTrackingData[chunkIndex]) return;
    const normalizedKeyIndex = Number.isFinite(Number(keyIndex)) ? Number(keyIndex) : -1;
    if (normalizedKeyIndex < 0) return;
    chunkTrackingData[chunkIndex].keyLabel = String.fromCharCode(65 + normalizedKeyIndex);
    renderChunkRow(chunkIndex);
}

function trackChunkSuccess(chunkIndex, outputText, model) {
    if (!chunkTrackingData[chunkIndex]) return;
    const data = chunkTrackingData[chunkIndex];
    chunkTrackerSummaryState.totalOutput += (outputText ? outputText.length : 0) - data.outputLen;
    data.outputLen = outputText ? outputText.length : 0;
    data.ratio = data.inputLen > 0 ? Math.round((data.outputLen / data.inputLen) * 100) : 0;
    data.model = model || '';
    data.timeMs = data.startTime > 0 ? Date.now() - data.startTime : 0;

    // Determine status based on ratio
    if (data.ratio < 60) {
        applyChunkStatus(data, CHUNK_STATUS.WARNING);
    } else {
        applyChunkStatus(data, CHUNK_STATUS.SUCCESS);
    }
    data.error = '';

    renderChunkRow(chunkIndex);
    updateChunkSummary();
}

function trackChunkFailed(chunkIndex, errorMsg) {
    if (!chunkTrackingData[chunkIndex]) return;
    const data = chunkTrackingData[chunkIndex];
    applyChunkStatus(data, CHUNK_STATUS.FAILED);
    data.error = errorMsg || 'Lỗi chưa xác định';
    data.timeMs = data.startTime > 0 ? Date.now() - data.startTime : 0;

    renderChunkRow(chunkIndex);
    updateChunkSummary();
}

function trackChunkRetry(chunkIndex, attempt) {
    if (!chunkTrackingData[chunkIndex]) return;
    chunkTrackerSummaryState.totalRetries += Math.max(0, attempt - (chunkTrackingData[chunkIndex].retryCount || 0));
    chunkTrackingData[chunkIndex].retryCount = attempt;
    applyChunkStatus(chunkTrackingData[chunkIndex], CHUNK_STATUS.RETRYING);
    renderChunkRow(chunkIndex);
}

// ============================================
// RETRANSLATE SINGLE CHUNK
// ============================================
function getManualRetrySourceText(chunkIndex, options = {}) {
    if (typeof options.sourceText === 'string' && options.sourceText.length > 0) return options.sourceText;
    if (typeof originalChunksRef[chunkIndex] === 'string' && originalChunksRef[chunkIndex].length > 0) {
        return originalChunksRef[chunkIndex];
    }
    if (typeof originalChunks !== 'undefined' && Array.isArray(originalChunks) && typeof originalChunks[chunkIndex] === 'string') {
        return originalChunks[chunkIndex];
    }
    return '';
}

function buildFailedRetryOutput(chunkIndex, userMessage, sourceText) {
    const currentOutput = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks)
        ? translatedChunks[chunkIndex]
        : '';
    if (typeof currentOutput === 'string' && getChunkIssueType(null, currentOutput)) return currentOutput;
    return `[LỖI CHUNK ${chunkIndex + 1}]\nNguyên nhân: ${userMessage}\n\n${sourceText || ''}`;
}

function markChunkRetrying(chunkIndex) {
    const data = chunkTrackingData[chunkIndex];
    if (!data) return null;

    applyChunkStatus(data, CHUNK_STATUS.RETRANSLATING);
    chunkTrackerSummaryState.totalRetries = Math.max(0, chunkTrackerSummaryState.totalRetries - (data.retryCount || 0));
    data.retryCount = 0;
    data.startTime = Date.now();
    data.error = '';
    renderChunkRow(chunkIndex);
    return data;
}

function markChunkRetrySucceeded(chunkIndex, outputText, data) {
    if (!data) return;
    chunkTrackerSummaryState.totalOutput += outputText.length - data.outputLen;
    data.outputLen = outputText.length;
    data.ratio = data.inputLen > 0 ? Math.round((data.outputLen / data.inputLen) * 100) : 0;
    applyChunkStatus(data, data.ratio < 60 ? CHUNK_STATUS.WARNING : CHUNK_STATUS.SUCCESS);
    data.timeMs = data.startTime > 0 ? Date.now() - data.startTime : 0;
    data.error = '';
}

function markChunkRetryFailed(chunkIndex, userMessage, data) {
    if (!data) return;
    applyChunkStatus(data, CHUNK_STATUS.FAILED);
    data.error = userMessage;
    data.timeMs = data.startTime > 0 ? Date.now() - data.startTime : 0;
    renderChunkRow(chunkIndex);
}

async function sendManualRetryAttempt(chunkIndex, chunkText) {
    if (typeof useProxy !== 'undefined' && useProxy) {
        if (typeof sendProxyTranslationAttempt === 'function') {
            const proxyAttempt = await sendProxyTranslationAttempt({
                chunkIndex,
                text: chunkText,
                temperature: 0.7,
                kind: 'manual_retry',
            });
            return proxyAttempt.result;
        }
        const proxyKey = typeof getProxyKeyForChunk === 'function' ? await getProxyKeyForChunk(chunkIndex) : proxyApiKey;
        return translateChunkViaProxy(chunkText, 0.7, proxyKey);
    }

    if (typeof useOllama !== 'undefined' && useOllama) {
        if (typeof waitForTranslatorProviderRpmSlot === 'function' && typeof TRANSLATOR_PROVIDERS !== 'undefined') {
            await waitForTranslatorProviderRpmSlot(TRANSLATOR_PROVIDERS.OLLAMA);
        }
        if (typeof recordTranslatorRpmRequest === 'function' && typeof TRANSLATOR_PROVIDERS !== 'undefined') {
            recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.OLLAMA, 0);
        }
        return translateWithOllama(chunkText, 0.7);
    }

    const directAttempt = await sendDirectTranslationAttempt({
        chunkIndex,
        text: chunkText,
        temperature: 0.7,
        kind: 'manual_retry',
    });
    const result = directAttempt.result;
    const keyIndex = directAttempt.modelKeyPair?.keyIndex;
    if (result && !result.startsWith('[LỖI') && typeof recordKeySuccess === 'function' && Number.isFinite(Number(keyIndex))) {
        recordKeySuccess(keyIndex);
    }
    return result;
}

function createInvalidManualRetryResponseError(result) {
    if (typeof createTranslatorError === 'function') {
        return createTranslatorError('INVALID_RESPONSE_FORMAT', {
            provider: typeof useOllama !== 'undefined' && useOllama ? 'Ollama' : (typeof useProxy !== 'undefined' && useProxy ? 'Proxy' : 'Gemini'),
            rawMessage: result || 'Empty result',
            retryable: true,
        });
    }
    return new Error(result || 'Bản dịch trả về không hợp lệ.');
}

function showSafetyRetryGuidance() {
    if (typeof showToast === 'function') {
        showToast('Model đang kiểm duyệt gắt. Nếu retry vẫn lỗi, hãy thử đổi sang gemini-2.5-flash, giảm kích thước chunk hoặc chỉnh prompt. Hệ thống sẽ không tự đổi model.', 'warning');
    }
}

async function retrySingleIssueChunk(chunkIndex, options = {}) {
    const safeIndex = Math.max(0, Number(chunkIndex) || 0);
    const sourceText = getManualRetrySourceText(safeIndex, options);
    if (!sourceText) {
        if (!options.silent && typeof showToast === 'function') {
            showToast(`Không tìm thấy nguyên văn chunk ${safeIndex + 1} để dịch lại.`, 'warning');
        }
        return { ok: false, chunkIndex: safeIndex, reason: 'missing_source' };
    }

    const data = markChunkRetrying(safeIndex);
    const chunkText = getPreparedChunkForTracker(safeIndex, sourceText);

    try {
        const result = await sendManualRetryAttempt(safeIndex, chunkText);
        if (!result || result.startsWith('[LỖI')) {
            throw createInvalidManualRetryResponseError(result);
        }

        markChunkRetrySucceeded(safeIndex, result, data);
        await persistTranslatedChunkUpdate(safeIndex, result, { status: 'done', error: '' });
        renderChunkRow(safeIndex);
        updateChunkSummary();
        if (!options.silent && typeof showToast === 'function') {
            showToast(`Chunk ${safeIndex + 1} đã dịch lại thành công.`, 'success');
        }
        return { ok: true, chunkIndex: safeIndex };
    } catch (e) {
        const userMessage = typeof formatTranslatorError === 'function'
            ? formatTranslatorError(e)
            : String(e?.message || e || 'Lỗi chưa xác định');
        markChunkRetryFailed(safeIndex, userMessage, data);
        const failedOutput = buildFailedRetryOutput(safeIndex, userMessage, sourceText);
        await persistTranslatedChunkUpdate(safeIndex, failedOutput, { status: 'failed', error: userMessage });
        updateChunkSummary();
        if (isSafetyRelatedTranslatorIssue(failedOutput, userMessage)) {
            showSafetyRetryGuidance();
        }
        if (!options.silent && typeof showToast === 'function') {
            showToast(`Chunk ${safeIndex + 1} dịch lại thất bại: ${userMessage}`, 'error');
        }
        return { ok: false, chunkIndex: safeIndex, reason: userMessage };
    }
}

async function retranslateChunk(chunkIndex) {
    if (isChunkIssueActionBusy()) {
        notifyChunkIssueBusy();
        return { ok: false, reason: 'busy' };
    }

    if (chunkTrackerLargeFileMode) {
        showToast('File lớn xử lý lỗi qua nút “Dịch lại chunk lỗi” để lấy nguyên văn đầy đủ từ phiên lưu.', 'warning');
        return { ok: false, reason: 'large_file_panel_only' };
    }

    return retrySingleIssueChunk(chunkIndex);
}

// Retranslate all failed + warning chunks
async function retranslateAllFailed() {
    if (isChunkIssueActionBusy()) {
        notifyChunkIssueBusy();
        return { ok: false, reason: 'busy' };
    }

    const toRetranslate = chunkTrackingData.filter(d =>
        d.status === CHUNK_STATUS.FAILED || d.status === CHUNK_STATUS.WARNING
    );

    if (toRetranslate.length === 0) {
        showToast('Không có chunk nào cần dịch lại!', 'info');
        return;
    }

    showToast(`Đang dịch lại ${toRetranslate.length} chunk...`, 'info');

    const parallelInput = typeof document !== 'undefined' ? Number(document.getElementById('parallelCount')?.value) : 1;
    const manualParallel = typeof normalizeTranslatorParallel === 'function'
        ? normalizeTranslatorParallel(parallelInput || 1)
        : Math.max(1, Math.min(50, parallelInput || 1));

    for (let offset = 0; offset < toRetranslate.length; offset += manualParallel) {
        const batch = toRetranslate.slice(offset, offset + manualParallel);
        await Promise.all(batch.map(d => retranslateChunk(d.index)));
        if (offset + manualParallel < toRetranslate.length) {
            await sleep(5000);
        }
    }

    showToast('Đã hoàn tất dịch lại.', 'success');
    return { ok: true, attempted: toRetranslate.length };
}

function getManualRetryDefaultLimit(source, issueCount) {
    if (source !== 'large-file') return issueCount;

    const parallelInput = typeof document !== 'undefined' ? Number(document.getElementById('parallelCount')?.value) : 1;
    const normalizedParallel = typeof normalizeTranslatorParallel === 'function'
        ? normalizeTranslatorParallel(parallelInput || 1)
        : Math.max(1, Math.min(50, parallelInput || 1));
    return Math.max(1, Math.min(2, normalizedParallel, issueCount));
}

function pickRetryIssues(summary, source) {
    const issues = summary?.issues || [];
    if (source === 'large-file') {
        return issues.filter(issue => (
            issue.type === TRANSLATOR_CHUNK_ISSUE_TYPES.FAILED ||
            issue.type === TRANSLATOR_CHUNK_ISSUE_TYPES.MANUAL
        ));
    }
    return issues;
}

async function retryIssueChunks(options = {}) {
    if (isChunkIssueActionBusy()) {
        notifyChunkIssueBusy();
        return { ok: false, reason: 'busy' };
    }

    const source = options.source || getCurrentSourceModeForIssuePanel();
    const startIndex = getCurrentChunkIssueStartIndex();
    let summary;
    let sessionRows = [];

    if (source === 'large-file') {
        const sessionId = typeof currentTranslatorSessionId !== 'undefined' ? currentTranslatorSessionId : null;
        if (!sessionId || typeof getTranslatorSessionChunks !== 'function') {
            showToast('Chưa tìm thấy phiên file lớn để dịch lại chunk lỗi.', 'warning');
            return { ok: false, reason: 'missing_session' };
        }
        sessionRows = await getTranslatorSessionChunks(sessionId);
        summary = summarizeTranslatorChunkIssues({
            chunks: sessionRows,
            startChunkIndex: startIndex,
            totalChunks: sessionRows.length,
        });
    } else {
        const chunks = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks) ? translatedChunks : [];
        summary = summarizeTranslatorChunkIssues({
            chunks,
            startChunkIndex: startIndex,
            totalChunks: chunks.length,
        });
    }

    renderChunkIssuePanel(summary);
    const retryableIssues = pickRetryIssues(summary, source);
    if (retryableIssues.length === 0) {
        showToast(source === 'large-file'
            ? 'File lớn hiện không có chunk lỗi cần retry. Chunk chưa dịch sẽ được xử lý bằng resume/chạy tiếp.'
            : 'Không có chunk nào cần dịch lại.', 'info');
        return { ok: true, attempted: 0, succeeded: 0, failed: 0 };
    }

    const requestedLimit = Number(options.limit);
    const maxAttempts = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(retryableIssues.length, Math.trunc(requestedLimit))
        : getManualRetryDefaultLimit(source, retryableIssues.length);
    const issueBatch = retryableIssues.slice(0, maxAttempts);
    let succeeded = 0;
    let failed = 0;
    let safetyFailed = false;

    showToast(`Đang dịch lại ${issueBatch.length} chunk lỗi...`, 'info');
    for (const issue of issueBatch) {
        const row = source === 'large-file'
            ? sessionRows.find(item => Number(item.chunkIndex) === issue.chunkIndex)
            : null;
        const result = await retrySingleIssueChunk(issue.chunkIndex, {
            sourceText: row?.sourceText,
            silent: true,
        });
        if (result.ok) {
            succeeded += 1;
        } else {
            failed += 1;
            safetyFailed = safetyFailed || issue.safetyRelated || isSafetyRelatedTranslatorIssue('', String(result.reason || ''));
        }
    }

    if (source === 'large-file' && typeof getTranslatorSessionChunks === 'function' && typeof currentTranslatorSessionId !== 'undefined') {
        sessionRows = await getTranslatorSessionChunks(currentTranslatorSessionId);
        renderChunkIssuePanel(summarizeTranslatorChunkIssues({
            chunks: sessionRows,
            startChunkIndex: startIndex,
            totalChunks: sessionRows.length,
        }));
    }

    if (safetyFailed) showSafetyRetryGuidance();
    showToast(`Đã xử lý ${issueBatch.length} chunk: ${succeeded} thành công, ${failed} còn lỗi.`, failed > 0 ? 'warning' : 'success');
    return { ok: true, attempted: issueBatch.length, succeeded, failed };
}

function focusFirstIssueChunk() {
    const summary = lastChunkIssueSummary || renderChunkIssuePanel();
    if (!summary || summary.issueCount === 0) {
        showToast('Không còn chunk lỗi cần xem.', 'info');
        return;
    }
    viewChunkDetail(summary.firstIssueIndex);
}

function downloadMarkedIssueResult() {
    if (typeof downloadResult === 'function') {
        return downloadResult();
    }
    showToast('Chưa có chức năng tải xuống cho kết quả hiện tại.', 'warning');
    return null;
}

// ============================================
// VIEW CHUNK DETAIL (modal)
// ============================================
function viewChunkDetail(chunkIndex) {
    const data = chunkTrackingData[chunkIndex];
    if (!data) return;

    const originalText = originalChunksRef[chunkIndex] || '';
    const translatedText = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks)
        ? translatedChunks[chunkIndex] || ''
        : '';
    const statusLabel = getStatusLabel(data.status);
    const timeStr = data.timeMs > 0 ? (data.timeMs / 1000).toFixed(1) + 's' : '--';
    const safeModel = escapeHtml(data.model || '');
    const safeError = escapeHtml(data.error || '');
    const busy = isChunkIssueActionBusy();
    const actionNote = busy
        ? '<p class="chunk-detail-note">Chỉ xử lý sau khi dừng hoặc hoàn tất bản dịch.</p>'
        : (chunkTrackerLargeFileMode
            ? '<p class="chunk-detail-note">File lớn xử lý lỗi qua panel kết quả để lấy nguyên văn đầy đủ từ phiên lưu.</p>'
            : '');
    const actionButtons = chunkTrackerLargeFileMode
        ? ''
        : `
            <button class="btn btn-primary btn-small" type="button" data-click-action="retranslateChunkAndClose" data-chunk-index="${chunkIndex}" ${busy ? 'disabled' : ''}>🔄 Dịch lại chunk này</button>
            <button class="btn btn-secondary btn-small" type="button" data-click-action="editChunkManual" data-chunk-index="${chunkIndex}" ${busy ? 'disabled' : ''}>✏️ Sửa thủ công</button>
        `;

    const modal = document.getElementById('chunkDetailModal');
    const content = document.getElementById('chunkDetailContent');

    content.innerHTML = `
        <div class="chunk-detail-header">
            <h3>📋 Chunk #${chunkIndex + 1} ${statusLabel}</h3>
            <button class="btn btn-small btn-secondary" type="button" data-click-action="closeChunkDetail">✕</button>
        </div>
        <div class="chunk-detail-stats">
            <span>📥 Input: <strong>${data.inputLen.toLocaleString()}</strong> chữ</span>
            <span>📤 Output: <strong>${data.outputLen.toLocaleString()}</strong> chữ</span>
            <span>📊 Ratio: <strong class="${data.ratio < 60 ? 'ratio-warning' : 'ratio-ok'}">${data.ratio}%</strong></span>
            <span>⏱️ ${timeStr}</span>
            ${data.retryCount > 0 ? `<span>🔄 Retry: ${data.retryCount}</span>` : ''}
            ${data.model ? `<span>🤖 ${safeModel}</span>` : ''}
        </div>
        ${data.error ? `<div class="chunk-detail-error">❌ ${safeError}</div>` : ''}
        <div class="chunk-detail-texts">
            <div class="chunk-detail-col">
                <h4>📥 Nội dung gốc</h4>
                <div class="chunk-text-box">${escapeHtml(originalText).substring(0, 2000)}${originalText.length > 2000 ? '...' : ''}</div>
            </div>
            <div class="chunk-detail-col">
                <h4>📤 Bản dịch</h4>
                <div class="chunk-text-box">${translatedText ? escapeHtml(translatedText).substring(0, 2000) + (translatedText.length > 2000 ? '...' : '') : '<em>Chưa có</em>'}</div>
            </div>
        </div>
        <div class="chunk-detail-actions">
            ${actionButtons}
        </div>
        ${actionNote}
    `;

    modal.style.display = 'flex';
}

function closeChunkDetail() {
    document.getElementById('chunkDetailModal').style.display = 'none';
}

async function editChunkManual(chunkIndex) {
    if (isChunkIssueActionBusy()) {
        notifyChunkIssueBusy();
        return { ok: false, reason: 'busy' };
    }

    if (chunkTrackerLargeFileMode) {
        showToast('File lớn chưa hỗ trợ sửa thủ công từng chunk trong v1.', 'warning');
        return { ok: false, reason: 'large_file_manual_disabled' };
    }

    closeChunkDetail();
    const currentText = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks)
        ? translatedChunks[chunkIndex] || ''
        : '';
    const newText = prompt(`Sửa nội dung chunk ${chunkIndex + 1}:`, currentText);
    if (newText !== null && newText !== currentText) {
        if (typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks)) {
            translatedChunks[chunkIndex] = newText;
        }

        // Update tracking
        const data = chunkTrackingData[chunkIndex];
        markChunkRetrySucceeded(chunkIndex, newText, data);
        await persistTranslatedChunkUpdate(chunkIndex, newText, { status: 'done', error: '' });

        renderChunkRow(chunkIndex);
        updateChunkSummary();
        showToast(`Đã cập nhật chunk ${chunkIndex + 1}.`, 'success');
        return { ok: true };
    }
    return { ok: true, skipped: true };
}

// ============================================
// RENDER FUNCTIONS
// ============================================
function showChunkTrackerPanel() {
    const panel = document.getElementById('chunkTrackerPanel');
    if (panel) panel.style.display = 'block';
}

function hideChunkTrackerPanel() {
    const panel = document.getElementById('chunkTrackerPanel');
    if (panel) panel.style.display = 'none';
}

function toggleChunkTracker() {
    const body = document.getElementById('chunkTrackerBody');
    const toggle = document.getElementById('chunkTrackerToggle');
    if (!body) return;

    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? '' : 'none';
    toggle.textContent = isHidden ? '▼' : '▶';
}

function renderChunkTracker() {
    const container = document.getElementById('chunkTrackerList');
    if (!container) return;

    const rows = chunkTrackingData.filter(Boolean);
    const windowState = getChunkTrackerWindowState(rows);
    chunkTrackerWindowStart = windowState.start;
    const visibleRows = rows.filter((data) => data.index >= windowState.start && data.index < windowState.end);
    container.innerHTML = buildChunkTrackerWindowLabel(windowState, rows.length) +
        visibleRows.map((data) => buildChunkRowHtml(data)).join('');
    updateChunkSummary();
}

function isChunkTrackerSettled(status) {
    return status === CHUNK_STATUS.SUCCESS ||
        status === CHUNK_STATUS.WARNING ||
        status === CHUNK_STATUS.FAILED;
}

function isChunkTrackerActive(status) {
    return status === CHUNK_STATUS.TRANSLATING ||
        status === CHUNK_STATUS.RETRYING ||
        status === CHUNK_STATUS.RETRANSLATING;
}

function getChunkTrackerWindowState(rows) {
    const availableRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (availableRows.length === 0) {
        return {
            start: 0,
            end: CHUNK_TRACKER_RENDER_BATCH_SIZE,
            firstChunk: 0,
            lastChunk: 0,
            activeFirstChunk: 0,
            activeLastChunk: 0,
        };
    }

    const allActiveRows = availableRows.filter((data) => isChunkTrackerActive(data.status));
    const firstUnsettled = availableRows.find((data) => !isChunkTrackerSettled(data.status));
    const anchorIndex = allActiveRows.length > 0
        ? allActiveRows[0].index
        : (firstUnsettled ? firstUnsettled.index : availableRows[availableRows.length - 1].index);
    const start = Math.floor(anchorIndex / CHUNK_TRACKER_RENDER_BATCH_SIZE) * CHUNK_TRACKER_RENDER_BATCH_SIZE;
    const naturalEnd = start + CHUNK_TRACKER_RENDER_BATCH_SIZE;
    const end = allActiveRows.length > 0
        ? Math.max(naturalEnd, allActiveRows[allActiveRows.length - 1].index + 1)
        : naturalEnd;
    const windowRows = availableRows.filter((data) => data.index >= start && data.index < end);

    return {
        start,
        end,
        firstChunk: windowRows.length > 0 ? windowRows[0].index + 1 : start + 1,
        lastChunk: windowRows.length > 0 ? windowRows[windowRows.length - 1].index + 1 : start,
        activeFirstChunk: allActiveRows.length > 0 ? allActiveRows[0].index + 1 : 0,
        activeLastChunk: allActiveRows.length > 0 ? allActiveRows[allActiveRows.length - 1].index + 1 : 0,
    };
}

function buildChunkTrackerWindowLabel(windowState, totalRows) {
    if (!windowState || totalRows <= 0) return '';

    const activeLabel = windowState.activeFirstChunk > 0
        ? `Đang dịch chunk ${windowState.activeFirstChunk}-${windowState.activeLastChunk}`
        : 'Đang chờ lô tiếp theo';
    return `
        <div class="ct-window-label" id="chunkTrackerWindowLabel">
            <span>Hiển thị chunk ${windowState.firstChunk}-${windowState.lastChunk}</span>
            <strong>${activeLabel}</strong>
        </div>
    `;
}

function renderChunkRow(chunkIndex) {
    const data = chunkTrackingData[chunkIndex];
    if (!data) return;

    const windowState = getChunkTrackerWindowState(chunkTrackingData);
    if (windowState.start !== chunkTrackerWindowStart) {
        renderChunkTracker();
        return;
    }

    const row = document.getElementById(`chunk-row-${chunkIndex}`);
    if (row) {
        row.outerHTML = buildChunkRowHtml(data);
        const label = document.getElementById('chunkTrackerWindowLabel');
        if (label) {
            label.outerHTML = buildChunkTrackerWindowLabel(windowState, chunkTrackingData.filter(Boolean).length);
        }
    } else if (chunkIndex >= windowState.start && chunkIndex < windowState.end) {
        renderChunkTracker();
    }
}

function buildChunkRowHtml(data) {
    const i = data.index;
    const statusInfo = getStatusInfo(data.status);
    const ratioClass = data.ratio > 0 && data.ratio < 60 ? 'ratio-warning' : (data.ratio >= 60 ? 'ratio-ok' : '');
    const barWidth = data.status === CHUNK_STATUS.SUCCESS || data.status === CHUNK_STATUS.WARNING ? 100
        : data.status === CHUNK_STATUS.TRANSLATING || data.status === CHUNK_STATUS.RETRYING || data.status === CHUNK_STATUS.RETRANSLATING ? 50
        : 0;

    const showRetranslate = !chunkTrackerLargeFileMode &&
        (data.status === CHUNK_STATUS.FAILED || data.status === CHUNK_STATUS.WARNING);
    const retryBusy = isChunkIssueActionBusy();
    const retryLabel = data.retryCount > 0 ? ` (×${data.retryCount})` : '';

    const keyBadge = data.keyLabel ? `<span class="ct-key">🔑${data.keyLabel}</span>` : '';

    return `
        <div class="ct-row ct-${data.status}" id="chunk-row-${i}" data-click-action="viewChunkDetail" data-chunk-index="${i}">
            <span class="ct-num">#${i + 1}</span>
            <div class="ct-bar-wrap">
                <div class="ct-bar ct-bar-${data.status}" style="width:${barWidth}%"></div>
            </div>
            <span class="ct-io">${data.inputLen.toLocaleString()}→${data.outputLen > 0 ? data.outputLen.toLocaleString() : '...'}</span>
            <span class="ct-ratio ${ratioClass}">${data.ratio > 0 ? data.ratio + '%' : '--'}</span>
            <span class="ct-status">${statusInfo.icon} ${statusInfo.label}${retryLabel}</span>
            ${keyBadge}
            ${showRetranslate ? `<button class="ct-retry-btn" type="button" data-click-action="retranslateChunk" data-stop-propagation="true" data-chunk-index="${i}" title="${retryBusy ? TRANSLATOR_CHUNK_BUSY_MESSAGE : 'Dịch lại chunk này'}" ${retryBusy ? 'disabled' : ''}>🔄</button>` : ''}
        </div>
    `;
}

function getStatusInfo(status) {
    switch (status) {
        case CHUNK_STATUS.PENDING: return { icon: '⏳', label: 'Chờ' };
        case CHUNK_STATUS.TRANSLATING: return { icon: '⚡', label: 'Đang dịch' };
        case CHUNK_STATUS.SUCCESS: return { icon: '✅', label: 'OK' };
        case CHUNK_STATUS.WARNING: return { icon: '⚠️', label: 'Ngắn' };
        case CHUNK_STATUS.FAILED: return { icon: '❌', label: 'Lỗi' };
        case CHUNK_STATUS.RETRYING: return { icon: '🔄', label: 'Thử lại' };
        case CHUNK_STATUS.RETRANSLATING: return { icon: '🔄', label: 'Dịch lại' };
        default: return { icon: '❓', label: status };
    }
}

function getStatusLabel(status) {
    const info = getStatusInfo(status);
    return `${info.icon} ${info.label}`;
}

function updateChunkSummary() {
    const summary = document.getElementById('chunkTrackerSummary');
    if (!summary) return;

    const total = chunkTrackerSummaryState.total;
    const success = chunkTrackerSummaryState.success;
    const warning = chunkTrackerSummaryState.warning;
    const failed = chunkTrackerSummaryState.failed;
    const totalInput = chunkTrackerSummaryState.totalInput;
    const totalOutput = chunkTrackerSummaryState.totalOutput;
    const totalRatio = totalInput > 0 ? Math.round((totalOutput / totalInput) * 100) : 0;
    const totalRetries = chunkTrackerSummaryState.totalRetries;
    const retryBusy = isChunkIssueActionBusy();

    const ratioClass = totalRatio < 60 ? 'ratio-warning' : (totalRatio > 0 ? 'ratio-ok' : '');

    // Update badge
    const badge = document.getElementById('chunkTrackerBadge');
    if (badge) {
        badge.textContent = `${success}✅ ${warning > 0 ? warning + '⚠️ ' : ''}${failed > 0 ? failed + '❌' : ''}`;
    }

    summary.innerHTML = `
        <span>📥 ${totalInput.toLocaleString()} → 📤 ${totalOutput.toLocaleString()} chữ</span>
        <span class="${ratioClass}">📊 Tỷ lệ: <strong>${totalRatio}%</strong></span>
        <span>🔄 Thử lại: ${totalRetries}</span>
        ${!chunkTrackerLargeFileMode && (failed + warning) > 0 ? `<button class="btn btn-small btn-warning ct-retry-all-btn" type="button" data-click-action="retranslateAllFailed" title="${retryBusy ? TRANSLATOR_CHUNK_BUSY_MESSAGE : 'Dịch lại các chunk cần xử lý'}" ${retryBusy ? 'disabled' : ''}>🔄 Dịch lại ${failed + warning} lỗi</button>` : ''}
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
