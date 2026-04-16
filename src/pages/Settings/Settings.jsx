import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import keyManager from '../../services/ai/keyManager';
import modelRouter, { PROVIDERS, DIRECT_MODELS } from '../../services/ai/router';
import aiService, {
  getGeminiDirectBaseUrl,
  getOllamaUrl,
  getProxyUrl,
  saveSettings,
} from '../../services/ai/client';
import {
  Key, Server, Cpu, Cloud, Trash2, Eye, EyeOff, CheckCircle, XCircle,
  Zap, Gauge, Crown, RefreshCw, TestTube, Download, Upload, Copy, Check,
  Plus, X,
} from 'lucide-react';
import CloudSyncSection from './CloudSyncSection';
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
  const navigate = useNavigate();
  const { projectId } = useParams();
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const [proxyUrl, setProxyUrl] = useState(getProxyUrl());
  const [directUrl, setDirectUrl] = useState(getGeminiDirectBaseUrl());
  const [ollamaUrl, setOllamaUrl] = useState(getOllamaUrl());
  const [ollamaModel, setOllamaModel] = useState(localStorage.getItem('sf-ollama-model') || '');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});
  const [quality, setQuality] = useState(modelRouter.getQualityMode());
  const [provider, setProvider] = useState(modelRouter.getPreferredProvider());

  const handleSaveUrls = () => saveSettings({ proxyUrl, geminiDirectUrl: directUrl, ollamaUrl });

  const handleTest = async (prov) => {
    setTesting(p => ({ ...p, [prov]: true }));
    const result = await aiService.testConnection(prov);
    setTestResults(p => ({ ...p, [prov]: result }));
    setTesting(p => ({ ...p, [prov]: false }));
    if (prov === PROVIDERS.OLLAMA && result.success) setOllamaModels(result.models || []);
  };

  return (
    <div className="settings-page">
      <header className="settings-header animate-fade-in">
        {scopedProjectId ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/project/${scopedProjectId}/editor`)}
            style={{ marginBottom: '12px' }}
          >
            Quay lai du an
          </button>
        ) : null}
        <h1 className="settings-title">⚙️ Cài đặt</h1>
        <p className="settings-subtitle">Cấu hình providers, API keys, models</p>
      </header>

      <div className="settings-sections">

        {/* === PROVIDER PREFERENCE === */}
        <section className="settings-section card animate-slide-up">
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
              { value: PROVIDERS.OLLAMA, icon: Cpu, label: 'Ollama', desc: 'Local AI' },
            ].map(p => (
              <button
                key={p.value}
                className={`settings-radio-card compact ${provider === p.value ? 'settings-radio-card--active' : ''}`}
                onClick={() => { setProvider(p.value); modelRouter.setPreferredProvider(p.value); }}
              >
                <p.icon size={18} />
                <div>
                  <div className="settings-radio-label">{p.label}</div>
                  <div className="settings-radio-desc">{p.desc}</div>
                </div>
              </button>
            ))}
          </div>

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
    </div>
  );
}
