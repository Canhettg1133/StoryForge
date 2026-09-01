const HAN_AUDIT_VISIBLE_ISSUE_LIMIT = 24;
const HAN_AUDIT_MEMORY_BATCH_MAX_CHUNKS = 32;
const HAN_AUDIT_MEMORY_BATCH_MAX_CHARS = 64 * 1024;
const HAN_AUDIT_PROGRESS_INTERVAL_MS = 100;
const HAN_AUDIT_CORRECTION_RULE = `MANDATORY TRANSLATION CORRECTION:
- Return a complete Vietnamese translation of the entire source chunk.
- Do not leave any Han ideograph in the output.
- Convert names and terms to Vietnamese or Sino-Vietnamese according to the current canon and prompt.
- Preserve already-correct Vietnamese prose. Do not add explanations, labels, or metadata.`;

let isHanAuditBusy = false;
let hanAuditCancelRequested = false;
let activeHanAuditWorker = null;
let activeHanAuditRequestId = '';
let activeHanAuditAbort = null;
let lastHanAuditProgressAt = 0;
let hanAuditState = {
    status: 'idle',
    issues: [],
    processedRows: 0,
    corrected: 0,
    totalToCorrect: 0,
    message: '',
};

function makeHanAuditRequestId() {
    return `han-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getHanAuditCore() {
    return typeof TranslatorHanAuditCore !== 'undefined' ? TranslatorHanAuditCore : null;
}

function getHanAuditSessionId() {
    return typeof currentTranslatorSessionId !== 'undefined' && currentTranslatorSessionId
        ? currentTranslatorSessionId
        : null;
}

function hasHanAuditMemoryOutput() {
    return typeof translatedChunks !== 'undefined'
        && Array.isArray(translatedChunks)
        && translatedChunks.some(chunk => typeof chunk === 'string' && chunk.length > 0);
}

function getHanAuditHistoryId() {
    if (typeof lastTranslatorHistoryId !== 'undefined' && lastTranslatorHistoryId) return lastTranslatorHistoryId;
    if (typeof currentHistoryId !== 'undefined' && currentHistoryId) return currentHistoryId;
    return null;
}

function isHanAuditUiVisible() {
    return typeof storyForgeTranslatorVisible === 'undefined' || storyForgeTranslatorVisible;
}

function getHanAuditHitCharCount(issues = hanAuditState.issues) {
    return (Array.isArray(issues) ? issues : []).reduce((sum, issue) => sum + Math.max(0, Number(issue.hanCount) || 0), 0);
}

function setHanAuditState(patch = {}, options = {}) {
    hanAuditState = { ...hanAuditState, ...patch };
    if (options.force || isHanAuditUiVisible()) renderHanAuditPanel();
    return hanAuditState;
}

function getHanAuditStatusText() {
    const issueCount = hanAuditState.issues.length;
    if (hanAuditState.status === 'scanning') return `\u0110ang qu\u00E9t b\u1EA3n d\u1ECBch... ${hanAuditState.processedRows.toLocaleString('vi-VN')} chunk`;
    if (hanAuditState.status === 'correcting') return `\u0110ang s\u1EEDa ${hanAuditState.corrected}/${hanAuditState.totalToCorrect} chunk...`;
    if (hanAuditState.status === 'clear') return '\u0110\u00E3 s\u1EA1ch H\u00E1n t\u1EF1.';
    if (hanAuditState.status === 'cancelled') return `\u0110\u00E3 d\u1EEBng. C\u00F2n ${issueCount} chunk c\u1EA7n xem.`;
    if (hanAuditState.status === 'failed') return hanAuditState.message || 'Kh\u00F4ng th\u1EC3 qu\u00E9t H\u00E1n t\u1EF1 l\u00FAc n\u00E0y.';
    if (issueCount > 0) return `C\u00F2n ${issueCount} chunk ch\u1EE9a ${getHanAuditHitCharCount().toLocaleString('vi-VN')} H\u00E1n t\u1EF1.`;
    return 'Qu\u00E9t H\u00E1n t\u1EF1 c\u00F2n s\u00F3t sau khi d\u1ECBch.';
}

function renderHanAuditPanel() {
    const panel = typeof document !== 'undefined' ? document.getElementById('hanAuditPanel') : null;
    if (!panel || !isHanAuditUiVisible()) return hanAuditState;
    const escape = typeof escapeHtml === 'function'
        ? escapeHtml
        : value => String(value || '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
    const escapeAttribute = typeof escapeHtmlAttribute === 'function'
        ? escapeHtmlAttribute
        : value => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    const busy = isHanAuditBusy;
    const visibleIssues = hanAuditState.issues.slice(0, HAN_AUDIT_VISIBLE_ISSUE_LIMIT);
    const hiddenCount = Math.max(0, hanAuditState.issues.length - visibleIssues.length);
    const chips = visibleIssues.map(issue => `
        <button class="han-audit-chip" type="button" data-click-action="viewHanAuditChunk" data-chunk-index="${issue.chunkIndex}" title="${escapeAttribute(issue.preview || 'Han audit issue')}">#${issue.chunkIndex + 1}</button>
    `).join('');
    const statusClass = hanAuditState.status === 'clear' ? ' is-clear' : (hanAuditState.issues.length > 0 ? ' has-issues' : '');
    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="han-audit-header${statusClass}">
            <div>
                <strong>R\u00E0 so\u00E1t H\u00E1n t\u1EF1</strong>
                <p aria-live="polite">${escape(getHanAuditStatusText())}</p>
            </div>
            <div class="han-audit-actions">
                ${busy ? '<button class="btn btn-warning btn-small" type="button" data-click-action="cancelHanAudit">D\u1EEBng</button>' : ''}
                ${!busy ? '<button class="btn btn-secondary btn-small" type="button" data-click-action="runHanAuditManual">Qu\u00E9t l\u1EA1i</button>' : ''}
                ${!busy && hanAuditState.issues.length > 0 ? '<button class="btn btn-primary btn-small" type="button" data-click-action="retryHanAuditIssues">D\u1ECBch l\u1EA1i t\u1EA5t c\u1EA3 c\u00F2n s\u00F3t</button>' : ''}
            </div>
        </div>
        ${chips ? `<div class="han-audit-chips">${chips}${hiddenCount > 0 ? `<span class="han-audit-hidden">+${hiddenCount} chunk</span>` : ''}</div>` : ''}
    `;
    return hanAuditState;
}

