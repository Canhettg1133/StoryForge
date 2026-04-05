import React, { useMemo } from 'react';
import keyManager from '../../../../services/ai/keyManager';
import {
  DIRECT_MODELS,
  PROXY_MODELS,
} from '../../../../services/ai/router';
import {
  ANALYSIS_CONFIG,
  ANALYSIS_PROVIDERS,
} from '../../../../services/analysis/analysisConfig';

const LAYER_OPTIONS = [
  { id: 'l1', label: 'L1 Cấu trúc' },
  { id: 'l2', label: 'L2 Sự kiện' },
  { id: 'l3', label: 'L3 Thế giới' },
  { id: 'l4', label: 'L4 Nhân vật' },
  { id: 'l5', label: 'L5 Quan hệ' },
  { id: 'l6', label: 'L6 Văn phong' },
];

const RUN_MODE_OPTIONS = [
  {
    id: 'fast',
    label: 'Fast',
    description: 'Nhanh nhất, ưu tiên tốc độ.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Cân bằng chất lượng và chi phí.',
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Kỹ hơn, chạy coherence/review nghiêm hơn.',
  },
];

function formatWords(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function getActiveDirectModelIds() {
  try {
    const activeRaw = localStorage.getItem('sf-active-direct-models');
    if (!activeRaw) {
      return [];
    }

    const parsed = JSON.parse(activeRaw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getModelOptions(provider) {
  if (provider === ANALYSIS_PROVIDERS.GEMINI_DIRECT) {
    const activeIds = new Set(getActiveDirectModelIds());
    const source = DIRECT_MODELS.filter((model) => activeIds.size === 0 || activeIds.has(model.id));
    return source.map((model) => ({
      id: model.id,
      label: model.label,
    }));
  }

  return PROXY_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
  }));
}

function normalizeKeyList(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return [...new Set(items
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function ProviderKeyInput({
  provider,
  title,
  list,
  inputValue,
  listField,
  inputField,
  config,
  onChange,
  disabled,
}) {
  const normalized = normalizeKeyList(list);

  const addKey = () => {
    const nextKey = String(inputValue || '').trim();
    if (!nextKey) {
      return;
    }

    if (normalized.includes(nextKey)) {
      onChange?.({
        ...config,
        [inputField]: '',
      });
      return;
    }

    if (provider) {
      keyManager.addKey(provider, nextKey);
    }

    onChange?.({
      ...config,
      [listField]: [...normalized, nextKey],
      [inputField]: '',
    });
  };

  const removeKey = (keyToRemove) => {
    if (provider) {
      const existing = keyManager.getKeys(provider) || [];
      const removeIndex = existing.findIndex((item) => item?.key === keyToRemove);
      if (removeIndex >= 0) {
        keyManager.removeKey(provider, removeIndex);
      }
    }

    onChange?.({
      ...config,
      [listField]: normalized.filter((item) => item !== keyToRemove),
    });
  };

  return (
    <div className="analysis-key-block">
      <label>
        <span>{title}</span>
        <div className="analysis-key-input-row">
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Nhập 1 key rồi bấm Thêm"
            value={inputValue || ''}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              [inputField]: event.target.value,
            })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addKey();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || !String(inputValue || '').trim()}
            onClick={addKey}
          >
            Thêm
          </button>
        </div>
      </label>

      {normalized.length > 0 && (
        <div className="analysis-key-list">
          {normalized.map((key) => (
            <button
              type="button"
              key={`${title}-${key}`}
              className="analysis-key-chip"
              onClick={() => removeKey(key)}
              disabled={disabled}
              title="Bấm để xóa key này"
            >
              {`${key.slice(0, 6)}••••${key.slice(-4)}`} ×
            </button>
          ))}
        </div>
      )}

      {normalized.length === 0 && (
        <p className="muted">Chưa có key nhập tay. Hệ thống sẽ dùng key trên server nếu đã cấu hình.</p>
      )}
    </div>
  );
}

export default function AnalysisConfig({
  corpus,
  config,
  onChange,
  disabled = false,
}) {
  const activeChunkSize = Math.max(
    1,
    Number(config?.analysisChunkSize || ANALYSIS_CONFIG.session.maxInputWords),
  );
  const estimatedSessions = useMemo(() => {
    const words = Math.max(0, Number(corpus?.wordCount) || 0);
    return Math.max(1, Math.ceil(words / activeChunkSize));
  }, [activeChunkSize, corpus?.wordCount]);

  const estimatedMinutes = useMemo(() => {
    const maxParts = Math.max(1, Number(config?.maxParts) || 3);
    return Math.max(1, Math.ceil((estimatedSessions * maxParts * 12) / 60));
  }, [config?.maxParts, estimatedSessions]);

  const selectedLayers = Array.isArray(config?.layers) ? config.layers : [];
  const modelOptions = useMemo(
    () => getModelOptions(config?.provider),
    [config?.provider],
  );

  const toggleLayer = (layerId) => {
    const exists = selectedLayers.includes(layerId);
    let nextLayers = exists
      ? selectedLayers.filter((layer) => layer !== layerId)
      : [...selectedLayers, layerId];

    if (nextLayers.length === 0) {
      nextLayers = ['l1'];
    }

    onChange?.({
      ...config,
      layers: nextLayers,
    });
  };

  return (
    <div className="analysis-config">
      <label>
        <span>Nhà cung cấp</span>
        <select
          value={config.provider}
          disabled={disabled}
          onChange={(event) => {
            const nextProvider = event.target.value;
            const nextOptions = getModelOptions(nextProvider);
            const nextModel = nextOptions.some((option) => option.id === config.model)
              ? config.model
              : (nextOptions[0]?.id || '');

            onChange?.({
              ...config,
              provider: nextProvider,
              model: nextModel,
            });
          }}
        >
          <option value={ANALYSIS_PROVIDERS.GEMINI_PROXY}>Gemini Proxy</option>
          <option value={ANALYSIS_PROVIDERS.GEMINI_DIRECT}>Gemini trực tiếp</option>
        </select>
      </label>

      <label>
        <span>Mô hình</span>
        <select
          value={config.model}
          disabled={disabled}
          onChange={(event) => onChange?.({ ...config, model: event.target.value })}
        >
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <div className="analysis-config-row">
        <label>
          <span>Chế độ incident-first</span>
          <select
            value={config.runMode || 'balanced'}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              runMode: event.target.value,
            })}
          >
            {RUN_MODE_OPTIONS.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label} - {mode.description}
              </option>
            ))}
          </select>
        </label>

        <label className="analysis-layer-item" style={{ alignSelf: 'end' }}>
          <input
            type="checkbox"
            checked={Boolean(config.enableIncidentAiPipeline)}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              enableIncidentAiPipeline: event.target.checked,
            })}
          />
          <span>Bật AI step-pipeline cho incident</span>
        </label>
      </div>

      <div className="analysis-config-row">
        <label>
          <span>Số phần output tối đa</span>
          <input
            type="number"
            min={1}
            max={12}
            step={1}
            value={config.maxParts}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              maxParts: Math.max(1, Math.min(12, Number(event.target.value) || 3)),
            })}
          />
        </label>

        <label>
          <span>Nhiệt độ</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={config.temperature}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              temperature: Math.max(0, Math.min(1, Number(event.target.value) || 0.2)),
            })}
          />
        </label>
      </div>

      <div className="analysis-config-row">
        <label>
          <span>URL Gemini Proxy</span>
          <input
            type="text"
            placeholder="/api/proxy"
            value={config.geminiProxyUrl || ''}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              geminiProxyUrl: event.target.value,
            })}
          />
        </label>

        <label>
          <span>URL Gemini trực tiếp</span>
          <input
            type="text"
            placeholder="https://generativelanguage.googleapis.com"
            value={config.geminiDirectUrl || ''}
            disabled={disabled}
            onChange={(event) => onChange?.({
              ...config,
              geminiDirectUrl: event.target.value,
            })}
          />
        </label>
      </div>

      <ProviderKeyInput
        provider={ANALYSIS_PROVIDERS.GEMINI_PROXY}
        title="Danh sách khóa Gemini Proxy (nhiều key)"
        list={config.geminiProxyApiKeys}
        inputValue={config.geminiProxyKeyInput}
        listField="geminiProxyApiKeys"
        inputField="geminiProxyKeyInput"
        config={config}
        onChange={onChange}
        disabled={disabled}
      />

      <ProviderKeyInput
        provider={ANALYSIS_PROVIDERS.GEMINI_DIRECT}
        title="Danh sách khóa Gemini trực tiếp (nhiều key)"
        list={config.geminiDirectApiKeys}
        inputValue={config.geminiDirectKeyInput}
        listField="geminiDirectApiKeys"
        inputField="geminiDirectKeyInput"
        config={config}
        onChange={onChange}
        disabled={disabled}
      />

      <div className="analysis-layer-selector">
        <span>Lớp phân tích (L1-L6)</span>
        <div className="analysis-layer-grid">
          {LAYER_OPTIONS.map((layer) => (
            <label key={layer.id} className="analysis-layer-item">
              <input
                type="checkbox"
                checked={selectedLayers.includes(layer.id)}
                disabled={disabled}
                onChange={() => toggleLayer(layer.id)}
              />
              <span>{layer.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="analysis-estimate">
        <span>
          Corpus: {formatWords(corpus?.wordCount)} từ / {formatWords(corpus?.chunkCount)} chunk
        </span>
        <span>
          Chunk đang dùng để phân tích: {formatWords(activeChunkSize)} từ/chunk
        </span>
        <span>
          Ước tính session: {estimatedSessions} | Thời gian: khoảng {estimatedMinutes} phút
        </span>
      </div>
    </div>
  );
}


