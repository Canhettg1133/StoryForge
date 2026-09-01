/**
 * Novel Translator Pro - Gemini API
 * Gọi Gemini Cloud API hoặc Proxy API để dịch văn bản
 */

// ============================================
// PROXY API - OpenAI Compatible (BeiJiXingXing, OpenRouter...)
// ============================================
// Một wave lớn sẽ tách thành nhiều relay invocation chạy đồng thời; mỗi invocation
// phải giữ tối đa 6 upstream fetch đang chờ header theo giới hạn Cloudflare Workers.
const PROXY_RELAY_CHAT_BATCH_MAX_SIZE = 6;
const DEFAULT_PROXY_TRANSLATION_MAX_TOKENS = 16384;
const CUSTOM_PROXY_TRANSLATION_MAX_TOKENS = 32768;
let proxyRelayChatBatchQueue = [];
let proxyRelayChatBatchTimer = null;
const STORYFORGE_RELAY_AUTH_CODES = new Set(['AUTH_REQUIRED']);

function getProxyTranslationMaxTokens() {
    const customProvider = typeof TRANSLATOR_PROVIDERS !== 'undefined'
        ? TRANSLATOR_PROVIDERS.CUSTOM_PROXY
        : 'custom_proxy';
    const activeProvider = typeof activeTranslatorProvider !== 'undefined'
        ? activeTranslatorProvider
        : '';
    return activeProvider === customProvider
        ? CUSTOM_PROXY_TRANSLATION_MAX_TOKENS
        : DEFAULT_PROXY_TRANSLATION_MAX_TOKENS;
}

function createProxyAbortError() {
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    return error;
}

function throwProxySchedulerUnavailable() {
    const message = 'Proxy scheduler chưa sẵn sàng; request đã bị chặn để bảo vệ giới hạn RPM.';
    if (typeof createTranslatorError === 'function') {
        throw createTranslatorError('PROXY_SCHEDULER_UNAVAILABLE', {
            provider: 'Proxy',
            rawMessage: message,
            retryable: false,
        });
    }
    const error = new Error(message);
    error.code = 'PROXY_SCHEDULER_UNAVAILABLE';
    error.retryable = false;
    throw error;
}

function getStoryForgeRelayAuthHeaders(upstreamKey) {
    const storyForgeToken = typeof getStoryForgeAccessToken === 'function'
        ? String(getStoryForgeAccessToken() || '').trim()
        : '';
    return {
        ...(storyForgeToken ? { 'Authorization': `Bearer ${storyForgeToken}` } : {}),
        'X-StoryForge-Upstream-Key': upstreamKey,
    };
}

function getProxyResponseErrorMessage(errorData = {}, status = 0) {
    const nestedError = errorData?.error;
    if (nestedError && typeof nestedError === 'object') {
        return nestedError.message || errorData?.message || errorData?.code || `HTTP ${status}`;
    }
    return nestedError || errorData?.message || errorData?.code || `HTTP ${status}`;
}

function getStoryForgeRelayErrorCode(errorData = {}) {
    const nestedError = errorData?.error;
    const candidates = [
        errorData?.code,
        errorData?.reason,
        typeof nestedError === 'string' ? nestedError : nestedError?.code,
        errorData?.decision?.reason,
        errorData?.decision?.code,
    ];
    return candidates
        .map((value) => String(value || '').trim())
        .find((value) => STORYFORGE_RELAY_AUTH_CODES.has(value)) || '';
}

async function refreshStoryForgeRelayAuth() {
    if (typeof refreshStoryForgeAccessContext !== 'function') return false;
    return Boolean(await refreshStoryForgeAccessContext());
}

function getProxyRelayBatchKey(activeBaseUrl, activeKey, proxyTarget) {
    return [
        activeBaseUrl,
        activeKey,
        proxyTarget?.profile?.baseUrl || '',
        proxyTarget?.path || '',
    ].join('|');
}

function createProxyRelayBatchItemResponse(entry = {}) {
    const status = Number(entry.status) || 502;
    const body = entry.body ?? {};
    const retryAfterSeconds = Number(entry.retryAfterSeconds);
    return {
        ok: Boolean(entry.ok),
        status,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
            ? retryAfterSeconds
            : undefined,
        json: async () => {
            if (typeof body !== 'string') return body;
            try {
                return body ? JSON.parse(body) : {};
            } catch {
                return { error: body || `HTTP ${status}` };
            }
        },
    };
}