async function patchHanAuditSession(status, issues = hanAuditState.issues) {
    const sessionId = getHanAuditSessionId();
    if (!sessionId || typeof updateTranslatorSession !== 'function') return null;
    try {
        const updated = await updateTranslatorSession(sessionId, {
            hanAuditStatus: status,
            hanAuditHitChunks: Array.isArray(issues) ? issues.length : 0,
            hanAuditHitChars: getHanAuditHitCharCount(issues),
            hanAuditUpdatedAt: new Date().toISOString(),
        });
        if (updated && typeof currentTranslatorSessionMeta !== 'undefined') currentTranslatorSessionMeta = updated;
        return updated;
    } catch (error) {
        console.warn('[HanAudit] Cannot persist audit status.', error);
        return null;
    }
}

function createHanAuditWorkerChannel(requestId, onProgress) {
    const worker = new Worker('js/translation/han-audit-worker.js?v=1');
    let waiter = null;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        worker.terminate();
        if (activeHanAuditWorker === worker) activeHanAuditWorker = null;
        if (activeHanAuditRequestId === requestId) activeHanAuditRequestId = '';
    };
    const fail = (error) => {
        const reject = waiter?.reject;
        waiter = null;
        close();
        if (reject) reject(error);
    };
    worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.requestId !== requestId) return;
        if (message.type === 'progress') {
            onProgress?.(message);
            return;
        }
        if (!waiter || !waiter.types.has(message.type)) return;
        const resolve = waiter.resolve;
        waiter = null;
        resolve(message);
    };
    worker.onerror = event => fail(new Error(event?.message || 'Han audit worker failed'));
    const waitFor = (...types) => new Promise((resolve, reject) => {
        waiter = { types: new Set(types), resolve, reject };
    });
    activeHanAuditWorker = worker;
    activeHanAuditRequestId = requestId;
    activeHanAuditAbort = () => fail(new Error('HAN_AUDIT_CANCELLED'));
    return { worker, waitFor, close };
}

function createMemoryAuditCursor() {
    return { chunkIndex: 0, offset: 0, processedSegments: 0 };
}

