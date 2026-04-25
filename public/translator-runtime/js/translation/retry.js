/**
 * Novel Translator Pro - Translation Retry Logic
 * Xử lý retry, error handling, progressive prompt, và split chunk
 */

// ============================================
// TRANSLATE WITH RETRY + PROGRESSIVE PROMPT
// ============================================
async function translateChunkWithRetry(text, chunkIndex, retries = 5) {
    if (cancelRequested) {
        throw new Error('TRANSLATION_CANCELLED');
    }

    // Danh sách temperature để thử - mỗi lần retry dùng temperature khác
    const temperatures = [0.7, 0.9, 0.5, 1.0, 0.3, 0.8, 0.6, 1.2, 0.4, 0.95];

    // Track số lần bị OUTPUT_TOO_SHORT
    let shortOutputCount = 0;

    // Lưu text gốc (không có prompt) để progressive prompt
    const originalText = text;

    for (let attempt = 1; attempt <= retries; attempt++) {
        if (cancelRequested) {
            throw new Error('TRANSLATION_CANCELLED');
        }

        let modelKeyPair = null;
        try {
            const temperature = temperatures[(attempt - 1) % temperatures.length];

            // Track retry attempt
            if (attempt > 1 && typeof trackChunkRetry === 'function') {
                trackChunkRetry(chunkIndex, attempt - 1);
            }

            // ========== OLLAMA MODE ==========
            if (useOllama) {
                // ========== PROGRESSIVE PROMPT CHO OLLAMA ==========
                let promptToUse = text;

                if (shortOutputCount > 0) {
                    const basePrompt = document.getElementById('customPrompt')?.value || '';
                    const contentOnly = originalText.replace(basePrompt, '').trim();

                    if (shortOutputCount === 1) {
                        promptToUse = basePrompt + contentOnly + (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                        console.log(`[Ollama] Chunk ${chunkIndex + 1} 🔄 Using EMPHATIC prompt`);
                    } else if (shortOutputCount === 2) {
                        promptToUse = (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.literary : '') + basePrompt + contentOnly;
                        console.log(`[Ollama] Chunk ${chunkIndex + 1} 🔄 Using LITERARY prompt`);
                    } else {
                        promptToUse = typeof getFictionalPrompt === 'function' ? getFictionalPrompt(contentOnly) : contentOnly;
                        console.log(`[Ollama] Chunk ${chunkIndex + 1} 🔄 Using FICTIONAL prompt`);
                    }
                }

                console.log(`[Ollama] Chunk ${chunkIndex + 1}, attempt ${attempt}/${retries}, temp=${temperature}`);
                const result = await translateWithOllama(promptToUse, temperature);

                // ========== VALIDATION CHO OLLAMA ==========
                if (typeof validateTranslationOutput === 'function') {
                    const validation = validateTranslationOutput(originalText, result);

                    if (!validation.valid) {
                        console.warn(`[Ollama] ❌ Validation failed: ${validation.reason}`);
                        throw createValidationTranslatorError(validation);
                    }

                    if (validation.warning) {
                        console.warn(`[Ollama] ⚠️ ${validation.warning}`);
                    }
                }

                return result;
            }

            // ========== PROXY MODE ==========
            if (useProxy) {
                // Progressive prompt cho Proxy (giống Gemini)
                let promptToUse = text;

                if (shortOutputCount > 0) {
                    const basePrompt = document.getElementById('customPrompt')?.value || '';
                    const contentOnly = originalText.replace(basePrompt, '').trim();

                    if (shortOutputCount === 1) {
                        promptToUse = basePrompt + contentOnly + (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                        console.log(`[Proxy] Chunk ${chunkIndex + 1} 🔄 Using EMPHATIC prompt (attempt ${attempt})`);
                    } else if (shortOutputCount === 2) {
                        promptToUse = (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.literary : '') +
                            basePrompt + contentOnly +
                            (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                        console.log(`[Proxy] Chunk ${chunkIndex + 1} 🔄 Using LITERARY prompt (attempt ${attempt})`);
                    } else {
                        promptToUse = typeof getFictionalPrompt === 'function' ?
                            getFictionalPrompt(contentOnly) :
                            contentOnly;
                        console.log(`[Proxy] Chunk ${chunkIndex + 1} 🔄 Using FICTIONAL prompt (attempt ${attempt})`);
                    }
                }

                console.log(`[Proxy] Chunk ${chunkIndex + 1}, attempt ${attempt}/${retries}, temp=${temperature}, model=${proxyModel}`);
                const proxyKey = typeof getProxyKeyForChunk === 'function' ? getProxyKeyForChunk(chunkIndex) : proxyApiKey;
                const result = await translateChunkViaProxy(promptToUse, temperature, proxyKey);
                return result;
            }

            // ========== GEMINI MODE ==========
            modelKeyPair = getNextModelKeyPairWithQueue();

            // ========== PROGRESSIVE PROMPT ==========
            let promptToUse = text;

            // Nếu đã bị OUTPUT_TOO_SHORT, sử dụng progressive prompt
            if (shortOutputCount > 0) {
                const basePrompt = document.getElementById('customPrompt')?.value || '';
                // Tách prompt và nội dung thực
                const contentOnly = originalText.replace(basePrompt, '').trim();

                if (shortOutputCount === 1) {
                    // Lần 2: Thêm emphasis
                    promptToUse = basePrompt + contentOnly + (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                    console.log(`[Chunk ${chunkIndex + 1}] 🔄 Using EMPHATIC prompt (attempt ${attempt})`);
                } else if (shortOutputCount === 2) {
                    // Lần 3: Literary framing
                    promptToUse = (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.literary : '') +
                        basePrompt + contentOnly +
                        (typeof PROMPT_ENHANCERS !== 'undefined' ? PROMPT_ENHANCERS.emphatic : '');
                    console.log(`[Chunk ${chunkIndex + 1}] 🔄 Using LITERARY prompt (attempt ${attempt})`);
                } else {
                    // Lần 4+: Fictional prompt (fallback cuối)
                    promptToUse = typeof getFictionalPrompt === 'function' ?
                        getFictionalPrompt(contentOnly) :
                        contentOnly;
                    console.log(`[Chunk ${chunkIndex + 1}] 🔄 Using FICTIONAL prompt (attempt ${attempt})`);
                }
            }

            console.log(`[Gemini] Chunk ${chunkIndex + 1}, attempt ${attempt}/${retries}, temp=${temperature}`);
            const result = await translateChunk(promptToUse, modelKeyPair, temperature);
            recordKeySuccess(modelKeyPair.keyIndex);
            return result;

        } catch (error) {
            if (cancelRequested || (error && String(error.message || '').includes('TRANSLATION_CANCELLED'))) {
                throw new Error('TRANSLATION_CANCELLED');
            }

            const translatorError = typeof normalizeTranslatorError === 'function'
                ? normalizeTranslatorError(error)
                : error;
            const errorCode = translatorError?.code || '';
            const errorMsg = String(error?.message || error || '').toLowerCase();
            const rawErrorMsg = String(translatorError?.rawMessage || error?.message || error || '').toLowerCase();
            const combinedErrorMsg = `${errorMsg} ${rawErrorMsg}`;

            // ========== PROXY MODE: XỬ LÝ 403/429 ĐẶC BIỆT ==========
            if (useProxy) {
                const is403 = errorCode === 'PROXY_BACKEND_SUSPENDED' || combinedErrorMsg.includes('403') || combinedErrorMsg.includes('suspended');
                const is429 = errorCode === 'PROXY_RATE_LIMIT' || combinedErrorMsg.includes('429') || combinedErrorMsg.includes('rate limit');

                if (is403 || is429) {
                    const waitTime = is403 ? 5000 : 8000;
                    console.warn(`[Proxy] Chunk ${chunkIndex + 1} ⚠️ ${is403 ? '403 Backend suspended' : '429 Rate limited'}, chờ ${waitTime / 1000}s rồi retry...`);

                    if (attempt === retries) {
                        throw error;
                    }

                    await sleep(waitTime);
                    continue;
                }
            }

            // ========== XỬ LÝ OUTPUT QUÁ NGẮN ==========
            const originalErrorText = String(error?.message || error || '');
            const isOutputTooShort = errorCode === 'OUTPUT_TOO_SHORT' || originalErrorText.includes('OUTPUT_TOO_SHORT');
            if (isOutputTooShort) {
                shortOutputCount++;
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ Output quá ngắn (lần ${shortOutputCount}), thử prompt mạnh hơn...`);

                // Nếu đã thử 4 lần với prompt khác nhau mà vẫn ngắn → chia nhỏ chunk
                if (shortOutputCount >= 4 && text.length > 1000) {
                    console.log(`[Chunk ${chunkIndex + 1}] 📦 Chia nhỏ chunk do output liên tục quá ngắn...`);
                    try {
                        return await translateLargeChunkBySplitting(originalText, chunkIndex);
                    } catch (splitError) {
                        console.error(`[Chunk ${chunkIndex + 1}] ❌ Chia nhỏ cũng thất bại`);
                    }
                }

                await sleep(500);
                continue;
            }

            // ========== XỬ LÝ KHÔNG CÓ TIẾNG VIỆT ==========
            const isNoVietnamese = errorCode === 'NO_VIETNAMESE' || originalErrorText.includes('NO_VIETNAMESE');
            if (isNoVietnamese) {
                shortOutputCount++;
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ Output không có tiếng Việt, thử prompt khác...`);
                await sleep(500);
                continue;
            }

            // ========== XỬ LÝ ERROR MARKER / AI TỪ CHỐI ==========
            const isErrorMarker = errorCode === 'ERROR_MARKER' || originalErrorText.includes('ERROR_MARKER');
            if (isErrorMarker) {
                shortOutputCount++;
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ AI từ chối dịch, thử prompt literary/fictional...`);
                await sleep(500);
                continue;
            }

            // ========== XỬ LÝ PROMPT LEAK ==========
            const isPromptLeak = errorCode === 'PROMPT_LEAK' || originalErrorText.includes('PROMPT_LEAK');
            if (isPromptLeak) {
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ AI lặp lại prompt, thử lại...`);
                await sleep(300);
                continue;
            }

            const isContentBlocked = errorCode.startsWith('CONTENT_BLOCKED') ||
                combinedErrorMsg.includes('blocked') ||
                combinedErrorMsg.includes('safety') ||
                combinedErrorMsg.includes('prohibited');
            const isRateLimit = errorCode === 'GEMINI_RATE_LIMIT' || combinedErrorMsg.includes('429') || combinedErrorMsg.includes('quota');
            const isServerError = ['GEMINI_INTERNAL', 'GEMINI_UNAVAILABLE', 'GEMINI_DEADLINE'].includes(errorCode) ||
                combinedErrorMsg.includes('503') ||
                combinedErrorMsg.includes('500') ||
                combinedErrorMsg.includes('504');
            const isNotFound = errorCode === 'GEMINI_NOT_FOUND' ||
                combinedErrorMsg.includes('404') ||
                combinedErrorMsg.includes('not found') ||
                combinedErrorMsg.includes('model not found');
            const isInvalidKey = errorCode === 'INVALID_API_KEY' ||
                combinedErrorMsg.includes('api key not valid') ||
                combinedErrorMsg.includes('api key not found') ||
                combinedErrorMsg.includes('invalid api key');
            const isPermissionDenied = errorCode === 'GEMINI_PERMISSION_DENIED';
            const isModelOverloaded = errorCode === 'GEMINI_UNAVAILABLE' && combinedErrorMsg.includes('overloaded');

            console.warn(`[Chunk ${chunkIndex + 1}] Attempt ${attempt}/${retries} failed: ${error.message}`);

            // === XỬ LÝ CONTENT BLOCKED ===
            if (isContentBlocked) {
                shortOutputCount++; // Treat as similar to short output
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ Content blocked, thử prompt literary/fictional...`);

                if (shortOutputCount >= 3 && text.length > 1000) {
                    console.log(`[Chunk ${chunkIndex + 1}] 📦 Chia nhỏ chunk do bị block...`);
                    try {
                        return await translateLargeChunkBySplitting(originalText, chunkIndex);
                    } catch (splitError) {
                        console.error(`[Chunk ${chunkIndex + 1}] ❌ Chia nhỏ cũng thất bại`);
                    }
                }

                await sleep(500);
                continue;
            }

            // === XỬ LÝ API KEY KHÔNG HỢP LỆ ===
            if (modelKeyPair && (isInvalidKey || isPermissionDenied)) {
                console.error(`[Chunk ${chunkIndex + 1}] ❌ INVALID API KEY: Key ${modelKeyPair.keyIndex + 1}`);
                GEMINI_MODELS.forEach(model => {
                    recordModelKeyError(model.name, modelKeyPair.keyIndex, isPermissionDenied ? 300 : 86400);
                });
                recordKeyError(modelKeyPair.keyIndex, isPermissionDenied ? 'PERMISSION_DENIED' : 'INVALID_KEY', isPermissionDenied ? 300 : 86400);
                const message = typeof formatTranslatorError === 'function'
                    ? formatTranslatorError(translatorError)
                    : `API Key ${modelKeyPair.keyIndex + 1} không hợp lệ!`;
                showToast(message, 'error');
                continue;
            }

            // === XỬ LÝ MODEL OVERLOADED (503) ===
            if (modelKeyPair && isModelOverloaded) {
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ Model ${modelKeyPair.model} overloaded`);
                recordModelKeyError(modelKeyPair.model, modelKeyPair.keyIndex, 30);
                continue;
            }

            // === XỬ LÝ RATE LIMIT (429) ===
            if (modelKeyPair && (isRateLimit || isNotFound)) {
                let cooldownSeconds = 60;
                if (isRateLimit) {
                    const retryMatch = String(translatorError?.rawMessage || error.message).match(/retry in ([\d.]+)s/i);
                    if (retryMatch) {
                        cooldownSeconds = Math.ceil(parseFloat(retryMatch[1])) + 2;
                    }

                    // Kiểm tra xem có phải hết RPD không
                    // Nếu RPD đã dùng >= 18 (gần hết 20), đánh dấu pair là hết RPD
                    if (typeof getRPDUsed === 'function') {
                        const rpdUsed = getRPDUsed(modelKeyPair.model, modelKeyPair.keyIndex);
                        if (rpdUsed >= 18) {
                            console.warn(`[Chunk ${chunkIndex + 1}] RPD gần hết (${rpdUsed}/20), đánh dấu pair hết RPD ngày`);
                            if (typeof markPairRPDExhausted === 'function') {
                                markPairRPDExhausted(modelKeyPair.model, modelKeyPair.keyIndex);
                            }
                            cooldownSeconds = 3600; // Disable 1 giờ thay vì 60s
                        }
                    }
                } else if (isNotFound) {
                    cooldownSeconds = 300;
                }

                recordModelKeyError(modelKeyPair.model, modelKeyPair.keyIndex, cooldownSeconds);
                recordKeyError(modelKeyPair.keyIndex, isRateLimit ? 'RATE_LIMIT' : 'NOT_FOUND', cooldownSeconds);
                console.log(`[Chunk ${chunkIndex + 1}] Disabled ${modelKeyPair.model} + Key ${modelKeyPair.keyIndex + 1} for ${cooldownSeconds}s`);

                // === SMART WAIT ===
                const availableCombos = getAllAvailableCombinations();
                if (availableCombos.length === 0) {
                    const now = Date.now();
                    let minWaitTime = cooldownSeconds * 1000;

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

                    console.warn(`[Chunk ${chunkIndex + 1}] ⏳ ALL COMBINATIONS DISABLED! Waiting ${waitSeconds}s...`);
                    showToast(`Tất cả API đều hết quota. Chờ ${waitSeconds}s...`, 'warning');
                    await sleepWithCountdown(minWaitTime, '⏳ Chờ quota reset');
                    console.log(`[Chunk ${chunkIndex + 1}] ✅ Resuming after wait...`);
                }

                continue;
            }

            // === HẾT RETRY ===
            if (attempt === retries) {
                // Thử chia nhỏ chunk như fallback cuối cùng
                if (text.length > 1000 && !text.includes('[AUTO-SPLIT]')) {
                    console.log(`[Chunk ${chunkIndex + 1}] 📦 Final attempt: splitting chunk...`);
                    try {
                        return await translateLargeChunkBySplitting(originalText, chunkIndex);
                    } catch (splitError) {
                        throw error;
                    }
                }
                throw error;
            }

            let waitTime = 1000 * attempt;
            if (isServerError) {
                waitTime = 2000 * attempt;
            }

            console.log(`[Chunk ${chunkIndex + 1}] Waiting ${waitTime / 1000}s before retry...`);
            await sleep(waitTime);
        }
    }
}

// ============================================
// SPLIT LARGE CHUNK - Chia nhỏ chunk thông minh
// ============================================
async function translateLargeChunkBySplitting(text, chunkIndex) {
    if (cancelRequested) {
        throw new Error('TRANSLATION_CANCELLED');
    }

    console.log(`[Chunk ${chunkIndex + 1}] 📦 Splitting into smaller parts...`);

    // Chia thành nhiều phần nhỏ hơn (4-5 phần thay vì 3)
    const numParts = Math.max(4, Math.ceil(text.length / 800));
    const parts = splitTextIntoSmallerParts(text, numParts);
    const translatedParts = [];

    console.log(`[Chunk ${chunkIndex + 1}] Split into ${parts.length} sub-chunks`);

    for (let i = 0; i < parts.length; i++) {
        if (cancelRequested) {
            throw new Error('TRANSLATION_CANCELLED');
        }

        const partText = '[AUTO-SPLIT]' + parts[i];
        console.log(`[Chunk ${chunkIndex + 1}] Translating sub-chunk ${i + 1}/${parts.length}...`);

        try {
            if (useProxy) {
                // Proxy mode - gọi trực tiếp với key theo chunk
                const proxyKey = typeof getProxyKeyForChunk === 'function' ? getProxyKeyForChunk(chunkIndex) : proxyApiKey;
                const result = await translateChunkViaProxy(partText, 0.8, proxyKey);
                translatedParts.push(result.replace('[AUTO-SPLIT]', ''));
            } else {
                const modelKeyPair = getNextModelKeyPair();
                const result = await translateChunk(partText, modelKeyPair, 0.8);
                translatedParts.push(result.replace('[AUTO-SPLIT]', ''));
                recordKeySuccess(modelKeyPair.keyIndex);
            }
        } catch (e) {
            if (cancelRequested || (e && String(e.message || '').includes('TRANSLATION_CANCELLED'))) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            console.warn(`[Chunk ${chunkIndex + 1}] Sub-chunk ${i + 1} failed: ${e.message}`);
            // Giữ nguyên text gốc nếu sub-chunk fail
            translatedParts.push(parts[i]);
        }
        await sleep(500);
    }

    const combined = translatedParts.join('\n');
    console.log(`[Chunk ${chunkIndex + 1}] ✅ Combined ${parts.length} sub-chunks: ${combined.length} chars`);
    return combined;
}

// ============================================
// HELPER: Chia text thành N phần nhỏ hơn
// ============================================
function splitTextIntoSmallerParts(text, numParts) {
    const lines = text.split('\n');
    const linesPerPart = Math.ceil(lines.length / numParts);
    const parts = [];

    for (let i = 0; i < lines.length; i += linesPerPart) {
        parts.push(lines.slice(i, i + linesPerPart).join('\n'));
    }

    return parts.filter(p => p.trim().length > 0);
}
