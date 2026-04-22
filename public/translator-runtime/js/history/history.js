/**
 * Novel Translator Pro - History Management
 * Quản lý lịch sử dịch
 */

// ============================================
// HISTORY MANAGEMENT
// ============================================
const HISTORY_STORAGE_KEY = 'novelTranslatorHistory';
const HISTORY_DB_NAME = 'NovelTranslatorDB';
const HISTORY_DB_VERSION = 1;
const HISTORY_DB_STORE = 'keyValue';
const HISTORY_DB_RECORD_KEY = 'translationHistory';
let historyDbPromise = null;
let historyWriteQueue = Promise.resolve();
let lastHistoryProgressRenderAt = 0;
const HISTORY_PROGRESS_RENDER_INTERVAL_MS = 2000;

function normalizeHistoryItems(items) {
    return Array.isArray(items) ? items.map(item => ({
        ...item,
        translatedChunksData: Array.isArray(item.translatedChunksData) ? item.translatedChunksData : null,
        chunkSizeUsed: Number.isFinite(parseInt(item.chunkSizeUsed, 10)) ? parseInt(item.chunkSizeUsed, 10) : null
    })) : [];
}

function hasIndexedDBHistory() {
    return typeof indexedDB !== 'undefined';
}

function openHistoryDB() {
    if (!hasIndexedDBHistory()) {
        return Promise.reject(new Error('IndexedDB not supported'));
    }
    if (historyDbPromise) {
        return historyDbPromise;
    }

    historyDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HISTORY_DB_STORE)) {
                db.createObjectStore(HISTORY_DB_STORE, { keyPath: 'key' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open history DB'));
    });

    return historyDbPromise;
}

function readHistoryFromIndexedDB() {
    if (!hasIndexedDBHistory()) {
        return Promise.resolve({ found: false, data: [] });
    }

    return openHistoryDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_DB_STORE, 'readonly');
        const store = tx.objectStore(HISTORY_DB_STORE);
        const req = store.get(HISTORY_DB_RECORD_KEY);

        req.onsuccess = () => {
            const value = req.result?.value;
            if (Array.isArray(value)) {
                resolve({ found: true, data: value });
            } else {
                resolve({ found: false, data: [] });
            }
        };
        req.onerror = () => reject(req.error || new Error('Failed to read history DB'));
    })).catch(err => {
        console.warn('[History] IndexedDB read failed:', err);
        return { found: false, data: [] };
    });
}

function writeHistoryToIndexedDB(data) {
    if (!hasIndexedDBHistory()) {
        return Promise.resolve(false);
    }

    return openHistoryDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_DB_STORE, 'readwrite');
        const store = tx.objectStore(HISTORY_DB_STORE);
        store.put({
            key: HISTORY_DB_RECORD_KEY,
            value: data,
            updatedAt: new Date().toISOString()
        });

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Failed to write history DB'));
        tx.onabort = () => reject(tx.error || new Error('History DB transaction aborted'));
    })).catch(err => {
        console.warn('[History] IndexedDB write failed:', err);
        return false;
    });
}

function persistHistoryFallbackToLocalStorage(saveData) {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(saveData));
        return;
    } catch (e) {
        console.error('Error saving history (localStorage fallback):', e);

        if (e.name !== 'QuotaExceededError') {
            return;
        }

        translationHistory = translationHistory.slice(-5);
        try {
            const lightHistory = translationHistory.map(item => ({
                ...item,
                originalText: item.originalText ? item.originalText.substring(0, 2000) : '',
                translatedText: item.translatedText ? item.translatedText.substring(0, 2000) : '',
                chunks: [],
                translatedChunksData: null
            }));
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(lightHistory));
            showToast('Đã xóa bớt lịch sử cũ để tiết kiệm bộ nhớ.', 'warning');
        } catch (e2) {
            localStorage.removeItem(HISTORY_STORAGE_KEY);
            translationHistory = [];
            showToast('Đã xóa lịch sử để giải phóng bộ nhớ.', 'warning');
        }
    }
}