function takeHanAuditBatch(cursor) {
    const chunks = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks) ? translatedChunks : [];
    const rows = [];
    let usedChars = 0;
    while (cursor.chunkIndex < chunks.length && rows.length < HAN_AUDIT_MEMORY_BATCH_MAX_CHUNKS) {
        const outputText = typeof chunks[cursor.chunkIndex] === 'string' ? chunks[cursor.chunkIndex] : '';
        if (!outputText || cursor.offset >= outputText.length) {
            cursor.chunkIndex += 1;
            cursor.offset = 0;
            continue;
        }
        const remainingBudget = HAN_AUDIT_MEMORY_BATCH_MAX_CHARS - usedChars;
        if (rows.length > 0 && remainingBudget <= 0) break;
        let end = Math.min(outputText.length, cursor.offset + Math.max(1, remainingBudget));
        if (end < outputText.length) {
            const last = outputText.charCodeAt(end - 1);
            if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
        }
        if (end <= cursor.offset) end = Math.min(outputText.length, cursor.offset + 2);
        const segment = outputText.slice(cursor.offset, end);
        rows.push({
            chunkIndex: cursor.chunkIndex,
            status: 'done',
            baseOffset: cursor.offset,
            outputText: segment,
        });
        usedChars += segment.length;
        cursor.offset = end;
        cursor.processedSegments += 1;
    }
    return {
        rows,
        done: cursor.chunkIndex >= chunks.length,
        processedSegments: cursor.processedSegments,
    };
}

function updateHanAuditProgress(processedRows) {
    const now = Date.now();
    if (now - lastHanAuditProgressAt < HAN_AUDIT_PROGRESS_INTERVAL_MS) return;
    lastHanAuditProgressAt = now;
    setHanAuditState({ processedRows: Math.max(0, Number(processedRows) || 0) });
}

async function scanHanAuditWithWorker(expectedRevision, options = {}) {
    const requestId = makeHanAuditRequestId();
    const channel = createHanAuditWorkerChannel(requestId, message => updateHanAuditProgress(message.processedRows));
    try {
        const sessionId = getHanAuditSessionId();
        const store = typeof TranslatorLocalStore !== 'undefined' ? TranslatorLocalStore : null;
        if (!options.forceMemory && sessionId && store?.DB_NAME && store?.STORES) {
            const terminalPromise = channel.waitFor('complete', 'stale', 'cancelled', 'error');
            channel.worker.postMessage({
                type: 'scan-session',
                requestId,
                dbName: store.DB_NAME,
                stores: {
                    sessions: store.STORES.SESSIONS,
                    chunks: store.STORES.CHUNKS,
                },
                sessionId,
                expectedRevision,
            });
            const terminal = await terminalPromise;
            if (terminal.type === 'error') throw new Error(terminal.message || 'Han audit worker failed');
            if (terminal.type === 'cancelled') throw new Error('HAN_AUDIT_CANCELLED');
            return { ...terminal, revisionSource: 'session' };
        }

        const readyPromise = channel.waitFor('ready');
        channel.worker.postMessage({ type: 'start-memory', requestId, expectedRevision });
        await readyPromise;
        const cursor = createMemoryAuditCursor();
        while (true) {
            if (hanAuditCancelRequested) throw new Error('HAN_AUDIT_CANCELLED');
            const batch = takeHanAuditBatch(cursor);
            if (batch.rows.length === 0) break;
            const ackPromise = channel.waitFor('batch-complete');
            channel.worker.postMessage({ type: 'scan-batch', requestId, rows: batch.rows });
            const ack = await ackPromise;
            updateHanAuditProgress(ack.processedRows);
            if (batch.done) break;
        }
        const completePromise = channel.waitFor('complete');
        channel.worker.postMessage({ type: 'finish-memory', requestId });
        return { ...(await completePromise), revisionSource: 'memory' };
    } finally {
        channel.close();
        activeHanAuditAbort = null;
    }
}

async function yieldHanAuditMainThread() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function getHanAuditMemoryRevision() {
    return Math.max(0, Number(typeof translatorOutputGeneration !== 'undefined' ? translatorOutputGeneration : 0) || 0);
}

async function scanHanAuditCooperatively(expectedRevision, options = {}) {
    const core = getHanAuditCore();
    if (!core) throw new Error('Han detector is unavailable.');
    const matches = [];
    const sessionId = getHanAuditSessionId();
    if (!options.forceMemory && sessionId && typeof scanTranslatorSessionOutputRows === 'function') {
        try {
            const summary = await scanTranslatorSessionOutputRows(sessionId, {
                maxChunks: HAN_AUDIT_MEMORY_BATCH_MAX_CHUNKS,
                maxChars: HAN_AUDIT_MEMORY_BATCH_MAX_CHARS,
                shouldStop: () => hanAuditCancelRequested,
                onBatch(rows) {
                    if (hanAuditCancelRequested) return;
                    matches.push(...core.scanHanRows(rows));
                    updateHanAuditProgress((hanAuditState.processedRows || 0) + rows.length);
                },
            });
            if (hanAuditCancelRequested || summary.cancelled) throw new Error('HAN_AUDIT_CANCELLED');
            return {
                type: summary.revision === expectedRevision ? 'complete' : 'stale',
                revision: summary.revision,
                revisionSource: 'session',
                matches: core.mergeHanMatches(matches),
                processedRows: summary.rowCount,
            };
        } catch (error) {
            if (hanAuditCancelRequested || String(error?.message || error).includes('HAN_AUDIT_CANCELLED')) throw error;
            if (!hasHanAuditMemoryOutput()) throw error;
            console.warn('[HanAudit] Session cursor unavailable; using live memory.', error);
            matches.length = 0;
        }
    }

    const memoryRevision = getHanAuditMemoryRevision();
    const cursor = createMemoryAuditCursor();
    while (true) {
        if (hanAuditCancelRequested) throw new Error('HAN_AUDIT_CANCELLED');
        const batch = takeHanAuditBatch(cursor);
        if (batch.rows.length === 0) break;
        matches.push(...core.scanHanRows(batch.rows));
        updateHanAuditProgress(batch.processedSegments);
        await yieldHanAuditMainThread();
        if (batch.done) break;
    }
    return {
        type: 'complete',
        revision: memoryRevision,
        revisionSource: 'memory',
        matches: core.mergeHanMatches(matches),
        processedRows: cursor.processedSegments,
    };
}

