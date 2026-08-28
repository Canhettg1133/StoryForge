/**
 * Novel Translator Pro - File Handler
 * Xử lý upload, lưu nguồn cục bộ, tìm đoạn bắt đầu và hàng đợi dịch.
 */

let startChunkSearchController = null;
let startChunkSearchWorker = null;
let startChunkSearchReject = null;
let activeStartChunkSearchId = '';
let startChunkSearchMatches = new Map();
let draggedTranslatorQueueItemId = null;

function setFileLoadState(state = 'idle', file = null) {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const queueFileInput = document.getElementById('queueFileInput');
    const queueFilesBtn = document.getElementById('queueFilesBtn');
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadStatusText = document.getElementById('uploadStatusText');
    const uploadStatusMeta = document.getElementById('uploadStatusMeta');
    const isBusy = state !== 'idle';

    if (uploadArea) {
        uploadArea.classList.toggle('is-loading', isBusy);
        uploadArea.classList.remove('dragover');
        uploadArea.setAttribute('aria-busy', String(isBusy));
        uploadArea.setAttribute('aria-disabled', String(isBusy));
    }
    if (fileInput) fileInput.disabled = isBusy;
    if (queueFileInput) queueFileInput.disabled = isBusy;
    if (queueFilesBtn) queueFilesBtn.disabled = isBusy;
    const translateButton = document.getElementById('translateBtn');
    if (translateButton) translateButton.dataset.fileLoadBusy = String(isBusy);
    if (typeof updateTranslateActionState === 'function') updateTranslateActionState();

    if (!uploadStatus) return;
    uploadStatus.hidden = !isBusy;
    if (!isBusy) {
        if (uploadStatusText) uploadStatusText.textContent = '';
        if (uploadStatusMeta) uploadStatusMeta.textContent = '';
        return;
    }

    const messages = {
        reading: 'Đang đọc file truyện...',
        indexing: 'Đang lưu file nguồn cục bộ để có thể tiếp tục sau khi tải lại trang...',
        preview: 'Đang tải bản xem trước file lớn...',
        queued: 'Đang thêm truyện vào hàng đợi dịch...',
    };
    if (uploadStatusText) {
        uploadStatusText.textContent = messages[state] || 'Đang xử lý file truyện...';
    }
    if (uploadStatusMeta) {
        uploadStatusMeta.textContent = file
            ? `${file.name || 'truyen.txt'} • ${formatFileSize(Number(file.size || 0))}`
            : 'Vui lòng chờ trong giây lát.';
    }
}

function updateTranslateActionState() {
    const button = document.getElementById('translateBtn');
    const title = document.getElementById('translateActionTitle');
    const hint = document.getElementById('translateActionHint');
    const buttonText = button?.querySelector('.btn-text');
    const text = document.getElementById('originalText')?.value?.trim() || '';
    const hasLargeFileSource = currentSourceMode === TRANSLATOR_SOURCE_MODES.LARGE_FILE
        && Boolean(currentSourceFile && Number(currentSourceFile.size) > 0);
    const hasSource = Boolean(hasLargeFileSource || text);
    const isFileLoadBusy = Boolean(button && button.dataset.fileLoadBusy === 'true');
    const isStartSearchBusy = Boolean(button && button.dataset.startSearchBusy === 'true');
    const isStoryPromptBusy = Boolean(button && button.dataset.storyPromptBusy === 'true');
    const isAutomaticHanAuditBusy = typeof isHanAuditBusy !== 'undefined' && Boolean(isHanAuditBusy);
    const isHanFileBusy = Boolean(globalThis.isHanFileAuditBusy);
    const isChunkRetryBusy = Boolean(globalThis.isChunkIssueRetryBusy);

    document.body?.classList.toggle('translator-source-ready', hasSource);
    document.body?.classList.toggle('translator-is-translating', Boolean(isTranslating));
    if (button) button.disabled = Boolean(
        isTranslating || isFileLoadBusy || isStartSearchBusy || isStoryPromptBusy || isAutomaticHanAuditBusy || isHanFileBusy || isChunkRetryBusy || !hasSource
    );

    if (isTranslating) {
        if (buttonText) buttonText.textContent = 'Đang dịch...';
        if (title) title.textContent = 'Đang dịch truyện';
        if (hint) hint.textContent = 'Theo dõi tiến trình hoặc tạm dừng ở phần bên dưới.';
        return;
    }
    if (isFileLoadBusy) {
        if (buttonText) buttonText.textContent = 'Đang tải truyện...';
        if (title) title.textContent = 'Đang chuẩn bị truyện';
        if (hint) hint.textContent = 'Nút dịch sẽ sẵn sàng ngay khi file được đọc xong.';
        return;
    }
    if (isStartSearchBusy) {
        if (buttonText) buttonText.textContent = 'Đang tìm vị trí...';
        if (title) title.textContent = 'Đang tìm vị trí bắt đầu';
        if (hint) hint.textContent = 'Có thể dừng tìm để dịch ngay từ đầu truyện.';
        return;
    }
    if (isStoryPromptBusy) {
        if (buttonText) buttonText.textContent = 'Đang tạo quy tắc...';
        if (title) title.textContent = 'Đang tạo quy tắc dịch';
        if (hint) hint.textContent = 'Nút dịch sẽ sẵn sàng ngay khi AI hoàn tất.';
        return;
    }
    if (isAutomaticHanAuditBusy) {
        if (buttonText) buttonText.textContent = 'Đang rà Hán tự...';
        if (title) title.textContent = 'Đang rà soát kết quả dịch';
        if (hint) hint.textContent = 'Chờ tác vụ rà soát hiện tại hoàn tất hoặc dừng trong khu vực kết quả.';
        return;
    }
    if (isHanFileBusy) {
        if (buttonText) buttonText.textContent = 'Đang kiểm tra file...';
        if (title) title.textContent = 'Đang kiểm tra Hán tự';
        if (hint) hint.textContent = 'Tác vụ vẫn chạy khi đóng chi tiết; dùng thẻ kiểm tra Hán tự để dừng.';
        return;
    }
    if (isChunkRetryBusy) {
        if (buttonText) buttonText.textContent = 'Đang dịch lại lỗi...';
        if (title) title.textContent = 'Đang xử lý chunk lỗi';
        if (hint) hint.textContent = 'Theo dõi hoặc dừng tác vụ trong thẻ chunk cần xử lý.';
        return;
    }
    if (!hasSource) {
        if (buttonText) buttonText.textContent = 'Bắt đầu dịch';
        if (title) title.textContent = 'Chưa có nội dung';
        if (hint) hint.textContent = 'Tải file hoặc dán nội dung truyện để bắt đầu.';
        return;
    }

    if (buttonText) buttonText.textContent = 'Bắt đầu dịch';
    if (title) title.textContent = 'Sẵn sàng dịch';
    if (hint) {
        hint.textContent = translationStartChunkIndex > 0
            ? `Sẽ bắt đầu từ đoạn ${translationStartChunkIndex + 1}.`
            : 'Bắt đầu từ đầu truyện. Hai mục phía trên là tùy chọn.';
    }
}

