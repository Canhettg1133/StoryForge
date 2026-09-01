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
    globalThis.AiStudioScheduler?.refreshSettings?.();
    const isAgActive = useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.AG_PROXY;
    const isCustomActive = useProxy && activeTranslatorProvider === TRANSLATOR_PROVIDERS.CUSTOM_PROXY;
    const isDirectActive = !useProxy
        && (typeof useOllama === 'undefined' || !useOllama)
        && activeTranslatorProvider === TRANSLATOR_PROVIDERS.GEMINI_DIRECT;

    const agToggle = getElement('useProxyToggle');
    const customToggle = getElement('customProxyToggle');
    if (agToggle) agToggle.checked = isAgActive;
    if (customToggle) customToggle.checked = isCustomActive;

    setElementDisplay('proxySettings', isAgActive);
    setElementDisplay('customProxySettings', isCustomActive);
    setBadgeState('proxyStatus', isAgActive);
    setBadgeState('customProxyStatus', isCustomActive);

    const directButton = getElement('activateGeminiDirectButton');
    if (directButton) {
        directButton.disabled = isDirectActive;
        directButton.textContent = isDirectActive ? 'Đang dùng Gemini Direct' : 'Dùng Gemini Direct';
        directButton.setAttribute('aria-pressed', String(isDirectActive));
        directButton.classList?.toggle('active', isDirectActive);
    }
}

function escapeProxyHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
    if (globalThis.AiStudioScheduler?.guardSettingsChange()) return;
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
        countBadge.dataset.tone = count > 1 ? 'success' : (count === 1 ? 'active' : 'empty');
    }

    if (!container) return;
    if (count === 0) {
        container.innerHTML = '<p class="empty-message">Chưa có key nào. Thêm ít nhất 1 key để dùng Gemini Proxy AG.</p>';
        return;
    }

    container.innerHTML = proxyApiKeys.map((key, index) => {
        return `
        <div class="api-key-item proxy-key-item">
            <span class="key-index" aria-hidden="true">AG${index + 1}</span>
            <span class="key-value">${escapeProxyHtml(maskProxyKey(key))}</span>
            <button class="remove-btn" type="button" data-click-action="removeProxyKey" data-action-index="${index}"
                title="Xóa key" aria-label="Xóa key Gemini Proxy AG số ${index + 1}">
                <svg class="remove-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"></path>
                </svg>
            </button>
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

async function openImportProxyKeysModal(provider = 'ag') {
    if (
        typeof requireStoryForgeFeature === 'function'
        && !(await requireStoryForgeFeature('translator.bulk_keys'))
    ) return;

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
                <button type="button" data-click-action="executeImportProxyKeys" data-action-value="${config.provider}" style="flex:1;padding:12px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;">✅ Nhập key</button>
                <button type="button" data-click-action="closeProxyImportModal" data-action-value="${config.provider}" style="flex:1;padding:12px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">✕ Hủy</button>
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
    if (provider === 'custom' && typeof renderTranslatorCustomProxyPresets === 'function') {
        renderTranslatorCustomProxyPresets();
    }
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    closeProxyImportModal(provider);

    let message = `Đã nhập ${result.newKeys.length} ${config.label} key.`;
    if (result.alreadyExists > 0) message += ` Bỏ qua ${result.alreadyExists} key đã có.`;
    showToast(message, 'success');
}

async function exportProxyKeys(provider = 'ag') {
    if (
        typeof requireStoryForgeFeature === 'function'
        && !(await requireStoryForgeFeature('translator.bulk_keys'))
    ) return [];

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
            ">${escapeProxyHtml(keys.join('\n'))}</textarea>
            <div style="display:flex;gap:10px;margin-top:15px;">
                <button type="button" data-click-action="copyExportedProxyKeys" data-action-value="${config.provider}" style="flex:1;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;">📋 Sao chép tất cả</button>
                <button type="button" data-click-action="closeProxyKeyModal" data-action-value="${config.provider}" style="flex:1;padding:12px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">✕ Đóng</button>
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
    const input = getElement('proxyBaseUrlInput');
    proxyBaseUrl = typeof normalizeAgProxyBaseUrl === 'function'
        ? normalizeAgProxyBaseUrl(input?.value || proxyBaseUrl)
        : String(input?.value || '').trim();
    if (input) input.value = proxyBaseUrl;
    renderAgProxyEndpointPreview();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

function activateGeminiDirect() {
    if (globalThis.AiStudioScheduler?.guardSettingsChange()) return;
    disableOllamaProvider();
    useProxy = false;
    setActiveTranslatorProvider(TRANSLATOR_PROVIDERS.GEMINI_DIRECT);
    updateProxyModeControls();
    saveSettings();
    if (typeof saveOllamaSettings === 'function') saveOllamaSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    showToast('Đã chuyển sang Gemini Direct. AG, Custom Proxy và Ollama đã được tắt.', 'success');
}

function selectProxyModel() {
    const select = getElement('proxyModelSelect');
    if (select?.value) {
        proxyModel = select.value;
        saveSettings();
        showToast(`Đã chọn model Gemini Proxy AG: ${proxyModel}`, 'success');
    }
}

function applyProxyCustomModel() {
    const input = getElement('proxyCustomModel');
    const nextModel = String(input?.value || '').trim();
    if (!nextModel) {
        showToast('Vui lòng nhập model Gemini Proxy AG.', 'warning');
        return false;
    }
    proxyModel = nextModel;
    renderProxyModelsDropdown();
    saveSettings();
    showToast(`Đã chọn model Gemini Proxy AG: ${proxyModel}`, 'success');
    return true;
}

function renderAgProxyEndpointPreview() {
    const preview = getElement('proxyEndpointPreview');
    if (!preview || typeof getAgProxyRequestTarget !== 'function') return;
    const target = getAgProxyRequestTarget('chat');
    const endpoint = target?.mode === 'relay'
        ? `${target.profile?.baseUrl || ''}${target.path || ''}`
        : target?.url;
    preview.textContent = target?.mode === 'relay'
        ? `Sẽ chạy qua relay StoryForge -> ${endpoint}`
        : `Sẽ gọi trực tiếp -> ${endpoint || 'chưa có URL'}`;
    preview.className = `proxy-endpoint-preview ${target?.mode === 'relay' ? 'is-relay' : 'is-direct'}`;
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
    const baseUrlInput = getElement('proxyBaseUrlInput');
    if (baseUrlInput) {
        proxyBaseUrl = typeof normalizeAgProxyBaseUrl === 'function'
            ? normalizeAgProxyBaseUrl(baseUrlInput.value || proxyBaseUrl)
            : String(baseUrlInput.value || proxyBaseUrl || '').trim();
        baseUrlInput.value = proxyBaseUrl;
    }
    renderAgProxyEndpointPreview();
    const resultDiv = getElement('proxyTestResult');
    const testKey = proxyApiKeys.length > 0 ? proxyApiKeys[0] : proxyApiKey;
    const target = typeof getAgProxyRequestTarget === 'function'
        ? getAgProxyRequestTarget('chat')
        : { mode: 'direct', url: proxyBaseUrl, path: DEFAULT_PROXY_CHAT_PATH, profile: { baseUrl: proxyBaseUrl } };
    if (resultDiv) resultDiv.innerHTML = '<p style="color:#f59e0b;">Đang kiểm tra Gemini Proxy AG...</p>';

    if (!testKey) {
        if (resultDiv) resultDiv.innerHTML = '<p style="color:#ef4444;">Chưa nhập API key Gemini Proxy AG.</p>';
        return false;
    }
    if (!proxyModel) {
        if (resultDiv) resultDiv.innerHTML = '<p style="color:#ef4444;">Chưa chọn model Gemini Proxy AG.</p>';
        return false;
    }

    const startTime = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const payload = {
            model: proxyModel,
            messages: [{ role: 'user', content: 'Xin chào! Trả lời ngắn gọn 1 câu.' }],
            temperature: 0.5,
            max_tokens: 100,
        };
        const response = await fetch(target.url, {
            method: 'POST',
            headers: getProxyRequestHeaders(target, testKey),
            body: JSON.stringify(target.mode === 'relay'
                ? {
                    action: 'chat',
                    baseUrl: target.profile.baseUrl,
                    chatCompletionsPath: target.path,
                    templateId: typeof getActiveTranslatorTemplateId === 'function' ? getActiveTranslatorTemplateId() : 'convert',
                    payload,
                }
                : payload),
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
            if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">${escapeProxyHtml(errorMsg)}</p><p style="color:#888;font-size:12px;">Thời gian: ${escapeProxyHtml(elapsed)}s</p>`;
            return false;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '(không có nội dung)';
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="proxy-test-card success">
                    <strong>Kết nối Gemini Proxy AG thành công.</strong>
                    <span>Model: ${escapeProxyHtml(data.model || proxyModel)}</span>
                    <span>Thời gian: ${escapeProxyHtml(elapsed)}s</span>
                    <span>Key: ...${escapeProxyHtml(testKey.slice(-6))}</span>
                    <p>${escapeProxyHtml(content.substring(0, 200))}</p>
                </div>`;
        }
        showToast(`Gemini Proxy AG hoạt động. Thời gian phản hồi ${elapsed}s.`, 'success');
        return true;
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const normalizedError = typeof normalizeTranslatorError === 'function'
            ? normalizeTranslatorError(error, { provider: 'Gemini Proxy AG', model: proxyModel })
            : error;
        const errorMsg = typeof formatTranslatorError === 'function' ? formatTranslatorError(normalizedError) : error.message;
        if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">${escapeProxyHtml(errorMsg)}</p><p style="color:#888;font-size:12px;">Thời gian: ${escapeProxyHtml(elapsed)}s</p>`;
        return false;
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

function getCustomProxyBaseUrlCacheKey(value) {
    return String(value || '').trim();
}

function normalizeCustomProxyModelList(models = []) {
    return [...new Set(
        (Array.isArray(models) ? models : [])
            .map((model) => String(model || '').trim())
            .filter(Boolean)
    )];
}

const CUSTOM_PROXY_MODEL_CATALOG_SOURCE_AUTO = 'auto';
const CUSTOM_PROXY_MODEL_CATALOG_SOURCE_9ROUTER_OPENCODE = '9router_opencode';

function normalize9RouterOpenCodeModelIds(models = []) {
    return normalizeCustomProxyModelList(
        normalizeCustomProxyModelList(models)
            .map((model) => (model.startsWith('oc/') ? model : `oc/${model}`))
    );
}

function isLikely9RouterCustomProxyProfile(profile = {}) {
    const source = String(profile.modelCatalogSource || CUSTOM_PROXY_MODEL_CATALOG_SOURCE_AUTO).trim();
    if (source === CUSTOM_PROXY_MODEL_CATALOG_SOURCE_9ROUTER_OPENCODE) return true;
    if (source && source !== CUSTOM_PROXY_MODEL_CATALOG_SOURCE_AUTO) return false;

    const label = String(profile.label || '').trim().toLowerCase();
    if (label.includes('9router')) return true;

    const baseUrl = String(profile.baseUrl || '').trim();
    if (!baseUrl || (typeof isRelativeProxyUrl === 'function' && isRelativeProxyUrl(baseUrl))) return false;

    try {
        const parsed = new URL(baseUrl);
        return parsed.port === '20128'
            && (typeof isLocalProxyHost === 'function'
                ? isLocalProxyHost(parsed.hostname)
                : ['localhost', '127.0.0.1'].includes(parsed.hostname));
    } catch {
        return false;
    }
}

function getCustomProxyModelCatalogHeaders() {
    const storyForgeToken = typeof getStoryForgeAccessToken === 'function'
        ? String(getStoryForgeAccessToken() || '').trim()
        : '';
    return {
        'Content-Type': 'application/json',
        ...(storyForgeToken ? { 'Authorization': `Bearer ${storyForgeToken}` } : {}),
    };
}

async function fetchCustomProxyModelCatalog(catalog = CUSTOM_PROXY_MODEL_CATALOG_SOURCE_9ROUTER_OPENCODE) {
    const response = await fetch('/api/openai-proxy', {
        method: 'POST',
        headers: getCustomProxyModelCatalogHeaders(),
        body: JSON.stringify({
            action: 'model_catalog',
            catalog,
        }),
    });

    if (!response.ok) throw new Error(`Model catalog request failed with status ${response.status}.`);
    return parseOpenAIModelIds(await response.json().catch(() => ({})));
}

async function mergeCustomProxyCatalogModels(profile, upstreamModels = []) {
    const normalizedUpstreamModels = normalizeCustomProxyModelList(upstreamModels);
    if (!isLikely9RouterCustomProxyProfile(profile)) return normalizedUpstreamModels;

    try {
        const catalogModels = normalize9RouterOpenCodeModelIds(
            await fetchCustomProxyModelCatalog(CUSTOM_PROXY_MODEL_CATALOG_SOURCE_9ROUTER_OPENCODE)
        );
        return normalizeCustomProxyModelList([...normalizedUpstreamModels, ...catalogModels]);
    } catch {
        return normalizedUpstreamModels;
    }
}

const TRANSLATOR_PROXY_MODEL_CHANNEL_ORDER = ['Google CLI', 'Antigravity', 'AG Proxy', 'Custom Proxy', 'Không rõ kênh'];
const TRANSLATOR_PROXY_MODEL_FAMILY_ORDER = [
    'Gemini',
    'Claude',
    'OpenAI',
    'DeepSeek',
    'Kimi',
    'MiniMax',
    'Qwen',
    'Llama',
    'Mistral',
    'Grok',
    'Yi',
    'GLM',
    'Doubao/Seed',
    'Cohere',
    'AI21',
    'Databricks',
    'Code/Embedding',
    'JJ',
    'Khác',
];
const TRANSLATOR_PROXY_MODEL_FAMILY_FILTERS = [
    'Tất cả',
    'Gemini',
    'Claude',
    'OpenAI',
    'DeepSeek',
    'Kimi',
    'MiniMax',
    'Qwen',
    'Llama',
    'Mistral',
    'Grok',
    'Khác',
];
const TRANSLATOR_PROXY_MODEL_PRIMARY_FAMILIES = TRANSLATOR_PROXY_MODEL_FAMILY_FILTERS
    .filter((family) => family !== 'Tất cả' && family !== 'Khác');
let customProxyModelSearchText = '';
let customProxyModelFamilyFilter = 'Tất cả';

function getProxyModelOrderIndex(order, value) {
    const index = order.indexOf(value);
    return index === -1 ? order.length : index;
}

function hasProxyModelToken(value, token) {
    return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'iu').test(value);
}

function normalizeProxyModelIdForMatch(modelId) {
    return String(modelId || '').trim().toLowerCase();
}

function classifyTranslatorProxyModelChannel(normalizedModelId, context = {}) {
    if (
        normalizedModelId.includes('antigravity')
        || normalizedModelId.includes('antygravity')
        || normalizedModelId.includes('反重力渠道')
        || hasProxyModelToken(normalizedModelId, 'agy')
    ) {
        return 'Antigravity';
    }
    if (
        normalizedModelId.includes('cli渠道')
        || normalizedModelId.includes('cli channel')
        || normalizedModelId.includes('gcli')
    ) {
        return 'Google CLI';
    }
    if (context.profileId === AG_PROXY_PROFILE_ID) return 'AG Proxy';
    if (context.profileId === CUSTOM_PROXY_PROFILE_ID) return 'Custom Proxy';
    return 'Không rõ kênh';
}

function isKnownTranslatorGoogleChannel(channel) {
    return channel === 'Google CLI' || channel === 'Antigravity' || channel === 'AG Proxy';
}

function classifyTranslatorProxyModelFamily(normalizedModelId, channel) {
    if (normalizedModelId.includes('anthropic/') || normalizedModelId.startsWith('claude') || normalizedModelId.includes('/claude')) {
        return { family: 'Claude', confidence: 'high' };
    }
    if (/(^|[/:._-])(sonnet|opus|haiku)([-/:._]|$)/iu.test(normalizedModelId)) {
        return { family: 'Claude', confidence: 'low' };
    }
    if (
        normalizedModelId.includes('openai/')
        || normalizedModelId.startsWith('gpt-')
        || normalizedModelId.includes('/gpt-')
        || hasProxyModelToken(normalizedModelId, 'o3')
        || hasProxyModelToken(normalizedModelId, 'o4')
    ) {
        return { family: 'OpenAI', confidence: 'high' };
    }
    if (normalizedModelId.includes('google/gemini') || hasProxyModelToken(normalizedModelId, 'gemini')) {
        return { family: 'Gemini', confidence: 'high' };
    }
    if (normalizedModelId.includes('deepseek')) return { family: 'DeepSeek', confidence: 'high' };
    if (normalizedModelId.includes('kimi') || normalizedModelId.includes('moonshot')) return { family: 'Kimi', confidence: 'high' };
    if (normalizedModelId.includes('minimax') || normalizedModelId.includes('abab')) {
        return { family: 'MiniMax', confidence: 'high' };
    }
    if (normalizedModelId.includes('qwen')) return { family: 'Qwen', confidence: 'high' };
    if (normalizedModelId.includes('meta-llama') || normalizedModelId.includes('llama')) return { family: 'Llama', confidence: 'high' };
    if (normalizedModelId.includes('mistral') || normalizedModelId.includes('mixtral')) return { family: 'Mistral', confidence: 'high' };
    if (normalizedModelId.includes('grok') || normalizedModelId.includes('x-ai/') || normalizedModelId.includes('xai/')) return { family: 'Grok', confidence: 'high' };
    if (normalizedModelId.includes('01-ai/') || hasProxyModelToken(normalizedModelId, 'yi')) return { family: 'Yi', confidence: 'high' };
    if (normalizedModelId.includes('zhipu') || hasProxyModelToken(normalizedModelId, 'glm')) return { family: 'GLM', confidence: 'high' };
    if (normalizedModelId.includes('doubao') || normalizedModelId.includes('bytedance') || hasProxyModelToken(normalizedModelId, 'seed')) return { family: 'Doubao/Seed', confidence: 'high' };
    if (normalizedModelId.includes('cohere') || hasProxyModelToken(normalizedModelId, 'command')) return { family: 'Cohere', confidence: 'medium' };
    if (normalizedModelId.includes('ai21') || hasProxyModelToken(normalizedModelId, 'jamba')) return { family: 'AI21', confidence: 'high' };
    if (normalizedModelId.includes('databricks') || hasProxyModelToken(normalizedModelId, 'dbrx')) return { family: 'Databricks', confidence: 'high' };
    if (normalizedModelId.includes('starcoder') || normalizedModelId.includes('codestral') || normalizedModelId.includes('/bge-')) return { family: 'Code/Embedding', confidence: 'medium' };
    if (/(^|[/:._-])jj([/:._-]|$)/iu.test(normalizedModelId)) return { family: 'JJ', confidence: 'high' };
    if (isKnownTranslatorGoogleChannel(channel) && (hasProxyModelToken(normalizedModelId, 'flash') || hasProxyModelToken(normalizedModelId, 'pro'))) {
        return { family: 'Gemini', confidence: 'low' };
    }
    return { family: 'Khác', confidence: 'unknown' };
}

function classifyTranslatorProxyModel(modelId, context = {}) {
    const id = String(modelId || '').trim();
    const normalizedModelId = normalizeProxyModelIdForMatch(id);
    const channel = classifyTranslatorProxyModelChannel(normalizedModelId, context);
    const familyResult = classifyTranslatorProxyModelFamily(normalizedModelId, channel);
    return {
        id,
        channel,
        family: familyResult.family,
        confidence: familyResult.confidence,
    };
}

function groupTranslatorProxyModelsForDisplay(models = [], context = {}) {
    const items = normalizeCustomProxyModelList(models)
        .map((model) => classifyTranslatorProxyModel(model, context))
        .sort((a, b) => (
            getProxyModelOrderIndex(TRANSLATOR_PROXY_MODEL_CHANNEL_ORDER, a.channel) - getProxyModelOrderIndex(TRANSLATOR_PROXY_MODEL_CHANNEL_ORDER, b.channel)
            || getProxyModelOrderIndex(TRANSLATOR_PROXY_MODEL_FAMILY_ORDER, a.family) - getProxyModelOrderIndex(TRANSLATOR_PROXY_MODEL_FAMILY_ORDER, b.family)
            || a.id.localeCompare(b.id)
        ));

    const groupsByChannel = new Map();
    items.forEach((item) => {
        if (!groupsByChannel.has(item.channel)) {
            groupsByChannel.set(item.channel, { channel: item.channel, models: [] });
        }
        groupsByChannel.get(item.channel).models.push(item);
    });

    return Array.from(groupsByChannel.values()).map((group) => {
        const familyMap = new Map();
        group.models.forEach((item) => {
            if (!familyMap.has(item.family)) {
                familyMap.set(item.family, { family: item.family, models: [] });
            }
            familyMap.get(item.family).models.push(item);
        });
        return {
            ...group,
            families: Array.from(familyMap.values()),
        };
    });
}

function getProxyModelConfidenceLabel(confidence) {
    if (confidence === 'low' || confidence === 'medium') return 'Chưa chắc';
    if (confidence === 'unknown') return 'Chưa rõ';
    return '';
}

function getCustomProxyPickerModels(profile = customProxyProfile) {
    return normalizeCustomProxyModelList([
        profile.defaultModel,
        ...(Array.isArray(profile.models) ? profile.models : []),
    ]);
}

function clearModelPickerElement(element) {
    if (!element) return;
    while (element.firstChild && typeof element.removeChild === 'function') {
        element.removeChild(element.firstChild);
    }
    element.textContent = '';
}

function canAppendModelPickerChildren(element) {
    return Boolean(element && typeof element.appendChild === 'function' && typeof document.createElement === 'function');
}

function appendModelPickerBadge(container, text, extraClass = '') {
    const badge = document.createElement('span');
    badge.className = `model-picker-badge${extraClass ? ` ${extraClass}` : ''}`;
    badge.textContent = text;
    container.appendChild(badge);
}

function renderCustomProxyModelFilters() {
    const container = getElement('customProxyModelFilters');
    if (!container) return;
    clearModelPickerElement(container);
    if (!canAppendModelPickerChildren(container)) return;

    TRANSLATOR_PROXY_MODEL_FAMILY_FILTERS.forEach((filter) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `model-family-filter ${customProxyModelFamilyFilter === filter ? 'is-active' : ''}`;
        button.textContent = filter;
        button.onclick = () => setCustomProxyModelFamilyFilter(filter);
        container.appendChild(button);
    });
}

