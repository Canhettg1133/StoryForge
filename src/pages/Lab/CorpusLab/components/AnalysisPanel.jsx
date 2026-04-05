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
} from '../../../../services/viewer/viewerDbService.js';
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

  // Duong dan tuong doi '/api/proxy' chi dung o trinh duyet, jobs server can URL tuyet doi.
  if (!trimmed || trimmed.startsWith('/')) {
    return 'https://ag.beijixingxing.com';
  }

  return trimmed;
}

function toDefaultConfig() {
  return {
    provider: ANALYSIS_PROVIDERS.GEMINI_PROXY,
    model: getDefaultModel(ANALYSIS_PROVIDERS.GEMINI_PROXY),
    runMode: 'balanced',
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
    return 'Chua co';
  }

  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) {
    return 'Khong hop le';
  }

  return date.toLocaleString('vi-VN');
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
          setSnapshotError(err?.message || 'Khong the tai danh sach snapshot du an.');
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
    if (localResult) {
      setResultPreview(stringifyResult(localResult));
      setResultAnalysisId(latestCompleted.id);
      setResultError(null);
      setResultLoading(false);
      return;
    }

    if (resultAnalysisId === latestCompleted.id && resultPreview) {
      return;
    }

    let disposed = false;
    const load = async () => {
      try {
        setResultLoading(true);
        setResultError(null);

        const detail = await corpusApi.getAnalysis(corpus.id, latestCompleted.id);
        if (disposed) {
          return;
        }

        const payload = detail?.result || detail?.finalResult || detail?.layers || null;
        const previewText = stringifyResult(payload);

        setResultPreview(previewText || 'Khong co du lieu output de hien thi.');
        setResultAnalysisId(latestCompleted.id);
      } catch (loadError) {
        if (disposed) {
          return;
        }

        setResultError(loadError?.message || 'Khong the tai ket qua phan tich.');
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
    resultPreview,
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
        setRequestError('May chu khong tra ve ma phan tich. Kiem tra jobs server va thu lai.');
      }
    } catch (startError) {
      setRequestError(startError?.message || 'Khong the bat dau phan tich.');
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
      setRequestError(cancelError?.message || 'Khong the huy phan tich.');
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
      setSnapshotSyncStats(saveResult?.materialized || null);

      const rows = await getProjectAnalysisSnapshots(numericProjectId, 30);
      setProjectSnapshots(rows);
      setSnapshotSavedAt(Date.now());
    } catch (err) {
      if (!silent) {
        setSnapshotError(err?.message || 'Khong the luu ket qua phan tich vao du an.');
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
        <h3>Bo may phan tich (Giai doan 3)</h3>
        <span className="muted">
          Phan tich L1-L6 theo session, tu noi output khi vuot gioi han
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
            {loading ? 'Dang tai...' : starting ? 'Dang khoi chay...' : 'Bat dau phan tich'}
          </button>
        )}

        {isBusy && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCancel}
          >
            Huy phan tich
          </button>
        )}
      </div>

      {(error || requestError) && (
        <p className="corpus-error">{requestError || error}</p>
      )}

      {!isBusy && latestTerminalIssue && (
        <p className="corpus-error" role="alert">
          {latestTerminalIssue.status === 'cancelled' ? 'Da huy: ' : 'Phan tich that bai: '}
          {latestTerminalIssue.errorMessage || 'Khong co thong bao chi tiet.'}
        </p>
      )}

      {latestCompleted && (
        <div className="analysis-last-result">
          <strong>Lan phan tich hoan tat gan nhat</strong>
          <span>Mo hinh: {latestCompleted.model || 'Chua co'}</span>
          <span>Hoan tat: {formatTime(latestCompleted.completedAt)}</span>
          <span>So phan output: {latestCompleted.partsGenerated || 0}</span>
          <span>
            Luu vao du an: {latestIsSavedToProject ? 'Da luu' : 'Chua luu'}
          </span>
          {snapshotSavedAt && (
            <span>Cap nhat: {formatTime(snapshotSavedAt)}</span>
          )}
          {snapshotSyncStats && (
            <span>
              Dong bo du an: +{snapshotSyncStats.charactersAdded || 0} nhan vat, +{snapshotSyncStats.locationsAdded || 0} dia diem, +{snapshotSyncStats.objectsAdded || 0} vat pham, +{snapshotSyncStats.worldTermsAdded || 0} thuat ngu
              {snapshotSyncStats.worldUpdated ? ', da cap nhat the gioi' : ''}
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
              Mo Analysis Viewer
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleSaveLatestToProject(false)}
              disabled={!numericProjectId || snapshotSaving}
            >
              {snapshotSaving ? 'Dang luu...' : 'Luu vao du an'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowResult((prev) => !prev)}
              disabled={resultLoading}
            >
              {showResult ? 'An ket qua' : 'Xem ket qua'}
            </button>
          </div>

          {showResult && (
            <div style={{ marginTop: 8 }}>
              {resultLoading && <p className="muted">Dang tai ket qua...</p>}
              {resultError && <p className="corpus-error">{resultError}</p>}
              {!resultLoading && !resultError && (
                <pre style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {resultPreview || 'Khong co du lieu output de hien thi.'}
                </pre>
              )}
            </div>
          )}

          {projectSnapshots.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Snapshot da luu trong du an ({projectSnapshots.length})</strong>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {projectSnapshots.slice(0, 5).map((item) => {
                  const summary = item.summary || {};
                  return (
                    <li key={item.id}>
                      #{item.analysis_id} - {formatTime(item.updated_at || item.created_at)} - {summary.totalEvents || 0} su kien, {summary.locations || 0} dia diem, {summary.incidents || 0} cum lon
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



