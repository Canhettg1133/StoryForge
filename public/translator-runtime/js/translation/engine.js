/**
 * Novel Translator Pro - Translation Engine
 * Xử lý dịch văn bản song song
 */

// ============================================
// MAIN TRANSLATION ENGINE
// ============================================
const TRANSLATION_PREVIEW_MAX_CHARS = 200000;
const TRANSLATION_PREVIEW_UPDATE_INTERVAL_MS = 500;
const TRANSLATION_HISTORY_PERSIST_INTERVAL_MS = 5000;
const TRANSLATION_HISTORY_PERSIST_CHUNK_STEP = 10;
const TRANSLATION_PREVIEW_TAIL_RATIO = 0.35;
const TRANSLATION_PREVIEW_NOTICE_RESERVED_CHARS = 240;
const TRANSLATION_RESUME_PREVIEW_OLD_CHUNKS = 3;

const TRANSLATOR_SOURCE_LANGUAGE_LABELS = {
    auto: 'Tự động phát hiện',
    'zh-CN': 'Tiếng Trung (Giản thể)',
    'zh-TW': 'Tiếng Trung (Phồn thể)',
    en: 'Tiếng Anh',
    ja: 'Tiếng Nhật',
    ko: 'Tiếng Hàn',
    th: 'Tiếng Thái',
    id: 'Tiếng Indonesia',
    ru: 'Tiếng Nga',
    fr: 'Tiếng Pháp',
    es: 'Tiếng Tây Ban Nha',
};

function normalizeTranslatorSourceLanguage(sourceLang) {
    const normalized = String(sourceLang || 'auto').trim();
    return TRANSLATOR_SOURCE_LANGUAGE_LABELS[normalized] ? normalized : 'auto';
}

function getTranslatorSourceLanguageLabel(sourceLang) {
    return TRANSLATOR_SOURCE_LANGUAGE_LABELS[normalizeTranslatorSourceLanguage(sourceLang)];
}

function buildTranslatorLanguageDirective(sourceLang = 'auto') {
    const normalized = normalizeTranslatorSourceLanguage(sourceLang);

    if (normalized === 'auto') {
        return `[YÊU CẦU NGÔN NGỮ NGUỒN]
- Tự động phát hiện ngôn ngữ nguồn của đoạn văn bên dưới.
- Hãy dịch trực tiếp sang tiếng Việt toàn bộ nội dung từ bất kỳ ngôn ngữ nào, mượt mà và tự nhiên.
- Nếu đoạn nguồn đã là tiếng Việt convert/dịch máy, hãy biên tập lại cho đúng tiếng Việt tự nhiên.
- Chỉ trả về bản tiếng Việt cuối cùng, không giải thích, không giữ nguyên tiếng nước ngoài nếu không phải tên riêng/thuật ngữ.`;
    }

    return `[YÊU CẦU NGÔN NGỮ NGUỒN]
- Ngôn ngữ nguồn người dùng chọn: ${getTranslatorSourceLanguageLabel(normalized)}.
- Hãy dịch trực tiếp sang tiếng Việt toàn bộ nội dung từ ${getTranslatorSourceLanguageLabel(normalized)}, mượt mà và tự nhiên.
- Giữ tên riêng, địa danh, thuật ngữ và sắc thái truyện; không tự ý tóm tắt hoặc bỏ đoạn.
- Chỉ trả về bản tiếng Việt cuối cùng, không giải thích, không giữ nguyên tiếng nguồn nếu không phải tên riêng/thuật ngữ.`;
}

function buildPromptedChunk(promptText, chunkText, sourceLang = 'auto') {
    const directive = buildTranslatorLanguageDirective(sourceLang);
    const prompt = String(promptText || '').trim();
    const source = String(chunkText || '').trim();
    return `${directive}${prompt ? `\n\n${prompt}` : ''}\n\n[Đoạn nguồn]\n${source}`;
}

function resolveEffectiveTranslationParallel(options = {}) {
    const requestedParallel = typeof normalizeTranslatorParallel === 'function'
        ? normalizeTranslatorParallel(options.requestedParallel)
        : Math.max(1, Math.min(50, Number(options.requestedParallel) || 1));
    const useOllamaMode = Boolean(options.useOllamaMode);

    if (useOllamaMode) return 1;
    return requestedParallel;
}

function getProxyDispatchSlot(chunkIndex) {
    const rpmSlice = typeof normalizeTranslatorRpm === 'function'
        ? normalizeTranslatorRpm(rpmPerKey)
        : Math.max(1, Number(rpmPerKey) || 1);
    const safeIndex = Number.isFinite(Number(chunkIndex)) ? Math.max(0, Math.trunc(Number(chunkIndex))) : 0;
    return safeIndex % Math.max(1, rpmSlice);
}

function orderProxyBatchIndicesForDispatch(indices) {
    return Array.isArray(indices) ? indices : [];
}

async function settleChunkPromisesIndividually(promises, onSettled) {
    await Promise.all(promises.map((promise, index) => {
        if (promise && typeof promise.then === 'function') {
            return promise.then(
                (value) => onSettled({ status: 'fulfilled', value }, index),
                (reason) => onSettled({ status: 'rejected', reason }, index)
            );
        }
        return onSettled({ status: 'fulfilled', value: promise }, index);
    }));
}

function getTranslatedChunkDisplayText(chunk, index, pendingLabel, chunkIndexOffset = 0) {
    return chunk !== null && chunk !== undefined
        ? String(chunk)
        : `[${pendingLabel} chunk ${chunkIndexOffset + index + 1}]`;
}

function buildTranslatedTextFromChunks(chunksArray, pendingLabel = '⏳ Chưa dịch') {
    if (!Array.isArray(chunksArray)) return '';
    return chunksArray
        .map((chunk, idx) => getTranslatedChunkDisplayText(chunk, idx, pendingLabel))
        .join('\n\n');
}

function slicePreviewText(text, maxChars) {
    const sliced = String(text || '').slice(0, Math.max(0, maxChars));
    if (!sliced) return '';

    const lastCode = sliced.charCodeAt(sliced.length - 1);
    if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
        return sliced.slice(0, -1);
    }
    return sliced;
}

function slicePreviewTextFromEnd(text, maxChars) {
    const source = String(text || '');
    const sliced = source.slice(Math.max(0, source.length - Math.max(0, maxChars)));
    if (!sliced) return '';

    const firstCode = sliced.charCodeAt(0);
    if (firstCode >= 0xDC00 && firstCode <= 0xDFFF) {
        return sliced.slice(1);
    }
    return sliced;
}

function collectPreviewFromStart(chunksArray, pendingLabel, maxChars, endExclusive = chunksArray.length, chunkIndexOffset = 0) {
    const parts = [];
    let usedChars = 0;
    let nextIndex = 0;

    for (let idx = 0; idx < endExclusive; idx += 1) {
        const separatorLength = parts.length > 0 ? 2 : 0;
        const text = getTranslatedChunkDisplayText(chunksArray[idx], idx, pendingLabel, chunkIndexOffset);
        const nextLength = usedChars + separatorLength + text.length;

        if (nextLength > maxChars) {
            const remainingChars = maxChars - usedChars - separatorLength;
            if (remainingChars > 80) {
                parts.push(slicePreviewText(text, remainingChars));
                nextIndex = idx + 1;
            } else {
                nextIndex = idx;
            }
            return { parts, nextIndex };
        }

        parts.push(text);
        usedChars = nextLength;
        nextIndex = idx + 1;
    }

    return { parts, nextIndex };
}

