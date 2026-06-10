/**
 * Novel Translator Pro - Init (Load cuối cùng)
 * Expose tất cả functions sau khi modules đã load
 */

// ============================================
// EXPOSE GLOBALLY - Chạy sau khi tất cả modules load
// ============================================
window.addApiKey = addApiKey;
window.removeApiKey = removeApiKey;
window.resetRotationAndRefresh = resetRotationAndRefresh;
window.startTranslation = startTranslation;
window.togglePause = togglePause;
window.confirmCancel = confirmCancel;
window.closeCancelModal = closeCancelModal;
window.executeCancel = executeCancel;
window.cancelTranslation = cancelTranslation;
window.copyResult = copyResult;
window.downloadResult = downloadResult;
window.downloadPartial = downloadPartial;
window.setPromptTemplate = setPromptTemplate;
window.clearFile = clearFile;
window.continueFromHistory = continueFromHistory;
window.loadFromHistory = loadFromHistory;
if (typeof downloadHistoryResult === 'function') window.downloadHistoryResult = downloadHistoryResult;
window.deleteFromHistory = deleteFromHistory;
window.clearAllHistory = clearAllHistory;
window.exportHistory = exportHistory;
window.importHistory = importHistory;
window.exportApiKeys = exportApiKeys;
if (typeof fetchAIStudioFreeModels === 'function') window.fetchAIStudioFreeModels = fetchAIStudioFreeModels;
if (typeof selectAIStudioFetchedModel === 'function') window.selectAIStudioFetchedModel = selectAIStudioFetchedModel;
if (typeof selectOnlyGeminiModel === 'function') window.selectOnlyGeminiModel = selectOnlyGeminiModel;
if (typeof updateModelRpd === 'function') window.updateModelRpd = updateModelRpd;
window.copyExportedKeys = copyExportedKeys;
window.closeKeyModal = closeKeyModal;
window.openImportApiKeysModal = openImportApiKeysModal;
window.executeImportApiKeys = executeImportApiKeys;
window.closeImportModal = closeImportModal;
window.listKeys = () => {
    console.table(apiKeys.map((key, i) => ({ '#': i + 1, 'Key': key })));
    return apiKeys;
};

// Ollama functions
if (typeof testOllamaConnection === 'function') window.testOllamaConnection = testOllamaConnection;
if (typeof loadOllamaModels === 'function') window.loadOllamaModels = loadOllamaModels;
if (typeof toggleOllama === 'function') window.toggleOllama = toggleOllama;
if (typeof selectOllamaModel === 'function') window.selectOllamaModel = selectOllamaModel;

// Proxy functions
if (typeof toggleProxyMode === 'function') window.toggleProxyMode = toggleProxyMode;
if (typeof testProxyConnection === 'function') window.testProxyConnection = testProxyConnection;
if (typeof selectProxyModel === 'function') window.selectProxyModel = selectProxyModel;
if (typeof updateProxyConfig === 'function') window.updateProxyConfig = updateProxyConfig;
if (typeof addProxyKey === 'function') window.addProxyKey = addProxyKey;
if (typeof removeProxyKey === 'function') window.removeProxyKey = removeProxyKey;
if (typeof openImportProxyKeysModal === 'function') window.openImportProxyKeysModal = openImportProxyKeysModal;
if (typeof executeImportProxyKeys === 'function') window.executeImportProxyKeys = executeImportProxyKeys;
if (typeof updateProxyImportPreview === 'function') window.updateProxyImportPreview = updateProxyImportPreview;
if (typeof exportProxyKeys === 'function') window.exportProxyKeys = exportProxyKeys;
if (typeof copyExportedProxyKeys === 'function') window.copyExportedProxyKeys = copyExportedProxyKeys;
if (typeof closeProxyKeyModal === 'function') window.closeProxyKeyModal = closeProxyKeyModal;
if (typeof closeProxyImportModal === 'function') window.closeProxyImportModal = closeProxyImportModal;
if (typeof toggleCustomProxyMode === 'function') window.toggleCustomProxyMode = toggleCustomProxyMode;
if (typeof updateCustomProxyConfig === 'function') window.updateCustomProxyConfig = updateCustomProxyConfig;
if (typeof addCustomProxyKey === 'function') window.addCustomProxyKey = addCustomProxyKey;
if (typeof removeCustomProxyKey === 'function') window.removeCustomProxyKey = removeCustomProxyKey;
if (typeof fetchCustomProxyModels === 'function') window.fetchCustomProxyModels = fetchCustomProxyModels;
if (typeof selectCustomProxyModel === 'function') window.selectCustomProxyModel = selectCustomProxyModel;
if (typeof testCustomProxyConnection === 'function') window.testCustomProxyConnection = testCustomProxyConnection;
if (typeof initProxyUI === 'function') initProxyUI();

// Chunk tracker functions
if (typeof retranslateChunk === 'function') window.retranslateChunk = retranslateChunk;
if (typeof retranslateAllFailed === 'function') window.retranslateAllFailed = retranslateAllFailed;
if (typeof viewChunkDetail === 'function') window.viewChunkDetail = viewChunkDetail;
if (typeof closeChunkDetail === 'function') window.closeChunkDetail = closeChunkDetail;
if (typeof editChunkManual === 'function') window.editChunkManual = editChunkManual;
if (typeof toggleChunkTracker === 'function') window.toggleChunkTracker = toggleChunkTracker;

// Translator local session, start search, and queue functions
if (typeof handleStartChunkSearchInput === 'function') window.handleStartChunkSearchInput = handleStartChunkSearchInput;
if (typeof selectStartChunk === 'function') window.selectStartChunk = selectStartChunk;
if (typeof openQueueFilePicker === 'function') window.openQueueFilePicker = openQueueFilePicker;
if (typeof handleQueueFileSelect === 'function') window.handleQueueFileSelect = handleQueueFileSelect;
if (typeof startTranslatorQueue === 'function') window.startTranslatorQueue = startTranslatorQueue;
if (typeof toggleTranslationQueuePanel === 'function') window.toggleTranslationQueuePanel = toggleTranslationQueuePanel;
if (typeof removeQueuedTranslatorItem === 'function') window.removeQueuedTranslatorItem = removeQueuedTranslatorItem;
if (typeof cancelQueuedTranslatorItem === 'function') window.cancelQueuedTranslatorItem = cancelQueuedTranslatorItem;
if (typeof pauseQueuedTranslatorItem === 'function') window.pauseQueuedTranslatorItem = pauseQueuedTranslatorItem;
if (typeof resumeQueuedTranslatorItem === 'function') window.resumeQueuedTranslatorItem = resumeQueuedTranslatorItem;
if (typeof downloadQueuedTranslatorResult === 'function') window.downloadQueuedTranslatorResult = downloadQueuedTranslatorResult;
if (typeof handleQueueDragStart === 'function') window.handleQueueDragStart = handleQueueDragStart;
if (typeof handleQueueDragOver === 'function') window.handleQueueDragOver = handleQueueDragOver;
if (typeof handleQueueDragLeave === 'function') window.handleQueueDragLeave = handleQueueDragLeave;
if (typeof handleQueueDrop === 'function') window.handleQueueDrop = handleQueueDrop;
if (typeof handleQueueDragEnd === 'function') window.handleQueueDragEnd = handleQueueDragEnd;

console.log('✅ All modules loaded and exposed globally');
