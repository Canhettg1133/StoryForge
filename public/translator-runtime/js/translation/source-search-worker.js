importScripts('./source-reader.js?v=22');

const activeRequests = new Map();

self.addEventListener('message', async (event) => {
    const message = event.data || {};
    const requestId = String(message.requestId || '');

    if (message.type === 'cancel') {
        activeRequests.get(requestId)?.abort();
        activeRequests.delete(requestId);
        return;
    }
    if (message.type !== 'scan' || !requestId) return;

    const controller = new AbortController();
    activeRequests.set(requestId, controller);

    try {
        const result = await self.TranslatorLargeFileSource.scanTranslatorSource(
            message.file,
            message.query,
            {
                ...(message.options || {}),
                signal: controller.signal,
                cooperative: false,
                onProgress: progress => {
                    self.postMessage({ type: 'progress', requestId, progress });
                },
            }
        );
        if (!controller.signal.aborted) {
            self.postMessage({ type: 'complete', requestId, ...result });
        }
    } catch (error) {
        if (!controller.signal.aborted) {
            self.postMessage({
                type: 'error',
                requestId,
                message: error?.message || 'Không thể quét file truyện.',
            });
        }
    } finally {
        activeRequests.delete(requestId);
    }
});
