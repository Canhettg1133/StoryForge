(function registerTranslatorLocalStore(global) {
    const DB_NAME = 'NovelTranslatorLocalStore';
    const DB_VERSION = 1;
    const STORES = {
        SESSIONS: 'translationSessions',
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

            request.onsuccess = () => resolve(request.result);
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

    async function updateTranslatorSession(sessionId, patch = {}) {
        const existing = await getRecord(STORES.SESSIONS, sessionId);
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
        return getRecord(STORES.SESSIONS, sessionId);
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
        if (typeof createLazyChunkReader !== 'function') {
            throw new Error('Bộ đọc file lớn chưa sẵn sàng.');
        }

        const createdAt = nowIso();
        const sessionId = options.sessionId || makeId('session');
        const chunkSize = typeof normalizeChunkSize === 'function'
            ? normalizeChunkSize(options.chunkSize)
            : Math.max(1, parseInt(options.chunkSize || 4500, 10) || 4500);
        const previewText = typeof readFilePreview === 'function'
            ? await readFilePreview(file)
            : await file.slice(0, Math.min(Number(file.size || 0), 64 * 1024)).text();
        const isLarge = typeof isLargeFileCandidate === 'function' ? isLargeFileCandidate(file) : Number(file.size || 0) >= 1024 * 1024;
        let session = {
            id: sessionId,
            fileName: file.name || 'truyen.txt',
            outputFileName: outputFileNameFor(file.name),
            fileSize: Number(file.size || 0),
            fileLastModified: Number(file.lastModified || 0),
            fileFingerprint: fileFingerprint(file),
            sourceMode: isLarge ? 'large-file' : 'text-file',
            sourceBlob: file,
            chunkSize,
            totalChunks: 0,
            completedChunks: 0,
            failedChunks: 0,
            startChunkIndex: 0,
            startByte: 0,
            status: 'ready',
            isComplete: false,
            previewText,
            createdAt,
            updatedAt: createdAt,
        };
        await putRecord(STORES.SESSIONS, session);

        let count = 0;
        for await (const chunk of createLazyChunkReader(file, {
            chunkSize,
            windowBytes: options.windowBytes,
            minWindowBytes: options.minWindowBytes,
        })) {
            const row = {
                id: `${sessionId}:${chunk.index}`,
                sessionId,
                chunkIndex: chunk.index,
                byteStart: chunk.byteStart,
                byteEnd: chunk.byteEnd,
                sourceText: chunk.text,
                sourcePreview: clipText(chunk.text),
                outputText: '',
                status: 'pending',
                createdAt,
                updatedAt: createdAt,
            };
            await putRecord(STORES.CHUNKS, row);
            count += 1;
        }

        session = await updateTranslatorSession(sessionId, {
            totalChunks: count,
            status: 'ready',
        });
        return session;
    }

    async function updateTranslatorChunkResult(sessionId, chunkIndex, patch = {}) {
        const id = `${sessionId}:${chunkIndex}`;
        const existing = await getRecord(STORES.CHUNKS, id);
        if (!existing) return null;
        const updated = {
            ...existing,
            ...patch,
            updatedAt: nowIso(),
        };
        await putRecord(STORES.CHUNKS, updated);

        const chunks = await getTranslatorSessionChunks(sessionId);
        const session = await getTranslatorSession(sessionId);
        const summary = summarizeTranslatorChunks(chunks, session?.startChunkIndex || 0);
        await updateTranslatorSession(sessionId, {
            completedChunks: summary.completedChunks,
            failedChunks: summary.failedChunks,
            isComplete: summary.isComplete,
            status: summary.isComplete ? 'completed' : 'running',
        });
        return updated;
    }

    async function markTranslatorChunksBefore(sessionId, startChunkIndex = 0) {
        const chunks = await getTranslatorSessionChunks(sessionId);
        const safeStart = Math.max(0, Number(startChunkIndex) || 0);
        for (const chunk of chunks) {
            if (chunk.chunkIndex >= safeStart) continue;
            if (hasTranslatorChunkOutput(chunk)) continue;
            await putRecord(STORES.CHUNKS, {
                ...chunk,
                status: 'skipped',
                outputText: '',
                updatedAt: nowIso(),
            });
        }
        const updatedChunks = await getTranslatorSessionChunks(sessionId);
        const summary = summarizeTranslatorChunks(updatedChunks, safeStart);
        await updateTranslatorSession(sessionId, {
            completedChunks: summary.completedChunks,
            failedChunks: summary.failedChunks,
            isComplete: summary.isComplete,
        });
    }

    async function searchTranslatorSessionChunks(sessionId, query, options = {}) {
        const needle = String(query || '').trim().toLocaleLowerCase('vi-VN');
        if (!needle) return [];
        const limit = Math.max(1, Math.min(50, Number(options.limit) || 12));
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
        await updateTranslatorSession(updated.sessionId, {
            status: status === 'completed' ? 'completed' : status,
            isComplete: status === 'completed' ? true : undefined,
        });
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
        getTranslatorSessionOutputParts,
        markTranslatorChunksBefore,
        removeTranslatorQueueItem,
        reorderTranslatorQueueItems,
        searchTranslatorSessionChunks,
        summarizeTranslatorChunks,
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
