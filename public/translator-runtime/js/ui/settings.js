/**
 * Novel Translator Pro - Settings
 * Lưu và tải cấu hình
 */

// ============================================
// SETTINGS MANAGEMENT
// ============================================
const SETTINGS_GROUPS = ['gemini', 'proxy', 'ollama', 'general', 'canon-pack', 'prompt'];
const STORYFORGE_KEYS_STORAGE = 'sf-api-keys-v2';
const STORYFORGE_SETTINGS_STORAGE = 'sf-ai-settings';
const STORYFORGE_PROVIDER_STORAGE = 'sf-preferred-provider';

function readStoryForgeJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('[Translator] Failed to read StoryForge storage:', key, error);
        return null;
    }
}

function getStoryForgeKeys(provider) {
    const pools = readStoryForgeJson(STORYFORGE_KEYS_STORAGE);
    if (!pools || !Array.isArray(pools[provider])) return [];
    return pools[provider]
        .map((entry) => String(entry?.key || '').trim())
        .filter(Boolean);
}

function normalizeStoryForgeProxyUrl(rawValue) {
    const trimmed = String(rawValue || '').trim().replace(/\/+$/g, '');
    if (!trimmed) return '';
    if (/\/v1\/chat\/completions$/i.test(trimmed)) return trimmed;
    if (trimmed === '/api/proxy') return '/api/proxy/v1/chat/completions';
    if (trimmed === 'https://ag.beijixingxing.com') return 'https://ag.beijixingxing.com/v1/chat/completions';
    return `${trimmed}/v1/chat/completions`;
}

function importStoryForgeFallbackSettings() {
    const appSettings = readStoryForgeJson(STORYFORGE_SETTINGS_STORAGE) || {};
    const preferredProvider = String(localStorage.getItem(STORYFORGE_PROVIDER_STORAGE) || '').trim();
    const directKeys = getStoryForgeKeys('gemini_direct');
    const proxyKeys = getStoryForgeKeys('gemini_proxy');
    const hasTranslatorAiConfig = apiKeys.length > 0 || proxyApiKeys.length > 0 || Boolean(proxyApiKey);
    let imported = false;

    if (!apiKeys.length && directKeys.length) {
        apiKeys = directKeys;
        imported = true;
    }

    if (!proxyApiKeys.length && proxyKeys.length) {
        proxyApiKeys = proxyKeys;
        proxyApiKey = proxyKeys[0] || '';
        imported = true;
    }

    if ((!proxyBaseUrl || proxyBaseUrl === 'https://ag.beijixingxing.com/v1/chat/completions') && appSettings.proxyUrl) {
        proxyBaseUrl = normalizeStoryForgeProxyUrl(appSettings.proxyUrl);
        imported = Boolean(proxyBaseUrl) || imported;
    }

    if (!hasTranslatorAiConfig
        && (preferredProvider === 'gemini_proxy' || preferredProvider === 'gemini_direct')
        && proxyKeys.length + directKeys.length > 0) {
        useProxy = preferredProvider === 'gemini_proxy' && proxyKeys.length > 0;
        imported = true;
    }

    return imported;
}

function getActiveProviderLabel() {
    if (typeof useOllama !== 'undefined' && useOllama) return 'Ollama';
    if (typeof useProxy !== 'undefined' && useProxy) return 'Gemini Proxy';
    return 'Gemini Direct';
}