async function getHanAuditRevision() {
    const sessionId = getHanAuditSessionId();
    if (sessionId && typeof getTranslatorSession === 'function') {
        const session = await getTranslatorSession(sessionId);
        return Math.max(0, Number(session?.outputRevision) || 0);
    }
    return getHanAuditMemoryRevision();
}

async function runHanAuditScan(options = {}) {
    const allowWhileTranslating = options.allowWhileTranslating === true;
    const externalAuditBusy = Boolean(globalThis.isHanFileAuditBusy || globalThis.isChunkIssueRetryBusy);
    if (isHanAuditBusy || externalAuditBusy || (!allowWhileTranslating && typeof isTranslating !== 'undefined' && isTranslating)) {
        if (!options.silent && typeof showToast === 'function') showToast('H\u00E3y \u0111\u1EE3i t\u00E1c v\u1EE5 hi\u1EC7n t\u1EA1i ho\u00E0n t\u1EA5t.', 'warning');
        return { ok: false, reason: 'busy', issues: hanAuditState.issues };
    }
    const hasSession = Boolean(getHanAuditSessionId());
    const hasMemoryChunks = hasHanAuditMemoryOutput();
    if (!hasSession && !hasMemoryChunks) {
        setHanAuditState({
            status: 'failed',
            issues: [],
            message: 'B\u1EA3n l\u01B0u n\u00E0y kh\u00F4ng c\u00F2n \u00E1nh x\u1EA1 chunk \u0111\u1EC3 qu\u00E9t ch\u00EDnh x\u00E1c.',
        }, { force: true });
        return { ok: false, reason: 'missing_chunk_mapping', issues: [] };
    }

    isHanAuditBusy = true;
    if (typeof updateTranslateActionState === 'function') updateTranslateActionState();
    hanAuditCancelRequested = false;
    lastHanAuditProgressAt = 0;
    setHanAuditState({ status: 'scanning', issues: [], processedRows: 0, message: '' }, { force: true });
    await patchHanAuditSession('scanning', []);
    try {
        for (let staleAttempt = 0; staleAttempt < 2; staleAttempt += 1) {
            let forceMemory = !getHanAuditSessionId();
            let expectedRevision;
            try {
                expectedRevision = forceMemory ? getHanAuditMemoryRevision() : await getHanAuditRevision();
            } catch (error) {
                if (!hasMemoryChunks) throw error;
                forceMemory = true;
                expectedRevision = getHanAuditMemoryRevision();
                console.warn('[HanAudit] Cannot read session revision; using live memory.', error);
            }
            let result;
            if (typeof Worker === 'function') {
                try {
                    result = await scanHanAuditWithWorker(expectedRevision, { forceMemory });
                } catch (workerError) {
                    if (String(workerError?.message || workerError).includes('HAN_AUDIT_CANCELLED')) throw workerError;
                    console.warn('[HanAudit] Worker unavailable; using cooperative fallback.', workerError);
                }
            }
            if (!result) result = await scanHanAuditCooperatively(expectedRevision, { forceMemory });
            const currentRevision = result.revisionSource === 'memory'
                ? getHanAuditMemoryRevision()
                : await getHanAuditRevision();
            if (result.type === 'stale' || currentRevision !== result.revision) {
                if (staleAttempt === 0) continue;
                throw new Error('B\u1EA3n d\u1ECBch \u0111\u00E3 thay \u0111\u1ED5i trong l\u00FAc qu\u00E9t.');
            }
            const issues = Array.isArray(result.matches) ? result.matches : [];
            const status = issues.length > 0 ? 'needs-review' : 'clear';
            setHanAuditState({
                status,
                issues,
                processedRows: result.processedRows || 0,
                message: '',
            }, { force: true });
            await patchHanAuditSession(status, issues);
            return { ok: true, issues, revision: result.revision };
        }
        throw new Error('Kh\u00F4ng th\u1EC3 kh\u00F3a phi\u00EAn b\u1EA3n b\u1EA3n d\u1ECBch \u0111\u1EC3 qu\u00E9t.');
    } catch (error) {
        const cancelled = hanAuditCancelRequested || String(error?.message || error).includes('HAN_AUDIT_CANCELLED');
        const status = cancelled ? 'cancelled' : 'failed';
        setHanAuditState({ status, message: cancelled ? '' : String(error?.message || error || '') }, { force: true });
        await patchHanAuditSession(status, hanAuditState.issues);
        return { ok: false, reason: cancelled ? 'cancelled' : 'failed', error, issues: hanAuditState.issues };
    } finally {
        isHanAuditBusy = false;
        if (typeof updateTranslateActionState === 'function') updateTranslateActionState();
        activeHanAuditAbort = null;
        activeHanAuditWorker = null;
        activeHanAuditRequestId = '';
        renderHanAuditPanel();
    }
}

