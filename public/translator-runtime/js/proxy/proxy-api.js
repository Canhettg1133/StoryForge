/**
 * Novel Translator Pro - Proxy API UI Functions
 * Quản lý Gemini Proxy AG và Custom Proxy OpenAI-compatible.
 */

function getElement(id) {
    return document.getElementById(id);
}

function setElementDisplay(id, isVisible) {
    const element = getElement(id);
    if (element) element.style.display = isVisible ? 'block' : 'none';
}

function setBadgeState(id, isActive) {
    const badge = getElement(id);
    if (!badge) return;
    badge.textContent = isActive ? 'Bật' : 'Tắt';
    badge.style.background = isActive ? '#10b981' : '';
    if (badge.classList && typeof badge.classList.toggle === 'function') {
        badge.classList.toggle('active', isActive);
    }
}

function updateProxyModeControls() {
    const isAgActive = useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.AG_PROXY;
    const isCustomActive = useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY;

    const agToggle = getElement('useProxyToggle');
    const customToggle = getElement('customProxyToggle');
    if (agToggle) agToggle.checked = isAgActive;
    if (customToggle) customToggle.checked = isCustomActive;

    setElementDisplay('proxySettings', isAgActive);
    setElementDisplay('customProxySettings', isCustomActive);
    setBadgeState('proxyStatus', isAgActive);
    setBadgeState('customProxyStatus', isCustomActive);
}

function disableOllamaProvider() {
    if (typeof useOllama === 'undefined' || !useOllama) return;
    useOllama = false;
    const ollamaToggle = getElement('useOllamaToggle');
    if (ollamaToggle) ollamaToggle.checked = false;
    setElementDisplay('ollamaSettings', false);
    setBadgeState('ollamaStatus', false);
}