function collectPreviewFromEnd(chunksArray, pendingLabel, maxChars, minIndex = 0, chunkIndexOffset = 0) {
    const parts = [];
    let usedChars = 0;
    let startIndex = chunksArray.length;

    for (let idx = chunksArray.length - 1; idx >= minIndex; idx -= 1) {
        const separatorLength = parts.length > 0 ? 2 : 0;
        const text = getTranslatedChunkDisplayText(chunksArray[idx], idx, pendingLabel, chunkIndexOffset);
        const nextLength = usedChars + separatorLength + text.length;

        if (nextLength > maxChars) {
            const remainingChars = maxChars - usedChars - separatorLength;
            if (remainingChars > 80) {
                parts.unshift(slicePreviewTextFromEnd(text, remainingChars));
                startIndex = idx;
            } else {
                startIndex = idx + 1;
            }
            return { parts, startIndex };
        }

        parts.unshift(text);
        usedChars = nextLength;
        startIndex = idx;
    }

    return { parts, startIndex };
}

function buildTranslatedTextPreview(chunksArray, options = {}) {
    if (!Array.isArray(chunksArray)) return '';

    const pendingLabel = options.pendingLabel || '⏳ Đang dịch';
    const maxChars = Math.max(1000, Number(options.maxChars) || TRANSLATION_PREVIEW_MAX_CHARS);
    const chunkIndexOffset = Math.max(0, Number(options.chunkIndexOffset) || 0);
    const fullPreview = collectPreviewFromStart(chunksArray, pendingLabel, maxChars, chunksArray.length, chunkIndexOffset);
    if (fullPreview.nextIndex >= chunksArray.length) {
        return fullPreview.parts.join('\n\n');
    }

    const tailBudget = Math.min(
        Math.max(4000, Math.floor(maxChars * TRANSLATION_PREVIEW_TAIL_RATIO)),
        Math.max(4000, maxChars - TRANSLATION_PREVIEW_NOTICE_RESERVED_CHARS - 1000)
    );
    const headBudget = Math.max(1000, maxChars - tailBudget - TRANSLATION_PREVIEW_NOTICE_RESERVED_CHARS);

    const headPreview = collectPreviewFromStart(chunksArray, pendingLabel, headBudget, chunksArray.length, chunkIndexOffset);
    const tailPreview = collectPreviewFromEnd(chunksArray, pendingLabel, tailBudget, headPreview.nextIndex, chunkIndexOffset);
    const omittedChunks = Math.max(0, tailPreview.startIndex - headPreview.nextIndex);
    const parts = [...headPreview.parts];

    if (omittedChunks > 0) {
        parts.push(`[Bản xem trước đã rút gọn: ẩn ${omittedChunks} chunk ở giữa để giữ phần đầu và phần cuối. Dữ liệu đầy đủ vẫn được lưu để tải xuống hoặc tiếp tục dịch.]`);
    }

    parts.push(...tailPreview.parts);
    return parts.join('\n\n');
}

function isChunkSuccessfullyTranslatedForResume(chunkText) {
    if (typeof chunkText !== 'string') return false;

    const text = chunkText.trim();
    if (!text) return false;

    if (text.startsWith('[LỖI CHUNK')) return false;
    if (/^\[❌\s*Chunk\s+\d+\s+thất bại\]/i.test(text)) return false;
    if (text.includes('CẦN DỊCH THỦ CÔNG')) return false;
    if (/^\[⏳/i.test(text)) return false;

    return true;
}

function buildHistoryTextSnapshotFromChunks(chunksArray) {
    return buildTranslatedTextFromChunks(chunksArray, '⏳ Chưa dịch');
}

function isLargeFileSourceActive() {
    return currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE && currentSourceFile;
}

function setTranslationButtonsBusy(isBusy) {
    const translateBtn = document.getElementById('translateBtn');
    if (translateBtn) {
        translateBtn.disabled = isBusy;
        translateBtn.innerHTML = isBusy
            ? '<span class="btn-icon">⏳</span><span class="btn-text">Đang dịch...</span>'
            : '<span class="btn-icon">🚀</span><span class="btn-text">Bắt đầu dịch</span>';
    }

    const pauseBtn = document.getElementById('pauseBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    if (pauseBtn) {
        pauseBtn.classList.remove('paused');
        pauseBtn.innerHTML = '<span class="btn-icon">⏸️</span><span class="btn-text">Tạm dừng</span>';
    }
    if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.classList.remove('cancelling');
        cancelBtn.innerHTML = '<span class="btn-icon">⏹️</span><span class="btn-text">Hủy dịch</span>';
    }
}

function resolveRuntimeParallel(parallelCount) {
    if (useOllama) {
        return {
            effectiveParallel: resolveEffectiveTranslationParallel({
                requestedParallel: parallelCount,
                useOllamaMode: true,
                useProxyMode: false,
            }),
            staggerDelayMs: 0,
        };
    }

    if (useProxy) {
        const effectiveParallel = resolveEffectiveTranslationParallel({
            requestedParallel: parallelCount,
            useOllamaMode: false,
            useProxyMode: true,
        });
        return {
            effectiveParallel,
            staggerDelayMs: 0,
        };
    }

    return {
        effectiveParallel: resolveEffectiveTranslationParallel({
            requestedParallel: parallelCount,
            useOllamaMode: false,
            useProxyMode: false,
        }),
        staggerDelayMs: 0,
    };
}

function buildLargeFileResultPreview(pendingLabel = '⏳ Đang dịch', forceMaxChars = 60000) {
    return buildResumedTranslationPreview(
        translatedChunks,
        translationStartChunkIndex,
        pendingLabel,
        forceMaxChars
    );
}

function buildResumedTranslationPreview(chunksArray, startChunkIndex, pendingLabel = '⏳ Đang dịch', maxChars = 60000) {
    const safeChunks = Array.isArray(chunksArray) ? chunksArray : [];
    const safeStart = Math.max(0, Math.min(safeChunks.length, Number(startChunkIndex) || 0));
    if (safeStart <= 0) {
        return buildTranslatedTextPreview(safeChunks, { pendingLabel, maxChars });
    }

    const previousChunks = safeChunks
        .slice(0, safeStart)
        .filter((chunk) => typeof chunk === 'string' && chunk.length > 0)
        .slice(-TRANSLATION_RESUME_PREVIEW_OLD_CHUNKS);
    if (previousChunks.length === 0) {
        return buildTranslatedTextPreview(safeChunks.slice(safeStart), {
            pendingLabel,
            maxChars,
            chunkIndexOffset: safeStart,
        });
    }

    const notice = `[Chỉ hiển thị ${previousChunks.length} chunk đã dịch gần nhất trước khi tiếp tục. Bản dịch đầy đủ vẫn được giữ để tải xuống.]`;
    const safeMaxChars = Math.max(1000, Number(maxChars) || 60000);
    const availableChars = Math.max(2000, safeMaxChars - notice.length - 4);
    const previousBudget = Math.min(12000, Math.max(1000, Math.floor(availableChars * 0.25)));
    const activeBudget = Math.max(1000, availableChars - previousBudget);
    const previousPreview = buildTranslatedTextPreview(previousChunks, {
        pendingLabel,
        maxChars: previousBudget,
    });
    const activePreview = buildTranslatedTextPreview(safeChunks.slice(safeStart), {
        pendingLabel,
        maxChars: activeBudget,
        chunkIndexOffset: safeStart,
    });

    return slicePreviewText(
        [notice, previousPreview, activePreview].filter(Boolean).join('\n\n'),
        safeMaxChars
    );
}

