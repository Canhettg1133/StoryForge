import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, ChevronsUpDown, RefreshCw, Save, Sparkles, XCircle } from 'lucide-react';

import keyManager from '../../services/ai/keyManager.js';
import {
  fetchGeminiDirectModels,
  GeminiDirectModelsError,
  normalizeGeminiDirectModelId,
} from '../../services/ai/geminiDirectModels.js';
import modelRouter, { PROVIDERS } from '../../services/ai/router.js';

function getSafeFetchError(error) {
  if (error instanceof GeminiDirectModelsError) return error.message;
  return 'Không lấy được danh sách model. Hãy kiểm tra mạng và thử lại.';
}

export default function GeminiDirectModelManager({
  fetchModels = fetchGeminiDirectModels,
  baseUrl,
  keyRevision = 0,
  onCatalogChange,
}) {
  const [catalog, setCatalog] = useState(() => modelRouter.getDirectModelCatalog());
  const [selectedModel, setSelectedModel] = useState(() => modelRouter.getDirectModel());
  const [manualModel, setManualModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const activeRequestRef = useRef(null);
  const mountedRef = useRef(true);
  const keyCount = keyManager.getKeyCount(PROVIDERS.GEMINI_DIRECT);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current?.abort();
    };
  }, []);

  const options = useMemo(() => {
    const items = new Map();
    if (selectedModel) {
      items.set(selectedModel, {
        id: selectedModel,
        label: selectedModel,
        source: 'manual',
      });
    }
    catalog.forEach((model) => items.set(model.id, model));
    return [...items.values()];
  }, [catalog, selectedModel]);

  const selectModel = (modelId) => {
    const saved = modelRouter.setDirectModel(modelId);
    setSelectedModel(saved);
    setStatus({
      type: 'success',
      text: `Đã chọn ${saved} cho Gemini Direct.`,
    });
    onCatalogChange?.();
  };

  const handleFetchModels = async () => {
    const apiKey = keyManager.getKeys(PROVIDERS.GEMINI_DIRECT)[0]?.key || '';
    if (!apiKey) {
      setStatus({
        type: 'error',
        text: 'Hãy thêm ít nhất một API key Gemini Direct trước khi lấy model.',
      });
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLoading(true);
    setStatus({ type: 'pending', text: 'Đang lấy danh sách model từ Google AI Studio…' });

    try {
      const fetchedCatalog = await fetchModels({ apiKey, baseUrl, signal: controller.signal });
      if (controller.signal.aborted) return;
      const savedCatalog = modelRouter.setDirectModelCatalog(fetchedCatalog);
      setCatalog(savedCatalog);
      const currentStillAvailable = savedCatalog.some((model) => model.id === selectedModel);
      setStatus({
        type: currentStillAvailable ? 'success' : 'warn',
        text: currentStillAvailable
          ? `Đã lấy ${savedCatalog.length} model. Model hiện tại không thay đổi.`
          : `Đã lấy ${savedCatalog.length} model; vẫn giữ model hiện tại vì catalog mới không có model đó.`,
      });
      onCatalogChange?.();
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus({ type: 'error', text: getSafeFetchError(error) });
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  };

  const handleManualModel = () => {
    const normalized = normalizeGeminiDirectModelId(manualModel);
    if (!normalized) {
      setStatus({
        type: 'error',
        text: 'Model ID phải là model văn bản Gemini hoặc Gemma hợp lệ.',
      });
      return;
    }

    modelRouter.setDirectModel(normalized);
    setSelectedModel(normalized);
    setManualModel('');
    const verified = catalog.some((model) => model.id === normalized);
    setStatus({
      type: verified ? 'success' : 'warn',
      text: verified
        ? `Đã chọn ${normalized} cho Gemini Direct.`
        : `Đã lưu ${normalized}; model này chưa xác minh trong lần lấy gần nhất.`,
    });
    onCatalogChange?.();
  };

  return (
    <div className="gemini-direct-model-manager" data-key-revision={keyRevision}>
      <div className="model-default-block">
        <h3 className="model-default-block__heading">Model Gemini Direct</h3>
        <div className="settings-select-callout">
          <div className="settings-select-callout__copy">
            <div className="settings-select-callout__title">
              <Sparkles size={15} /> Model mặc định đang dùng
            </div>
            <div className="settings-select-callout__value">{selectedModel}</div>
            <div className="settings-select-callout__hint">
              Mọi tác vụ Gemini Direct dùng đúng model này; chế độ chất lượng không tự đổi model.
            </div>
          </div>
          <div className="settings-select-shell">
            <select
              className="select settings-select-shell__control"
              value={selectedModel}
              aria-label="Chọn model Gemini Direct"
              onChange={(event) => selectModel(event.target.value)}
              disabled={loading}
            >
              {options.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}{model.source === 'manual' ? ' · chưa xác minh' : ''}
                </option>
              ))}
            </select>
            <span className="settings-select-shell__prompt">Bấm để đổi model</span>
            <ChevronsUpDown size={16} className="settings-select-shell__icon" />
          </div>
        </div>
      </div>

      <div className="settings-action-row settings-action-row--spaced">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleFetchModels}
          disabled={loading || keyCount === 0}
          title={keyCount === 0 ? 'Thêm API key Gemini Direct trước.' : undefined}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
          {loading ? 'Đang lấy…' : 'Lấy models'}
        </button>
        <span className="settings-hint gemini-direct-model-count">
          {catalog.length} model đã lưu
        </span>
      </div>

      <div className="form-group gemini-direct-manual-model">
        <label className="form-label" htmlFor="gemini-direct-manual-model">Nhập model thủ công</label>
        <div className="settings-input-row">
          <input
            id="gemini-direct-manual-model"
            className="input"
            value={manualModel}
            onChange={(event) => setManualModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && manualModel.trim()) handleManualModel();
            }}
            aria-label="Nhập model Gemini Direct thủ công"
            placeholder="gemini-2.5-pro hoặc gemma-3-27b-it"
            autoComplete="off"
            spellCheck={false}
            disabled={loading}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleManualModel}
            disabled={loading || !manualModel.trim()}
          >
            <Save size={14} /> Dùng model nhập tay
          </button>
        </div>
        <p className="settings-hint">Model ngoài catalog vẫn được giữ nguyên và đánh dấu chưa xác minh.</p>
      </div>

      {status ? (
        <div
          className={`settings-test-result ${status.type === 'warn' ? 'pending' : status.type}`}
          role={status.type === 'error' ? 'alert' : 'status'}
          aria-live={status.type === 'error' ? 'assertive' : 'polite'}
        >
          {status.type === 'success' ? <CheckCircle size={14} /> : null}
          {status.type === 'pending' ? <RefreshCw size={14} className="animate-spin" /> : null}
          {status.type === 'warn' || status.type === 'error' ? <XCircle size={14} /> : null}
          {status.text}
        </div>
      ) : null}
    </div>
  );
}
