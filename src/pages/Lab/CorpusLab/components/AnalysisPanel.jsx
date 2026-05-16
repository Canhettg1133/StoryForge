import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getGeminiDirectBaseUrl,
  getProxyUrl,
} from '../../../../services/ai/client';
import keyManager from '../../../../services/ai/keyManager';
import {
  DIRECT_MODELS,
  PROXY_MODELS,
} from '../../../../services/ai/router';
import {
  ANALYSIS_CONFIG,
  ANALYSIS_PROVIDERS,
  resolveProviderModel,
} from '../../../../services/analysis/analysisConfig';
import { corpusApi } from '../../../../services/api/corpusApi';
import {
  getProjectAnalysisSnapshots,
  saveAnalysisSnapshotToProject,
} from '../../../../services/projects/projectGateway.js';
import { toVietnameseErrorMessage } from '../../../../utils/errorMessages.js';
import useCorpusAnalysis from '../hooks/useCorpusAnalysis';
import AnalysisConfig from './AnalysisConfig';
import AnalysisProgress from './AnalysisProgress';

function getModelOptions(provider) {
  if (provider === ANALYSIS_PROVIDERS.GEMINI_DIRECT) {
    const activeDirectModels = modelIdsFromActiveDirect();
    const activeSet = new Set(activeDirectModels);
    const source = DIRECT_MODELS.filter((model) => activeSet.size === 0 || activeSet.has(model.id));
    return source.map((model) => model.id);
  }

  return PROXY_MODELS.map((model) => model.id);
}

function modelIdsFromActiveDirect() {
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

function getDefaultModel(provider) {
  const options = getModelOptions(provider);
  return options[0] || '';
}

function extractKeys(provider) {
  return keyManager
    .getKeys(provider)
    .map((item) => String(item?.key || '').trim())
    .filter(Boolean);
}

function resolveAnalysisProxyUrl() {
  const stored = getProxyUrl();
  const trimmed = String(stored || '').trim();

  // Đường dẫn tương đối '/api/proxy' chỉ dùng ở trình duyệt, jobs server cần URL tuyệt đối.
  if (!trimmed || trimmed.startsWith('/')) {
    return 'https://ag.beijixingxing.com';
  }

  return trimmed;
}

function toDefaultConfig() {
  return {
    provider: ANALYSIS_PROVIDERS.GEMINI_PROXY,
    model: getDefaultModel(ANALYSIS_PROVIDERS.GEMINI_PROXY),
    runMode: 'full_corpus_1m',
    enableIncidentAiPipeline: false,
    temperature: 0.2,
    maxParts: 6,
    analysisChunkSize: ANALYSIS_CONFIG.session.maxInputWords,
    layers: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
    geminiDirectApiKeys: extractKeys(ANALYSIS_PROVIDERS.GEMINI_DIRECT),
    geminiProxyApiKeys: extractKeys(ANALYSIS_PROVIDERS.GEMINI_PROXY),
    geminiDirectKeyInput: '',
    geminiProxyKeyInput: '',
    geminiDirectUrl: getGeminiDirectBaseUrl(),
    geminiProxyUrl: resolveAnalysisProxyUrl(),
  };
}

function formatTime(timestamp) {
  if (!timestamp) {
    return 'Chưa có';
  }

  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) {
    return 'Không hợp lệ';
  }

  return date.toLocaleString('vi-VN');
}

function formatDuration(startedAt, completedAt) {
  const start = Number(startedAt);
  const end = Number(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 'Chưa rõ';
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}g ${String(minutes).padStart(2, '0')}p ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}p ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