// ============================================
// FILE HANDLING
// ============================================
async function handleFileSelect(event) {
    const files = Array.from(event.target.files || []).filter(file => /\.txt$/i.test(file.name || ''));
    if (files.length === 0) {
        showToast('Chỉ hỗ trợ file .txt', 'error');
        return;
    }

    if (isTranslating) {
        setFileLoadState('queued', files[0]);
        try {
            await enqueueTranslatorFiles(files);
        } finally {
            setFileLoadState('idle');
            event.target.value = '';
        }
        return;
    }

    await processFile(files[0]);
    if (files.length > 1) {
        await enqueueTranslatorFiles(files.slice(1));
    }
    event.target.value = '';
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('uploadArea').classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('uploadArea').classList.remove('dragover');
}

async function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('uploadArea').classList.remove('dragover');

    const files = Array.from(event.dataTransfer.files || []).filter(file => /\.txt$/i.test(file.name || ''));
    if (files.length === 0) {
        showToast('Chỉ hỗ trợ file .txt', 'error');
        return;
    }

    if (isTranslating) {
        setFileLoadState('queued', files[0]);
        try {
            await enqueueTranslatorFiles(files);
        } finally {
            setFileLoadState('idle');
        }
        return;
    }

    await processFile(files[0]);
    if (files.length > 1) await enqueueTranslatorFiles(files.slice(1));
}

async function processFile(file) {
    if (!/\.txt$/i.test(file.name || '')) {
        showToast('Chỉ hỗ trợ file .txt', 'error');
        return;
    }

    globalThis.TranslatorChapterFeature?.reset();
    globalThis.TranslatorHanFileFeature?.reset();
    cancelStartChunkSearch({ silent: true });
    startChunkSearchMatches = new Map();

    originalFileName = file.name.replace(/\.txt$/i, '_translated.txt');
    currentTranslatorSessionId = null;
    currentTranslatorSessionMeta = null;
    currentTranslatorPersistenceAvailable = true;
    translationStartChunkIndex = 0;
    translationStartByte = 0;

    setFileLoadState('reading', file);
    try {
        if (typeof isLargeFileCandidate === 'function' && isLargeFileCandidate(file)) {
            await processLargeFile(file);
            return;
        }

        await processTextFile(file);
    } catch (error) {
        console.error('File load error:', error);
        showToast('Không thể tải file truyện. Hãy thử lại.', 'error');
    } finally {
        setFileLoadState('idle');
    }
}

function resetSourceModeToText() {
    cancelStartChunkSearch({ silent: true });
    startChunkSearchMatches = new Map();
    currentSourceMode = TRANSLATOR_SOURCE_MODES.TEXT;
    currentSourceFile = null;
    largeFileMeta = null;
    largeFileByteCursor = 0;
    translatedBlobParts = [];
    currentTranslatorSessionId = null;
    currentTranslatorSessionMeta = null;
    translationStartChunkIndex = 0;
    translationStartByte = 0;

    const originalText = document.getElementById('originalText');
    if (originalText) {
        originalText.readOnly = false;
        originalText.classList.remove('large-file-preview');
    }

    const title = document.getElementById('sourcePreviewTitle');
    if (title) title.textContent = 'Nội dung gốc';

    const notice = document.getElementById('sourceModeNotice');
    if (notice) {
        notice.style.display = 'none';
        notice.textContent = '';
    }
    renderStartChunkPanel();
    if (typeof renderStoryPromptPanel === 'function') renderStoryPromptPanel();
}

function getCurrentChunkSizeValue() {
    return parseInt(document.getElementById('chunkSize')?.value, 10) || 4500;
}