function runHanAuditManual() {
    return runHanAuditScan({ autoCorrect: false });
}

function cancelHanAudit() {
    hanAuditCancelRequested = true;
    if (activeHanAuditWorker && activeHanAuditRequestId) {
        activeHanAuditWorker.postMessage({ type: 'cancel', requestId: activeHanAuditRequestId });
    }
    activeHanAuditAbort?.();
    setHanAuditState({ status: 'cancelled' }, { force: true });
    return { ok: true };
}

async function getHanAuditChunkContent(chunkIndex) {
    const safeIndex = Math.max(0, Math.trunc(Number(chunkIndex) || 0));
    const sessionId = getHanAuditSessionId();
    if (sessionId && typeof getTranslatorChunk === 'function') {
        const row = await getTranslatorChunk(sessionId, safeIndex);
        if (row) {
            if (typeof hydrateTranslatorChunkKeyUsage === 'function') hydrateTranslatorChunkKeyUsage(row);
            const sourceText = typeof readTranslatorChunkSource === 'function'
                ? await readTranslatorChunkSource(sessionId, row)
                : String(row.sourceText || '');
            return { row, sourceText, outputText: String(row.outputText || '') };
        }
    }
    const sourceText = typeof originalChunksRef !== 'undefined' && typeof originalChunksRef[safeIndex] === 'string'
        ? originalChunksRef[safeIndex]
        : (typeof originalChunks !== 'undefined' && typeof originalChunks[safeIndex] === 'string' ? originalChunks[safeIndex] : '');
    const outputText = typeof translatedChunks !== 'undefined' && typeof translatedChunks[safeIndex] === 'string'
        ? translatedChunks[safeIndex]
        : '';
    return { row: null, sourceText, outputText };
}

function buildHanCorrectionRequest(sourceText) {
    const sourceLang = typeof document !== 'undefined' ? document.getElementById('sourceLang')?.value || 'auto' : 'auto';
    const promptText = typeof customPromptRef !== 'undefined' && customPromptRef
        ? customPromptRef
        : (typeof document !== 'undefined' ? document.getElementById('customPrompt')?.value || '' : '');
    const prompted = typeof buildPromptedChunk === 'function'
        ? buildPromptedChunk(promptText, sourceText, sourceLang)
        : sourceText;
    return typeof prependTranslationSystemRule === 'function'
        ? prependTranslationSystemRule(prompted, HAN_AUDIT_CORRECTION_RULE)
        : `${HAN_AUDIT_CORRECTION_RULE}\n\n${typeof prompted === 'string' ? prompted : sourceText}`;
}

async function persistHanCorrection(chunkIndex, outputText) {
    const sessionId = getHanAuditSessionId();
    if (sessionId && typeof updateTranslatorChunkResult === 'function') {
        await updateTranslatorChunkResult(sessionId, chunkIndex, {
            status: 'done',
            outputText,
            error: '',
            ...(typeof getTranslatorChunkKeyUsagePatch === 'function' ? getTranslatorChunkKeyUsagePatch(chunkIndex) : {}),
        });
    }
    if (typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks)) {
        const isLarge = typeof currentSourceMode !== 'undefined'
            && typeof TRANSLATOR_SOURCE_MODES !== 'undefined'
            && currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE;
        if (!isLarge || chunkIndex < translatedChunks.length) translatedChunks[chunkIndex] = outputText;
    }
    if (typeof bumpTranslatorOutputGeneration === 'function') bumpTranslatorOutputGeneration();
    if (typeof markChunkRetrySucceeded === 'function') {
        const trackerRow = typeof chunkTrackingData !== 'undefined' && Array.isArray(chunkTrackingData)
            ? chunkTrackingData[chunkIndex]
            : null;
        markChunkRetrySucceeded(chunkIndex, outputText, trackerRow);
    }
}