function normalizeApiKeys(keys) {
  if (!Array.isArray(keys)) {
    return [];
  }

  return [...new Set(keys
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function stringifyResult(result) {
  if (result == null) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export default function AnalysisPanel({ corpus }) {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const numericProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const [config, setConfig] = useState(() => toDefaultConfig());
  const [requestError, setRequestError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState(null);
  const [resultPreview, setResultPreview] = useState('');
  const [resultAnalysisId, setResultAnalysisId] = useState(null);
  const [resultPreviewModeLoaded, setResultPreviewModeLoaded] = useState(null);
  const [resultViewMode, setResultViewMode] = useState('slim');
  const [projectSnapshots, setProjectSnapshots] = useState([]);
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotError, setSnapshotError] = useState(null);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState(null);
  const [snapshotSyncStats, setSnapshotSyncStats] = useState(null);

  const {
    analyses,
    activeAnalysis,
    loading,
    error,
    startAnalysis,
    cancelAnalysis,
  } = useCorpusAnalysis(corpus?.id);

  const latestCompleted = useMemo(
    () => analyses.find((analysis) => analysis.status === 'completed') || null,
    [analyses],
  );
  const latestIsSavedToProject = useMemo(() => {
    if (!latestCompleted?.id) return false;
    return projectSnapshots.some((item) => String(item.analysis_id) === String(latestCompleted.id));
  }, [latestCompleted?.id, projectSnapshots]);

  const latestTerminalIssue = useMemo(() => {
    const recent = analyses[0];
    if (!recent || !['failed', 'cancelled'].includes(recent.status)) {
      return null;
    }
    return recent;
  }, [analyses]);

  useEffect(() => {
    setShowResult(false);
    setResultLoading(false);
    setResultError(null);
    setResultPreview('');
    setResultAnalysisId(null);
    setResultPreviewModeLoaded(null);
    setSnapshotSyncStats(null);
  }, [corpus?.id]);

  useEffect(() => {
    let disposed = false;
    const loadSnapshots = async () => {
      if (!numericProjectId) {
        setProjectSnapshots([]);
        return;
      }

      try {
        const rows = await getProjectAnalysisSnapshots(numericProjectId, 30);
        if (!disposed) {
          setProjectSnapshots(rows);
        }
      } catch (err) {
        if (!disposed) {
          setSnapshotError(toVietnameseErrorMessage(err, 'Không thể tải danh sách snapshot dự án.'));
        }
      }
    };

    loadSnapshots();
    return () => {
      disposed = true;
    };
  }, [numericProjectId]);

  useEffect(() => {
    if (!showResult || !latestCompleted?.id || !corpus?.id) {
      return;
    }

    const localResult = latestCompleted.result || latestCompleted.finalResult || null;
    if (localResult && resultViewMode === 'slim') {
      setResultPreview(stringifyResult(localResult));
      setResultAnalysisId(latestCompleted.id);
      setResultPreviewModeLoaded('slim');
      setResultError(null);
      setResultLoading(false);
      return;
    }

    if (resultAnalysisId === latestCompleted.id && resultPreview && resultPreviewModeLoaded === resultViewMode) {
      return;
    }

    let disposed = false;
    const load = async () => {
      try {
        setResultLoading(true);
        setResultError(null);

        const payload = resultViewMode === 'full'
          ? (await corpusApi.getAnalysisArtifact(corpus.id, latestCompleted.id, { mode: 'full' }))?.artifact
          : (await corpusApi.getAnalysis(corpus.id, latestCompleted.id, { mode: 'slim' }))?.result;
        if (disposed) {
          return;
        }
        const previewText = stringifyResult(payload);

        setResultPreview(previewText || 'Không có dữ liệu output để hiển thị.');
        setResultAnalysisId(latestCompleted.id);
        setResultPreviewModeLoaded(resultViewMode);
      } catch (loadError) {
        if (disposed) {
          return;
        }

        setResultError(toVietnameseErrorMessage(loadError, 'Không thể tải kết quả phân tích.'));
      } finally {
        if (!disposed) {
          setResultLoading(false);
        }
      }
    };

    load();

    return () => {
      disposed = true;
    };
  }, [
    corpus?.id,
    latestCompleted?.finalResult,
    latestCompleted?.id,
    latestCompleted?.result,
    resultAnalysisId,
    resultPreviewModeLoaded,
    resultPreview,
    resultViewMode,
    showResult,
  ]);

  if (!corpus?.id) {
    return null;
  }

  const isBusy = Boolean(activeAnalysis);

  const handleStart = async () => {
    try {
      setRequestError(null);
      setStarting(true);
      setShowResult(false);

      const selectedProvider = config.provider;
      const selectedApiKeys = selectedProvider === ANALYSIS_PROVIDERS.GEMINI_DIRECT
        ? normalizeApiKeys(config.geminiDirectApiKeys)
        : normalizeApiKeys(config.geminiProxyApiKeys);

      const payload = {
        provider: selectedProvider,
        model: resolveProviderModel(selectedProvider, config.model),
        runMode: String(config.runMode || 'balanced'),
        enableIncidentAiPipeline: Boolean(config.enableIncidentAiPipeline),
        chunkSize: Number(config.analysisChunkSize) || ANALYSIS_CONFIG.session.maxInputWords,
        chunkOverlap: 0,
        temperature: Number(config.temperature) || 0.2,
        maxParts: Number(config.maxParts) || 6,
        layers: Array.isArray(config.layers) ? config.layers : ['l1'],
        apiKey: selectedApiKeys[0] || '',
        apiKeys: selectedApiKeys,
        proxyUrl: config.geminiProxyUrl || '',
        directUrl: config.geminiDirectUrl || '',
      };

      const created = await startAnalysis(payload);
      if (!created?.id) {
        setRequestError('Máy chủ không trả về mã phân tích. Kiểm tra jobs server và thử lại.');
      }
    } catch (startError) {
      setRequestError(toVietnameseErrorMessage(startError, 'Không thể bắt đầu phân tích.'));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeAnalysis?.id) {
      return;
    }

    try {
      setRequestError(null);
      await cancelAnalysis(activeAnalysis.id);
    } catch (cancelError) {
      setRequestError(toVietnameseErrorMessage(cancelError, 'Không thể hủy phân tích.'));
    }
  };

  const handleOpenViewer = () => {
    if (!projectId || !corpus?.id || !latestCompleted?.id) {
      return;
    }

    navigate(`/project/${projectId}/corpus-lab/viewer`, {
      state: {
        corpusId: corpus.id,
        analysisId: latestCompleted.id,
      },
    });
  };

  const handleSaveLatestToProject = async (silent = false) => {
    if (!numericProjectId || !corpus?.id || !latestCompleted?.id) {
      return;
    }

    try {
      setSnapshotSaving(true);
      setSnapshotSyncStats(null);
      if (!silent) {
        setSnapshotError(null);
      }

      let payload = latestCompleted.result || latestCompleted.finalResult || null;
      if (!payload) {
        const detail = await corpusApi.getAnalysis(corpus.id, latestCompleted.id);
        payload = detail?.result || detail?.finalResult || detail?.layers || null;
      }

      const saveResult = await saveAnalysisSnapshotToProject({
        projectId: numericProjectId,
        corpusId: corpus.id,
        analysisId: latestCompleted.id,
        status: latestCompleted.status,
        layers: Array.isArray(latestCompleted.layers) ? latestCompleted.layers : [],
        result: payload,
      });
      setSnapshotSyncStats(saveResult || null);

      const rows = await getProjectAnalysisSnapshots(numericProjectId, 30);
      setProjectSnapshots(rows);
      setSnapshotSavedAt(Date.now());
    } catch (err) {
      if (!silent) {
      setSnapshotError(toVietnameseErrorMessage(err, 'Không thể lưu kết quả phân tích vào dự án.'));
      }
    } finally {
      setSnapshotSaving(false);
    }
  };

  useEffect(() => {
    if (!latestCompleted?.id || !numericProjectId || !corpus?.id) {
      return;
    }

    if (latestIsSavedToProject) {
      return;
    }

    handleSaveLatestToProject(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestCompleted?.id, latestIsSavedToProject, numericProjectId, corpus?.id]);

  return (
    <div className="corpus-card analysis-panel">
      <div className="analysis-panel-header">
        <h3>Bộ máy phân tích Narrative Pipeline V3</h3>
        <span className="muted">
          Incident-first, windowed, stateful: artifact V3, review/resume, graph projections và compat projections
        </span>
      </div>

      {!isBusy && (
        <AnalysisConfig
          corpus={corpus}
          config={config}
          onChange={setConfig}
          disabled={loading || starting}
        />
      )}

      {isBusy && (
        <AnalysisProgress analysis={activeAnalysis} />
      )}

      <div className="analysis-actions">
        {!isBusy && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStart}
            disabled={loading || starting}
          >
            {loading ? 'Đang tải...' : starting ? 'Đang khởi chạy...' : 'Bắt đầu phân tích'}
          </button>
        )}

        {isBusy && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCancel}
          >
            Hủy phân tích
          </button>
        )}
      </div>

      {(error || requestError) && (
        <p className="corpus-error">{requestError || error}</p>
      )}

      {!isBusy && latestTerminalIssue && (
        <p className="corpus-error" role="alert">
          {latestTerminalIssue.status === 'cancelled' ? 'Đã hủy: ' : 'Phân tích thất bại: '}
          {latestTerminalIssue.errorMessage || 'Không có thông báo chi tiết.'}
        </p>
      )}

      {latestCompleted && (
        <div className="analysis-last-result">
          <strong>Lần phân tích hoàn tất gần nhất</strong>
          <span>Mô hình: {latestCompleted.model || 'Chưa có'}</span>
          <span>Hoàn tất: {formatTime(latestCompleted.completedAt)}</span>
          <span>
            Tổng thời gian: {formatDuration(
              latestCompleted.startedAt || latestCompleted.createdAt,
              latestCompleted.completedAt,
            )}
          </span>
          <span>Số phần output: {latestCompleted.partsGenerated || 0}</span>
          <span>
            Lưu vào dự án: {latestIsSavedToProject ? 'Đã lưu' : 'Chưa lưu'}
          </span>
          {snapshotSavedAt && (
            <span>Cập nhật: {formatTime(snapshotSavedAt)}</span>
          )}
          {snapshotSyncStats?.materialized && (
            <span>
              Đồng bộ dự án: +{snapshotSyncStats.materialized.charactersAdded || 0} nhân vật, +{snapshotSyncStats.materialized.locationsAdded || 0} địa điểm, +{snapshotSyncStats.materialized.objectsAdded || 0} vật phẩm, +{snapshotSyncStats.materialized.worldTermsAdded || 0} thuật ngữ
              {snapshotSyncStats.materialized.worldUpdated ? ', đã cập nhật thế giới' : ''}
            </span>
          )}
          {snapshotSyncStats && !snapshotSyncStats.materialized && snapshotSyncStats.sourceOfTruth === 'postgres' && (
            <span>
              Snapshot đã được lưu lên server. Đây là bản lưu artifact, chưa materialize entity vào project store local.
            </span>
          )}
          {snapshotError && <p className="corpus-error">{snapshotError}</p>}

          <div className="analysis-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenViewer}
              disabled={!projectId}
            >
              Mở Analysis Viewer
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleSaveLatestToProject(false)}
              disabled={!numericProjectId || snapshotSaving}
            >
              {snapshotSaving ? 'Đang lưu...' : 'Lưu vào dự án'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowResult((prev) => !prev)}
              disabled={resultLoading}
            >
              {showResult ? 'Ẩn kết quả' : 'Xem kết quả'}
            </button>
          </div>

          {showResult && (
            <div style={{ marginTop: 8 }}>
              <div className="analysis-actions" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={`btn ${resultViewMode === 'slim' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setResultViewMode('slim')}
                  disabled={resultLoading}
                >
                  Export Slim
                </button>
                <button
                  type="button"
                  className={`btn ${resultViewMode === 'full' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setResultViewMode('full')}
                  disabled={resultLoading}
                >
                  Export Full Debug
                </button>
              </div>
              {resultLoading && <p className="muted">Đang tải kết quả...</p>}
              {resultError && <p className="corpus-error">{resultError}</p>}
              {!resultLoading && !resultError && (
                <pre style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {resultPreview || 'Không có dữ liệu output để hiển thị.'}
                </pre>
              )}
            </div>
          )}

          {projectSnapshots.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Snapshot đã lưu trong dự án ({projectSnapshots.length})</strong>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {projectSnapshots.slice(0, 5).map((item) => {
                  const summary = item.summary || {};
                  return (
                    <li key={item.id}>
                      #{item.analysis_id} - {formatTime(item.updated_at || item.created_at)} - {summary.totalEvents || 0} sự kiện, {summary.locations || 0} địa điểm, {summary.incidents || 0} cụm lớn
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}



