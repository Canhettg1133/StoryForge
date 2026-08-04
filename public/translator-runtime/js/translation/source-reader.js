(function registerTranslatorLargeFileSource(global) {
    const LARGE_FILE_THRESHOLD_BYTES = 1024 * 1024;
    const LARGE_FILE_PREVIEW_BYTES = 64 * 1024;
    const DEFAULT_MIN_WINDOW_BYTES = 256 * 1024;
    const DEFAULT_CHUNK_SIZE = 4500;
    const DEFAULT_SEPARATOR = '\n\n';
    const encoder = new TextEncoder();

    function getByteLength(text) {
        return encoder.encode(String(text || '')).length;
    }

    function normalizeChunkSize(value) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHUNK_SIZE;
    }

    function normalizeWindowBytes(options = {}) {
        const chunkSize = normalizeChunkSize(options.chunkSize);
        const minWindowBytes = Math.max(
            1024,
            parseInt(options.minWindowBytes || DEFAULT_MIN_WINDOW_BYTES, 10) || DEFAULT_MIN_WINDOW_BYTES
        );
        const requested = parseInt(options.windowBytes, 10);
        if (Number.isFinite(requested) && requested > 0) {
            return Math.max(requested, minWindowBytes);
        }
        return Math.max(chunkSize * 6, minWindowBytes);
    }

    function findBoundaryBefore(text, boundaryRegex, minIndex, targetIndex) {
        let best = -1;
        const regex = new RegExp(boundaryRegex.source, boundaryRegex.flags.includes('g') ? boundaryRegex.flags : `${boundaryRegex.flags}g`);
        let match;
        while ((match = regex.exec(text)) !== null) {
            const endIndex = match.index + match[0].length;
            if (endIndex >= minIndex && endIndex <= targetIndex) {
                best = endIndex;
            }
            if (endIndex > targetIndex) break;
            if (match[0].length === 0) regex.lastIndex += 1;
        }
        return best;
    }

    function findBoundaryAfter(text, boundaryRegex, targetIndex, maxIndex) {
        const regex = new RegExp(boundaryRegex.source, boundaryRegex.flags.includes('g') ? boundaryRegex.flags : `${boundaryRegex.flags}g`);
        let match;
        while ((match = regex.exec(text)) !== null) {
            const endIndex = match.index + match[0].length;
            if (endIndex > targetIndex && endIndex <= maxIndex) {
                return endIndex;
            }
            if (endIndex > maxIndex) break;
            if (match[0].length === 0) regex.lastIndex += 1;
        }
        return -1;
    }

    function selectLargeFileChunkCut(text, chunkSize = DEFAULT_CHUNK_SIZE, options = {}) {
        const source = String(text || '');
        if (!source) return 0;

        const targetChars = normalizeChunkSize(chunkSize);
        if (source.length <= targetChars) return source.length;

        const minBackwardRatio = Number.isFinite(options.minBackwardRatio)
            ? Math.max(0.1, Math.min(0.95, options.minBackwardRatio))
            : 0.6;
        const forwardRatio = Number.isFinite(options.forwardRatio)
            ? Math.max(1, Math.min(2, options.forwardRatio))
            : 1.25;
        const minIndex = Math.max(1, Math.floor(targetChars * minBackwardRatio));
        const maxForwardIndex = Math.min(source.length, Math.ceil(targetChars * forwardRatio));
        const boundaries = [
            /\n\s*\n+/g,
            /\n+/g,
            /[.!?\u3002\uff01\uff1f\u2026]+["'\u201d\u2019)\]]?\s+/g,
            /\s+/g,
        ];

        for (const boundary of boundaries) {
            const before = findBoundaryBefore(source, boundary, minIndex, targetChars);
            if (before > 0) return before;

            const after = findBoundaryAfter(source, boundary, targetChars, maxForwardIndex);
            if (after > 0) return after;
        }

        return avoidSplittingSurrogatePair(source, targetChars);
    }

    function avoidSplittingSurrogatePair(text, cutIndex) {
        const source = String(text || '');
        const safeCut = Math.max(0, Math.min(source.length, Number(cutIndex) || 0));
        if (safeCut <= 0 || safeCut >= source.length) return safeCut;
        const before = source.charCodeAt(safeCut - 1);
        const after = source.charCodeAt(safeCut);
        if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) {
            return safeCut + 1;
        }
        return safeCut;
    }

    async function readFilePreview(file, previewBytes = LARGE_FILE_PREVIEW_BYTES) {
        if (!file || typeof file.slice !== 'function') return '';
        const safeBytes = Math.max(1024, parseInt(previewBytes, 10) || LARGE_FILE_PREVIEW_BYTES);
        return file.slice(0, Math.min(file.size || 0, safeBytes)).text();
    }

    function estimateChunkCountFromPreview({ fileSize, previewText, chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
        const safeFileSize = Math.max(0, Number(fileSize) || 0);
        const safeChunkSize = normalizeChunkSize(chunkSize);
        const preview = String(previewText || '');
        const previewBytes = getByteLength(preview);
        const bytesPerChar = preview.length > 0 && previewBytes > 0
            ? previewBytes / preview.length
            : 2;
        const estimatedChars = bytesPerChar > 0 ? safeFileSize / bytesPerChar : safeFileSize / 2;
        return {
            count: Math.max(1, Math.ceil(estimatedChars / safeChunkSize)),
            approximate: true,
            bytesPerChar,
        };
    }

    async function* createLazyChunkReader(file, options = {}) {
        if (!file || typeof file.slice !== 'function') {
            throw new Error('Nguồn file không hợp lệ.');
        }

        const chunkSize = normalizeChunkSize(options.chunkSize);
        const windowBytes = normalizeWindowBytes({ ...options, chunkSize });
        const startByte = Math.min(Math.max(0, Number(options.startByte) || 0), Math.max(0, Number(file.size) || 0));
        let readByteCursor = startByte;
        let emittedByteCursor = startByte;
        let index = Math.max(0, Number(options.startIndex) || 0);
        const fileSize = Math.max(0, Number(file.size) || 0);
        const decoder = new TextDecoder('utf-8');
        const forwardRatio = Number.isFinite(options.forwardRatio)
            ? Math.max(1, Math.min(2, options.forwardRatio))
            : 1.25;
        const minimumBufferedChars = Math.max(chunkSize + 1, Math.ceil(chunkSize * forwardRatio));
        let carry = '';
        let firstWindow = true;
        let leadingBomBytes = 0;

        while (readByteCursor < fileSize) {
            if (options.signal?.aborted) break;

            const byteWindowEnd = Math.min(fileSize, readByteCursor + windowBytes);
            const bytes = new Uint8Array(await file.slice(readByteCursor, byteWindowEnd).arrayBuffer());
            if (firstWindow && startByte === 0 && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
                leadingBomBytes = 3;
            }
            firstWindow = false;
            readByteCursor = byteWindowEnd;
            carry += decoder.decode(bytes, { stream: readByteCursor < fileSize });

            const isAtEnd = readByteCursor >= fileSize;
            if (isAtEnd) carry += decoder.decode();

            let consumedChars = 0;
            while (carry.length - consumedChars > (isAtEnd ? 0 : minimumBufferedChars)) {
                if (options.signal?.aborted) return;
                const remaining = carry.slice(consumedChars);
                const cutIndex = isAtEnd && remaining.length <= chunkSize
                    ? remaining.length
                    : selectLargeFileChunkCut(remaining, chunkSize, options);
                const safeCutIndex = avoidSplittingSurrogatePair(
                    remaining,
                    Math.max(1, Math.min(remaining.length, cutIndex || chunkSize))
                );
                const usedText = remaining.slice(0, safeCutIndex);
                let bytesConsumed = getByteLength(usedText);
                if (leadingBomBytes > 0) {
                    bytesConsumed += leadingBomBytes;
                    leadingBomBytes = 0;
                }
                const byteStart = emittedByteCursor;
                emittedByteCursor = Math.min(fileSize, emittedByteCursor + bytesConsumed);
                consumedChars += safeCutIndex;

                yield {
                    index,
                    text: usedText,
                    byteStart,
                    byteEnd: emittedByteCursor,
                    bytesConsumed,
                    fileSize,
                };
                index += 1;
            }

            if (consumedChars > 0) carry = carry.slice(consumedChars);
        }
    }

    function clipSearchPreview(text, matchIndex, queryLength, maxChars = 420) {
        const source = String(text || '');
        const before = Math.max(0, Math.floor((maxChars - queryLength) * 0.4));
        const start = Math.max(0, matchIndex - before);
        return source.slice(start, Math.min(source.length, start + maxChars)).replace(/\s+/g, ' ').trim();
    }

    function yieldToMainThread() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    async function scanTranslatorSource(file, query, options = {}) {
        const needle = String(query || '').trim().toLocaleLowerCase('vi-VN');
        if (!needle) return { matches: [], cancelled: false, scannedBytes: 0 };

        const limit = Math.max(1, Math.min(12, Number(options.limit) || 12));
        const contextCount = Math.max(0, Math.min(10, Number(options.contextCount) || 3));
        const yieldEvery = Math.max(1, Number(options.yieldEvery) || 24);
        const previousChunks = [];
        const matches = [];
        const fileSize = Math.max(0, Number(file?.size) || 0);
        let scannedBytes = 0;
        let processedChunks = 0;
        let lastProgress = -1;

        for await (const chunk of createLazyChunkReader(file, options)) {
            if (options.signal?.aborted) {
                return { matches, cancelled: true, scannedBytes };
            }

            scannedBytes = chunk.byteEnd;
            const haystack = String(chunk.text || '').toLocaleLowerCase('vi-VN');
            const matchIndex = haystack.indexOf(needle);
            if (matchIndex >= 0) {
                matches.push({
                    chunkIndex: chunk.index,
                    byteStart: chunk.byteStart,
                    byteEnd: chunk.byteEnd,
                    sourcePreview: clipSearchPreview(chunk.text, matchIndex, needle.length),
                    contextBefore: previousChunks
                        .map(item => `Chunk ${item.index + 1}: ${item.text}`)
                        .join('\n\n'),
                });
            }

            previousChunks.push({ index: chunk.index, text: String(chunk.text || '') });
            if (previousChunks.length > contextCount) previousChunks.shift();

            const progress = fileSize > 0 ? Math.min(1, scannedBytes / fileSize) : 1;
            if (typeof options.onProgress === 'function' && (progress >= 1 || progress - lastProgress >= 0.01)) {
                lastProgress = progress;
                options.onProgress(progress);
            }

            if (matches.length >= limit) break;
            processedChunks += 1;
            if (options.cooperative !== false && processedChunks % yieldEvery === 0) {
                await yieldToMainThread();
            }
        }

        if (typeof options.onProgress === 'function' && scannedBytes >= fileSize && lastProgress < 1) {
            options.onProgress(1);
        }
        return { matches, cancelled: Boolean(options.signal?.aborted), scannedBytes };
    }

    function buildBlobPartsFromChunks(chunks, options = {}) {
        const separator = options.separator ?? DEFAULT_SEPARATOR;
        const includePending = Boolean(options.includePending);
        const pendingLabel = options.pendingLabel || 'Chưa dịch';
        const parts = [];
        const entries = chunks instanceof Map
            ? Array.from(chunks.entries()).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, value]) => value)
            : Array.isArray(chunks)
                ? chunks
                : [];

        entries.forEach((chunk, index) => {
            const hasText = typeof chunk === 'string' && chunk.length > 0;
            if (!hasText && !includePending) return;
            if (parts.length > 0) parts.push(separator);
            parts.push(hasText ? chunk : `[${pendingLabel} chunk ${index + 1}]`);
        });

        return parts;
    }

    function isLargeFileCandidate(file, thresholdBytes = LARGE_FILE_THRESHOLD_BYTES) {
        return Boolean(file && Number(file.size || 0) >= thresholdBytes);
    }

    const api = {
        LARGE_FILE_THRESHOLD_BYTES,
        LARGE_FILE_PREVIEW_BYTES,
        DEFAULT_MIN_WINDOW_BYTES,
        buildBlobPartsFromChunks,
        createLazyChunkReader,
        estimateChunkCountFromPreview,
        getByteLength,
        isLargeFileCandidate,
        normalizeChunkSize,
        readFilePreview,
        scanTranslatorSource,
        selectLargeFileChunkCut,
    };

    global.TranslatorLargeFileSource = api;
    Object.keys(api).forEach((key) => {
        if (typeof global[key] === 'undefined') {
            global[key] = api[key];
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
