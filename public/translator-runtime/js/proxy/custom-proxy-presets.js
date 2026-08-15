const TRANSLATOR_CUSTOM_PROXY_PRESETS_STORAGE_KEY = 'novelTranslatorCustomProxyPresetsV1';
let pendingTranslatorCustomProxySwitchId = '';
let pendingTranslatorCustomProxyDeleteId = '';

function trimTranslatorPresetText(value, maxLength = 500) {
    return String(value || '').trim().slice(0, maxLength);
}

function normalizeTranslatorPresetModels(models = []) {
    return [...new Set(
        (Array.isArray(models) ? models : [])
            .map(model => trimTranslatorPresetText(model, 300))
            .filter(Boolean)
    )];
}

function normalizeTranslatorCustomProxyPresetProfile(profile = {}) {
    const defaults = typeof DEFAULT_CUSTOM_PROXY_PROFILE !== 'undefined'
        ? DEFAULT_CUSTOM_PROXY_PROFILE
        : {};
    return {
        ...defaults,
        ...profile,
        id: typeof CUSTOM_PROXY_PROFILE_ID !== 'undefined'
            ? CUSTOM_PROXY_PROFILE_ID
            : 'custom-openai-proxy',
        label: trimTranslatorPresetText(profile.label || defaults.label || 'Custom OpenAI-compatible', 80)
            || 'Custom OpenAI-compatible',
        baseUrl: trimTranslatorPresetText(profile.baseUrl, 2000),
        defaultModel: trimTranslatorPresetText(profile.defaultModel, 300),
        models: normalizeTranslatorPresetModels(profile.models),
        chatCompletionsPath: trimTranslatorPresetText(
            profile.chatCompletionsPath || defaults.chatCompletionsPath || '/v1/chat/completions',
            500
        ) || '/v1/chat/completions',
        modelsPath: trimTranslatorPresetText(profile.modelsPath || defaults.modelsPath || '/v1/models', 500)
            || '/v1/models',
        transport: trimTranslatorPresetText(profile.transport || defaults.transport || 'auto', 50) || 'auto',
    };
}

function normalizeTranslatorPresetKeys(keys = []) {
    return [...new Set(
        (Array.isArray(keys) ? keys : [])
            .map(key => trimTranslatorPresetText(key, 8000))
            .filter(Boolean)
    )];
}

function normalizeTranslatorCustomProxyPreset(rawPreset = {}) {
    const id = trimTranslatorPresetText(rawPreset.id, 120);
    if (!id) return null;
    const profile = normalizeTranslatorCustomProxyPresetProfile(rawPreset.profile);
    const createdAt = Number(rawPreset.createdAt) || Date.now();
    return {
        id,
        label: trimTranslatorPresetText(rawPreset.label || profile.label, 80) || 'Custom Proxy',
        profile,
        keys: normalizeTranslatorPresetKeys(rawPreset.keys),
        createdAt,
        updatedAt: Number(rawPreset.updatedAt) || createdAt,
    };
}