async function correctHanAuditIssue(issue, schedulingContext = null) {
    const chunkIndex = Math.max(0, Math.trunc(Number(issue?.chunkIndex) || 0));
    try {
        const content = await getHanAuditChunkContent(chunkIndex);
        if (!content.sourceText) return { ok: false, issue: { ...issue, error: 'missing_source' } };
        const request = buildHanCorrectionRequest(content.sourceText);
        const outputText = schedulingContext
            ? await translateChunkWithRetry(request, chunkIndex, 5, schedulingContext, 'retry')
            : await translateChunkWithRetry(request, chunkIndex);
        if (!outputText || String(outputText).startsWith('[L\u1ED6I')) {
            return { ok: false, issue: { ...issue, error: 'invalid_output' } };
        }
        const match = getHanAuditCore()?.scanHanInText(outputText);
        if (schedulingContext) {
            schedulingContext.check();
            await schedulingContext.serialWrite(() => persistHanCorrection(chunkIndex, outputText));
        } else await persistHanCorrection(chunkIndex, outputText);
        if (match?.hanCount > 0) return { ok: false, persisted: true, issue: { chunkIndex, ...match } };
        return { ok: true, persisted: true, chunkIndex };
    } catch (error) {
        if (schedulingContext) schedulingContext.check();
        return { ok: false, issue: { ...issue, error: String(error?.message || error || '') } };
    }
}

async function refreshHanAuditDerivedOutput(options = {}) {
    const isLarge = typeof currentSourceMode !== 'undefined'
        && typeof TRANSLATOR_SOURCE_MODES !== 'undefined'
        && currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE;
    const resultEl = typeof document !== 'undefined' ? document.getElementById('translatedText') : null;
    const chunks = typeof translatedChunks !== 'undefined' && Array.isArray(translatedChunks) ? translatedChunks : [];
    let translatedText = resultEl?.value || '';
    if (isLarge) {
        if (chunks.length > 0 && typeof buildLargeFileResultPreview === 'function') {
            translatedText = buildLargeFileResultPreview(hanAuditState.issues.length > 0 ? 'C\u00F2n H\u00E1n t\u1EF1' : 'Ho\u00E0n th\u00E0nh', 60000);
            if (resultEl) resultEl.value = translatedText;
        }
    } else if (typeof buildTranslatedChunksText === 'function') {
        translatedText = buildTranslatedChunksText(chunks, 'Chunk th\u1EA5t b\u1EA1i');
        if (resultEl) resultEl.value = translatedText;
    }

    const historyId = getHanAuditHistoryId();
    if (historyId && typeof updateHistoryProgress === 'function') {
        const sourceChunks = !isLarge && typeof originalChunksRef !== 'undefined' && Array.isArray(originalChunksRef)
            ? originalChunksRef
            : [];
        updateHistoryProgress(
            historyId,
            translatedText,
            isLarge ? [] : sourceChunks,
            Math.max(0, Number(completedChunks) || 0),
            isLarge ? null : chunks,
            typeof document !== 'undefined' ? document.getElementById('chunkSize')?.value : null,
            { sessionId: getHanAuditSessionId() }
        );
    }
    if (options.renderIssues !== false && typeof renderChunkIssuePanel === 'function') renderChunkIssuePanel();
}

function mergeHanAuditIssueLists(...groups) {
    const byChunk = new Map();
    groups.flat().forEach((issue) => {
        if (!issue || !Number.isFinite(Number(issue.chunkIndex))) return;
        byChunk.set(Math.max(0, Math.trunc(Number(issue.chunkIndex))), issue);
    });
    return Array.from(byChunk.values()).sort((a, b) => a.chunkIndex - b.chunkIndex);
}

