/**
 * Novel Translator Pro - Settings
 * Luu va tai cau hinh
 */

// ============================================
// SETTINGS MANAGEMENT
// ============================================
const SETTINGS_GROUPS = ['gemini', 'proxy', 'ollama', 'general', 'prompt'];

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
    if (!activeModels.length) return 'chua co model';
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
    return `${proxyModel || 'chua chon model'} • ${proxyCount} key`;
}

function getOllamaAccordionSummary() {
    return `${ollamaModel || 'chua chon model local'} • ${ollamaUrl || 'localhost'}`;
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

    return `${shortenSummary(sourceLangLabel, 18)} • ${parallelCount} luong • ${chunkSize} ky tu`;
}

function getPromptAccordionSummary() {
    const promptValue = document.getElementById('customPrompt')?.value?.trim() || '';
    if (!promptValue) return 'Dang de trong';

    if (typeof PROMPT_TEMPLATES !== 'undefined') {
        const matchedEntry = Object.entries(PROMPT_TEMPLATES).find(([, value]) => value === promptValue);
        if (matchedEntry) {
            return shortenSummary(getTemplateName(matchedEntry[0]), 30);
        }
    }

    return `${promptValue.length.toLocaleString()} ky tu prompt`;
}

function setAccordionStatus(elementId, label, isActive = false) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = label;
    element.classList.toggle('is-active', isActive);
}

function setAccordionSummary(elementId, summary) {
    const element = document.getElementById(elementId);
    if (element) element.textContent = shortenSummary(summary, 72);
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

    setAccordionStatus('geminiAccordionStatus', isGeminiActive ? 'Dang dung' : 'San sang', isGeminiActive);
    setAccordionSummary('geminiAccordionSummary', getGeminiAccordionSummary());

    setAccordionStatus('proxyAccordionStatus', useProxy ? 'Dang dung' : 'Tat', useProxy);
    setAccordionSummary('proxyAccordionSummary', getProxyAccordionSummary());

    setAccordionStatus('ollamaAccordionStatus', useOllama ? 'Dang dung' : 'Tat', useOllama);
    setAccordionSummary('ollamaAccordionSummary', getOllamaAccordionSummary());

    setAccordionStatus('generalAccordionStatus', 'Cau hinh');
    setAccordionSummary('generalAccordionSummary', getGeneralAccordionSummary());

    setAccordionStatus('promptAccordionStatus', 'Tuy chon');
    setAccordionSummary('promptAccordionSummary', getPromptAccordionSummary());
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
    const settings = {
        apiKeys: apiKeys,
        sourceLang: document.getElementById('sourceLang').value,
        parallelCount: document.getElementById('parallelCount').value,
        chunkSize: document.getElementById('chunkSize').value,
        delayMs: document.getElementById('delayMs').value,
        customPrompt: document.getElementById('customPrompt').value,
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
            if (settings.useProxy !== undefined) useProxy = settings.useProxy;
            if (settings.proxyBaseUrl) proxyBaseUrl = settings.proxyBaseUrl;
            if (settings.proxyApiKey) proxyApiKey = settings.proxyApiKey;
            if (settings.proxyApiKeys) proxyApiKeys = settings.proxyApiKeys;
            if (!proxyApiKeys.length && proxyApiKey) {
                proxyApiKeys = [proxyApiKey];
            }
            if (settings.proxyModel) proxyModel = settings.proxyModel;

            if (document.getElementById('useProxyToggle')) {
                document.getElementById('useProxyToggle').checked = useProxy;
                document.getElementById('proxySettings').style.display = useProxy ? 'block' : 'none';
                document.getElementById('proxyStatus').textContent = useProxy ? 'Bat' : 'Tat';
                document.getElementById('proxyStatus').style.background = useProxy ? '#10b981' : '';
            }
            if (document.getElementById('proxyBaseUrlInput')) {
                document.getElementById('proxyBaseUrlInput').value = proxyBaseUrl;
            }
            if (document.getElementById('proxyModelSelect')) {
                document.getElementById('proxyModelSelect').value = proxyModel;
            }
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }

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

    document.getElementById('charCount').textContent = `${charCount.toLocaleString()} ky tu`;
    document.getElementById('chunkCount').textContent = `${chunkCount} chunks`;
    document.getElementById('estimatedTime').textContent = `~${Math.ceil(estimatedSeconds)} giay`;
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

        showToast(`Da chon template: ${getTemplateName(templateName)}`, 'success');
    }
}

function getTemplateName(key) {
    const names = {
        convert: 'Convert (Lam muot)',
        novel: 'Tieu thuyet',
        adult: 'Truyen 18+',
        sacHiep: 'Sac Hiep',
        sacHiepPro: 'Sac Hiep PRO',
        sacHiepENI: 'Sac Hiep ENI',
        wuxia: 'Tu tien/Kiem hiep',
        romance: 'Ngon tinh'
    };
    return names[key] || key;
}
