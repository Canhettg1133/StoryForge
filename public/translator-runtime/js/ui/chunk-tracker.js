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
let chunkTrackerSummaryState = {
    total: 0,
    success: 0,
    warning: 0,
    failed: 0,
    totalInput: 0,
    totalOutput: 0,
    totalRetries: 0,
};

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

// ============================================
// INITIALIZE TRACKER
// ============================================
function initChunkTracker(chunks, preparedChunks, customPrompt) {
    originalChunksRef = chunks;
    preparedChunksRef = Array.isArray(preparedChunks) ? preparedChunks : null;
    customPromptRef = customPrompt;

    chunkTrackingData = chunks.map((chunk, i) => ({
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

function getPreparedChunkForTracker(chunkIndex) {
    if (Array.isArray(preparedChunksRef) && preparedChunksRef[chunkIndex]) {
        return preparedChunksRef[chunkIndex];
    }
    return `${customPromptRef || ''}${originalChunksRef[chunkIndex] || ''}`;
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

function trackChunkSuccess(chunkIndex, outputText, model) {
    if (!chunkTrackingData[chunkIndex]) return;
    const data = chunkTrackingData[chunkIndex];
    chunkTrackerSummaryState.totalOutput += (outputText ? outputText.length : 0) - data.outputLen;
    data.outputLen = outputText ? outputText.length : 0;
    data.ratio = data.inputLen > 0 ? Math.round((data.outputLen / data.inputLen) * 100) : 0;
    data.model = model || '';
    data.timeMs = data.startTime > 0 ? Date.now() - data.startTime : 0;

    // Track which proxy key was used
    if (useProxy && typeof getProxyKeyForChunk === 'function' && typeof getProxyKeyCount === 'function' && getProxyKeyCount() > 1) {
        const keyIndex = chunkIndex % getProxyKeyCount();
        data.keyLabel = String.fromCharCode(65 + keyIndex); // A, B, C...
    }

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
    data.error = errorMsg || 'Unknown error';
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
async function retranslateChunk(chunkIndex) {
    if (!originalChunksRef[chunkIndex] || isTranslating) {
        showToast('Không thể dịch lại lúc này!', 'warning');
        return;
    }

    const data = chunkTrackingData[chunkIndex];
    applyChunkStatus(data, CHUNK_STATUS.RETRANSLATING);
    chunkTrackerSummaryState.totalRetries = Math.max(0, chunkTrackerSummaryState.totalRetries - (data.retryCount || 0));
    data.retryCount = 0;
    data.startTime = Date.now();
    data.error = '';
    renderChunkRow(chunkIndex);

    const chunkText = getPreparedChunkForTracker(chunkIndex);

    try {
        let result;
        if (useProxy) {
            const proxyKey = typeof getProxyKeyForChunk === 'function' ? getProxyKeyForChunk(chunkIndex) : proxyApiKey;
            result = await translateChunkViaProxy(chunkText, 0.7, proxyKey);
        } else if (useOllama) {
            result = await translateWithOllama(chunkText, 0.7);
        } else {
            const modelKeyPair = getNextModelKeyPair();
            result = await translateChunk(chunkText, modelKeyPair, 0.7);
            if (result && !result.startsWith('[LỖI')) {
                recordKeySuccess(modelKeyPair.keyIndex);
            }
        }

        if (result && !result.startsWith('[LỖI')) {
            // Success — update tracking
            chunkTrackerSummaryState.totalOutput += result.length - data.outputLen;
            data.outputLen = result.length;
            data.ratio = data.inputLen > 0 ? Math.round((data.outputLen / data.inputLen) * 100) : 0;
            applyChunkStatus(data, data.ratio < 60 ? CHUNK_STATUS.WARNING : CHUNK_STATUS.SUCCESS);
            data.timeMs = Date.now() - data.startTime;
            data.error = '';

            // Update translatedChunks array and textarea
            translatedChunks[chunkIndex] = result;
            document.getElementById('translatedText').value = translatedChunks
                .map((c, i) => c !== null ? c : `[❌ Chunk ${i + 1} thất bại]`)
                .join('\n\n');

            showToast(`✅ Chunk ${chunkIndex + 1} đã dịch lại thành công!`, 'success');
        } else {
            throw new Error(result || 'Empty result');
        }
    } catch (e) {
        applyChunkStatus(data, CHUNK_STATUS.FAILED);
        data.error = e.message;
        data.timeMs = Date.now() - data.startTime;
        showToast(`❌ Chunk ${chunkIndex + 1} dịch lại thất bại: ${e.message}`, 'error');
    }

    renderChunkRow(chunkIndex);
    updateChunkSummary();
}

// Retranslate all failed + warning chunks
async function retranslateAllFailed() {
    const toRetranslate = chunkTrackingData.filter(d =>
        d.status === CHUNK_STATUS.FAILED || d.status === CHUNK_STATUS.WARNING
    );

    if (toRetranslate.length === 0) {
        showToast('Không có chunk nào cần dịch lại!', 'info');
        return;
    }

    showToast(`🔄 Đang dịch lại ${toRetranslate.length} chunks...`, 'info');

    if (useProxy && typeof getProxyKeyCount === 'function' && getProxyKeyCount() > 1) {
        // Multi-key: group by key, send different-key chunks in parallel
        const keyCount = getProxyKeyCount();
        const byKey = {};
        for (const data of toRetranslate) {
            const k = data.index % keyCount;
            if (!byKey[k]) byKey[k] = [];
            byKey[k].push(data);
        }

        // Process round-robin: pick 1 from each key group per round
        let done = false;
        let round = 0;
        while (!done) {
            done = true;
            const batch = [];
            for (const k in byKey) {
                if (round < byKey[k].length) {
                    batch.push(byKey[k][round]);
                    done = false;
                }
            }
            if (batch.length > 0) {
                await Promise.all(batch.map(d => retranslateChunk(d.index)));
                await sleep(5000); // Delay between rounds
            }
            round++;
        }
    } else {
        // Single key: sequential
        for (const data of toRetranslate) {
            await retranslateChunk(data.index);
            await sleep(5000);
        }
    }

    showToast(`✅ Đã hoàn tất dịch lại!`, 'success');
}

// ============================================
// VIEW CHUNK DETAIL (modal)
// ============================================
function viewChunkDetail(chunkIndex) {
    const data = chunkTrackingData[chunkIndex];
    if (!data) return;

    const originalText = originalChunksRef[chunkIndex] || '';
    const translatedText = translatedChunks[chunkIndex] || '';
    const statusLabel = getStatusLabel(data.status);
    const timeStr = data.timeMs > 0 ? (data.timeMs / 1000).toFixed(1) + 's' : '--';

    const modal = document.getElementById('chunkDetailModal');
    const content = document.getElementById('chunkDetailContent');

    content.innerHTML = `
        <div class="chunk-detail-header">
            <h3>📋 Chunk #${chunkIndex + 1} ${statusLabel}</h3>
            <button class="btn btn-small btn-secondary" onclick="closeChunkDetail()">✕</button>
        </div>
        <div class="chunk-detail-stats">
            <span>📥 Input: <strong>${data.inputLen.toLocaleString()}</strong> chữ</span>
            <span>📤 Output: <strong>${data.outputLen.toLocaleString()}</strong> chữ</span>
            <span>📊 Ratio: <strong class="${data.ratio < 60 ? 'ratio-warning' : 'ratio-ok'}">${data.ratio}%</strong></span>
            <span>⏱️ ${timeStr}</span>
            ${data.retryCount > 0 ? `<span>🔄 Retry: ${data.retryCount}</span>` : ''}
            ${data.model ? `<span>🤖 ${data.model}</span>` : ''}
        </div>
        ${data.error ? `<div class="chunk-detail-error">❌ ${data.error}</div>` : ''}
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
            <button class="btn btn-primary btn-small" onclick="retranslateChunk(${chunkIndex}); closeChunkDetail();">🔄 Dịch lại chunk này</button>
            <button class="btn btn-secondary btn-small" onclick="editChunkManual(${chunkIndex})">✏️ Sửa thủ công</button>
        </div>
    `;

    modal.style.display = 'flex';
}

function closeChunkDetail() {
    document.getElementById('chunkDetailModal').style.display = 'none';
}

function editChunkManual(chunkIndex) {
    closeChunkDetail();
    const currentText = translatedChunks[chunkIndex] || '';
    const newText = prompt(`Sửa nội dung chunk ${chunkIndex + 1}:`, currentText);
    if (newText !== null && newText !== currentText) {
        translatedChunks[chunkIndex] = newText;

        // Update tracking
        const data = chunkTrackingData[chunkIndex];
        chunkTrackerSummaryState.totalOutput += newText.length - data.outputLen;
        data.outputLen = newText.length;
        data.ratio = data.inputLen > 0 ? Math.round((data.outputLen / data.inputLen) * 100) : 0;
        applyChunkStatus(data, data.ratio < 60 ? CHUNK_STATUS.WARNING : CHUNK_STATUS.SUCCESS);
        data.error = '';

        // Update textarea
        document.getElementById('translatedText').value = translatedChunks
            .map((c, i) => c !== null ? c : `[❌ Chunk ${i + 1} thất bại]`)
            .join('\n\n');

        renderChunkRow(chunkIndex);
        updateChunkSummary();
        showToast(`✅ Đã cập nhật chunk ${chunkIndex + 1}`, 'success');
    }
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

    container.innerHTML = chunkTrackingData.map((data, i) => buildChunkRowHtml(data)).join('');
    updateChunkSummary();
}

function renderChunkRow(chunkIndex) {
    const data = chunkTrackingData[chunkIndex];
    if (!data) return;

    const row = document.getElementById(`chunk-row-${chunkIndex}`);
    if (row) {
        row.outerHTML = buildChunkRowHtml(data);
    }
}

function buildChunkRowHtml(data) {
    const i = data.index;
    const statusInfo = getStatusInfo(data.status);
    const ratioClass = data.ratio > 0 && data.ratio < 60 ? 'ratio-warning' : (data.ratio >= 60 ? 'ratio-ok' : '');
    const barWidth = data.status === CHUNK_STATUS.SUCCESS || data.status === CHUNK_STATUS.WARNING ? 100
        : data.status === CHUNK_STATUS.TRANSLATING || data.status === CHUNK_STATUS.RETRYING || data.status === CHUNK_STATUS.RETRANSLATING ? 50
        : 0;

    const showRetranslate = data.status === CHUNK_STATUS.FAILED || data.status === CHUNK_STATUS.WARNING;
    const retryLabel = data.retryCount > 0 ? ` (×${data.retryCount})` : '';

    const keyBadge = data.keyLabel ? `<span class="ct-key">🔑${data.keyLabel}</span>` : '';

    return `
        <div class="ct-row ct-${data.status}" id="chunk-row-${i}" onclick="viewChunkDetail(${i})">
            <span class="ct-num">#${i + 1}</span>
            <div class="ct-bar-wrap">
                <div class="ct-bar ct-bar-${data.status}" style="width:${barWidth}%"></div>
            </div>
            <span class="ct-io">${data.inputLen.toLocaleString()}→${data.outputLen > 0 ? data.outputLen.toLocaleString() : '...'}</span>
            <span class="ct-ratio ${ratioClass}">${data.ratio > 0 ? data.ratio + '%' : '--'}</span>
            <span class="ct-status">${statusInfo.icon} ${statusInfo.label}${retryLabel}</span>
            ${keyBadge}
            ${showRetranslate ? `<button class="ct-retry-btn" onclick="event.stopPropagation(); retranslateChunk(${i});" title="Dịch lại chunk này">🔄</button>` : ''}
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
        case CHUNK_STATUS.RETRYING: return { icon: '🔄', label: 'Retry' };
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

    const ratioClass = totalRatio < 60 ? 'ratio-warning' : (totalRatio > 0 ? 'ratio-ok' : '');

    // Update badge
    const badge = document.getElementById('chunkTrackerBadge');
    if (badge) {
        badge.textContent = `${success}✅ ${warning > 0 ? warning + '⚠️ ' : ''}${failed > 0 ? failed + '❌' : ''}`;
    }

    summary.innerHTML = `
        <span>📥 ${totalInput.toLocaleString()} → 📤 ${totalOutput.toLocaleString()} chữ</span>
        <span class="${ratioClass}">📊 Ratio: <strong>${totalRatio}%</strong></span>
        <span>🔄 Retry: ${totalRetries}</span>
        ${(failed + warning) > 0 ? `<button class="btn btn-small btn-warning ct-retry-all-btn" onclick="retranslateAllFailed()">🔄 Dịch lại ${failed + warning} lỗi</button>` : ''}
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
