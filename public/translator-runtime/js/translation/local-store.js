(function registerTranslatorLocalStore(global) {
    const DB_NAME = 'NovelTranslatorLocalStore';
    const DB_VERSION = 2;
    const STORES = {
        SESSIONS: 'translationSessions',
        SOURCES: 'translationSources',
        CHUNKS: 'translationChunks',
        QUEUE: 'translationQueue',
    };
    let dbPromise = null;

    function nowIso() {
        return new Date().toISOString();
    }

    function makeId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function clipText(text, maxChars = 480) {
        const source = String(text || '').replace(/\s+/g, ' ').trim();
        if (source.length <= maxChars) return source;
        return `${source.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
    }

    function fileFingerprint(file) {
        return [
            file?.name || 'truyen.txt',
            Number(file?.size || 0),
            Number(file?.lastModified || 0),
        ].join(':');
    }

    function outputFileNameFor(fileName) {
        const name = String(fileName || 'translated_novel.txt');
        return /\.txt$/i.test(name) ? name.replace(/\.txt$/i, '_translated.txt') : `${name}_translated.txt`;
    }

    function hasIndexedDB() {
        return typeof indexedDB !== 'undefined';
    }

    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
    }

    function txDone(tx) {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        });
    }

    function openTranslatorLocalDB() {
        if (!hasIndexedDB()) {
            return Promise.reject(new Error('IndexedDB không khả dụng trên trình duyệt này.'));
        }
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
                    const sessions = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
                    sessions.createIndex('status', 'status', { unique: false });
                    sessions.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORES.SOURCES)) {
                    db.createObjectStore(STORES.SOURCES, { keyPath: 'sessionId' });
                }
                if (!db.objectStoreNames.contains(STORES.CHUNKS)) {
                    const chunks = db.createObjectStore(STORES.CHUNKS, { keyPath: 'id' });
                    chunks.createIndex('sessionId', 'sessionId', { unique: false });
                    chunks.createIndex('sessionStatus', ['sessionId', 'status'], { unique: false });
                }
                if (!db.objectStoreNames.contains(STORES.QUEUE)) {
                    const queue = db.createObjectStore(STORES.QUEUE, { keyPath: 'id' });
                    queue.createIndex('status', 'status', { unique: false });
                    queue.createIndex('position', 'position', { unique: false });
                    queue.createIndex('sessionId', 'sessionId', { unique: false });
                }
            };

            let blocked = false;
            request.onblocked = () => {
                blocked = true;
                reject(new Error('IndexedDB đang được một tab Translator cũ sử dụng. Hãy đóng tab cũ rồi tải lại trang.'));
            };
            request.onsuccess = () => {
                if (blocked) {
                    request.result.close();
                    return;
                }
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error || new Error('Không thể mở IndexedDB của Translator.'));
        });

        return dbPromise;
    }

    async function putRecord(storeName, value) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value);
        await txDone(tx);
        return value;
    }

    async function getRecord(storeName, key) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction(storeName, 'readonly');
        return requestToPromise(tx.objectStore(storeName).get(key));
    }

    async function getAllRecords(storeName) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction(storeName, 'readonly');
        return requestToPromise(tx.objectStore(storeName).getAll());
    }

    async function getAllByIndex(storeName, indexName, key) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction(storeName, 'readonly');
        return requestToPromise(tx.objectStore(storeName).index(indexName).getAll(key));
    }

    async function deleteByKey(storeName, key) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        await txDone(tx);
    }

    function withoutEmbeddedSource(session) {
        if (!session || !Object.prototype.hasOwnProperty.call(session, 'sourceBlob')) return session;
        const clean = { ...session };
        delete clean.sourceBlob;
        return clean;
    }

    async function migrateLegacySessionSource(session) {
        if (!session?.sourceBlob) return session;
        try {
            const db = await openTranslatorLocalDB();
            const tx = db.transaction([STORES.SESSIONS, STORES.SOURCES], 'readwrite');
            const cleanSession = withoutEmbeddedSource(session);
            tx.objectStore(STORES.SOURCES).put({
                sessionId: session.id,
                sourceBlob: session.sourceBlob,
                fileName: session.fileName,
                fileSize: session.fileSize,
                fileLastModified: session.fileLastModified,
                migratedAt: nowIso(),
            });
            tx.objectStore(STORES.SESSIONS).put(cleanSession);
            await txDone(tx);
            return cleanSession;
        } catch (error) {
            console.warn('Không thể migrate nguồn Translator v1; tiếp tục dùng record cũ.', error);
            return session;
        }
    }

    async function updateTranslatorSession(sessionId, patch = {}) {
        const existing = await getTranslatorSession(sessionId);
        if (!existing) return null;
        const updated = {
            ...existing,
            ...patch,
            updatedAt: nowIso(),
        };
        await putRecord(STORES.SESSIONS, updated);
        return updated;
    }

    async function getTranslatorSession(sessionId) {
        const session = await getRecord(STORES.SESSIONS, sessionId);
        return migrateLegacySessionSource(session);
    }

    async function getTranslatorSessionSource(sessionId) {
        const sourceRecord = await getRecord(STORES.SOURCES, sessionId);
        if (sourceRecord?.sourceBlob) return sourceRecord.sourceBlob;
        const legacySession = await getRecord(STORES.SESSIONS, sessionId);
        return legacySession?.sourceBlob || null;
    }

    async function getTranslatorSessionChunks(sessionId) {
        const rows = await getAllByIndex(STORES.CHUNKS, 'sessionId', sessionId);
        return rows.sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
    }

    async function getTranslatorChunk(sessionId, chunkIndex) {
        return getRecord(STORES.CHUNKS, `${sessionId}:${chunkIndex}`);
    }

    function hasTranslatorChunkOutput(chunk) {
        return typeof chunk?.outputText === 'string' && chunk.outputText.length > 0;
    }

    function summarizeTranslatorChunks(chunks, startChunkIndex = 0) {
        const safeStart = Math.max(0, Number(startChunkIndex) || 0);
        const includedChunks = Array.isArray(chunks)
            ? chunks.filter((chunk) => (
                hasTranslatorChunkOutput(chunk) ||
                (Number(chunk?.chunkIndex) >= safeStart && chunk?.status !== 'skipped')
            ))
            : [];
        const completedChunks = includedChunks.filter(hasTranslatorChunkOutput).length;
        const failedChunks = includedChunks.filter((chunk) => (
            chunk.status === 'failed' && hasTranslatorChunkOutput(chunk)
        )).length;

        return {
            completedChunks,
            failedChunks,
            totalChunks: includedChunks.length,
            isComplete: includedChunks.length > 0 && completedChunks >= includedChunks.length,
        };
    }

    async function createTranslatorSessionFromFile(file, options = {}) {
        if (!file || typeof file.slice !== 'function') {
            throw new Error('File truyện không hợp lệ.');
        }

        const createdAt = nowIso();
        const sessionId = options.sessionId || makeId('session');
        const chunkSize = typeof normalizeChunkSize === 'function'
            ? normalizeChunkSize(options.chunkSize)
            : Math.max(1, parseInt(options.chunkSize || 4500, 10) || 4500);
        const previewText = typeof options.previewText === 'string'
            ? options.previewText
            : typeof readFilePreview === 'function'
                ? await readFilePreview(file)
                : await file.slice(0, Math.min(Number(file.size || 0), 64 * 1024)).text();
        const isLarge = typeof isLargeFileCandidate === 'function' ? isLargeFileCandidate(file) : Number(file.size || 0) >= 1024 * 1024;
        const sourceBlob = typeof File !== 'undefined' && file instanceof File
            ? file
            : file.slice(0, Number(file.size || 0), file.type || 'text/plain;charset=utf-8');
        const estimate = typeof estimateChunkCountFromPreview === 'function'
            ? estimateChunkCountFromPreview({ fileSize: file.size, previewText, chunkSize })
            : { count: Math.max(1, Math.ceil(String(previewText || '').length / chunkSize)), approximate: true };
        const session = {
            id: sessionId,
            fileName: file.name || 'truyen.txt',
            outputFileName: outputFileNameFor(file.name),
            fileSize: Number(file.size || 0),
            fileLastModified: Number(file.lastModified || 0),
            fileFingerprint: fileFingerprint(file),
            sourceMode: isLarge ? 'large-file' : 'text-file',
            chunkSize,
            estimatedChunks: estimate.count,
            totalChunks: estimate.count,
            totalChunksExact: false,
            completedChunks: 0,
            failedChunks: 0,
            startChunkIndex: 0,
            startByte: 0,
            startContextText: '',
            resumeChunkIndex: 0,
            resumeByte: 0,
            resumeContextText: '',
            status: 'ready',
            isComplete: false,
            previewText,
            storyPromptText: '',
            storyPromptEnabled: false,
            storyPromptUncertainties: [],
            storyPromptUpdatedAt: null,
            storyPromptScanMeta: null,
            createdAt,
            updatedAt: createdAt,
        };

        const db = await openTranslatorLocalDB();
        const tx = db.transaction([STORES.SESSIONS, STORES.SOURCES], 'readwrite');
        tx.objectStore(STORES.SESSIONS).put(session);
        tx.objectStore(STORES.SOURCES).put({
            sessionId,
            sourceBlob,
            fileName: session.fileName,
            fileSize: session.fileSize,
            fileLastModified: session.fileLastModified,
            createdAt,
        });
        await txDone(tx);
        return session;
    }

    function normalizeChunkRow(sessionId, chunkIndex, existing, patch, timestamp) {
        const row = {
            id: `${sessionId}:${chunkIndex}`,
            sessionId,
            chunkIndex: Number(chunkIndex),
            outputText: '',
            status: 'pending',
            createdAt: existing?.createdAt || timestamp,
            ...existing,
            ...patch,
            updatedAt: timestamp,
        };
        if (!existing?.sourceText && !patch.sourceText) delete row.sourceText;
        return row;
    }

    function isFailedOutput(row) {
        return row?.status === 'failed' && hasTranslatorChunkOutput(row);
    }

    async function persistTranslatorChunkBatch(sessionId, chunkPatches = [], sessionPatch = {}) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction([STORES.SESSIONS, STORES.CHUNKS], 'readwrite');
        const sessions = tx.objectStore(STORES.SESSIONS);
        const chunks = tx.objectStore(STORES.CHUNKS);
        const existingSession = await requestToPromise(sessions.get(sessionId));
        if (!existingSession) {
            tx.abort();
            throw new Error('Không tìm thấy phiên dịch để lưu kết quả.');
        }

        const timestamp = nowIso();
        const savedRows = [];
        for (const patch of chunkPatches) {
            const chunkIndex = Math.max(0, Number(patch?.chunkIndex) || 0);
            const id = `${sessionId}:${chunkIndex}`;
            const existing = await requestToPromise(chunks.get(id));
            const updated = normalizeChunkRow(sessionId, chunkIndex, existing, patch, timestamp);
            chunks.put(updated);
            savedRows.push(updated);
        }

        const updatedSession = {
            ...existingSession,
            ...sessionPatch,
            updatedAt: timestamp,
        };
        sessions.put(updatedSession);
        await txDone(tx);
        return { session: updatedSession, chunks: savedRows };
    }

    async function updateTranslatorChunkResult(sessionId, chunkIndex, patch = {}) {
        const db = await openTranslatorLocalDB();
        const tx = db.transaction([STORES.SESSIONS, STORES.CHUNKS], 'readwrite');
        const sessions = tx.objectStore(STORES.SESSIONS);
        const chunks = tx.objectStore(STORES.CHUNKS);
        const id = `${sessionId}:${chunkIndex}`;
        const [session, existing] = await Promise.all([
            requestToPromise(sessions.get(sessionId)),
            requestToPromise(chunks.get(id)),
        ]);
        if (!session) {
            tx.abort();
            return null;
        }

        const timestamp = nowIso();
        const updated = normalizeChunkRow(sessionId, chunkIndex, existing, patch, timestamp);
        const completedDelta = Number(hasTranslatorChunkOutput(updated)) - Number(hasTranslatorChunkOutput(existing));
        const failedDelta = Number(isFailedOutput(updated)) - Number(isFailedOutput(existing));
        const completedChunks = Math.max(0, Number(session.completedChunks || 0) + completedDelta);
        const failedChunks = Math.max(0, Number(session.failedChunks || 0) + failedDelta);
        const totalChunks = Math.max(Number(session.totalChunks || 0), Number(chunkIndex) + 1);
        const isComplete = Boolean(session.totalChunksExact && totalChunks > 0 && completedChunks >= totalChunks);

        chunks.put(updated);
        sessions.put({
            ...session,
            completedChunks,
            failedChunks,
            totalChunks,
            isComplete,
            status: isComplete ? 'completed' : 'running',
            updatedAt: timestamp,
        });
        await txDone(tx);
        return updated;
    }

    async function markTranslatorChunksBefore(sessionId, startChunkIndex = 0) {
        const chunks = await getTranslatorSessionChunks(sessionId);
        const safeStart = Math.max(0, Number(startChunkIndex) || 0);
        const timestamp = nowIso();
        const changed = [];
        for (const chunk of chunks) {
            if (chunk.chunkIndex >= safeStart) continue;
            if (hasTranslatorChunkOutput(chunk)) continue;
            changed.push({
                ...chunk,
                status: 'skipped',
                outputText: '',
                updatedAt: timestamp,
            });
        }
        const changedByIndex = new Map(changed.map(chunk => [Number(chunk.chunkIndex), chunk]));
        const updatedChunks = chunks.map(chunk => changedByIndex.get(Number(chunk.chunkIndex)) || chunk);
        const summary = summarizeTranslatorChunks(updatedChunks, safeStart);
        await persistTranslatorChunkBatch(sessionId, changed, {
            completedChunks: summary.completedChunks,
            failedChunks: summary.failedChunks,
            isComplete: summary.isComplete,
        });
    }

    async function searchTranslatorSessionChunks(sessionId, query, options = {}) {
        const needle = String(query || '').trim().toLocaleLowerCase('vi-VN');
        if (!needle) return [];
        const limit = Math.max(1, Math.min(50, Number(options.limit) || 12));
        const source = await getTranslatorSessionSource(sessionId);
        const session = await getTranslatorSession(sessionId);
        if (source && typeof scanTranslatorSource === 'function') {
            const result = await scanTranslatorSource(source, query, {
                ...options,
                chunkSize: session?.chunkSize,
                limit: Math.min(12, limit),
                contextCount: 3,
            });
            return result.matches;
        }
        const chunks = await getTranslatorSessionChunks(sessionId);
        const matches = [];
        for (const chunk of chunks) {
            if (options.signal?.aborted) break;
            const haystack = String(chunk.sourceText || '').toLocaleLowerCase('vi-VN');
            const at = haystack.indexOf(needle);
            if (at === -1) continue;
            const start = Math.max(0, at - 120);
            const end = Math.min(chunk.sourceText.length, at + needle.length + 180);
            matches.push({
                sessionId,
                chunkIndex: chunk.chunkIndex,
                byteStart: chunk.byteStart,
                byteEnd: chunk.byteEnd,
                sourcePreview: clipText(chunk.sourceText.slice(start, end), 420),
            });
            if (matches.length >= limit) break;
        }
        return matches;
    }

    async function getTranslatorSessionOutputParts(sessionId, options = {}) {
        const includePending = Boolean(options.includePending);
        const chunks = await getTranslatorSessionChunks(sessionId);
        const parts = [];
        for (const chunk of chunks) {
            const hasOutput = hasTranslatorChunkOutput(chunk);
            if (!hasOutput && !includePending) continue;
            if (!hasOutput && chunk.status === 'skipped') continue;
            if (parts.length > 0) parts.push('\n\n');
            parts.push(hasOutput ? chunk.outputText : `[Chưa dịch chunk ${chunk.chunkIndex + 1}]`);
        }
        return parts;
    }

    async function getTranslatorContextBeforeChunk(sessionId, chunkIndex, count = 3) {
        const chunks = await getTranslatorSessionChunks(sessionId);
        const safeIndex = Math.max(0, Number(chunkIndex) || 0);
        return chunks
            .filter((chunk) => chunk.chunkIndex < safeIndex)
            .slice(-Math.max(0, Number(count) || 0))
            .map((chunk) => `Chunk ${chunk.chunkIndex + 1}: ${clipText(chunk.sourceText, 1200)}`)
            .join('\n\n');
    }

    async function readTranslatorChunkSource(sessionId, chunkOrIndex) {
        const chunk = typeof chunkOrIndex === 'object' && chunkOrIndex
            ? chunkOrIndex
            : await getTranslatorChunk(sessionId, chunkOrIndex);
        if (typeof chunk?.sourceText === 'string') return chunk.sourceText;
        if (!Number.isFinite(Number(chunk?.byteStart)) || !Number.isFinite(Number(chunk?.byteEnd))) return '';
        const source = await getTranslatorSessionSource(sessionId);
        if (!source) return '';
        const text = await source.slice(Number(chunk.byteStart), Number(chunk.byteEnd)).text();
        return Number(chunk.byteStart) === 0 ? text.replace(/^\uFEFF/, '') : text;
    }

    async function getLastQueuePosition() {
        const rows = await getAllRecords(STORES.QUEUE);
        return rows.reduce((max, row) => Math.max(max, Number(row.position) || 0), 0);
    }

    async function enqueueTranslatorSession(sessionId) {
        const existing = (await getAllByIndex(STORES.QUEUE, 'sessionId', sessionId))
            .find((item) => ['queued', 'running', 'paused'].includes(item.status));
        if (existing) return existing;
        const createdAt = nowIso();
        const item = {
            id: makeId('queue'),
            sessionId,
            status: 'queued',
            position: (await getLastQueuePosition()) + 1,
            createdAt,
            updatedAt: createdAt,
        };
        await putRecord(STORES.QUEUE, item);
        await updateTranslatorSession(sessionId, { status: 'queued' });
        return item;
    }

    async function getTranslatorQueueItems() {
        const rows = await getAllRecords(STORES.QUEUE);
        return rows.sort((a, b) => Number(a.position) - Number(b.position));
    }

    async function updateTranslatorQueueItemStatus(queueId, status, patch = {}) {
        const existing = await getRecord(STORES.QUEUE, queueId);
        if (!existing) return null;
        const updated = {
            ...existing,
            ...patch,
            status,
            updatedAt: nowIso(),
        };
        await putRecord(STORES.QUEUE, updated);
        const sessionPatch = { status: status === 'completed' ? 'completed' : status };
        if (status === 'completed') sessionPatch.isComplete = true;
        await updateTranslatorSession(updated.sessionId, sessionPatch);
        return updated;
    }

    async function reorderTranslatorQueueItems(orderedQueueIds = []) {
        const rows = await getTranslatorQueueItems();
        const rowById = new Map(rows.map((row) => [row.id, row]));
        const seen = new Set();
        const orderedRows = [];

        for (const queueId of orderedQueueIds) {
            if (!rowById.has(queueId) || seen.has(queueId)) continue;
            orderedRows.push(rowById.get(queueId));
            seen.add(queueId);
        }
        for (const row of rows) {
            if (seen.has(row.id)) continue;
            orderedRows.push(row);
            seen.add(row.id);
        }

        const updatedRows = [];
        for (let index = 0; index < orderedRows.length; index += 1) {
            const updated = {
                ...orderedRows[index],
                position: index + 1,
                updatedAt: nowIso(),
            };
            await putRecord(STORES.QUEUE, updated);
            updatedRows.push(updated);
        }
        return updatedRows;
    }

    async function claimNextTranslatorQueueItem() {
        const rows = await getTranslatorQueueItems();
        if (rows.some((item) => item.status === 'running')) return null;
        const next = rows.find((item) => item.status === 'queued');
        if (!next) return null;
        return updateTranslatorQueueItemStatus(next.id, 'running');
    }

    async function removeTranslatorQueueItem(queueId) {
        await deleteByKey(STORES.QUEUE, queueId);
    }

    async function clearTranslatorLocalStoreForTests() {
        if (!hasIndexedDB()) return;
        if (dbPromise) {
            const db = await dbPromise.catch(() => null);
            if (db) db.close();
            dbPromise = null;
        }
        await new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
            request.onblocked = () => resolve(false);
        });
    }

    const api = {
        DB_NAME,
        STORES,
        claimNextTranslatorQueueItem,
        clearTranslatorLocalStoreForTests,
        createTranslatorSessionFromFile,
        enqueueTranslatorSession,
        getTranslatorChunk,
        getTranslatorContextBeforeChunk,
        getTranslatorQueueItems,
        getTranslatorSession,
        getTranslatorSessionChunks,
        getTranslatorSessionSource,
        getTranslatorSessionOutputParts,
        markTranslatorChunksBefore,
        removeTranslatorQueueItem,
        readTranslatorChunkSource,
        reorderTranslatorQueueItems,
        searchTranslatorSessionChunks,
        summarizeTranslatorChunks,
        persistTranslatorChunkBatch,
        updateTranslatorChunkResult,
        updateTranslatorQueueItemStatus,
        updateTranslatorSession,
    };

    global.TranslatorLocalStore = api;
    Object.keys(api).forEach((key) => {
        if (typeof global[key] === 'undefined') {
            global[key] = api[key];
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
