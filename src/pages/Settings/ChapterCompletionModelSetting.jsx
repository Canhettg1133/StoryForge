import React, { useEffect, useState } from 'react';
import {
  getChapterCompletionModelState,
  saveChapterCompletionModelPreference,
} from '../../services/ai/chapterCompletionModelRouting.js';
import { setOllamaModelCatalog } from '../../services/ai/modelOptions.js';

export default function ChapterCompletionModelSetting({
  ollamaModels,
}) {
  const [, setPreferenceRevision] = useState(0);

  useEffect(() => {
    if (Array.isArray(ollamaModels)) {
      setOllamaModelCatalog(ollamaModels);
    }
  }, [ollamaModels]);

  const modelState = getChapterCompletionModelState({
    ...(ollamaModels === undefined ? {} : { ollamaModels }),
  });
  const inheritedLabel = modelState.currentModel || 'Chưa chọn model mặc định';

  const handleChange = (model) => {
    saveChapterCompletionModelPreference({
      provider: modelState.provider,
      proxyProfileId: modelState.proxyProfileId,
      model,
    });
    setPreferenceRevision((value) => value + 1);
  };

  return (
    <div className="chapter-completion-model-setting">
      <div className="chapter-completion-model-setting__copy">
        <label className="form-label" htmlFor="chapter-completion-model-setting-select">
          Model cho Hoàn thành chương
        </label>
        <p>
          Nếu provider có Flash, model Flash thường đủ cho tóm tắt, Codex và canon, đồng thời chạy nhanh hơn Pro.
        </p>
      </div>
      <div className="chapter-completion-model-setting__control">
        <select
          id="chapter-completion-model-setting-select"
          className="select"
          value={modelState.selectedModel}
          onChange={(event) => handleChange(event.target.value)}
          aria-label="Chọn model cho Hoàn thành chương"
        >
          <option value="">Theo model hiện tại — {inheritedLabel}</option>
          {modelState.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}{option.meta ? ` — ${option.meta}` : ''}
            </option>
          ))}
        </select>
        <span>Provider: {modelState.providerLabel}</span>
      </div>
    </div>
  );
}