function setCustomProxyModelFamilyFilter(filter = 'Tất cả') {
    customProxyModelFamilyFilter = TRANSLATOR_PROXY_MODEL_FAMILY_FILTERS.includes(filter) ? filter : 'Tất cả';
    renderCustomProxyModelsDropdown();
}

function setCustomProxyModelSearch(value = '') {
    customProxyModelSearchText = String(value || '').trim();
    renderCustomProxyModelPicker(normalizeCustomProxyProfile());
}

function normalizeCustomProxyProfile(patch = {}) {
    const previous = getCustomProxyProfile();
    const hasBaseUrlPatch = Object.prototype.hasOwnProperty.call(patch, 'baseUrl');
    const nextBaseUrl = String((hasBaseUrlPatch ? patch.baseUrl : previous.baseUrl) || '').trim();
    const baseUrlChanged = hasBaseUrlPatch
        && getCustomProxyBaseUrlCacheKey(nextBaseUrl) !== getCustomProxyBaseUrlCacheKey(previous.baseUrl);
    const shouldClearModels = !nextBaseUrl || baseUrlChanged;
    customProxyProfile = {
        ...DEFAULT_CUSTOM_PROXY_PROFILE,
        ...previous,
        ...patch,
        id: CUSTOM_PROXY_PROFILE_ID,
        baseUrl: nextBaseUrl,
        defaultModel: shouldClearModels ? '' : String((patch.defaultModel ?? previous.defaultModel) || '').trim(),
        models: shouldClearModels
            ? []
            : normalizeCustomProxyModelList(patch.models ?? previous.models),
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
    if (globalThis.AiStudioScheduler?.guardSettingsChange()) return;
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
    if (typeof renderTranslatorCustomProxyPresets === 'function') renderTranslatorCustomProxyPresets();
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
    if (typeof renderTranslatorCustomProxyPresets === 'function') renderTranslatorCustomProxyPresets();
    showToast(`Đã thêm Custom Proxy key. Hiện có ${customProxyApiKeys.length} key để xoay.`, 'success');
}

function removeCustomProxyKey(index) {
    customProxyApiKeys.splice(index, 1);
    customProxyApiKey = customProxyApiKeys[0] || '';
    customProxyKeyHealthMap = {};
    renderCustomProxyKeysList();
    persistCustomProxySharedSettings();
    saveSettings();
    if (typeof renderTranslatorCustomProxyPresets === 'function') renderTranslatorCustomProxyPresets();
    showToast('Đã xóa Custom Proxy key.', 'info');
}

function renderCustomProxyKeysList() {
    const container = getElement('customProxyKeysList');
    const countBadge = getElement('customProxyKeyCount');
    const count = customProxyApiKeys.length;
    if (countBadge) {
        countBadge.textContent = `${count} key xoay tua`;
        countBadge.dataset.tone = count > 1 ? 'success' : (count === 1 ? 'active' : 'empty');
    }
    if (!container) return;
    if (count === 0) {
        container.innerHTML = '<p class="empty-message">Chưa có key Custom Proxy. Key này dùng pool openai_proxy riêng.</p>';
        return;
    }
    container.innerHTML = customProxyApiKeys.map((key, index) => `
        <div class="api-key-item proxy-key-item">
            <span class="key-index" aria-hidden="true">C${index + 1}</span>
            <span class="key-value">${escapeProxyHtml(maskProxyKey(key))}</span>
            <button class="remove-btn" type="button" data-click-action="removeCustomProxyKey" data-action-index="${index}"
                title="Xóa key" aria-label="Xóa key Custom Proxy số ${index + 1}">
                <svg class="remove-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"></path>
                </svg>
            </button>
        </div>
    `).join('');
}

function renderCustomProxyModelPicker(profile = normalizeCustomProxyProfile()) {
    const searchInput = getElement('customProxyModelSearch');
    const selectedCard = getElement('customProxySelectedModel');
    const picker = getElement('customProxyModelPicker');
    const context = { profileId: CUSTOM_PROXY_PROFILE_ID, profileLabel: profile.label || 'Custom Proxy' };
    const allModels = getCustomProxyPickerModels(profile);
    const normalizedSearch = customProxyModelSearchText.toLowerCase();

    if (searchInput && searchInput.value !== customProxyModelSearchText) {
        searchInput.value = customProxyModelSearchText;
    }

    renderCustomProxyModelFilters();

    if (selectedCard) {
        selectedCard.textContent = profile.defaultModel
            ? `Đang dùng: ${profile.defaultModel}`
            : 'Chưa chọn model Custom Proxy.';
        selectedCard.classList?.toggle('is-active', Boolean(profile.defaultModel));
    }

    if (!picker) return;
    clearModelPickerElement(picker);
    if (!canAppendModelPickerChildren(picker)) return;

    if (!allModels.length) {
        const empty = document.createElement('div');
        empty.className = 'model-picker-empty';
        empty.textContent = profile.baseUrl
            ? 'Chưa có danh sách model. Bấm Lấy models hoặc nhập model thủ công bên dưới.'
            : 'Nhập Base URL và API key trước, sau đó bấm Lấy models.';
        picker.appendChild(empty);
        return;
    }

    const filteredModels = allModels.filter((model) => {
        const meta = classifyTranslatorProxyModel(model, context);
        const matchesSearch = !normalizedSearch
            || meta.id.toLowerCase().includes(normalizedSearch)
            || meta.channel.toLowerCase().includes(normalizedSearch)
            || meta.family.toLowerCase().includes(normalizedSearch);
        const matchesFamily = customProxyModelFamilyFilter === 'Tất cả'
            || (customProxyModelFamilyFilter === 'Khác'
                ? !TRANSLATOR_PROXY_MODEL_PRIMARY_FAMILIES.includes(meta.family)
                : meta.family === customProxyModelFamilyFilter);
        return matchesSearch && matchesFamily;
    });

    if (!filteredModels.length) {
        const empty = document.createElement('div');
        empty.className = 'model-picker-empty';
        empty.textContent = 'Không có model khớp bộ lọc hiện tại.';
        picker.appendChild(empty);
        return;
    }

    groupTranslatorProxyModelsForDisplay(filteredModels, context).forEach((group) => {
        const groupElement = document.createElement('section');
        groupElement.className = 'model-picker-group';

        const groupHeader = document.createElement('div');
        groupHeader.className = 'model-picker-group__header';
        const groupTitle = document.createElement('span');
        groupTitle.textContent = group.channel;
        const groupCount = document.createElement('small');
        groupCount.textContent = `${group.models.length} model`;
        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(groupCount);
        groupElement.appendChild(groupHeader);

        group.families.forEach((familyGroup) => {
            const familyElement = document.createElement('div');
            familyElement.className = 'model-picker-family';

            const familyLabel = document.createElement('div');
            familyLabel.className = 'model-picker-family__label';
            familyLabel.textContent = familyGroup.family;
            familyElement.appendChild(familyLabel);

            familyGroup.models.forEach((model) => {
                const button = document.createElement('button');
                const isSelected = model.id === profile.defaultModel;
                button.type = 'button';
                button.className = `model-picker-item ${isSelected ? 'is-active' : ''}`;
                button.onclick = () => selectCustomProxyModel(model.id);
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', String(isSelected));

                const idText = document.createElement('span');
                idText.className = 'model-picker-item__id';
                idText.textContent = model.id;
                button.appendChild(idText);

                const badges = document.createElement('span');
                badges.className = 'model-picker-item__badges';
                appendModelPickerBadge(badges, model.family);
                appendModelPickerBadge(badges, model.channel, 'model-picker-badge--muted');
                const confidenceLabel = getProxyModelConfidenceLabel(model.confidence);
                if (confidenceLabel) {
                    appendModelPickerBadge(badges, confidenceLabel, 'model-picker-badge--warning');
                }
                button.appendChild(badges);
                familyElement.appendChild(button);
            });

            groupElement.appendChild(familyElement);
        });

        picker.appendChild(groupElement);
    });
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
    renderCustomProxyModelPicker(profile);
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

function getTranslatorRelayHeaders(upstreamKey) {
    const storyForgeToken = typeof getStoryForgeAccessToken === 'function'
        ? String(getStoryForgeAccessToken() || '').trim()
        : '';
    return {
        ...(storyForgeToken ? { 'Authorization': `Bearer ${storyForgeToken}` } : {}),
        'X-StoryForge-Upstream-Key': upstreamKey,
    };
}

function getProxyRequestHeaders(target, upstreamKey) {
    return target?.mode === 'relay'
        ? {
            'Content-Type': 'application/json',
            ...getTranslatorRelayHeaders(upstreamKey),
        }
        : {
            'Authorization': `Bearer ${upstreamKey}`,
            'Content-Type': 'application/json',
        };
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
        headers: getProxyRequestHeaders(target, key),
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
        const proxyError = typeof createProxyHttpError === 'function'
            ? createProxyHttpError(response.status, data, { model: profile.defaultModel, provider: 'Custom Proxy' })
            : new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
        const message = typeof formatTranslatorError === 'function' ? formatTranslatorError(proxyError) : proxyError.message;
        if (modelStatus) {
            modelStatus.textContent = `Không lấy được models Custom Proxy: ${message}`;
            modelStatus.className = 'model-fetch-status error';
        }
        showToast(`Không lấy được models Custom Proxy: ${message}`, 'error');
        return [];
    }

    const allModels = await mergeCustomProxyCatalogModels(profile, parseOpenAIModelIds(data));
    if (allModels.length === 0) {
        normalizeCustomProxyProfile({ models: [] });
        renderCustomProxyModelsDropdown();
        if (modelStatus) {
            modelStatus.textContent = 'Custom Proxy không trả về model hợp lệ. Bạn vẫn có thể nhập model thủ công.';
            modelStatus.className = 'model-fetch-status error';
        }
        return [];
    }

    const currentModel = String(profile.defaultModel || '').trim();
    const defaultModel = allModels.includes(currentModel) ? currentModel : allModels[0];
    normalizeCustomProxyProfile({
        models: allModels,
        defaultModel,
    });
    renderCustomProxyModelsDropdown();
    persistCustomProxySharedSettings(true);
    saveSettings();
    if (typeof renderTranslatorCustomProxyPresets === 'function') renderTranslatorCustomProxyPresets();

    if (modelStatus) {
        modelStatus.textContent = `Đã lấy ${allModels.length} model Custom Proxy.`;
        modelStatus.className = 'model-fetch-status success';
    }
    showToast(`Đã lấy ${allModels.length} model Custom Proxy.`, 'success');
    return allModels;
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
    if (typeof renderTranslatorCustomProxyPresets === 'function') renderTranslatorCustomProxyPresets();
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
            stream: false,
            max_tokens: 1000,
        };
        const response = await fetch(target.url, {
            method: 'POST',
            headers: getProxyRequestHeaders(target, key),
            body: JSON.stringify(target.mode === 'relay'
                ? {
                    action: 'chat',
                    baseUrl: target.profile.baseUrl,
                    chatCompletionsPath: target.path,
                    templateId: typeof getActiveTranslatorTemplateId === 'function' ? getActiveTranslatorTemplateId() : 'convert',
                    payload,
                }
                : payload),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const proxyError = typeof createProxyHttpError === 'function'
                ? createProxyHttpError(response.status, errorData, { model, provider: 'Custom Proxy' })
                : new Error(errorData?.error?.message || errorData?.error || `HTTP ${response.status}`);
            const message = typeof formatTranslatorError === 'function' ? formatTranslatorError(proxyError) : proxyError.message;
            if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">Không kết nối được Custom Proxy: ${escapeProxyHtml(message)}</p>`;
            return false;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '(không có nội dung)';
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="proxy-test-card success">
                    <strong>Kết nối Custom Proxy thành công.</strong>
                    <span>Model: ${escapeProxyHtml(data.model || model)}</span>
                    <span>Thời gian: ${escapeProxyHtml(elapsed)}s</span>
                    <span>Key: ...${escapeProxyHtml(key.slice(-6))}</span>
                    <p>${escapeProxyHtml(content.substring(0, 200))}</p>
                </div>`;
        }
        showToast(`Custom Proxy hoạt động. Thời gian phản hồi ${elapsed}s.`, 'success');
        return true;
    } catch (error) {
        const proxyError = error?.name === 'AbortError' && typeof createTranslatorError === 'function'
            ? createTranslatorError('PROXY_TIMEOUT', {
                provider: 'Custom Proxy',
                model,
                timeoutSeconds: 30,
                retryable: true,
            })
            : (typeof normalizeTranslatorError === 'function'
                ? normalizeTranslatorError(error, { provider: 'Custom Proxy', model })
                : error);
        const message = typeof formatTranslatorError === 'function'
            ? formatTranslatorError(proxyError)
            : (proxyError?.message || 'Lỗi mạng/CORS khi test Custom Proxy.');
        if (resultDiv) resultDiv.innerHTML = `<p style="color:#ef4444;">${escapeProxyHtml(message)}</p>`;
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
    renderAgProxyEndpointPreview();
    renderProxyKeysList();
    renderCustomProxyPreviews();
    renderCustomProxyKeysList();
    renderCustomProxyModelsDropdown();
}
