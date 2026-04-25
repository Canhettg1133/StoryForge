/**
 * Novel Translator Pro - User-facing error messages
 * Chuẩn hóa lỗi Gemini/Proxy/Ollama thành thông báo tiếng Việt có dấu.
 */

(function attachTranslatorErrorHelpers(global) {
    const VALIDATION_ERROR_MESSAGES = {
        OUTPUT_TOO_SHORT: ({ details }) => {
            const percent = Number.isFinite(Number(details)) ? ` (${details}%)` : '';
            return `Kết quả quá ngắn so với nội dung gốc${percent}. Hệ thống sẽ thử prompt mạnh hơn hoặc chia nhỏ chunk.`;
        },
        NO_VIETNAMESE: () => 'Kết quả không có dấu hiệu tiếng Việt có dấu. Hệ thống sẽ thử lại bằng prompt khác.',
        ERROR_MARKER: () => 'AI trả về câu từ chối hoặc marker lỗi thay vì bản dịch. Hệ thống sẽ thử prompt phù hợp hơn.',
        PROMPT_LEAK: () => 'AI lặp lại prompt hoặc instruction thay vì chỉ trả bản dịch. Hệ thống sẽ thử lại.',
    };

    const DEFAULT_ERROR_MESSAGES = {
        TRANSLATION_CANCELLED: () => 'Đã hủy dịch.',
        MISSING_PROXY_KEY: () => 'Chưa nhập API Key proxy. Hãy thêm key proxy trước khi dịch.',
        MISSING_PROXY_URL: () => 'Chưa cấu hình Proxy Base URL. Hãy nhập endpoint proxy trước khi dịch.',
        PROXY_TIMEOUT: ({ timeoutSeconds = 120, model }) => `Proxy không phản hồi sau ${timeoutSeconds} giây${model ? ` với model ${model}` : ''}. Kiểm tra server proxy hoặc giảm kích thước chunk.`,
        PROXY_RATE_LIMIT: () => 'Proxy đã vượt giới hạn rate limit. Hệ thống sẽ chờ một chút rồi thử lại.',
        PROXY_BACKEND_SUSPENDED: () => 'Proxy trả lỗi 403 vì key backend bị khóa hoặc bị tạm dừng. Hệ thống sẽ thử key khác nếu còn key khả dụng.',
        PROXY_QUOTA_EXHAUSTED: () => 'Proxy đã hết quota hoặc hết số dư. Hãy nạp thêm quota, đổi key proxy hoặc chuyển sang Gemini Direct.',
        PROXY_INVALID_KEY: () => 'API Key proxy không hợp lệ. Hãy kiểm tra lại key đang dùng.',
        PROXY_MODEL_NOT_FOUND: ({ model }) => `Proxy không tìm thấy model${model ? ` "${model}"` : ''}. Hãy chọn model khác hoặc kiểm tra tên model.`,
        PROXY_EMPTY_RESPONSE: () => 'Proxy trả về response rỗng. Hãy thử lại hoặc đổi model/proxy.',
        PROXY_HTTP_ERROR: ({ status }) => `Proxy trả lỗi HTTP ${status || 'không xác định'}. Hãy kiểm tra endpoint, key và model proxy.`,

        INVALID_API_KEY: () => 'API Key không hợp lệ hoặc đã bị thu hồi. Hãy kiểm tra lại key trong Google AI Studio.',
        NETWORK_ERROR: ({ provider = 'dịch' }) => `Không kết nối được tới ${provider}. Kiểm tra mạng, URL proxy/Ollama hoặc cấu hình CORS.`,
        GEMINI_TIMEOUT: ({ model, keyIndex, timeoutSeconds = 120 }) => `Gemini không trả kết quả sau ${timeoutSeconds} giây${formatModelKeySuffix(model, keyIndex)}. Hãy giảm kích thước chunk hoặc thử model nhẹ hơn.`,
        GEMINI_INVALID_ARGUMENT: () => 'Yêu cầu gửi tới Gemini không hợp lệ. Kiểm tra tên model, kích thước chunk, generationConfig hoặc safetySettings rồi thử lại.',
        GEMINI_FAILED_PRECONDITION: () => 'Dự án/API key chưa đủ điều kiện gọi Gemini cho yêu cầu này. Hãy kiểm tra billing, quốc gia/khu vực hoặc cấu hình Google AI Studio.',
        GEMINI_PERMISSION_DENIED: () => 'API key không có quyền gọi Gemini hoặc model này. Hãy kiểm tra project, quyền API, trạng thái key hoặc dùng key khác.',
        GEMINI_NOT_FOUND: ({ model }) => `Không tìm thấy model Gemini${model ? ` "${model}"` : ''}. Hãy kiểm tra tên model hoặc chọn model khác.`,
        GEMINI_RATE_LIMIT: () => 'Gemini đã vượt giới hạn quota hoặc rate limit cho model/project hiện tại. Hệ thống sẽ xoay key/model nếu còn lựa chọn khác, hoặc chờ quota hồi lại.',
        GEMINI_INTERNAL: () => 'Lỗi nội bộ phía Google. Đây là lỗi tạm thời từ Gemini, hãy thử lại sau.',
        GEMINI_UNAVAILABLE: () => 'Gemini đang quá tải hoặc tạm thời không khả dụng. Hệ thống sẽ thử lại hoặc đổi model.',
        GEMINI_DEADLINE: () => 'Gemini xử lý quá lâu và đã quá hạn. Hãy giảm kích thước chunk hoặc thử model khác.',
        GEMINI_HTTP_ERROR: ({ status }) => `Gemini trả lỗi HTTP ${status || 'không xác định'}. Hãy kiểm tra key, model và thử lại.`,
        INVALID_RESPONSE_FORMAT: ({ provider = 'Gemini' }) => `${provider} trả về response không có phần văn bản mong đợi. Hãy thử lại hoặc đổi model.`,

        CONTENT_BLOCKED_SAFETY: () => 'Nội dung bị bộ lọc an toàn của Gemini chặn. Hệ thống sẽ thử prompt văn học/fictional hoặc chia nhỏ chunk.',
        CONTENT_BLOCKED_PROHIBITED: () => 'Nội dung bị Gemini chặn theo chính sách. Hãy chia nhỏ đoạn, chỉnh prompt hoặc dịch thủ công chunk này.',
        CONTENT_BLOCKED_RECITATION: () => 'Gemini dừng vì kết quả có nguy cơ trùng lặp nội dung có bản quyền. Hãy chia nhỏ chunk hoặc đổi cách prompt.',
        CONTENT_BLOCKED_MAX_TOKENS: () => 'Gemini đụng giới hạn token đầu ra trước khi hoàn tất. Hãy giảm kích thước chunk hoặc tăng model/token phù hợp.',
        CONTENT_BLOCKED_SPII: () => 'Gemini chặn vì phát hiện dữ liệu cá nhân nhạy cảm. Hãy xem lại chunk và dịch thủ công nếu cần.',
        CONTENT_BLOCKED_BLOCKLIST: () => 'Gemini chặn vì nội dung khớp blocklist. Hãy xem lại chunk hoặc dịch thủ công.',
        CONTENT_BLOCKED_LANGUAGE: () => 'Gemini không hỗ trợ hoặc không xử lý được ngôn ngữ trong chunk này. Hãy kiểm tra ngôn ngữ nguồn.',
        CONTENT_BLOCKED_MALFORMED_FUNCTION_CALL: () => 'Gemini dừng vì response/tool call bị sai định dạng. Hãy thử lại hoặc tắt cấu hình tool nếu có.',
        CONTENT_BLOCKED_UNEXPECTED_TOOL_CALL: () => 'Gemini cố gọi tool dù request không bật tool. Hãy thử lại hoặc kiểm tra cấu hình request.',
        CONTENT_BLOCKED_IMAGE_SAFETY: () => 'Gemini chặn vì nội dung hình ảnh không an toàn. Chunk dịch chữ thường không nên gặp lỗi này, hãy kiểm tra dữ liệu đầu vào.',
        CONTENT_BLOCKED_IMAGE_PROHIBITED: () => 'Gemini chặn vì nội dung hình ảnh bị cấm. Hãy kiểm tra dữ liệu đầu vào.',
        CONTENT_BLOCKED_MALFORMED_RESPONSE: () => 'Gemini dừng vì response bị sai định dạng. Hãy thử lại hoặc đổi model.',
        CONTENT_BLOCKED_NO_CANDIDATES: () => 'Gemini không trả về ứng viên dịch nào. Hệ thống sẽ thử lại bằng prompt khác.',
        CONTENT_BLOCKED_OTHER: () => 'Gemini dừng tạo kết quả nhưng không nêu lý do cụ thể. Hãy thử lại, đổi model hoặc chia nhỏ chunk.',

        OLLAMA_TIMEOUT: ({ timeoutSeconds = 300 }) => `Ollama không trả kết quả sau ${timeoutSeconds} giây. Chunk có thể quá dài hoặc model local quá chậm.`,
        OLLAMA_CONNECTION: () => 'Không thể kết nối tới Ollama. Hãy kiểm tra Ollama đã chạy chưa, URL có đúng không và firewall/CORS có chặn không.',
        OLLAMA_MODEL_MISSING: ({ model }) => `Ollama chưa có model${model ? ` "${model}"` : ''}. Hãy chạy lệnh ollama pull cho model đó.`,
        OLLAMA_HTTP_ERROR: ({ status }) => `Ollama trả lỗi HTTP ${status || 'không xác định'}. Hãy kiểm tra server local và model đang chọn.`,
        OLLAMA_INVALID_RESPONSE: () => 'Ollama trả về response không đúng định dạng chat/generate mong đợi.',
        UNKNOWN_ERROR: () => 'Đã xảy ra lỗi chưa phân loại khi dịch. Chi tiết kỹ thuật đã được ghi trong Console.',
    };

    const GEMINI_HTTP_STATUS_TO_CODE = {
        400: 'GEMINI_INVALID_ARGUMENT',
        401: 'INVALID_API_KEY',
        403: 'GEMINI_PERMISSION_DENIED',
        404: 'GEMINI_NOT_FOUND',
        429: 'GEMINI_RATE_LIMIT',
        500: 'GEMINI_INTERNAL',
        503: 'GEMINI_UNAVAILABLE',
        504: 'GEMINI_DEADLINE',
    };

    const GEMINI_RPC_STATUS_TO_CODE = {
        INVALID_ARGUMENT: 'GEMINI_INVALID_ARGUMENT',
        FAILED_PRECONDITION: 'GEMINI_FAILED_PRECONDITION',
        UNAUTHENTICATED: 'INVALID_API_KEY',
        PERMISSION_DENIED: 'GEMINI_PERMISSION_DENIED',
        NOT_FOUND: 'GEMINI_NOT_FOUND',
        RESOURCE_EXHAUSTED: 'GEMINI_RATE_LIMIT',
        INTERNAL: 'GEMINI_INTERNAL',
        UNAVAILABLE: 'GEMINI_UNAVAILABLE',
        DEADLINE_EXCEEDED: 'GEMINI_DEADLINE',
    };

    const PROXY_STATUS_TO_CODE = {
        400: 'PROXY_HTTP_ERROR',
        401: 'PROXY_INVALID_KEY',
        402: 'PROXY_QUOTA_EXHAUSTED',
        403: 'PROXY_BACKEND_SUSPENDED',
        404: 'PROXY_MODEL_NOT_FOUND',
        429: 'PROXY_RATE_LIMIT',
    };

    const GEMINI_BLOCK_REASON_TO_CODE = {
        PROHIBITED_CONTENT: 'CONTENT_BLOCKED_PROHIBITED',
        BLOCKLIST: 'CONTENT_BLOCKED_BLOCKLIST',
        SAFETY: 'CONTENT_BLOCKED_SAFETY',
        OTHER: 'CONTENT_BLOCKED_OTHER',
    };

    const GEMINI_FINISH_REASON_TO_CODE = {
        SAFETY: 'CONTENT_BLOCKED_SAFETY',
        RECITATION: 'CONTENT_BLOCKED_RECITATION',
        MAX_TOKENS: 'CONTENT_BLOCKED_MAX_TOKENS',
        PROHIBITED_CONTENT: 'CONTENT_BLOCKED_PROHIBITED',
        SPII: 'CONTENT_BLOCKED_SPII',
        MALFORMED_FUNCTION_CALL: 'CONTENT_BLOCKED_MALFORMED_FUNCTION_CALL',
        BLOCKLIST: 'CONTENT_BLOCKED_BLOCKLIST',
        LANGUAGE: 'CONTENT_BLOCKED_LANGUAGE',
        IMAGE_SAFETY: 'CONTENT_BLOCKED_IMAGE_SAFETY',
        IMAGE_PROHIBITED_CONTENT: 'CONTENT_BLOCKED_IMAGE_PROHIBITED',
        IMAGE_OTHER: 'CONTENT_BLOCKED_OTHER',
        NO_IMAGE: 'CONTENT_BLOCKED_OTHER',
        IMAGE_RECITATION: 'CONTENT_BLOCKED_RECITATION',
        UNEXPECTED_TOOL_CALL: 'CONTENT_BLOCKED_UNEXPECTED_TOOL_CALL',
        TOO_MANY_TOOL_CALLS: 'CONTENT_BLOCKED_UNEXPECTED_TOOL_CALL',
        MISSING_THOUGHT_SIGNATURE: 'CONTENT_BLOCKED_MALFORMED_RESPONSE',
        MALFORMED_RESPONSE: 'CONTENT_BLOCKED_MALFORMED_RESPONSE',
        OTHER: 'CONTENT_BLOCKED_OTHER',
    };

    class TranslatorError extends Error {
        constructor(code, userMessage, options = {}) {
            super(userMessage);
            this.name = 'TranslatorError';
            this.code = code || 'UNKNOWN_ERROR';
            this.userMessage = userMessage;
            this.status = options.status;
            this.provider = options.provider;
            this.model = options.model;
            this.keyIndex = options.keyIndex;
            this.googleStatus = options.googleStatus;
            this.blockReason = options.blockReason;
            this.finishReason = options.finishReason;
            this.rawMessage = options.rawMessage;
            this.details = options.details;
            this.retryable = Boolean(options.retryable);
            this.shouldRotate = Boolean(options.shouldRotate);
            this.retryAfterSeconds = options.retryAfterSeconds;
        }
    }

    function formatModelKeySuffix(model, keyIndex) {
        const parts = [];
        if (model) parts.push(model);
        if (Number.isInteger(keyIndex)) parts.push(`Key ${keyIndex + 1}`);
        return parts.length ? ` với ${parts.join(' + ')}` : '';
    }

    function trimRawMessage(message) {
        return String(message || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    }

    function parseRetryAfter(rawMessage) {
        const match = String(rawMessage || '').match(/retry\s+in\s+([\d.]+)s/i);
        return match ? Math.ceil(Number(match[1])) : undefined;
    }

    function getDefaultErrorMessage(code, options = {}) {
        const factory = VALIDATION_ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGES.UNKNOWN_ERROR;
        return factory(options);
    }

    function createTranslatorError(code, options = {}) {
        const userMessage = options.userMessage || getDefaultErrorMessage(code, options);
        return new TranslatorError(code, userMessage, options);
    }

    function createValidationTranslatorError(validationResult = {}) {
        const code = validationResult.errorCode || 'UNKNOWN_ERROR';
        return createTranslatorError(code, {
            provider: 'Validation',
            details: validationResult.details,
            rawMessage: validationResult.reason || `${code}:${validationResult.details || ''}`,
            retryable: ['OUTPUT_TOO_SHORT', 'NO_VIETNAMESE', 'ERROR_MARKER', 'PROMPT_LEAK'].includes(code),
        });
    }

    function isInvalidApiKeyMessage(rawMessage) {
        const normalized = String(rawMessage || '').toLowerCase();
        return normalized.includes('api key not valid') ||
            normalized.includes('api key not found') ||
            normalized.includes('invalid api key') ||
            normalized.includes('api key không hợp lệ') ||
            normalized.includes('api key khong hop le');
    }

    function createGeminiHttpError(status, errorData = {}, context = {}) {
        const rawMessage = errorData?.error?.message || `HTTP ${status}`;
        const googleStatus = String(errorData?.error?.status || '').toUpperCase();
        let code = GEMINI_RPC_STATUS_TO_CODE[googleStatus] || GEMINI_HTTP_STATUS_TO_CODE[status] || 'GEMINI_HTTP_ERROR';

        if (isInvalidApiKeyMessage(rawMessage)) {
            code = 'INVALID_API_KEY';
        }

        return createTranslatorError(code, {
            ...context,
            provider: 'Gemini',
            status,
            googleStatus,
            rawMessage,
            retryable: ['GEMINI_RATE_LIMIT', 'GEMINI_INTERNAL', 'GEMINI_UNAVAILABLE', 'GEMINI_DEADLINE'].includes(code),
            shouldRotate: ['GEMINI_RATE_LIMIT', 'GEMINI_NOT_FOUND', 'GEMINI_PERMISSION_DENIED', 'INVALID_API_KEY'].includes(code),
            retryAfterSeconds: parseRetryAfter(rawMessage),
        });
    }

    function createProxyHttpError(status, errorData = {}, context = {}) {
        const rawMessage = errorData?.error?.message || errorData?.message || `HTTP ${status}`;
        let code = PROXY_STATUS_TO_CODE[status] || 'PROXY_HTTP_ERROR';
        const normalized = String(rawMessage || '').toLowerCase();

        if (status === 403 && !/(suspended|consumer_suspended|backend|ban|blocked)/i.test(rawMessage)) {
            code = 'PROXY_HTTP_ERROR';
        }
        if (status === 429 || normalized.includes('rate limit')) {
            code = 'PROXY_RATE_LIMIT';
        }
        if (status === 402 || normalized.includes('quota') || normalized.includes('balance')) {
            code = 'PROXY_QUOTA_EXHAUSTED';
        }

        return createTranslatorError(code, {
            ...context,
            provider: 'Proxy',
            status,
            rawMessage,
            retryable: ['PROXY_RATE_LIMIT', 'PROXY_BACKEND_SUSPENDED', 'PROXY_HTTP_ERROR'].includes(code),
            shouldRotate: ['PROXY_RATE_LIMIT', 'PROXY_BACKEND_SUSPENDED', 'PROXY_MODEL_NOT_FOUND'].includes(code),
            retryAfterSeconds: parseRetryAfter(rawMessage),
        });
    }

    function createOllamaHttpError(status, errorData = {}, context = {}) {
        const rawMessage = errorData?.error || errorData?.message || `HTTP ${status}`;
        const code = /model.*not found|not found/i.test(rawMessage) ? 'OLLAMA_MODEL_MISSING' : 'OLLAMA_HTTP_ERROR';
        return createTranslatorError(code, {
            ...context,
            provider: 'Ollama',
            status,
            rawMessage,
            retryable: status >= 500,
        });
    }

    function createGeminiBlockedError(data = {}, context = {}) {
        const blockReason = data?.promptFeedback?.blockReason;
        const finishReason = data?.candidates?.[0]?.finishReason;
        const code = GEMINI_BLOCK_REASON_TO_CODE[blockReason] ||
            GEMINI_FINISH_REASON_TO_CODE[finishReason] ||
            'CONTENT_BLOCKED_NO_CANDIDATES';

        return createTranslatorError(code, {
            ...context,
            provider: 'Gemini',
            blockReason,
            finishReason,
            rawMessage: blockReason || finishReason || 'no_candidates',
            retryable: !['CONTENT_BLOCKED_PROHIBITED', 'CONTENT_BLOCKED_SPII'].includes(code),
        });
    }

    function normalizeTranslatorError(error, context = {}) {
        if (error instanceof TranslatorError || error?.name === 'TranslatorError') {
            return error;
        }

        const rawMessage = String(error?.message || error || '').trim();
        const upper = rawMessage.toUpperCase();
        const lower = rawMessage.toLowerCase();

        if (upper.includes('TRANSLATION_CANCELLED')) {
            return createTranslatorError('TRANSLATION_CANCELLED', { ...context, rawMessage });
        }

        const prefixedCode = upper.match(/^([A-Z_]+):/u)?.[1];
        if (prefixedCode && (VALIDATION_ERROR_MESSAGES[prefixedCode] || prefixedCode === 'CONTENT_BLOCKED')) {
            if (prefixedCode === 'CONTENT_BLOCKED') {
                if (lower.includes('prohibited')) return createTranslatorError('CONTENT_BLOCKED_PROHIBITED', { ...context, rawMessage, retryable: false });
                if (lower.includes('safety')) return createTranslatorError('CONTENT_BLOCKED_SAFETY', { ...context, rawMessage, retryable: true });
                return createTranslatorError('CONTENT_BLOCKED_NO_CANDIDATES', { ...context, rawMessage, retryable: true });
            }
            const details = rawMessage.split(':').slice(1).join(':');
            return createTranslatorError(prefixedCode, { ...context, details, rawMessage, retryable: true });
        }

        if (lower.includes('proxy timeout')) {
            return createTranslatorError('PROXY_TIMEOUT', { ...context, rawMessage, provider: 'Proxy', retryable: true });
        }
        if (lower.includes('api timeout')) {
            return createTranslatorError('GEMINI_TIMEOUT', { ...context, rawMessage, provider: 'Gemini', retryable: true });
        }
        if (lower.includes('ollama timeout')) {
            return createTranslatorError('OLLAMA_TIMEOUT', { ...context, rawMessage, provider: 'Ollama', retryable: true });
        }
        if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
            return createTranslatorError('NETWORK_ERROR', { ...context, rawMessage, retryable: true });
        }
        if (isInvalidApiKeyMessage(rawMessage)) {
            return createTranslatorError('INVALID_API_KEY', { ...context, rawMessage, shouldRotate: true });
        }
        if (lower.includes('quota') || lower.includes('rate limit') || rawMessage.startsWith('429')) {
            return createTranslatorError('GEMINI_RATE_LIMIT', { ...context, rawMessage, retryable: true, shouldRotate: true, retryAfterSeconds: parseRetryAfter(rawMessage) });
        }
        if (rawMessage.startsWith('404') || lower.includes('model not found') || lower.includes('không tìm thấy')) {
            return createTranslatorError('GEMINI_NOT_FOUND', { ...context, rawMessage, shouldRotate: true });
        }
        if (rawMessage.startsWith('403') || lower.includes('permission_denied')) {
            return createTranslatorError('GEMINI_PERMISSION_DENIED', { ...context, rawMessage, shouldRotate: true });
        }
        if (rawMessage.startsWith('503') || lower.includes('overloaded') || lower.includes('unavailable')) {
            return createTranslatorError('GEMINI_UNAVAILABLE', { ...context, rawMessage, retryable: true });
        }
        if (rawMessage.startsWith('500') || lower.includes('internal')) {
            return createTranslatorError('GEMINI_INTERNAL', { ...context, rawMessage, retryable: true });
        }

        return createTranslatorError('UNKNOWN_ERROR', { ...context, rawMessage });
    }

    function getTranslatorErrorCode(error) {
        return normalizeTranslatorError(error).code;
    }

    function formatTranslatorError(error, prefix = '') {
        const normalized = normalizeTranslatorError(error);
        const message = normalized.userMessage || normalized.message || getDefaultErrorMessage(normalized.code, normalized);
        return prefix ? `${prefix}: ${message}` : message;
    }

    global.TranslatorError = TranslatorError;
    global.createTranslatorError = createTranslatorError;
    global.createValidationTranslatorError = createValidationTranslatorError;
    global.createGeminiHttpError = createGeminiHttpError;
    global.createProxyHttpError = createProxyHttpError;
    global.createOllamaHttpError = createOllamaHttpError;
    global.createGeminiBlockedError = createGeminiBlockedError;
    global.normalizeTranslatorError = normalizeTranslatorError;
    global.getTranslatorErrorCode = getTranslatorErrorCode;
    global.formatTranslatorError = formatTranslatorError;
})(typeof globalThis !== 'undefined' ? globalThis : window);
