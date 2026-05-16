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

        return targetChars;
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
        let byteCursor = Math.max(0, Number(options.startByte) || 0);
        let index = Math.max(0, Number(options.startIndex) || 0);
        const fileSize = Math.max(0, Number(file.size) || 0);

        while (byteCursor < fileSize) {
            if (options.signal?.aborted) break;

            const byteStart = byteCursor;
            const byteWindowEnd = Math.min(fileSize, byteCursor + windowBytes);
            const sliceText = await file.slice(byteCursor, byteWindowEnd).text();
            if (!sliceText) break;

            const isAtEnd = byteWindowEnd >= fileSize;
            const cutIndex = isAtEnd && sliceText.length <= chunkSize
                ? sliceText.length
                : selectLargeFileChunkCut(sliceText, chunkSize, options);
            const safeCutIndex = Math.max(1, Math.min(sliceText.length, cutIndex || chunkSize));
            const usedText = sliceText.slice(0, safeCutIndex);
            let bytesConsumed = getByteLength(usedText);

            if (!Number.isFinite(bytesConsumed) || bytesConsumed <= 0) {
                bytesConsumed = Math.min(byteWindowEnd - byteCursor, Math.max(1, getByteLength(sliceText.slice(0, 1))));
            }

            const nextCursor = Math.min(fileSize, byteCursor + bytesConsumed);
            if (nextCursor <= byteCursor) {
                throw new Error('Không thể tiến con trỏ đọc file lớn.');
            }

            byteCursor = nextCursor;

            if (usedText.length > 0) {
                yield {
                    index,
                    text: usedText,
                    byteStart,
                    byteEnd: byteCursor,
                    bytesConsumed,
                    fileSize,
                };
                index += 1;
            }
        }
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
        selectLargeFileChunkCut,
    };

    global.TranslatorLargeFileSource = api;
    Object.keys(api).forEach((key) => {
        if (typeof global[key] === 'undefined') {
            global[key] = api[key];
        }
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