async function startLargeFileTranslation({ sourceLang, chunkSize, parallelCount, customPrompt }) {
    if (!currentSourceFile || typeof createLazyChunkReader !== 'function') {
        showToast('Không tìm thấy file lớn để dịch.', 'error');
        return;
    }

    const sessionId = currentTranslatorSessionId || largeFileMeta?.sessionId || null;
    let localSession = currentTranslatorSessionMeta || null;
    if (!localSession && sessionId && typeof getTranslatorSession === 'function') {
        localSession = await getTranslatorSession(sessionId);
        currentTranslatorSessionMeta = localSession || currentTranslatorSessionMeta;
    }
    const startChunkIndex = Math.max(0, Number(translationStartChunkIndex || localSession?.startChunkIndex || 0) || 0);
    const scopeStartChunkIndex = Math.max(0, Number(localSession?.startChunkIndex || 0) || 0);
    const startByte = Math.max(0, Number(translationStartByte || localSession?.startByte || 0) || 0);
    const scopeStartByte = Math.max(0, Number(localSession?.startByte || 0) || 0);
    const knownTotalChunks = Math.max(0, Number(localSession?.totalChunks || largeFileMeta?.estimatedChunks || 0) || 0);
    let historyTotalChunks = Math.max(knownTotalChunks > 0 ? knownTotalChunks - scopeStartChunkIndex : 0, 1);
    let largeFileRunStatus = 'failed';
    let shouldStartNextQueue = false;
    let largeIssueSummary = null;

    isTranslating = true;
    cancelRequested = false;
    isPaused = false;
    translatedChunks = knownTotalChunks > 0 ? new Array(knownTotalChunks).fill(null) : [];
    translatedBlobParts = [];
    originalChunks = [];
    completedChunks = 0;
    totalChunksCount = knownTotalChunks;
    largeFileByteCursor = startByte;
    startTime = Date.now();

    if (sessionId && typeof getTranslatorSessionChunks === 'function') {
        const storedChunks = await getTranslatorSessionChunks(sessionId);
        if (storedChunks.length > translatedChunks.length) {
            translatedChunks = new Array(storedChunks.length).fill(null);
        }
        storedChunks.forEach((chunk) => {
            if (typeof chunk.outputText === 'string' && chunk.outputText.length > 0) {
                translatedChunks[chunk.chunkIndex] = chunk.outputText;
            }
        });
        if (typeof summarizeTranslatorChunks === 'function') {
            const summary = summarizeTranslatorChunks(storedChunks, scopeStartChunkIndex);
            completedChunks = summary.completedChunks;
            historyTotalChunks = Math.max(1, summary.totalChunks);
        } else {
            completedChunks = storedChunks.filter((chunk) => (
                (chunk.status === 'done' || chunk.status === 'failed') &&
                typeof chunk.outputText === 'string' && chunk.outputText.length > 0
            )).length;
        }
        totalChunksCount = Math.max(totalChunksCount, storedChunks.length);
    }

    if (sessionId && startChunkIndex > 0 && typeof markTranslatorChunksBefore === 'function') {
        await markTranslatorChunksBefore(sessionId, startChunkIndex);
    }
    if (sessionId && typeof updateTranslatorSession === 'function') {
        currentTranslatorSessionMeta = await updateTranslatorSession(sessionId, {
            status: 'running',
        }) || currentTranslatorSessionMeta;
    }

    const largeHistoryMetadata = () => ({
        sourceMode: TRANSLATOR_SOURCE_MODES.LARGE_FILE,
        sessionId,
        fileSize: Number(currentSourceFile.size || 0),
        startChunkIndex: scopeStartChunkIndex,
        startByte: scopeStartByte,
        charCount: Number(currentSourceFile.size || 0),
        totalChunks: historyTotalChunks,
    });

    const refreshLargeChunkIssueSummary = async (shouldRender = false) => {
        if (typeof summarizeTranslatorChunkIssues !== 'function') return null;

        let issueRows = [];
        if (sessionId && typeof getTranslatorSessionChunks === 'function') {
            issueRows = await getTranslatorSessionChunks(sessionId);
        } else if (Array.isArray(translatedChunks)) {
            issueRows = translatedChunks;
        }

        largeIssueSummary = summarizeTranslatorChunkIssues({
            chunks: issueRows,
            startChunkIndex: scopeStartChunkIndex,
            totalChunks: Math.max(issueRows.length, knownTotalChunks),
        });
        if (shouldRender && typeof renderChunkIssuePanel === 'function') {
            renderChunkIssuePanel(largeIssueSummary);
        }
        return largeIssueSummary;
    };

    if (!currentHistoryId && typeof addToHistory === 'function') {
        currentHistoryId = addToHistory(
            originalFileName,
            largeFileMeta?.previewText || '',
            buildLargeFileResultPreview('⏳ Chưa dịch', 60000),
            [],
            completedChunks,
            historyTotalChunks,
            null,
            chunkSize,
            largeHistoryMetadata()
        );
    }
    if (sessionId && currentHistoryId && typeof updateTranslatorSession === 'function') {
        currentTranslatorSessionMeta = await updateTranslatorSession(sessionId, {
            historyId: currentHistoryId,
        }) || currentTranslatorSessionMeta;
    }
    if (typeof flushHistoryWrites === 'function') {
        await flushHistoryWrites();
    }

    setTranslationButtonsBusy(true);
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
    document.getElementById('translatedText').value = buildLargeFileResultPreview('⏳ Chưa dịch');
    updateLargeFileProgress({
        byteCursor: startByte,
        fileSize: currentSourceFile.size,
        completed: completedChunks,
        status: startChunkIndex > 0
            ? `Bắt đầu dịch từ chunk ${startChunkIndex + 1}...`
            : 'Bắt đầu dịch file lớn...',
    });
    updateProgressStats(0, getActiveKeyCount(), '--:--');

    if (typeof initChunkTracker === 'function') {
        initChunkTracker([], null, customPrompt, { dynamic: true, largeFile: true });
    }

    const { effectiveParallel, staggerDelayMs } = resolveRuntimeParallel(parallelCount);
    const pendingBatch = [];
    let lastPreviewUpdateAt = 0;
    let lastHistoryPersistAt = 0;
    let lastHistoryPersistCompleted = -1;
    const contextBeforeStart = sessionId && startChunkIndex > 0 && typeof getTranslatorContextBeforeChunk === 'function'
        ? await getTranslatorContextBeforeChunk(sessionId, startChunkIndex, 3)
        : '';

    const buildPromptForLargeChunk = (chunk) => {
        if (contextBeforeStart && chunk.index === startChunkIndex) {
            const contextualPrompt = `${customPrompt || ''}\n\nNgữ cảnh tham khảo từ các chunk trước, chỉ dùng để giữ tên riêng, xưng hô và giọng văn. Không dịch lại phần ngữ cảnh này:\n${contextBeforeStart}\n\nChỉ dịch chunk hiện tại bên dưới.`;
            return buildPromptedChunk(contextualPrompt, chunk.text, sourceLang);
        }
        return buildPromptedChunk(customPrompt, chunk.text, sourceLang);
    };

    const updateLargePreview = (label = '⏳ Đang dịch', force = false) => {
        const now = Date.now();
        if (!force && now - lastPreviewUpdateAt < TRANSLATION_PREVIEW_UPDATE_INTERVAL_MS) return;
        lastPreviewUpdateAt = now;
        const resultEl = document.getElementById('translatedText');
        if (resultEl) {
            resultEl.value = buildLargeFileResultPreview(label);
        }
    };

    const persistLargeHistoryProgress = (force = false) => {
        if (!currentHistoryId || typeof updateHistoryProgress !== 'function') return;
        const now = Date.now();
        const completedDelta = Math.abs(completedChunks - lastHistoryPersistCompleted);
        if (!force &&
            completedDelta < TRANSLATION_HISTORY_PERSIST_CHUNK_STEP &&
            now - lastHistoryPersistAt < TRANSLATION_HISTORY_PERSIST_INTERVAL_MS) {
            return;
        }
        lastHistoryPersistAt = now;
        lastHistoryPersistCompleted = completedChunks;
        updateHistoryProgress(
            currentHistoryId,
            buildLargeFileResultPreview(cancelRequested ? '⏳ Chưa dịch' : '⏳ Đang dịch', 60000),
            [],
            completedChunks,
            null,
            chunkSize,
            largeHistoryMetadata()
        );
    };

    const processBatch = async (batch, rpmPlan = null) => {
        if (!batch.length || cancelRequested) return;

        batch.forEach((chunk) => {
            if (typeof trackChunkStart === 'function') {
                trackChunkStart(chunk.index);
            }
        });

        const dispatchIndices = useProxy && typeof buildTranslatorWaveAssignments === 'function'
            ? buildTranslatorWaveAssignments(batch.map((chunk) => chunk.index), rpmPlan).map((assignment) => assignment.chunkIndex)
            : orderProxyBatchIndicesForDispatch(batch.map((chunk) => chunk.index));
        const dispatchBatch = dispatchIndices
            .map((chunkIndex) => batch.find((chunk) => chunk.index === chunkIndex))
            .filter(Boolean);

        const promises = dispatchBatch.map((chunk, batchOffset) => (async () => {
            await sleep(batchOffset * staggerDelayMs);
            if (cancelRequested) throw new Error('TRANSLATION_CANCELLED');
            const promptedChunk = buildPromptForLargeChunk(chunk);
            return translateChunkWithRetry(promptedChunk, chunk.index);
        })());

        const refreshBatchProgress = () => {
            const elapsed = Math.max(1, (Date.now() - startTime) / 1000);
            const speed = completedChunks / elapsed;
            updateLargeFileProgress({
                byteCursor: largeFileByteCursor,
                fileSize: currentSourceFile.size,
                completed: completedChunks,
                status: `Đang dịch file lớn... ${completedChunks.toLocaleString('vi-VN')} chunk đã xong`,
            });
            updateProgressStats(speed.toFixed(1), getActiveKeyCount(), '--:--');
            updateLargePreview('⏳ Đang dịch');
            persistLargeHistoryProgress();
        };

        await settleChunkPromisesIndividually(promises, async (result, idx) => {
            const chunk = dispatchBatch[idx];
            if (result.status === 'fulfilled') {
                translatedChunks[chunk.index] = result.value;
                completedChunks += 1;
                if (sessionId && typeof updateTranslatorChunkResult === 'function') {
                    await updateTranslatorChunkResult(sessionId, chunk.index, {
                        status: 'done',
                        outputText: result.value,
                    });
                }
                if (typeof trackChunkSuccess === 'function') {
                    trackChunkSuccess(chunk.index, result.value, '');
                }
                refreshBatchProgress();
                return;
            }

            const reasonText = String(result.reason?.message || result.reason || '');
            if (cancelRequested || reasonText.includes('TRANSLATION_CANCELLED')) return;

            const userReason = typeof formatTranslatorError === 'function'
                ? formatTranslatorError(result.reason)
                : reasonText;
            translatedChunks[chunk.index] = `[LỖI CHUNK ${chunk.index + 1}]\nNguyên nhân: ${userReason}\n\n${chunk.text}`;
            completedChunks += 1;
            if (sessionId && typeof updateTranslatorChunkResult === 'function') {
                await updateTranslatorChunkResult(sessionId, chunk.index, {
                    status: 'failed',
                    outputText: translatedChunks[chunk.index],
                    error: userReason,
                });
            }
            if (typeof trackChunkFailed === 'function') {
                trackChunkFailed(chunk.index, userReason);
            }
            refreshBatchProgress();
        });
    };

    try {
        persistLargeHistoryProgress(true);
        const reader = createLazyChunkReader(currentSourceFile, {
            chunkSize,
            startByte,
            startIndex: startChunkIndex,
        });
        for await (const chunk of reader) {
            await waitWhilePaused();
            if (cancelRequested) break;

            largeFileByteCursor = chunk.byteEnd;
            totalChunksCount = Math.max(totalChunksCount, chunk.index + 1);
            if (typeof trackChunkDiscovered === 'function') {
                trackChunkDiscovered(chunk.index, chunk.text);
            }

            pendingBatch.push(chunk);
            const targetBatchSize = typeof getTranslatorRpmMaxBatchSize === 'function'
                ? getTranslatorRpmMaxBatchSize({ requestedParallel: effectiveParallel })
                : effectiveParallel;
            while (pendingBatch.length >= targetBatchSize) {
                const rpmPlan = typeof waitForTranslatorRpmBatchPlan === 'function'
                    ? await waitForTranslatorRpmBatchPlan({ requestedParallel: effectiveParallel, remainingChunks: pendingBatch.length })
                    : { capacity: effectiveParallel };
                if (cancelRequested || rpmPlan.capacity <= 0) break;
                const batch = pendingBatch.splice(0, Math.min(rpmPlan.capacity, pendingBatch.length));
                await processBatch(batch, rpmPlan);
                if (cancelRequested) break;
            }
        }

        while (!cancelRequested && pendingBatch.length > 0) {
            const rpmPlan = typeof waitForTranslatorRpmBatchPlan === 'function'
                ? await waitForTranslatorRpmBatchPlan({ requestedParallel: effectiveParallel, remainingChunks: pendingBatch.length })
                : { capacity: effectiveParallel };
            if (cancelRequested || rpmPlan.capacity <= 0) break;
            await processBatch(pendingBatch.splice(0, Math.min(rpmPlan.capacity, pendingBatch.length)), rpmPlan);
        }

        document.getElementById('resultSection').style.display = 'block';
        updateLargePreview(cancelRequested ? '⏳ Chưa dịch' : '✅ Hoàn thành', true);
        persistLargeHistoryProgress(true);
        await refreshLargeChunkIssueSummary(false);

        if (!cancelRequested) {
            largeFileRunStatus = 'completed';
            updateLargeFileProgress({
                byteCursor: currentSourceFile.size,
                fileSize: currentSourceFile.size,
                completed: completedChunks,
                status: 'Hoàn thành file lớn. Dùng Tải xuống để lấy toàn bộ bản dịch.',
            });
            if (largeIssueSummary?.issueCount > 0) {
                showToast(`Dịch hoàn tất ${completedChunks.toLocaleString('vi-VN')} chunk, còn ${largeIssueSummary.issueCount} chunk cần xử lý.`, 'warning');
            } else {
                showToast(`Dịch hoàn tất ${completedChunks.toLocaleString('vi-VN')} chunk.`, 'success');
            }
        } else {
            largeFileRunStatus = 'cancelled';
            showToast('Đã hủy dịch file lớn. Tiến trình đã được lưu vào lịch sử cục bộ.', 'warning');
        }

        document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        const errorText = String(error?.message || error || '');
        if (cancelRequested || errorText.includes('TRANSLATION_CANCELLED')) {
            largeFileRunStatus = 'cancelled';
            document.getElementById('resultSection').style.display = 'block';
            updateLargePreview('⏳ Chưa dịch', true);
            persistLargeHistoryProgress(true);
            showToast('Đã hủy dịch file lớn. Tiến trình đã được lưu vào lịch sử cục bộ.', 'warning');
            return;
        }

        console.error('Large-file translation error:', error);
        const userMessage = typeof formatTranslatorError === 'function'
            ? formatTranslatorError(error, 'Dịch file lớn thất bại')
            : 'Dịch file lớn thất bại. Chi tiết kỹ thuật đã được ghi trong Console.';
        showToast(userMessage, 'error');
    } finally {
        persistLargeHistoryProgress(true);
        if (typeof flushHistoryWrites === 'function') {
            await flushHistoryWrites();
        }
        if (sessionId && typeof updateTranslatorSession === 'function') {
            await updateTranslatorSession(sessionId, {
                status: largeFileRunStatus,
                isComplete: largeFileRunStatus === 'completed',
                completedChunks,
                historyId: currentHistoryId,
            });
        }
        if (currentTranslatorQueueItemId && typeof updateTranslatorQueueItemStatus === 'function') {
            await updateTranslatorQueueItemStatus(currentTranslatorQueueItemId, largeFileRunStatus);
            currentTranslatorQueueItemId = null;
            shouldStartNextQueue = largeFileRunStatus === 'completed';
        } else if (largeFileRunStatus === 'completed') {
            shouldStartNextQueue = true;
        }
        isTranslating = false;
        isPaused = false;
        setTranslationButtonsBusy(false);
        await refreshLargeChunkIssueSummary(true);
        const cancelModal = document.getElementById('cancelModal');
        if (cancelModal) cancelModal.style.display = 'none';
        updateStats();
        if (typeof renderTranslationQueue === 'function') {
            await renderTranslationQueue();
        }
        if (shouldStartNextQueue && typeof processNextTranslatorQueue === 'function') {
            setTimeout(() => processNextTranslatorQueue(), 0);
        }
    }
}

