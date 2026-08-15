(function registerTranslatorHanFileSource(global) {
    'use strict';

    const sourceReader = global.TranslatorLargeFileSource;
    const auditCore = global.TranslatorHanAuditCore;
    const SCAN_WINDOW_BYTES = 256 * 1024;
    const PROGRESS_INTERVAL_MS = 250;
    const COUNT_ONLY_SCAN_OPTIONS = Object.freeze({ collectRanges: false });
    if (!sourceReader?.createLazyChunkReader) {
        throw new Error('TranslatorLargeFileSource must load before Han file source.');
    }
    if (!auditCore?.scanHanInText) {
        throw new Error('TranslatorHanAuditCore must load before Han file source.');
    }

    function isBlobLike(value) {
        return Boolean(value
            && typeof value.slice === 'function'
            && typeof value.arrayBuffer === 'function'
            && Number.isFinite(Number(value.size)));
    }

    async function detectBomBytes(blob) {
        if (blob.size < 3) return 0;
        const bytes = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
        return bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 3 : 0;
    }

    async function createSnapshot(blob, options = {}) {
        if (!isBlobLike(blob)) throw new TypeError('Nguồn quét Hán tự phải là file TXT hợp lệ.');
        const chunkSize = sourceReader.normalizeChunkSize(options.chunkSize);
        return Object.freeze({
            blob,
            fileName: String(options.fileName || blob.name || 'ban-dich.txt'),
            size: Math.max(0, Number(blob.size) || 0),
            lastModified: Math.max(0, Number(options.lastModified ?? blob.lastModified) || 0),
            chunkSize,
            revision: Math.max(0, Number(options.revision) || 0),
            bomBytes: await detectBomBytes(blob),
        });
    }

    async function scanSnapshot(snapshot, options = {}) {
        if (!snapshot || !isBlobLike(snapshot.blob)) throw new TypeError('Snapshot quét Hán tự không hợp lệ.');
        const issues = [];
        let totalHan = 0;
        let totalCodePoints = 0;
        let totalChunks = 0;
        let bytesRead = 0;
        let lastProgressAt = 0;
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const shouldCancel = typeof options.shouldCancel === 'function' ? options.shouldCancel : () => false;

        for await (const chunk of sourceReader.createLazyChunkReader(snapshot.blob, {
            chunkSize: snapshot.chunkSize,
            windowBytes: SCAN_WINDOW_BYTES,
            cooperative: false,
        })) {
            if (shouldCancel()) {
                return { issues, totalHan, totalCodePoints, totalChunks, bytesRead, cancelled: true };
            }
            const match = auditCore.scanHanInText(chunk.text, COUNT_ONLY_SCAN_OPTIONS);
            totalHan += match.hanCount;
            totalCodePoints += match.codePointCount;
            totalChunks += 1;
            bytesRead = chunk.byteEnd;
            if (match.hanCount > 0) {
                issues.push({
                    chunkIndex: chunk.index,
                    byteStart: chunk.byteStart,
                    byteEnd: chunk.byteEnd,
                    hanCount: match.hanCount,
                    status: 'pending',
                    error: '',
                });
            }
            if (typeof options.onProgress === 'function') {
                const timestamp = now();
                if (bytesRead >= snapshot.size || timestamp - lastProgressAt >= PROGRESS_INTERVAL_MS) {
                    lastProgressAt = timestamp;
                    options.onProgress({
                        bytesRead,
                        totalBytes: snapshot.size,
                        ratio: snapshot.size > 0 ? bytesRead / snapshot.size : 1,
                        totalChunks,
                    });
                }
            }
        }

        if (snapshot.size === 0 && typeof options.onProgress === 'function') {
            options.onProgress({ bytesRead: 0, totalBytes: 0, ratio: 1, totalChunks: 0 });
        }
        return {
            issues,
            totalHan,
            totalCodePoints,
            totalChunks,
            bytesRead: snapshot.size === 0 ? 0 : bytesRead,
            cancelled: false,
        };
    }

    function getOriginalChunkStart(snapshot, issue) {
        const start = Math.max(0, Number(issue?.byteStart) || 0);
        return start === 0 ? Math.min(snapshot.bomBytes, Number(issue?.byteEnd) || 0) : start;
    }

    async function readOriginalChunk(snapshot, issue) {
        const start = getOriginalChunkStart(snapshot, issue);
        const end = Math.max(start, Math.min(snapshot.size, Number(issue?.byteEnd) || 0));
        return snapshot.blob.slice(start, end).text();
    }

    async function readEffectiveChunk(snapshot, issue, replacements) {
        const replacement = replacements instanceof Map ? replacements.get(Number(issue?.chunkIndex)) : null;
        if (replacement?.blob && typeof replacement.blob.text === 'function') return replacement.blob.text();
        return readOriginalChunk(snapshot, issue);
    }

    function createReplacement(issue, outputText) {
        const byteStart = Math.max(0, Number(issue?.byteStart) || 0);
        const byteEnd = Math.max(byteStart, Number(issue?.byteEnd) || byteStart);
        return Object.freeze({
            chunkIndex: Math.max(0, Math.trunc(Number(issue?.chunkIndex) || 0)),
            byteStart,
            byteEnd,
            blob: new Blob([String(outputText || '')], { type: 'text/plain;charset=utf-8' }),
        });
    }

    function buildOutputBlob(snapshot, replacements) {
        if (!snapshot || !isBlobLike(snapshot.blob)) throw new TypeError('Snapshot xuất TXT không hợp lệ.');
        const ordered = replacements instanceof Map
            ? Array.from(replacements.values()).filter(item => item?.blob).sort((a, b) => a.byteStart - b.byteStart)
            : [];
        const parts = [];
        let cursor = 0;
        for (const replacement of ordered) {
            const start = Math.max(cursor, Math.min(snapshot.size, Number(replacement.byteStart) || 0));
            const end = Math.max(start, Math.min(snapshot.size, Number(replacement.byteEnd) || start));
            if (start > cursor) parts.push(snapshot.blob.slice(cursor, start));
            if (start === 0 && snapshot.bomBytes > 0) parts.push(snapshot.blob.slice(0, snapshot.bomBytes));
            parts.push(replacement.blob);
            cursor = end;
        }
        if (cursor < snapshot.size) parts.push(snapshot.blob.slice(cursor));
        if (parts.length === 0) parts.push(snapshot.blob);
        return new Blob(parts, { type: 'text/plain;charset=utf-8' });
    }

    function makeOutputFileName(snapshot, unresolvedCount = 0) {
        const name = String(snapshot?.fileName || 'ban-dich.txt').replace(/\.txt$/iu, '');
        const suffix = Number(unresolvedCount) > 0 ? '-da-sua-han-tu-ban-tam.txt' : '-da-sua-han-tu.txt';
        return `${name || 'ban-dich'}${suffix}`;
    }

    global.TranslatorHanFileSource = Object.freeze({
        PROGRESS_INTERVAL_MS,
        SCAN_WINDOW_BYTES,
        buildOutputBlob,
        createReplacement,
        createSnapshot,
        makeOutputFileName,
        readEffectiveChunk,
        readOriginalChunk,
        scanSnapshot,
    });
}(typeof globalThis !== 'undefined' ? globalThis : self));
