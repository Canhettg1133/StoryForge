/**
 * Novel Translator Pro - Settings
 * Lưu và tải cấu hình
 */

// ============================================
// SETTINGS MANAGEMENT
// ============================================
const SETTINGS_GROUPS = ['gemini', 'proxy', 'custom-proxy', 'ollama', 'general', 'canon-pack', 'prompt'];

function getDefaultProxyModel() {
    if (typeof DEFAULT_PROXY_MODEL !== 'undefined' && DEFAULT_PROXY_MODEL) return DEFAULT_PROXY_MODEL;
    return 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]';
}

function ensureProxyModelDefault() {
    const current = String(typeof proxyModel !== 'undefined' ? proxyModel : '').trim();
    if (current) return current;
    proxyModel = getDefaultProxyModel();
    return proxyModel;
}

function getActiveProviderLabel() {
    if (typeof useOllama !== 'undefined' && useOllama) return 'Ollama';
    if (typeof useProxy !== 'undefined' && useProxy) {
        return activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY
            ? 'Custom Proxy'
            : 'Gemini Proxy AG';
    }
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
        if (activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY) {
            return shortenSummary(String(customProxyProfile?.defaultModel || 'chưa chọn model Custom'));
        }
        return shortenSummary(String(proxyModel || 'Proxy model'));
    }

    return shortenSummary(getGeminiPrimaryModelSummary());
}

function getGeminiAccordionSummary() {
    return `${apiKeys.length} key • ${getGeminiPrimaryModelSummary()}`;
}

function getProxyAccordionSummary() {
    const proxyCount = typeof getProxyKeyCount === 'function'
        ? getProxyKeyCount(TRANSLATOR_PROVIDERS.AG_PROXY)
        : 0;
    return `${proxyModel || 'chưa chọn model'} • ${proxyCount} key`;
}

function getCustomProxyAccordionSummary() {
    const customCount = typeof getProxyKeyCount === 'function'
        ? getProxyKeyCount(TRANSLATOR_PROVIDERS.CUSTOM_PROXY)
        : (customProxyApiKeys?.length || 0);
    return `${customProxyProfile?.defaultModel || 'chưa chọn model'} • ${customCount} key`;
}

function getOllamaAccordionSummary() {
    const model = typeof ollamaModel !== 'undefined' ? ollamaModel : '';
    const url = typeof ollamaUrl !== 'undefined' ? ollamaUrl : '';
    return `${model || 'chưa chọn model local'} • ${url || 'localhost'}`;
}

function getGeneralAccordionSummary() {
    const sourceLangSelect = document.getElementById('sourceLang');
    const parallelInput = document.getElementById('parallelCount');
    const chunkInput = document.getElementById('chunkSize');
    const rpmInput = document.getElementById('rpmPerKey');

    const sourceLangLabel = sourceLangSelect
        ? sourceLangSelect.options[sourceLangSelect.selectedIndex]?.textContent?.trim() || 'Auto'
        : 'Auto';
    const parallelCount = parallelInput?.value || '2';
    const chunkSize = chunkInput?.value || '2000';
    const rpm = rpmInput?.value || rpmPerKey || '10';
    return `${shortenSummary(sourceLangLabel, 18)} • ${parallelCount} luồng • ${rpm} RPM/key • ${chunkSize} ký tự`;
}

function getActiveRateLimitUnitCount() {
    if (typeof getTranslatorRpmKeyCount === 'function') return getTranslatorRpmKeyCount();
    if (typeof useOllama !== 'undefined' && useOllama) return 1;
    if (typeof useProxy !== 'undefined' && useProxy && typeof getProxyKeyCount === 'function') return getProxyKeyCount();
    return Array.isArray(apiKeys) ? apiKeys.length : 0;
}

function getRateLimitSummaryText() {
    const parallelInput = document.getElementById('parallelCount');
    const rpmInput = document.getElementById('rpmPerKey');
    const parallel = typeof normalizeTranslatorParallel === 'function'
        ? normalizeTranslatorParallel(parallelInput?.value || 2)
        : Math.max(1, Number(parallelInput?.value || 2));
    const rpm = typeof normalizeTranslatorRpm === 'function'
        ? normalizeTranslatorRpm(rpmInput?.value || rpmPerKey)
        : Math.max(1, Number(rpmInput?.value || 10));
    const unitCount = getActiveRateLimitUnitCount();

    if (typeof useOllama !== 'undefined' && useOllama) {
        return `Ollama chạy tuần tự; RPM chỉ giới hạn nhịp gọi local (${rpm} request/phút).`;
    }

    if (unitCount <= 0) {
        return `Chưa có API key để chia tải. Khi dịch, hệ thống sẽ tự chờ nếu chạm ${rpm} RPM/key.`;
    }

    const maxPerMinute = unitCount * rpm;
    const firstBatch = Math.min(parallel, maxPerMinute);
    return `Ước tính: ${unitCount} key × ${rpm} RPM = tối đa ${maxPerMinute} request/phút. Lượt đầu có thể gửi ${firstBatch} request rồi tự chờ khi hết slot.`;
}

