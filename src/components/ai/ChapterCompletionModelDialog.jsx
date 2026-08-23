import React, { useEffect, useId, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import aiService from '../../services/ai/client.js';
import { PROVIDERS } from '../../services/ai/router.js';
import {
  getAvailableModelOptions,
  setOllamaModelCatalog,
} from '../../services/ai/modelOptions.js';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import './ChapterCompletionModelDialog.css';

let ollamaCatalogRequest = null;

function loadOllamaCatalog() {
  if (!ollamaCatalogRequest) {
    ollamaCatalogRequest = aiService.testConnection(PROVIDERS.OLLAMA)
      .finally(() => {
        ollamaCatalogRequest = null;
      });
  }
  return ollamaCatalogRequest;
}

export default function ChapterCompletionModelDialog({
  modelState,
  onCancel,
  onConfirm,
}) {
  const reactId = useId();
  const titleId = `chapter-completion-model-title${reactId}`;
  const descriptionId = `chapter-completion-model-description${reactId}`;
  const [selectedModel, setSelectedModel] = useState('');
  const [options, setOptions] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadError, setLoadError] = useState('');
  const open = Boolean(modelState);
  const dialogRef = useModalAccessibility({ open, onClose: onCancel });

  useEffect(() => {
    if (!modelState) return;
    setSelectedModel(modelState.selectedModel || '');
    setOptions(modelState.options || []);
    setLoadError('');

    if (modelState.provider !== PROVIDERS.OLLAMA) {
      setLoadingModels(false);
      return;
    }

    let cancelled = false;
    setLoadingModels(true);
    loadOllamaCatalog().then((result) => {
      if (cancelled) return;
      if (!result?.success) {
        setLoadError(result?.error || 'Không lấy được danh sách model Ollama. Vẫn có thể dùng model hiện tại.');
        return;
      }
      const ollamaModels = setOllamaModelCatalog(result.models || []);
      const nextOptions = getAvailableModelOptions(PROVIDERS.OLLAMA, { ollamaModels });
      setOptions(nextOptions);
      setSelectedModel((current) => (
        !current || nextOptions.some((option) => option.id === current) ? current : ''
      ));
    }).catch(() => {
      if (!cancelled) {
        setLoadError('Không lấy được danh sách model Ollama. Vẫn có thể dùng model hiện tại.');
      }
    }).finally(() => {
      if (!cancelled) setLoadingModels(false);
    });

    return () => {
      cancelled = true;
    };
  }, [modelState]);

  if (!modelState) return null;

  return (
    <div className="chapter-completion-model-overlay" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="chapter-completion-model-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="chapter-completion-model-dialog__header">
          <div>
            <h2 id={titleId}>Chọn model hoàn thành chương</h2>
            <p id={descriptionId}>{modelState.providerLabel}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel} aria-label="Đóng chọn model">
            <X size={17} />
          </button>
        </div>

        <div className="chapter-completion-model-dialog__body">
          <label className="form-label" htmlFor={`chapter-completion-model-select${reactId}`}>
            Model cho tác vụ này
          </label>
          <select
            id={`chapter-completion-model-select${reactId}`}
            className="select"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
          >
            <option value="">
              Theo model hiện tại — {modelState.currentModel || 'chưa chọn model'}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}{option.meta ? ` — ${option.meta}` : ''}
              </option>
            ))}
          </select>
          <p className="chapter-completion-model-dialog__hint">
            Nếu provider có Flash, model Flash thường đủ cho tóm tắt, Codex và canon, đồng thời chạy nhanh hơn Pro.
          </p>
          {loadingModels ? (
            <div className="chapter-completion-model-dialog__status" role="status">
              <Loader2 size={14} className="spin" /> Đang lấy model Ollama đã cài...
            </div>
          ) : null}
          {loadError ? (
            <div className="chapter-completion-model-dialog__status chapter-completion-model-dialog__status--warning" role="status">
              {loadError}
            </div>
          ) : null}
        </div>

        <div className="chapter-completion-model-dialog__actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Hủy</button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(selectedModel)}>
            <Sparkles size={15} /> Hoàn thành chương
          </button>
        </div>
      </section>
    </div>
  );
}
