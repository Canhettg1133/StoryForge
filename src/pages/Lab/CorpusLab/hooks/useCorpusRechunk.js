import { useCallback, useState } from 'react';
import { corpusApi } from '../../../../services/api/corpusApi';

export default function useCorpusRechunk() {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rechunkLoading, setRechunkLoading] = useState(false);
  const [progress, setProgress] = useState({
    phase: 'idle',
    value: 0,
  });
  const [error, setError] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const clearMessages = useCallback(() => {
    setError(null);
    setLastResult(null);
  }, []);

  const requestPreview = useCallback(async (corpusId, options = {}) => {
    if (!corpusId) {
      return null;
    }

    setPreviewLoading(true);
    setError(null);

    try {
      const data = await corpusApi.getChunkPreview(corpusId, options);
      setPreview(data);
      return data;
    } catch (requestError) {
      setError(requestError?.message || 'Không thể tạo bản xem trước chunk.');
      throw requestError;
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const runRechunk = useCallback(async (corpusId, options = {}) => {
    if (!corpusId) {
      return null;
    }

    setRechunkLoading(true);
    setError(null);
    setLastResult(null);
    setProgress({
      phase: 'preparing',
      value: 0.15,
    });

    try {
      setProgress({
        phase: 'splitting',
        value: 0.45,
      });

      const result = await corpusApi.rechunk(corpusId, options);

      setProgress({
        phase: 'completed',
        value: 1,
      });
      setLastResult(result);
      return result;
    } catch (requestError) {
      setProgress({
        phase: 'failed',
        value: 1,
      });
      setError(requestError?.message || 'Chia lại chunk thất bại.');
      throw requestError;
    } finally {
      setRechunkLoading(false);
    }
  }, []);

  return {
    preview,
    previewLoading,
    rechunkLoading,
    progress,
    error,
    lastResult,
    clearMessages,
    requestPreview,
    runRechunk,
  };
}


