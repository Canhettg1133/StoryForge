import React from 'react';
import {
  CHUNK_PRESETS,
  normalizeChunkSizeWords,
  normalizeParallelChunks,
  resolveModel,
} from '../../../../services/corpus/chunkCalculator';

const PRESET_LABELS = {
  fast: 'Nhanh',
  balanced: 'Cân bằng',
  optimal: 'Tối ưu ngữ cảnh lớn',
  custom: 'Tùy chỉnh',
};

const PRESET_DESCRIPTIONS = {
  fast: '15k từ/chunk để ưu tiên tốc độ',
  balanced: '40k từ/chunk cân bằng tốc độ và chất lượng',
  optimal: '500k từ/chunk tối ưu cho ngữ cảnh lớn',
  custom: 'Tự nhập kích thước chunk',
};

function formatWords(words) {
  return Number(words || 0).toLocaleString('vi-VN');
}

export default function ChunkConfigPanel({
  config,
  validation,
  onChange,
  disabled = false,
}) {
  const handlePresetChange = (preset) => {
    const nextModel = resolveModel(CHUNK_PRESETS[preset]?.model, preset);
    onChange?.({
      ...config,
      preset,
      model: nextModel,
      customWords: preset === 'custom'
        ? normalizeChunkSizeWords(config.customWords, CHUNK_PRESETS.optimal.words)
        : config.customWords,
    });
  };

  const currentPreset = CHUNK_PRESETS[config.preset] || CHUNK_PRESETS.optimal;
  const chunkInputValue = config.preset === 'custom'
    ? config.customWords
    : currentPreset.words;

  return (
    <div className="chunk-config-panel">
      <label>
        <span>Cấu hình mẫu</span>
        <select
          value={config.preset}
          onChange={(event) => handlePresetChange(event.target.value)}
          disabled={disabled}
        >
          {Object.values(CHUNK_PRESETS).map((preset) => (
            <option key={preset.key} value={preset.key}>
              {PRESET_LABELS[preset.key] || preset.label}
              {preset.words ? ` (${formatWords(preset.words)} từ)` : ''}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Kích thước chunk (từ)</span>
        <input
          type="number"
          min={1000}
          max={700000}
          step={1000}
          value={chunkInputValue || ''}
          disabled={disabled || config.preset !== 'custom'}
          onChange={(event) => onChange?.({
            ...config,
            customWords: normalizeChunkSizeWords(event.target.value, ''),
          })}
        />
      </label>

      <label>
        <span>Số chunk chạy song song</span>
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          value={config.parallelChunks}
          disabled={disabled}
          onChange={(event) => onChange?.({
            ...config,
            parallelChunks: normalizeParallelChunks(event.target.value, 1),
          })}
        />
      </label>

      {config.preset !== 'custom' && (
        <p className="chunk-hint">
          {PRESET_DESCRIPTIONS[currentPreset.key] || currentPreset.description}
        </p>
      )}

      {validation?.warning && (
        <div className={`chunk-validation ${validation.valid ? 'is-warning' : 'is-error'}`}>
          {validation.warning}
        </div>
      )}
    </div>
  );
}


