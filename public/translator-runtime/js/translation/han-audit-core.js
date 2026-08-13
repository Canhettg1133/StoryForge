(function registerTranslatorHanAuditCore(global) {
    const HAN_AUDIT_MAX_RANGES = 8;
    const HAN_AUDIT_PREVIEW_MAX_CHARS = 320;
    let unifiedIdeographRegex = null;

    try {
        unifiedIdeographRegex = new RegExp('[\\p{Unified_Ideograph}\\u3007]', 'u');
    } catch (_error) {
        unifiedIdeographRegex = null;
    }

    function isFallbackHanCodePoint(codePoint) {
        return codePoint === 0x3007
            || (codePoint >= 0x3400 && codePoint <= 0x4DBF)
            || (codePoint >= 0x4E00 && codePoint <= 0x9FFF)
            || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
            || (codePoint >= 0x20000 && codePoint <= 0x2EE5F)
            || (codePoint >= 0x2F800 && codePoint <= 0x2FA1F)
            || (codePoint >= 0x30000 && codePoint <= 0x3347F);
    }

    function isHanCodePoint(codePoint) {
        if (!Number.isFinite(codePoint)) return false;
        if (unifiedIdeographRegex) {
            return unifiedIdeographRegex.test(String.fromCodePoint(codePoint));
        }
        return isFallbackHanCodePoint(codePoint);
    }

    function clampSliceStart(text, offset) {
        let start = Math.max(0, Math.min(text.length, offset));
        if (start > 0 && start < text.length) {
            const value = text.charCodeAt(start);
            if (value >= 0xDC00 && value <= 0xDFFF) start += 1;
        }
        return start;
    }

    function clampSliceEnd(text, offset) {
        let end = Math.max(0, Math.min(text.length, offset));
        if (end > 0 && end < text.length) {
            const value = text.charCodeAt(end - 1);
            if (value >= 0xD800 && value <= 0xDBFF) end -= 1;
        }
        return end;
    }

    function buildHanPreview(text, firstRange) {
        if (!firstRange) return '';
        const half = Math.floor(HAN_AUDIT_PREVIEW_MAX_CHARS / 2);
        const desiredStart = Math.max(0, firstRange.start - half);
        const desiredEnd = Math.min(text.length, desiredStart + HAN_AUDIT_PREVIEW_MAX_CHARS);
        const start = clampSliceStart(text, desiredEnd - desiredStart < HAN_AUDIT_PREVIEW_MAX_CHARS
            ? Math.max(0, desiredEnd - HAN_AUDIT_PREVIEW_MAX_CHARS)
            : desiredStart);
        const end = clampSliceEnd(text, Math.min(text.length, start + HAN_AUDIT_PREVIEW_MAX_CHARS));
        return text.slice(start, end);
    }

    function scanHanInText(value) {
        const text = typeof value === 'string' ? value : '';
        const ranges = [];
        let hanCount = 0;
        let activeStart = -1;

        for (let offset = 0; offset < text.length;) {
            const codePoint = text.codePointAt(offset);
            const width = codePoint > 0xFFFF ? 2 : 1;
            if (isHanCodePoint(codePoint)) {
                hanCount += 1;
                if (activeStart < 0) activeStart = offset;
            } else if (activeStart >= 0) {
                if (ranges.length < HAN_AUDIT_MAX_RANGES) ranges.push({ start: activeStart, end: offset });
                activeStart = -1;
            }
            offset += width;
        }
        if (activeStart >= 0 && ranges.length < HAN_AUDIT_MAX_RANGES) {
            ranges.push({ start: activeStart, end: text.length });
        }

        return {
            hanCount,
            ranges,
            preview: buildHanPreview(text, ranges[0]),
        };
    }

    function getAuditRowText(row) {
        if (row && typeof row === 'object') return typeof row.outputText === 'string' ? row.outputText : '';
        return typeof row === 'string' ? row : '';
    }

    function scanHanRow(row, fallbackIndex = 0) {
        if (row && typeof row === 'object' && row.status === 'skipped') return null;
        const outputText = getAuditRowText(row);
        if (!outputText) return null;
        const match = scanHanInText(outputText);
        if (match.hanCount === 0) return null;
        const explicitIndex = row && typeof row === 'object' ? Number(row.chunkIndex) : NaN;
        const chunkIndex = Number.isFinite(explicitIndex)
            ? Math.max(0, Math.trunc(explicitIndex))
            : Math.max(0, Math.trunc(Number(fallbackIndex) || 0));
        const baseOffset = row && typeof row === 'object'
            ? Math.max(0, Math.trunc(Number(row.baseOffset) || 0))
            : 0;
        return {
            chunkIndex,
            ...match,
            ranges: match.ranges.map(range => ({
                start: range.start + baseOffset,
                end: range.end + baseOffset,
            })),
        };
    }

    function mergeHanMatches(matches) {
        const merged = new Map();
        (Array.isArray(matches) ? matches : []).forEach((match) => {
            if (!match || !Number.isFinite(Number(match.chunkIndex))) return;
            const chunkIndex = Math.max(0, Math.trunc(Number(match.chunkIndex)));
            const current = merged.get(chunkIndex) || {
                chunkIndex,
                hanCount: 0,
                ranges: [],
                preview: '',
            };
            current.hanCount += Math.max(0, Number(match.hanCount) || 0);
            if (!current.preview && match.preview) current.preview = String(match.preview).slice(0, HAN_AUDIT_PREVIEW_MAX_CHARS);
            (Array.isArray(match.ranges) ? match.ranges : []).forEach((range) => {
                const previous = current.ranges[current.ranges.length - 1];
                if (previous && previous.end === range.start) {
                    previous.end = range.end;
                } else if (current.ranges.length < HAN_AUDIT_MAX_RANGES) {
                    current.ranges.push({ start: range.start, end: range.end });
                }
            });
            merged.set(chunkIndex, current);
        });
        return Array.from(merged.values()).sort((a, b) => a.chunkIndex - b.chunkIndex);
    }

    function scanHanRows(rows) {
        if (!Array.isArray(rows)) return [];
        const matches = [];
        rows.forEach((row, index) => {
            const match = scanHanRow(row, index);
            if (match) matches.push(match);
        });
        return mergeHanMatches(matches);
    }

    const api = {
        HAN_AUDIT_MAX_RANGES,
        HAN_AUDIT_PREVIEW_MAX_CHARS,
        isHanCodePoint,
        mergeHanMatches,
        scanHanInText,
        scanHanRow,
        scanHanRows,
    };

    global.TranslatorHanAuditCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
