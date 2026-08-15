/**
 * Translator chapter snapshots.
 *
 * Keeps chapter reading/export independent from the translation engine. A
 * translated snapshot is always the contiguous `done` prefix that starts at
 * the session's original startChunkIndex; later chunks are never spliced over
 * a pending or failed gap.
 */
(function attachTranslatorChapterSnapshot(global) {
    'use strict';

    const DONE_STATUSES = new Set(['done', 'success', 'warning', 'completed']);

    function runtimeState() {
        return {
            chunkTrackingData: typeof chunkTrackingData !== 'undefined' ? chunkTrackingData : global.chunkTrackingData,
            currentHistoryId: typeof currentHistoryId !== 'undefined' ? currentHistoryId : global.currentHistoryId,
            currentSessionId: typeof currentTranslatorSessionId !== 'undefined' ? currentTranslatorSessionId : global.currentTranslatorSessionId,
            currentSessionMeta: typeof currentTranslatorSessionMeta !== 'undefined' ? currentTranslatorSessionMeta : global.currentTranslatorSessionMeta,
            isTranslating: typeof isTranslating !== 'undefined' ? isTranslating : global.isTranslating,
            largeFileMeta: typeof largeFileMeta !== 'undefined' ? largeFileMeta : global.largeFileMeta,
            lastHistoryId: typeof lastTranslatorHistoryId !== 'undefined' ? lastTranslatorHistoryId : global.lastTranslatorHistoryId,
            originalFileName: typeof originalFileName !== 'undefined' ? originalFileName : global.originalFileName,
            outputGeneration: typeof translatorOutputGeneration !== 'undefined' ? translatorOutputGeneration : global.translatorOutputGeneration,
            totalChunksCount: typeof totalChunksCount !== 'undefined' ? totalChunksCount : global.totalChunksCount,
            translatedChunks: typeof translatedChunks !== 'undefined' ? translatedChunks : global.translatedChunks,
            translationStartChunkIndex: typeof translationStartChunkIndex !== 'undefined'
                ? translationStartChunkIndex
                : global.translationStartChunkIndex,
            translationHistory: typeof translationHistory !== 'undefined' ? translationHistory : global.translationHistory,
        };
    }

    function isBlobLike(value) {
        return Boolean(value && typeof value.slice === 'function' && Number.isFinite(Number(value.size)));
    }

    function freezeSnapshot(snapshot) {
        return Object.freeze(snapshot);
    }

    async function createSourceSnapshot(options = {}) {
        let blob = options.blob;
        if (!isBlobLike(blob)) {
            const fallbackText = typeof options.text === 'string' ? options.text : '';
            blob = new Blob([fallbackText], { type: 'text/plain;charset=utf-8' });
        }

        return freezeSnapshot({
            blob,
            fileName: String(options.fileName || 'truyen.txt'),
            kind: 'source',
            partial: false,
            partialReason: null,
            completedChunks: 0,
            totalChunks: 0,
            revision: options.revision ?? null,
        });
    }

    function normalizeChunkGroups(rows = []) {
        const groups = new Map();
        for (const row of rows) {
            const numericIndex = Number(row?.chunkIndex);
            if (!Number.isFinite(numericIndex)) continue;
            const chunkIndex = Math.max(0, Math.trunc(numericIndex));
            if (!groups.has(chunkIndex)) groups.set(chunkIndex, []);
            groups.get(chunkIndex).push({
                status: String(row?.status || '').toLowerCase(),
                baseOffset: Math.max(0, Math.trunc(Number(row?.baseOffset) || 0)),
                outputText: typeof row?.outputText === 'string' ? row.outputText : '',
            });
        }
        for (const segments of groups.values()) {
            segments.sort((left, right) => left.baseOffset - right.baseOffset);
        }
        return groups;
    }

    function getGroupStatus(segments) {
        if (!segments || segments.length === 0) return 'missing';
        if (segments.some(segment => segment.status === 'failed')) return 'failed';
        return segments.every(segment => DONE_STATUSES.has(segment.status)) ? 'done' : 'pending';
    }

    async function createTranslatedSnapshot(options = {}) {
        const session = options.session || {};
        const groups = normalizeChunkGroups(options.rows);
        const startChunkIndex = Math.max(0, Math.trunc(Number(session.startChunkIndex) || 0));
        const highestChunkIndex = groups.size > 0 ? Math.max(...groups.keys()) : startChunkIndex - 1;
        const declaredTotal = Math.max(0, Math.trunc(Number(session.totalChunks) || 0));
        const endChunkIndex = Math.max(startChunkIndex, declaredTotal || (highestChunkIndex + 1));
        const totalChunks = Math.max(0, endChunkIndex - startChunkIndex);
        const parts = [];
        let completedChunks = 0;
        let stopReason = null;

        for (let chunkIndex = startChunkIndex; chunkIndex < endChunkIndex; chunkIndex += 1) {
            const segments = groups.get(chunkIndex);
            const status = getGroupStatus(segments);
            if (status !== 'done') {
                stopReason = status === 'failed' ? 'failed' : 'gap';
                break;
            }

            if (parts.length > 0) parts.push('\n\n');
            for (const segment of segments) parts.push(segment.outputText);
            completedChunks += 1;
        }

        const complete = Boolean(
            session.isComplete === true
            && completedChunks === totalChunks
            && stopReason === null
        );
        const partialReason = complete ? null : (stopReason || 'running');
        const outputName = String(
            session.outputFileName
            || String(session.fileName || 'truyen.txt').replace(/\.txt$/i, '_translated.txt')
        );

        return freezeSnapshot({
            blob: new Blob(parts, { type: 'text/plain;charset=utf-8' }),
            fileName: outputName,
            kind: 'translated',
            partial: !complete,
            partialReason,
            completedChunks,
            totalChunks,
            startChunkIndex,
            revision: options.revision ?? session.outputRevision ?? null,
        });
    }

    function inferMemoryRowStatus(chunkIndex, outputText) {
        const runtime = runtimeState();
        const tracker = Array.isArray(runtime.chunkTrackingData)
            ? runtime.chunkTrackingData[chunkIndex]
            : null;
        const trackerStatus = String(tracker?.status || '').toLowerCase();
        if (trackerStatus === 'failed') return 'failed';
        if (DONE_STATUSES.has(trackerStatus)) return 'done';
        if (!outputText) return trackerStatus || 'pending';
        if (/^\[(?:LỖI|ERROR)\s+CHUNK/i.test(outputText)) return 'failed';
        if (runtime.isTranslating) return trackerStatus || 'pending';
        return 'done';
    }

    async function collectCurrentOutputRows(sessionId, options = {}) {
        const rows = [];
        if (sessionId && typeof global.scanTranslatorSessionOutputRows === 'function') {
            try {
                const scanResult = await global.scanTranslatorSessionOutputRows(sessionId, {
                    maxChunks: 32,
                    maxChars: 64 * 1024,
                    onBatch(batch) {
                        for (const row of batch) rows.push(row);
                    },
                });
                return { rows, revision: scanResult?.revision };
            } catch (_error) {
                rows.length = 0;
            }
        }

        const runtime = runtimeState();
        const chunks = Array.isArray(runtime.translatedChunks) ? runtime.translatedChunks : [];
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
            const outputText = typeof chunks[chunkIndex] === 'string' ? chunks[chunkIndex] : '';
            rows.push({
                chunkIndex,
                status: inferMemoryRowStatus(chunkIndex, outputText),
                outputText,
            });
        }

        if (rows.length === 0 && options.allowTextFallback && !runtime.isTranslating) {
            const output = global.document?.getElementById?.('translatedText')?.value;
            if (typeof output === 'string' && output.length > 0) {
                rows.push({ chunkIndex: 0, status: 'done', outputText: output });
            }
        }
        return { rows, revision: runtime.outputGeneration ?? null };
    }

    async function createCurrentSourceSnapshot() {
        const runtime = runtimeState();
        const historyId = runtime.currentHistoryId || (!runtime.isTranslating ? runtime.lastHistoryId : null) || null;
        const historyItem = Array.isArray(runtime.translationHistory)
            ? runtime.translationHistory.find(item => item?.id === historyId) || null
            : null;
        const useInlineHistory = Boolean(
            historyItem
            && !historyItem.sessionId
            && typeof historyItem.originalText === 'string'
        );
        const source = !useInlineHistory && typeof global.getCurrentTranslatorSource === 'function'
            ? await global.getCurrentTranslatorSource()
            : null;
        const fallbackText = useInlineHistory
            ? historyItem.originalText
            : (global.document?.getElementById?.('originalText')?.value || '');
        const session = runtime.currentSessionMeta || {};
        const fileName = String(
            (useInlineHistory ? historyItem.name?.replace(/_translated\.txt$/i, '.txt') : '')
            || session.fileName
            || runtime.largeFileMeta?.name
            || runtime.originalFileName?.replace(/_translated\.txt$/i, '.txt')
            || 'truyen.txt'
        );
        const revision = useInlineHistory
            ? `history-source:${historyItem.id}:${historyItem.date || ''}`
            : source
            ? `source:${session.id || fileName}:${Number(source.size) || 0}:${Number(source.lastModified) || 0}`
            : `paste:${fallbackText.length}:${runtime.outputGeneration || 0}`;
        return createSourceSnapshot({ blob: source, text: fallbackText, fileName, revision });
    }

    async function createCurrentTranslatedSnapshot() {
        const runtime = runtimeState();
        const historyId = runtime.currentHistoryId || (!runtime.isTranslating ? runtime.lastHistoryId : null) || null;
        const historyItem = Array.isArray(runtime.translationHistory)
            ? runtime.translationHistory.find(item => item?.id === historyId) || null
            : null;
        const sessionId = historyItem?.sessionId || runtime.currentSessionId || null;
        const currentSession = sessionId && typeof global.getTranslatorSession === 'function'
            ? await global.getTranslatorSession(sessionId).catch(() => null)
            : null;
        let session = currentSession || (historyItem?.sessionId ? runtime.currentSessionMeta : null) || {
            fileName: runtime.originalFileName || 'truyen_translated.txt',
            startChunkIndex: Math.max(0, Math.trunc(Number(runtime.translationStartChunkIndex) || 0)),
            totalChunks: Number(runtime.totalChunksCount) || (runtime.translatedChunks?.length || 0),
            isComplete: !runtime.isTranslating,
        };
        let collected;
        if (!sessionId && historyItem && Array.isArray(historyItem.translatedChunksData)) {
            const startChunkIndex = Math.max(0, Math.trunc(Number(historyItem.startChunkIndex) || 0));
            const rows = historyItem.translatedChunksData.map((outputText, localIndex) => ({
                chunkIndex: startChunkIndex + localIndex,
                status: typeof outputText === 'string' && outputText.length > 0
                    ? (/^\[(?:LỖI|ERROR)\s+CHUNK/i.test(outputText) ? 'failed' : 'done')
                    : 'pending',
                outputText: typeof outputText === 'string' ? outputText : '',
            }));
            session = {
                fileName: historyItem.name || session.fileName,
                startChunkIndex,
                totalChunks: startChunkIndex + Math.max(0, Number(historyItem.totalChunks) || rows.length),
                isComplete: historyItem.isComplete === true,
            };
            collected = { rows, revision: `history:${historyItem.id}:${historyItem.date || ''}` };
        } else if (!sessionId && historyItem?.isComplete && typeof historyItem.translatedText === 'string') {
            session = {
                fileName: historyItem.name || session.fileName,
                startChunkIndex: 0,
                totalChunks: 1,
                isComplete: true,
            };
            collected = {
                rows: [{ chunkIndex: 0, status: 'done', outputText: historyItem.translatedText }],
                revision: `history:${historyItem.id}:${historyItem.date || ''}`,
            };
        } else {
            collected = await collectCurrentOutputRows(sessionId, { allowTextFallback: session.isComplete === true });
        }
        return createTranslatedSnapshot({
            session,
            rows: collected.rows,
            revision: collected.revision ?? runtime.outputGeneration ?? null,
        });
    }

    global.TranslatorChapterSnapshot = Object.freeze({
        createCurrentSourceSnapshot,
        createCurrentTranslatedSnapshot,
        createSourceSnapshot,
        createTranslatedSnapshot,
        normalizeChunkGroups,
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);