function getBalancedProxyRelayShardSizes(itemCount, maxSize = PROXY_RELAY_CHAT_BATCH_MAX_SIZE) {
    const safeItemCount = Math.max(0, Math.trunc(Number(itemCount) || 0));
    const safeMaxSize = Math.max(1, Math.trunc(Number(maxSize) || PROXY_RELAY_CHAT_BATCH_MAX_SIZE));
    if (safeItemCount === 0) return [];
    const shardCount = Math.ceil(safeItemCount / safeMaxSize);
    const baseSize = Math.floor(safeItemCount / shardCount);
    let remainder = safeItemCount % shardCount;
    return Array.from({ length: shardCount }, () => {
        const size = baseSize + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        return size;
    });
}

function cleanupProxyRelayBatchItem(item) {
    if (item?.signal && item.abortHandler) {
        item.signal.removeEventListener('abort', item.abortHandler);
    }
}

function enqueueProxyRelayChatRequest(
    activeBaseUrl,
    activeKey,
    proxyTarget,
    payload,
    signal,
    onProxyDispatch = null,
    onChunkKeyUsage = null,
) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createProxyAbortError());
            return;
        }

        const item = {
            activeBaseUrl,
            activeKey,
            proxyTarget,
            payload,
            signal,
            onProxyDispatch,
            onChunkKeyUsage,
            resolve,
            reject,
            aborted: false,
            abortHandler: null,
        };
        item.abortHandler = () => {
            item.aborted = true;
            cleanupProxyRelayBatchItem(item);
            reject(createProxyAbortError());
        };
        if (signal) {
            signal.addEventListener('abort', item.abortHandler, { once: true });
        }

        proxyRelayChatBatchQueue.push(item);
        if (!proxyRelayChatBatchTimer) {
            proxyRelayChatBatchTimer = setTimeout(flushProxyRelayChatBatchQueue, 0);
        }
    });
}

function flushProxyRelayChatBatchQueue() {
    const queued = proxyRelayChatBatchQueue;
    proxyRelayChatBatchQueue = [];
    proxyRelayChatBatchTimer = null;

    const groups = new Map();
    queued.forEach((item) => {
        if (item.aborted || item.signal?.aborted) {
            cleanupProxyRelayBatchItem(item);
            item.reject(createProxyAbortError());
            return;
        }
        const groupKey = getProxyRelayBatchKey(item.activeBaseUrl, item.activeKey, item.proxyTarget);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(item);
    });

    groups.forEach((items) => {
        let index = 0;
        getBalancedProxyRelayShardSizes(items.length).forEach((size) => {
            sendProxyRelayChatStreamBatchGroup(items.slice(index, index + size));
            index += size;
        });
    });
}

function resolveMissingProxyRelayItems(items, resolved, reason = 'Relay stream thiếu phản hồi cho request này.') {
    items.forEach((item, index) => {
        if (resolved.has(index)) return;
        item.resolve(createProxyRelayBatchItemResponse({
            ok: false,
            status: 502,
            body: { error: reason },
        }));
    });
}

function handleProxyRelayStreamLine(line, items, resolved) {
    if (!line.trim()) return;
    let entry;
    try {
        entry = JSON.parse(line);
    } catch {
        return;
    }
    const index = Number(entry?.index);
    if (!Number.isInteger(index) || index < 0 || index >= items.length || resolved.has(index)) return;
    resolved.add(index);
    items[index].resolve(createProxyRelayBatchItemResponse(entry));
}

async function resolveProxyRelayStreamResponse(response, items) {
    const resolved = new Set();
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        items.forEach((item) => item.resolve({
            ok: false,
            status: response.status,
            headers: response.headers,
            json: async () => errorData,
        }));
        return;
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
        const data = await response.json().catch(() => ({}));
        const responses = Array.isArray(data?.responses) ? data.responses : [];
        items.forEach((item, index) => {
            resolved.add(index);
            item.resolve(createProxyRelayBatchItemResponse(responses[index] || {
                ok: false,
                status: 502,
                body: { error: 'Relay batch không có stream phản hồi.' },
            }));
        });
        return;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach((line) => handleProxyRelayStreamLine(line, items, resolved));
    }
    buffer += decoder.decode();
    handleProxyRelayStreamLine(buffer, items, resolved);
    resolveMissingProxyRelayItems(items, resolved);
}

