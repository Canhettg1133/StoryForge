/**
 * Novel Translator Pro - Translation Retry Logic
 * Xử lý retry, error handling, progressive prompt, và split chunk
 */

// ============================================
// TRANSLATE WITH RETRY + PROGRESSIVE PROMPT
// ============================================
function updateTranslationRuntimeStatus(message) {
    const statusEl = typeof document !== 'undefined' ? document.getElementById('progressStatus') : null;
    if (statusEl) statusEl.textContent = message;
}

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
        let proxyKeyUsed = null;
        try {
            const temperature = temperatures[(attempt - 1) % temperatures.length];

            // Track retry attempt
            if (attempt > 1 && typeof trackChunkRetry === 'function') {
                trackChunkRetry(chunkIndex, attempt - 1);
                updateTranslationRuntimeStatus(`Đang thử lại chunk ${chunkIndex + 1} (lần ${attempt - 1})...`);
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
                if (typeof waitForTranslatorProviderRpmSlot === 'function') {
                    await waitForTranslatorProviderRpmSlot(TRANSLATOR_PROVIDERS.OLLAMA);
                }
                if (typeof recordTranslatorRpmRequest === 'function') {
                    recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.OLLAMA, 0);
                }
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

                const activeProxyModel = typeof getActiveProxyModel === 'function' ? getActiveProxyModel() : proxyModel;
                console.log(`[Proxy] Chunk ${chunkIndex + 1}, attempt ${attempt}/${retries}, temp=${temperature}, model=${activeProxyModel}`);
                let result;
                if (typeof sendProxyTranslationAttempt === 'function') {
                    const proxyAttempt = await sendProxyTranslationAttempt({
                        chunkIndex,
                        text: promptToUse,
                        temperature,
                        kind: attempt > 1 ? 'retry' : 'main',
                    });
                    proxyKeyUsed = proxyAttempt.proxyKey;
                    result = proxyAttempt.result;
                } else {
                    const proxyKey = typeof getProxyKeyForChunk === 'function' ? await getProxyKeyForChunk(chunkIndex) : proxyApiKey;
                    proxyKeyUsed = proxyKey;
                    result = await translateChunkViaProxy(promptToUse, temperature, proxyKey);
                }
                if (typeof recordProxyKeySuccess === 'function') {
                    recordProxyKeySuccess(proxyKeyUsed);
                }
                return result;
            }

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
                    const fictionalPrompt = typeof getFictionalPrompt === 'function'
                        ? getFictionalPrompt(contentOnly)
                        : contentOnly;
                    promptToUse = `${basePrompt}\n\n${fictionalPrompt}`;
                    console.log(`[Chunk ${chunkIndex + 1}] 🔄 Using FICTIONAL prompt (attempt ${attempt})`);
                }
            }

            console.log(`[Gemini] Chunk ${chunkIndex + 1}, attempt ${attempt}/${retries}, temp=${temperature}`);
            const directAttempt = await sendDirectTranslationAttempt({
                chunkIndex,
                text: promptToUse,
                temperature,
                kind: attempt > 1 ? 'retry' : 'main',
            });
            modelKeyPair = directAttempt.modelKeyPair;
            const result = directAttempt.result;
            recordKeySuccess(modelKeyPair.keyIndex);
            return result;

        } catch (error) {
            if (cancelRequested || (error && String(error.message || '').includes('TRANSLATION_CANCELLED'))) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            modelKeyPair = modelKeyPair || error?.modelKeyPairUsed || null;

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
                    // Chờ ngắn trước retry - getProxyKeyForChunk sẽ tự chờ cooldown key
                    const waitTime = is403 ? 3000 : 5000;
                    console.warn(`[Proxy] Chunk ${chunkIndex + 1} ⚠️ ${is403 ? '403 Backend suspended' : '429 Rate limited'}, chờ ${waitTime / 1000}s rồi xoay key retry...`);
                    const failedProxyKey = proxyKeyUsed || error?.proxyKeyUsed;
                    if (typeof recordProxyKeyError === 'function' && failedProxyKey) {
                        const retryAfterSeconds = Number(translatorError?.retryAfterSeconds);
                        const cooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                            ? retryAfterSeconds * 1000
                            : (is403 ? PROXY_FORBIDDEN_COOLDOWN_MS : PROXY_RATE_LIMIT_COOLDOWN_MS);
                        recordProxyKeyError(failedProxyKey, is403 ? 'FORBIDDEN_403' : 'RATE_LIMIT_429', cooldownMs);
                    }

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

                if (attempt === retries) {
                    throw translatorError || error;
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

            if (!modelKeyPair && translatorError?.retryable === false) {
                throw translatorError;
            }

            if (isContentBlocked && attempt === retries) {
                throw translatorError || error;
            }

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
                const message = typeof formatTranslatorError === 'function'
                    ? formatTranslatorError(translatorError)
                    : `API Key ${modelKeyPair.keyIndex + 1} không hợp lệ!`;
                showToast(message, 'error');
                if (attempt === retries) throw error;
                continue;
            }

            // === XỬ LÝ MODEL OVERLOADED (503) ===
            if (modelKeyPair && isModelOverloaded) {
                console.warn(`[Chunk ${chunkIndex + 1}] ⚠️ Model ${modelKeyPair.model} overloaded`);
                if (attempt === retries) throw error;
                continue;
            }

            // === XỬ LÝ LỖI GOOGLE 500/503/504: COOLDOWN CẶP MODEL+KEY, KHÔNG ĐÁNH DẤU KEY HỎNG ===
            if (modelKeyPair && isServerError) {
                updateTranslationRuntimeStatus(`Google trả lỗi ${translatorError?.status || 500}. Đang thử cặp model/key khác...`);
                if (attempt === retries) {
                    throw error;
                }
                continue;
            }

            // === XỬ LÝ RATE LIMIT (429) ===
            if (modelKeyPair && (isRateLimit || isNotFound)) {
                console.log(`[Chunk ${chunkIndex + 1}] Đang xoay cặp Gemini Direct sau lỗi ${isRateLimit ? '429' : '404'}`);
                if (attempt === retries) throw error;
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
            if (useOllama) {
                if (typeof waitForTranslatorProviderRpmSlot === 'function') {
                    await waitForTranslatorProviderRpmSlot(TRANSLATOR_PROVIDERS.OLLAMA);
                }
                if (typeof recordTranslatorRpmRequest === 'function') {
                    recordTranslatorRpmRequest(TRANSLATOR_PROVIDERS.OLLAMA, 0);
                }
                const result = await translateWithOllama(partText, 0.8);
                translatedParts.push(result.replace('[AUTO-SPLIT]', ''));
            } else if (useProxy) {
                // Proxy mode - gọi trực tiếp với key theo chunk
                const result = typeof sendProxyTranslationAttempt === 'function'
                    ? (await sendProxyTranslationAttempt({
                        chunkIndex,
                        text: partText,
                        temperature: 0.8,
                        kind: 'split_retry',
                    })).result
                    : await translateChunkViaProxy(partText, 0.8, proxyApiKey);
                translatedParts.push(result.replace('[AUTO-SPLIT]', ''));
            } else {
                const directAttempt = await sendDirectTranslationAttempt({
                    chunkIndex,
                    text: partText,
                    temperature: 0.8,
                    kind: 'split_retry',
                });
                const { result, modelKeyPair } = directAttempt;
                translatedParts.push(result.replace('[AUTO-SPLIT]', ''));
                recordKeySuccess(modelKeyPair.keyIndex);
            }
        } catch (e) {
            if (cancelRequested || (e && String(e.message || '').includes('TRANSLATION_CANCELLED'))) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            console.warn(`[Chunk ${chunkIndex + 1}] Sub-chunk ${i + 1} failed: ${e.message}`);
            if (!useProxy && !useOllama) throw e;
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
