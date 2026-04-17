/**
 * Novel Translator Pro - Gemini API
 * Gọi Gemini Cloud API hoặc Proxy API để dịch văn bản
 */

// ============================================
// PROXY API - OpenAI Compatible (BeiJiXingXing, OpenRouter...)
// ============================================
async function translateChunkViaProxy(text, temperature = 0.7, apiKeyOverride = null) {
    const activeKey = apiKeyOverride || proxyApiKey;
    if (!activeKey) throw new Error('Chưa nhập API Key proxy!');
    if (!proxyBaseUrl) throw new Error('Chưa cấu hình Proxy Base URL!');

    console.log(`[Proxy] Model: ${proxyModel} | Temp: ${temperature} | Key: ...${activeKey.slice(-6)}`);

    const controller = new AbortController();
    if (typeof registerActiveRequestController === 'function') {
        registerActiveRequestController(controller);
    }
    const timeoutId = setTimeout(() => controller.abort('request-timeout'), 120000); // 2 min timeout

    let response;
    try {
        response = await fetch(proxyBaseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${activeKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: proxyModel,
                messages: [{ role: 'user', content: text }],
                temperature: temperature,
                max_tokens: 16384
            }),
            signal: controller.signal
        });
    } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
            if (cancelRequested) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            throw new Error(`Proxy timeout sau 120s - ${proxyModel}`);
        }
        throw fetchError;
    } finally {
        clearTimeout(timeoutId);
        if (typeof unregisterActiveRequestController === 'function') {
            unregisterActiveRequestController(controller);
        }
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `HTTP ${response.status}`;

        console.error(`[Proxy ERROR] Status: ${response.status} | ${errorMsg}`);

        if (response.status === 429) {
            throw new Error(`429 - Proxy rate limited: ${errorMsg}`);
        }
        if (response.status === 403) {
            // CONSUMER_SUSPENDED - proxy backend key bị ban, retry sẽ xoay sang key khác
            console.warn(`[Proxy] 403 - Backend suspended, proxy sẽ xoay key khác khi retry...`);
            throw new Error(`403 - Backend key suspended (sẽ xoay key khác): ${errorMsg.substring(0, 100)}`);
        }
        if (response.status === 402) {
            throw new Error(`402 - Proxy quota hết: ${errorMsg}`);
        }
        if (response.status === 401) {
            throw new Error('API Key proxy không hợp lệ!');
        }
        if (response.status === 404) {
            throw new Error(`Model "${proxyModel}" không tìm thấy trên proxy!`);
        }

        throw new Error(errorMsg);
    }

    const data = await response.json();

    // Extract response - OpenAI format
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
        console.error('[Proxy ERROR] Empty response:', data);
        throw new Error('Proxy API: Empty response');
    }

    let result = cleanGeminiResponse(content);

    // Validation
    const validationResult = validateTranslationOutput(text, result);
    if (!validationResult.valid) {
        console.error(`[❌ VALIDATION FAILED] ${validationResult.reason}`);
        throw new Error(`${validationResult.errorCode}:${validationResult.details}`);
    }
    if (validationResult.warning) {
        console.warn(`[⚠️ WARNING] ${validationResult.warning}`);
    }

    return result;
}

// ============================================
// GEMINI TRANSLATE CHUNK (Direct API hoặc auto-route qua Proxy)
// ============================================
async function translateChunk(text, modelKeyPair, temperature = 0.7) {
    // ===== AUTO-ROUTE: Nếu bật proxy, gọi proxy thay vì Gemini Direct =====
    if (useProxy) {
        // Safety net: should not normally reach here (retry.js handles proxy routing)
        const proxyKey = typeof getProxyKeyForChunk === 'function' ? getProxyKeyForChunk(0) : proxyApiKey;
        return await translateChunkViaProxy(text, temperature, proxyKey);
    }

    const { model: modelName, key: apiKey, keyIndex } = modelKeyPair;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    console.log(`[Gemini API] ${modelName} + Key ${keyIndex + 1} (temp=${temperature})`);

    const body = {
        contents: [{
            parts: [{ text: text }]
        }],
        generationConfig: {
            temperature: temperature,
            maxOutputTokens: 16384,
            topP: 0.95,
            topK: 40
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" }
        ]
    };

    // TIMEOUT: 120 giây (gemini-2.5-flash thinking cần 60-90s cho text dài)
    const controller = new AbortController();
    if (typeof registerActiveRequestController === 'function') {
        registerActiveRequestController(controller);
    }
    const timeoutId = setTimeout(() => controller.abort('request-timeout'), 120000);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
            if (cancelRequested) {
                throw new Error('TRANSLATION_CANCELLED');
            }
            throw new Error(`API timeout sau 120s - ${modelName} + Key ${keyIndex + 1}`);
        }
        throw fetchError;
    } finally {
        clearTimeout(timeoutId);
        if (typeof unregisterActiveRequestController === 'function') {
            unregisterActiveRequestController(controller);
        }
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `HTTP ${response.status}`;

        console.error(`[Gemini API ERROR] Status: ${response.status}`);
        console.error(`[Gemini API ERROR] Message: ${errorMsg}`);

        if (response.status === 429) {
            recordModelKeyError(modelName, keyIndex);
            throw new Error(`429 - ${modelName} + Key ${keyIndex + 1} hết quota. Switching...`);
        }
        if (response.status === 400 && errorMsg.includes('API key')) {
            throw new Error('API Key không hợp lệ. Vui lòng kiểm tra lại.');
        }
        if (response.status === 404) {
            recordModelKeyError(modelName, keyIndex);
            throw new Error(`Model "${modelName}" không tìm thấy. Thử combination khác.`);
        }

        throw new Error(errorMsg);
    }

    const data = await response.json();
    console.log(`[Gemini API] Response received successfully`);

    // Extract text from Gemini response
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        let result = data.candidates[0].content.parts[0].text.trim();
        result = cleanGeminiResponse(result);

        // ========== VALIDATION ĐẦY ĐỦ ==========
        const validationResult = validateTranslationOutput(text, result);

        if (!validationResult.valid) {
            console.error(`[❌ VALIDATION FAILED] ${validationResult.reason}`);
            throw new Error(`${validationResult.errorCode}:${validationResult.details}`);
        }

        if (validationResult.warning) {
            console.warn(`[⚠️ WARNING] ${validationResult.warning}`);
        }

        return result;
    }

    // Check for blocked content - THROW ERROR instead of returning original text
    if (data.candidates?.[0]?.finishReason === 'SAFETY') {
        console.warn('[Gemini API] Content blocked by SAFETY filter');
        throw new Error('CONTENT_BLOCKED:safety_filter');
    }

    if (data.promptFeedback?.blockReason === 'PROHIBITED_CONTENT') {
        console.warn('[Gemini API] Content blocked by PROHIBITED_CONTENT filter');
        throw new Error('CONTENT_BLOCKED:prohibited_content');
    }

    // Check for empty/missing response
    if (!data.candidates || data.candidates.length === 0) {
        console.error('[Gemini API ERROR] No candidates in response');
        throw new Error('CONTENT_BLOCKED:no_candidates');
    }

    console.error('[Gemini API ERROR] Invalid response format:', data);
    throw new Error('Gemini API: Invalid response format');
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
