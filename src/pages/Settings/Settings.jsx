import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import keyManager from '../../services/ai/keyManager';
import modelRouter, {
  AI_STUDIO_RELAY_MODELS,
  PROVIDERS,
  DIRECT_MODELS,
  PROXY_MODEL_PRESETS,
} from '../../services/ai/router';
import aiService, {
  createAIStudioRelayRoom,
  getAIStudioConnectorUrl,
  getAIStudioRelayRoomStatus,
  getAIStudioRelayRoomCode,
  getAIStudioRelayUrl,
  getGeminiDirectBaseUrl,
  getOllamaUrl,
  getProxyUrl,
  saveSettings,
} from '../../services/ai/client';
import {
  Key, Server, Cpu, Cloud, Trash2, Eye, EyeOff, CheckCircle, XCircle,
  Zap, Gauge, Crown, RefreshCw, TestTube, Download, Upload, Copy, Check,
  Plus, X, BookOpen, ExternalLink, ArrowLeft, ChevronsUpDown, Sparkles,
} from 'lucide-react';
import CloudSyncSection from './CloudSyncSection';
import useMobileLayout from '../../hooks/useMobileLayout';
import './Settings.css';

// ─── Reusable Key Section Component ───
function KeySection({ provider, providerLabel, icon: Icon }) {
  const [keys, setKeys] = useState([...keyManager.getKeys(provider)]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [showKeys, setShowKeys] = useState({});
  const [copied, setCopied] = useState(false);
  const [singleKey, setSingleKey] = useState('');
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error'|'warn', text }

  const refresh = () => setKeys([...keyManager.getKeys(provider)]);

  const showFeedback = (type, text) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Add single key
  const handleAddSingle = () => {
    const key = singleKey.trim();
    if (!key || key.length < 10) {
      showFeedback('error', 'Key quá ngắn (cần ít nhất 10 ký tự)');
      return;
    }
    const ok = keyManager.addKey(provider, key);
    if (ok) {
      showFeedback('success', 'Đã thêm key thành công');
      setSingleKey('');
      refresh();
    } else {
      showFeedback('warn', 'Key đã tồn tại — bỏ qua');
    }
  };

  const handleSingleKeyDown = (e) => {
    if (e.key === 'Enter') handleAddSingle();
  };

  // Bulk import (append, not replace)
  const handleBulkImport = () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(l => l.length > 10);
    if (lines.length === 0) return;
    const { added, skipped } = keyManager.setKeys(provider, lines);
    refresh();
    setBulkText('');
    setBulkMode(false);
    if (skipped > 0) {
      showFeedback('warn', `Đã thêm ${added} keys, bỏ qua ${skipped} key trùng`);
    } else {
      showFeedback('success', `Đã thêm ${added} keys`);
    }
  };

  const handleExport = () => {
    const text = keyManager.exportKeys(provider);
    setBulkText(text);
    setBulkMode(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(keyManager.exportKeys(provider));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemove = (index) => {
    keyManager.removeKey(provider, index);
    refresh();
  };

  const detectedCount = bulkText.split('\n').filter(l => l.trim().length > 10).length;

  return (
    <div className="key-section">
      <div className="key-section-header">
        <Icon size={16} />
        <span className="key-section-label">{providerLabel}</span>
        <span className="key-section-count">{keys.length} keys</span>
      </div>

      {/* Feedback message */}
      {feedback && (
        <div className={`key-feedback key-feedback--${feedback.type}`}>
          {feedback.type === 'success' && <CheckCircle size={13} />}
          {feedback.type === 'error' && <XCircle size={13} />}
          {feedback.type === 'warn' && <XCircle size={13} />}
          {feedback.text}
        </div>
      )}

      {/* Single key input — always visible */}
      <div className="key-single-input">
        <input
          className="input"
          placeholder={`Dán 1 API key cho ${providerLabel}...`}
          value={singleKey}
          onChange={(e) => setSingleKey(e.target.value)}
          onKeyDown={handleSingleKeyDown}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
        />
        <button className="btn btn-primary btn-sm" onClick={handleAddSingle} disabled={!singleKey.trim()}>
          <Plus size={14} /> Thêm
        </button>
      </div>

      {/* Toolbar */}
      <div className="key-toolbar">
        <button className="btn btn-secondary btn-sm" onClick={() => { setBulkMode(!bulkMode); setBulkText(''); }}>
          {bulkMode ? <><X size={12} /> Đóng</> : <><Upload size={12} /> Nhập nhiều</>}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={keys.length === 0}>
          <Download size={12} /> Xuất
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleCopy} disabled={keys.length === 0}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Đã copy' : 'Copy'}
        </button>
      </div>

      {/* Bulk import */}
      {bulkMode && (
        <div className="bulk-import-area">
          <textarea
            className="textarea"
            placeholder={`Dán danh sách API keys cho ${providerLabel}, mỗi key 1 dòng...\n(Keys trùng sẽ tự động bỏ qua)`}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}
          />
          <div className="bulk-import-footer">
            <span className="bulk-import-info">{detectedCount} keys phát hiện (trùng sẽ bỏ qua)</span>
            <button className="btn btn-primary btn-sm" onClick={handleBulkImport} disabled={detectedCount === 0}>
              <Upload size={12} /> Thêm {detectedCount} keys
            </button>
          </div>
        </div>
      )}

      {/* Key list */}
      {keys.length > 0 && (
        <div className="key-list">
          {keys.map((k, i) => (
            <div key={i} className="key-item">
              <span className="key-index">{i + 1}</span>
              <code className="key-value">
                {showKeys[i] ? k.key : k.key.slice(0, 10) + '•••••••' + k.key.slice(-4)}
              </code>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowKeys(p => ({ ...p, [i]: !p[i] }))}>
                {showKeys[i] ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemove(i)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {keys.length === 0 && !bulkMode && (
        <p className="settings-hint">Chưa có key. Nhập ở ô trên hoặc bấm "Nhập nhiều".</p>
      )}
    </div>
  );
}

// ─── Model Manager (Gemini Direct) ───
function DirectModelManager() {
  const [activeModels, setActiveModels] = useState(modelRouter.getActiveDirectModels());

  const allModels = DIRECT_MODELS;
  const isActive = (id) => activeModels.some(m => m.id === id);

  const toggle = (model) => {
    let next;
    if (isActive(model.id)) {
      next = activeModels.filter(m => m.id !== model.id);
    } else {
      next = [...activeModels, { id: model.id, rpm: model.rpm }];
    }
    setActiveModels(next);
    modelRouter.setActiveDirectModels(next);
  };

  return (
    <div className="model-manager">
      <label className="form-label">Models khả dụng (free tier)</label>
      <div className="model-list">
        {allModels.map(m => (
          <div key={m.id} className={`model-item ${isActive(m.id) ? 'model-item--active' : ''}`} onClick={() => toggle(m)}>
            <span className={`model-status ${isActive(m.id) ? 'model-status--on' : ''}`}>
              {isActive(m.id) ? '✅' : '⬜'}
            </span>
            <div className="model-info">
              <span className="model-name">{m.label}</span>
              <span className="model-meta">{m.rpm} RPM · {m.rpd} RPD</span>
            </div>
          </div>
        ))}
      </div>
      <p className="settings-hint">💡 3.1 Flash Lite có quota cao nhất (15 RPM, 500 RPD) — tốt nhất cho free tier.</p>
    </div>
  );
}

// ─── Main Settings Page ───
export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const isMobileLayout = useMobileLayout(900);
  const [proxyUrl, setProxyUrl] = useState(getProxyUrl());
  const [directUrl, setDirectUrl] = useState(getGeminiDirectBaseUrl());
  const [ollamaUrl, setOllamaUrl] = useState(getOllamaUrl());
  const [aiStudioRelayUrl, setAIStudioRelayUrl] = useState(getAIStudioRelayUrl());
  const [aiStudioConnectorUrl, setAIStudioConnectorUrl] = useState(getAIStudioConnectorUrl());
  const [aiStudioRelayRoomCode, setAIStudioRelayRoomCode] = useState(getAIStudioRelayRoomCode());
  const [aiStudioRelayModel, setAIStudioRelayModel] = useState(modelRouter.getAIStudioRelayModel());
  const [creatingRelayRoom, setCreatingRelayRoom] = useState(false);
  const [copiedRelayRoom, setCopiedRelayRoom] = useState(false);
  const [showAIStudioRelaySetup, setShowAIStudioRelaySetup] = useState(false);
  const [aiStudioRelayStatus, setAIStudioRelayStatus] = useState(null);
  const [aiStudioRelayStatusError, setAIStudioRelayStatusError] = useState('');
  const [ollamaModel, setOllamaModel] = useState(localStorage.getItem('sf-ollama-model') || '');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});
  const [quality, setQuality] = useState(modelRouter.getQualityMode());
  const [proxyModel, setProxyModel] = useState(modelRouter.getProxyModel());
  const [provider, setProvider] = useState(modelRouter.getPreferredProvider());
  const selectedProxyPreset = PROXY_MODEL_PRESETS.find((model) => model.id === proxyModel) || PROXY_MODEL_PRESETS[0];
  const aiStudioConnectorConnected = Boolean(aiStudioRelayStatus?.connectorConnected);
  const aiStudioClientConnected = Boolean(aiStudioRelayStatus?.clientConnected);
  const aiStudioRelayExpired = Boolean(aiStudioRelayStatus?.expired);
  const aiStudioRelayStatusLabel = !aiStudioRelayRoomCode
    ? 'Chưa tạo mã phòng'
    : aiStudioRelayStatusError
      ? 'Không đọc được trạng thái'
      : aiStudioRelayExpired
        ? 'Room đã hết hạn'
        : aiStudioConnectorConnected
          ? 'Connector đã kết nối'
          : 'Đang chờ connector';

  useEffect(() => {
    if (!location.hash) return;

    const id = location.hash.replace('#', '');
    const scrollToTarget = () => {
      const element = document.getElementById(id);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    };

    if (scrollToTarget()) return;

    const timeoutId = window.setTimeout(scrollToTarget, 120);
    return () => window.clearTimeout(timeoutId);
  }, [location.hash]);

  useEffect(() => {
    const shouldPoll = provider === PROVIDERS.AI_STUDIO_RELAY || showAIStudioRelaySetup;
    const relay = aiStudioRelayUrl.trim();
    const code = aiStudioRelayRoomCode.trim();

    if (!shouldPoll || !relay || !code) {
      setAIStudioRelayStatus(null);
      setAIStudioRelayStatusError('');
      return undefined;
    }

    let cancelled = false;
    const pollStatus = async () => {
      try {
        const status = await getAIStudioRelayRoomStatus(relay, code, {
          signal: AbortSignal.timeout(6000),
        });
        if (cancelled) return;
        setAIStudioRelayStatus(status);
        setAIStudioRelayStatusError('');
      } catch (error) {
        if (cancelled) return;
        setAIStudioRelayStatus(null);
        setAIStudioRelayStatusError(error?.message || 'Không đọc được trạng thái room.');
      }
    };

    pollStatus();
    const intervalId = window.setInterval(pollStatus, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [aiStudioRelayUrl, aiStudioRelayRoomCode, provider, showAIStudioRelaySetup]);

  const handleSaveUrls = () => saveSettings({
    proxyUrl,
    geminiDirectUrl: directUrl,
    ollamaUrl,
    aiStudioRelayUrl,
    aiStudioConnectorUrl,
    aiStudioRelayRoomCode,
    aiStudioRelayModel,
  });

  const handleSaveAIStudioRelay = () => {
    modelRouter.setAIStudioRelayModel(aiStudioRelayModel);
    saveSettings({
      aiStudioRelayUrl,
      aiStudioConnectorUrl,
      aiStudioRelayRoomCode,
      aiStudioRelayModel,
    });
  };

  const handleCreateRelayRoom = async () => {
    setCreatingRelayRoom(true);
    try {
      handleSaveAIStudioRelay();
      const room = await createAIStudioRelayRoom(aiStudioRelayUrl, {
        signal: AbortSignal.timeout(10000),
      });
      const code = room?.code || '';
      setAIStudioRelayRoomCode(code);
      setAIStudioRelayStatus({
        code,
        clientConnected: false,
        connectorConnected: false,
        expired: false,
      });
      setAIStudioRelayStatusError('');
      saveSettings({
        aiStudioRelayUrl,
        aiStudioConnectorUrl,
        aiStudioRelayRoomCode: code,
        aiStudioRelayModel,
      });
      setTestResults(p => ({
        ...p,
        [PROVIDERS.AI_STUDIO_RELAY]: {
          success: true,
          status: room,
        },
      }));
    } catch (error) {
      setTestResults(p => ({
        ...p,
        [PROVIDERS.AI_STUDIO_RELAY]: {
          success: false,
          error: error.message || 'Không thể tạo room AI Studio Relay',
        },
      }));
    } finally {
      setCreatingRelayRoom(false);
    }
  };

  const handleCopyRelayRoom = async () => {
    if (!aiStudioRelayRoomCode) return;
    await navigator.clipboard.writeText(aiStudioRelayRoomCode);
    setCopiedRelayRoom(true);
    setTimeout(() => setCopiedRelayRoom(false), 2000);
  };

  const handleOpenConnector = () => {
    const url = aiStudioConnectorUrl.trim() || 'https://aistudio.google.com/';
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const handleProviderSelect = (nextProvider) => {
    setProvider(nextProvider);
    modelRouter.setPreferredProvider(nextProvider);
    if (nextProvider === PROVIDERS.AI_STUDIO_RELAY) {
      setShowAIStudioRelaySetup(true);
    }
  };
  const handleOpenAiStudio = () => {
    window.open('https://aistudio.google.com/app/apikey', '_blank', 'noopener,noreferrer');
  };
  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  const handleTest = async (prov) => {
    if (prov === PROVIDERS.AI_STUDIO_RELAY) {
      handleSaveAIStudioRelay();
    }
    setTesting(p => ({ ...p, [prov]: true }));
    const result = await aiService.testConnection(prov);
    setTestResults(p => ({ ...p, [prov]: result }));
    setTesting(p => ({ ...p, [prov]: false }));
    if (prov === PROVIDERS.OLLAMA && result.success) setOllamaModels(result.models || []);
  };

  return (
    <div className="settings-page">
      <header className="settings-header animate-fade-in">
        {!scopedProjectId && isMobileLayout ? (
          <div className="settings-mobile-back">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleGoBack}
            >
              <ArrowLeft size={14} /> Quay lại
            </button>
          </div>
        ) : null}
        {scopedProjectId ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/project/${scopedProjectId}/editor`)}
            style={{ marginBottom: '12px' }}
          >
            Quay lại dự án
          </button>
        ) : null}
        <h1 className="settings-title">⚙️ Cài đặt</h1>
        <p className="settings-subtitle">Cấu hình providers, API keys, models</p>
      </header>

      <div className="settings-sections">
        <section className="settings-section card animate-slide-up" id="gemini-guides">
          <div className="settings-section-header">
            <BookOpen size={20} />
            <div>
              <h2>Cần lấy API key Gemini?</h2>
              <p>Nếu bạn chưa có key, mở guide từng bước rồi quay lại trang này để dán key và test.</p>
            </div>
          </div>

          <div className="settings-action-row">
            <button className="btn btn-primary" onClick={() => navigate('/guide')}>
              <BookOpen size={14} /> Hướng dẫn Gemini Direct
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/guide/proxy')}>
              <BookOpen size={14} /> Hướng dẫn Gemini Proxy
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/guide/translator')}>
              <BookOpen size={14} /> Hướng dẫn Dịch truyện
            </button>
            <button className="btn btn-secondary" onClick={handleOpenAiStudio}>
              <ExternalLink size={14} /> Mở Google AI Studio
            </button>
          </div>
        </section>

        {/* === PROVIDER PREFERENCE === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '30ms' }}>
          <div className="settings-section-header">
            <Gauge size={20} />
            <div>
              <h2>Provider đang dùng</h2>
              <p>Chọn 1 provider để gọi AI. Có thể đổi bất cứ lúc nào.</p>
            </div>
          </div>

          <div className="settings-radio-group horizontal">
            {[
              { value: PROVIDERS.GEMINI_PROXY, icon: Server, label: 'Gemini Proxy', desc: '星星公益站' },
              { value: PROVIDERS.GEMINI_DIRECT, icon: Cloud, label: 'Gemini Direct', desc: 'AI Studio (free)' },
              { value: PROVIDERS.AI_STUDIO_RELAY, icon: Cloud, label: 'AI Studio Relay', desc: 'Experimental' },
              { value: PROVIDERS.OLLAMA, icon: Cpu, label: 'Ollama', desc: 'Local AI' },
            ].map(p => (
              <button
                key={p.value}
                className={`settings-radio-card compact ${provider === p.value ? 'settings-radio-card--active' : ''}`}
                onClick={() => handleProviderSelect(p.value)}
              >
                <p.icon size={18} />
                <div>
                  <div className="settings-radio-label">{p.label}</div>
                  <div className="settings-radio-desc">{p.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {provider === PROVIDERS.GEMINI_PROXY ? (
            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
              <label className="form-label">Model Gemini Proxy</label>
              <div className="settings-select-callout">
                <div className="settings-select-callout__copy">
                  <div className="settings-select-callout__title">
                    <Sparkles size={15} />
                    Model mặc định đang dùng
                  </div>
                  <div className="settings-select-callout__value">
                    {selectedProxyPreset?.label || 'Chưa chọn model'}
                  </div>
                  <div className="settings-select-callout__hint">
                    Bấm vào hộp bên dưới để đổi model mặc định cho toàn bộ tác vụ Gemini Proxy.
                  </div>
                </div>
                <div className="settings-select-shell">
                  <select
                    className="select settings-select-shell__control"
                    value={proxyModel}
                    aria-label="Chọn model Gemini Proxy mặc định"
                    onChange={(event) => {
                      setProxyModel(event.target.value);
                      modelRouter.setProxyModel(event.target.value);
                    }}
                  >
                    {PROXY_MODEL_PRESETS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <span className="settings-select-shell__prompt">Click để đổi model</span>
                  <ChevronsUpDown size={16} className="settings-select-shell__icon" />
                </div>
              </div>
            </div>
          ) : null}

          {provider === PROVIDERS.GEMINI_DIRECT ? (
            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
              <label className="form-label">Chế độ chất lượng</label>
              <div className="settings-radio-group horizontal">
                {[
                  { value: 'fast', icon: Zap, label: 'Nhanh' },
                  { value: 'balanced', icon: Gauge, label: 'Cân bằng' },
                  { value: 'best', icon: Crown, label: 'Tốt nhất' },
                ].map(q => (
                  <button
                    key={q.value}
                    className={`settings-radio-card compact ${quality === q.value ? 'settings-radio-card--active' : ''}`}
                    onClick={() => { setQuality(q.value); modelRouter.setQualityMode(q.value); }}
                  >
                    <q.icon size={16} />
                    <span className="settings-radio-label">{q.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {provider === PROVIDERS.AI_STUDIO_RELAY ? (
            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
              <label className="form-label">Model StoryForge sẽ gửi</label>
              <select
                className="select"
                value={aiStudioRelayModel}
                onChange={(event) => {
                  setAIStudioRelayModel(event.target.value);
                  modelRouter.setAIStudioRelayModel(event.target.value);
                  saveSettings({ aiStudioRelayModel: event.target.value });
                }}
              >
                {AI_STUDIO_RELAY_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <p className="settings-hint">
                Thử nghiệm. Model này được gửi sang AI Studio Connector trong mỗi request. Connector dùng quota AI Studio/Gemini API của người dùng, không phải Gemini CLI quota.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => setShowAIStudioRelaySetup(true)}
              >
                <Cloud size={14} /> Mở setup nhanh
              </button>
            </div>
          ) : null}
        </section>

        {/* === API KEYS === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '60ms' }}>
          <div className="settings-section-header">
            <Key size={20} />
            <div>
              <h2>API Keys</h2>
              <p>Keys tách riêng cho từng provider. Nhập/Xuất riêng.</p>
            </div>
          </div>

          <KeySection provider="gemini_proxy" providerLabel="Gemini Proxy (星星)" icon={Server} />
          <div className="key-section-divider" />
          <KeySection provider="gemini_direct" providerLabel="Gemini Direct (AI Studio)" icon={Cloud} />
        </section>

        {/* === GEMINI PROXY === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '120ms' }}>
          <div className="settings-section-header">
            <Server size={20} />
            <div>
              <h2>Gemini Proxy</h2>
              <p>星星公益站 — OpenAI-compatible (qua Vite proxy để tránh CORS)</p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Proxy URL</label>
            <div className="settings-input-row">
              <input className="input" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} placeholder="/api/proxy" />
              <button className="btn btn-secondary" onClick={handleSaveUrls}>Lưu</button>
              <button className="btn btn-ghost btn-icon" onClick={() => handleTest(PROVIDERS.GEMINI_PROXY)} disabled={testing[PROVIDERS.GEMINI_PROXY]}>
                {testing[PROVIDERS.GEMINI_PROXY] ? <RefreshCw size={16} className="animate-spin" /> : <TestTube size={16} />}
              </button>
            </div>
            <p className="settings-hint">Mặc định: <code>/api/proxy</code> (Vite proxy → ag.beijixingxing.com). Không cần đổi trừ khi dùng proxy khác.</p>
            {testResults[PROVIDERS.GEMINI_PROXY] && (
              <div className={`settings-test-result ${testResults[PROVIDERS.GEMINI_PROXY].success ? 'success' : 'error'}`}>
                {testResults[PROVIDERS.GEMINI_PROXY].success
                  ? <><CheckCircle size={14} /> Kết nối OK</>
                  : <><XCircle size={14} /> {testResults[PROVIDERS.GEMINI_PROXY].error}</>}
              </div>
            )}
          </div>
        </section>

        {/* === GEMINI DIRECT === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '180ms' }}>
          <div className="settings-section-header">
            <Cloud size={20} />
            <div>
              <h2>Gemini Direct</h2>
              <p>Google AI Studio — generativelanguage.googleapis.com</p>
            </div>
          </div>

          <div className="form-group">
            <div className="settings-input-row">
              <input
                className="input"
                value={directUrl}
                onChange={(e) => setDirectUrl(e.target.value)}
                placeholder="https://generativelanguage.googleapis.com"
              />
              <button className="btn btn-secondary" onClick={handleSaveUrls}>Lưu</button>
              <button className="btn btn-ghost btn-icon" onClick={() => handleTest(PROVIDERS.GEMINI_DIRECT)}
                disabled={testing[PROVIDERS.GEMINI_DIRECT] || keyManager.getKeyCount('gemini_direct') === 0}>
                {testing[PROVIDERS.GEMINI_DIRECT] ? <RefreshCw size={16} className="animate-spin" /> : <TestTube size={16} />}
              </button>
            </div>
            {testResults[PROVIDERS.GEMINI_DIRECT] && (
              <div className={`settings-test-result ${testResults[PROVIDERS.GEMINI_DIRECT].success ? 'success' : 'error'}`}>
                {testResults[PROVIDERS.GEMINI_DIRECT].success
                  ? <><CheckCircle size={14} /> Kết nối OK</>
                  : <><XCircle size={14} /> {testResults[PROVIDERS.GEMINI_DIRECT].error}</>}
              </div>
            )}
          </div>

          <DirectModelManager />
        </section>

        {/* === AI STUDIO RELAY === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '210ms' }}>
          <div className="settings-section-header">
            <Cloud size={20} />
            <div>
              <h2>AI Studio Relay</h2>
              <p>Provider thử nghiệm. Relay chỉ chuyển tin giữa StoryForge và tab AI Studio Connector của người dùng.</p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Relay URL</label>
            <div className="settings-input-row">
              <input
                className="input"
                value={aiStudioRelayUrl}
                onChange={(event) => setAIStudioRelayUrl(event.target.value)}
                placeholder="https://your-relay.workers.dev"
              />
              <button className="btn btn-secondary" onClick={handleSaveAIStudioRelay}>Lưu</button>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => handleTest(PROVIDERS.AI_STUDIO_RELAY)}
                disabled={testing[PROVIDERS.AI_STUDIO_RELAY]}
              >
                {testing[PROVIDERS.AI_STUDIO_RELAY] ? <RefreshCw size={16} className="animate-spin" /> : <TestTube size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Connector App URL</label>
            <div className="settings-input-row">
              <input
                className="input"
                value={aiStudioConnectorUrl}
                onChange={(event) => setAIStudioConnectorUrl(event.target.value)}
                placeholder="https://aistudio.google.com/apps/..."
              />
              <button className="btn btn-secondary" onClick={handleOpenConnector}>
                <ExternalLink size={14} /> Mở connector
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Mã phòng</label>
            <div className="settings-input-row">
              <input
                className="input"
                value={aiStudioRelayRoomCode}
                onChange={(event) => {
                  setAIStudioRelayRoomCode(event.target.value.toUpperCase());
                  saveSettings({ aiStudioRelayRoomCode: event.target.value.toUpperCase() });
                }}
                placeholder="ABC-123"
                style={{ fontFamily: 'var(--font-mono)', maxWidth: '180px' }}
              />
              <button className="btn btn-primary" onClick={handleCreateRelayRoom} disabled={creatingRelayRoom || !aiStudioRelayUrl.trim()}>
                {creatingRelayRoom ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} Tạo room
              </button>
              <button className="btn btn-ghost" onClick={handleCopyRelayRoom} disabled={!aiStudioRelayRoomCode}>
                {copiedRelayRoom ? <Check size={14} /> : <Copy size={14} />} {copiedRelayRoom ? 'Đã copy' : 'Copy'}
              </button>
            </div>
            <p className="settings-hint">
              Mở AI Studio Connector, nhập mã phòng này, rồi quay lại StoryForge. Trên điện thoại, bật Chế độ điện thoại trong connector.
            </p>
            {aiStudioRelayRoomCode ? (
              <div className={`settings-test-result ${aiStudioConnectorConnected ? 'success' : aiStudioRelayStatusError || aiStudioRelayExpired ? 'error' : 'pending'}`}>
                {aiStudioConnectorConnected
                  ? <><CheckCircle size={14} /> Connector đã kết nối. Bạn có thể gọi AI từ StoryForge.</>
                  : aiStudioRelayStatusError || aiStudioRelayExpired
                    ? <><XCircle size={14} /> {aiStudioRelayStatusError || 'Room đã hết hạn. Hãy tạo room mới.'}</>
                    : <><RefreshCw size={14} className="animate-spin" /> Đang chờ AI Studio Connector nhập mã phòng.</>}
              </div>
            ) : null}
            {testResults[PROVIDERS.AI_STUDIO_RELAY] && (
              <div className={`settings-test-result ${testResults[PROVIDERS.AI_STUDIO_RELAY].success ? 'success' : 'error'}`}>
                {testResults[PROVIDERS.AI_STUDIO_RELAY].success
                  ? <><CheckCircle size={14} /> Relay OK</>
                  : <><XCircle size={14} /> {testResults[PROVIDERS.AI_STUDIO_RELAY].error}</>}
              </div>
            )}
          </div>
        </section>

        {/* === OLLAMA === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '240ms' }}>
          <div className="settings-section-header">
            <Cpu size={20} />
            <div>
              <h2>Ollama (Local AI)</h2>
              <p>Chạy AI trên máy, không cần internet/key</p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Ollama URL</label>
            <div className="settings-input-row">
              <input className="input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
              <button className="btn btn-secondary" onClick={handleSaveUrls}>Lưu</button>
              <button className="btn btn-ghost btn-icon" onClick={() => handleTest(PROVIDERS.OLLAMA)} disabled={testing[PROVIDERS.OLLAMA]}>
                {testing[PROVIDERS.OLLAMA] ? <RefreshCw size={16} className="animate-spin" /> : <TestTube size={16} />}
              </button>
            </div>
            {testResults[PROVIDERS.OLLAMA] && (
              <div className={`settings-test-result ${testResults[PROVIDERS.OLLAMA].success ? 'success' : 'error'}`}>
                {testResults[PROVIDERS.OLLAMA].success
                  ? <><CheckCircle size={14} /> Kết nối OK · {ollamaModels.length} models</>
                  : <><XCircle size={14} /> {testResults[PROVIDERS.OLLAMA].error}</>}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Model mặc định</label>
            {ollamaModels.length > 0 ? (
              <select className="select" value={ollamaModel} onChange={(e) => { setOllamaModel(e.target.value); modelRouter.setOllamaModel(e.target.value); }}>
                <option value="">Chọn...</option>
                {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" placeholder="llama3, gemma2, qwen2.5..." value={ollamaModel}
                onChange={(e) => { setOllamaModel(e.target.value); modelRouter.setOllamaModel(e.target.value); }} />
            )}
          </div>
        </section>
        <CloudSyncSection />

      </div>

      {showAIStudioRelaySetup ? (
        <div className="modal-overlay ai-studio-relay-overlay" role="presentation" onClick={() => setShowAIStudioRelaySetup(false)}>
          <div
            className="modal ai-studio-relay-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-studio-relay-setup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="ai-studio-relay-modal__eyebrow">Provider thử nghiệm</div>
                <h2 className="modal-title" id="ai-studio-relay-setup-title">Thiết lập AI Studio Relay</h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowAIStudioRelaySetup(false)}
                aria-label="Đóng thiết lập AI Studio Relay"
              >
                <X size={16} />
              </button>
            </div>

            <div className="ai-studio-relay-modal__body">
              <div className="ai-studio-relay-hero">
                <div>
                  <p className="ai-studio-relay-hero__kicker">Dùng phiên AI Studio của chính người dùng</p>
                  <p>
                    StoryForge chỉ gửi yêu cầu qua relay. Người dùng mở AI Studio Connector, đăng nhập Google,
                    nhập mã phòng, rồi để tab connector mở trong lúc tạo nội dung. Trên điện thoại, tab nền có thể bị tạm dừng.
                  </p>
                </div>
                <div className="ai-studio-relay-hero__status">
                  <span>Trạng thái</span>
                  <strong>{aiStudioRelayStatusLabel}</strong>
                  {aiStudioRelayRoomCode ? (
                    <small>
                      Web: {aiStudioClientConnected ? 'đang mở' : 'chưa gọi'} · Connector: {aiStudioConnectorConnected ? 'đã nối' : 'chưa nối'}
                    </small>
                  ) : null}
                </div>
              </div>

              <div className="ai-studio-relay-layout">
                <aside className="ai-studio-relay-guide">
                  <h3>Luồng thao tác</h3>
                  <div className="ai-studio-relay-steps">
                    {[
                      ['Tạo mã phòng', 'Bấm Tạo room để StoryForge tạo mã kết nối tạm thời.'],
                      ['Mở connector', 'Mở AI Studio Connector bằng link đã lưu hoặc mở thủ công trong AI Studio.'],
                      ['Nhập mã', 'Dán mã phòng vào connector, sau đó bấm Kết nối.'],
                      ['Quay lại viết', 'Khi connector báo Đã kết nối, quay lại StoryForge. Nếu mobile pause tab nền, mở lại connector để nó nhận request đang chờ.'],
                    ].map(([title, detail], index) => (
                      <div className="ai-studio-relay-step" key={title}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{title}</strong>
                          <p>{detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="ai-studio-relay-note">
                    <strong>Lưu ý</strong>
                    <p>Không nhập cookie hoặc token Google vào StoryForge. Provider này dùng quota AI Studio/Gemini API của tài khoản đang mở connector.</p>
                  </div>
                </aside>

                <section className="ai-studio-relay-config">
                  <div className="form-group">
                    <label className="form-label">Relay URL</label>
                    <div className="settings-input-row">
                      <input
                        className="input"
                        value={aiStudioRelayUrl}
                        onChange={(event) => setAIStudioRelayUrl(event.target.value)}
                        placeholder="https://your-relay.workers.dev"
                      />
                      <button type="button" className="btn btn-secondary" onClick={handleSaveAIStudioRelay}>Lưu</button>
                    </div>
                    <p className="settings-hint">Đây là URL Cloudflare relay. Thông thường người dùng không cần sửa.</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Connector App URL</label>
                    <div className="settings-input-row">
                      <input
                        className="input"
                        value={aiStudioConnectorUrl}
                        onChange={(event) => setAIStudioConnectorUrl(event.target.value)}
                        placeholder="https://aistudio.google.com/apps/..."
                      />
                      <button type="button" className="btn btn-secondary" onClick={handleOpenConnector}>
                        <ExternalLink size={14} /> Mở connector
                      </button>
                    </div>
                    <p className="settings-hint">Dán link app đã share từ AI Studio. Nếu chưa share, có thể mở connector thủ công.</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Model StoryForge sẽ gửi</label>
                    <select
                      className="select"
                      value={aiStudioRelayModel}
                      onChange={(event) => {
                        setAIStudioRelayModel(event.target.value);
                        modelRouter.setAIStudioRelayModel(event.target.value);
                        saveSettings({ aiStudioRelayModel: event.target.value });
                      }}
                    >
                      {AI_STUDIO_RELAY_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <p className="settings-hint">Model này là nguồn chính. AI Studio Connector sẽ ưu tiên model do StoryForge gửi trong request; model trong connector chỉ là dự phòng.</p>
                  </div>

                  <div className="ai-studio-relay-room">
                    <div className="form-group">
                      <label className="form-label">Mã phòng</label>
                      <div className="settings-input-row">
                        <input
                          className="input ai-studio-relay-room__code"
                          value={aiStudioRelayRoomCode}
                          onChange={(event) => {
                            setAIStudioRelayRoomCode(event.target.value.toUpperCase());
                            saveSettings({ aiStudioRelayRoomCode: event.target.value.toUpperCase() });
                          }}
                          placeholder="ABC-123"
                        />
                        <button type="button" className="btn btn-primary" onClick={handleCreateRelayRoom} disabled={creatingRelayRoom || !aiStudioRelayUrl.trim()}>
                          {creatingRelayRoom ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} Tạo room
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={handleCopyRelayRoom} disabled={!aiStudioRelayRoomCode}>
                          {copiedRelayRoom ? <Check size={14} /> : <Copy size={14} />} {copiedRelayRoom ? 'Đã copy' : 'Copy'}
                        </button>
                      </div>
                      <p className="settings-hint">Mã này là cầu nối giữa StoryForge và tab AI Studio Connector. Tạo mã mới nếu connector bị mất kết nối.</p>
                    </div>
                    <div className="ai-studio-relay-room__preview">
                      <span>Mã hiện tại</span>
                      <strong>{aiStudioRelayRoomCode || 'Chưa có room'}</strong>
                      {aiStudioRelayRoomCode ? (
                        <small>{aiStudioRelayStatusLabel}</small>
                      ) : null}
                    </div>
                  </div>

                  {aiStudioRelayRoomCode ? (
                    <div className={`settings-test-result ${aiStudioConnectorConnected ? 'success' : aiStudioRelayStatusError || aiStudioRelayExpired ? 'error' : 'pending'}`}>
                      {aiStudioConnectorConnected
                        ? <><CheckCircle size={14} /> Connector đã kết nối. Khi bạn gọi AI, StoryForge sẽ gửi request qua room này.</>
                        : aiStudioRelayStatusError || aiStudioRelayExpired
                          ? <><XCircle size={14} /> {aiStudioRelayStatusError || 'Room đã hết hạn. Hãy tạo room mới.'}</>
                          : <><RefreshCw size={14} className="animate-spin" /> Đang chờ AI Studio Connector nhập đúng mã phòng.</>}
                    </div>
                  ) : null}

                  {testResults[PROVIDERS.AI_STUDIO_RELAY] ? (
                    <div className={`settings-test-result ${testResults[PROVIDERS.AI_STUDIO_RELAY].success ? 'success' : 'error'}`}>
                      {testResults[PROVIDERS.AI_STUDIO_RELAY].success
                        ? <><CheckCircle size={14} /> Relay OK. Hãy mở connector và nhập mã phòng.</>
                        : <><XCircle size={14} /> {testResults[PROVIDERS.AI_STUDIO_RELAY].error}</>}
                    </div>
                  ) : null}
                </section>
              </div>

              <div className="ai-studio-relay-next">
                <div>
                  <strong>Bước tiếp theo sau khi tạo room</strong>
                  <p>Mở connector, nhập đúng Relay URL và mã phòng. Khi connector hiện Đã kết nối, quay lại StoryForge để chạy AI.</p>
                </div>
                <button type="button" className="btn btn-primary" onClick={handleCreateRelayRoom} disabled={creatingRelayRoom || !aiStudioRelayUrl.trim()}>
                  {creatingRelayRoom ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} Tạo room mới
                </button>
              </div>
            </div>

            <div className="modal-actions ai-studio-relay-modal__actions">
              <button type="button" className="btn btn-secondary" onClick={() => handleTest(PROVIDERS.AI_STUDIO_RELAY)} disabled={testing[PROVIDERS.AI_STUDIO_RELAY]}>
                {testing[PROVIDERS.AI_STUDIO_RELAY] ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />} Test relay
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleOpenConnector}>
                <ExternalLink size={14} /> Mở connector
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setShowAIStudioRelaySetup(false)}>
               Xong
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
