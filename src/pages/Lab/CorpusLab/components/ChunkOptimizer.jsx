import React, { useEffect, useMemo, useState } from 'react';
import {
  CHUNK_PRESETS,
  DEFAULT_PRESET,
  normalizeParallelChunks,
  resolveChunkSizeWords,
  resolveModel,
  validateChunkSize,
} from '../../../../services/corpus/chunkCalculator';
import ChunkConfigPanel from './ChunkConfigPanel';
import ChunkPreview from './ChunkPreview';
import RechunkProgress from './RechunkProgress';
import useCorpusRechunk from '../hooks/useCorpusRechunk';

function detectPreset(chunkSizeWords) {
  const parsed = Number(chunkSizeWords || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PRESET;
  }

  const matched = Object.values(CHUNK_PRESETS)
    .find((preset) => preset.key !== 'custom' && preset.words === parsed);

  return matched?.key || 'custom';
}

function toInitialConfig(corpus) {
  const existingChunkSize = Number(corpus?.chunkSizeUsed || corpus?.chunkSize || CHUNK_PRESETS.optimal.words);
  const preset = detectPreset(existingChunkSize);
  const model = resolveModel(corpus?.model, preset);

  return {
    preset,
    customWords: existingChunkSize,
    parallelChunks: 6,
    model,
  };
}

function formatWords(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

export default function ChunkOptimizer({ corpus, onCorpusUpdated }) {
  const [config, setConfig] = useState(() => toInitialConfig(corpus));
  const {
    preview,
    previewLoading,
    rechunkLoading,
    progress,
    error,
    lastResult,
    clearMessages,
    requestPreview,
    runRechunk,
  } = useCorpusRechunk();

  useEffect(() => {
    setConfig(toInitialConfig(corpus));
  }, [corpus?.id, corpus?.chunkSizeUsed, corpus?.chunkSize]);

  const chunkSizeWords = useMemo(
    () => resolveChunkSizeWords({ preset: config.preset, customWords: config.customWords }),
    [config.preset, config.customWords],
  );

  const parallelChunks = useMemo(
    () => normalizeParallelChunks(config.parallelChunks, 1),
    [config.parallelChunks],
  );

  const validation = useMemo(
    () => validateChunkSize(chunkSizeWords, config.model, config.preset),
    [chunkSizeWords, config.model, config.preset],
  );

  useEffect(() => {
    if (!corpus?.id || !chunkSizeWords) {
      return;
    }

    const timer = setTimeout(() => {
      requestPreview(corpus.id, {
        preset: config.preset,
        chunkSizeWords,
        model: config.model,
        parallelChunks,
      }).catch(() => {});
    }, 250);

    return () => clearTimeout(timer);
  }, [
    corpus?.id,
    config.preset,
    config.model,
    chunkSizeWords,
    parallelChunks,
    requestPreview,
  ]);

  const handleRefreshPreview = async () => {
    if (!corpus?.id || !chunkSizeWords) {
      return;
    }

    try {
      await requestPreview(corpus.id, {
        preset: config.preset,
        chunkSizeWords,
        model: config.model,
        parallelChunks,
      });
    } catch {
      // Error state is already handled in hook.
    }
  };

  const handleRechunk = async () => {
    if (!corpus?.id || !chunkSizeWords || !validation.valid || rechunkLoading) {
      return;
    }

    try {
      const result = await runRechunk(corpus.id, {
        preset: config.preset,
        chunkSizeWords,
        model: config.model,
        parallelChunks,
        preserveParagraphs: true,
      });

      await onCorpusUpdated?.(result?.corpus);
    } catch {
      // Error state is already handled in hook.
    }
  };

  return (
    <div className="corpus-card chunk-optimizer">
      <div className="chunk-optimizer-header">
        <h3>Tối ưu chunk (Giai đoạn 2.1)</h3>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={clearMessages}
          disabled={previewLoading || rechunkLoading}
        >
          Xóa thông báo
        </button>
      </div>

      <p className="muted">
        Hiện tại: {formatWords(corpus?.chunkCount)} chunk x{' '}
        {formatWords(corpus?.chunkSizeUsed || corpus?.chunkSize)} từ
      </p>

      <ChunkConfigPanel
        config={config}
        validation={validation}
        onChange={setConfig}
        disabled={rechunkLoading}
      />

      <ChunkPreview preview={preview} loading={previewLoading} />
      <RechunkProgress progress={progress} loading={rechunkLoading} />

      {error && <p className="corpus-error">{error}</p>}

      {lastResult?.success && (
        <p className="chunk-success">
          Tạo lại chunk thành công: {formatWords(lastResult.originalChunkCount)} {'->'}{' '}
          {formatWords(lastResult.newChunkCount)} chunk.
        </p>
      )}

      <div className="chunk-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleRefreshPreview}
          disabled={previewLoading || rechunkLoading}
        >
          {previewLoading ? 'Đang cập nhật...' : 'Cập nhật xem trước'}
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleRechunk}
          disabled={rechunkLoading || !validation.valid}
          title={!validation.valid ? validation.warning || 'Cấu hình chunk không hợp lệ' : ''}
        >
          {rechunkLoading ? 'Đang chia lại chunk...' : 'Áp dụng chia lại chunk'}
        </button>
      </div>
    </div>
  );
}