async function handleTranslatorChunkSizeChange() {
    const input = document.getElementById('chunkSize');
    const nextChunkSize = getCurrentChunkSizeValue();
    const previousChunkSize = Number(currentTranslatorSessionMeta?.chunkSize || largeFileMeta?.chunkSize || nextChunkSize);
    if (typeof saveSettings === 'function') saveSettings();
    if (nextChunkSize === previousChunkSize) return;

    if (Number(currentTranslatorSessionMeta?.completedChunks || 0) > 0) {
        if (input) input.value = String(previousChunkSize);
        if (typeof saveSettings === 'function') saveSettings();
        showToast('Không thể đổi kích thước chunk của phiên đã dịch dở. Hãy tải lại file để tạo phiên mới.', 'warning');
        return;
    }

    globalThis.TranslatorHanFileFeature?.reset();

    const hadCustomStart = translationStartChunkIndex > 0 || translationStartByte > 0;
    translationStartChunkIndex = 0;
    translationStartByte = 0;
    startChunkSearchMatches = new Map();
    cancelStartChunkSearch({ silent: true });
    const results = document.getElementById('chunkSearchResults');
    if (results) results.innerHTML = '<p class="empty-message">Kích thước chunk đã đổi. Nhấn Tìm để quét lại.</p>';

    const estimate = typeof estimateChunkCountFromPreview === 'function' && currentTranslatorSessionMeta
        ? estimateChunkCountFromPreview({
            fileSize: currentTranslatorSessionMeta.fileSize,
            previewText: currentTranslatorSessionMeta.previewText,
            chunkSize: nextChunkSize,
        })
        : null;
    const sessionPatch = {
        chunkSize: nextChunkSize,
        estimatedChunks: estimate?.count || currentTranslatorSessionMeta?.estimatedChunks,
        totalChunks: estimate?.count || currentTranslatorSessionMeta?.totalChunks,
        totalChunksExact: false,
        startChunkIndex: 0,
        startByte: 0,
        startContextText: '',
        resumeChunkIndex: 0,
        resumeByte: 0,
        resumeContextText: '',
    };
    if (currentTranslatorSessionId && typeof updateTranslatorSession === 'function') {
        try {
            currentTranslatorSessionMeta = await updateTranslatorSession(currentTranslatorSessionId, sessionPatch) || currentTranslatorSessionMeta;
        } catch (error) {
            currentTranslatorPersistenceAvailable = false;
            currentTranslatorSessionMeta = { ...currentTranslatorSessionMeta, ...sessionPatch };
            console.warn('[Translator] Không thể lưu kích thước chunk mới vào checkpoint.', error);
            showToast('Đã đổi kích thước chunk cho phiên hiện tại, nhưng không thể lưu để resume sau khi tải lại trang.', 'warning');
        }
    } else if (currentTranslatorSessionMeta) {
        currentTranslatorSessionMeta = { ...currentTranslatorSessionMeta, ...sessionPatch };
    }
    if (largeFileMeta) {
        largeFileMeta.chunkSize = nextChunkSize;
        if (estimate) largeFileMeta.estimatedChunks = estimate.count;
    }
    updateStartChunkSelection();
    if (hadCustomStart) showToast('Đã đổi kích thước chunk và reset điểm bắt đầu. Hãy tìm lại đoạn nếu cần.', 'info');
}

async function createLocalSessionForFile(file, options = {}) {
    if (typeof createTranslatorSessionFromFile !== 'function') return null;
    const chunkSize = getCurrentChunkSizeValue();
    return createTranslatorSessionFromFile(file, { chunkSize, ...options });
}

function setCurrentTranslatorSession(session) {
    const previousSessionId = currentTranslatorSessionId;
    currentTranslatorSessionId = session?.id || null;
    if (previousSessionId !== currentTranslatorSessionId && typeof resetTranslatorChunkKeyUsage === 'function') resetTranslatorChunkKeyUsage();
    currentTranslatorSessionMeta = session || null;
    currentTranslatorPersistenceAvailable = true;
    translationStartChunkIndex = Number(session?.resumeChunkIndex ?? session?.startChunkIndex ?? 0);
    translationStartByte = Number(session?.resumeByte ?? session?.startByte ?? 0);
    if (Number.isFinite(parseInt(session?.chunkSize, 10))) {
        const chunkSizeInput = document.getElementById('chunkSize');
        if (chunkSizeInput) chunkSizeInput.value = String(parseInt(session.chunkSize, 10));
    }
    if (typeof renderStoryPromptPanel === 'function') renderStoryPromptPanel();
}

async function processTextFile(file) {
    resetSourceModeToText();
    currentSourceFile = file;
    const session = await createLocalSessionForFile(file).catch((error) => {
        console.warn('[Translator] Không thể lưu file nhỏ vào bộ nhớ cục bộ:', error);
        showToast('Bộ nhớ cục bộ không đủ. Vẫn có thể dịch, nhưng queue/resume sau khi tải lại trang sẽ không khả dụng.', 'warning');
        currentTranslatorPersistenceAvailable = false;
        return null;
    });
    if (session) setCurrentTranslatorSession(session);

    setFileLoadState('reading', file);
    await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            document.getElementById('originalText').value = event.target.result;
            updateStats();
            showFileInfo(file, { mode: 'text' });
            renderStartChunkPanel();
            showToast('Đã tải file thành công.', 'success');
            resolve(true);
        };
        reader.onerror = function () {
            reject(reader.error || new Error('Lỗi khi đọc file.'));
        };
        reader.readAsText(file, 'UTF-8');
    });
}

