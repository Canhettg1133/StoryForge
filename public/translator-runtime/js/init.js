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
if (typeof selectGeminiModel === 'function') window.selectGeminiModel = selectGeminiModel;
if (typeof useCustomGeminiModel === 'function') window.useCustomGeminiModel = useCustomGeminiModel;
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
if (typeof activateGeminiDirect === 'function') window.activateGeminiDirect = activateGeminiDirect;
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
if (typeof retryIssueChunks === 'function') window.retryIssueChunks = retryIssueChunks;
if (typeof focusFirstIssueChunk === 'function') window.focusFirstIssueChunk = focusFirstIssueChunk;
if (typeof downloadMarkedIssueResult === 'function') window.downloadMarkedIssueResult = downloadMarkedIssueResult;
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

const TRANSLATOR_CLICK_ACTIONS = Object.freeze({
    toggleSettingsPanels: () => toggleSettingsPanels(),
    toggleHistoryPanel: () => toggleHistoryPanel(),
    toggleTranslationQueuePanel: () => toggleTranslationQueuePanel(),
    closeTranslationQueuePanel: () => toggleTranslationQueuePanel(false),
    toggleConfigGroup: element => toggleConfigGroup(element.dataset.actionValue),
    activateGeminiDirect: () => activateGeminiDirect(),
    addApiKey: () => addApiKey(),
    removeApiKey: element => removeApiKey(Number(element.dataset.actionIndex)),
    openImportApiKeysModal: () => openImportApiKeysModal(),
    exportApiKeys: () => exportApiKeys(),
    resetRotationAndRefresh: () => resetRotationAndRefresh(),
    fetchAIStudioFreeModels: () => fetchAIStudioFreeModels(),
    resetGeminiModels: () => resetGeminiModels(),
    useCustomGeminiModel: () => useCustomGeminiModel(),
    addProxyKey: () => addProxyKey(),
    removeProxyKey: element => removeProxyKey(Number(element.dataset.actionIndex)),
    openImportProxyKeysModal: element => openImportProxyKeysModal(element.dataset.actionValue),
    executeImportProxyKeys: element => executeImportProxyKeys(element.dataset.actionValue),
    closeProxyImportModal: element => closeProxyImportModal(element.dataset.actionValue),
    exportProxyKeys: element => exportProxyKeys(element.dataset.actionValue),
    copyExportedProxyKeys: element => copyExportedProxyKeys(element.dataset.actionValue),
    closeProxyKeyModal: element => closeProxyKeyModal(element.dataset.actionValue),
    applyProxyCustomModel: () => applyProxyCustomModel(),
    testProxyConnection: () => testProxyConnection(),
    addCustomProxyKey: () => addCustomProxyKey(),
    removeCustomProxyKey: element => removeCustomProxyKey(Number(element.dataset.actionIndex)),
    fetchCustomProxyModels: () => fetchCustomProxyModels(),
    testCustomProxyConnection: () => testCustomProxyConnection(),
    applyCustomProxyModelInput: () => selectCustomProxyModel(document.getElementById('customProxyModelInput')?.value),
    showStartServerGuide: () => showStartServerGuide(),
    testOllamaConnection: () => testOllamaConnection(),
    loadOllamaModelsDropdown: () => loadOllamaModelsDropdown(),
    applyModelPreset: element => applyModelPreset(element.dataset.actionValue),
    testOllamaTranslation: () => testOllamaTranslation(),
    copyCommand: element => copyCommand(element.dataset.actionValue),
    copyPresetCommand: element => {
        const preset = MODEL_PRESETS[element.dataset.actionValue];
        if (preset) return copyCommand(`ollama pull ${preset.recommended}`);
        return undefined;
    },
    exportHistory: () => exportHistory(),
    clearAllHistory: () => clearAllHistory(),
    setPromptTemplate: element => setPromptTemplate(element.dataset.actionValue),
    refreshCanonPackSelector: () => refreshCanonPackSelector(),
    applySelectedCanonPackToPrompt: () => applySelectedCanonPackToPrompt(),
    clearFile: () => clearFile(),
    selectStartChunk: element => selectStartChunk(Number(element.dataset.chunkIndex), Number(element.dataset.byteStart)),
    startTranslation: () => startTranslation(),
    downloadPartial: () => downloadPartial(),
    togglePause: () => togglePause(),
    confirmCancel: () => confirmCancel(),
    closeCancelModal: () => closeCancelModal(),
    executeCancel: () => executeCancel(),
    toggleChunkTracker: () => toggleChunkTracker(),
    copyResult: () => copyResult(),
    downloadResult: () => downloadResult(),
    pauseQueuedTranslatorItem: element => pauseQueuedTranslatorItem(element.dataset.queueId),
    resumeQueuedTranslatorItem: element => resumeQueuedTranslatorItem(element.dataset.queueId),
    cancelQueuedTranslatorItem: element => cancelQueuedTranslatorItem(element.dataset.queueId),
    removeQueuedTranslatorItem: element => removeQueuedTranslatorItem(element.dataset.queueId),
    downloadQueuedTranslatorResult: element => downloadQueuedTranslatorResult(element.dataset.sessionId),
    closeChunkDetail: () => closeChunkDetail(),
    retranslateChunk: element => retranslateChunk(Number(element.dataset.chunkIndex)),
    retranslateChunkAndClose: element => {
        const result = retranslateChunk(Number(element.dataset.chunkIndex));
        closeChunkDetail();
        return result;
    },
    editChunkManual: element => editChunkManual(Number(element.dataset.chunkIndex)),
    viewChunkDetail: element => viewChunkDetail(Number(element.dataset.chunkIndex)),
    retranslateAllFailed: () => retranslateAllFailed(),
    retryIssueChunks: element => retryIssueChunks({ source: element.dataset.issueSource }),
    focusFirstIssueChunk: () => focusFirstIssueChunk(),
    downloadMarkedIssueResult: () => downloadMarkedIssueResult(),
    copyExportedKeys: () => copyExportedKeys(),
    closeKeyModal: () => closeKeyModal(),
    executeImportApiKeys: () => executeImportApiKeys(),
    closeImportModal: () => closeImportModal(),
});

