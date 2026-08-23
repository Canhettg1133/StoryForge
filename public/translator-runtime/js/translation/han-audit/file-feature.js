/**
 * Manual Han audit for an uploaded, already-translated TXT file.
 * Scan state and replacements live only for the current page session.
 */
(function attachTranslatorHanFileFeature(global) {
    'use strict';

    const ROW_HEIGHT = 54;
    const MAX_DOM_ROWS = 60;
    const DETAIL_TEXT_LIMIT = 12000;

    function computeVirtualWindow(totalRows, scrollTop, viewportHeight, options = {}) {
        const total = Math.max(0, Math.trunc(Number(totalRows) || 0));
        const rowHeight = Math.max(1, Number(options.rowHeight) || ROW_HEIGHT);
        const maxRows = Math.max(1, Math.min(MAX_DOM_ROWS, Number(options.maxRows) || MAX_DOM_ROWS));
        const overscan = Math.max(0, Math.trunc(Number(options.overscan) || 8));
        const firstVisible = Math.max(0, Math.floor((Number(scrollTop) || 0) / rowHeight));
        const visibleCount = Math.max(1, Math.ceil((Number(viewportHeight) || rowHeight) / rowHeight));
        const desiredCount = Math.min(maxRows, visibleCount + (overscan * 2));
        let start = Math.max(0, firstVisible - overscan);
        let end = Math.min(total, start + desiredCount);
        start = Math.max(0, end - desiredCount);
        return { start, end, rowHeight, totalHeight: total * rowHeight };
    }

    global.TranslatorHanFileFeatureUtils = Object.freeze({
        MAX_DOM_ROWS,
        ROW_HEIGHT,
        computeVirtualWindow,
    });

    if (!global.document) return;

    const state = {
        snapshot: null,
        scanned: false,
        issues: [],
        replacements: new Map(),
        totalHan: 0,
        totalCodePoints: 0,
        totalChunks: 0,
        selectedChunkIndex: null,
        selectedText: '',
        selectedLoadToken: 0,
        activeWorker: null,
        activeWorkerReject: null,
        activeRequestId: '',
        busyKind: '',
        cancelRequested: false,
        previousFocus: null,
        renderFrame: 0,
        revision: 0,
        operationToken: 0,
        statusMessage: '',
        statusTone: '',
        statusProgress: 0,
        statusBusy: false,
    };

    const byId = id => global.document.getElementById(id);

    function isOpen() {
        const modal = byId('hanFileAudit');
        return Boolean(modal && !modal.hidden);
    }

    function isTranslationBusy() {
        try {
            return typeof isTranslating !== 'undefined' && Boolean(isTranslating);
        } catch (_error) {
            return false;
        }
    }

    function isAutomaticAuditBusy() {
        try {
            return typeof isHanAuditBusy !== 'undefined' && Boolean(isHanAuditBusy);
        } catch (_error) {
            return false;
        }
    }

    function isChunkIssueRetryBusy() {
        return Boolean(global.isChunkIssueRetryBusy);
    }

    function isExternalTaskBusy() {
        return isTranslationBusy() || isAutomaticAuditBusy() || isChunkIssueRetryBusy();
    }

    function showMessage(message, tone = 'info') {
        if (typeof showToast === 'function') showToast(message, tone);
    }

    function renderSessionPanel() {
        const panel = byId('hanFileAuditSessionPanel');
        if (!panel) return;
        panel.hidden = !state.snapshot;
        if (!state.snapshot) return;

        const remaining = getRemainingIssues();
        const title = byId('hanFileSessionTitle');
        const file = byId('hanFileSessionFile');
        const meta = byId('hanFileSessionMeta');
        const progressWrap = byId('hanFileSessionProgress');
        const progress = byId('hanFileSessionProgressFill');
        const cancelButton = byId('cancelHanFileSessionBtn');
        const correctButton = byId('correctAllHanFileSessionBtn');
        const downloadButton = byId('downloadHanFileSessionBtn');
        const externalBusy = isExternalTaskBusy();

        if (title) {
            if (state.busyKind === 'scanning') title.textContent = 'Đang quét Hán tự trong TXT';
            else if (state.busyKind === 'correcting') title.textContent = 'Đang dịch lại các chunk còn sót';
            else if (state.scanned && remaining.length === 0) title.textContent = 'File TXT đã sạch Hán tự';
            else if (state.scanned) title.textContent = `Còn ${remaining.length.toLocaleString('vi-VN')} chunk cần xử lý`;
            else title.textContent = 'Kiểm tra Hán tự trong TXT';
        }
        if (file) {
            file.textContent = `${state.snapshot.fileName} • ${(state.snapshot.size / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MiB`;
            file.title = state.snapshot.fileName;
        }
        if (meta) {
            meta.textContent = state.statusMessage || (state.scanned
                ? `${state.totalChunks.toLocaleString('vi-VN')} chunk đã quét`
                : 'Mở chi tiết để bắt đầu quét file.');
            meta.dataset.tone = state.statusTone;
        }
        if (progressWrap) progressWrap.hidden = !state.statusBusy;
        if (progress) progress.style.transform = `scaleX(${state.statusProgress})`;
        if (cancelButton) cancelButton.hidden = !state.busyKind;
        if (correctButton) correctButton.hidden = Boolean(state.busyKind) || externalBusy || !state.scanned || remaining.length === 0;
        if (downloadButton) downloadButton.hidden = Boolean(state.busyKind) || !state.scanned;
    }

    function setStatus(message, options = {}) {
        state.statusMessage = String(message || '');
        state.statusTone = options.tone || '';
        state.statusBusy = Boolean(options.busy);
        state.statusProgress = Math.max(0, Math.min(1, Number(options.progress) || 0));
        const status = byId('hanFileAuditStatus');
        if (status) {
            status.textContent = String(message || '');
            status.dataset.tone = options.tone || '';
        }
        const progressWrap = byId('hanFileAuditProgress');
        const progress = byId('hanFileAuditProgressFill');
        if (progressWrap) progressWrap.hidden = !options.busy;
        if (progress) {
            progress.style.transform = `scaleX(${state.statusProgress})`;
        }
        renderSessionPanel();
    }

    function setBusy(kind = '') {
        state.busyKind = kind;
        global.isHanFileAuditBusy = Boolean(kind);
        const busy = Boolean(kind);
        const cancelButton = byId('cancelHanFileBtn');
        if (cancelButton) cancelButton.hidden = !busy;
        const closeButton = byId('closeHanFileAuditBtn');
        if (closeButton) closeButton.setAttribute('aria-label', 'Đóng chi tiết');
        if (typeof updateTranslateActionState === 'function') updateTranslateActionState();
        renderActions();
        renderSessionPanel();
    }

    function terminateWorker(reason = '') {
        const reject = state.activeWorkerReject;
        if (state.activeWorker) state.activeWorker.terminate();
        state.activeWorker = null;
        state.activeWorkerReject = null;
        state.activeRequestId = '';
        if (reason && typeof reject === 'function') reject(new Error(reason));
    }

    function getIssue(chunkIndex) {
        const safeIndex = Math.max(0, Math.trunc(Number(chunkIndex) || 0));
        return state.issues.find(issue => issue.chunkIndex === safeIndex) || null;
    }

    function getSelectedPosition() {
        return state.issues.findIndex(issue => issue.chunkIndex === state.selectedChunkIndex);
    }

    function getRemainingIssues() {
        return state.issues.filter(issue => issue.status !== 'corrected');
    }

    function issueStatusLabel(issue) {
        if (issue?.status === 'corrected') return 'Đã sạch';
        if (issue?.status === 'correcting') return 'Đang dịch';
        if (issue?.status === 'unresolved') return 'Vẫn còn Hán tự';
        if (issue?.status === 'failed') return 'Lỗi';
        return `${Math.max(0, Number(issue?.hanCount) || 0).toLocaleString('vi-VN')} Hán tự`;
    }

    function renderSummary() {
        const summary = byId('hanFileAuditSummary');
        const meta = byId('hanFileAuditMeta');
        const count = byId('hanFileAuditIssueCount');
        const layout = byId('hanFileAuditLayout');
        const warning = byId('hanFileAuditWarning');
        const remaining = getRemainingIssues();
        if (summary) {
            if (!state.scanned) summary.textContent = 'Chưa quét file.';
            else if (state.issues.length === 0) summary.textContent = 'Không phát hiện Hán tự còn sót.';
            else summary.textContent = `${state.totalHan.toLocaleString('vi-VN')} Hán tự trong ${state.issues.length.toLocaleString('vi-VN')} chunk.`;
        }
        if (meta) {
            meta.textContent = state.scanned
                ? `${remaining.length.toLocaleString('vi-VN')} chunk còn cần xử lý • ${state.totalChunks.toLocaleString('vi-VN')} chunk đã quét`
                : 'Công cụ chỉ dùng cho TXT đã dịch hoặc convert.';
        }
        if (count) count.textContent = `${state.issues.length.toLocaleString('vi-VN')} chunk`;
        if (layout) layout.hidden = !state.scanned || state.issues.length === 0;

        const density = state.totalCodePoints > 0 ? state.totalHan / state.totalCodePoints : 0;
        if (warning) {
            warning.hidden = density < 0.1;
            warning.textContent = density >= 0.1
                ? 'Tỷ lệ Hán tự từ 10% trở lên. File này có thể là truyện Trung gốc; vẫn có thể tiếp tục nếu đây đúng là bản dịch cần sửa.'
                : '';
        }
        renderSessionPanel();
    }

    function renderActions() {
        const busy = Boolean(state.busyKind) || isExternalTaskBusy();
        const remaining = getRemainingIssues();
        const selected = getIssue(state.selectedChunkIndex);
        const correctAll = byId('correctAllHanFileBtn');
        const correctOne = byId('correctOneHanFileBtn');
        const download = byId('downloadHanFileBtn');
        if (correctAll) correctAll.disabled = busy || !state.scanned || remaining.length === 0;
        if (correctOne) correctOne.disabled = busy || !selected || selected.status === 'corrected';
        if (download) download.disabled = Boolean(state.busyKind) || !state.scanned;
        renderSessionPanel();
    }

    function renderIssueRows() {
        if (!isOpen()) return;
        const viewport = byId('hanFileAuditIssueViewport');
        const canvas = byId('hanFileAuditIssueCanvas');
        if (!viewport || !canvas) return;
        const virtual = computeVirtualWindow(
            state.issues.length,
            viewport.scrollTop,
            viewport.clientHeight || 420,
            { rowHeight: ROW_HEIGHT, maxRows: MAX_DOM_ROWS }
        );
        const fragment = global.document.createDocumentFragment();
        for (let index = virtual.start; index < virtual.end; index += 1) {
            const issue = state.issues[index];
            const button = global.document.createElement('button');
            button.type = 'button';
            button.className = 'han-file-audit__issue-row';
            if (issue.chunkIndex === state.selectedChunkIndex) button.classList.add('is-active');
            if (issue.status === 'corrected') button.classList.add('is-corrected');
            button.dataset.clickAction = 'selectHanFileIssue';
            button.dataset.chunkIndex = String(issue.chunkIndex);
            button.style.transform = `translateY(${index * ROW_HEIGHT}px)`;

            const title = global.document.createElement('strong');
            title.textContent = `Chunk ${issue.chunkIndex + 1}`;
            const label = global.document.createElement('span');
            label.textContent = issueStatusLabel(issue);
            button.append(title, label);
            fragment.appendChild(button);
        }
        canvas.style.height = `${virtual.totalHeight}px`;
        canvas.replaceChildren(fragment);
    }

    function scheduleIssueRows() {
        if (!isOpen()) return;
        if (state.renderFrame) return;
        const schedule = global.requestAnimationFrame || (callback => global.setTimeout(callback, 16));
        state.renderFrame = schedule(() => {
            state.renderFrame = 0;
            renderIssueRows();
        });
    }

    function renderDetailShell() {
        if (!isOpen()) return;
        const issue = getIssue(state.selectedChunkIndex);
        const position = getSelectedPosition();
        const title = byId('hanFileAuditChunkTitle');
        const status = byId('hanFileAuditChunkState');
        const current = byId('hanFileAuditPosition');
        const previous = byId('previousHanFileIssueBtn');
        const next = byId('nextHanFileIssueBtn');
        if (title) title.textContent = issue ? `Chunk ${issue.chunkIndex + 1}` : 'Chọn một chunk';
        if (status) status.textContent = issue ? issueStatusLabel(issue) : '';
        if (current) current.textContent = position >= 0 ? `${position + 1} / ${state.issues.length}` : `0 / ${state.issues.length}`;
        if (previous) previous.disabled = position <= 0;
        if (next) next.disabled = position < 0 || position >= state.issues.length - 1;
        renderActions();
    }

    async function loadSelectedText(issue) {
        const token = ++state.selectedLoadToken;
        const target = byId('hanFileAuditChunkText');
        if (target) target.textContent = 'Đang đọc chunk đã chọn…';
        try {
            const text = await global.TranslatorHanFileSource.readEffectiveChunk(
                state.snapshot,
                issue,
                state.replacements
            );
            if (token !== state.selectedLoadToken || issue.chunkIndex !== state.selectedChunkIndex) return;
            state.selectedText = String(text || '');
            const visibleText = state.selectedText.slice(0, DETAIL_TEXT_LIMIT);
            const match = global.TranslatorHanAuditCore.scanHanInText(visibleText);
            const highlighted = typeof renderHanHighlightedText === 'function'
                ? renderHanHighlightedText(visibleText, match.ranges)
                : visibleText.replace(/[&<>"']/g, character => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
                }[character]));
            if (target) {
                target.innerHTML = highlighted;
                if (state.selectedText.length > visibleText.length) {
                    const note = global.document.createElement('p');
                    note.textContent = 'Chunk rất dài nên phần xem trước đã được giới hạn để giữ giao diện mượt.';
                    target.appendChild(note);
                }
            }
        } catch (error) {
            if (token !== state.selectedLoadToken) return;
            state.selectedText = '';
            if (target) target.textContent = 'Không thể đọc chunk này. Hãy chọn lại hoặc quét lại file.';
            console.warn('[HanFileAudit] Cannot read selected chunk.', error);
        }
    }

    async function selectIssue(chunkIndex) {
        const issue = getIssue(chunkIndex);
        if (!issue) return;
        state.selectedChunkIndex = issue.chunkIndex;
        state.selectedText = '';
        renderIssueRows();
        renderDetailShell();
        await loadSelectedText(issue);
    }

    function selectRelativeIssue(offset) {
        const position = getSelectedPosition();
        if (position < 0) return;
        const nextPosition = Math.max(0, Math.min(state.issues.length - 1, position + Math.trunc(Number(offset) || 0)));
        const issue = state.issues[nextPosition];
        if (issue) selectIssue(issue.chunkIndex);
    }

    function makeRequestId() {
        return `han-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function scanWithWorker(snapshot) {
        return new Promise((resolve, reject) => {
            const requestId = makeRequestId();
            const worker = new global.Worker('js/translation/han-audit-worker.js?v=2');
            state.activeWorker = worker;
            state.activeWorkerReject = reject;
            state.activeRequestId = requestId;
            const cleanup = () => {
                worker.terminate();
                if (state.activeWorker === worker) state.activeWorker = null;
                if (state.activeWorkerReject === reject) state.activeWorkerReject = null;
                if (state.activeRequestId === requestId) state.activeRequestId = '';
            };
            worker.addEventListener('message', (event) => {
                const message = event.data || {};
                if (message.requestId !== requestId || state.activeRequestId !== requestId) return;
                if (message.type === 'progress') {
                    const progress = message.progress || {};
                    setStatus(`Đang quét… ${Math.round((Number(progress.ratio) || 0) * 100)}%`, {
                        busy: true,
                        progress: progress.ratio,
                    });
                    return;
                }
                cleanup();
                if (message.type === 'complete') resolve(message);
                else if (message.type === 'cancelled') reject(new Error('HAN_FILE_AUDIT_CANCELLED'));
                else reject(new Error(message.message || 'Không thể quét file TXT.'));
            });
            worker.addEventListener('error', (event) => {
                cleanup();
                reject(new Error(event?.message || 'Worker quét Hán tự đã dừng.'));
            });
            try {
                worker.postMessage({
                    type: 'scan-file',
                    requestId,
                    blob: snapshot.blob,
                    fileName: snapshot.fileName,
                    chunkSize: snapshot.chunkSize,
                    lastModified: snapshot.lastModified,
                    revision: snapshot.revision,
                });
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    async function scan() {
        if (!state.snapshot || state.busyKind) return { ok: false, reason: 'busy' };
        const operationToken = state.operationToken;
        const snapshot = state.snapshot;
        state.cancelRequested = false;
        state.scanned = false;
        state.issues = [];
        state.replacements = new Map();
        state.selectedChunkIndex = null;
        const issueViewport = byId('hanFileAuditIssueViewport');
        if (issueViewport) issueViewport.scrollTop = 0;
        setBusy('scanning');
        setStatus('Đang quét file theo từng lát 256 KiB…', { busy: true, progress: 0 });
        renderSummary();
        try {
            if (typeof global.Worker !== 'function') {
                throw new Error('Trình duyệt không hỗ trợ Worker để quét file an toàn.');
            }
            const result = await scanWithWorker(snapshot);
            if (operationToken !== state.operationToken || snapshot !== state.snapshot) {
                throw new Error('HAN_FILE_AUDIT_STALE');
            }
            if (state.cancelRequested || result.cancelled) throw new Error('HAN_FILE_AUDIT_CANCELLED');
            state.scanned = true;
            state.issues = Array.isArray(result.issues) ? result.issues : [];
            state.totalHan = Math.max(0, Number(result.totalHan) || 0);
            state.totalCodePoints = Math.max(0, Number(result.totalCodePoints) || 0);
            state.totalChunks = Math.max(0, Number(result.totalChunks) || 0);
            renderSummary();
            renderIssueRows();
            if (state.issues.length > 0) {
                state.selectedChunkIndex = state.issues[0].chunkIndex;
                if (isOpen()) await selectIssue(state.selectedChunkIndex);
            }
            setStatus(
                state.issues.length > 0
                    ? `Đã quét xong. Có ${state.issues.length.toLocaleString('vi-VN')} chunk cần xem.`
                    : 'Đã quét xong. File không còn Hán tự.',
                { tone: state.issues.length > 0 ? 'info' : 'success' }
            );
            return { ok: true, issues: state.issues.slice() };
        } catch (error) {
            if (operationToken !== state.operationToken) return { ok: false, reason: 'stale' };
            const cancelled = state.cancelRequested || String(error?.message || error).includes('HAN_FILE_AUDIT_CANCELLED');
            setStatus(cancelled ? 'Đã dừng quét. Bấm mở lại để quét từ đầu.' : 'Không thể quét file. Hãy thử tải lại TXT.', {
                tone: cancelled ? 'info' : 'error',
            });
            if (!cancelled) console.error('[HanFileAudit] Scan failed.', error);
            return { ok: false, reason: cancelled ? 'cancelled' : 'failed', error };
        } finally {
            if (operationToken === state.operationToken) {
                setBusy('');
                renderSummary();
            }
        }
    }

    async function correctItem(issue, operation) {
        if (operation.token !== state.operationToken || operation.snapshot !== state.snapshot) {
            return { ok: false, issue, stale: true };
        }
        const previousStatus = issue.status;
        const previousError = issue.error;
        issue.status = 'correcting';
        issue.error = '';
        renderIssueRows();
        renderDetailShell();
        try {
            const inputText = await global.TranslatorHanFileSource.readEffectiveChunk(
                operation.snapshot,
                issue,
                operation.replacements
            );
            if (state.cancelRequested || operation.token !== state.operationToken) throw new Error('TRANSLATION_CANCELLED');
            const request = buildHanCorrectionRequest(inputText);
            const outputText = await translateChunkWithRetry(request, issue.chunkIndex);
            if (state.cancelRequested || operation.token !== state.operationToken) throw new Error('TRANSLATION_CANCELLED');
            if (!outputText || String(outputText).startsWith('[LỖI')) {
                throw new Error('invalid_output');
            }
            const match = global.TranslatorHanAuditCore.scanHanInText(outputText);
            operation.replacements.set(
                issue.chunkIndex,
                global.TranslatorHanFileSource.createReplacement(issue, outputText)
            );
            issue.hanCount = match.hanCount;
            issue.status = match.hanCount > 0 ? 'unresolved' : 'corrected';
            issue.error = '';
            return { ok: match.hanCount === 0, issue };
        } catch (error) {
            const cancelled = state.cancelRequested
                || operation.token !== state.operationToken
                || String(error?.message || error).includes('TRANSLATION_CANCELLED');
            if (cancelled) {
                issue.status = previousStatus;
                issue.error = previousError;
                return { ok: false, issue, cancelled: true };
            }
            issue.status = 'failed';
            issue.error = String(error?.message || error || 'correction_failed');
            return { ok: false, issue, error };
        }
    }

    async function correctIssues(issues) {
        if (!state.scanned || state.busyKind || !Array.isArray(issues) || issues.length === 0) {
            return { ok: false, reason: 'empty-or-busy' };
        }
        if (isTranslationBusy() || isAutomaticAuditBusy() || isChunkIssueRetryBusy()) {
            showMessage('Hãy đợi tác vụ dịch hoặc rà soát tự động hoàn tất.', 'warning');
            return { ok: false, reason: 'busy' };
        }
        state.cancelRequested = false;
        try {
            if (typeof cancelRequested !== 'undefined') cancelRequested = false;
        } catch (_error) {
            // Older embedded runtimes may not expose the translation cancellation flag.
        }
        setBusy('correcting');
        setStatus(`Đang dịch lại 0/${issues.length} chunk…`, { busy: true, progress: 0 });
        const operation = {
            token: state.operationToken,
            snapshot: state.snapshot,
            replacements: state.replacements,
        };
        try {
            const requestedParallel = typeof normalizeTranslatorParallel === 'function'
                ? normalizeTranslatorParallel(byId('parallelCount')?.value || 1)
                : Math.max(1, Math.min(30, Number(byId('parallelCount')?.value) || 1));
            const runner = global.TranslatorCorrectionRunner || global.TranslatorHanCorrectionRunner;
            if (!runner?.run) throw new Error('Không tìm thấy wave runner để sửa Hán tự.');
            const runResult = await runner.run({
                items: issues,
                requestedParallel,
                shouldCancel: () => state.cancelRequested || operation.token !== state.operationToken,
                getPlan: ({ requestedParallel: parallel, remainingChunks }) => (
                    typeof waitForTranslatorRpmBatchPlan === 'function'
                        ? waitForTranslatorRpmBatchPlan({ requestedParallel: parallel, remainingChunks })
                        : { capacity: Math.min(parallel, remainingChunks) }
                ),
                assignWave: (wave, plan) => {
                    if (typeof useProxy !== 'undefined' && useProxy && typeof buildTranslatorWaveAssignments === 'function') {
                        buildTranslatorWaveAssignments(wave.map(issue => issue.chunkIndex), plan);
                    }
                },
                correctItem: issue => correctItem(issue, operation),
                onWaveComplete: ({ processed }) => {
                    if (operation.token !== state.operationToken) return;
                    renderSummary();
                    renderIssueRows();
                    renderDetailShell();
                    setStatus(`Đang dịch lại ${processed}/${issues.length} chunk…`, {
                        busy: true,
                        progress: processed / issues.length,
                    });
                },
            });
            if (operation.token !== state.operationToken) return { ok: false, reason: 'stale' };
            if (state.selectedChunkIndex !== null && isOpen()) await selectIssue(state.selectedChunkIndex);
            const remaining = getRemainingIssues();
            const cancelled = state.cancelRequested || runResult.cancelled;
            setStatus(
                cancelled
                    ? `Đã dừng. Các chunk hoàn tất vẫn được giữ; còn ${remaining.length} chunk cần xử lý.`
                    : (remaining.length > 0
                        ? `Đã xong lượt sửa. Còn ${remaining.length} chunk cần xem hoặc thử lại.`
                        : 'Đã sửa sạch toàn bộ Hán tự phát hiện được.'),
                { tone: !cancelled && remaining.length === 0 ? 'success' : 'info' }
            );
            return { ok: !cancelled, processed: runResult.processed, remaining: remaining.length };
        } catch (error) {
            if (operation.token !== state.operationToken) return { ok: false, reason: 'stale' };
            const cancelled = state.cancelRequested || String(error?.message || error).includes('TRANSLATION_CANCELLED');
            setStatus(cancelled ? 'Đã dừng sửa. Kết quả hoàn tất vẫn được giữ.' : 'Không thể hoàn tất lượt sửa. Có thể thử lại các chunk lỗi.', {
                tone: cancelled ? 'info' : 'error',
            });
            if (!cancelled) console.error('[HanFileAudit] Correction failed.', error);
            return { ok: false, reason: cancelled ? 'cancelled' : 'failed', error };
        } finally {
            if (operation.token === state.operationToken) {
                setBusy('');
                renderSummary();
                renderIssueRows();
                renderDetailShell();
            }
        }
    }

    function correctAll() {
        return correctIssues(getRemainingIssues());
    }

    function correctOne(chunkIndex = state.selectedChunkIndex) {
        const issue = getIssue(chunkIndex);
        return issue ? correctIssues([issue]) : Promise.resolve({ ok: false, reason: 'missing' });
    }

    function cancel() {
        if (!state.busyKind) return;
        state.cancelRequested = true;
        terminateWorker('HAN_FILE_AUDIT_CANCELLED');
        if (state.busyKind === 'correcting') {
            try {
                if (typeof cancelRequested !== 'undefined') cancelRequested = true;
            } catch (_error) {
                // Ignore runtimes without the shared flag.
            }
            if (typeof abortActiveTranslationRequests === 'function') abortActiveTranslationRequests('han-file-audit-cancelled');
        }
        setStatus('Đang dừng tác vụ…', { busy: true });
    }

    function download() {
        if (!state.snapshot || !state.scanned || state.busyKind) return;
        const unresolvedCount = getRemainingIssues().length;
        const output = global.TranslatorHanFileSource.buildOutputBlob(state.snapshot, state.replacements);
        const fileName = global.TranslatorHanFileSource.makeOutputFileName(state.snapshot, unresolvedCount);
        if (typeof downloadBlobParts === 'function') {
            downloadBlobParts(
                [output],
                fileName,
                unresolvedCount > 0 ? 'Đã tải bản sửa tạm; các chunk chưa sạch vẫn giữ nguyên hoặc giữ lần sửa mới nhất.' : 'Đã tải TXT đã sửa Hán tự.'
            );
        }
    }

    function revealDetails() {
        global.TranslatorChapterFeature?.close();
        const modal = byId('hanFileAudit');
        if (!isOpen()) state.previousFocus = global.document.activeElement;
        if (modal) modal.hidden = false;
        global.document.body?.classList.add('han-file-audit-open');
        renderSummary();
        renderIssueRows();
        renderDetailShell();
        byId('closeHanFileAuditBtn')?.focus();
    }

    async function open() {
        if (state.snapshot && (state.busyKind || state.scanned)) {
            revealDetails();
            if (state.selectedChunkIndex !== null && !state.selectedText) await selectIssue(state.selectedChunkIndex);
            return { ok: true, cached: true, busy: Boolean(state.busyKind), issues: state.issues.slice() };
        }
        if (isExternalTaskBusy()) {
            showMessage('Hãy đợi tác vụ dịch hoặc rà soát hiện tại hoàn tất.', 'warning');
            return { ok: false, reason: 'busy' };
        }
        if (typeof getCurrentTranslatorSource !== 'function') {
            showMessage('Không tìm thấy file TXT đang chọn.', 'warning');
            return { ok: false, reason: 'missing-source' };
        }
        let source;
        try {
            source = await getCurrentTranslatorSource();
        } catch (error) {
            console.warn('[HanFileAudit] Cannot read current source.', error);
        }
        if (!source?.slice || !Number.isFinite(Number(source.size))) {
            showMessage('Hãy tải một file TXT đã dịch hoặc convert trước khi quét.', 'warning');
            return { ok: false, reason: 'missing-source' };
        }

        revealDetails();

        const fileName = String(source.name || (
            typeof currentTranslatorSessionMeta !== 'undefined' && currentTranslatorSessionMeta?.fileName
        ) || byId('fileName')?.textContent || 'ban-dich.txt');
        const chunkSize = typeof getCurrentChunkSizeValue === 'function'
            ? getCurrentChunkSizeValue()
            : Math.max(1, Number(byId('chunkSize')?.value) || 4500);
        const sameSnapshot = state.snapshot
            && state.snapshot.blob === source
            && state.snapshot.chunkSize === chunkSize
            && state.snapshot.fileName === fileName;
        if (!sameSnapshot) {
            state.operationToken += 1;
            state.revision += 1;
            state.snapshot = await global.TranslatorHanFileSource.createSnapshot(source, {
                fileName,
                chunkSize,
                lastModified: source.lastModified,
                revision: state.revision,
            });
            state.scanned = false;
            state.issues = [];
            state.replacements = new Map();
            state.totalHan = 0;
            state.totalCodePoints = 0;
            state.totalChunks = 0;
            state.selectedChunkIndex = null;
        }

        const name = byId('hanFileAuditFileName');
        if (name) name.textContent = `${state.snapshot.fileName} • ${(state.snapshot.size / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MiB`;
        renderSummary();
        renderIssueRows();
        renderDetailShell();
        if (!state.scanned) return scan();
        if (state.selectedChunkIndex !== null) await selectIssue(state.selectedChunkIndex);
        return { ok: true, cached: true, issues: state.issues.slice() };
    }

    function close() {
        const modal = byId('hanFileAudit');
        if (modal) modal.hidden = true;
        global.document.body?.classList.remove('han-file-audit-open');
        const focusTarget = state.previousFocus;
        state.previousFocus = null;
        if (focusTarget && typeof focusTarget.focus === 'function' && focusTarget.isConnected !== false) focusTarget.focus();
    }

    function reset() {
        state.operationToken += 1;
        cancel();
        terminateWorker();
        close();
        state.snapshot = null;
        state.scanned = false;
        state.issues = [];
        state.replacements = new Map();
        state.totalHan = 0;
        state.totalCodePoints = 0;
        state.totalChunks = 0;
        state.selectedChunkIndex = null;
        state.selectedLoadToken += 1;
        state.selectedText = '';
        state.cancelRequested = false;
        state.statusMessage = '';
        state.statusTone = '';
        state.statusProgress = 0;
        state.statusBusy = false;
        setBusy('');
        renderSummary();
        renderIssueRows();
        renderDetailShell();
    }

    function trapFocus(event) {
        if (!isOpen()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const modal = byId('hanFileAudit');
        const focusable = Array.from(modal?.querySelectorAll(
            'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []).filter(element => !element.hidden && element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && global.document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && global.document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    byId('hanFileAuditIssueViewport')?.addEventListener('scroll', scheduleIssueRows, { passive: true });
    global.addEventListener('resize', scheduleIssueRows, { passive: true });
    global.document.addEventListener('keydown', trapFocus);
    global.isHanFileAuditBusy = false;

    global.TranslatorHanFileFeature = Object.freeze({
        cancel,
        close,
        correctAll,
        correctOne,
        download,
        open,
        previous: () => selectRelativeIssue(-1),
        next: () => selectRelativeIssue(1),
        reset,
        scan,
        selectIssue,
    });
}(typeof globalThis !== 'undefined' ? globalThis : window));