async function startTranslation() {
    if (typeof requireStoryForgeFeature === 'function') {
        const canUseTranslator = await requireStoryForgeFeature('translator.access');
        if (!canUseTranslator) return;
    }

    // Validate - Ollama/Proxy không cần API keys
    if (!useOllama && !useProxy && apiKeys.length === 0) {
        showToast('Vui lòng thêm ít nhất 1 API Key, bật Ollama Local, hoặc bật Proxy API!', 'error');
        return;
    }

    const largeFileSource = isLargeFileSourceActive();
    const text = largeFileSource ? '' : document.getElementById('originalText').value.trim();
    if (!largeFileSource && !text) {
        showToast('Vui lòng nhập hoặc tải file truyện!', 'error');
        return;
    }

    // Get settings
    const sourceLang = document.getElementById('sourceLang').value;
    const chunkSize = parseInt(document.getElementById('chunkSize').value) || 4500;
    let parallelCount = typeof normalizeTranslatorParallel === 'function'
        ? normalizeTranslatorParallel(document.getElementById('parallelCount')?.value || 5)
        : (parseInt(document.getElementById('parallelCount')?.value, 10) || 5);
    rpmPerKey = typeof normalizeTranslatorRpm === 'function'
        ? normalizeTranslatorRpm(document.getElementById('rpmPerKey')?.value || rpmPerKey)
        : (parseInt(document.getElementById('rpmPerKey')?.value, 10) || 10);
    if (
        parallelCount > 2
        && typeof hasStoryForgeFeature === 'function'
        && !hasStoryForgeFeature('translator.parallel_high')
    ) {
        parallelCount = 2;
        showToast('Tài khoản chưa có VIP nên giới hạn dịch song song còn 2 luồng.', 'warning');
    }
    const promptInput = document.getElementById('customPrompt');
    let customPrompt = typeof ensureCharacterNameConsistencyPrompt === 'function'
        ? ensureCharacterNameConsistencyPrompt(promptInput?.value || '')
        : (promptInput?.value || '');
    if (typeof applyActiveCanonPackToPrompt === 'function') {
        customPrompt = await applyActiveCanonPackToPrompt(customPrompt);
    }
    if (promptInput && promptInput.value !== customPrompt) {
        promptInput.value = customPrompt;
    }
    if (typeof syncActiveTranslatorTemplateFromPrompt === 'function') {
        syncActiveTranslatorTemplateFromPrompt(customPrompt);
    }
    if (typeof requireStoryForgeAdultTemplateAccess === 'function') {
        const canUseAdultTemplate = await requireStoryForgeAdultTemplateAccess();
        if (!canUseAdultTemplate) return;
    }

    // ========== OLLAMA MODE ==========
    if (useOllama) {
        console.log('[Ollama] Mode enabled - skipping Gemini quota checks');
        parallelCount = 1;
        if (typeof resetOllamaSpeed === 'function') {
            resetOllamaSpeed();
        }
    } else if (useProxy) {
        // ========== PROXY MODE ==========
        const providerFeature = activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY
            ? 'provider.custom_proxy'
            : 'provider.ag_proxy';
        if (typeof requireStoryForgeFeature === 'function') {
            const canUseProvider = await requireStoryForgeFeature(providerFeature);
            if (!canUseProvider) return;
        }

        const proxyKeyCount = typeof getProxyKeyCount === 'function' ? getProxyKeyCount() : 1;
        console.log(`[Proxy] Mode enabled - ${proxyKeyCount} key(s) available`);
        const activeProxyModel = typeof getActiveProxyModel === 'function' ? getActiveProxyModel() : proxyModel;

        if (proxyKeyCount <= 0) {
            showToast('Vui lòng thêm ít nhất 1 proxy API key trước khi dịch.', 'error');
            return;
        }

        if (!activeProxyModel) {
            showToast('Vui lòng chọn model proxy trước khi dịch.', 'error');
            return;
        }

        parallelCount = typeof normalizeTranslatorParallel === 'function'
            ? normalizeTranslatorParallel(parallelCount)
            : Math.max(1, Math.min(parallelCount, 50));
        if (proxyKeyCount > 0 && parallelCount > proxyKeyCount) {
            showToast(`Proxy có ${proxyKeyCount} key nhưng đang chạy ${parallelCount} luồng; dễ gặp 429/403 nếu server giới hạn tốc độ.`, 'warning');
        }

        console.log(`[Proxy] Using parallel=${parallelCount}, rpmPerKey=${rpmPerKey}, keys=${proxyKeyCount}, model=${activeProxyModel}`);
    } else {
        // ========== GEMINI DIRECT MODE ==========
        const directKeyCount = Array.isArray(apiKeys)
            ? apiKeys.filter(key => String(key || '').trim()).length
            : 0;
        const activeDirectModels = typeof getActiveModels === 'function' ? getActiveModels() : [];

        if (directKeyCount <= 0) {
            showToast('Vui lòng thêm ít nhất 1 API key Gemini Direct trước khi dịch.', 'error');
            return;
        }

        if (activeDirectModels.length === 0) {
            showToast('Vui lòng chọn model Gemini Direct trước khi dịch.', 'error');
            return;
        }

        console.log(`[Gemini Direct] Using parallel=${parallelCount}, rpmPerKey=${rpmPerKey}, keys=${directKeyCount}, model=${activeDirectModels[0].name}`);
    }

    if (largeFileSource) {
        return startLargeFileTranslation({
            sourceLang,
            chunkSize,
            parallelCount,
            customPrompt,
        });
    }

    // Split text into chunks
    const chunks = splitTextIntoChunks(text, chunkSize);

    if (chunks.length === 0) {
        showToast('Không có nội dung để dịch!', 'error');
        return;
    }

    const textStartChunkIndex = currentTranslatorSessionId
        ? Math.max(0, Math.min(chunks.length - 1, Number(translationStartChunkIndex) || 0))
        : 0;
    const textHistoryTotalChunks = Math.max(1, chunks.length - textStartChunkIndex);
    if (textStartChunkIndex > 0 && currentTranslatorSessionId && typeof markTranslatorChunksBefore === 'function') {
        await markTranslatorChunksBefore(currentTranslatorSessionId, textStartChunkIndex);
    }

    // Initialize chunk tracker
    if (typeof initChunkTracker === 'function') {
        initChunkTracker(chunks, null, customPrompt);
    }

    // UI Setup
    isTranslating = true;
    cancelRequested = false;
    isPaused = false;

    let isResumingFromHistory = false;
    let restoredTranslatedChunks = [];
    const hadResumePayload = currentHistoryId &&
        Array.isArray(translatedChunks) &&
        translatedChunks.some(chunk => typeof chunk === 'string' && chunk.trim().length > 0);

    if (currentHistoryId &&
        Array.isArray(translatedChunks) &&
        translatedChunks.length === chunks.length) {
        restoredTranslatedChunks = translatedChunks.map(chunk =>
            isChunkSuccessfullyTranslatedForResume(chunk) ? chunk : null
        );

        const restoredCount = restoredTranslatedChunks.filter(chunk => chunk !== null).length;
        if (restoredCount > 0) {
            isResumingFromHistory = true;
            translatedChunks = restoredTranslatedChunks;
            completedChunks = restoredCount;
            console.log(`[Resume] Restored ${restoredCount}/${chunks.length} chunks from history`);
        }
    }

    if (!isResumingFromHistory) {
        if (hadResumePayload && currentHistoryId) {
            console.warn('[Resume] Saved chunk data does not match current chunking. Creating a new history run to avoid overwrite.');
            showToast('Không thể khớp bản lưu cũ để tiếp tục chính xác. Sẽ tạo lượt dịch mới từ đầu.', 'warning');
            currentHistoryId = null;
        }
        translatedChunks = new Array(chunks.length).fill(null);
        completedChunks = 0;
    }

    const firstPendingChunkIndex = translatedChunks.findIndex((chunk) => (
        !isChunkSuccessfullyTranslatedForResume(chunk)
    ));
    const textPreviewStartChunkIndex = isResumingFromHistory && firstPendingChunkIndex >= 0
        ? firstPendingChunkIndex
        : textStartChunkIndex;

    totalChunksCount = chunks.length;
    startTime = Date.now();

    // Ensure there is a history entry while translating, so partial progress is persistable.
    if (!currentHistoryId && typeof addToHistory === 'function') {
        const initialSnapshot = buildHistoryTextSnapshotFromChunks(translatedChunks.slice(textStartChunkIndex));
        currentHistoryId = addToHistory(
            originalFileName,
            text,
            initialSnapshot,
            chunks.slice(textStartChunkIndex),
            completedChunks,
            textHistoryTotalChunks,
            translatedChunks.slice(textStartChunkIndex),
            chunkSize,
            {
                sessionId: currentTranslatorSessionId,
                startChunkIndex: textStartChunkIndex,
                startByte: translationStartByte,
            }
        );
    }

    if (isResumingFromHistory && typeof trackChunkSuccess === 'function') {
        translatedChunks.forEach((chunk, idx) => {
            if (chunk !== null) {
                trackChunkSuccess(idx, chunk, 'RESUME');
            }
        });
    }

    const translateBtn = document.getElementById('translateBtn');
    translateBtn.disabled = true;
    translateBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Đang dịch...</span>';

    // Reset pause/cancel buttons
    const pauseBtn = document.getElementById('pauseBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    if (pauseBtn) {
        pauseBtn.classList.remove('paused');
        pauseBtn.innerHTML = '<span class="btn-icon">⏸️</span><span class="btn-text">Tạm dừng</span>';
    }
    if (cancelBtn) {
        cancelBtn.classList.remove('cancelling');
        cancelBtn.innerHTML = '<span class="btn-icon">⏹️</span><span class="btn-text">Hủy dịch</span>';
    }

    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultSection').style.display = 'none';
    document.getElementById('translatedText').value = isResumingFromHistory
        ? buildResumedTranslationPreview(translatedChunks, textPreviewStartChunkIndex, '⏳ Chưa dịch')
        : '';

    updateProgress(
        completedChunks,
        textHistoryTotalChunks,
        isResumingFromHistory ? `Tiếp tục dịch... (${completedChunks}/${textHistoryTotalChunks})` : 'Bắt đầu dịch song song...'
    );
    updateProgressStats(0, apiKeys.length, '--:--');

    let lastPreviewUpdateAt = 0;
    let lastHistoryPersistAt = 0;
    let lastHistoryPersistCompleted = -1;
    const chunkFailureReasons = new Map();

    const updateTranslatedPreview = (pendingLabel = '⏳ Đang dịch', force = false) => {
        const now = Date.now();
        if (!force && now - lastPreviewUpdateAt < TRANSLATION_PREVIEW_UPDATE_INTERVAL_MS) return;
        lastPreviewUpdateAt = now;
        const resultEl = document.getElementById('translatedText');
        if (resultEl) {
            resultEl.value = isResumingFromHistory
                ? buildResumedTranslationPreview(translatedChunks, textPreviewStartChunkIndex, pendingLabel)
                : buildTranslatedTextPreview(translatedChunks.slice(textStartChunkIndex), {
                    pendingLabel,
                    chunkIndexOffset: textStartChunkIndex,
                });
        }
    };

    const persistHistoryProgress = (force = false) => {
        if (!currentHistoryId || typeof updateHistoryProgress !== 'function') return;
        const now = Date.now();
        const completedDelta = Math.abs(completedChunks - lastHistoryPersistCompleted);
        if (!force &&
            completedChunks < textHistoryTotalChunks &&
            completedDelta < TRANSLATION_HISTORY_PERSIST_CHUNK_STEP &&
            now - lastHistoryPersistAt < TRANSLATION_HISTORY_PERSIST_INTERVAL_MS) {
            return;
        }
        lastHistoryPersistAt = now;
        lastHistoryPersistCompleted = completedChunks;
        const partialText = buildHistoryTextSnapshotFromChunks(translatedChunks.slice(textStartChunkIndex));
        updateHistoryProgress(
            currentHistoryId,
            partialText,
            chunks.slice(textStartChunkIndex),
            completedChunks,
            translatedChunks.slice(textStartChunkIndex),
            chunkSize,
            {
                sessionId: currentTranslatorSessionId,
                startChunkIndex: textStartChunkIndex,
                startByte: translationStartByte,
            }
        );
    };

    // Persist initial state immediately.
    persistHistoryProgress(true);

    let textRunCompleted = false;
    let finalTextIssueSummary = null;
    const summarizeTextChunkIssues = () => {
        if (typeof summarizeTranslatorChunkIssues !== 'function') return null;
        return summarizeTranslatorChunkIssues({
            chunks: translatedChunks,
            startChunkIndex: textStartChunkIndex,
            totalChunks: chunks.length,
        });
    };
    const getHistoryCompletedFromIssueSummary = (summary) => {
        if (!summary) return completedChunks;
        return Math.max(0, textHistoryTotalChunks - summary.issueCount);
    };

    try {
        // Process in parallel batches
        let effectiveParallel;
        let staggerDelayMs;

        if (useOllama) {
            effectiveParallel = resolveEffectiveTranslationParallel({
                requestedParallel: parallelCount,
                useOllamaMode: true,
                useProxyMode: false,
            });
            staggerDelayMs = 0;
            console.log('[Ollama] Using sequential processing (parallel=1)');
        } else if (useProxy) {
            effectiveParallel = resolveEffectiveTranslationParallel({
                requestedParallel: parallelCount,
                useOllamaMode: false,
                useProxyMode: true,
            });
            staggerDelayMs = 0;
            console.log(`[Proxy] Using parallel=${effectiveParallel}, stagger=${staggerDelayMs}ms`);
        } else {
            effectiveParallel = resolveEffectiveTranslationParallel({
                requestedParallel: parallelCount,
                useOllamaMode: false,
                useProxyMode: false,
            });
            staggerDelayMs = 0;
        }

        let nextChunkIndex = textStartChunkIndex;
        while (nextChunkIndex < chunks.length && !cancelRequested) {
            await waitWhilePaused();
            if (cancelRequested) break;

            const rpmPlan = typeof waitForTranslatorRpmBatchPlan === 'function'
                ? await waitForTranslatorRpmBatchPlan({ requestedParallel: effectiveParallel, remainingChunks: chunks.length - nextChunkIndex })
                : { capacity: effectiveParallel };
            if (cancelRequested || rpmPlan.capacity <= 0) break;

            const batchIndices = [];

            while (batchIndices.length < rpmPlan.capacity && nextChunkIndex < chunks.length) {
                const chunkIndex = nextChunkIndex;
                nextChunkIndex += 1;

                // Resume mode: skip chunks already translated
                if (isChunkSuccessfullyTranslatedForResume(translatedChunks[chunkIndex])) {
                    continue;
                }

                // Track chunk start
                if (typeof trackChunkStart === 'function') {
                    trackChunkStart(chunkIndex);
                }

                batchIndices.push(chunkIndex);
            }

            if (batchIndices.length === 0) {
                continue;
            }

            const dispatchIndices = useProxy && typeof buildTranslatorWaveAssignments === 'function'
                ? buildTranslatorWaveAssignments(batchIndices, rpmPlan).map((assignment) => assignment.chunkIndex)
                : orderProxyBatchIndicesForDispatch(batchIndices);
            const batch = dispatchIndices.map((chunkIndex, batchOffset) => (async () => {
                await sleep(batchOffset * staggerDelayMs);
                if (cancelRequested) {
                    throw new Error('TRANSLATION_CANCELLED');
                }
                const promptedChunk = buildPromptedChunk(customPrompt, chunks[chunkIndex], sourceLang);
                return translateChunkWithRetry(promptedChunk, chunkIndex);
            })());

            const refreshTextProgress = () => {
                const elapsed = Math.max(1, (Date.now() - startTime) / 1000);
                const speed = completedChunks / elapsed;
                const remaining = textHistoryTotalChunks - completedChunks;
                const eta = speed > 0 ? remaining / speed : Infinity;
                const currentActiveKeys = getActiveKeyCount();

                updateProgress(completedChunks, textHistoryTotalChunks, `Đang dịch chunk ${completedChunks}/${textHistoryTotalChunks}...`);
                updateProgressStats(speed.toFixed(1), currentActiveKeys, formatTime(eta));
                updateTranslatedPreview('⏳ Đang dịch');
                persistHistoryProgress();
            };

            await settleChunkPromisesIndividually(batch, async (result, idx) => {
                const chunkIndex = dispatchIndices[idx];
                if (result.status === 'fulfilled') {
                    translatedChunks[chunkIndex] = result.value;
                    completedChunks++;
                    if (currentTranslatorSessionId && typeof updateTranslatorChunkResult === 'function') {
                        await updateTranslatorChunkResult(currentTranslatorSessionId, chunkIndex, {
                            status: 'done',
                            outputText: result.value,
                        });
                    }
                    // Track success
                    if (typeof trackChunkSuccess === 'function') {
                        trackChunkSuccess(chunkIndex, result.value, '');
                    }
                    refreshTextProgress();
                } else {
                    const reasonText = String(result.reason?.message || result.reason || '');
                    if (cancelRequested || reasonText.includes('TRANSLATION_CANCELLED')) {
                        return;
                    }
                    const userReason = typeof formatTranslatorError === 'function'
                        ? formatTranslatorError(result.reason)
                        : reasonText;
                    chunkFailureReasons.set(chunkIndex, userReason);
                    translatedChunks[chunkIndex] = `[LỖI CHUNK ${chunkIndex + 1}]\nNguyên nhân: ${userReason}\n\n${chunks[chunkIndex]}`;
                    completedChunks++;
                    if (currentTranslatorSessionId && typeof updateTranslatorChunkResult === 'function') {
                        await updateTranslatorChunkResult(currentTranslatorSessionId, chunkIndex, {
                            status: 'failed',
                            outputText: translatedChunks[chunkIndex],
                            error: userReason,
                        });
                    }
                    console.error(`Chunk ${chunkIndex + 1} failed:`, result.reason);
                    // Track failure
                    if (typeof trackChunkFailed === 'function') {
                        trackChunkFailed(chunkIndex, userReason);
                    }
                    refreshTextProgress();
                }
            });

            if (cancelRequested) {
                persistHistoryProgress(true);
                break;
            }
        }

        // ========== AUTO RETRY FAILED CHUNKS (với Progressive Prompt) ==========
        if (!cancelRequested) {
            const failedChunkIndices = [];
            translatedChunks.forEach((chunk, idx) => {
                if (chunk && chunk.startsWith('[LỖI CHUNK')) {
                    failedChunkIndices.push(idx);
                }
            });

            if (failedChunkIndices.length > 0) {
                console.log(`[AUTO-RETRY] Found ${failedChunkIndices.length} failed chunks, retrying with progressive prompts...`);
                updateProgress(completedChunks, chunks.length, `🔄 Đang thử lại ${failedChunkIndices.length} chunk lỗi với prompt mạnh hơn...`);
                showToast(`Đang thử lại ${failedChunkIndices.length} chunk lỗi...`, 'info');

                for (let round = 1; round <= 3 && failedChunkIndices.length > 0; round++) {
                    console.log(`[AUTO-RETRY] Round ${round}/3 for ${failedChunkIndices.length} chunks`);
                    updateProgress(completedChunks, chunks.length, `🔄 Lần thử lại ${round}/3: còn ${failedChunkIndices.length} chunk...`);

                    const stillFailed = [];
                    for (const idx of failedChunkIndices) {
                        if (cancelRequested) break;

                        try {
                            // Sử dụng prompt tăng dần theo round
                            let promptToUse = buildPromptedChunk(customPrompt, chunks[idx], sourceLang);
                            const originalContent = chunks[idx];

                            if (round === 1) {
                                // Round 1: Thêm emphatic
                                promptToUse = buildPromptedChunk(
                                    `${customPrompt}\n\n${typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : ''}`,
                                    originalContent,
                                    sourceLang
                                );
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Using EMPHATIC prompt`);
                            } else if (round === 2) {
                                // Round 2: Literary framing
                                promptToUse = buildPromptedChunk(
                                    `${typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.literary : ''}\n\n${customPrompt}\n\n${typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : ''}`,
                                    originalContent,
                                    sourceLang
                                );
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Using LITERARY prompt`);
                            } else {
                                // Round 3: Fictional hoặc chia nhỏ
                                if (originalContent.length > 800) {
                                    console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Trying to SPLIT chunk...`);
                                    try {
                                        const splitResult = await translateLargeChunkBySplitting(
                                            buildPromptedChunk(customPrompt, originalContent, sourceLang), idx
                                        );
                                        if (splitResult && !splitResult.startsWith('[LỖI')) {
                                            translatedChunks[idx] = splitResult;
                                            console.log(`[AUTO-RETRY] Chunk ${idx + 1} SUCCESS via splitting!`);
                                            continue;
                                        }
                                    } catch (splitErr) {
                                        console.warn(`[AUTO-RETRY] Split failed: ${splitErr.message}`);
                                    }
                                }
                                // Fallback: Fictional prompt
                                promptToUse = buildPromptedChunk(
                                    typeof getFictionalPrompt === 'function' ? getFictionalPrompt('') : customPrompt,
                                    originalContent,
                                    sourceLang
                                );
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Using FICTIONAL prompt`);
                            }

                            const highTemp = 0.7 + (round * 0.15);

                            let result;
                            if (useOllama) {
                                if (typeof waitForTranslatorProviderRpmSlot === 'function') {
                                    await waitForTranslatorProviderRpmSlot(TRANSLATOR_PROVIDERS.OLLAMA);
                                }
                                if (typeof recordTranslatorRpmRequest === 'function') {
                                    recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.OLLAMA, 0);
                                }
                                result = await translateWithOllama(promptToUse, highTemp);
                            } else if (useProxy) {
                                if (typeof sendProxyTranslationAttempt === 'function') {
                                    const proxyAttempt = await sendProxyTranslationAttempt({
                                        chunkIndex: idx,
                                        text: promptToUse,
                                        temperature: highTemp,
                                        kind: 'retry',
                                    });
                                    result = proxyAttempt.result;
                                } else {
                                    result = await translateChunkViaProxy(promptToUse, highTemp, proxyApiKey);
                                }
                            } else {
                                const directAttempt = await sendDirectTranslationAttempt({
                                    chunkIndex: idx,
                                    text: promptToUse,
                                    temperature: highTemp,
                                    kind: 'retry',
                                });
                                const modelKeyPair = directAttempt.modelKeyPair;
                                result = directAttempt.result;
                                if (result && !result.startsWith('[LỖI') && !result.startsWith('[AUTO-SPLIT]')) {
                                    recordKeySuccess(modelKeyPair.keyIndex);
                                }
                            }

                            if (result && !result.startsWith('[LỖI') && !result.startsWith('[AUTO-SPLIT]')) {
                                translatedChunks[idx] = result;
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1} SUCCESS at round ${round}!`);
                                if (typeof trackChunkSuccess === 'function') {
                                    trackChunkSuccess(idx, result, '');
                                }
                            } else {
                                stillFailed.push(idx);
                            }
                        } catch (e) {
                            const retryErrorText = String(e?.message || e || '');
                            if (cancelRequested || retryErrorText.includes('TRANSLATION_CANCELLED')) {
                                break;
                            }
                            const userReason = typeof formatTranslatorError === 'function'
                                ? formatTranslatorError(e)
                                : retryErrorText;
                            chunkFailureReasons.set(idx, userReason);
                            console.warn(`[AUTO-RETRY] Chunk ${idx + 1} failed again: ${e.message}`);
                            stillFailed.push(idx);
                        }

                        await sleep(1000);
                        if (cancelRequested) break;
                    }

                    if (cancelRequested) break;

                    failedChunkIndices.length = 0;
                    failedChunkIndices.push(...stillFailed);

                    if (!cancelRequested && failedChunkIndices.length === 0) {
                        console.log(`[AUTO-RETRY] All chunks recovered!`);
                        showToast('🎉 Đã khôi phục tất cả chunk lỗi!', 'success');
                        break;
                    }

                    // Update preview sau mỗi round, giới hạn kích thước textarea khi truyện lớn.
                    updateTranslatedPreview('⏳ Đang retry', true);

                    persistHistoryProgress(true);

                    if (!cancelRequested && round < 3 && failedChunkIndices.length > 0) {
                        console.log(`[AUTO-RETRY] Waiting 2s before next round...`);
                        await sleep(2000);
                    }
                }

                // Đánh dấu chunk lỗi rõ ràng hơn cho user review
                if (failedChunkIndices.length > 0) {
                    console.log(`[AUTO-RETRY] ${failedChunkIndices.length} chunks still failed after 3 rounds`);

                    // Đánh dấu với format dễ nhận biết
                    failedChunkIndices.forEach(idx => {
                        const failureReason = chunkFailureReasons.get(idx) || 'Đã thử lại nhiều lần nhưng vẫn chưa có bản dịch đạt yêu cầu.';
                        translatedChunks[idx] = `\n\n╔═══════════════════════════════════════╗
║ ⚠️ CHUNK ${idx + 1} - CẦN DỊCH THỦ CÔNG ║
╚═══════════════════════════════════════╝

[Nguyên nhân]
${failureReason}

[Nguyên văn - cần review và dịch lại:]
${chunks[idx]}

═══════════════════════════════════════\n\n`;
                    });

                    showToast(`⚠️ Còn ${failedChunkIndices.length} chunk cần dịch thủ công (đã đánh dấu)`, 'warning');
                }
            }
        }

        if (currentTranslatorSessionId && typeof updateTranslatorChunkResult === 'function') {
            for (let idx = textStartChunkIndex; idx < translatedChunks.length; idx += 1) {
                const outputText = translatedChunks[idx];
                if (typeof outputText !== 'string' || outputText.length === 0) continue;
                const issueType = typeof getChunkIssueType === 'function'
                    ? getChunkIssueType(null, outputText)
                    : '';
                const failed = issueType === 'failed' ||
                    issueType === 'manual' ||
                    outputText.startsWith('[LỖI CHUNK') ||
                    outputText.includes('CẦN DỊCH THỦ CÔNG');
                await updateTranslatorChunkResult(currentTranslatorSessionId, idx, {
                    status: failed ? 'failed' : 'done',
                    outputText,
                    error: failed ? 'Cần xử lý thủ công' : '',
                });
            }
        }

        finalTextIssueSummary = summarizeTextChunkIssues();
        const finalHistoryCompletedChunks = getHistoryCompletedFromIssueSummary(finalTextIssueSummary);

        // Completion - GIỮ ĐÚNG THỨ TỰ
        const translatedText = cancelRequested
            ? buildHistoryTextSnapshotFromChunks(translatedChunks.slice(textStartChunkIndex))
            : translatedChunks
                .slice(textStartChunkIndex)
                .map((c, i) => c !== null ? c : `[❌ Chunk ${textStartChunkIndex + i + 1} thất bại]`)
                .join('\n\n');
        addToHistory(originalFileName, text, translatedText, chunks.slice(textStartChunkIndex), finalHistoryCompletedChunks, textHistoryTotalChunks, translatedChunks.slice(textStartChunkIndex), chunkSize, {
            sessionId: currentTranslatorSessionId,
            startChunkIndex: textStartChunkIndex,
            startByte: translationStartByte,
        });
        textRunCompleted = !cancelRequested;

        if (!cancelRequested) {
            updateProgress(textHistoryTotalChunks, textHistoryTotalChunks, 'Hoàn thành!');
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('translatedText').value = translatedText;

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const errorCount = finalTextIssueSummary?.issueCount || 0;

            if (errorCount > 0) {
                showToast(`Dịch hoàn tất trong ${totalTime}s! Còn ${errorCount} chunk cần xử lý.`, 'warning');
            } else {
                showToast(`Dịch hoàn tất 100% trong ${totalTime}s! 🎉`, 'success');
            }

            document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
        } else {
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('translatedText').value = buildHistoryTextSnapshotFromChunks(translatedChunks.slice(textStartChunkIndex));
            showToast('Đã hủy dịch! (Lịch sử đã được lưu)', 'warning');
        }

    } catch (error) {
        const errorText = String(error?.message || error || '');
        if (cancelRequested || errorText.includes('TRANSLATION_CANCELLED')) {
            const partialText = buildHistoryTextSnapshotFromChunks(translatedChunks.slice(textStartChunkIndex));
            finalTextIssueSummary = summarizeTextChunkIssues();
            addToHistory(originalFileName, text, partialText, chunks.slice(textStartChunkIndex), getHistoryCompletedFromIssueSummary(finalTextIssueSummary), textHistoryTotalChunks, translatedChunks.slice(textStartChunkIndex), chunkSize, {
                sessionId: currentTranslatorSessionId,
                startChunkIndex: textStartChunkIndex,
                startByte: translationStartByte,
            });
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('translatedText').value = partialText;
            showToast('Đã hủy dịch! (Lịch sử đã được lưu)', 'warning');
            return;
        }

        console.error('Translation error:', error);
        const userMessage = typeof formatTranslatorError === 'function'
            ? formatTranslatorError(error, 'Dịch thất bại')
            : 'Dịch thất bại. Chi tiết kỹ thuật đã được ghi trong Console.';
        showToast(userMessage, 'error');

        if (completedChunks > 0) {
            // GIỮ ĐÚNG THỨ TỰ kể cả khi có lỗi
            const translatedText = translatedChunks
                .slice(textStartChunkIndex)
                .map((c, i) => c !== null ? c : `[❌ Chunk ${textStartChunkIndex + i + 1} thất bại]`)
                .join('\n\n');
            finalTextIssueSummary = summarizeTextChunkIssues();
            addToHistory(originalFileName, text, translatedText, chunks.slice(textStartChunkIndex), getHistoryCompletedFromIssueSummary(finalTextIssueSummary), textHistoryTotalChunks, translatedChunks.slice(textStartChunkIndex), chunkSize, {
                sessionId: currentTranslatorSessionId,
                startChunkIndex: textStartChunkIndex,
                startByte: translationStartByte,
            });
        }
    } finally {
        isTranslating = false;
        isPaused = false;
        translateBtn.disabled = false;
        translateBtn.innerHTML = '<span class="btn-icon">🚀</span><span class="btn-text">Bắt đầu dịch</span>';

        const pauseBtn = document.getElementById('pauseBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const cancelModal = document.getElementById('cancelModal');

        if (pauseBtn) {
            pauseBtn.classList.remove('paused');
            pauseBtn.innerHTML = '<span class="btn-icon">⏸️</span><span class="btn-text">Tạm dừng</span>';
        }
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.classList.remove('cancelling');
            cancelBtn.innerHTML = '<span class="btn-icon">⏹️</span><span class="btn-text">Hủy dịch</span>';
        }
        if (cancelModal) {
            cancelModal.style.display = 'none';
        }
        if (typeof renderChunkIssuePanel === 'function') {
            finalTextIssueSummary = finalTextIssueSummary || summarizeTextChunkIssues();
            if (finalTextIssueSummary) {
                renderChunkIssuePanel(finalTextIssueSummary);
            }
        }
        if (typeof flushHistoryWrites === 'function') {
            await flushHistoryWrites();
        }
        if (typeof renderTranslationQueue === 'function') {
            await renderTranslationQueue();
        }
        if (textRunCompleted && typeof processNextTranslatorQueue === 'function') {
            setTimeout(() => processNextTranslatorQueue(), 0);
        }
    }
}