function updateRateLimitSummary() {
    const summary = document.getElementById('rateLimitSummary');
    if (summary) summary.textContent = getRateLimitSummaryText();
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
    const isAgProxyActive = useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.AG_PROXY;
    const isCustomProxyActive = useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY;

    setAccordionStatus('geminiAccordionStatus', isGeminiActive ? 'Đang dùng' : 'Sẵn sàng', isGeminiActive);
    setAccordionSummary('geminiAccordionSummary', getGeminiAccordionSummary());

    setAccordionStatus('proxyAccordionStatus', isAgProxyActive ? 'Đang dùng' : 'Tắt', isAgProxyActive);
    setAccordionSummary('proxyAccordionSummary', getProxyAccordionSummary());

    setAccordionStatus('customProxyAccordionStatus', isCustomProxyActive ? 'Đang dùng' : 'Tắt', isCustomProxyActive);
    setAccordionSummary('customProxyAccordionSummary', getCustomProxyAccordionSummary());

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
        rpmPerKey: document.getElementById('rpmPerKey')?.value || rpmPerKey,
        customPrompt: normalizedPrompt,
        useCanonPackTranslation: typeof useCanonPackTranslation !== 'undefined' ? useCanonPackTranslation : false,
        selectedCanonPackId: typeof selectedCanonPackId !== 'undefined' ? selectedCanonPackId : '',
        useProxy: useProxy,
        activeTranslatorProvider: activeTranslatorProvider,
        proxyBaseUrl: proxyBaseUrl,
        proxyApiKey: proxyApiKey,
        proxyApiKeys: proxyApiKeys,
        proxyModel: proxyModel,
        customProxyProfile: customProxyProfile,
        customProxyApiKey: customProxyApiKey,
        customProxyApiKeys: customProxyApiKeys,
    };
    localStorage.setItem('novelTranslatorProSettings', JSON.stringify(settings));
    if (typeof persistCustomProxySharedSettings === 'function') {
        persistCustomProxySharedSettings(activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY);
    }
    if (typeof normalizeTranslatorRpm === 'function') {
        rpmPerKey = normalizeTranslatorRpm(settings.rpmPerKey);
    }
    updateRateLimitSummary();
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
            if (settings.rpmPerKey !== undefined && document.getElementById('rpmPerKey')) {
                rpmPerKey = typeof normalizeTranslatorRpm === 'function'
                    ? normalizeTranslatorRpm(settings.rpmPerKey)
                    : Number(settings.rpmPerKey || 10);
                document.getElementById('rpmPerKey').value = rpmPerKey;
            }
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
            if (settings.activeTranslatorProvider) {
                if (typeof setActiveTranslatorProvider === 'function') {
                    setActiveTranslatorProvider(settings.activeTranslatorProvider);
                } else {
                    activeTranslatorProvider = settings.activeTranslatorProvider;
                }
            } else if (settings.useProxy) {
                activeTranslatorProvider = TRANSLATOR_PROVIDERS.AG_PROXY;
            }
            if (settings.proxyBaseUrl) proxyBaseUrl = settings.proxyBaseUrl;
            if (settings.proxyApiKey) proxyApiKey = settings.proxyApiKey;
            if (settings.proxyApiKeys) proxyApiKeys = settings.proxyApiKeys;
            if (!proxyApiKeys.length && proxyApiKey) {
                proxyApiKeys = [proxyApiKey];
            }
            proxyModel = settings.proxyModel || getDefaultProxyModel();
            if (settings.customProxyProfile) {
                customProxyProfile = {
                    ...(typeof DEFAULT_CUSTOM_PROXY_PROFILE !== 'undefined' ? DEFAULT_CUSTOM_PROXY_PROFILE : {}),
                    ...settings.customProxyProfile,
                    id: 'custom-openai-proxy',
                    models: Array.isArray(settings.customProxyProfile.models) ? settings.customProxyProfile.models : [],
                };
            }
            if (settings.customProxyApiKey) customProxyApiKey = settings.customProxyApiKey;
            if (settings.customProxyApiKeys) customProxyApiKeys = settings.customProxyApiKeys;
            if (!customProxyApiKeys.length && customProxyApiKey) {
                customProxyApiKeys = [customProxyApiKey];
            }
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }

    ensureProxyModelDefault();

    if (typeof updateProxyModeControls === 'function') {
        updateProxyModeControls();
    } else if (document.getElementById('useProxyToggle')) {
        const isAgProxy = useProxy && activeTranslatorProvider !== TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
        document.getElementById('useProxyToggle').checked = isAgProxy;
        document.getElementById('proxySettings').style.display = isAgProxy ? 'block' : 'none';
        document.getElementById('proxyStatus').textContent = isAgProxy ? 'Bật' : 'Tắt';
        document.getElementById('proxyStatus').style.background = isAgProxy ? '#10b981' : '';
    }
    if (document.getElementById('proxyBaseUrlInput')) {
        document.getElementById('proxyBaseUrlInput').value = proxyBaseUrl;
    }
    if (document.getElementById('customProxyBaseUrlInput')) {
        document.getElementById('customProxyBaseUrlInput').value = customProxyProfile?.baseUrl || '';
    }
    if (document.getElementById('customProxyModelInput')) {
        document.getElementById('customProxyModelInput').value = customProxyProfile?.defaultModel || '';
    }
    const proxyModelSelect = document.getElementById('proxyModelSelect');
    if (proxyModelSelect) {
        if (typeof renderProxyModelsDropdown === 'function') {
            renderProxyModelsDropdown();
        } else {
            proxyModelSelect.value = ensureProxyModelDefault();
        }
    }
    if (typeof renderCustomProxyPreviews === 'function') renderCustomProxyPreviews();
    if (typeof renderCustomProxyKeysList === 'function') renderCustomProxyKeysList();
    if (typeof renderCustomProxyModelsDropdown === 'function') renderCustomProxyModelsDropdown();
    if (document.getElementById('useCanonPackToggle') && typeof useCanonPackTranslation !== 'undefined') {
        document.getElementById('useCanonPackToggle').checked = useCanonPackTranslation;
    }
    if (typeof refreshCanonPackSelector === 'function') {
        refreshCanonPackSelector();
    }

    saveSettings();
    updateRateLimitSummary();
    updateWorkspaceToolbar();
}

