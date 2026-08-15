/**
 * Worker boundary for chapter scanning, exact-heading search and EPUB export.
 * JSZip is loaded lazily only for export so opening Translator has no ZIP cost.
 */
'use strict';

importScripts('chapter-rules.js', 'chapter-indexer.js', 'chapter-epub.js');

const cancelledRequests = new Set();
const lastProgressAt = new Map();
let jsZipLoaded = false;

function postProgress(requestId, phase, progress, detail = '') {
    if (cancelledRequests.has(requestId)) return;
    const ratio = progress && typeof progress === 'object'
        ? (Number(progress.ratio) || (Number(progress.total) > 0 ? Number(progress.completed) / Number(progress.total) : 0))
        : Number(progress);
    const now = Date.now();
    const previous = lastProgressAt.get(requestId) || 0;
    if (ratio < 1 && now - previous < 250) return;
    lastProgressAt.set(requestId, now);
    self.postMessage({
        type: 'progress',
        requestId,
        phase,
        progress: Math.max(0, Math.min(1, ratio || 0)),
        detail,
    });
}

function ensureJsZip() {
    if (jsZipLoaded && self.JSZip) return;
    importScripts('../../vendor/jszip.min.js');
    if (!self.JSZip) throw new Error('Không thể tải bộ đóng gói EPUB.');
    jsZipLoaded = true;
}

async function handleRequest(message) {
    const requestId = String(message.requestId || '');
    if (!requestId) throw new Error('Thiếu mã tác vụ chương.');

    if (message.type === 'scan') {
        return self.TranslatorChapterIndexer.scanChapterBlob(message.blob, {
            onProgress(progress) {
                postProgress(requestId, 'scan', progress, 'Đang nhận diện mục lục…');
            },
            shouldCancel: () => cancelledRequests.has(requestId),
        });
    }

    if (message.type === 'findHeading') {
        return self.TranslatorChapterIndexer.findHeadingInBlob(message.blob, message.query, {
            limit: 12,
            onProgress(progress) {
                postProgress(requestId, 'findHeading', progress, 'Đang tìm dòng tiêu đề…');
            },
            shouldCancel: () => cancelledRequests.has(requestId),
        });
    }

    if (message.type === 'exportEpub') {
        ensureJsZip();
        return self.TranslatorChapterEpub.buildChapterEpub(message.payload || {}, {
            JSZip: self.JSZip,
            onProgress(progress, detail) {
                postProgress(requestId, 'exportEpub', progress, detail || 'Đang tạo EPUB…');
            },
            shouldCancel: () => cancelledRequests.has(requestId),
        });
    }

    throw new Error(`Tác vụ chương không hợp lệ: ${message.type || 'unknown'}`);
}

self.addEventListener('message', async (event) => {
    const message = event.data || {};
    const requestId = String(message.requestId || '');
    if (message.type === 'cancel') {
        if (requestId) cancelledRequests.add(requestId);
        self.postMessage({ type: 'complete', requestId, cancelled: true });
        return;
    }

    try {
        const result = await handleRequest(message);
        if (cancelledRequests.has(requestId)) return;
        if (message.type === 'exportEpub' && result?.bytes instanceof Uint8Array) {
            self.postMessage({ type: 'complete', requestId, result }, [result.bytes.buffer]);
        } else {
            self.postMessage({ type: 'complete', requestId, result });
        }
    } catch (error) {
        if (cancelledRequests.has(requestId)) return;
        self.postMessage({
            type: 'error',
            requestId,
            message: error?.message || 'Không thể xử lý mục lục chương.',
        });
    } finally {
        cancelledRequests.delete(requestId);
        lastProgressAt.delete(requestId);
    }
});
