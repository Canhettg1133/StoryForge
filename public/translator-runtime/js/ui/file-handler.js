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

function processFile(file) {
    if (!file.name.endsWith('.txt')) {
        showToast('Chỉ hỗ trợ file .txt', 'error');
        return;
    }

    originalFileName = file.name.replace('.txt', '_translated.txt');

    const reader = new FileReader();
    reader.onload = function (e) {
        document.getElementById('originalText').value = e.target.result;
        updateStats();
        showFileInfo(file);
        showToast('Đã tải file thành công!', 'success');
    };
    reader.onerror = function () {
        showToast('Lỗi khi đọc file!', 'error');
    };
    reader.readAsText(file, 'UTF-8');
}

function showFileInfo(file) {
    document.getElementById('fileInfo').style.display = 'flex';
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
}

function clearFile() {
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('originalText').value = '';
    updateStats();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