function shortenSummary(text, maxLength = 42) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}...`;
}

function getGeminiPrimaryModelSummary() {
    const activeModels = typeof getActiveModels === 'function' ? getActiveModels() : [];
    if (!activeModels.length) return 'chưa có model';
    if (activeModels.length === 1) return activeModels[0].name;
    return `${activeModels[0].name} +${activeModels.length - 1}`;
}

function getActiveConfigSummary() {
    if (typeof useOllama !== 'undefined' && useOllama) {
        return shortenSummary(String(ollamaModel || 'Local model'));
    }

    if (typeof useProxy !== 'undefined' && useProxy) {
        return shortenSummary(String(proxyModel || 'Proxy model'));
    }

    return shortenSummary(getGeminiPrimaryModelSummary());
}

function getGeminiAccordionSummary() {
    return `${apiKeys.length} key • ${getGeminiPrimaryModelSummary()}`;
}

function getProxyAccordionSummary() {
    const proxyCount = typeof getProxyKeyCount === 'function' ? getProxyKeyCount() : 0;
    return `${proxyModel || 'chưa chọn model'} • ${proxyCount} key`;
}

function getOllamaAccordionSummary() {
    return `${ollamaModel || 'chưa chọn model local'} • ${ollamaUrl || 'localhost'}`;
}

function getGeneralAccordionSummary() {
    const sourceLangSelect = document.getElementById('sourceLang');
    const parallelInput = document.getElementById('parallelCount');
    const chunkInput = document.getElementById('chunkSize');

    const sourceLangLabel = sourceLangSelect
        ? sourceLangSelect.options[sourceLangSelect.selectedIndex]?.textContent?.trim() || 'Auto'
        : 'Auto';
    const parallelCount = parallelInput?.value || '2';
    const chunkSize = chunkInput?.value || '2000';

    return `${shortenSummary(sourceLangLabel, 18)} • ${parallelCount} luồng • ${chunkSize} ký tự`;
}

function getPromptAccordionSummary() {
    const promptValue = document.getElementById('customPrompt')?.value?.trim() || '';
    if (!promptValue) return 'Đang để trống';

    if (typeof PROMPT_TEMPLATES !== 'undefined') {
        const matchedEntry = Object.entries(PROMPT_TEMPLATES).find(([, value]) => value === promptValue);
        if (matchedEntry) {
            return shortenSummary(getTemplateName(matchedEntry[0]), 30);
        }
    }

    return `${promptValue.length.toLocaleString()} ký tự prompt`;
}

function getCanonPackAccordionSummary() {
    if (typeof useCanonPackTranslation === 'undefined' || !useCanonPackTranslation) return 'Tắt';
    const pack = typeof getSelectedCanonPack === 'function' ? getSelectedCanonPack() : null;
    return pack?.title || pack?.id || 'Chưa chọn Canon Pack';
}

function setAccordionStatus(elementId, label, isActive = false) {
    document.querySelectorAll(`[id="${elementId}"]`).forEach((element) => {
        element.textContent = label;
        element.classList.toggle('is-active', isActive);
    });
}

function setAccordionSummary(elementId, summary) {
    document.querySelectorAll(`[id="${elementId}"]`).forEach((element) => {
        element.textContent = shortenSummary(summary, 72);
    });
}

function getGroupPanels(group) {
    return Array.from(document.querySelectorAll(`[data-settings-group="${group}"]`));
}

function setConfigGroupDisplay(group, isVisible) {
    getGroupPanels(group).forEach((panel) => {
        panel.style.display = isVisible ? '' : 'none';
    });

    const toggleButton = document.querySelector(`[data-config-toggle="${group}"]`);
    if (toggleButton) toggleButton.classList.toggle('is-open', isVisible);
}

function isConfigGroupOpen(group) {
    return getGroupPanels(group).some((panel) => panel.style.display !== 'none');
}

function closeAllConfigGroups() {
    SETTINGS_GROUPS.forEach((group) => {
        setConfigGroupDisplay(group, false);
    });
}

function updateSettingsAccordions() {
    const isGeminiActive = !useProxy && !useOllama;

    setAccordionStatus('geminiAccordionStatus', isGeminiActive ? 'Đang dùng' : 'Sẵn sàng', isGeminiActive);
    setAccordionSummary('geminiAccordionSummary', getGeminiAccordionSummary());

    setAccordionStatus('proxyAccordionStatus', useProxy ? 'Đang dùng' : 'Tắt', useProxy);
    setAccordionSummary('proxyAccordionSummary', getProxyAccordionSummary());

    setAccordionStatus('ollamaAccordionStatus', useOllama ? 'Đang dùng' : 'Tắt', useOllama);
    setAccordionSummary('ollamaAccordionSummary', getOllamaAccordionSummary());

    setAccordionStatus('generalAccordionStatus', 'Cấu hình');
    setAccordionSummary('generalAccordionSummary', getGeneralAccordionSummary());

    setAccordionStatus('promptAccordionStatus', 'Tùy chọn');
    setAccordionSummary('promptAccordionSummary', getPromptAccordionSummary());

    if (typeof useCanonPackTranslation !== 'undefined') {
        setAccordionStatus('canonPackAccordionStatus', useCanonPackTranslation ? 'Đang dùng' : 'Tắt', useCanonPackTranslation);
        setAccordionSummary('canonPackAccordionSummary', getCanonPackAccordionSummary());
    }
}

function updateWorkspaceToolbar() {
    const providerPill = document.getElementById('activeProviderPill');
    const configPill = document.getElementById('activeConfigPill');

    if (providerPill) providerPill.textContent = getActiveProviderLabel();
    if (configPill) configPill.textContent = getActiveConfigSummary();
    updateSettingsAccordions();
}

function toggleSettingsPanels(forceOpen) {
    const hub = document.getElementById('settingsHub');
    if (!hub) return;

    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : hub.style.display === 'none';

    hub.style.display = shouldOpen ? '' : 'none';
    if (!shouldOpen) {
        closeAllConfigGroups();
    }

    const toggleBtn = document.getElementById('toggleSettingsBtn');
    if (toggleBtn) toggleBtn.classList.toggle('is-active', shouldOpen);
    updateSettingsAccordions();
}

function toggleConfigGroup(group, forceOpen) {
    const panels = getGroupPanels(group);
    if (!panels.length) return;

    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : !isConfigGroupOpen(group);

    setConfigGroupDisplay(group, shouldOpen);
    updateSettingsAccordions();
}

function toggleHistoryPanel(forceOpen) {
    const panel = document.querySelector('.history-panel-collapsible');
    if (!panel) return;

    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : panel.style.display === 'none';

    panel.style.display = shouldOpen ? '' : 'none';
    const toggleBtn = document.getElementById('toggleHistoryBtn');
    if (toggleBtn) toggleBtn.classList.toggle('is-active', shouldOpen);
}

function saveSettings() {
    const promptInput = document.getElementById('customPrompt');
    const normalizedPrompt = typeof ensureCharacterNameConsistencyPrompt === 'function'
        ? ensureCharacterNameConsistencyPrompt(promptInput?.value || '')
        : (promptInput?.value || '');

    if (promptInput && promptInput.value !== normalizedPrompt) {
        promptInput.value = normalizedPrompt;
    }

    const settings = {
        apiKeys: apiKeys,
        sourceLang: document.getElementById('sourceLang').value,
        parallelCount: document.getElementById('parallelCount').value,
        chunkSize: document.getElementById('chunkSize').value,
        delayMs: document.getElementById('delayMs').value,
        customPrompt: normalizedPrompt,
        useCanonPackTranslation: typeof useCanonPackTranslation !== 'undefined' ? useCanonPackTranslation : false,
        selectedCanonPackId: typeof selectedCanonPackId !== 'undefined' ? selectedCanonPackId : '',
        useProxy: useProxy,
        proxyBaseUrl: proxyBaseUrl,
        proxyApiKey: proxyApiKey,
        proxyApiKeys: proxyApiKeys,
        proxyModel: proxyModel
    };
    localStorage.setItem('novelTranslatorProSettings', JSON.stringify(settings));
    updateWorkspaceToolbar();
}

function loadSettings() {
    const saved = localStorage.getItem('novelTranslatorProSettings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            if (settings.apiKeys) apiKeys = settings.apiKeys;
            if (settings.sourceLang) document.getElementById('sourceLang').value = settings.sourceLang;
            if (settings.parallelCount) document.getElementById('parallelCount').value = settings.parallelCount;
            if (settings.chunkSize) document.getElementById('chunkSize').value = settings.chunkSize;
            if (settings.delayMs) document.getElementById('delayMs').value = settings.delayMs;
            if (settings.customPrompt) document.getElementById('customPrompt').value = typeof ensureCharacterNameConsistencyPrompt === 'function'
                ? ensureCharacterNameConsistencyPrompt(settings.customPrompt)
                : settings.customPrompt;
            if (typeof useCanonPackTranslation !== 'undefined' && settings.useCanonPackTranslation !== undefined) {
                useCanonPackTranslation = Boolean(settings.useCanonPackTranslation);
            }
            if (typeof selectedCanonPackId !== 'undefined' && settings.selectedCanonPackId) {
                selectedCanonPackId = settings.selectedCanonPackId;
            }
            if (settings.useProxy !== undefined) useProxy = settings.useProxy;
            if (settings.proxyBaseUrl) proxyBaseUrl = settings.proxyBaseUrl;
            if (settings.proxyApiKey) proxyApiKey = settings.proxyApiKey;
            if (settings.proxyApiKeys) proxyApiKeys = settings.proxyApiKeys;
            if (!proxyApiKeys.length && proxyApiKey) {
                proxyApiKeys = [proxyApiKey];
            }
            if (settings.proxyModel) proxyModel = settings.proxyModel;
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }

    importStoryForgeFallbackSettings();

    if (document.getElementById('useProxyToggle')) {
        document.getElementById('useProxyToggle').checked = useProxy;
        document.getElementById('proxySettings').style.display = useProxy ? 'block' : 'none';
        document.getElementById('proxyStatus').textContent = useProxy ? 'Bật' : 'Tắt';
        document.getElementById('proxyStatus').style.background = useProxy ? '#10b981' : '';
    }
    if (document.getElementById('proxyBaseUrlInput')) {
        document.getElementById('proxyBaseUrlInput').value = proxyBaseUrl;
    }
    if (document.getElementById('proxyModelSelect')) {
        document.getElementById('proxyModelSelect').value = proxyModel;
    }
    if (document.getElementById('useCanonPackToggle') && typeof useCanonPackTranslation !== 'undefined') {
        document.getElementById('useCanonPackToggle').checked = useCanonPackTranslation;
    }
    if (typeof refreshCanonPackSelector === 'function') {
        refreshCanonPackSelector();
    }

    saveSettings();

    updateWorkspaceToolbar();
}

// ============================================
// STATISTICS UPDATE
// ============================================
function updateStats() {
    const text = document.getElementById('originalText').value;
    const charCount = text.length;
    const chunkSize = parseInt(document.getElementById('chunkSize').value) || 4500;
    const chunkCount = Math.ceil(charCount / chunkSize);
    const parallelCount = parseInt(document.getElementById('parallelCount').value) || 5;

    const batches = Math.ceil(chunkCount / Math.min(parallelCount, apiKeys.length || 1));
    const estimatedSeconds = batches * 0.8;

    document.getElementById('charCount').textContent = `${charCount.toLocaleString()} ký tự`;
    document.getElementById('chunkCount').textContent = `${chunkCount} chunk`;
    document.getElementById('estimatedTime').textContent = `~${Math.ceil(estimatedSeconds)} giây`;
}

// ============================================
// PROMPT TEMPLATES
// ============================================
function setPromptTemplate(templateName) {
    if (PROMPT_TEMPLATES[templateName]) {
        document.getElementById('customPrompt').value = typeof ensureCharacterNameConsistencyPrompt === 'function'
            ? ensureCharacterNameConsistencyPrompt(PROMPT_TEMPLATES[templateName])
            : PROMPT_TEMPLATES[templateName];
        saveSettings();

        document.querySelectorAll('.template-btn').forEach((btn) => {
            btn.classList.remove('active-template');
        });
        event.target.classList.add('active-template');

        showToast(`Đã chọn template: ${getTemplateName(templateName)}`, 'success');
    }
}

function getTemplateName(key) {
    const names = {
        convert: 'Convert (làm mượt)',
        novel: 'Tiểu thuyết',
        adult: 'Truyện 18+',
        sacHiep: 'Sắc hiệp',
        sacHiepPro: 'Sắc hiệp PRO',
        sacHiepENI: 'Sắc hiệp ENI',
        wuxia: 'Tu tiên/Kiếm hiệp',
        romance: 'Ngôn tình'
    };
    return names[key] || key;
}
