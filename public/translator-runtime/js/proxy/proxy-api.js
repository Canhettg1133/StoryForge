/**
 * Novel Translator Pro - Proxy API UI Functions
 * Quản lý UI và chức năng cho Proxy API (BeiJiXingXing, OpenRouter...)
 */

// ============================================
// TOGGLE PROXY MODE
// ============================================
function toggleProxyMode() {
    useProxy = document.getElementById('useProxyToggle').checked;
    document.getElementById('proxySettings').style.display = useProxy ? 'block' : 'none';
    document.getElementById('proxyStatus').textContent = useProxy ? 'Bật' : 'Tắt';
    document.getElementById('proxyStatus').style.background = useProxy ? '#10b981' : '';

    if (useProxy) {
        // Tắt Ollama nếu đang bật
        if (typeof useOllama !== 'undefined' && useOllama) {
            useOllama = false;
            const ollamaToggle = document.getElementById('useOllamaToggle');
            if (ollamaToggle) ollamaToggle.checked = false;
            document.getElementById('ollamaSettings').style.display = 'none';
            document.getElementById('ollamaStatus').textContent = 'Tắt';
            document.getElementById('ollamaStatus').style.background = '';
        }
        showToast('✅ Đã bật Proxy API mode! Hệ thống sẽ gọi qua proxy thay vì Gemini Direct.', 'success');
    } else {
        showToast('🔄 Đã tắt Proxy, sử dụng Gemini Direct.', 'info');
    }

    saveSettings();
    renderProxyModelsDropdown();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

// ============================================
// PROXY API KEYS MANAGEMENT (Multi-key)
// ============================================
function addProxyKey() {
    const input = document.getElementById('newProxyKeyInput');
    const key = input.value.trim();

    if (!key) {
        showToast('Vui lòng nhập Proxy API Key!', 'warning');
        return;
    }

    if (!key.startsWith('sk-')) {
        showToast('Proxy Key phải bắt đầu bằng "sk-"', 'error');
        return;
    }

    if (proxyApiKeys.includes(key)) {
        showToast('Key này đã tồn tại!', 'error');
        input.value = '';
        return;
    }

    proxyApiKeys.push(key);
    // Also set legacy single key (backward compat)
    if (!proxyApiKey) proxyApiKey = key;
    input.value = '';
    renderProxyKeysList();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
    showToast(`✅ Đã thêm Proxy Key! (${proxyApiKeys.length} keys → parallel x${proxyApiKeys.length})`, 'success');
}

function removeProxyKey(index) {
    proxyApiKeys.splice(index, 1);
    // Update legacy single key
    proxyApiKey = proxyApiKeys.length > 0 ? proxyApiKeys[0] : '';
    renderProxyKeysList();
    saveSettings();
    showToast('Đã xóa Proxy Key!', 'info');
}

function renderProxyKeysList() {
    const container = document.getElementById('proxyKeysList');
    if (!container) return;

    const count = proxyApiKeys.length;
    const countBadge = document.getElementById('proxyKeyCount');
    if (countBadge) {
        countBadge.textContent = `${count} key${count > 1 ? 's' : ''} → parallel x${count}`;
        countBadge.style.background = count > 1 ? 'var(--success)' : (count === 1 ? 'var(--accent-primary)' : 'var(--danger)');
    }

    if (count === 0) {
        container.innerHTML = '<p class="empty-message">Chưa có key nào. Thêm ít nhất 1 key để dùng proxy.</p>';
        return;
    }

    container.innerHTML = proxyApiKeys.map((key, index) => {
        const keyLabel = String.fromCharCode(65 + index); // A, B, C, D...
        return `
        <div class="api-key-item">
            <span class="key-index" style="background: var(--accent-primary)">🔑${keyLabel}</span>
            <span class="key-value">${maskProxyKey(key)}</span>
            <button class="remove-btn" onclick="removeProxyKey(${index})" title="Xóa">🗑️</button>
        </div>
    `}).join('');

    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

function maskProxyKey(key) {
    if (key.length <= 12) return key;
    return key.substring(0, 6) + '••••••••' + key.substring(key.length - 6);
}

// ============================================
// UPDATE PROXY CONFIG (legacy - for base URL)
// ============================================
function updateProxyConfig() {
    proxyBaseUrl = document.getElementById('proxyBaseUrlInput').value.trim();
    saveSettings();
    if (typeof updateWorkspaceToolbar === 'function') updateWorkspaceToolbar();
}

// ============================================
// SELECT PROXY MODEL
// ============================================
function selectProxyModel() {
    const select = document.getElementById('proxyModelSelect');
    if (select.value) {
        proxyModel = select.value;
        saveSettings();
        showToast(`Đã chọn model: ${proxyModel}`, 'success');
    }
}

// ============================================
// RENDER PROXY MODELS DROPDOWN
// ============================================
function renderProxyModelsDropdown() {
    const select = document.getElementById('proxyModelSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Chọn model --</option>';

    // Group models by group property
    const groups = {};
    PROXY_MODELS.forEach(m => {
        const groupName = m.group || 'Other';
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(m);
    });

    for (const [groupName, models] of Object.entries(groups)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupName;
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = m.label;
            if (m.id === proxyModel) option.selected = true;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    }
}

// ============================================
// TEST PROXY CONNECTION
// ============================================
async function testProxyConnection() {
    const resultDiv = document.getElementById('proxyTestResult');
    const testKey = proxyApiKeys.length > 0 ? proxyApiKeys[0] : proxyApiKey;

    resultDiv.innerHTML = '<p style="color:#f59e0b;">⏳ Đang test kết nối proxy...</p>';

    if (!testKey) {
        resultDiv.innerHTML = '<p style="color:#ef4444;">❌ Chưa nhập API Key!</p>';
        return;
    }

    const startTime = Date.now();

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch(proxyBaseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: proxyModel,
                messages: [{ role: 'user', content: 'Xin chào! Trả lời ngắn gọn 1 câu.' }],
                temperature: 0.5,
                max_tokens: 100
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
            resultDiv.innerHTML = `<p style="color:#ef4444;">❌ Lỗi ${response.status}: ${errorMsg}</p>
                <p style="color:#888;font-size:12px;">Thời gian: ${elapsed}s</p>`;
            return;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '(no content)';
        const model = data.model || proxyModel;

        resultDiv.innerHTML = `
            <div style="background:rgba(16,185,129,0.1);border:1px solid #10b981;border-radius:8px;padding:12px;">
                <p style="color:#10b981;font-weight:600;">✅ Kết nối thành công!</p>
                <p style="color:#ccc;font-size:13px;">
                    <strong>Model:</strong> ${model}<br>
                    <strong>Thời gian:</strong> ${elapsed}s<br>
                    <strong>Key:</strong> ...${testKey.slice(-6)}<br>
                    <strong>Tổng keys:</strong> ${proxyApiKeys.length} (parallel x${proxyApiKeys.length})<br>
                    <strong>Response:</strong> ${content.substring(0, 200)}
                </p>
            </div>`;

        showToast(`✅ Proxy hoạt động! (${elapsed}s)`, 'success');
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (error.name === 'AbortError') {
            resultDiv.innerHTML = `<p style="color:#ef4444;">❌ Timeout sau 30s! Server proxy quá chậm.</p>`;
        } else {
            resultDiv.innerHTML = `<p style="color:#ef4444;">❌ Lỗi: ${error.message}</p>
                <p style="color:#888;font-size:12px;">Thời gian: ${elapsed}s</p>`;
        }
    }
}

// ============================================
// INIT PROXY UI
// ============================================
function initProxyUI() {
    renderProxyModelsDropdown();
    renderProxyKeysList();

    // Restore saved state
    if (useProxy) {
        document.getElementById('useProxyToggle').checked = true;
        document.getElementById('proxySettings').style.display = 'block';
        document.getElementById('proxyStatus').textContent = 'Bật';
        document.getElementById('proxyStatus').style.background = '#10b981';
    }
    if (proxyBaseUrl) {
        document.getElementById('proxyBaseUrlInput').value = proxyBaseUrl;
    }
}