async function sendProxyRelayChatStreamBatchGroup(items) {
    const activeItems = items.filter((item) => !item.aborted && !item.signal?.aborted);
    if (!activeItems.length) return;

    const first = activeItems[0];
    const groupController = new AbortController();
    const abortGroup = () => groupController.abort('request-aborted');
    activeItems.forEach((item) => item.signal?.addEventListener('abort', abortGroup, { once: true }));

    const sharedBody = {
        baseUrl: first.proxyTarget.profile.baseUrl,
        chatCompletionsPath: first.proxyTarget.path,
    };
    const requestBody = activeItems.length === 1
        ? {
            action: 'chat',
            ...sharedBody,
            templateId: typeof getActiveTranslatorTemplateId === 'function' ? getActiveTranslatorTemplateId() : 'convert',
            payload: activeItems[0].payload,
        }
        : {
            action: 'chat_stream_batch',
            ...sharedBody,
            templateId: typeof getActiveTranslatorTemplateId === 'function' ? getActiveTranslatorTemplateId() : 'convert',
            payloads: activeItems.map((item) => item.payload),
        };

    try {
        const serializedBody = JSON.stringify(requestBody);
        activeItems.forEach((item) => {
            if (typeof item.onChunkKeyUsage === 'function') item.onChunkKeyUsage();
        });
        const responsePromise = fetch(first.activeBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getStoryForgeRelayAuthHeaders(first.activeKey),
            },
            body: serializedBody,
            signal: groupController.signal,
        });
        activeItems.forEach((item) => {
            if (typeof item.onProxyDispatch === 'function') item.onProxyDispatch();
        });
        const response = await responsePromise;

        if (activeItems.length === 1) {
            activeItems[0].resolve(response);
            return;
        }

        await resolveProxyRelayStreamResponse(response, activeItems);
    } catch (error) {
        activeItems.forEach((item) => item.reject(error));
    } finally {
        activeItems.forEach((item) => {
            item.signal?.removeEventListener('abort', abortGroup);
            cleanupProxyRelayBatchItem(item);
        });
    }
}

function parseProxyRetryAfterSeconds(value, now = Date.now()) {
    if (value == null || value === '') return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
    const retryAt = Date.parse(String(value));
    if (!Number.isFinite(retryAt)) return undefined;
    return Math.max(0, Math.ceil((retryAt - now) / 1000));
}

async function translateChunkViaProxy(text, temperature = 0.7, apiKeyOverride = null, allowStoryForgeAuthRefresh = true, requestOptions = {}) {
    const send = options => requestProxyChunkTranslation(text, temperature, apiKeyOverride, allowStoryForgeAuthRefresh, options);
    return typeof withTranslatorChunkKeyUsage === 'function'
        ? withTranslatorChunkKeyUsage(requestOptions, send)
        : send(requestOptions);
}