async function processLargeFile(file) {
    currentSourceMode = TRANSLATOR_SOURCE_MODES.LARGE_FILE;
    currentSourceFile = file;
    largeFileByteCursor = 0;
    translatedChunks = [];
    if (typeof bumpTranslatorOutputGeneration === 'function') bumpTranslatorOutputGeneration();
    translatedBlobParts = [];
    completedChunks = 0;
    totalChunksCount = 0;
    currentHistoryId = null;

    const chunkSize = getCurrentChunkSizeValue();
    setFileLoadState('preview', file);
    const previewText = typeof readFilePreview === 'function'
        ? await readFilePreview(file)
        : await file.slice(0, Math.min(file.size, 64 * 1024)).text();
    setFileLoadState('indexing', file);
    const session = await createLocalSessionForFile(file, { previewText }).catch((error) => {
        console.warn('[Translator] Không thể lưu file lớn vào bộ nhớ cục bộ:', error);
        showToast('Bộ nhớ cục bộ không đủ. File hiện tại vẫn dịch được, nhưng queue/resume sau khi tải lại trang sẽ không khả dụng.', 'warning');
        currentTranslatorPersistenceAvailable = false;
        return null;
    });
    if (session) {
        setCurrentTranslatorSession(session);
        totalChunksCount = session.totalChunks || 0;
    }
    const estimate = typeof estimateChunkCountFromPreview === 'function'
        ? estimateChunkCountFromPreview({ fileSize: file.size, previewText, chunkSize })
        : { count: Math.max(1, Math.ceil(file.size / Math.max(1, chunkSize * 2))), approximate: true };

    largeFileMeta = {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        previewText,
        chunkSize,
        estimatedChunks: session?.estimatedChunks || estimate.count,
        approximate: true,
        sessionId: session?.id || null,
    };

    const originalText = document.getElementById('originalText');
    if (originalText) {
        originalText.value = previewText;
        originalText.readOnly = true;
        originalText.classList.add('large-file-preview');
    }

    const title = document.getElementById('sourcePreviewTitle');
    if (title) title.textContent = 'Nội dung gốc / Bản xem trước';

    showFileInfo(file, { mode: 'large-file', estimatedChunks: largeFileMeta.estimatedChunks });
    updateLargeFileNotice();
    updateStats();
    renderStartChunkPanel();
    showToast('Đã bật chế độ file lớn. Ứng dụng chỉ hiển thị bản xem trước để tránh lag.', 'success');
}

function updateLargeFileNotice() {
    const notice = document.getElementById('sourceModeNotice');
    if (!notice || currentSourceMode !== TRANSLATOR_SOURCE_MODES.LARGE_FILE || !largeFileMeta) return;

    notice.style.display = 'grid';
    notice.innerHTML = `
        <div class="source-mode-card">
            <strong>Chế độ file lớn</strong>
            <span>Đã sẵn sàng dịch từ đầu. Chỉ quét toàn truyện khi bạn chủ động tìm đoạn bắt đầu khác.</span>
        </div>
        <div class="source-mode-metrics">
            <span>${formatFileSize(largeFileMeta.size)}</span>
            <span>${largeFileMeta.estimatedChunks.toLocaleString('vi-VN')} chunk</span>
            <span>Xem trước ${largeFileMeta.previewText.length.toLocaleString('vi-VN')} ký tự</span>
        </div>
    `;
}

function showFileInfo(file, options = {}) {
    document.getElementById('fileInfo').style.display = 'grid';
    document.getElementById('fileName').textContent = file.name;
    const modeText = options.mode === 'large-file'
        ? `File lớn • ${formatFileSize(file.size)}`
        : `Văn bản thường • ${formatFileSize(file.size)}`;
    document.getElementById('fileSize').textContent = modeText;
}

