/**
 * Novel Translator Pro - RPD Tracker
 * Theo dõi RPD (Requests Per Day) cho từng cặp (model, key)
 * 
 * Mỗi model có RPD riêng biệt (mặc định 20/ngày cho free tier)
 * RPD reset lúc midnight Pacific Time (2PM giờ Việt Nam)
 */

// ============================================
// RPD CONSTANTS
// ============================================
const RPD_LIMIT_DEFAULT = 20; // Free tier: 20 RPD per model per key
const RPD_STORAGE_KEY = 'novelTranslatorRPD';

// ============================================
// RPD DATA STRUCTURE
// ============================================
// {
//   date: "2026-02-13",  // Pacific date
//   pairs: {
//     "gemini-2.5-flash|0": { used: 5, limit: 20 },
//     "gemini-2.5-flash|1": { used: 3, limit: 20 },
//     ...
//   }
// }
let rpdData = { date: '', pairs: {} };

// ============================================
// PACIFIC TIME HELPERS
// ============================================
function getPacificDateString() {
    // RPD resets at midnight Pacific Time
    const now = new Date();
    const pacificDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const year = pacificDate.getFullYear();
    const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
    const day = String(pacificDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getNextPacificMidnight() {
    // Tính thời gian còn lại đến midnight Pacific
    const now = new Date();
    const pacificNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const pacificMidnight = new Date(pacificNow);
    pacificMidnight.setDate(pacificMidnight.getDate() + 1);
    pacificMidnight.setHours(0, 0, 0, 0);

    // Tính difference (approximate)
    const diffMs = pacificMidnight.getTime() - pacificNow.getTime();
    return diffMs;
}

function formatTimeRemaining(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

// ============================================
// RPD PERSISTENCE (localStorage)
// ============================================
function loadRPDData() {
    try {
        const saved = localStorage.getItem(RPD_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            const today = getPacificDateString();

            if (parsed.date === today) {
                rpdData = parsed;
                console.log(`[RPD] Loaded data for ${today}: ${Object.keys(rpdData.pairs).length} pairs tracked`);
                return;
            } else {
                console.log(`[RPD] New day (${today}), resetting RPD counters (was ${parsed.date})`);
            }
        }
    } catch (e) {
        console.error('[RPD] Error loading data:', e);
    }

    // Reset for new day
    rpdData = { date: getPacificDateString(), pairs: {} };
    saveRPDData();
}

function saveRPDData() {
    try {
        localStorage.setItem(RPD_STORAGE_KEY, JSON.stringify(rpdData));
    } catch (e) {
        console.error('[RPD] Error saving data:', e);
    }
}

// ============================================
// RPD TRACKING FUNCTIONS
// ============================================
function getRPDPairId(modelName, keyIndex) {
    return `${modelName}|${keyIndex}`;
}

function getRPDLimit(modelName) {
    // Lấy RPD limit từ model config nếu có, mặc định 20
    const model = GEMINI_MODELS.find(m => m.name === modelName);
    return (model && model.rpd) ? model.rpd : RPD_LIMIT_DEFAULT;
}

/**
 * Ghi nhận 1 request đã gửi (gọi SAU khi gửi request, bất kể thành công hay thất bại)
 */
function recordRPDRequest(modelName, keyIndex) {
    // Auto-reset nếu ngày mới
    const today = getPacificDateString();
    if (rpdData.date !== today) {
        console.log(`[RPD] Day changed, resetting counters`);
        rpdData = { date: today, pairs: {} };
    }

    const pairId = getRPDPairId(modelName, keyIndex);
    if (!rpdData.pairs[pairId]) {
        rpdData.pairs[pairId] = { used: 0, limit: getRPDLimit(modelName) };
    }
    rpdData.pairs[pairId].used++;
    saveRPDData();

    const pair = rpdData.pairs[pairId];
    if (pair.used >= pair.limit) {
        console.warn(`[RPD] ⚠️ ${modelName} + Key ${keyIndex + 1}: Đã hết RPD! (${pair.used}/${pair.limit})`);
    } else if (pair.used >= pair.limit * 0.8) {
        console.warn(`[RPD] ⚡ ${modelName} + Key ${keyIndex + 1}: Sắp hết RPD (${pair.used}/${pair.limit})`);
    }
}

/**
 * Kiểm tra một cặp (model, key) còn RPD không
 */
function isPairRPDAvailable(modelName, keyIndex) {
    // Auto-reset nếu ngày mới
    const today = getPacificDateString();
    if (rpdData.date !== today) {
        rpdData = { date: today, pairs: {} };
        saveRPDData();
        return true;
    }

    const pairId = getRPDPairId(modelName, keyIndex);
    if (!rpdData.pairs[pairId]) return true;

    return rpdData.pairs[pairId].used < rpdData.pairs[pairId].limit;
}

/**
 * Lấy số RPD còn lại của 1 cặp
 */
function getRPDRemaining(modelName, keyIndex) {
    const today = getPacificDateString();
    if (rpdData.date !== today) return getRPDLimit(modelName);

    const pairId = getRPDPairId(modelName, keyIndex);
    if (!rpdData.pairs[pairId]) return getRPDLimit(modelName);

    return Math.max(0, rpdData.pairs[pairId].limit - rpdData.pairs[pairId].used);
}

/**
 * Lấy số RPD đã dùng của 1 cặp
 */
function getRPDUsed(modelName, keyIndex) {
    const today = getPacificDateString();
    if (rpdData.date !== today) return 0;

    const pairId = getRPDPairId(modelName, keyIndex);
    if (!rpdData.pairs[pairId]) return 0;

    return rpdData.pairs[pairId].used;
}

// ============================================
// RPD STATISTICS
// ============================================

/**
 * Lấy thống kê tổng hợp RPD
 */
function getRPDStats() {
    const activeModels = typeof getActiveModels === 'function' ? getActiveModels() : GEMINI_MODELS;
    const keyCount = apiKeys.length;

    let totalUsed = 0;
    let totalLimit = 0;
    let exhaustedPairs = 0;
    let totalPairs = 0;

    for (let k = 0; k < keyCount; k++) {
        for (const model of activeModels) {
            totalPairs++;
            const used = getRPDUsed(model.name, k);
            const limit = getRPDLimit(model.name);
            totalUsed += used;
            totalLimit += limit;
            if (used >= limit) exhaustedPairs++;
        }
    }

    const availablePairs = totalPairs - exhaustedPairs;
    const remainingRPD = totalLimit - totalUsed;
    const usagePercent = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;

    return {
        totalUsed,
        totalLimit,
        remainingRPD,
        usagePercent,
        totalPairs,
        availablePairs,
        exhaustedPairs,
        resetIn: formatTimeRemaining(getNextPacificMidnight())
    };
}

/**
 * Lấy thống kê RPD theo từng key
 */
function getRPDByKey() {
    const activeModels = typeof getActiveModels === 'function' ? getActiveModels() : GEMINI_MODELS;
    const result = [];

    for (let k = 0; k < apiKeys.length; k++) {
        const keyData = {
            keyIndex: k,
            models: [],
            totalUsed: 0,
            totalLimit: 0,
            isExhausted: true
        };

        for (const model of activeModels) {
            const used = getRPDUsed(model.name, k);
            const limit = getRPDLimit(model.name);
            const remaining = Math.max(0, limit - used);

            keyData.models.push({
                name: model.name,
                shortName: model.name.replace('gemini-', '').replace('-preview', ''),
                used,
                limit,
                remaining,
                exhausted: used >= limit
            });

            keyData.totalUsed += used;
            keyData.totalLimit += limit;
            if (remaining > 0) keyData.isExhausted = false;
        }

        result.push(keyData);
    }

    return result;
}

// ============================================
// RPD UI RENDERING
// ============================================

/**
 * Render RPD Dashboard vào container
 */
function renderRPDDashboard() {
    const container = document.getElementById('rpdDashboard');
    if (!container) return;

    if (apiKeys.length === 0) {
        container.innerHTML = '<p class="empty-message">Thêm API key để xem RPD.</p>';
        return;
    }

    const stats = getRPDStats();
    const byKey = getRPDByKey();

    // Color based on usage
    let usageColor = '#10b981'; // green
    if (stats.usagePercent >= 80) usageColor = '#ef4444'; // red
    else if (stats.usagePercent >= 50) usageColor = '#f59e0b'; // yellow

    let html = `
        <div class="rpd-summary">
            <div class="rpd-summary-bar">
                <div class="rpd-bar-track">
                    <div class="rpd-bar-fill" style="width: ${stats.usagePercent}%; background: ${usageColor};"></div>
                </div>
                <div class="rpd-summary-text">
                    <span style="color: ${usageColor}; font-weight: 600;">
                        ${stats.totalUsed} / ${stats.totalLimit} RPD
                    </span>
                    <span style="color: #888; font-size: 12px;">
                        (còn ${stats.remainingRPD} | Reset: ${stats.resetIn})
                    </span>
                </div>
            </div>
            <div class="rpd-summary-info">
                <span class="rpd-info-item">✅ ${stats.availablePairs} cặp khả dụng</span>
                ${stats.exhaustedPairs > 0 ? `<span class="rpd-info-item" style="color:#ef4444;">❌ ${stats.exhaustedPairs} cặp hết quota</span>` : ''}
            </div>
        </div>

        <div class="rpd-key-list">
    `;

    for (const keyData of byKey) {
        const keyPercent = keyData.totalLimit > 0 ? Math.round((keyData.totalUsed / keyData.totalLimit) * 100) : 0;
        let keyColor = '#10b981';
        if (keyPercent >= 80) keyColor = '#ef4444';
        else if (keyPercent >= 50) keyColor = '#f59e0b';

        html += `
            <div class="rpd-key-row ${keyData.isExhausted ? 'rpd-exhausted' : ''}">
                <div class="rpd-key-header">
                    <span class="rpd-key-index" style="background: ${keyColor}">K${keyData.keyIndex + 1}</span>
                    <div class="rpd-models-bars">
        `;

        for (const m of keyData.models) {
            const mPercent = m.limit > 0 ? Math.round((m.used / m.limit) * 100) : 0;
            let mColor = '#10b981';
            if (mPercent >= 100) mColor = '#ef4444';
            else if (mPercent >= 80) mColor = '#f59e0b';
            else if (mPercent >= 50) mColor = '#3b82f6';

            html += `
                <div class="rpd-model-badge" title="${m.name}: ${m.used}/${m.limit} RPD">
                    <span class="rpd-model-name">${m.shortName}</span>
                    <div class="rpd-mini-bar">
                        <div class="rpd-mini-fill" style="width:${mPercent}%; background:${mColor};"></div>
                    </div>
                    <span class="rpd-model-count" style="color:${mColor}">${m.remaining}</span>
                </div>
            `;
        }

        html += `
                    </div>
                </div>
            </div>
        `;
    }

    html += `</div>`;

    container.innerHTML = html;

    // Update badge
    const badge = document.getElementById('rpdBadge');
    if (badge) {
        badge.textContent = `${stats.remainingRPD} còn lại`;
        badge.style.background = usageColor;
    }
}

// ============================================
// RPD MANAGEMENT
// ============================================

/**
 * Reset RPD data (manual)
 */
function resetRPDData() {
    if (!confirm('Reset bộ đếm RPD? (Chỉ reset bộ đếm nội bộ, không ảnh hưởng quota thật của Google)')) return;
    rpdData = { date: getPacificDateString(), pairs: {} };
    saveRPDData();
    renderRPDDashboard();
    showToast('Đã reset bộ đếm RPD.', 'success');
    console.log('[RPD] Manual reset completed');
}

/**
 * Đánh dấu 1 cặp đã hết RPD (khi nhận 429 và nghi ngờ hết RPD)
 */
function markPairRPDExhausted(modelName, keyIndex) {
    const pairId = getRPDPairId(modelName, keyIndex);
    const limit = getRPDLimit(modelName);
    if (!rpdData.pairs[pairId]) {
        rpdData.pairs[pairId] = { used: limit, limit: limit };
    } else {
        rpdData.pairs[pairId].used = rpdData.pairs[pairId].limit;
    }
    saveRPDData();
    console.warn(`[RPD] Marked ${modelName} + Key ${keyIndex + 1} as EXHAUSTED`);
}

// ============================================
// INIT
// ============================================
function initRPDTracker() {
    loadRPDData();
    console.log('[RPD] Tracker initialized');
}
