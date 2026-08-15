(function initTranslatorChapterIndexer(scope) {
    'use strict';

    const rules = scope.TranslatorChapterRules;
    if (!rules) throw new Error('TranslatorChapterRules must be loaded before chapter-indexer.js');

    const {
        SLICE_BYTES,
        MAX_CARRY_BYTES,
        MAX_DIAGNOSTICS,
        parseChapterHeading,
        parseBareNumberHeading,
        isTocMarker,
        mightBeHeadingBytes,
    } = rules;

    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    const EMPTY_BYTES = new Uint8Array(0);
    const SEQUENCED_LEAF_FAMILIES = new Set(['chapter', 'hoi', 'tiet']);
    const TOC_MAX_ENTRY_GAP_BYTES = 512;
    const TOC_MIN_SEQUENCE_LENGTH = 3;
    const COMPACT_DUPLICATE_MAX_CONTENT_BYTES = 512;

    function appendBounded(left, right) {
        if (left.length + right.length > MAX_CARRY_BYTES) return null;
        if (!left.length) return right.slice();
        if (!right.length) return left;
        const joined = new Uint8Array(left.length + right.length);
        joined.set(left, 0);
        joined.set(right, left.length);
        return joined;
    }

    function lineWithoutCarriageReturn(bytes) {
        return bytes.length && bytes[bytes.length - 1] === 13
            ? bytes.subarray(0, bytes.length - 1)
            : bytes;
    }

    function firstMeaningfulOffset(bytes, globalStart) {
        let index = 0;
        if (globalStart === 0 && bytes.length >= 3
            && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            index = 3;
        }
        for (; index < bytes.length; index += 1) {
            const value = bytes[index];
            if (value !== 9 && value !== 10 && value !== 11 && value !== 12 && value !== 13 && value !== 32) {
                return globalStart + index;
            }
        }
        return null;
    }

    async function walkBlobLines(blob, visitor, options) {
        if (!blob || typeof blob.slice !== 'function' || !Number.isFinite(blob.size)) {
            throw new TypeError('Chapter source must be a Blob');
        }

        const settings = options || {};
        const onProgress = typeof settings.onProgress === 'function' ? settings.onProgress : null;
        const shouldCancel = typeof settings.shouldCancel === 'function' ? settings.shouldCancel : null;
        let carry = EMPTY_BYTES;
        let carryStart = 0;
        let carryTruncated = false;
        let bytesRead = 0;
        let sliceCount = 0;
        let firstMeaningfulByte = null;
        let lastProgressAt = 0;
        let stopped = false;

        function visit(bytes, lineStart, contentStart, truncated) {
            if (visitor(bytes, lineStart, contentStart, truncated) === false) stopped = true;
        }

        for (let sliceStart = 0; sliceStart < blob.size && !stopped; sliceStart += SLICE_BYTES) {
            if (shouldCancel && shouldCancel()) throw new Error('CHAPTER_SCAN_CANCELLED');
            const sliceEnd = Math.min(blob.size, sliceStart + SLICE_BYTES);
            const bytes = new Uint8Array(await blob.slice(sliceStart, sliceEnd).arrayBuffer());
            bytesRead += bytes.length;
            sliceCount += 1;

            if (firstMeaningfulByte == null) {
                firstMeaningfulByte = firstMeaningfulOffset(bytes, sliceStart);
            }

            let position = 0;
            while (position < bytes.length && !stopped) {
                const lineFeed = bytes.indexOf(10, position);
                if (lineFeed < 0) break;
                const segment = bytes.subarray(position, lineFeed);
                if (carry.length || carryTruncated || carryStart < sliceStart + position) {
                    const joined = carryTruncated ? null : appendBounded(carry, segment);
                    visit(joined || EMPTY_BYTES, carryStart, sliceStart + lineFeed + 1, carryTruncated || joined == null);
                } else {
                    visit(segment, sliceStart + position, sliceStart + lineFeed + 1, segment.length > MAX_CARRY_BYTES);
                }
                carry = EMPTY_BYTES;
                carryTruncated = false;
                position = lineFeed + 1;
                carryStart = sliceStart + position;
            }

            if (!stopped) {
                const tail = bytes.subarray(position);
                if (carryTruncated) {
                    // Keep only the state and byte start for an overlong line.
                } else if (carry.length || carryStart < sliceStart + position) {
                    const joined = appendBounded(carry, tail);
                    if (joined) carry = joined;
                    else {
                        carry = EMPTY_BYTES;
                        carryTruncated = true;
                    }
                } else if (tail.length <= MAX_CARRY_BYTES) {
                    carry = tail.slice();
                } else {
                    carry = EMPTY_BYTES;
                    carryTruncated = true;
                }
            }

            if (onProgress) {
                const now = Date.now();
                if (now - lastProgressAt >= 250) {
                    lastProgressAt = now;
                    onProgress({ bytesRead, totalBytes: blob.size, ratio: blob.size ? bytesRead / blob.size : 1 });
                }
            }
        }

        if (!stopped && blob.size === 0) {
            firstMeaningfulByte = null;
        } else if (!stopped && (carry.length || carryTruncated || carryStart < blob.size)) {
            visit(carry, carryStart, blob.size, carryTruncated);
        }

        if (onProgress && blob.size === 0) onProgress({ bytesRead: 0, totalBytes: 0, ratio: 1 });
        return { bytesRead, sliceCount, firstMeaningfulByte, stopped };
    }

    function normalizedTitle(title) {
        return String(title || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
    }

    function duplicateKey(candidate) {
        const looseTitle = normalizedTitle(candidate.title)
            .replace(/[\p{P}\p{S}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return candidate.family + '|' + (candidate.ordinal == null ? '' : candidate.ordinal) + '|' + looseTitle;
    }

    function markDenseRepeatedSequences(sorted, removed) {
        const nextOccurrence = new Int32Array(sorted.length);
        nextOccurrence.fill(-1);
        const nextByOrdinal = new Map();
        for (let index = sorted.length - 1; index >= 0; index -= 1) {
            const candidate = sorted[index];
            if (!Number.isFinite(candidate.ordinal)) continue;
            const key = candidate.family + '|' + candidate.ordinal;
            if (nextByOrdinal.has(key)) nextOccurrence[index] = nextByOrdinal.get(key);
            nextByOrdinal.set(key, index);
        }

        for (let start = 0; start < sorted.length;) {
            const first = sorted[start];
            if (!Number.isFinite(first.ordinal)) {
                start += 1;
                continue;
            }
            let end = start + 1;
            while (end < sorted.length) {
                const previous = sorted[end - 1];
                const current = sorted[end];
                const gap = current.headingByteStart - previous.contentByteStart;
                if (current.family !== first.family
                    || !Number.isFinite(current.ordinal)
                    || current.ordinal !== previous.ordinal + 1
                    || gap < 0
                    || gap > TOC_MAX_ENTRY_GAP_BYTES) break;
                end += 1;
            }
            if (end - start >= TOC_MIN_SEQUENCE_LENGTH && nextOccurrence[start] >= end) {
                for (let index = start; index < end; index += 1) removed.add(index);
            }
            start = end;
        }
    }

    function markCompactRepeatedOrdinals(sorted, removed) {
        for (let index = 0; index < sorted.length - 1; index += 1) {
            const current = sorted[index];
            const next = sorted[index + 1];
            const contentBytes = next.headingByteStart - current.contentByteStart;
            if (SEQUENCED_LEAF_FAMILIES.has(current.family)
                && next.family === current.family
                && Number.isFinite(current.ordinal)
                && next.ordinal === current.ordinal
                && contentBytes >= 0
                && contentBytes <= COMPACT_DUPLICATE_MAX_CONTENT_BYTES) {
                removed.add(index);
            }
        }
    }

    function removeRepeatedHeadings(candidates, tocMarkers) {
        if (candidates.length < 2) return candidates.slice();
        const sorted = candidates.slice().sort((left, right) => left.headingByteStart - right.headingByteStart);
        const removed = new Set();
        const occurrences = new Map();

        markDenseRepeatedSequences(sorted, removed);
        markCompactRepeatedOrdinals(sorted, removed);

        for (let index = 0; index < sorted.length; index += 1) {
            const key = duplicateKey(sorted[index]);
            const previous = occurrences.get(key);
            if (previous) previous.push(index);
            else occurrences.set(key, [index]);
        }

        const earlyTocMarker = tocMarkers.find(offset => offset <= 64 * 1024);
        if (earlyTocMarker != null) {
            for (const indices of occurrences.values()) {
                if (indices.length < 2) continue;
                const last = indices[indices.length - 1];
                for (let position = 0; position < indices.length - 1; position += 1) {
                    const index = indices[position];
                    if (sorted[index].headingByteStart >= earlyTocMarker
                        && sorted[last].headingByteStart > sorted[index].headingByteStart) {
                        removed.add(index);
                    }
                }
            }
        }

        if (sorted.length >= 6 && sorted[0].headingByteStart <= 512 * 1024) {
            const keys = sorted.map(duplicateKey);
            for (let actualStart = 3; actualStart <= sorted.length - 3; actualStart += 1) {
                if (keys[actualStart] !== keys[0]
                    || sorted[actualStart].headingByteStart - sorted[0].headingByteStart <= 2048) {
                    continue;
                }
                let repeated = 0;
                while (actualStart + repeated < keys.length
                    && repeated < actualStart
                    && keys[repeated] === keys[actualStart + repeated]) {
                    repeated += 1;
                }
                if (repeated >= 3) {
                    for (let index = 0; index < repeated; index += 1) removed.add(index);
                    break;
                }
            }
        }

        for (const indices of occurrences.values()) {
            for (let position = 1; position < indices.length; position += 1) {
                const previousIndex = indices[position - 1];
                const currentIndex = indices[position];
                if (!removed.has(previousIndex)
                    && sorted[currentIndex].headingByteStart - sorted[previousIndex].headingByteStart <= 2048) {
                    removed.add(previousIndex);
                }
            }
        }

        return sorted.filter((_, index) => !removed.has(index));
    }

    function selectExplicitSequence(candidates, diagnostics) {
        const removed = new Set();
        let segmentLeaves = [];

        function inspectSegment() {
            for (let index = 0; index < segmentLeaves.length - 2; index += 1) {
                const previous = segmentLeaves[index];
                if (!SEQUENCED_LEAF_FAMILIES.has(previous.family)
                    || !Number.isFinite(previous.ordinal)) continue;
                const expectedOrdinal = previous.ordinal + 1;
                const searchEnd = Math.min(segmentLeaves.length, index + 9);
                let nextSequenceIndex = -1;
                for (let nextIndex = index + 1; nextIndex < searchEnd; nextIndex += 1) {
                    const next = segmentLeaves[nextIndex];
                    if (next.family === previous.family && next.ordinal === expectedOrdinal) {
                        nextSequenceIndex = nextIndex;
                        break;
                    }
                }
                if (nextSequenceIndex <= index + 1) continue;
                const nextSequence = segmentLeaves[nextSequenceIndex];
                for (let outlierIndex = index + 1; outlierIndex < nextSequenceIndex; outlierIndex += 1) {
                    const outlier = segmentLeaves[outlierIndex];
                    const compactSameFamilyOutlier = outlier.family === previous.family
                        && nextSequence.headingByteStart - outlier.contentByteStart >= 0
                        && nextSequence.headingByteStart - outlier.contentByteStart <= COMPACT_DUPLICATE_MAX_CONTENT_BYTES;
                    if (SEQUENCED_LEAF_FAMILIES.has(outlier.family)
                        && (outlier.family !== previous.family || compactSameFamilyOutlier)
                        && Number.isFinite(outlier.ordinal)
                        && outlier.ordinal !== expectedOrdinal) {
                        removed.add(outlier);
                    }
                }
            }
            segmentLeaves = [];
        }

        for (const candidate of candidates) {
            if (candidate.level === 'container') {
                inspectSegment();
            } else {
                segmentLeaves.push(candidate);
            }
        }
        inspectSegment();

        const suggestions = [];
        for (const candidate of removed) {
            const suggestion = {
                ...candidate,
                confidence: 'suggested',
                parentIndex: null,
                reason: 'sequence-outlier',
            };
            suggestions.push(suggestion);
            if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(suggestion);
        }
        return {
            accepted: candidates.filter(candidate => !removed.has(candidate)),
            suggestions,
        };
    }

    function selectBareSequences(bareCandidates, diagnostics) {
        const plausible = bareCandidates
            .filter(candidate => candidate.plausible)
            .sort((left, right) => left.headingByteStart - right.headingByteStart);
        const accepted = [];
        let runStart = 0;

        function finishRun(endExclusive) {
            if (endExclusive - runStart >= 3) {
                for (let index = runStart; index < endExclusive; index += 1) {
                    const candidate = plausible[index];
                    accepted.push({
                        title: candidate.title,
                        ordinal: candidate.ordinal,
                        family: 'chapter',
                        level: 'leaf',
                        headingByteStart: candidate.headingByteStart,
                        contentByteStart: candidate.contentByteStart,
                        confidence: 'sequence',
                    });
                }
            }
        }

        for (let index = 1; index <= plausible.length; index += 1) {
            const previous = plausible[index - 1];
            const current = plausible[index];
            const continues = current
                && current.ordinal === previous.ordinal + 1
                && current.headingByteStart - previous.headingByteStart <= 1024 * 1024;
            if (continues) continue;
            finishRun(index);
            runStart = index;
        }

        const acceptedOffsets = new Set(accepted.map(candidate => candidate.headingByteStart));
        const suggestions = [];
        for (const candidate of bareCandidates) {
            if (acceptedOffsets.has(candidate.headingByteStart) || diagnostics.length >= MAX_DIAGNOSTICS) continue;
            const suggestion = {
                title: candidate.title,
                ordinal: candidate.ordinal,
                family: 'chapter',
                level: 'leaf',
                headingByteStart: candidate.headingByteStart,
                contentByteStart: candidate.contentByteStart,
                confidence: 'suggested',
                parentIndex: null,
                reason: candidate.plausible ? 'bare-number-without-sequence' : 'bare-number-out-of-range',
            };
            suggestions.push(suggestion);
            diagnostics.push(suggestion);
        }
        return { accepted, suggestions };
    }

    function fallbackChapter(blobSize) {
        return {
            title: 'Nội dung',
            ordinal: null,
            family: 'special',
            level: 'leaf',
            headingByteStart: 0,
            contentByteStart: 0,
            byteEnd: blobSize,
            confidence: 'accepted',
            parentIndex: null,
        };
    }

    function rebuildChapterIndex(boundaries, blobSize, options) {
        const size = Math.max(0, Number(blobSize) || 0);
        const settings = options || {};
        const uniqueOffsets = new Set();
        const sorted = (Array.isArray(boundaries) ? boundaries : [])
            .filter(boundary => boundary && Number.isFinite(boundary.headingByteStart)
                && Number.isFinite(boundary.contentByteStart)
                && boundary.headingByteStart >= 0
                && boundary.contentByteStart >= boundary.headingByteStart
                && boundary.headingByteStart <= size)
            .sort((left, right) => left.headingByteStart - right.headingByteStart)
            .filter(boundary => {
                if (uniqueOffsets.has(boundary.headingByteStart)) return false;
                uniqueOffsets.add(boundary.headingByteStart);
                return true;
            })
            .map(boundary => ({
                title: String(boundary.title || 'Nội dung'),
                ordinal: boundary.ordinal == null ? null : Number(boundary.ordinal),
                family: boundary.family || 'special',
                level: boundary.level === 'container' ? 'container' : 'leaf',
                headingByteStart: boundary.headingByteStart,
                contentByteStart: Math.min(size, boundary.contentByteStart),
                byteEnd: size,
                confidence: boundary.confidence || 'manual',
                parentIndex: null,
            }));

        if (!sorted.length) {
            return {
                chapters: [fallbackChapter(size)],
                warning: 'Không nhận diện được nhiều chương; toàn bộ văn bản được giữ trong mục Nội dung.',
            };
        }

        for (let index = 0; index < sorted.length; index += 1) {
            if (sorted[index].level !== 'container') continue;
            let hasChild = false;
            for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
                if (sorted[nextIndex].level === 'container') break;
                hasChild = true;
                break;
            }
            if (!hasChild) sorted[index].level = 'leaf';
        }

        const chapters = [];
        const firstMeaningfulByte = settings.firstMeaningfulByte;
        const shouldKeepFrontMatter = sorted[0].headingByteStart > 0
            && firstMeaningfulByte != null
            && firstMeaningfulByte < sorted[0].headingByteStart;
        if (shouldKeepFrontMatter) {
            chapters.push({
                title: 'Mở đầu',
                ordinal: null,
                family: 'special',
                level: 'leaf',
                headingByteStart: 0,
                contentByteStart: 0,
                byteEnd: sorted[0].headingByteStart,
                confidence: 'accepted',
                parentIndex: null,
            });
        }
        chapters.push(...sorted);

        let activeContainer = null;
        for (let index = 0; index < chapters.length; index += 1) {
            const chapter = chapters[index];
            chapter.byteEnd = index + 1 < chapters.length ? chapters[index + 1].headingByteStart : size;
            if (chapter.level === 'container') {
                chapter.parentIndex = null;
                activeContainer = index;
            } else if (chapter.family === 'phan' || chapter.family === 'quyen' || chapter.family === 'tap') {
                chapter.parentIndex = null;
                activeContainer = null;
            } else {
                chapter.parentIndex = activeContainer;
            }
        }
        return { chapters, warning: null };
    }

    async function scanChapterBlob(blob, options) {
        const diagnostics = [];
        const explicitCandidates = [];
        const bareCandidates = [];
        const tocMarkers = [];

        const scan = await walkBlobLines(blob, (rawBytes, headingByteStart, contentByteStart, truncated) => {
            if (truncated) {
                if (diagnostics.length < MAX_DIAGNOSTICS) {
                    diagnostics.push({ headingByteStart, confidence: 'suggested', reason: 'line-too-long' });
                }
                return;
            }
            const lineBytes = lineWithoutCarriageReturn(rawBytes);
            if (!mightBeHeadingBytes(lineBytes)) return;
            const line = decoder.decode(lineBytes);
            if (isTocMarker(line)) tocMarkers.push(headingByteStart);

            const parsed = parseChapterHeading(line);
            if (parsed) {
                explicitCandidates.push({
                    ...parsed,
                    headingByteStart,
                    contentByteStart,
                    confidence: 'accepted',
                });
                return;
            }

            const bare = parseBareNumberHeading(line);
            if (bare) bareCandidates.push({ ...bare, headingByteStart, contentByteStart });
        }, options);

        const explicit = selectExplicitSequence(
            removeRepeatedHeadings(explicitCandidates, tocMarkers),
            diagnostics,
        );
        const sequence = selectBareSequences(bareCandidates, diagnostics);
        const result = rebuildChapterIndex([...explicit.accepted, ...sequence.accepted], blob.size, {
            firstMeaningfulByte: scan.firstMeaningfulByte,
        });
        return {
            chapters: result.chapters,
            suggestions: [...explicit.suggestions, ...sequence.suggestions],
            diagnostics,
            warning: result.warning,
            bytesRead: scan.bytesRead,
            sliceCount: scan.sliceCount,
        };
    }

    async function findHeadingInBlob(blob, query, options) {
        const settings = options || {};
        const limit = Math.max(1, Math.min(12, Number(settings.limit) || 12));
        const needleText = String(query || '').trim();
        if (!needleText) return { matches: [], bytesRead: 0, sliceCount: 0 };
        const needleBytes = encoder.encode(needleText);

        function trimLineBytes(rawBytes) {
            let start = 0;
            let end = rawBytes.length;
            if (end >= 3 && rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF) start = 3;
            while (start < end
                && (rawBytes[start] === 9 || rawBytes[start] === 11 || rawBytes[start] === 12 || rawBytes[start] === 32)) start += 1;
            while (end > start
                && (rawBytes[end - 1] === 9 || rawBytes[end - 1] === 11 || rawBytes[end - 1] === 12
                    || rawBytes[end - 1] === 13 || rawBytes[end - 1] === 32)) end -= 1;
            return rawBytes.subarray(start, end);
        }

        function equalsNeedle(bytes) {
            if (bytes.length !== needleBytes.length) return false;
            for (let index = 0; index < bytes.length; index += 1) {
                if (bytes[index] !== needleBytes[index]) return false;
            }
            return true;
        }

        const matches = [];
        let pendingPreview = null;
        const scan = await walkBlobLines(blob, (rawBytes, headingByteStart, contentByteStart, truncated) => {
            if (truncated) return;
            const lineBytes = trimLineBytes(rawBytes);
            if (pendingPreview && lineBytes.length > 0) {
                pendingPreview.preview += '\n' + decoder.decode(lineBytes).slice(0, 160);
                pendingPreview = null;
                if (matches.length >= limit) return false;
            }
            if (equalsNeedle(lineBytes)) {
                const line = decoder.decode(lineBytes);
                const match = {
                    title: line,
                    headingByteStart,
                    contentByteStart,
                    preview: line,
                };
                matches.push(match);
                pendingPreview = match;
            }
            return matches.length < limit || pendingPreview != null;
        }, options);
        return { matches, bytesRead: scan.bytesRead, sliceCount: scan.sliceCount };
    }

    scope.TranslatorChapterIndexer = Object.freeze({
        scanChapterBlob,
        rebuildChapterIndex,
        findHeadingInBlob,
    });
}(typeof self !== 'undefined' ? self : globalThis));