function clearFile() {
    globalThis.TranslatorChapterFeature?.reset();
    globalThis.TranslatorHanFileFeature?.reset();
    setFileLoadState('idle');
    resetSourceModeToText();
    currentTranslatorPersistenceAvailable = true;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('originalText').value = '';
    document.getElementById('translatedText').value = '';
    document.getElementById('resultSection').style.display = 'none';
    translatedChunks = [];
    if (typeof bumpTranslatorOutputGeneration === 'function') bumpTranslatorOutputGeneration();
    originalChunks = [];
    translatedBlobParts = [];
    completedChunks = 0;
    totalChunksCount = 0;
    currentTranslatorSessionId = null;
    currentTranslatorSessionMeta = null;
    translationStartChunkIndex = 0;
    translationStartByte = 0;
    renderStartChunkPanel();
    if (typeof renderStoryPromptPanel === 'function') renderStoryPromptPanel();
    updateStats();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================
// START-FROM-CHUNK SEARCH
// ============================================
function renderStartChunkPanel() {
    const panel = document.getElementById('startChunkPanel');
    if (!panel) return;
    const hasSource = Boolean(currentTranslatorSessionId || currentSourceFile);
    panel.style.display = hasSource ? '' : 'none';
    updateStartChunkSelection();
}

function updateStartChunkSelection() {
    const selection = document.getElementById('startChunkSelection');
    if (selection) {
        selection.textContent = translationStartChunkIndex > 0
            ? `Đoạn ${translationStartChunkIndex + 1}`
            : 'Đầu truyện';
    }
    updateTranslateActionState();
}

function setStartChunkSearchBusy(isBusy) {
    const searchButton = document.getElementById('startChunkSearchBtn');
    const cancelButton = document.getElementById('cancelStartChunkSearchBtn');
    if (searchButton) {
        searchButton.disabled = Boolean(isBusy);
        searchButton.textContent = isBusy ? 'Đang tìm...' : 'Tìm trong truyện';
    }
    if (cancelButton) cancelButton.hidden = !isBusy;
    const button = document.getElementById('translateBtn');
    if (button) button.dataset.startSearchBusy = String(Boolean(isBusy));
    updateTranslateActionState();
}

function handleStartChunkSearchInput() {
    if (activeStartChunkSearchId) cancelStartChunkSearch({ silent: true });
    const results = document.getElementById('chunkSearchResults');
    if (results) results.textContent = '';
}

function cancelStartChunkSearch(options = {}) {
    if (startChunkSearchController) startChunkSearchController.abort();
    startChunkSearchController = null;
    if (startChunkSearchWorker) startChunkSearchWorker.terminate();
    startChunkSearchWorker = null;
    const rejectPendingSearch = startChunkSearchReject;
    startChunkSearchReject = null;
    activeStartChunkSearchId = '';
    setStartChunkSearchBusy(false);
    if (rejectPendingSearch) {
        const error = new Error('Translator source search cancelled');
        error.name = 'AbortError';
        rejectPendingSearch(error);
    }
    if (!options.silent) {
        const results = document.getElementById('chunkSearchResults');
        if (results) results.innerHTML = '<p class="empty-message">Đã dừng tìm.</p>';
    }
}

async function getCurrentTranslatorSource() {
    if (currentSourceFile) return currentSourceFile;
    if (currentTranslatorSessionId && typeof getTranslatorSessionSource === 'function') {
        return getTranslatorSessionSource(currentTranslatorSessionId);
    }
    return null;
}

function scanStartChunkInWorker(file, query, requestId, options = {}) {
    return new Promise((resolve, reject) => {
        const worker = new Worker('js/translation/source-search-worker.js?v=22');
        startChunkSearchWorker = worker;
        startChunkSearchReject = reject;
        const cleanup = () => {
            worker.terminate();
            if (startChunkSearchWorker === worker) startChunkSearchWorker = null;
            if (startChunkSearchReject === reject) startChunkSearchReject = null;
        };
        worker.addEventListener('message', (event) => {
            const message = event.data || {};
            if (message.requestId !== requestId || requestId !== activeStartChunkSearchId) return;
            if (message.type === 'progress') {
                options.onProgress?.(message.progress);
                return;
            }
            cleanup();
            if (message.type === 'complete') {
                resolve({ matches: message.matches || [], scannedBytes: message.scannedBytes || 0 });
            } else if (message.type === 'error') {
                reject(new Error(message.message || 'Không thể quét file truyện.'));
            }
        });
        worker.addEventListener('error', (event) => {
            cleanup();
            reject(event.error || new Error(event.message || 'Web Worker quét truyện gặp lỗi.'));
        }, { once: true });
        worker.postMessage({
            type: 'scan',
            requestId,
            file,
            query,
            options: { chunkSize: getCurrentChunkSizeValue(), limit: 12, contextCount: 3 },
        });
    });
}

async function runStartChunkSearch() {
    const input = document.getElementById('chunkSearchInput');
    const results = document.getElementById('chunkSearchResults');
    const query = String(input?.value || '').trim();
    if (!results) return;
    let source;
    try {
        source = await getCurrentTranslatorSource();
    } catch (error) {
        console.error('Could not read Translator source:', error);
        results.innerHTML = '<p class="empty-message">Không thể đọc file nguồn lúc này.</p>';
        return;
    }
    if (!source) {
        results.innerHTML = '<p class="empty-message">Hãy tải truyện trước khi tìm đoạn bắt đầu.</p>';
        return;
    }
    if (query.length < 2) {
        results.innerHTML = '<p class="empty-message">Nhập ít nhất 2 ký tự để tìm trong truyện.</p>';
        return;
    }

    cancelStartChunkSearch({ silent: true });
    startChunkSearchController = new AbortController();
    const requestId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeStartChunkSearchId = requestId;
    setStartChunkSearchBusy(true);
    results.innerHTML = '<p class="empty-message">Đang quét truyện... 0%</p>';

    try {
        const onProgress = progress => {
            if (activeStartChunkSearchId !== requestId) return;
            const percent = Math.max(0, Math.min(100, Math.round(Number(progress || 0) * 100)));
            results.innerHTML = `<p class="empty-message">Đang quét truyện... ${percent}%</p>`;
        };
        let scanResult;
        if (typeof Worker === 'function') {
            try {
                scanResult = await scanStartChunkInWorker(source, query, requestId, { onProgress });
            } catch (workerError) {
                if (activeStartChunkSearchId !== requestId || startChunkSearchController?.signal?.aborted) return;
                console.warn('[Translator] Worker tìm đoạn không khả dụng, chuyển sang quét cooperative.', workerError);
            }
        }
        if (!scanResult) {
            scanResult = await scanTranslatorSource(source, query, {
                chunkSize: getCurrentChunkSizeValue(),
                limit: 12,
                contextCount: 3,
                signal: startChunkSearchController.signal,
                onProgress,
            });
        }
        if (activeStartChunkSearchId !== requestId || startChunkSearchController.signal.aborted) return;
        const matches = scanResult.matches || [];
        startChunkSearchMatches = new Map(matches.map(match => [Number(match.chunkIndex), match]));
        if (matches.length === 0) {
            results.innerHTML = '<p class="empty-message">Không tìm thấy đoạn phù hợp.</p>';
            return;
        }
        results.innerHTML = matches.map(match => `
            <button type="button" class="start-chunk-result" data-click-action="selectStartChunk" data-chunk-index="${match.chunkIndex}" data-byte-start="${match.byteStart}">
                <span class="start-chunk-result__title">Bắt đầu từ đoạn ${match.chunkIndex + 1}</span>
                <span class="start-chunk-result__text">${escapeHtml(match.sourcePreview)}</span>
            </button>
        `).join('');
    } catch (error) {
        if (activeStartChunkSearchId !== requestId || startChunkSearchController?.signal?.aborted) return;
        console.error('Chunk search failed:', error);
        results.innerHTML = '<p class="empty-message">Không thể tìm trong truyện lúc này.</p>';
    } finally {
        if (activeStartChunkSearchId === requestId) {
            activeStartChunkSearchId = '';
            startChunkSearchController = null;
            setStartChunkSearchBusy(false);
        }
    }
}

async function selectStartChunk(chunkIndex, byteStart) {
    translationStartChunkIndex = Math.max(0, Number(chunkIndex) || 0);
    translationStartByte = Math.max(0, Number(byteStart) || 0);
    const match = startChunkSearchMatches.get(translationStartChunkIndex);
    const startContextText = String(match?.contextBefore || '');
    const selectionPatch = {
        startChunkIndex: translationStartChunkIndex,
        startByte: translationStartByte,
        startContextText,
        resumeChunkIndex: translationStartChunkIndex,
        resumeByte: translationStartByte,
        resumeContextText: startContextText,
    };
    if (currentTranslatorSessionId && typeof updateTranslatorSession === 'function') {
        try {
            currentTranslatorSessionMeta = await updateTranslatorSession(currentTranslatorSessionId, selectionPatch) || currentTranslatorSessionMeta;
        } catch (error) {
            currentTranslatorPersistenceAvailable = false;
            currentTranslatorSessionMeta = { ...currentTranslatorSessionMeta, ...selectionPatch };
            console.warn('[Translator] Không thể lưu điểm bắt đầu vào checkpoint.', error);
            showToast('Đã chọn điểm bắt đầu cho phiên hiện tại, nhưng không thể lưu để resume sau khi tải lại trang.', 'warning');
        }
    }
    updateStartChunkSelection();
    showToast(`Đã chọn bắt đầu từ đoạn ${translationStartChunkIndex + 1}.`, 'success');
}

// ============================================
// LOCAL TRANSLATION QUEUE
// ============================================
function openQueueFilePicker() {
    const queueFileInput = document.getElementById('queueFileInput');
    if (!queueFileInput || queueFileInput.disabled) return;
    queueFileInput.click();
}

async function handleQueueFileSelect(event) {
    const files = Array.from(event.target.files || []).filter(file => /\.txt$/i.test(file.name || ''));
    if (files.length === 0) {
        showToast('Chỉ hỗ trợ file .txt', 'error');
        return;
    }

    setFileLoadState('queued', files[0]);
    try {
        await enqueueTranslatorFiles(files);
    } finally {
        setFileLoadState('idle');
        event.target.value = '';
    }
}

function isQueueReorderable(status) {
    return status === 'queued' || status === 'paused';
}

function updateTranslationQueueControls(items = []) {
    const runBtn = document.getElementById('runTranslationQueueBtn');
    const queueFilesBtn = document.getElementById('queueFilesBtn');
    const queueFileInput = document.getElementById('queueFileInput');
    const hasQueued = items.some(item => item.status === 'queued');
    if (runBtn) {
        runBtn.disabled = isTranslating || translatorQueueAutoRunning || !hasQueued;
        runBtn.title = isTranslating || translatorQueueAutoRunning
            ? 'Đang dịch, hàng đợi sẽ tự chạy tiếp.'
            : hasQueued ? 'Chạy truyện tiếp theo trong hàng đợi.' : 'Chưa có truyện đang chờ.';
    }
    if (queueFilesBtn) {
        queueFilesBtn.disabled = Boolean(queueFileInput?.disabled);
    }
}

async function enqueueTranslatorFiles(files) {
    const validFiles = Array.from(files || []).filter(file => /\.txt$/i.test(file.name || ''));
    const queued = [];
    for (const file of validFiles) {
        try {
            const session = await createLocalSessionForFile(file, {
                windowBytes: Math.max(256 * 1024, getCurrentChunkSizeValue() * 6),
                minWindowBytes: 256 * 1024,
            });
            if (!session) continue;
            const queueItem = await enqueueTranslatorSession(session.id);
            queued.push({ session, queueItem });
        } catch (error) {
            console.error('Queue file failed:', error);
            showToast(`Không thể thêm "${file.name}" vào hàng đợi.`, 'error');
        }
    }
    if (queued.length > 0) {
        showToast(`Đã thêm ${queued.length} truyện vào hàng đợi.`, 'success');
        await renderTranslationQueue();
        toggleTranslationQueuePanel(true);
    }
    return queued;
}

async function loadTranslatorSessionIntoWorkspace(sessionId) {
    const session = await getTranslatorSession(sessionId);
    const sourceBlob = session && typeof getTranslatorSessionSource === 'function'
        ? await getTranslatorSessionSource(session.id)
        : session?.sourceBlob;
    if (!sourceBlob) {
        showToast('Không tìm thấy file nguồn trong bộ nhớ cục bộ.', 'error');
        return null;
    }
    setCurrentTranslatorSession(session);
    currentSourceMode = TRANSLATOR_SOURCE_MODES.LARGE_FILE;
    currentSourceFile = sourceBlob;
    largeFileByteCursor = session.resumeByte ?? session.startByte ?? 0;
    translatedChunks = [];
    if (typeof bumpTranslatorOutputGeneration === 'function') bumpTranslatorOutputGeneration();
    translatedBlobParts = [];
    completedChunks = session.completedChunks || 0;
    totalChunksCount = session.totalChunks || 0;
    currentHistoryId = session.historyId || null;
    originalFileName = session.outputFileName || session.fileName.replace(/\.txt$/i, '_translated.txt');
    largeFileMeta = {
        name: session.fileName,
        size: session.fileSize,
        lastModified: session.fileLastModified,
        previewText: session.previewText || '',
        chunkSize: session.chunkSize,
        estimatedChunks: session.estimatedChunks || session.totalChunks || 1,
        approximate: !session.totalChunksExact,
        sessionId: session.id,
    };

    const originalText = document.getElementById('originalText');
    if (originalText) {
        originalText.value = session.previewText || '';
        originalText.readOnly = true;
        originalText.classList.add('large-file-preview');
    }
    const title = document.getElementById('sourcePreviewTitle');
    if (title) title.textContent = 'Nội dung gốc / Bản xem trước';
    showFileInfo({ name: session.fileName, size: session.fileSize }, { mode: 'large-file' });
    updateLargeFileNotice();
    renderStartChunkPanel();
    if (typeof renderStoryPromptPanel === 'function') renderStoryPromptPanel();
    if (typeof updateChunkIssueDownloadAction === 'function') {
        updateChunkIssueDownloadAction({
            failedCount: session.failedChunks || 0,
            manualCount: 0,
            pendingCount: session.isComplete
                ? 0
                : Math.max(0, Number(session.totalChunks || 0) - Number(session.completedChunks || 0)),
        });
    }
    updateStats();
    return session;
}

async function renderTranslationQueue() {
    const list = document.getElementById('translationQueueList');
    const summary = document.getElementById('translationQueueSummary');
    const countBadge = document.getElementById('translationQueueCount');
    if (!list) return;
    const items = typeof getTranslatorQueueItems === 'function' ? await getTranslatorQueueItems() : [];
    const activeItems = items.filter(item => ['queued', 'running', 'paused'].includes(item.status));
    updateTranslationQueueControls(items);
    if (countBadge) countBadge.textContent = `${activeItems.length} mục`;
    if (summary) {
        const running = activeItems.find(item => item.status === 'running');
        const queuedCount = activeItems.filter(item => item.status === 'queued').length;
        summary.textContent = running
            ? `Đang dịch 1 truyện, còn ${queuedCount} truyện chờ.`
            : queuedCount > 0 ? `${queuedCount} truyện đang chờ.` : 'Hàng đợi đang trống.';
    }
    if (items.length === 0) {
        list.innerHTML = '<p class="empty-message">Chưa có truyện nào trong hàng đợi.</p>';
        return;
    }
    const rows = await Promise.all(items.slice(0, 30).map(async (item) => {
        const session = await getTranslatorSession(item.sessionId);
        const sessionName = session?.fileName || item.sessionId;
        const canReorder = isQueueReorderable(item.status);
        const issueCount = Math.max(0, Number(session?.failedChunks) || 0);
        const statusLabel = item.status === 'completed' && issueCount > 0
            ? `Còn ${issueCount.toLocaleString('vi-VN')} chunk lỗi`
            : queueStatusLabel(item.status);
        const downloadLabel = issueCount > 0 ? 'Tải bản có đánh dấu' : 'Tải về';
        const totalToTranslate = Math.max(1, (session?.totalChunks || 0) - (session?.startChunkIndex || 0));
        const progress = session?.isComplete
            ? 100
            : Math.min(100, Math.round(((session?.completedChunks || 0) / totalToTranslate) * 100));
        return `
            <article class="translation-queue-item translation-queue-item--${item.status}" data-queue-id="${escapeHtmlAttribute(item.id)}" draggable="${canReorder ? 'true' : 'false'}">
                <span class="translation-queue-item__drag ${canReorder ? '' : 'translation-queue-item__drag--locked'}" title="Kéo để đổi thứ tự">${canReorder ? '↕' : ''}</span>
                <div class="translation-queue-item__main">
                <strong title="${escapeHtmlAttribute(sessionName)}">${escapeHtml(sessionName)}</strong>
                    <span>${statusLabel} • ${progress}% • ${session?.completedChunks || 0}/${totalToTranslate} chunk</span>
                </div>
                <div class="translation-queue-item__actions">
                    ${item.status === 'queued' ? `<button type="button" class="btn btn-small btn-secondary" data-click-action="pauseQueuedTranslatorItem" data-queue-id="${escapeHtmlAttribute(item.id)}">Tạm dừng</button>` : ''}
                    ${item.status === 'paused' ? `<button type="button" class="btn btn-small btn-primary" data-click-action="resumeQueuedTranslatorItem" data-queue-id="${escapeHtmlAttribute(item.id)}">Tiếp tục</button>` : ''}
                    ${item.status === 'running' ? `<button type="button" class="btn btn-small btn-danger" data-click-action="cancelQueuedTranslatorItem" data-queue-id="${escapeHtmlAttribute(item.id)}">Hủy</button>` : ''}
                    ${item.status === 'queued' || item.status === 'paused' || item.status === 'failed' || item.status === 'cancelled' || item.status === 'completed' ? `<button type="button" class="btn btn-small btn-secondary" data-click-action="removeQueuedTranslatorItem" data-queue-id="${escapeHtmlAttribute(item.id)}">Xóa</button>` : ''}
                    ${item.status === 'completed' ? `<button type="button" class="btn btn-small btn-primary" data-click-action="downloadQueuedTranslatorResult" data-session-id="${escapeHtmlAttribute(item.sessionId)}">${downloadLabel}</button>` : ''}
                </div>
            </article>
        `;
    }));
    list.innerHTML = rows.join('');
}

function queueStatusLabel(status) {
    if (status === 'queued') return 'Đang chờ';
    if (status === 'running') return 'Đang dịch';
    if (status === 'paused') return 'Tạm dừng';
    if (status === 'completed') return 'Hoàn tất';
    if (status === 'failed') return 'Thất bại';
    if (status === 'cancelled') return 'Đã hủy';
    return status || 'Không rõ';
}

function toggleTranslationQueuePanel(forceOpen) {
    const panel = document.getElementById('translationQueuePanel');
    if (!panel) return;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.style.display === 'none';
    if (shouldOpen) {
        if (typeof toggleSettingsPanels === 'function') toggleSettingsPanels(false);
        if (typeof toggleHistoryPanel === 'function') toggleHistoryPanel(false);
    }
    panel.style.display = shouldOpen ? '' : 'none';
    const toggleBtn = document.getElementById('toggleQueueBtn');
    if (toggleBtn) toggleBtn.classList.toggle('is-active', shouldOpen);
    if (shouldOpen) renderTranslationQueue();
}

async function startTranslatorQueue() {
    if (isTranslating || translatorQueueAutoRunning) {
        showToast('Đang dịch, hàng đợi sẽ tự chạy tiếp.', 'info');
        return;
    }

    const items = typeof getTranslatorQueueItems === 'function' ? await getTranslatorQueueItems() : [];
    const hasQueued = items.some(item => item.status === 'queued');
    if (!hasQueued) {
        showToast('Không có truyện nào đang chờ trong hàng đợi.', 'info');
        updateTranslationQueueControls(items);
        return;
    }

    toggleTranslationQueuePanel(true);
    await processNextTranslatorQueue();
}

async function removeQueuedTranslatorItem(queueId) {
    const items = typeof getTranslatorQueueItems === 'function' ? await getTranslatorQueueItems() : [];
    const item = items.find(row => row.id === queueId);
    if (item?.status === 'running') {
        await cancelQueuedTranslatorItem(queueId);
        return;
    }

    if (typeof removeTranslatorQueueItem === 'function') {
        await removeTranslatorQueueItem(queueId);
    }
    await renderTranslationQueue();
}

async function cancelQueuedTranslatorItem(queueId) {
    const items = typeof getTranslatorQueueItems === 'function' ? await getTranslatorQueueItems() : [];
    const item = items.find(row => row.id === queueId);
    if (!item) return;

    if (typeof updateTranslatorQueueItemStatus === 'function') {
        await updateTranslatorQueueItemStatus(queueId, 'cancelled');
    }

    if (item.status === 'running' && queueId === currentTranslatorQueueItemId) {
        if (typeof executeCancel === 'function' && !cancelRequested) {
            executeCancel();
        } else {
            cancelRequested = true;
            isPaused = false;
            if (typeof abortActiveTranslationRequests === 'function') {
                abortActiveTranslationRequests();
            }
        }
        showToast('Đang hủy truyện đang dịch trong hàng đợi.', 'warning');
    }

    await renderTranslationQueue();
}

async function pauseQueuedTranslatorItem(queueId) {
    if (typeof updateTranslatorQueueItemStatus === 'function') {
        await updateTranslatorQueueItemStatus(queueId, 'paused');
    }
    await renderTranslationQueue();
}

async function resumeQueuedTranslatorItem(queueId) {
    if (typeof updateTranslatorQueueItemStatus === 'function') {
        await updateTranslatorQueueItemStatus(queueId, 'queued');
    }
    await renderTranslationQueue();
    if (!isTranslating && typeof processNextTranslatorQueue === 'function') {
        setTimeout(() => processNextTranslatorQueue(), 0);
    }
}

function handleQueueDragStart(event, queueId) {
    const row = event.target?.closest?.('.translation-queue-item[data-queue-id]');
    if (!row || row.getAttribute('draggable') !== 'true') return;
    draggedTranslatorQueueItemId = queueId;
    row.classList.add('is-dragging');
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', queueId);
    }
}

