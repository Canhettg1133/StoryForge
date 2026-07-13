const TRANSLATOR_GLOBAL_PROMPT_KEYS = new Set([
    'convert',
    'novel',
    'wuxia',
    'romance',
    'adult',
    'sacHiep',
    'sacHiepPro',
    'sacHiepENI',
]);

let translatorGlobalPromptSettingsLoaded = false;
let translatorGlobalPromptSettingsRevision = 0;

function normalizeTranslatorGlobalPromptMap(payload) {
    const prompts = payload && typeof payload === 'object' && payload.prompts && typeof payload.prompts === 'object'
        ? payload.prompts
        : {};
    const normalized = {};
    Object.entries(prompts).forEach(([key, value]) => {
        if (!TRANSLATOR_GLOBAL_PROMPT_KEYS.has(key)) return;
        if (typeof value !== 'string') return;
        const content = value.trim();
        if (!content || content.length > 60000) return;
        normalized[key] = content;
    });
    return normalized;
}

function applyTranslatorGlobalPromptSettings(prompts) {
    if (typeof PROMPT_TEMPLATES === 'undefined') return 0;
    let applied = 0;
    Object.entries(prompts || {}).forEach(([key, content]) => {
        if (!TRANSLATOR_GLOBAL_PROMPT_KEYS.has(key)) return;
        PROMPT_TEMPLATES[key] = typeof ensureCharacterNameConsistencyPrompt === 'function'
            ? ensureCharacterNameConsistencyPrompt(content)
            : content;
        applied += 1;
    });
    return applied;
}

async function loadTranslatorGlobalPromptSettings({ timeoutMs = 1500 } = {}) {
    if (typeof fetch !== 'function') return false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    try {
        const response = await fetch('/api/translator-prompt-settings', {
            cache: 'no-store',
            signal: controller?.signal,
        });
        if (!response?.ok) return false;
        const payload = await response.json();
        const prompts = normalizeTranslatorGlobalPromptMap(payload);
        const applied = applyTranslatorGlobalPromptSettings(prompts);
        translatorGlobalPromptSettingsLoaded = true;
        translatorGlobalPromptSettingsRevision = Number(payload?.revision || 0) || 0;
        return applied > 0;
    } catch {
        return false;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

if (typeof window !== 'undefined') {
    window.loadTranslatorGlobalPromptSettings = loadTranslatorGlobalPromptSettings;
    window.applyTranslatorGlobalPromptSettings = applyTranslatorGlobalPromptSettings;
}
