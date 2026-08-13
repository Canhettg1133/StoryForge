importScripts('han-audit-core.js?v=1');

const activeRequests = new Map();

function postFor(requestId, type, payload = {}) {
    self.postMessage({ requestId, type, ...payload });
}

function isCancelled(requestId) {
    return !activeRequests.has(requestId) || activeRequests.get(requestId)?.cancelled === true;
}

function closeRequest(requestId) {
    const state = activeRequests.get(requestId);
    if (state?.db) state.db.close();
    activeRequests.delete(requestId);
}

function openAuditDatabase(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Cannot open Translator data.'));
        request.onblocked = () => reject(new Error('Translator data is locked.'));
    });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

async function readSessionRevision(db, stores, sessionId) {
    const tx = db.transaction(stores.sessions, 'readonly');
    const session = await requestResult(tx.objectStore(stores.sessions).get(sessionId));
    return Math.max(0, Number(session?.outputRevision) || 0);
}

async function scanSession(message) {
    const { requestId, dbName, stores, sessionId } = message;
    const expectedRevision = Math.max(0, Number(message.expectedRevision) || 0);
    const state = { cancelled: false, db: null };
    activeRequests.set(requestId, state);

    try {
        const db = await openAuditDatabase(dbName);
        if (isCancelled(requestId)) {
            db.close();
            return;
        }
        state.db = db;
        db.onversionchange = () => {
            state.cancelled = true;
            db.close();
        };

        const startRevision = await readSessionRevision(db, stores, sessionId);
        if (startRevision !== expectedRevision) {
            postFor(requestId, 'stale', { revision: startRevision });
            return;
        }

        const matches = [];
        let processedRows = 0;
        let lastProgressAt = 0;
        const tx = db.transaction(stores.chunks, 'readonly');
        const index = tx.objectStore(stores.chunks).index('sessionId');
        await new Promise((resolve, reject) => {
            const cursorRequest = index.openCursor(sessionId);
            cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Cannot scan Translator chunks.'));
            cursorRequest.onsuccess = () => {
                if (isCancelled(requestId)) {
                    resolve(false);
                    return;
                }
                const cursor = cursorRequest.result;
                if (!cursor) {
                    resolve(true);
                    return;
                }
                const row = cursor.value;
                if (row?.status !== 'skipped' && typeof row?.outputText === 'string' && row.outputText.length > 0) {
                    const match = self.TranslatorHanAuditCore.scanHanRow(row, processedRows);
                    if (match) matches.push(match);
                    processedRows += 1;
                    const now = Date.now();
                    if (now - lastProgressAt >= 100) {
                        lastProgressAt = now;
                        postFor(requestId, 'progress', { processedRows });
                    }
                }
                cursor.continue();
            };
        });

        if (isCancelled(requestId)) {
            postFor(requestId, 'cancelled');
            return;
        }
        const endRevision = await readSessionRevision(db, stores, sessionId);
        if (endRevision !== expectedRevision) {
            postFor(requestId, 'stale', { revision: endRevision });
            return;
        }
        postFor(requestId, 'complete', {
            matches: self.TranslatorHanAuditCore.mergeHanMatches(matches),
            revision: endRevision,
            processedRows,
        });
    } catch (error) {
        if (!isCancelled(requestId)) {
            postFor(requestId, 'error', { message: String(error?.message || error || 'Han audit failed') });
        }
    } finally {
        closeRequest(requestId);
    }
}

function startMemoryScan(message) {
    activeRequests.set(message.requestId, {
        cancelled: false,
        matches: [],
        processedRows: 0,
        expectedRevision: Math.max(0, Number(message.expectedRevision) || 0),
    });
    postFor(message.requestId, 'ready');
}

function scanMemoryBatch(message) {
    const state = activeRequests.get(message.requestId);
    if (!state || state.cancelled) return;
    const matches = self.TranslatorHanAuditCore.scanHanRows(Array.isArray(message.rows) ? message.rows : []);
    state.matches.push(...matches);
    state.processedRows += Array.isArray(message.rows) ? message.rows.length : 0;
    postFor(message.requestId, 'batch-complete', { processedRows: state.processedRows });
}

function finishMemoryScan(message) {
    const state = activeRequests.get(message.requestId);
    if (!state || state.cancelled) return;
    postFor(message.requestId, 'complete', {
        matches: self.TranslatorHanAuditCore.mergeHanMatches(state.matches),
        revision: state.expectedRevision,
        processedRows: state.processedRows,
    });
    closeRequest(message.requestId);
}

self.addEventListener('message', (event) => {
    const message = event.data || {};
    const requestId = String(message.requestId || '');
    if (!requestId) return;
    if (message.type === 'cancel') {
        const state = activeRequests.get(requestId);
        if (state) state.cancelled = true;
        return;
    }
    if (message.type === 'scan-session') {
        scanSession({ ...message, requestId });
        return;
    }
    if (message.type === 'start-memory') {
        startMemoryScan({ ...message, requestId });
        return;
    }
    if (message.type === 'scan-batch') {
        scanMemoryBatch({ ...message, requestId });
        return;
    }
    if (message.type === 'finish-memory') finishMemoryScan({ ...message, requestId });
});