async function loadHistory() {
    translationHistory = [];

    const dbResult = await readHistoryFromIndexedDB();
    if (dbResult.found) {
        translationHistory = normalizeHistoryItems(dbResult.data);
        return;
    }

    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!saved) {
        return;
    }

    try {
        const parsed = JSON.parse(saved);
        translationHistory = normalizeHistoryItems(parsed);

        const migrated = await writeHistoryToIndexedDB(translationHistory);
        if (migrated) {
            localStorage.removeItem(HISTORY_STORAGE_KEY);
        }
    } catch (e) {
        console.error('Error loading history:', e);
        translationHistory = [];
    }
}

function saveHistory() {
    if (translationHistory.length > 20) {
        translationHistory = translationHistory.slice(-20);
    }

    const saveData = translationHistory.map(item => {
        const keepResumeData = !item.isComplete &&
            Array.isArray(item.translatedChunksData) &&
            item.translatedChunksData.length === item.totalChunks;

        return {
            ...item,
            chunks: [],
            translatedChunksData: keepResumeData ? item.translatedChunksData : null
        };
    });

    historyWriteQueue = historyWriteQueue
        .catch(() => { })
        .then(async () => {
            const savedToIndexedDB = await writeHistoryToIndexedDB(saveData);
            if (!savedToIndexedDB) {
                persistHistoryFallbackToLocalStorage(saveData);
            }
        });
}

function addToHistory(name, originalText, translatedText, chunks, completedCount, totalCount, translatedChunksSnapshot = null, chunkSizeUsed = null) {
    const normalizedChunkData = Array.isArray(translatedChunksSnapshot)
        ? translatedChunksSnapshot.slice(0, totalCount).map(chunk => typeof chunk === 'string' ? chunk : null)
        : null;

    const historyItem = {
        id: Date.now().toString(),
        name: name,
        date: new Date().toISOString(),
        originalText: originalText,
        translatedText: translatedText,
        chunks: chunks,
        completedChunks: completedCount,
        totalChunks: totalCount,
        charCount: originalText.length,
        isComplete: completedCount >= totalCount,
        translatedChunksData: completedCount < totalCount ? normalizedChunkData : null,
        chunkSizeUsed: Number.isFinite(parseInt(chunkSizeUsed, 10))
            ? parseInt(chunkSizeUsed, 10)
            : (Number.isFinite(parseInt(document.getElementById('chunkSize')?.value, 10))
                ? parseInt(document.getElementById('chunkSize')?.value, 10)
                : null)
    };

    if (currentHistoryId) {
        const index = translationHistory.findIndex(h => h.id === currentHistoryId);
        if (index !== -1) {
            historyItem.id = currentHistoryId;
            translationHistory[index] = historyItem;
        } else {
            translationHistory.push(historyItem);
        }
        currentHistoryId = null;
    } else {
        translationHistory.push(historyItem);
    }

    saveHistory();
    renderHistoryList();
    return historyItem.id;
}

function updateHistoryProgress(id, translatedText, chunks, completedCount, translatedChunksSnapshot = null, chunkSizeUsed = null) {
    const index = translationHistory.findIndex(h => h.id === id);
    if (index !== -1) {
        translationHistory[index].translatedText = translatedText;
        translationHistory[index].chunks = chunks;
        translationHistory[index].completedChunks = completedCount;
        translationHistory[index].isComplete = completedCount >= translationHistory[index].totalChunks;
        translationHistory[index].translatedChunksData =
            translationHistory[index].isComplete ? null :
                (Array.isArray(translatedChunksSnapshot)
                    ? translatedChunksSnapshot
                        .slice(0, translationHistory[index].totalChunks)
                        .map(chunk => typeof chunk === 'string' ? chunk : null)
                    : translationHistory[index].translatedChunksData || null);
        if (Number.isFinite(parseInt(chunkSizeUsed, 10))) {
            translationHistory[index].chunkSizeUsed = parseInt(chunkSizeUsed, 10);
        } else if (!Number.isFinite(parseInt(translationHistory[index].chunkSizeUsed, 10))) {
            const currentChunkSize = parseInt(document.getElementById('chunkSize')?.value, 10);
            translationHistory[index].chunkSizeUsed = Number.isFinite(currentChunkSize) ? currentChunkSize : null;
        }
        translationHistory[index].date = new Date().toISOString();
        saveHistory();
        renderHistoryListForProgress();
    }
}

