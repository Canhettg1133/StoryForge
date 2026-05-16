/**
 * Novel Translator Pro - File Handler
 * Xử lý upload, download, drag-drop
 */

// ============================================
// FILE HANDLING
// ============================================
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        processFile(file);
        event.target.value = '';
    }
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

function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('uploadArea').classList.remove('dragover');

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.txt')) {
            processFile(file);
        } else {
            showToast('Chỉ hỗ trợ file .txt', 'error');
        }
    }
}

async function processFile(file) {
    if (!file.name.endsWith('.txt')) {
        showToast('Chỉ hỗ trợ file .txt', 'error');
        return;
    }

    originalFileName = file.name.replace('.txt', '_translated.txt');

    if (typeof isLargeFileCandidate === 'function' && isLargeFileCandidate(file)) {
        try {
            await processLargeFile(file);
        } catch (error) {
            console.error('Large file load error:', error);
            showToast('Lỗi khi đọc bản xem trước của file lớn.', 'error');
        }
        return;
    }

    processTextFile(file);
}

function resetSourceModeToText() {
    currentSourceMode = TRANSLATOR_SOURCE_MODES.TEXT;
    currentSourceFile = null;
    largeFileMeta = null;
    largeFileByteCursor = 0;
    translatedBlobParts = [];

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
}

function processTextFile(file) {
    resetSourceModeToText();

    const reader = new FileReader();
    reader.onload = function (e) {
        document.getElementById('originalText').value = e.target.result;
        updateStats();
        showFileInfo(file, { mode: 'text' });
        showToast('Đã tải file thành công!', 'success');
    };
    reader.onerror = function () {
        showToast('Lỗi khi đọc file!', 'error');
    };
    reader.readAsText(file, 'UTF-8');
}

async function processLargeFile(file) {
    currentSourceMode = TRANSLATOR_SOURCE_MODES.LARGE_FILE;
    currentSourceFile = file;
    largeFileByteCursor = 0;
    translatedChunks = [];
    translatedBlobParts = [];
    completedChunks = 0;
    totalChunksCount = 0;
    currentHistoryId = null;

    const chunkSize = parseInt(document.getElementById('chunkSize')?.value, 10) || 4500;
    const previewText = typeof readFilePreview === 'function'
        ? await readFilePreview(file)
        : await file.slice(0, Math.min(file.size, 64 * 1024)).text();
    const estimate = typeof estimateChunkCountFromPreview === 'function'
        ? estimateChunkCountFromPreview({ fileSize: file.size, previewText, chunkSize })
        : { count: Math.max(1, Math.ceil(file.size / Math.max(1, chunkSize * 2))), approximate: true };

    largeFileMeta = {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        previewText,
        estimatedChunks: estimate.count,
        approximate: true,
    };

    const originalText = document.getElementById('originalText');
    if (originalText) {
        originalText.value = previewText;
        originalText.readOnly = true;
        originalText.classList.add('large-file-preview');
    }

    const title = document.getElementById('sourcePreviewTitle');
    if (title) title.textContent = 'Nội dung gốc / Bản xem trước';

    showFileInfo(file, { mode: 'large-file', estimatedChunks: estimate.count });
    updateLargeFileNotice();
    updateStats();
    showToast('Đã bật chế độ file lớn. Ứng dụng chỉ đọc phần cần dịch để tránh lag.', 'success');
}

function updateLargeFileNotice() {
    const notice = document.getElementById('sourceModeNotice');
    if (!notice || currentSourceMode !== TRANSLATOR_SOURCE_MODES.LARGE_FILE || !largeFileMeta) return;

    notice.style.display = 'grid';
    notice.innerHTML = `
        <div class="source-mode-card">
            <strong>Chế độ file lớn</strong>
            <span>Không tải toàn bộ truyện lên giao diện. Chỉ hiển thị bản xem trước và đọc từng phần khi dịch.</span>
        </div>
        <div class="source-mode-metrics">
            <span>${formatFileSize(largeFileMeta.size)}</span>
            <span>~${largeFileMeta.estimatedChunks.toLocaleString('vi-VN')} chunk ước tính</span>
            <span>Preview ${largeFileMeta.previewText.length.toLocaleString('vi-VN')} ký tự</span>
        </div>
    `;
}

function showFileInfo(file, options = {}) {
    document.getElementById('fileInfo').style.display = 'flex';
    document.getElementById('fileName').textContent = file.name;
    const modeText = options.mode === 'large-file'
        ? `File lớn • ${formatFileSize(file.size)}`
        : `Văn bản thường • ${formatFileSize(file.size)}`;
    document.getElementById('fileSize').textContent = modeText;
}

function clearFile() {
    resetSourceModeToText();
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('originalText').value = '';
    document.getElementById('translatedText').value = '';
    document.getElementById('resultSection').style.display = 'none';
    translatedChunks = [];
    originalChunks = [];
    translatedBlobParts = [];
    completedChunks = 0;
    totalChunksCount = 0;
    updateStats();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
