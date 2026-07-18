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

function createHistoryId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `history-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeHistoryInteger(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed)));
}

function normalizeHistoryString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function normalizeHistoryDate(value) {
    const timestamp = Date.parse(normalizeHistoryString(value));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function normalizeHistoryId(value, regenerateIds) {
    const normalized = normalizeHistoryString(value).trim();
    if (!regenerateIds && /^[A-Za-z0-9._:-]{1,160}$/u.test(normalized)) {
        return normalized;
    }
    return createHistoryId();
}

function normalizeHistoryItems(items, options = {}) {
    const regenerateIds = Boolean(options.regenerateIds);
    if (!Array.isArray(items)) return [];

    return items
        .filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
            const originalText = normalizeHistoryString(item.originalText);
            const totalChunks = normalizeHistoryInteger(item.totalChunks);
            const completedChunks = Math.min(normalizeHistoryInteger(item.completedChunks), totalChunks);
            const translatedChunksData = Array.isArray(item.translatedChunksData)
                ? item.translatedChunksData
                    .slice(0, totalChunks)
                    .map(chunk => typeof chunk === 'string' ? chunk : null)
                : null;
            const chunks = Array.isArray(item.chunks)
                ? item.chunks.slice(0, totalChunks).filter(chunk => typeof chunk === 'string')
                : [];

            return {
                id: normalizeHistoryId(item.id, regenerateIds),
                name: normalizeHistoryString(item.name, 'translated_novel.txt'),
                date: normalizeHistoryDate(item.date),
                originalText,
                translatedText: normalizeHistoryString(item.translatedText),
                chunks,
                completedChunks,
                totalChunks,
                charCount: normalizeHistoryInteger(item.charCount, originalText.length),
                isComplete: item.isComplete === true || (totalChunks > 0 && completedChunks >= totalChunks),
                translatedChunksData,
                chunkSizeUsed: item.chunkSizeUsed == null ? null : normalizeHistoryInteger(item.chunkSizeUsed),
                sourceMode: normalizeHistoryString(item.sourceMode),
                sessionId: normalizeHistoryString(item.sessionId),
                fileSize: normalizeHistoryInteger(item.fileSize),
                startChunkIndex: normalizeHistoryInteger(item.startChunkIndex),
                startByte: normalizeHistoryInteger(item.startByte),
            };
        });
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
    translationHistory = normalizeHistoryItems(translationHistory);
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
    return historyWriteQueue;
}

function flushHistoryWrites() {
    return historyWriteQueue.catch(() => { });
}

function isLargeHistoryItem(itemOrMetadata = {}) {
    const largeMode = typeof TRANSLATOR_SOURCE_MODES !== 'undefined'
        ? TRANSLATOR_SOURCE_MODES.LARGE_FILE
        : 'large-file';
    return itemOrMetadata.sourceMode === largeMode ||
        itemOrMetadata.sourceMode === 'large-file';
}

function addToHistory(name, originalText, translatedText, chunks, completedCount, totalCount, translatedChunksSnapshot = null, chunkSizeUsed = null, metadata = {}) {
    const largeHistoryItem = isLargeHistoryItem(metadata);
    const normalizedChunkData = Array.isArray(translatedChunksSnapshot)
        ? translatedChunksSnapshot.slice(0, totalCount).map(chunk => typeof chunk === 'string' ? chunk : null)
        : null;

    const historyItem = {
        ...metadata,
        id: Date.now().toString(),
        name: name,
        date: new Date().toISOString(),
        originalText: largeHistoryItem ? String(originalText || '').slice(0, 60000) : originalText,
        translatedText: largeHistoryItem ? String(translatedText || '').slice(0, 60000) : translatedText,
        chunks: largeHistoryItem ? [] : chunks,
        completedChunks: completedCount,
        totalChunks: totalCount,
        charCount: Number.isFinite(parseInt(metadata.charCount, 10))
            ? parseInt(metadata.charCount, 10)
            : String(originalText || '').length,
        isComplete: completedCount >= totalCount,
        translatedChunksData: largeHistoryItem ? null : (completedCount < totalCount ? normalizedChunkData : null),
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

function updateHistoryProgress(id, translatedText, chunks, completedCount, translatedChunksSnapshot = null, chunkSizeUsed = null, metadata = {}) {
    const index = translationHistory.findIndex(h => h.id === id);
    if (index !== -1) {
        const largeHistoryItem = isLargeHistoryItem({ ...translationHistory[index], ...metadata });
        translationHistory[index] = {
            ...translationHistory[index],
            ...metadata,
        };
        translationHistory[index].translatedText = largeHistoryItem
            ? String(translatedText || '').slice(0, 60000)
            : translatedText;
        translationHistory[index].chunks = largeHistoryItem ? [] : chunks;
        translationHistory[index].completedChunks = completedCount;
        translationHistory[index].isComplete = completedCount >= translationHistory[index].totalChunks;
        translationHistory[index].translatedChunksData =
            largeHistoryItem || translationHistory[index].isComplete ? null :
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
    bindHistoryActions(container);

    if (countBadge) countBadge.textContent = `${translationHistory.length} bản`;

    container.replaceChildren();
    if (translationHistory.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = 'Chưa có lịch sử dịch nào.';
        container.appendChild(empty);
        return;
    }

    const sorted = [...translationHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pendingItems = sorted.filter(item => !item.isComplete);
    const completedItems = sorted.filter(item => item.isComplete);

    const renderItems = (items, target) => items.forEach(item => {
        const total = Math.max(1, Number(item.totalChunks) || 1);
        const completed = Math.max(0, Number(item.completedChunks) || 0);
        const progress = Math.min(100, Math.round((completed / total) * 100));
        const statusText = item.isComplete ? 'Hoàn tất' : 'Đang/chưa xong';
        const date = new Date(item.date);
        const dateStr = date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const canDownload = item.isComplete || item.translatedText || item.sessionId;

        const row = document.createElement('div');
        row.className = 'history-item';
        row.dataset.historyId = item.id;

        const status = document.createElement('span');
        status.className = 'status-icon';
        status.textContent = item.isComplete ? '✅' : '⏳';
        row.appendChild(status);

        const info = document.createElement('div');
        info.className = 'history-info';
        const name = document.createElement('div');
        name.className = 'history-name';
        name.title = item.name;
        name.textContent = item.name;
        info.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'history-meta';
        [`📅 ${dateStr}`, statusText].forEach((text) => {
            const span = document.createElement('span');
            span.textContent = text;
            meta.appendChild(span);
        });
        if (isLargeHistoryItem(item)) {
            const large = document.createElement('span');
            large.textContent = 'File lớn';
            meta.appendChild(large);
        }
        [`📝 ${formatNumber(item.charCount)} ký tự`, `📦 ${completed}/${item.totalChunks || 0} chunk`].forEach((text) => {
            const span = document.createElement('span');
            span.textContent = text;
            meta.appendChild(span);
        });
        info.appendChild(meta);
        row.appendChild(info);

        const progressTrack = document.createElement('div');
        progressTrack.className = 'history-progress';
        const progressFill = document.createElement('div');
        progressFill.className = `history-progress-fill${item.isComplete ? ' complete' : ''}`;
        progressFill.style.width = `${progress}%`;
        progressTrack.appendChild(progressFill);
        row.appendChild(progressTrack);

        const buttons = document.createElement('div');
        buttons.className = 'history-btns';
        if (!item.isComplete) buttons.appendChild(createHistoryActionButton('Tiếp tục', 'continue', item.id, 'Tiếp tục dịch'));
        buttons.appendChild(createHistoryActionButton('Xem', 'load', item.id, 'Xem bản dịch'));
        if (canDownload) buttons.appendChild(createHistoryActionButton('Tải về', 'download', item.id, 'Tải bản dịch'));
        buttons.appendChild(createHistoryActionButton('Xóa', 'delete', item.id, 'Xóa', 'btn-delete'));
        row.appendChild(buttons);
        target.appendChild(row);
    });

    const fragment = document.createDocumentFragment();
    const appendGroup = (title, items) => {
        if (items.length === 0) return;
        const group = document.createElement('div');
        group.className = 'history-group';
        const heading = document.createElement('h3');
        heading.textContent = title;
        group.appendChild(heading);
        renderItems(items, group);
        fragment.appendChild(group);
    };
    appendGroup('Đang/chưa xong', pendingItems);
    appendGroup('Đã hoàn tất', completedItems);
    container.appendChild(fragment);
}

function createHistoryActionButton(label, action, historyId, title, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.dataset.action = action;
    button.dataset.historyId = historyId;
    if (className) button.className = className;
    return button;
}

function bindHistoryActions(container) {
    if (container.dataset.historyActionsBound === 'true') return;
    container.dataset.historyActionsBound = 'true';
    container.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action][data-history-id]');
        if (!button || !container.contains(button)) return;
        const id = button.dataset.historyId;
        switch (button.dataset.action) {
            case 'continue':
                continueFromHistory(id);
                break;
            case 'load':
                loadFromHistory(id);
                break;
            case 'download':
                downloadHistoryResult(id);
                break;
            case 'delete':
                deleteFromHistory(id);
                break;
            default:
                break;
        }
    });
}

async function continueFromHistory(id) {
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

    if (!isLargeHistoryItem(item) && item.sessionId && typeof getTranslatorSession === 'function') {
        const session = await getTranslatorSession(item.sessionId);
        if (session && typeof setCurrentTranslatorSession === 'function') setCurrentTranslatorSession(session);
    }

    if (isLargeHistoryItem(item) && item.sessionId && typeof loadTranslatorSessionIntoWorkspace === 'function') {
        const session = await loadTranslatorSessionIntoWorkspace(item.sessionId);
        if (!session) return;
        currentHistoryId = id;
        const chunks = typeof getTranslatorSessionChunks === 'function'
            ? await getTranslatorSessionChunks(item.sessionId)
            : [];
        const nextChunk = chunks.find(chunk => !['done', 'failed', 'skipped'].includes(chunk.status)) ||
            chunks.find(chunk => chunk.chunkIndex >= (session.startChunkIndex || 0));
        if (nextChunk) {
            translationStartChunkIndex = Number(nextChunk.chunkIndex) || 0;
            translationStartByte = Number(nextChunk.byteStart) || 0;
            if (typeof updateStartChunkSelection === 'function') updateStartChunkSelection();
        }
        document.getElementById('translatedText').value = item.translatedText || '';
        document.getElementById('resultSection').style.display = 'block';
        showToast(`Đã tải "${item.name}" để tiếp tục dịch.`, 'success');
        document.getElementById('translateBtn').scrollIntoView({ behavior: 'smooth' });
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

async function loadFromHistory(id) {
    const item = translationHistory.find(h => h.id === id);
    if (!item) {
        showToast('Không tìm thấy lịch sử!', 'error');
        return;
    }

    if (isLargeHistoryItem(item) && item.sessionId && typeof loadTranslatorSessionIntoWorkspace === 'function') {
        await loadTranslatorSessionIntoWorkspace(item.sessionId);
        originalFileName = item.name;
        currentHistoryId = item.id;
        document.getElementById('translatedText').value = item.translatedText || '';
        document.getElementById('resultSection').style.display = 'block';
        updateStats();
        showToast(`Đã tải "${item.name}" từ lịch sử cục bộ.`, 'success');
        document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
        return;
    }

    if (item.sessionId && typeof getTranslatorSession === 'function') {
        const session = await getTranslatorSession(item.sessionId);
        if (session && typeof setCurrentTranslatorSession === 'function') setCurrentTranslatorSession(session);
    }

    document.getElementById('originalText').value = item.originalText;
    originalFileName = item.name;

    document.getElementById('translatedText').value = item.translatedText || '';
    document.getElementById('resultSection').style.display = 'block';

    updateStats();
    showToast(`Đã tải "${item.name}"`, 'success');
    document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
}

async function downloadHistoryResult(id) {
    const item = translationHistory.find(h => h.id === id);
    if (!item) {
        showToast('Không tìm thấy lịch sử!', 'error');
        return;
    }

    if (item.sessionId && typeof getTranslatorSessionOutputParts === 'function') {
        if (typeof downloadTranslatorSessionResult === 'function') {
            await downloadTranslatorSessionResult(item.sessionId, item.name || 'translated_novel.txt');
        } else {
            const parts = await getTranslatorSessionOutputParts(item.sessionId, { includePending: false });
            downloadBlobParts(parts, item.name || 'translated_novel.txt', 'Đã tải bản dịch từ lịch sử.');
        }
        return;
    }

    if (!item.translatedText) {
        showToast('Không có nội dung để tải!', 'warning');
        return;
    }

    downloadBlobParts([item.translatedText], item.name || 'translated_novel.txt', 'Đã tải bản dịch từ lịch sử.');
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
        history: normalizeHistoryItems(translationHistory)
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
            const importedItems = normalizeHistoryItems(data.history, { regenerateIds: true });
            if (importCount > 0 && importedItems.length === 0) {
                throw new Error('Invalid history items');
            }
            let newCount = 0;

            importedItems.forEach((item) => {
                const exists = translationHistory.some(h =>
                    (h.name === item.name && h.date === item.date)
                );

                if (!exists) {
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
    return (Number(num) || 0).toLocaleString('vi-VN');
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