// ============================================
// GEMINI PROXY AG
// ============================================
function toggleProxyMode() {
    const toggle = getElement('useProxyToggle');
    const shouldEnable = Boolean(toggle?.checked);
    useProxy = shouldEnable;

    if (shouldEnable) {
        setActiveTranslatorProvider(TRANSLATOR_PROVIDERS.AG_PROXY);
        disableOllamaProvider();
        showToast('Đã bật Gemini Proxy AG. Custom Proxy và Ollama đã được tách riêng.', 'success');
    } else if (activeTranslatorProvider === TRANSLATOR_PROVIDERS.AG_PROXY) {
        setActiveTranslatorProvider(TRANSLATOR_PROVIDERS.GEMINI_DIRECT);
        showToast('Đã tắt Gemini Proxy AG, sử dụng Gemini Direct.', 'info');
    }

    updateProxyModeControls();
    renderProxyModelsDropdown();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

function addProxyKey() {
    const input = getElement('newProxyKeyInput');
    const key = String(input?.value || '').trim();

    if (!key) {
        showToast('Vui lòng nhập Gemini Proxy AG API key.', 'warning');
        return;
    }

    if (!key.startsWith('sk-')) {
        showToast('Gemini Proxy AG key nên bắt đầu bằng "sk-".', 'error');
        return;
    }

    if (proxyApiKeys.includes(key)) {
        showToast('Key này đã tồn tại trong Gemini Proxy AG.', 'error');
        if (input) input.value = '';
        return;
    }

    proxyApiKeys.push(key);
    if (!proxyApiKey) proxyApiKey = key;
    if (input) input.value = '';
    renderProxyKeysList();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    showToast(`Đã thêm Gemini Proxy AG key. Hiện có ${proxyApiKeys.length} key để xoay.`, 'success');
}

function removeProxyKey(index) {
    proxyApiKeys.splice(index, 1);
    proxyApiKey = proxyApiKeys.length > 0 ? proxyApiKeys[0] : '';
    proxyKeyHealthMap = {};
    renderProxyKeysList();
    saveSettings();
    showToast('Đã xóa Gemini Proxy AG key.', 'info');
}

function renderProxyKeysList() {
    const container = getElement('proxyKeysList');
    const countBadge = getElement('proxyKeyCount');
    const count = proxyApiKeys.length;

    if (countBadge) {
        countBadge.textContent = `${count} key xoay tua`;
        countBadge.style.background = count > 1 ? 'var(--success)' : (count === 1 ? 'var(--accent-primary)' : 'var(--danger)');
    }

    if (!container) return;
    if (count === 0) {
        container.innerHTML = '<p class="empty-message">Chưa có key nào. Thêm ít nhất 1 key để dùng Gemini Proxy AG.</p>';
        return;
    }

    container.innerHTML = proxyApiKeys.map((key, index) => {
        const keyLabel = String.fromCharCode(65 + index);
        return `
        <div class="api-key-item">
            <span class="key-index" style="background: var(--accent-primary)">Key ${keyLabel}</span>
            <span class="key-value">${maskProxyKey(key)}</span>
            <button class="remove-btn" onclick="removeProxyKey(${index})" title="Xóa">Xóa</button>
        </div>
    `;
    }).join('');

    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

function maskProxyKey(key) {
    if (key.length <= 12) return key;
    return key.substring(0, 6) + '••••••••' + key.substring(key.length - 6);
}

function getProxyBulkKeyConfig(provider = 'ag') {
    const normalized = provider === 'custom' ? 'custom' : 'ag';
    if (normalized === 'custom') {
        return {
            provider: 'custom',
            label: 'Custom Proxy',
            modalId: 'customProxyKeyBulkModal',
            importTextareaId: 'customProxyKeyImportTextarea',
            importPreviewId: 'customProxyKeyImportPreview',
            exportTextareaId: 'customProxyKeyExportTextarea',
            keys: () => customProxyApiKeys,
            setKeys: (keys) => {
                customProxyApiKeys = keys;
                customProxyApiKey = customProxyApiKeys[0] || '';
                customProxyKeyHealthMap = {};
            },
            render: () => renderCustomProxyKeysList(),
            isValid: (key) => key.length >= 6,
            invalidHint: 'Key Custom Proxy phải có ít nhất 6 ký tự.',
            placeholder: 'sk-custom-...\\nproxy-key-...\\nopenrouter-key-...',
        };
    }

    return {
        provider: 'ag',
        label: 'Gemini Proxy AG',
        modalId: 'agProxyKeyBulkModal',
        importTextareaId: 'agProxyKeyImportTextarea',
        importPreviewId: 'agProxyKeyImportPreview',
        exportTextareaId: 'agProxyKeyExportTextarea',
        keys: () => proxyApiKeys,
        setKeys: (keys) => {
            proxyApiKeys = keys;
            proxyApiKey = proxyApiKeys[0] || '';
            proxyKeyHealthMap = {};
        },
        render: () => renderProxyKeysList(),
        isValid: (key) => key.startsWith('sk-') && key.length >= 10,
        invalidHint: 'Key Gemini Proxy AG phải bắt đầu bằng "sk-" và đủ dài.',
        placeholder: 'sk-...\\nsk-...\\nsk-...',
    };
}

function parseProxyKeysFromText(text, provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const rawKeys = String(text || '')
        .split(/[\n\r,;]+/)
        .map((key) => key.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    const currentKeys = config.keys();
    const validKeys = [];
    const newKeys = [];
    const seen = new Set();
    let duplicates = 0;
    let alreadyExists = 0;
    let invalid = 0;

    rawKeys.forEach((key) => {
        if (!config.isValid(key)) {
            invalid++;
            return;
        }
        if (seen.has(key)) {
            duplicates++;
            return;
        }
        seen.add(key);
        validKeys.push(key);
        if (currentKeys.includes(key)) {
            alreadyExists++;
        } else {
            newKeys.push(key);
        }
    });

    return { validKeys, newKeys, duplicates, alreadyExists, invalid };
}

function openImportProxyKeysModal(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    closeProxyImportModal(provider);

    const modal = document.createElement('div');
    modal.id = `${config.modalId}Import`;
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
    `;

    modal.innerHTML = `
        <div style="
            background: #1a1a2e;
            border: 1px solid #10b981;
            border-radius: 12px;
            padding: 20px;
            width: 680px;
            max-width: 92vw;
            max-height: 84vh;
            display: flex;
            flex-direction: column;
        ">
            <h3 style="color:#fff;margin:0 0 10px 0;">📥 Nhập nhiều ${config.label} keys</h3>
            <p style="color:#9ca3af;margin:0 0 8px 0;font-size:13px;">Dán nhiều key, mỗi dòng một key hoặc phân cách bằng dấu phẩy/dấu chấm phẩy.</p>
            <textarea id="${config.importTextareaId}" placeholder="${config.placeholder}" style="
                width: 100%;
                height: 240px;
                background: #0a0a0f;
                color: #10b981;
                border: 1px solid #333;
                border-radius: 8px;
                padding: 14px;
                font-family: monospace;
                font-size: 13px;
                resize: vertical;
            "></textarea>
            <div id="${config.importPreviewId}" style="
                color:#9ca3af;
                font-size:12px;
                margin-top:10px;
                padding:8px;
                background:rgba(0,0,0,0.3);
                border-radius:6px;
            ">Dán danh sách key để xem trước...</div>
            <div style="display:flex;gap:10px;margin-top:15px;">
                <button onclick="executeImportProxyKeys('${config.provider}')" style="flex:1;padding:12px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;">✅ Nhập key</button>
                <button onclick="closeProxyImportModal('${config.provider}')" style="flex:1;padding:12px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">✕ Hủy</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    const textarea = getElement(config.importTextareaId);
    if (textarea) {
        textarea.addEventListener('input', () => updateProxyImportPreview(config.provider));
        textarea.focus();
    }
}

function updateProxyImportPreview(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const textarea = getElement(config.importTextareaId);
    const preview = getElement(config.importPreviewId);
    if (!textarea || !preview) return;

    const rawText = textarea.value;
    if (!rawText.trim()) {
        preview.textContent = 'Dán danh sách key để xem trước...';
        preview.style.color = '#9ca3af';
        return;
    }

    const result = parseProxyKeysFromText(rawText, provider);
    if (result.validKeys.length === 0) {
        preview.innerHTML = `❌ Không tìm thấy key hợp lệ. ${config.invalidHint}`;
        preview.style.color = '#ef4444';
        return;
    }

    preview.innerHTML = [
        `✅ Tìm thấy <strong style="color:#10b981">${result.validKeys.length}</strong> key hợp lệ`,
        result.duplicates > 0 ? `⚠️ <strong style="color:#f59e0b">${result.duplicates}</strong> key trùng trong input` : '',
        result.alreadyExists > 0 ? `📌 <strong style="color:#3b82f6">${result.alreadyExists}</strong> key đã có` : '',
        result.invalid > 0 ? `❌ <strong style="color:#ef4444">${result.invalid}</strong> key không hợp lệ` : '',
        `<br>Sẽ thêm: <strong style="color:#10b981">${result.newKeys.length}</strong> key mới`,
    ].filter(Boolean).join(' | ');
    preview.style.color = '#d1d5db';
}

function executeImportProxyKeys(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const textarea = getElement(config.importTextareaId);
    const rawText = textarea?.value || '';
    if (!rawText.trim()) {
        showToast('Vui lòng dán danh sách key cần nhập.', 'warning');
        return;
    }

    const result = parseProxyKeysFromText(rawText, provider);
    if (result.newKeys.length === 0) {
        if (result.alreadyExists > 0) {
            showToast(`Tất cả ${result.alreadyExists} key đã có trong ${config.label}.`, 'info');
        } else {
            showToast(`Không có ${config.label} key hợp lệ để nhập.`, 'error');
        }
        return;
    }

    config.setKeys([...config.keys(), ...result.newKeys]);
    config.render();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    closeProxyImportModal(provider);

    let message = `Đã nhập ${result.newKeys.length} ${config.label} key.`;
    if (result.alreadyExists > 0) message += ` Bỏ qua ${result.alreadyExists} key đã có.`;
    showToast(message, 'success');
}

function exportProxyKeys(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const keys = config.keys();
    if (!keys.length) {
        showToast(`${config.label} chưa có key để xuất.`, 'info');
        return [];
    }
    closeProxyKeyModal(provider);

    const modal = document.createElement('div');
    modal.id = `${config.modalId}Export`;
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
    `;

    modal.innerHTML = `
        <div style="
            background:#1a1a2e;
            border:1px solid #6366f1;
            border-radius:12px;
            padding:20px;
            width:680px;
            max-width:92vw;
            max-height:84vh;
            display:flex;
            flex-direction:column;
        ">
            <h3 style="color:#fff;margin:0 0 12px 0;">📋 Xuất ${config.label} keys (${keys.length} key)</h3>
            <p style="color:#9ca3af;margin:0 0 10px 0;font-size:13px;">Mỗi dòng một key. Chỉ lưu ở nơi an toàn.</p>
            <textarea id="${config.exportTextareaId}" readonly style="
                width:100%;
                height:300px;
                background:#0a0a0f;
                color:#10b981;
                border:1px solid #333;
                border-radius:8px;
                padding:14px;
                font-family:monospace;
                font-size:13px;
                resize:none;
            ">${keys.join('\n')}</textarea>
            <div style="display:flex;gap:10px;margin-top:15px;">
                <button onclick="copyExportedProxyKeys('${config.provider}')" style="flex:1;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;">📋 Sao chép tất cả</button>
                <button onclick="closeProxyKeyModal('${config.provider}')" style="flex:1;padding:12px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">✕ Đóng</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => getElement(config.exportTextareaId)?.select(), 100);
    return keys;
}

function copyExportedProxyKeys(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const textarea = getElement(config.exportTextareaId);
    if (!textarea) return;
    textarea.select();
    document.execCommand('copy');
    showToast(`Đã sao chép ${config.keys().length} ${config.label} key.`, 'success');
}

function closeProxyKeyModal(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const modal = getElement(`${config.modalId}Export`);
    if (modal) modal.remove();
}

function closeProxyImportModal(provider = 'ag') {
    const config = getProxyBulkKeyConfig(provider);
    const modal = getElement(`${config.modalId}Import`);
    if (modal) modal.remove();
}

function updateProxyConfig() {
    proxyBaseUrl = String(getElement('proxyBaseUrlInput')?.value || '').trim();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

function selectProxyModel() {
    const select = getElement('proxyModelSelect');
    if (select?.value) {
        proxyModel = select.value;
        saveSettings();
        showToast(`Đã chọn model Gemini Proxy AG: ${proxyModel}`, 'success');
    }
}

function appendSelectOption(select, value, label, selected = false) {
    if (!select) return;
    if (!Array.isArray(select.options)) select.options = [];
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    if (typeof select.appendChild === 'function') {
        select.appendChild(option);
    } else {
        select.options.push(option);
    }
}

function appendSelectOptgroup(select, label, models, selectedValue) {
    if (!select) return;
    if (typeof document.createElement !== 'function' || typeof select.appendChild !== 'function') {
        models.forEach((model) => appendSelectOption(select, model.id, model.label, model.id === selectedValue));
        return;
    }
    const optgroup = document.createElement('optgroup');
    optgroup.label = label;
    models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.label;
        option.selected = model.id === selectedValue;
        optgroup.appendChild(option);
        if (Array.isArray(select.options)) select.options.push(option);
    });
    select.appendChild(optgroup);
}

function renderProxyModelsDropdown() {
    const select = getElement('proxyModelSelect');
    if (!select) return;

    if (typeof ensureProxyModelDefault === 'function') {
        ensureProxyModelDefault();
    }

    select.innerHTML = '<option value="">-- Chọn model AG --</option>';
    if (Array.isArray(select.options)) select.options.length = 0;

    const groups = {};
    PROXY_MODELS.forEach((model) => {
        const groupName = model.group || 'Khác';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(model);
    });

    Object.entries(groups).forEach(([groupName, models]) => {
        appendSelectOptgroup(select, groupName, models, proxyModel);
    });

    const hasSelectedModel = Array.isArray(select.options)
        ? select.options.some((option) => option.value === proxyModel)
        : String(select.innerHTML || '').includes(proxyModel);

    if (!hasSelectedModel && proxyModel) {
        appendSelectOption(select, proxyModel, proxyModel, true);
    }

    select.value = proxyModel;
}

async function testProxyConnection() {
    const resultDiv = getElement('proxyTestResult');
    const testKey = proxyApiKeys.length > 0 ? proxyApiKeys[0] : proxyApiKey;
    if (resultDiv) resultDiv.innerHTML = '<p style="color:#f59e0b;">Đang kiểm tra Gemini Proxy AG...</p>';

    if (!testKey) {
        if (resultDiv) resultDiv.innerHTML = '<p style="color:#ef4444;">Chưa nhập API key Gemini Proxy AG.</p>';
        return;
    }

    const startTime = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(proxyBaseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: proxyModel,
                messages: [{ role: 'user', content: 'Xin chào! Trả lời ngắn gọn 1 câu.' }],
                temperature: 0.5,
                max_tokens: 100,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const proxyError = typeof createProxyHttpError === 'function'
                ? createProxyHttpError(response.status, errorData, { model: proxyModel, provider: 'Gemini Proxy AG' })
                : new Error(errorData.error?.message || `HTTP ${response.status}`);
            const errorMsg = typeof formatTranslatorError === 'function' ? formatTranslatorError(proxyError) : proxyError.message;
            if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">${errorMsg}</p><p style="color:#888;font-size:12px;">Thời gian: ${elapsed}s</p>`;
            return;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '(không có nội dung)';
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="proxy-test-card success">
                    <strong>Kết nối Gemini Proxy AG thành công.</strong>
                    <span>Model: ${data.model || proxyModel}</span>
                    <span>Thời gian: ${elapsed}s</span>
                    <span>Key: ...${testKey.slice(-6)}</span>
                    <p>${content.substring(0, 200)}</p>
                </div>`;
        }
        showToast(`Gemini Proxy AG hoạt động. Thời gian phản hồi ${elapsed}s.`, 'success');
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const normalizedError = typeof normalizeTranslatorError === 'function'
            ? normalizeTranslatorError(error, { provider: 'Gemini Proxy AG', model: proxyModel })
            : error;
        const errorMsg = typeof formatTranslatorError === 'function' ? formatTranslatorError(normalizedError) : error.message;
        if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">${errorMsg}</p><p style="color:#888;font-size:12px;">Thời gian: ${elapsed}s</p>`;
    }
}

// ============================================
// CUSTOM PROXY
// ============================================
function readProxyJsonStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('[Custom Proxy] Không đọc được storage:', key, error);
        return null;
    }
}

function writeProxyJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function normalizeCustomProxyProfile(patch = {}) {
    const previous = getCustomProxyProfile();
    customProxyProfile = {
        ...DEFAULT_CUSTOM_PROXY_PROFILE,
        ...previous,
        ...patch,
        id: CUSTOM_PROXY_PROFILE_ID,
        models: Array.isArray(patch.models ?? previous.models)
            ? (patch.models ?? previous.models).map((model) => String(model || '').trim()).filter(Boolean)
            : [],
        chatCompletionsPath: patch.chatCompletionsPath || previous.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH,
        modelsPath: patch.modelsPath || previous.modelsPath || DEFAULT_PROXY_MODELS_PATH,
    };
    return customProxyProfile;
}

function persistCustomProxySharedSettings(activate = activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY) {
    normalizeCustomProxyProfile();
    // Translator settings are intentionally isolated from the main StoryForge
    // settings page. The translator may import StoryForge config as a one-way
    // fallback in ui/settings.js, but it must never write old translator state
    // back into sf-ai-settings or sf-api-keys-v2.
    return false;
}

function renderCustomProxyPreviews() {
    const profile = normalizeCustomProxyProfile();
    const chatPreview = getElement('customProxyChatPreview');
    const modelsPreview = getElement('customProxyModelsPreview');
    const chatUrl = profile.baseUrl ? buildOpenAIProxyEndpoint(profile.baseUrl, profile.chatCompletionsPath) : '';
    const modelsUrl = profile.baseUrl ? buildOpenAIProxyEndpoint(profile.baseUrl, profile.modelsPath) : '';
    if (chatPreview) chatPreview.textContent = chatUrl || 'Nhập Base URL để xem endpoint Chat';
    if (modelsPreview) modelsPreview.textContent = modelsUrl || 'Nhập Base URL để xem endpoint Models';
}