// ============================================
// STATISTICS UPDATE
// ============================================
function updateStats() {
    const chunkSize = parseInt(document.getElementById('chunkSize').value) || 4500;
    const parallelCount = parseInt(document.getElementById('parallelCount').value) || 5;

    if (currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE && largeFileMeta) {
        if (typeof estimateChunkCountFromPreview === 'function') {
            const estimate = estimateChunkCountFromPreview({
                fileSize: largeFileMeta.size,
                previewText: largeFileMeta.previewText,
                chunkSize,
            });
            largeFileMeta.estimatedChunks = estimate.count;
            if (typeof updateLargeFileNotice === 'function') updateLargeFileNotice();
        }
        const estimatedChunks = largeFileMeta.estimatedChunks || 1;
        const translatedCount = completedChunks > 0 ? `${completedChunks.toLocaleString('vi-VN')} đã dịch` : 'chưa dịch';
        document.getElementById('charCount').textContent = `${formatFileSize(largeFileMeta.size)} file nguồn`;
        document.getElementById('chunkCount').textContent = `~${estimatedChunks.toLocaleString('vi-VN')} chunk ước tính`;
        document.getElementById('estimatedTime').textContent = translatedCount;
        return;
    }

    const text = document.getElementById('originalText').value;
    const charCount = text.length;
    const chunkCount = Math.ceil(charCount / chunkSize);

    const effectiveParallel = typeof resolveEffectiveTranslationParallel === 'function'
        ? resolveEffectiveTranslationParallel({
            requestedParallel: parallelCount,
            useProxyMode: Boolean(useProxy),
            useOllamaMode: Boolean(typeof useOllama !== 'undefined' && useOllama),
        })
        : Math.min(parallelCount, apiKeys.length || 1);
    const batches = Math.ceil(chunkCount / Math.max(1, effectiveParallel));
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