const TRANSLATOR_CHANGE_ACTIONS = Object.freeze({
    selectGeminiModel: element => selectGeminiModel(element.value),
    toggleProxyMode: () => toggleProxyMode(),
    updateProxyConfig: () => updateProxyConfig(),
    selectProxyModel: () => selectProxyModel(),
    toggleCustomProxyMode: () => toggleCustomProxyMode(),
    updateCustomProxyConfig: () => updateCustomProxyConfig(),
    selectCustomProxyModel: element => selectCustomProxyModel(element.value),
    toggleOllamaMode: () => toggleOllamaMode(),
    selectOllamaModel: () => selectOllamaModel(),
    importHistory: (_element, event) => importHistory(event),
    handleCanonPackToggle: () => handleCanonPackToggle(),
    selectCanonPack: (element) => {
        selectedCanonPackId = element.value;
        saveSettings();
        updateSettingsAccordions();
    },
});

const TRANSLATOR_INPUT_ACTIONS = Object.freeze({
    setCustomProxyModelSearch: element => setCustomProxyModelSearch(element.value),
    handleStartChunkSearchInput: () => handleStartChunkSearchInput(),
});

const TRANSLATOR_KEYDOWN_ACTIONS = Object.freeze({
    addProxyKey: () => addProxyKey(),
    addCustomProxyKey: () => addCustomProxyKey(),
});

function runTranslatorDelegatedAction(handlers, actionName, element, event) {
    const handler = handlers[actionName];
    if (!handler) return;
    if (element.dataset.stopPropagation === 'true') event.stopPropagation();
    try {
        const result = handler(element, event);
        if (result && typeof result.catch === 'function') {
            result.catch(error => console.error(`[TranslatorAction] ${actionName} failed:`, error));
        }
    } catch (error) {
        console.error(`[TranslatorAction] ${actionName} failed:`, error);
    }
}

document.addEventListener('click', (event) => {
    const element = event.target.closest('[data-click-action]');
    if (!element) return;
    runTranslatorDelegatedAction(TRANSLATOR_CLICK_ACTIONS, element.dataset.clickAction, element, event);
});

document.addEventListener('change', (event) => {
    const element = event.target.closest('[data-change-action]');
    if (!element) return;
    runTranslatorDelegatedAction(TRANSLATOR_CHANGE_ACTIONS, element.dataset.changeAction, element, event);
});

document.addEventListener('input', (event) => {
    const element = event.target.closest('[data-input-action]');
    if (!element) return;
    runTranslatorDelegatedAction(TRANSLATOR_INPUT_ACTIONS, element.dataset.inputAction, element, event);
});

document.addEventListener('keydown', (event) => {
    const element = event.target.closest('[data-keydown-action]');
    if (!element || event.key !== 'Enter') return;
    event.preventDefault();
    runTranslatorDelegatedAction(TRANSLATOR_KEYDOWN_ACTIONS, element.dataset.keydownAction, element, event);
});

for (const eventName of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) {
    document.addEventListener(eventName, (event) => {
        const row = event.target.closest('.translation-queue-item[data-queue-id]');
        if (!row) return;
        const queueId = row.dataset.queueId;
        if (eventName === 'dragstart') handleQueueDragStart(event, queueId);
        if (eventName === 'dragover') handleQueueDragOver(event, queueId);
        if (eventName === 'dragleave') handleQueueDragLeave(event);
        if (eventName === 'drop') handleQueueDrop(event, queueId);
        if (eventName === 'dragend') handleQueueDragEnd(event);
    });
}

console.log('✅ All modules loaded and exposed globally');