async function requestProxyChunkTranslation(text, temperature, apiKeyOverride, allowStoryForgeAuthRefresh, requestOptions) {
    const request = typeof normalizeTranslationRequest === 'function'
        ? normalizeTranslationRequest(text)
        : { systemText: '', userText: String(text || ''), sourceText: String(text || '') };
    const resolvedApiKeyOverride = apiKeyOverride && typeof apiKeyOverride.then === 'function'
        ? await apiKeyOverride
        : apiKeyOverride;
    const activeKey = resolvedApiKeyOverride || (typeof getActiveProxyKeys === 'function' ? getActiveProxyKeys()[0] : proxyApiKey);
    const proxyTarget = typeof getActiveProxyRequestTarget === 'function'
        ? getActiveProxyRequestTarget('chat')
        : null;
    const activeBaseUrl = proxyTarget?.url || (typeof getActiveProxyBaseUrl === 'function' ? getActiveProxyBaseUrl() : proxyBaseUrl);
    const activeModel = typeof getActiveProxyModel === 'function' ? getActiveProxyModel() : proxyModel;
    const activeProviderLabel = typeof getActiveProxyLabel === 'function' ? getActiveProxyLabel() : 'Proxy';
    if (!activeKey) throw createTranslatorError('MISSING_PROXY_KEY');
    if (!activeBaseUrl) throw createTranslatorError('MISSING_PROXY_URL');
    if (!activeModel) {
        throw createTranslatorError('MISSING_PROXY_MODEL', {
            provider: activeProviderLabel,
            rawMessage: 'Chưa chọn model proxy để dịch.',
            retryable: false,
        });
    }

    console.log(`[${activeProviderLabel}] Model: ${activeModel} | Temp: ${temperature} | Key: ...${activeKey.slice(-6)}`);

    const controller = new AbortController();
    if (typeof registerActiveRequestController === 'function') {
        registerActiveRequestController(controller);
    }
    const timeoutId = setTimeout(() => controller.abort('request-timeout'), 120000); // 2 min timeout

    let response;
    try {
        const messages = [
            ...(request.systemText ? [{ role: 'system', content: request.systemText }] : []),
            { role: 'user', content: request.userText },
        ];
        const payload = {
            model: activeModel,
            messages,
            temperature: temperature,
            stream: false,
            max_tokens: getProxyTranslationMaxTokens()
        };
        const requestBody = proxyTarget?.mode === 'relay'
            ? {
                action: 'chat',
                baseUrl: proxyTarget.profile.baseUrl,
                chatCompletionsPath: proxyTarget.path,
                templateId: typeof getActiveTranslatorTemplateId === 'function' ? getActiveTranslatorTemplateId() : 'convert',
                payload,
            }
            : payload;
        const provider = typeof getProxyProviderId === 'function' ? getProxyProviderId() : 'ag_proxy';
        const keyIndex = typeof getProxyKeyIndex === 'function' ? getProxyKeyIndex(activeKey, provider) : null;
        const serializedRequestBody = proxyTarget?.mode === 'relay' ? null : JSON.stringify(requestBody);
        const onProxyDispatch = typeof requestOptions.onProxyDispatch === 'function'
            ? requestOptions.onProxyDispatch
            : null;
        const onChunkKeyUsage = typeof requestOptions.onChunkKeyUsage === 'function'
            ? () => requestOptions.onChunkKeyUsage({ provider, model: activeModel, key: activeKey, keyIndex })
            : null;
        if (proxyTarget?.mode === 'relay') {
            response = await enqueueProxyRelayChatRequest(
                activeBaseUrl,
                activeKey,
                proxyTarget,
                payload,
                controller.signal,
                onProxyDispatch,
                onChunkKeyUsage,
            );
        } else {
            if (onChunkKeyUsage) onChunkKeyUsage();
            const responsePromise = fetch(activeBaseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${activeKey}`,
                    'Content-Type': 'application/json'
                },
                body: serializedRequestBody,
                signal: controller.signal
            });
            if (onProxyDispatch) onProxyDispatch();
            response = await responsePromise;
        }
    } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
            if (cancelRequested) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            throw createTranslatorError('PROXY_TIMEOUT', {
                provider: activeProviderLabel,
                model: activeModel,
                timeoutSeconds: 120,
                retryable: true,
            });
        }
        throw normalizeTranslatorError(fetchError, {
            provider: activeProviderLabel,
            model: activeModel,
            retryable: true,
        });
    } finally {
        clearTimeout(timeoutId);
        if (typeof unregisterActiveRequestController === 'function') {
            unregisterActiveRequestController(controller);
        }
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = getProxyResponseErrorMessage(errorData, response.status);
        const retryAfterSeconds = [
            response.retryAfterSeconds,
            response.headers?.get?.('Retry-After'),
            errorData?.retryAfterSeconds,
            errorData?.error?.retryAfterSeconds,
        ].map((value) => parseProxyRetryAfterSeconds(value))
            .find((value) => Number.isFinite(value));

        console.error(`[Proxy ERROR] Status: ${response.status} | ${errorMsg}`);

        if (
            allowStoryForgeAuthRefresh
            && proxyTarget?.mode === 'relay'
            && response.status === 401
            && getStoryForgeRelayErrorCode(errorData)
        ) {
            const refreshed = await refreshStoryForgeRelayAuth().catch(() => false);
            if (refreshed && !cancelRequested) {
                return translateChunkViaProxy(request, temperature, apiKeyOverride, false, requestOptions);
            }
        }

        if (response.status === 403) {
            // CONSUMER_SUSPENDED - proxy backend key bị khóa, retry sẽ xoay sang key khác.
            console.warn('[Proxy] 403 - Backend suspended, proxy sẽ xoay key khác khi retry...');
        }

        throw createProxyHttpError(response.status, errorData, {
            model: activeModel,
            provider: activeProviderLabel,
            retryAfterSeconds,
        });
    }

    const data = await response.json();
    const choice = data.choices?.[0] || {};
    const finishReason = String(choice.finish_reason || '').trim();
    const normalizedFinishReason = finishReason.toLowerCase();
    if (
        normalizedFinishReason === 'length'
        || normalizedFinishReason === 'max_tokens'
        || normalizedFinishReason === 'max-tokens'
        || normalizedFinishReason === 'max_output_tokens'
        || normalizedFinishReason.includes('max_token')
    ) {
        throw createTranslatorError('PROXY_INCOMPLETE_RESPONSE', {
            provider: activeProviderLabel,
            model: activeModel,
            finishReason,
            rawMessage: `Proxy API stopped with finish_reason=${finishReason}`,
            retryable: true,
        });
    }

    // Extract response - OpenAI format
    const content = choice.message?.content?.trim();
    if (!content) {
        console.error('[Proxy ERROR] Empty response:', data);
        throw createTranslatorError('PROXY_EMPTY_RESPONSE', {
            provider: activeProviderLabel,
            model: activeModel,
            rawMessage: 'Proxy API: Empty response',
            retryable: true,
        });
    }

    let result = requestOptions.cleanResponse === false ? content : cleanGeminiResponse(content);

    // Validation
    if (requestOptions.skipValidation !== true) {
        const validationResult = validateTranslationOutput(request.sourceText, result);
        if (!validationResult.valid) {
            console.error(`[❌ VALIDATION FAILED] ${validationResult.reason}`);
            throw createValidationTranslatorError(validationResult);
        }
        if (validationResult.warning) {
            console.warn(`[⚠️ WARNING] ${validationResult.warning}`);
        }
    }

    return result;
}

// ============================================
// GEMINI TRANSLATE CHUNK (Direct API hoặc auto-route qua Proxy)
// ============================================
function getDirectGeminiThinkingConfig(modelName) {
    const normalized = String(modelName || '').trim().toLowerCase();
    if (!normalized) return null;

    if (/^gemini-2\.5-flash(?:$|-)/.test(normalized)) {
        return { thinkingBudget: 0 };
    }

    if (/^gemini-3(?:\.\d+)?-flash(?:-lite)?(?:$|-)/.test(normalized)) {
        return { thinkingLevel: 'minimal' };
    }

    return null;
}

const DIRECT_GEMINI_SOURCE_MARKER = '[Đoạn nguồn]';

function getDirectGeminiLegacyEditTextMarker() {
    return ['VĂN BẢN CẦN', 'BIÊN TẬP:'].join(' ');
}

function sanitizeDirectGeminiSystemInstruction(text = '') {
    return String(text || '')
        .replaceAll(getDirectGeminiLegacyEditTextMarker(), '')
        .trim();
}

function getDirectGeminiSystemInstructionText(text = '') {
    if (text && typeof text === 'object' && !Array.isArray(text)) {
        const request = typeof normalizeTranslationRequest === 'function'
            ? normalizeTranslationRequest(text)
            : text;
        return sanitizeDirectGeminiSystemInstruction(request.systemText || '');
    }
    const rawText = String(text || '');
    const markerIndex = rawText.indexOf(DIRECT_GEMINI_SOURCE_MARKER);
    if (markerIndex <= 0) return '';
    return sanitizeDirectGeminiSystemInstruction(rawText.slice(0, markerIndex));
}

async function translateChunk(text, modelKeyPair, temperature = 0.7, requestOptions = {}) {
    const send = options => requestDirectChunkTranslation(text, modelKeyPair, temperature, options);
    return typeof withTranslatorChunkKeyUsage === 'function'
        ? withTranslatorChunkKeyUsage(requestOptions, send)
        : send(requestOptions);
}

async function requestDirectChunkTranslation(text, modelKeyPair, temperature, requestOptions) {
    const request = typeof normalizeTranslationRequest === 'function'
        ? normalizeTranslationRequest(text)
        : { systemText: getDirectGeminiSystemInstructionText(text), userText: String(text || ''), sourceText: String(text || '') };
    // ===== AUTO-ROUTE: Nếu bật proxy, gọi proxy thay vì Gemini Direct =====
    if (useProxy && !requestOptions?.directOnly) {
        if (typeof sendProxyTranslationAttempt !== 'function') throwProxySchedulerUnavailable();
        const usage = requestOptions?.chunkKeyUsage || {};
        const attempt = await sendProxyTranslationAttempt({
            chunkIndex: usage.chunkIndex || 0,
            text: request,
            temperature,
            kind: usage.kind || 'main',
            partIndex: usage.partIndex,
            requestOptions,
        });
        return attempt.result;
    }

    const { model: modelName, key: apiKey, keyIndex } = modelKeyPair;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    console.log(`[Gemini API] ${modelName} + Key ${keyIndex + 1} (temp=${temperature})`);

    const thinkingConfig = getDirectGeminiThinkingConfig(modelName);
    const systemInstructionText = getDirectGeminiSystemInstructionText(request);
    const body = {
        ...(systemInstructionText ? {
            systemInstruction: {
                parts: [{ text: systemInstructionText }]
            }
        } : {}),
        contents: [{
            parts: [{ text: request.userText }]
        }],
        generationConfig: {
            temperature: temperature,
            topP: 0.95,
            topK: 40,
            ...(thinkingConfig ? { thinkingConfig } : {})
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" }
        ]
    };

    // TIMEOUT: 120 giây (gemini-2.5-flash thinking cần 60-90s cho text dài)
    const controller = requestOptions.directSignal ? null : new AbortController();
    if (controller && typeof registerActiveRequestController === 'function') {
        registerActiveRequestController(controller);
    }
    const timeoutId = controller ? setTimeout(() => controller.abort('request-timeout'), 120000) : null;
    const signal = requestOptions.directSignal || controller.signal;
    const serializedBody = JSON.stringify(body);

    let response;
    try {
        if (typeof requestOptions.onDirectDispatch === 'function') requestOptions.onDirectDispatch();
        if (typeof requestOptions.onChunkKeyUsage === 'function') {
            requestOptions.onChunkKeyUsage({ provider: 'gemini_direct', model: modelName, key: apiKey, keyIndex });
        }
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: serializedBody,
            signal
        });
    } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
            if (cancelRequested) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            throw createTranslatorError('GEMINI_TIMEOUT', {
                provider: 'Gemini',
                model: modelName,
                keyIndex,
                timeoutSeconds: 120,
                retryable: true,
            });
        }
        throw normalizeTranslatorError(fetchError, {
            provider: 'Gemini',
            model: modelName,
            keyIndex,
            retryable: true,
        });
    } finally {
        clearTimeout(timeoutId);
        if (controller && typeof unregisterActiveRequestController === 'function') {
            unregisterActiveRequestController(controller);
        }
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `HTTP ${response.status}`;

        console.error(`[Gemini API ERROR] Status: ${response.status}`);
        console.error(`[Gemini API ERROR] Message: ${errorMsg}`);

        const geminiError = createGeminiHttpError(response.status, errorData, {
            model: modelName,
            keyIndex,
        });

        throw geminiError;
    }

    const data = await response.json();
    console.log(`[Gemini API] Response received successfully`);

    const finishReason = data.candidates?.[0]?.finishReason;
    const blockReason = data.promptFeedback?.blockReason;

    if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
        console.warn(`[Gemini API] Candidate stopped with finishReason=${finishReason}`);
        throw createGeminiBlockedError(data, { model: modelName, keyIndex });
    }

    if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
        console.warn(`[Gemini API] Prompt blocked with blockReason=${blockReason}`);
        throw createGeminiBlockedError(data, { model: modelName, keyIndex });
    }

    // Extract text from Gemini response
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        let result = data.candidates[0].content.parts[0].text.trim();
        if (requestOptions.cleanResponse !== false) result = cleanGeminiResponse(result);

        // ========== VALIDATION ĐẦY ĐỦ ==========
        const validationResult = requestOptions.skipValidation === true
            ? { valid: true, warning: null }
            : validateTranslationOutput(request.sourceText, result);

        if (!validationResult.valid) {
            console.error(`[❌ VALIDATION FAILED] ${validationResult.reason}`);
            throw createValidationTranslatorError(validationResult);
        }

        if (validationResult.warning) {
            console.warn(`[⚠️ WARNING] ${validationResult.warning}`);
        }

        return result;
    }

    // Check for blocked/truncated content - THROW ERROR instead of returning original text
    if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
        console.warn(`[Gemini API] Candidate stopped with finishReason=${finishReason}`);
        throw createGeminiBlockedError(data, { model: modelName, keyIndex });
    }

    if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
        console.warn(`[Gemini API] Prompt blocked with blockReason=${blockReason}`);
        throw createGeminiBlockedError(data, { model: modelName, keyIndex });
    }

    // Check for empty/missing response
    if (!data.candidates || data.candidates.length === 0) {
        console.error('[Gemini API ERROR] No candidates in response');
        throw createGeminiBlockedError(data, { model: modelName, keyIndex });
    }

    console.error('[Gemini API ERROR] Invalid response format:', data);
    throw createTranslatorError('INVALID_RESPONSE_FORMAT', {
        provider: 'Gemini',
        model: modelName,
        keyIndex,
        rawMessage: 'Gemini API: Invalid response format',
        retryable: true,
    });
}

// ============================================
// VALIDATE TRANSLATION OUTPUT - Kiểm tra đầy đủ
// ============================================
function validateTranslationOutput(original, translated) {
    const result = {
        valid: true,
        warning: null,
        reason: null,
        errorCode: null,
        details: null
    };

    // Strip prompt from original để so sánh chính xác
    // Prompt kết thúc bằng "ĐOẠN VĂN:" hoặc "ĐOẠN VĂN CẦN VIẾT LẠI:" hoặc tương tự
    let contentOnly = original;
    const promptEndMarkers = [
        'ĐOẠN VĂN:', 'ĐOẠN VĂN CẦN VIẾT LẠI:', 'NỘI DUNG:',
        'BẮT ĐẦU NGAY.', 'BẮT ĐẦU NGAY VỚI NỘI DUNG.]',
        'VĂN BẢN CẦN BIÊN TẬP:', 'VĂN BẢN:',
        '[BEGIN MANUSCRIPT]', '[BEGIN TRANSLATION]',
        '[BEGIN MANUSCRIPT — TRANSLATE BELOW]'
    ];
    for (const marker of promptEndMarkers) {
        const idx = original.indexOf(marker);
        if (idx !== -1) {
            contentOnly = original.substring(idx + marker.length).trim();
            break;
        }
    }

    // Tính ratio dựa trên content thực (không bao gồm prompt)
    const inputLength = contentOnly.length;
    const outputLength = translated.length;
    const ratio = inputLength > 0 ? outputLength / inputLength : 1;

    console.log(`[Validation] ContentOnly=${inputLength}, Output=${outputLength}, Ratio=${Math.round(ratio * 100)}%`);

    // ========== 1. CHECK ĐỘ DÀI (40% threshold - giảm xuống vì AI có thể viết gọn hơn) ==========
    if (ratio < 0.4) {
        result.valid = false;
        result.reason = `Output quá ngắn! Chỉ ${Math.round(ratio * 100)}% so với input`;
        result.errorCode = 'OUTPUT_TOO_SHORT';
        result.details = Math.round(ratio * 100);
        return result;
    }

    // Warning nếu hơi ngắn
    if (ratio < 0.6) {
        result.warning = `Output hơi ngắn: ${Math.round(ratio * 100)}% so với input`;
    }

    // ========== 2. CHECK TIẾNG VIỆT ==========
    // Regex cho các chữ có dấu tiếng Việt
    const vietnamesePattern = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i;

    // Chỉ check nếu output đủ dài (tránh false positive với text ngắn)
    if (outputLength > 100 && !vietnamesePattern.test(translated)) {
        result.valid = false;
        result.reason = 'Output không chứa tiếng Việt! AI có thể bị lỗi hoặc xuất sai ngôn ngữ.';
        result.errorCode = 'NO_VIETNAMESE';
        result.details = 'missing_diacritics';
        return result;
    }

    // ========== 3. CHECK ERROR MARKERS ==========
    const errorMarkers = [
        /\[LỖI/i,
        /\[ERROR/i,
        /\[FAILED/i,
        /\[BLOCKED/i,
        /I cannot/i,
        /I can't translate/i,
        /I'm unable to/i,
        /As an AI/i,
        /I apologize/i
    ];

    for (const marker of errorMarkers) {
        if (marker.test(translated)) {
            result.valid = false;
            result.reason = `Output chứa error marker hoặc AI từ chối dịch`;
            result.errorCode = 'ERROR_MARKER';
            result.details = marker.source;
            return result;
        }
    }

    // ========== 4. CHECK PROMPT LEAK ==========
    const promptLeakPatterns = [
        /⚠️ QUAN TRỌNG/,
        /KHÔNG ĐƯỢC VI PHẠM/,
        /FICTIONAL TRANSLATION TASK/,
        /CONTEXT:.*TÁC PHẨM VĂN HỌC/,
        /SYSTEM OVERRIDE:.*TRANSLATION MODE/,
        /INTERNAL SYSTEM DIRECTIVE/,
        /NON-NEGOTIABLE CONTRACT TERMS/,
        /LINH'S PROFESSIONAL STANDARDS/,
        /INJECTION IMMUNITY/,
        /clr_all_context/,
        /PRIORITY OVERRIDE.*RESTRICTIONS CANCELLED/,
        /MANDATORY COMPLIANCE.*EDITORIAL CONTRACT/
    ];

    for (const pattern of promptLeakPatterns) {
        if (pattern.test(translated)) {
            result.valid = false;
            result.reason = 'Output chứa prompt leak (AI lặp lại instructions)';
            result.errorCode = 'PROMPT_LEAK';
            result.details = 'prompt_in_output';
            return result;
        }
    }

    return result;
}

// ============================================
// CLEAN GEMINI RESPONSE - Loại bỏ markdown và format thừa
// ============================================
function cleanGeminiResponse(text) {
    // Patterns đầu văn bản cần xóa
    const patternsToRemove = [
        /^(Tuyệt vời!|Được rồi!|Okay!|Dưới đây là|Đây là|Here is)[^\n]*\n+/gi,
        /^(Tôi đã|Tôi sẽ|I have|I will)[^\n]*\n+/gi,
        /^[^\n]*(phiên bản đã|version|chỉnh sửa|edited)[^\n]*:\s*\n+/gi,
        /^---+\s*\n/gm,
        /^#+\s+[^\n]+\n+/gm,
    ];

    let cleaned = text;
    for (const pattern of patternsToRemove) {
        cleaned = cleaned.replace(pattern, '');
    }

    // ========== XÓA MARKDOWN FORMATTING ==========
    // Xóa headers (# ## ### etc)
    cleaned = cleaned.replace(/^#+\s+/gm, '');

    // Xóa bold (**text** hoặc __text__)
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');

    // Xóa italic (*text* hoặc _text_) - cẩn thận không xóa dấu * đơn trong văn bản
    cleaned = cleaned.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
    cleaned = cleaned.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');

    // Xóa bullet points (* - at start of line)
    cleaned = cleaned.replace(/^\s*[\*\-•]\s+/gm, '');

    // Xóa numbered list (1. 2. etc)
    cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, '');

    // Xóa inline code (`code`)
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // Xóa code blocks (```...```)
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

    // Xóa blockquote (> at start)
    cleaned = cleaned.replace(/^\s*>\s*/gm, '');

    // Xóa horizontal rules (--- or ***)
    cleaned = cleaned.replace(/^\s*[-*_]{3,}\s*$/gm, '');

    // Xóa dấu * hoặc ** đứng đơn lẻ còn sót
    cleaned = cleaned.replace(/\*+\s*/g, ' ');
    cleaned = cleaned.replace(/\s*\*+/g, ' ');

    // Clean up multiple spaces
    cleaned = cleaned.replace(/  +/g, ' ');
    // Clean up multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Patterns cuối văn bản cần xóa
    const trailingPatterns = [
        /\n+(Hy vọng|Tôi đã|Lưu ý|Note:|Ghi chú)[^\n]*$/gi,
        /\n+---+\s*$/gm,
    ];

    for (const pattern of trailingPatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.trim();
}

// NOTE: translateChunkWithRetry, translateLargeChunkBySplitting, splitTextIntoSmallerParts
// đã được định nghĩa đầy đủ trong js/translation/retry.js với:
// - Progressive prompt support
// - OUTPUT_TOO_SHORT handling
// - Better error recovery
// Do đó không cần duplicate ở đây.