async function retryHanAuditIssues(options = {}) {
    const schedulingContext = options.schedulingContext || null;
    const allowWhileTranslating = options.allowWhileTranslating === true;
    const deferDerivedUpdates = options.deferDerivedUpdates === true;
    const externalAuditBusy = Boolean(globalThis.isHanFileAuditBusy || globalThis.isChunkIssueRetryBusy);
    if (isHanAuditBusy || externalAuditBusy || (!allowWhileTranslating && typeof isTranslating !== 'undefined' && isTranslating)) {
        if (!options.silent && typeof showToast === 'function') showToast('H\u00E3y \u0111\u1EE3i t\u00E1c v\u1EE5 hi\u1EC7n t\u1EA1i ho\u00E0n t\u1EA5t.', 'warning');
        return { ok: false, reason: 'busy' };
    }
    const issues = Array.isArray(options.issues) ? options.issues.slice() : hanAuditState.issues.slice();
    if (issues.length === 0) return { ok: true, attempted: 0, succeeded: 0, remaining: 0 };
    const selectedIndices = new Set(issues.map(issue => Math.max(0, Math.trunc(Number(issue.chunkIndex) || 0))));
    const untouchedIssues = options.preserveUnselected === true
        ? hanAuditState.issues.filter(issue => !selectedIndices.has(Math.max(0, Math.trunc(Number(issue.chunkIndex) || 0))))
        : [];

    isHanAuditBusy = true;
    if (typeof updateTranslateActionState === 'function') updateTranslateActionState();
    hanAuditCancelRequested = false;
    const unresolved = [];
    let succeeded = 0;
    let cursor = 0;
    setHanAuditState({
        status: 'correcting',
        corrected: 0,
        totalToCorrect: issues.length,
        issues: mergeHanAuditIssueLists(untouchedIssues, issues),
        message: '',
    }, { force: true });
    await patchHanAuditSession('correcting', issues);
    try {
        const requestedParallel = schedulingContext ? schedulingContext.parallel : typeof normalizeTranslatorParallel === 'function'
            ? normalizeTranslatorParallel(document.getElementById('parallelCount')?.value || 1)
            : Math.max(1, Math.min(30, Number(document.getElementById('parallelCount')?.value) || 1));
        if (typeof TranslatorHanCorrectionRunner === 'undefined') {
            throw new Error('HAN_CORRECTION_RUNNER_UNAVAILABLE');
        }
        const runResult = await TranslatorHanCorrectionRunner.run({
            items: issues,
            requestedParallel,
            shouldCancel: () => {
                if (schedulingContext) schedulingContext.check();
                return hanAuditCancelRequested || Boolean(schedulingContext && cancelRequested);
            },
            getPlan: ({ requestedParallel: waveParallel, remainingChunks }) => (
                schedulingContext ? { capacity: Math.min(waveParallel, remainingChunks) }
                : typeof waitForTranslatorRpmBatchPlan === 'function'
                    ? waitForTranslatorRpmBatchPlan({ requestedParallel: waveParallel, remainingChunks })
                    : { capacity: Math.min(waveParallel, remainingChunks) }
            ),
            assignWave: (wave, rpmPlan) => {
                if (typeof useProxy !== 'undefined' && useProxy && typeof buildTranslatorWaveAssignments === 'function') {
                    buildTranslatorWaveAssignments(wave.map(issue => issue.chunkIndex), rpmPlan);
                }
            },
            correctItem: issue => correctHanAuditIssue(issue, schedulingContext),
            onWaveComplete: ({ processed, results }) => {
                results.forEach((result) => {
                    if (result.ok) succeeded += 1;
                    else if (result.issue) unresolved.push(result.issue);
                });
                cursor = processed;
                setHanAuditState({
                    corrected: cursor,
                    issues: mergeHanAuditIssueLists(untouchedIssues, unresolved, issues.slice(cursor)),
                });
            },
        });
        cursor = runResult.processed;
        if (cursor < issues.length) unresolved.push(...issues.slice(cursor));
        const remainingIssues = mergeHanAuditIssueLists(untouchedIssues, unresolved);
        const status = hanAuditCancelRequested
            ? 'cancelled'
            : (remainingIssues.length > 0 ? 'needs-review' : 'clear');
        setHanAuditState({
            status,
            issues: remainingIssues,
            corrected: cursor,
            totalToCorrect: issues.length,
        }, { force: true });
        await patchHanAuditSession(status, remainingIssues);
        return {
            ok: !hanAuditCancelRequested,
            attempted: cursor,
            succeeded,
            remaining: remainingIssues.length,
            reason: hanAuditCancelRequested ? 'cancelled' : undefined,
        };
    } catch (error) {
        const cancelled = hanAuditCancelRequested || String(error?.message || error).includes('TRANSLATION_CANCELLED');
        const status = cancelled ? 'cancelled' : 'failed';
        const remainingIssues = mergeHanAuditIssueLists(untouchedIssues, unresolved, issues.slice(cursor));
        setHanAuditState({
            status,
            issues: remainingIssues,
            corrected: cursor,
            totalToCorrect: issues.length,
            message: cancelled ? '' : String(error?.message || error || ''),
        }, { force: true });
        await patchHanAuditSession(status, remainingIssues);
        return {
            ok: false,
            attempted: cursor,
            succeeded,
            remaining: remainingIssues.length,
            reason: cancelled ? 'cancelled' : 'failed',
            error,
        };
    } finally {
        if (!deferDerivedUpdates) {
            try {
                await refreshHanAuditDerivedOutput({ renderIssues: !allowWhileTranslating });
            } catch (error) {
                console.warn('[HanAudit] Cannot rebuild derived output.', error);
            }
        }
        isHanAuditBusy = false;
        if (typeof updateTranslateActionState === 'function') updateTranslateActionState();
        renderHanAuditPanel();
    }
}

