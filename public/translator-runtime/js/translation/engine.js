/**
 * Novel Translator Pro - Translation Engine
 * Xử lý dịch văn bản song song
 */

// ============================================
// MAIN TRANSLATION ENGINE
// ============================================
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
    if (!Array.isArray(chunksArray)) return '';
    return chunksArray
        .map((chunk, idx) => chunk !== null ? chunk : `[⏳ Chưa dịch chunk ${idx + 1}]`)
        .join('\n\n');
}

async function startTranslation() {
    // Validate - Ollama/Proxy không cần API keys
    if (!useOllama && !useProxy && apiKeys.length === 0) {
        showToast('Vui lòng thêm ít nhất 1 API Key, bật Ollama Local, hoặc bật Proxy API!', 'error');
        return;
    }

    const text = document.getElementById('originalText').value.trim();
    if (!text) {
        showToast('Vui lòng nhập hoặc tải file truyện!', 'error');
        return;
    }

    // Get settings
    const sourceLang = document.getElementById('sourceLang').value;
    const chunkSize = parseInt(document.getElementById('chunkSize').value) || 4500;
    let parallelCount = parseInt(document.getElementById('parallelCount').value) || 5;
    let delayMs = parseInt(document.getElementById('delayMs').value) || 100;
    const customPrompt = document.getElementById('customPrompt').value;

    // ========== OLLAMA MODE ==========
    if (useOllama) {
        console.log('[Ollama] Mode enabled - skipping Gemini quota checks');
        parallelCount = 1;
        if (delayMs > 1000) {
            console.log(`[Ollama] Auto-reducing delay from ${delayMs}ms to 500ms`);
            delayMs = 500;
        }
        if (typeof resetOllamaSpeed === 'function') {
            resetOllamaSpeed();
        }
    } else if (useProxy) {
        // ========== PROXY MODE ==========
        const proxyKeyCount = typeof getProxyKeyCount === 'function' ? getProxyKeyCount() : 1;
        console.log(`[Proxy] Mode enabled - ${proxyKeyCount} key(s) available`);

        // Parallel = min(user setting, number of keys) — mỗi key gánh 1 chunk/batch
        parallelCount = Math.min(parallelCount, proxyKeyCount);
        parallelCount = Math.max(parallelCount, 1);

        // Delay tối thiểu 5000ms (đã test OK với 5 RPM/key)
        if (delayMs < 5000) {
            console.log(`[Proxy] Auto-increasing delay from ${delayMs}ms to 5000ms`);
            delayMs = 5000;
        }
        console.log(`[Proxy] Using parallel=${parallelCount}, delay=${delayMs}ms, keys=${proxyKeyCount}, model=${proxyModel}`);
    } else {
        // ========== GEMINI MODE: PRE-CHECK quota ==========
        const availableCombos = getAllAvailableCombinations();
        if (availableCombos.length === 0) {
            const now = Date.now();
            let minWaitTime = 60000;

            for (const pairId in modelKeyHealthMap) {
                const health = modelKeyHealthMap[pairId];
                if (health.disabledUntil) {
                    const waitTime = health.disabledUntil - now;
                    if (waitTime > 0 && waitTime < minWaitTime) {
                        minWaitTime = waitTime;
                    }
                }
            }

            const maxWaitMs = 30000;
            minWaitTime = Math.min(minWaitTime, maxWaitMs);
            const waitSeconds = Math.ceil(minWaitTime / 1000);

            showToast(`Tất cả API đang cooldown. Tự động chờ ${waitSeconds}s...`, 'warning');
            console.warn(`[Pre-check] All combinations disabled. Waiting ${waitSeconds}s...`);

            document.getElementById('progressSection').style.display = 'block';
            await sleepWithCountdown(minWaitTime, '⏳ Chờ API sẵn sàng');
            modelKeyHealthMap = {};
        }

        const currentCombos = getAllAvailableCombinations();
        if (currentCombos.length < parallelCount) {
            console.log(`[Pre-check] Reducing parallel from ${parallelCount} to ${currentCombos.length}`);
            parallelCount = Math.max(1, currentCombos.length);
        }
    }

    // Split text into chunks
    const chunks = splitTextIntoChunks(text, chunkSize);

    if (chunks.length === 0) {
        showToast('Không có nội dung để dịch!', 'error');
        return;
    }

    // Prepare chunks with prompt
    const preparedChunks = chunks.map(chunk => customPrompt + chunk);

    // Initialize chunk tracker
    if (typeof initChunkTracker === 'function') {
        initChunkTracker(chunks, preparedChunks, customPrompt);
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

    totalChunksCount = chunks.length;
    startTime = Date.now();

    // Ensure there is a history entry while translating, so partial progress is persistable.
    if (!currentHistoryId && typeof addToHistory === 'function') {
        const initialSnapshot = buildHistoryTextSnapshotFromChunks(translatedChunks);
        currentHistoryId = addToHistory(
            originalFileName,
            text,
            initialSnapshot,
            chunks,
            completedChunks,
            chunks.length,
            translatedChunks,
            chunkSize
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
        ? translatedChunks.map((c, i) => c !== null ? c : `[⏳ Chưa dịch chunk ${i + 1}]`).join('\n\n')
        : '';

    updateProgress(
        completedChunks,
        chunks.length,
        isResumingFromHistory ? `Tiếp tục dịch... (${completedChunks}/${chunks.length})` : 'Bắt đầu dịch song song...'
    );
    updateProgressStats(0, apiKeys.length, '--:--');

    const persistHistoryProgress = () => {
        if (!currentHistoryId || typeof updateHistoryProgress !== 'function') return;
        const partialText = buildHistoryTextSnapshotFromChunks(translatedChunks);
        updateHistoryProgress(
            currentHistoryId,
            partialText,
            chunks,
            completedChunks,
            translatedChunks,
            chunkSize
        );
    };

    // Persist initial state immediately.
    persistHistoryProgress();

    try {
        // Process in parallel batches
        let effectiveParallel;
        let staggerDelayMs;

        if (useOllama) {
            effectiveParallel = 1;
            staggerDelayMs = 0;
            console.log('[Ollama] Using sequential processing (parallel=1)');
        } else if (useProxy) {
            // parallelCount đã được set ở trên = min(userSetting, proxyKeyCount)
            effectiveParallel = parallelCount;
            staggerDelayMs = effectiveParallel > 1 ? 300 : 0; // Stagger nhẹ để tránh burst
            console.log(`[Proxy] Using parallel=${effectiveParallel}, stagger=${staggerDelayMs}ms`);
        } else {
            const totalCombinations = apiKeys.length * GEMINI_MODELS.length;
            effectiveParallel = Math.min(parallelCount, totalCombinations, 10);
            staggerDelayMs = 500;
        }

        for (let i = 0; i < chunks.length && !cancelRequested; i += effectiveParallel) {
            await waitWhilePaused();
            if (cancelRequested) break;

            const batch = [];
            const batchIndices = [];

            for (let j = 0; j < effectiveParallel && i + j < chunks.length; j++) {
                const chunkIndex = i + j;

                // Resume mode: skip chunks already translated
                if (isChunkSuccessfullyTranslatedForResume(translatedChunks[chunkIndex])) {
                    continue;
                }

                // Track chunk start
                if (typeof trackChunkStart === 'function') {
                    trackChunkStart(chunkIndex);
                }

                batch.push(
                    (async () => {
                        await sleep(j * staggerDelayMs);
                        if (cancelRequested) {
                            throw new Error('TRANSLATION_CANCELLED');
                        }
                        return translateChunkWithRetry(preparedChunks[chunkIndex], chunkIndex);
                    })()
                );
                batchIndices.push(chunkIndex);
            }

            if (batch.length === 0) {
                continue;
            }

            const results = await Promise.allSettled(batch);

            results.forEach((result, idx) => {
                const chunkIndex = batchIndices[idx];
                if (result.status === 'fulfilled') {
                    translatedChunks[chunkIndex] = result.value;
                    completedChunks++;
                    // Track success
                    if (typeof trackChunkSuccess === 'function') {
                        trackChunkSuccess(chunkIndex, result.value, '');
                    }
                } else {
                    const reasonText = String(result.reason?.message || result.reason || '');
                    if (cancelRequested || reasonText.includes('TRANSLATION_CANCELLED')) {
                        return;
                    }
                    translatedChunks[chunkIndex] = `[LỖI CHUNK ${chunkIndex + 1}]\n${chunks[chunkIndex]}`;
                    completedChunks++;
                    console.error(`Chunk ${chunkIndex + 1} failed:`, result.reason);
                    // Track failure
                    if (typeof trackChunkFailed === 'function') {
                        trackChunkFailed(chunkIndex, result.reason?.message || String(result.reason));
                    }
                }
            });

            if (cancelRequested) {
                persistHistoryProgress();
                break;
            }

            // Update progress
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = completedChunks / elapsed;
            const remaining = chunks.length - completedChunks;
            const eta = remaining / speed;
            const currentActiveKeys = getActiveKeyCount();

            updateProgress(completedChunks, chunks.length, `Đang dịch chunk ${completedChunks}/${chunks.length}...`);
            updateProgressStats(speed.toFixed(1), currentActiveKeys, formatTime(eta));

            // Cập nhật RPD dashboard
            if (typeof renderRPDDashboard === 'function') {
                renderRPDDashboard();
            }

            // Update preview - GIỮ ĐÚNG THỨ TỰ, không filter null
            document.getElementById('translatedText').value = translatedChunks
                .map((c, i) => c !== null ? c : `[⏳ Đang dịch chunk ${i + 1}...]`)
                .join('\n\n');

            // Persist after every finished batch.
            persistHistoryProgress();

            if (i + effectiveParallel < chunks.length && !cancelRequested) {
                await sleep(delayMs);
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
                    updateProgress(completedChunks, chunks.length, `🔄 Retry round ${round}/3: ${failedChunkIndices.length} chunks...`);

                    const stillFailed = [];
                    for (const idx of failedChunkIndices) {
                        if (cancelRequested) break;

                        try {
                            // Sử dụng prompt tăng dần theo round
                            let promptToUse = preparedChunks[idx];
                            const originalContent = chunks[idx];

                            if (round === 1) {
                                // Round 1: Thêm emphatic
                                promptToUse = customPrompt + originalContent +
                                    (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Using EMPHATIC prompt`);
                            } else if (round === 2) {
                                // Round 2: Literary framing
                                promptToUse = (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.literary : '') +
                                    customPrompt + originalContent +
                                    (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Using LITERARY prompt`);
                            } else {
                                // Round 3: Fictional hoặc chia nhỏ
                                if (originalContent.length > 800) {
                                    console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Trying to SPLIT chunk...`);
                                    try {
                                        const splitResult = await translateLargeChunkBySplitting(
                                            customPrompt + originalContent, idx
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
                                promptToUse = typeof getFictionalPrompt === 'function' ?
                                    getFictionalPrompt(originalContent) :
                                    preparedChunks[idx];
                                console.log(`[AUTO-RETRY] Chunk ${idx + 1}: Using FICTIONAL prompt`);
                            }

                            const highTemp = 0.7 + (round * 0.15);

                            let result;
                            if (useProxy) {
                                const proxyKey = typeof getProxyKeyForChunk === 'function' ? getProxyKeyForChunk(idx) : proxyApiKey;
                                result = await translateChunkViaProxy(promptToUse, highTemp, proxyKey);
                            } else {
                                const modelKeyPair = getNextModelKeyPair();
                                result = await translateChunk(promptToUse, modelKeyPair, highTemp);
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

                    // Update preview sau mỗi round - GIỮ ĐÚNG THỨ TỰ
                    document.getElementById('translatedText').value = translatedChunks
                        .map((c, i) => c !== null ? c : `[⏳ Đang retry chunk ${i + 1}...]`)
                        .join('\n\n');

                    persistHistoryProgress();

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
                        translatedChunks[idx] = `\n\n╔═══════════════════════════════════════╗
║ ⚠️ CHUNK ${idx + 1} - CẦN DỊCH THỦ CÔNG ║
╚═══════════════════════════════════════╝

[Nguyên văn - cần review và dịch lại:]
${chunks[idx]}

═══════════════════════════════════════\n\n`;
                    });

                    showToast(`⚠️ Còn ${failedChunkIndices.length} chunk cần dịch thủ công (đã đánh dấu)`, 'warning');
                }
            }
        }

        // Completion - GIỮ ĐÚNG THỨ TỰ
        const translatedText = cancelRequested
            ? buildHistoryTextSnapshotFromChunks(translatedChunks)
            : translatedChunks
                .map((c, i) => c !== null ? c : `[❌ Chunk ${i + 1} thất bại]`)
                .join('\n\n');
        addToHistory(originalFileName, text, translatedText, chunks, completedChunks, chunks.length, translatedChunks, chunkSize);

        if (!cancelRequested) {
            updateProgress(chunks.length, chunks.length, 'Hoàn thành!');
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('translatedText').value = translatedChunks.join('\n\n');

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const errorCount = translatedChunks.filter(c => c && c.startsWith('[LỖI CHUNK')).length;

            if (errorCount > 0) {
                showToast(`Dịch hoàn tất trong ${totalTime}s! (${errorCount} chunk lỗi)`, 'warning');
            } else {
                showToast(`Dịch hoàn tất 100% trong ${totalTime}s! 🎉`, 'success');
            }

            document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
        } else {
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('translatedText').value = buildHistoryTextSnapshotFromChunks(translatedChunks);
            showToast('Đã hủy dịch! (Lịch sử đã được lưu)', 'warning');
        }

    } catch (error) {
        const errorText = String(error?.message || error || '');
        if (cancelRequested || errorText.includes('TRANSLATION_CANCELLED')) {
            const partialText = buildHistoryTextSnapshotFromChunks(translatedChunks);
            addToHistory(originalFileName, text, partialText, chunks, completedChunks, chunks.length, translatedChunks, chunkSize);
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('translatedText').value = partialText;
            showToast('Đã hủy dịch! (Lịch sử đã được lưu)', 'warning');
            return;
        }

        console.error('Translation error:', error);
        showToast(`Lỗi: ${error.message}`, 'error');

        if (completedChunks > 0) {
            // GIỮ ĐÚNG THỨ TỰ kể cả khi có lỗi
            const translatedText = translatedChunks
                .map((c, i) => c !== null ? c : `[❌ Chunk ${i + 1} thất bại]`)
                .join('\n\n');
            addToHistory(originalFileName, text, translatedText, chunks, completedChunks, chunks.length, translatedChunks, chunkSize);
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
    }
}