function createTranslatorCustomProxyPresetId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `translator-custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTranslatorCustomProxyPresetState() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TRANSLATOR_CUSTOM_PROXY_PRESETS_STORAGE_KEY) || 'null');
        if (!parsed || typeof parsed !== 'object') return { activePresetId: '', presets: [] };
        const presets = (Array.isArray(parsed.presets) ? parsed.presets : [])
            .map(normalizeTranslatorCustomProxyPreset)
            .filter(Boolean);
        const activePresetId = trimTranslatorPresetText(parsed.activePresetId, 120);
        return {
            activePresetId: presets.some(preset => preset.id === activePresetId) ? activePresetId : '',
            presets,
        };
    } catch {
        return { activePresetId: '', presets: [] };
    }
}

function writeTranslatorCustomProxyPresetState(state) {
    const normalized = {
        activePresetId: trimTranslatorPresetText(state.activePresetId, 120),
        presets: (Array.isArray(state.presets) ? state.presets : [])
            .map(normalizeTranslatorCustomProxyPreset)
            .filter(Boolean),
    };
    localStorage.setItem(TRANSLATOR_CUSTOM_PROXY_PRESETS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}

function getSuggestedTranslatorCustomProxyPresetName(profile = customProxyProfile) {
    const label = trimTranslatorPresetText(profile?.label, 80);
    if (label && label !== 'Custom OpenAI-compatible') return label;
    try {
        return new URL(trimTranslatorPresetText(profile?.baseUrl, 2000)).host || 'Custom Proxy';
    } catch {
        return label || 'Custom Proxy';
    }
}

function saveCurrentTranslatorCustomProxyPreset({ id = '', label = '' } = {}) {
    const state = getTranslatorCustomProxyPresetState();
    const presetId = trimTranslatorPresetText(id, 120) || createTranslatorCustomProxyPresetId();
    const existing = state.presets.find(preset => preset.id === presetId);
    const profile = normalizeTranslatorCustomProxyPresetProfile(customProxyProfile);
    const now = Date.now();
    const preset = normalizeTranslatorCustomProxyPreset({
        id: presetId,
        label: trimTranslatorPresetText(label, 80)
            || existing?.label
            || getSuggestedTranslatorCustomProxyPresetName(profile),
        profile,
        keys: customProxyApiKeys,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    });
    writeTranslatorCustomProxyPresetState({
        activePresetId: preset.id,
        presets: [preset, ...state.presets.filter(item => item.id !== preset.id)],
    });
    renderTranslatorCustomProxyPresets();
    return preset;
}

function activateTranslatorCustomProxyPreset(presetId) {
    const state = getTranslatorCustomProxyPresetState();
    const normalizedId = trimTranslatorPresetText(presetId, 120);
    const preset = state.presets.find(item => item.id === normalizedId);
    if (!preset) throw new Error('Không tìm thấy bộ Custom Proxy đã lưu.');

    customProxyProfile = normalizeTranslatorCustomProxyPresetProfile(preset.profile);
    customProxyApiKeys = [...preset.keys];
    customProxyApiKey = customProxyApiKeys[0] || '';
    customProxyKeyHealthMap = {};
    useProxy = true;
    const customProviderId = typeof TRANSLATOR_PROVIDERS !== 'undefined'
        ? TRANSLATOR_PROVIDERS.CUSTOM_PROXY
        : 'custom_openai_proxy';
    if (typeof setActiveTranslatorProvider === 'function') {
        setActiveTranslatorProvider(customProviderId);
    } else {
        activeTranslatorProvider = customProviderId;
    }
    if (typeof disableOllamaProvider === 'function') disableOllamaProvider();

    writeTranslatorCustomProxyPresetState({ ...state, activePresetId: preset.id });
    const baseUrlInput = typeof document !== 'undefined'
        ? document.getElementById('customProxyBaseUrlInput')
        : null;
    const modelInput = typeof document !== 'undefined'
        ? document.getElementById('customProxyModelInput')
        : null;
    if (baseUrlInput) baseUrlInput.value = customProxyProfile.baseUrl;
    if (modelInput) modelInput.value = customProxyProfile.defaultModel;
    if (typeof updateProxyModeControls === 'function') updateProxyModeControls();
    if (typeof renderCustomProxyPreviews === 'function') renderCustomProxyPreviews();
    if (typeof renderCustomProxyKeysList === 'function') renderCustomProxyKeysList();
    if (typeof renderCustomProxyModelsDropdown === 'function') renderCustomProxyModelsDropdown();
    if (typeof saveSettings === 'function') saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    pendingTranslatorCustomProxySwitchId = '';
    pendingTranslatorCustomProxyDeleteId = '';
    renderTranslatorCustomProxyPresets();
    return preset;
}

function removeTranslatorCustomProxyPreset(presetId) {
    const state = getTranslatorCustomProxyPresetState();
    const normalizedId = trimTranslatorPresetText(presetId, 120);
    if (!state.presets.some(preset => preset.id === normalizedId)) return false;
    writeTranslatorCustomProxyPresetState({
        activePresetId: state.activePresetId === normalizedId ? '' : state.activePresetId,
        presets: state.presets.filter(preset => preset.id !== normalizedId),
    });
    renderTranslatorCustomProxyPresets();
    return true;
}

function getComparableTranslatorCustomProxySnapshot(profile, keys) {
    return JSON.stringify({
        profile: normalizeTranslatorCustomProxyPresetProfile(profile),
        keys: normalizeTranslatorPresetKeys(keys),
    });
}

function isCurrentTranslatorCustomProxyPresetDirty() {
    const state = getTranslatorCustomProxyPresetState();
    const activePreset = state.presets.find(preset => preset.id === state.activePresetId);
    if (!activePreset) {
        return Boolean(trimTranslatorPresetText(customProxyProfile?.baseUrl) || customProxyApiKeys.length > 0);
    }
    return getComparableTranslatorCustomProxySnapshot(customProxyProfile, customProxyApiKeys)
        !== getComparableTranslatorCustomProxySnapshot(activePreset.profile, activePreset.keys);
}

function escapeTranslatorCustomProxyPresetHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getTranslatorCustomProxyPresetHost(baseUrl) {
    try {
        return new URL(trimTranslatorPresetText(baseUrl, 2000)).host || 'Chưa có URL';
    } catch {
        return trimTranslatorPresetText(baseUrl, 2000) || 'Chưa có URL';
    }
}

function renderTranslatorCustomProxyPresets() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('translatorCustomProxyPresetList');
    const current = document.getElementById('translatorCustomProxyPresetCurrent');
    const updateButton = document.getElementById('updateTranslatorCustomProxyPresetBtn');
    if (!container && !current) return;
    const state = getTranslatorCustomProxyPresetState();
    const activePreset = state.presets.find(preset => preset.id === state.activePresetId);
    const dirty = isCurrentTranslatorCustomProxyPresetDirty();

    if (current) {
        current.dataset.dirty = dirty ? 'true' : 'false';
        current.innerHTML = `
            <strong>${escapeTranslatorCustomProxyPresetHtml(activePreset?.label || 'Bộ hiện tại chưa lưu')}</strong>
            <span>${dirty ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ'}</span>
        `;
    }
    if (updateButton) updateButton.disabled = !activePreset || !dirty;

    if (!container) return;
    if (state.presets.length === 0) {
        container.innerHTML = '<p class="custom-preset-empty">Chưa có bộ nào. Nhập URL và key rồi lưu thành bộ mới.</p>';
        return;
    }

    container.innerHTML = state.presets.map(preset => {
        const active = preset.id === state.activePresetId;
        const switchPending = preset.id === pendingTranslatorCustomProxySwitchId;
        const deletePending = preset.id === pendingTranslatorCustomProxyDeleteId;
        const safeId = escapeTranslatorCustomProxyPresetHtml(preset.id);
        return `
            <article class="translator-custom-preset${active ? ' is-active' : ''}">
                <div class="translator-custom-preset__identity">
                    <strong>${escapeTranslatorCustomProxyPresetHtml(preset.label)}</strong>
                    <span title="${escapeTranslatorCustomProxyPresetHtml(preset.profile.baseUrl)}">${escapeTranslatorCustomProxyPresetHtml(getTranslatorCustomProxyPresetHost(preset.profile.baseUrl))}</span>
                </div>
                <div class="translator-custom-preset__meta">
                    <span>${escapeTranslatorCustomProxyPresetHtml(preset.profile.defaultModel || 'Chưa chọn model')}</span>
                    <span>${preset.keys.length} key</span>
                    ${active ? '<span class="translator-custom-preset__active">Đang dùng</span>' : ''}
                </div>
                <div class="translator-custom-preset__actions">
                    ${switchPending ? `
                        <span class="translator-custom-preset__warning">Thay đổi hiện tại chưa lưu.</span>
                        <button type="button" class="btn btn-primary btn-small" data-click-action="confirmTranslatorCustomProxyPresetSwitch" data-preset-id="${safeId}">Vẫn chuyển</button>
                        <button type="button" class="btn btn-secondary btn-small" data-click-action="cancelTranslatorCustomProxyPresetAction">Ở lại</button>
                    ` : `
                        <button type="button" class="btn btn-secondary btn-small" data-click-action="useTranslatorCustomProxyPreset" data-preset-id="${safeId}" ${active && !dirty ? 'disabled' : ''}>${active ? 'Đang dùng' : 'Dùng bộ này'}</button>
                    `}
                    <button type="button" class="btn btn-secondary btn-small${deletePending ? ' is-danger' : ''}" data-click-action="deleteTranslatorCustomProxyPreset" data-preset-id="${safeId}">${deletePending ? 'Xác nhận xóa' : 'Xóa'}</button>
                </div>
            </article>
        `;
    }).join('');
}

function saveTranslatorCustomProxyPresetFromUi() {
    const nameInput = document.getElementById('translatorCustomProxyPresetName');
    if (!trimTranslatorPresetText(customProxyProfile?.baseUrl)) {
        showToast('Nhập Base URL trước khi lưu bộ kết nối.', 'warning');
        return;
    }
    if (customProxyApiKeys.length === 0) {
        showToast('Thêm ít nhất một API key trước khi lưu bộ kết nối.', 'warning');
        return;
    }
    const saved = saveCurrentTranslatorCustomProxyPreset({
        label: trimTranslatorPresetText(nameInput?.value, 80),
    });
    if (nameInput) nameInput.value = '';
    showToast(`Đã lưu bộ “${saved.label}” trên trình duyệt này.`, 'success');
}

function updateActiveTranslatorCustomProxyPreset() {
    const state = getTranslatorCustomProxyPresetState();
    const activePreset = state.presets.find(preset => preset.id === state.activePresetId);
    if (!activePreset) return saveTranslatorCustomProxyPresetFromUi();
    const saved = saveCurrentTranslatorCustomProxyPreset({ id: activePreset.id, label: activePreset.label });
    showToast(`Đã cập nhật bộ “${saved.label}”.`, 'success');
}

function requestTranslatorCustomProxyPresetSwitch(element) {
    const presetId = trimTranslatorPresetText(element?.dataset?.presetId, 120);
    const state = getTranslatorCustomProxyPresetState();
    if (!presetId || (presetId === state.activePresetId && !isCurrentTranslatorCustomProxyPresetDirty())) return;
    if (typeof isTranslating !== 'undefined' && isTranslating) {
        showToast('Hãy dừng hoặc hoàn tất lượt dịch trước khi đổi bộ Custom Proxy.', 'warning');
        return;
    }
    if (isCurrentTranslatorCustomProxyPresetDirty() && presetId !== state.activePresetId) {
        pendingTranslatorCustomProxySwitchId = presetId;
        pendingTranslatorCustomProxyDeleteId = '';
        renderTranslatorCustomProxyPresets();
        return;
    }
    activateTranslatorCustomProxyPreset(presetId);
    showToast('Đã chuyển URL, model và API key sang bộ đã chọn.', 'success');
}

function confirmTranslatorCustomProxyPresetSwitch(element) {
    const presetId = trimTranslatorPresetText(element?.dataset?.presetId, 120);
    if (typeof isTranslating !== 'undefined' && isTranslating) {
        showToast('Hãy dừng hoặc hoàn tất lượt dịch trước khi đổi bộ Custom Proxy.', 'warning');
        return;
    }
    activateTranslatorCustomProxyPreset(presetId);
    showToast('Đã chuyển URL, model và API key sang bộ đã chọn.', 'success');
}

function requestDeleteTranslatorCustomProxyPreset(element) {
    const presetId = trimTranslatorPresetText(element?.dataset?.presetId, 120);
    if (!presetId) return;
    if (pendingTranslatorCustomProxyDeleteId !== presetId) {
        pendingTranslatorCustomProxyDeleteId = presetId;
        pendingTranslatorCustomProxySwitchId = '';
        renderTranslatorCustomProxyPresets();
        return;
    }
    removeTranslatorCustomProxyPreset(presetId);
    pendingTranslatorCustomProxyDeleteId = '';
    showToast('Đã xóa bộ đã lưu. Cấu hình đang dùng không bị xóa.', 'info');
}

function cancelTranslatorCustomProxyPresetAction() {
    pendingTranslatorCustomProxySwitchId = '';
    pendingTranslatorCustomProxyDeleteId = '';
    renderTranslatorCustomProxyPresets();
}