function handleQueueDragOver(event, queueId) {
    if (!draggedTranslatorQueueItemId || draggedTranslatorQueueItemId === queueId) return;
    const row = event.target?.closest?.('.translation-queue-item[data-queue-id]');
    if (!row || row.getAttribute('draggable') !== 'true') return;
    event.preventDefault();
    row.classList.add('is-drag-over');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handleQueueDragLeave(event) {
    event.target?.closest?.('.translation-queue-item[data-queue-id]')?.classList?.remove('is-drag-over');
}

function handleQueueDragEnd(event) {
    draggedTranslatorQueueItemId = null;
    event.target?.closest?.('.translation-queue-item[data-queue-id]')?.classList?.remove('is-dragging', 'is-drag-over');
    document.querySelectorAll('.translation-queue-item.is-dragging, .translation-queue-item.is-drag-over').forEach(row => {
        row.classList.remove('is-dragging', 'is-drag-over');
    });
}

function buildReorderedQueueIds(items, draggedQueueId, targetQueueId) {
    const reorderableIds = items
        .filter(item => isQueueReorderable(item.status))
        .map(item => item.id);
    const fromIndex = reorderableIds.indexOf(draggedQueueId);
    const toIndex = reorderableIds.indexOf(targetQueueId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return items.map(item => item.id);
    }

    const [moved] = reorderableIds.splice(fromIndex, 1);
    reorderableIds.splice(toIndex, 0, moved);
    const nextReorderableIds = [...reorderableIds];
    return items.map(item => isQueueReorderable(item.status) ? nextReorderableIds.shift() : item.id);
}

async function handleQueueDrop(event, targetQueueId) {
    event.preventDefault();
    const draggedQueueId = draggedTranslatorQueueItemId || event.dataTransfer?.getData('text/plain');
    handleQueueDragEnd(event);
    if (!draggedQueueId || draggedQueueId === targetQueueId || typeof reorderTranslatorQueueItems !== 'function') {
        return;
    }

    const items = typeof getTranslatorQueueItems === 'function' ? await getTranslatorQueueItems() : [];
    const nextIds = buildReorderedQueueIds(items, draggedQueueId, targetQueueId);
    await reorderTranslatorQueueItems(nextIds);
    await renderTranslationQueue();
}

async function downloadQueuedTranslatorResult(sessionId) {
    const session = await getTranslatorSession(sessionId);
    if (typeof downloadTranslatorSessionResult !== 'function') {
        showToast('Không thể chuẩn bị file tải xuống trong phiên hiện tại.', 'error');
        return false;
    }
    return downloadTranslatorSessionResult(
        sessionId,
        session?.outputFileName || session?.fileName || 'translated_novel.txt'
    );
}

async function processNextTranslatorQueue() {
    if (isTranslating || translatorQueueAutoRunning || typeof claimNextTranslatorQueueItem !== 'function') return;
    const item = await claimNextTranslatorQueueItem();
    if (!item) {
        await renderTranslationQueue();
        return;
    }
    currentTranslatorQueueItemId = item.id;
    const session = await loadTranslatorSessionIntoWorkspace(item.sessionId);
    if (!session) {
        await updateTranslatorQueueItemStatus(item.id, 'failed');
        await renderTranslationQueue();
        return;
    }
    translatorQueueAutoRunning = true;
    await renderTranslationQueue();
    startTranslation().finally(() => {
        translatorQueueAutoRunning = false;
    });
}