async function runHanAuditAfterTranslation(schedulingContext = null) {
    const scan = await runHanAuditScan({ allowWhileTranslating: true, silent: true });
    if (!scan.ok || scan.issues.length === 0) return scan;
    return retryHanAuditIssues({
        schedulingContext,
        allowWhileTranslating: true,
        deferDerivedUpdates: true,
        silent: true,
        issues: scan.issues,
    });
}

function renderHanHighlightedText(text, ranges) {
    const escape = typeof escapeHtml === 'function'
        ? escapeHtml
        : value => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    const safeText = String(text || '');
    const first = Array.isArray(ranges) ? ranges[0] : null;
    const windowStart = Math.max(0, Number(first?.start || 0) - 1000);
    const windowEnd = Math.min(safeText.length, windowStart + 3000);
    let cursor = windowStart;
    let html = windowStart > 0 ? '...' : '';
    (Array.isArray(ranges) ? ranges : []).forEach((range) => {
        const start = Math.max(windowStart, Number(range.start) || 0);
        const end = Math.min(windowEnd, Number(range.end) || 0);
        if (end <= start || start < cursor) return;
        html += escape(safeText.slice(cursor, start));
        html += `<mark class="han-audit-mark">${escape(safeText.slice(start, end))}</mark>`;
        cursor = end;
    });
    html += escape(safeText.slice(cursor, windowEnd));
    if (windowEnd < safeText.length) html += '...';
    return html;
}

async function viewHanAuditChunk(chunkIndex) {
    const safeIndex = Math.max(0, Math.trunc(Number(chunkIndex) || 0));
    const content = await getHanAuditChunkContent(safeIndex);
    if (!content.outputText) {
        if (typeof showToast === 'function') showToast(`Kh\u00F4ng t\u00ECm th\u1EA5y output chunk ${safeIndex + 1}.`, 'warning');
        return null;
    }
    const match = getHanAuditCore()?.scanHanInText(content.outputText) || { ranges: [] };
    const modal = document.getElementById('chunkDetailModal');
    const detail = document.getElementById('chunkDetailContent');
    if (!modal || !detail) return null;
    const escapedSource = typeof escapeHtml === 'function'
        ? escapeHtml(String(content.sourceText || '').slice(0, 4000))
        : renderHanHighlightedText(String(content.sourceText || '').slice(0, 4000), []);
    detail.innerHTML = `
        <div class="chunk-detail-header">
            <h3>Chunk #${safeIndex + 1} - H\u00E1n t\u1EF1 c\u00F2n s\u00F3t</h3>
            <button class="btn btn-small btn-secondary" type="button" data-click-action="closeChunkDetail">x</button>
        </div>
        <div class="chunk-detail-texts">
            <div class="chunk-detail-col"><h4>N\u1ED9i dung g\u1ED1c</h4><div class="chunk-text-box">${escapedSource}</div></div>
            <div class="chunk-detail-col"><h4>B\u1EA3n d\u1ECBch</h4><div class="chunk-text-box">${renderHanHighlightedText(content.outputText, match.ranges)}</div></div>
        </div>
        <div class="chunk-detail-actions">
            <button class="btn btn-primary btn-small" type="button" data-click-action="retryHanAuditChunk" data-chunk-index="${safeIndex}" ${isHanAuditBusy ? 'disabled' : ''}>D\u1ECBch l\u1EA1i chunk n\u00E0y</button>
        </div>
    `;
    modal.style.display = 'flex';
    return content;
}

async function retryHanAuditChunk(chunkIndex) {
    const safeIndex = Math.max(0, Math.trunc(Number(chunkIndex) || 0));
    const issue = hanAuditState.issues.find(item => item.chunkIndex === safeIndex);
    if (!issue) return { ok: false, reason: 'missing_issue' };
    if (typeof closeChunkDetail === 'function') closeChunkDetail();
    return retryHanAuditIssues({ issues: [issue], preserveUnselected: true });
}