function renderHistoryListForProgress() {
    if (typeof document === 'undefined') return;
    const historyPanel = document.querySelector('.history-panel');
    if (historyPanel && historyPanel.style.display === 'none') return;

    const now = Date.now();
    if (now - lastHistoryProgressRenderAt < HISTORY_PROGRESS_RENDER_INTERVAL_MS) return;
    lastHistoryProgressRenderAt = now;
    renderHistoryList();
}

function renderHistoryList() {
    const container = document.getElementById('historyList');
    if (!container) return; // Mobile might not have this element
    const countBadge = document.getElementById('historyCount');

    if (countBadge) countBadge.textContent = `${translationHistory.length} bản`;

    if (translationHistory.length === 0) {
        container.innerHTML = '<p class="empty-message">Chưa có lịch sử dịch nào.</p>';
        return;
    }

    const sorted = [...translationHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

    container.innerHTML = sorted.map(item => {
        const progress = Math.round((item.completedChunks / item.totalChunks) * 100);
        const statusIcon = item.isComplete ? '✅' : '⏳';
        const date = new Date(item.date);
        const dateStr = date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="history-item" data-id="${item.id}">
                <span class="status-icon">${statusIcon}</span>
                <div class="history-info">
                    <div class="history-name">${escapeHtml(item.name)}</div>
                    <div class="history-meta">
                        <span>📅 ${dateStr}</span>
                        <span>📝 ${formatNumber(item.charCount)} chữ</span>
                        <span>📦 ${item.completedChunks}/${item.totalChunks} chunks</span>
                    </div>
                </div>
                <div class="history-progress">
                    <div class="history-progress-fill ${item.isComplete ? 'complete' : ''}" style="width: ${progress}%"></div>
                </div>
                <div class="history-btns">
                    ${!item.isComplete ? `<button onclick="continueFromHistory('${item.id}')" title="Tiếp tục dịch">▶️</button>` : ''}
                    <button onclick="loadFromHistory('${item.id}')" title="Xem/Tải về">👁️</button>
                    <button onclick="deleteFromHistory('${item.id}')" class="btn-delete" title="Xóa">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

function continueFromHistory(id) {
    const item = translationHistory.find(h => h.id === id);
    if (!item) {
        showToast('Không tìm thấy lịch sử!', 'error');
        return;
    }

    if (item.isComplete) {
        showToast('Bản dịch này đã hoàn thành!', 'info');
        loadFromHistory(id);
        return;
    }

    if (isTranslating) {
        showToast('Đang có bản dịch khác đang chạy!', 'warning');
        return;
    }

    document.getElementById('originalText').value = item.originalText;
    originalFileName = item.name;

    // Restore chunk size used by this saved run to keep chunk boundaries stable.
    if (Number.isFinite(parseInt(item.chunkSizeUsed, 10))) {
        const chunkSizeInput = document.getElementById('chunkSize');
        if (chunkSizeInput) {
            chunkSizeInput.value = String(parseInt(item.chunkSizeUsed, 10));
        }
    }

    currentHistoryId = id;

    // FIX: chunks bị xóa khi lưu, cần re-chunk từ originalText
    originalChunks = item.chunks && item.chunks.length > 0
        ? item.chunks
        : (typeof rechunkText === 'function' ? rechunkText(item.originalText) : []);

    totalChunksCount = item.totalChunks || 0;
    let canResumePrecisely = false;

    // Preferred path: exact per-chunk data (new format)
    if (Array.isArray(item.translatedChunksData) && item.translatedChunksData.length === totalChunksCount) {
        translatedChunks = item.translatedChunksData.map(chunk => typeof chunk === 'string' ? chunk : null);
        canResumePrecisely = true;
    } else {
        // Legacy entries do not have precise per-chunk snapshots.
        // Do not try to split by "\n\n" because that corrupts chunk mapping.
        translatedChunks = new Array(totalChunksCount).fill(null);
    }

    completedChunks = translatedChunks.filter(chunk => isChunkSuccessfullyTranslated(chunk)).length;

    // Show current partial output for user visibility
    document.getElementById('translatedText').value = translatedChunks
        .map((chunk, idx) => chunk !== null ? chunk : `[⏳ Chưa dịch chunk ${idx + 1}]`)
        .join('\n\n');

    updateStats();
    if (!canResumePrecisely) {
        // Avoid overwriting old legacy history with a wrong "resume" state.
        currentHistoryId = null;
        showToast('Bản lưu cũ không có dữ liệu chunk chi tiết, sẽ tạo lượt dịch mới để tránh sai lệch.', 'warning');
    } else {
        showToast(`Đã tải "${item.name}" - Tiếp tục từ chunk ${completedChunks}/${totalChunksCount}`, 'success');
    }
    document.getElementById('translateBtn').scrollIntoView({ behavior: 'smooth' });
}

function loadFromHistory(id) {
    const item = translationHistory.find(h => h.id === id);
    if (!item) {
        showToast('Không tìm thấy lịch sử!', 'error');
        return;
    }

    document.getElementById('originalText').value = item.originalText;
    originalFileName = item.name;

    document.getElementById('translatedText').value = item.translatedText || '';
    document.getElementById('resultSection').style.display = 'block';

    updateStats();
    showToast(`Đã tải "${item.name}"`, 'success');
    document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
}

function deleteFromHistory(id) {
    if (!confirm('Bạn có chắc muốn xóa bản dịch này?')) {
        return;
    }

    translationHistory = translationHistory.filter(h => h.id !== id);
    saveHistory();
    renderHistoryList();
    showToast('Đã xóa khỏi lịch sử!', 'info');
}

function clearAllHistory() {
    if (translationHistory.length === 0) {
        showToast('Lịch sử đã trống!', 'info');
        return;
    }

    if (!confirm(`Bạn có chắc muốn xóa tất cả ${translationHistory.length} bản dịch?`)) {
        return;
    }

    translationHistory = [];
    saveHistory();
    renderHistoryList();
    showToast('Đã xóa tất cả lịch sử!', 'success');
}

function exportHistory() {
    if (translationHistory.length === 0) {
        showToast('Không có lịch sử để xuất!', 'warning');
        return;
    }

    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        count: translationHistory.length,
        history: translationHistory
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novel_translator_history_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Đã xuất ${translationHistory.length} bản dịch!`, 'success');
}

function importHistory(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.history || !Array.isArray(data.history)) {
                throw new Error('Invalid format');
            }

            const importCount = data.history.length;
            let newCount = 0;

            // FIX: dùng index để tránh trùng ID khi Date.now() giống nhau
            data.history.forEach((item, index) => {
                const exists = translationHistory.some(h =>
                    h.id === item.id ||
                    (h.name === item.name && h.date === item.date)
                );

                if (!exists) {
                    item.id = `${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`;
                    translationHistory.push(item);
                    newCount++;
                }
            });

            saveHistory();
            renderHistoryList();
            showToast(`Đã nhập ${newCount}/${importCount} bản dịch mới!`, 'success');

        } catch (error) {
            console.error('Import error:', error);
            showToast('File không hợp lệ!', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    return num.toLocaleString('vi-VN');
}

function isChunkSuccessfullyTranslated(chunkText) {
    if (typeof chunkText !== 'string') return false;

    const text = chunkText.trim();
    if (!text) return false;

    // FIX: Dùng ký tự Unicode đúng thay vì chuỗi bị mojibake
    if (text.startsWith('[LỖI CHUNK')) return false;
    if (/^\[❌\s*Chunk\s+\d+\s+thất bại\]/i.test(text)) return false;
    if (text.includes('CẦN DỊCH THỦ CÔNG')) return false;
    if (/^\[⏳\s*Chưa dịch chunk/i.test(text)) return false;

    return true;
}
