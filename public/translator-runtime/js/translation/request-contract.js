/**
 * Shared request contract for translator providers.
 */
(function exposeTranslatorRequestContract(global) {
    const SOURCE_MARKER = '[Đoạn nguồn]';
    const SOURCE_LANGUAGE_LABELS = {
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

    function normalizeSourceLanguage(sourceLang) {
        const normalized = String(sourceLang || 'auto').trim();
        return SOURCE_LANGUAGE_LABELS[normalized] ? normalized : 'auto';
    }

    function buildSourceLanguageUserDirective(sourceLang = 'auto') {
        const normalized = normalizeSourceLanguage(sourceLang);
        if (normalized === 'auto') {
            return `[YÊU CẦU NGÔN NGỮ NGUỒN]
- Tự động phát hiện ngôn ngữ nguồn của đoạn văn bên dưới.
- Dịch trực tiếp toàn bộ nội dung sang tiếng Việt mượt mà, tự nhiên.
- Nếu nguồn đã là tiếng Việt convert hoặc dịch máy, biên tập lại thành tiếng Việt tự nhiên.
- Chỉ trả về bản tiếng Việt cuối cùng; không giải thích và không bỏ đoạn.`;
        }

        const label = SOURCE_LANGUAGE_LABELS[normalized];
        return `[YÊU CẦU NGÔN NGỮ NGUỒN]
- Ngôn ngữ nguồn người dùng chọn: ${label}.
- Dịch trực tiếp toàn bộ nội dung từ ${label} sang tiếng Việt mượt mà, tự nhiên.
- Giữ nhất quán tên riêng, địa danh, thuật ngữ và sắc thái truyện; không tóm tắt hoặc bỏ đoạn.
- Chỉ trả về bản tiếng Việt cuối cùng; không giải thích.`;
    }

    function joinPromptSections(sections) {
        return sections
            .map((section) => String(section || '').trim())
            .filter(Boolean)
            .join('\n\n');
    }

    function compileTranslationRequest(options = {}) {
        const sourceText = String(options.sourceText || '').trim();
        const contextText = String(options.contextText || '').trim();
        const legacyEditMarker = ['VĂN BẢN CẦN', 'BIÊN TẬP:'].join(' ');
        const basePromptText = String(options.basePromptText || '')
            .replaceAll(legacyEditMarker, '')
            .trim();
        const storyPromptText = options.storyPromptEnabled
            ? String(options.storyPromptText || '').trim()
            : '';
        const systemText = joinPromptSections([
            basePromptText,
            options.canonPromptText,
            storyPromptText,
        ]);
        const contextSection = contextText
            ? `[NGỮ CẢNH THAM KHẢO]
Chỉ dùng phần này để giữ tên riêng, xưng hô và giọng văn. Không dịch lại phần ngữ cảnh.
${contextText}`
            : '';
        const userText = joinPromptSections([
            buildSourceLanguageUserDirective(options.sourceLang),
            contextSection,
            `${SOURCE_MARKER}\n${sourceText}`,
        ]);

        return { systemText, userText, sourceText };
    }

    function normalizeTranslationRequest(input) {
        if (input && typeof input === 'object' && !Array.isArray(input)) {
            return {
                systemText: String(input.systemText || '').trim(),
                userText: String(input.userText || '').trim(),
                sourceText: String(input.sourceText || '').trim(),
            };
        }

        const legacyText = String(input || '');
        const markerIndex = legacyText.indexOf(SOURCE_MARKER);
        if (markerIndex < 0) {
            return {
                systemText: '',
                userText: legacyText,
                sourceText: legacyText,
            };
        }

        return {
            systemText: legacyText.slice(0, markerIndex).trim(),
            userText: legacyText,
            sourceText: legacyText.slice(markerIndex + SOURCE_MARKER.length).trim(),
        };
    }

    function prependTranslationSystemRule(input, ruleText) {
        const request = normalizeTranslationRequest(input);
        const rule = String(ruleText || '').trim();
        if (!rule) return request;
        return {
            ...request,
            systemText: joinPromptSections([rule, request.systemText]),
        };
    }

    function replaceTranslationRequestSource(input, sourceText) {
        const request = normalizeTranslationRequest(input);
        const source = String(sourceText || '').trim();
        const markerIndex = request.userText.lastIndexOf(SOURCE_MARKER);
        const userPrefix = markerIndex >= 0
            ? request.userText.slice(0, markerIndex).trim()
            : request.userText.trim();
        return {
            systemText: request.systemText,
            userText: joinPromptSections([userPrefix, `${SOURCE_MARKER}\n${source}`]),
            sourceText: source,
        };
    }

    const api = {
        TRANSLATOR_SOURCE_MARKER: SOURCE_MARKER,
        buildSourceLanguageUserDirective,
        compileTranslationRequest,
        normalizeTranslationRequest,
        prependTranslationSystemRule,
        replaceTranslationRequestSource,
    };

    Object.assign(global, api);
})(typeof globalThis !== 'undefined' ? globalThis : window);
