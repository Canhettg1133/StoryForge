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
window.deleteFromHistory = deleteFromHistory;
window.clearAllHistory = clearAllHistory;
window.exportHistory = exportHistory;
window.importHistory = importHistory;
window.exportApiKeys = exportApiKeys;
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
if (typeof initProxyUI === 'function') initProxyUI();

// Chunk tracker functions
if (typeof retranslateChunk === 'function') window.retranslateChunk = retranslateChunk;
if (typeof retranslateAllFailed === 'function') window.retranslateAllFailed = retranslateAllFailed;
if (typeof viewChunkDetail === 'function') window.viewChunkDetail = viewChunkDetail;
if (typeof closeChunkDetail === 'function') window.closeChunkDetail = closeChunkDetail;
if (typeof editChunkManual === 'function') window.editChunkManual = editChunkManual;
if (typeof toggleChunkTracker === 'function') window.toggleChunkTracker = toggleChunkTracker;

console.log('✅ All modules loaded and exposed globally');