function toggleCustomProxyMode() {
    const toggle = getElement('customProxyToggle');
    const shouldEnable = Boolean(toggle?.checked);
    useProxy = shouldEnable;

    if (shouldEnable) {
        setActiveTranslatorProvider(TRANSLATOR_PROVIDERS.CUSTOM_PROXY);
        disableOllamaProvider();
        persistCustomProxySharedSettings(true);
        showToast('Đã bật Custom Proxy. Hệ thống sẽ dùng model custom đã chọn để dịch.', 'success');
    } else if (activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY) {
        setActiveTranslatorProvider(TRANSLATOR_PROVIDERS.GEMINI_DIRECT);
        showToast('Đã tắt Custom Proxy, sử dụng Gemini Direct.', 'info');
    }

    updateProxyModeControls();
    renderCustomProxyModelsDropdown();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

function updateCustomProxyConfig(patch = {}) {
    const baseUrlInput = getElement('customProxyBaseUrlInput');
    const modelInput = getElement('customProxyModelInput');
    const nextPatch = {
        ...patch,
    };
    if (baseUrlInput?.id === 'customProxyBaseUrlInput') {
        nextPatch.baseUrl = String(baseUrlInput.value || '').trim();
    }
    if (modelInput?.id === 'customProxyModelInput' && !patch.defaultModel) {
        nextPatch.defaultModel = String(modelInput.value || customProxyProfile.defaultModel || '').trim();
    }

    normalizeCustomProxyProfile(nextPatch);
    renderCustomProxyPreviews();
    renderCustomProxyModelsDropdown();
    persistCustomProxySharedSettings();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    return customProxyProfile;
}

function addCustomProxyKey() {
    const input = getElement('newCustomProxyKeyInput');
    const key = String(input?.value || '').trim();
    if (!key) {
        showToast('Vui lòng nhập API key cho Custom Proxy.', 'warning');
        return;
    }
    if (customProxyApiKeys.includes(key)) {
        showToast('Key này đã tồn tại trong Custom Proxy.', 'error');
        if (input) input.value = '';
        return;
    }
    customProxyApiKeys.push(key);
    customProxyApiKey = customProxyApiKeys[0] || '';
    if (input) input.value = '';
    renderCustomProxyKeysList();
    persistCustomProxySharedSettings();
    saveSettings();
    showToast(`Đã thêm Custom Proxy key. Hiện có ${customProxyApiKeys.length} key để xoay.`, 'success');
}

function removeCustomProxyKey(index) {
    customProxyApiKeys.splice(index, 1);
    customProxyApiKey = customProxyApiKeys[0] || '';
    customProxyKeyHealthMap = {};
    renderCustomProxyKeysList();
    persistCustomProxySharedSettings();
    saveSettings();
    showToast('Đã xóa Custom Proxy key.', 'info');
}

function renderCustomProxyKeysList() {
    const container = getElement('customProxyKeysList');
    const countBadge = getElement('customProxyKeyCount');
    const count = customProxyApiKeys.length;
    if (countBadge) {
        countBadge.textContent = `${count} key xoay tua`;
        countBadge.style.background = count > 1 ? 'var(--success)' : (count === 1 ? 'var(--accent-primary)' : 'var(--danger)');
    }
    if (!container) return;
    if (count === 0) {
        container.innerHTML = '<p class="empty-message">Chưa có key Custom Proxy. Key này dùng pool openai_proxy riêng.</p>';
        return;
    }
    container.innerHTML = customProxyApiKeys.map((key, index) => `
        <div class="api-key-item">
            <span class="key-index" style="background: var(--accent-primary)">C${index + 1}</span>
            <span class="key-value">${maskProxyKey(key)}</span>
            <button class="remove-btn" onclick="removeCustomProxyKey(${index})" title="Xóa">Xóa</button>
        </div>
    `).join('');
}

function renderCustomProxyModelsDropdown() {
    const select = getElement('customProxyModelSelect');
    const input = getElement('customProxyModelInput');
    const status = getElement('customProxyModelStatus');
    const profile = normalizeCustomProxyProfile();

    if (input) input.value = profile.defaultModel || '';
    if (status) {
        status.textContent = profile.defaultModel
            ? `Đang chọn: ${profile.defaultModel}`
            : 'Chưa chọn model Custom Proxy.';
        status.className = profile.defaultModel ? 'model-fetch-status success' : 'model-fetch-status';
    }
    if (!select) return;

    select.innerHTML = '<option value="">-- Chọn model đã lấy --</option>';
    if (Array.isArray(select.options)) select.options.length = 0;
    appendSelectOption(select, '', '-- Chọn model đã lấy --', !profile.defaultModel);
    profile.models.forEach((model) => appendSelectOption(select, model, model, model === profile.defaultModel));
    if (profile.defaultModel && !profile.models.includes(profile.defaultModel)) {
        appendSelectOption(select, profile.defaultModel, profile.defaultModel, true);
    }
    select.value = profile.defaultModel || '';
}

async function fetchCustomProxyModels() {
    const profile = updateCustomProxyConfig();
    const modelStatus = getElement('customProxyModelStatus');
    const key = customProxyApiKeys[0] || customProxyApiKey;
    const target = typeof getCustomProxyRequestTarget === 'function'
        ? getCustomProxyRequestTarget('models')
        : { mode: 'direct', url: buildOpenAIProxyEndpoint(profile.baseUrl, profile.modelsPath || DEFAULT_PROXY_MODELS_PATH), path: profile.modelsPath || DEFAULT_PROXY_MODELS_PATH, profile };

    if (!profile.baseUrl) {
        showToast('Nhập Base URL Custom Proxy trước khi lấy models.', 'warning');
        return [];
    }
    if (!key) {
        showToast('Thêm Custom Proxy API key trước khi lấy models.', 'warning');
        return [];
    }

    if (modelStatus) {
        modelStatus.textContent = 'Đang lấy danh sách model từ Custom Proxy...';
        modelStatus.className = 'model-fetch-status pending';
    }

    const response = await fetch(target.url, {
        method: target.mode === 'relay' ? 'POST' : 'GET',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
        body: target.mode === 'relay'
            ? JSON.stringify({
                action: 'models',
                baseUrl: target.profile.baseUrl,
                modelsPath: target.path,
            })
            : undefined,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
        if (modelStatus) {
            modelStatus.textContent = `Không lấy được models: ${message}`;
            modelStatus.className = 'model-fetch-status error';
        }
        showToast(`Không lấy được models Custom Proxy: ${message}`, 'error');
        return [];
    }

    const allModels = parseOpenAIModelIds(data);
    const geminiModels = filterGeminiModelIds(allModels);
    if (geminiModels.length === 0) {
        normalizeCustomProxyProfile({ models: [] });
        renderCustomProxyModelsDropdown();
        if (modelStatus) {
            modelStatus.textContent = `Đã lấy ${allModels.length} models nhưng không thấy model Gemini. Bạn vẫn có thể nhập model thủ công.`;
            modelStatus.className = 'model-fetch-status error';
        }
        return [];
    }

    const currentModel = String(profile.defaultModel || '').trim();
    const defaultModel = geminiModels.includes(currentModel) ? currentModel : geminiModels[0];
    normalizeCustomProxyProfile({
        models: geminiModels,
        defaultModel,
    });
    renderCustomProxyModelsDropdown();
    persistCustomProxySharedSettings(true);
    saveSettings();

    if (modelStatus) {
        modelStatus.textContent = `Đã lấy ${allModels.length} models, lọc còn ${geminiModels.length} model Gemini.`;
        modelStatus.className = 'model-fetch-status success';
    }
    showToast(`Đã lấy ${geminiModels.length} model Gemini từ Custom Proxy.`, 'success');
    return geminiModels;
}

function selectCustomProxyModel(modelName = '') {
    const select = getElement('customProxyModelSelect');
    const input = getElement('customProxyModelInput');
    const value = String(modelName || select?.value || input?.value || '').trim();
    if (!value) {
        showToast('Vui lòng chọn hoặc nhập model Custom Proxy.', 'warning');
        return false;
    }

    const profile = normalizeCustomProxyProfile({
        defaultModel: value,
        models: customProxyProfile.models.includes(value)
            ? customProxyProfile.models
            : [...customProxyProfile.models, value],
    });
    if (input) input.value = value;
    if (select) select.value = value;
    renderCustomProxyModelsDropdown();
    persistCustomProxySharedSettings(true);
    saveSettings();
    showToast(`Đã chọn model Custom Proxy: ${profile.defaultModel}`, 'success');
    return true;
}

async function testCustomProxyConnection() {
    updateCustomProxyConfig();
    const resultDiv = getElement('customProxyTestResult');
    const profile = normalizeCustomProxyProfile();
    const key = customProxyApiKeys[0] || customProxyApiKey;
    const model = profile.defaultModel;
    const target = typeof getCustomProxyRequestTarget === 'function'
        ? getCustomProxyRequestTarget('chat')
        : { mode: 'direct', url: buildOpenAIProxyEndpoint(profile.baseUrl, profile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH), path: profile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH, profile };

    if (resultDiv) resultDiv.innerHTML = '<p style="color:#f59e0b;">Đang kiểm tra Custom Proxy...</p>';
    if (!profile.baseUrl || !key || !model) {
        if (resultDiv) resultDiv.innerHTML = '<p style="color:#ef4444;">Cần Base URL, API key và model Custom Proxy trước khi test.</p>';
        return false;
    }

    const startTime = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const payload = {
            model,
            messages: [{ role: 'user', content: 'Xin chào! Trả lời ngắn gọn 1 câu.' }],
            temperature: 0.5,
            max_tokens: 100,
        };
        const response = await fetch(target.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(target.mode === 'relay'
                ? {
                    action: 'chat',
                    baseUrl: target.profile.baseUrl,
                    chatCompletionsPath: target.path,
                    payload,
                }
                : payload),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData?.error?.message || errorData?.error || `HTTP ${response.status}`;
            if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">Không kết nối được Custom Proxy: ${message}</p>`;
            return false;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '(không có nội dung)';
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="proxy-test-card success">
                    <strong>Kết nối Custom Proxy thành công.</strong>
                    <span>Model: ${data.model || model}</span>
                    <span>Thời gian: ${elapsed}s</span>
                    <span>Key: ...${key.slice(-6)}</span>
                    <p>${content.substring(0, 200)}</p>
                </div>`;
        }
        showToast(`Custom Proxy hoạt động. Thời gian phản hồi ${elapsed}s.`, 'success');
        return true;
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? 'Timeout sau 30 giây.'
            : (error?.message || 'Lỗi mạng/CORS khi test Custom Proxy.');
        if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">${message}</p>`;
        return false;
    }
}

// ============================================
// INIT PROXY UI
// ============================================
function initProxyUI() {
    if (useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.GEMINI_DIRECT) {
        setActiveTranslatorProvider(TRANSLATOR_PROVIDERS.AG_PROXY);
    }

    const agBaseUrlInput = getElement('proxyBaseUrlInput');
    const customBaseUrlInput = getElement('customProxyBaseUrlInput');
    const customModelInput = getElement('customProxyModelInput');

    if (agBaseUrlInput) agBaseUrlInput.value = proxyBaseUrl;
    if (customBaseUrlInput) customBaseUrlInput.value = customProxyProfile.baseUrl || '';
    if (customModelInput) customModelInput.value = customProxyProfile.defaultModel || '';

    updateProxyModeControls();
    renderProxyModelsDropdown();
    renderProxyKeysList();
    renderCustomProxyPreviews();
    renderCustomProxyKeysList();
    renderCustomProxyModelsDropdown();
}
