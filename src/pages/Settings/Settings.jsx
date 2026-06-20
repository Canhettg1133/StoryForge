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
  OLLAMA_MODEL_PRESETS,
  createAIStudioRelayRoom,
  detectOllamaModelType,
  getAIStudioConnectorUrl,
  getAIStudioRelayRoomStatus,
  getAIStudioRelayRoomCode,
  getAIStudioRelayUrl,
  getGeminiDirectBaseUrl,
  getOllamaUrl,
  saveSettings,
} from '../../services/ai/client';
import {
  AG_PROXY_PROFILE_ID,
  CUSTOM_PROXY_PROFILE_ID,
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_MODELS_PATH,
  buildOpenAIProxyEndpoint,
  classifyProxyModel,
  fetchOpenAIProxyModels,
  getAgOpenAIProxyProfile,
  getOpenAIProxySettings,
  getOpenAIProxyKeyProvider,
  groupProxyModelsForDisplay,
  resolveProxyTransportMode,
  setAgProxyModels,
  setOpenAIProxyActiveProfile,
  updateCustomOpenAIProxyProfile,
} from '../../services/ai/openAIProxyConfig';
import {
  Key, Server, Cpu, Cloud, Trash2, Eye, EyeOff, CheckCircle, XCircle,
  Zap, Gauge, Crown, RefreshCw, TestTube, Download, Upload, Copy, Check,
  Plus, X, BookOpen, ExternalLink, ArrowLeft, ChevronsUpDown, Sparkles,
} from 'lucide-react';
import CloudSyncSection from './CloudSyncSection';
import AccountAccessSummary from '../../components/access/AccountAccessSummary.jsx';
import useMobileLayout from '../../hooks/useMobileLayout';
import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';
import { useUserAccess } from '../../hooks/useUserAccess';
import { ACCESS_FEATURES } from '../../services/access/accessControl.js';
import { navigateBackOr } from '../../utils/navigation.js';
import './Settings.css';

// ─── Reusable Key Section Component ───
function KeySection({ provider, providerLabel, description = '', icon: Icon, onKeysChange }) {
  const [keys, setKeys] = useState([...keyManager.getKeys(provider)]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [showKeys, setShowKeys] = useState({});
  const [copied, setCopied] = useState(false);
  const [singleKey, setSingleKey] = useState('');
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error'|'warn', text }

  const refresh = () => {
    const nextKeys = [...keyManager.getKeys(provider)];
    setKeys(nextKeys);
    onKeysChange?.(provider, nextKeys);
    return nextKeys;
  };

  const showFeedback = (type, text) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  const parseKeysFromText = (value) => String(value || '')
    .split(/[\s,;]+/u)
    .map((item) => item.trim())
    .filter((item) => item && (provider === PROVIDERS.GEMINI_DIRECT || item.length > 10));

  const addKeys = (rawValue, { closeBulk = false } = {}) => {
    const candidates = parseKeysFromText(rawValue);
    if (candidates.length === 0) {
      showFeedback('error', 'Không tìm thấy API key hợp lệ');
      return false;
    }

    const { added, skipped } = keyManager.setKeys(provider, candidates);
    refresh();
    if (closeBulk) {
      setBulkText('');
      setBulkMode(false);
    }

    if (added === 0 && skipped > 0) {
      showFeedback('warn', `Tất cả ${skipped} key đã tồn tại - bỏ qua`);
    } else if (skipped > 0) {
      showFeedback('warn', `Đã thêm ${added} keys, bỏ qua ${skipped} key trùng`);
    } else {
      showFeedback('success', `Đã thêm ${added} keys`);
    }
    return added > 0;
  };

  // Add single key
  const handleAddSingle = () => {
    const key = singleKey.trim();
    const candidates = parseKeysFromText(key);
    if (candidates.length > 1) {
      showFeedback('warn', 'Ô này chỉ thêm 1 key. Dán nhiều key vào ô "Nhập nhiều key" bên dưới.');
      return;
    }
    if (!key) {
      showFeedback('error', 'Vui lòng nhập API key');
      return;
    }
    if (provider !== PROVIDERS.GEMINI_DIRECT && key.length < 10) {
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
    const lines = parseKeysFromText(bulkText);
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

  const detectedCount = parseKeysFromText(bulkText).length;

  return (
    <div className="key-section">
      <div className="key-section-header">
        <Icon size={16} />
        <span className="key-section-label">{providerLabel}</span>
        <span className="key-section-count">{keys.length} keys</span>
      </div>
      {description ? <p className="key-section-description">{description}</p> : null}

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
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setBulkMode((prev) => !prev)}
        >
          {bulkMode ? <><X size={12} /> Đóng nhập nhiều</> : <><Upload size={12} /> Nhập nhiều</>}
        </button>
        {bulkMode ? (
          <button className="btn btn-secondary btn-sm key-clear-bulk" onClick={() => setBulkText('')} disabled={!bulkText.trim()}>
            <X size={12} /> Xóa ô nhập nhiều
          </button>
        ) : null}
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

      {keys.length === 0 && (
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
      <label className="form-label">Model Gemini Direct</label>
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
      <p className="settings-hint">3.1 Flash Lite có quota cao nhất (15 RPM, 500 RPD), phù hợp khi cần xử lý nhanh.</p>
    </div>
  );
}

// ─── Main Settings Page ───
const PROVIDER_CARD_AG_PROXY = `${PROVIDERS.OPENAI_PROXY}:${AG_PROXY_PROFILE_ID}`;
const PROVIDER_CARD_CUSTOM_PROXY = `${PROVIDERS.OPENAI_PROXY}:${CUSTOM_PROXY_PROFILE_ID}`;
const OLLAMA_PRESET_OPTIONS = ['qwen3', 'qwen25', 'llama3', 'gemma2', 'mistral', 'phi3']
  .map((key) => ({ key, ...OLLAMA_MODEL_PRESETS[key] }))
  .filter((preset) => preset.recommended);

function normalizeProxyModelList(models = []) {
  return [...new Set(
    (Array.isArray(models) ? models : [])
      .map((model) => String(model || '').trim())
      .filter(Boolean),
  )];
}

function normalizeCustomProxyModelList(models = []) {
  return normalizeProxyModelList(models);
}

function normalizeAgProxyModelList(models = []) {
  return normalizeProxyModelList(models);
}

function resetCustomProxyModelsOnBaseUrlChange(profile = {}, nextBaseUrl = '') {
  const normalizedNextBaseUrl = String(nextBaseUrl || '').trim();
  const normalizedPreviousBaseUrl = String(profile.baseUrl || '').trim();
  if (normalizedNextBaseUrl === normalizedPreviousBaseUrl) {
    return { ...profile, baseUrl: nextBaseUrl };
  }

  return {
    ...profile,
    baseUrl: nextBaseUrl,
    defaultModel: '',
    models: [],
  };
}

function getAgProxyModelOption(model) {
  const preset = PROXY_MODEL_PRESETS.find((item) => item.id === model);
  return {
    id: model,
    label: preset?.label || model,
  };
}

function groupProxyModelOptionsForSelect(options = [], context = {}) {
  const optionById = new Map(options.map((option) => [option.id, option]));
  return groupProxyModelsForDisplay(options.map((option) => option.id), context)
    .map((group) => ({
      channel: group.channel,
      options: group.models.map((model) => ({
        ...(optionById.get(model.id) || { id: model.id, label: model.id }),
        channel: model.channel,
        family: model.family,
        confidence: model.confidence,
      })),
    }));
}

function ModelDefaultCallout({
  eyebrow,
  value,
  hint,
  selectLabel,
  selectValue,
  options = [],
  optionGroups = [],
  onChange,
  disabled = false,
}) {
  const hasOptionGroups = optionGroups.some((group) => group.options.length > 0);

  return (
    <div className="model-default-block">
      <div className="model-default-block__eyebrow">{eyebrow}</div>
      <div className="settings-select-callout">
        <div className="settings-select-callout__copy">
          <div className="settings-select-callout__title">
            <Sparkles size={15} />
            Model mặc định đang dùng
          </div>
          <div className="settings-select-callout__value">
            {value || 'Chưa chọn model'}
          </div>
          <div className="settings-select-callout__hint">
            {hint}
          </div>
        </div>
        <div className="settings-select-shell">
          <select
            className="select settings-select-shell__control"
            value={selectValue || ''}
            aria-label={selectLabel}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
          >
            {options.length === 0 ? (
              <option value="">Chưa có model</option>
            ) : null}
            {hasOptionGroups ? optionGroups.map((group) => (
              <optgroup key={group.channel} label={group.channel}>
                {group.options.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            )) : options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <span className="settings-select-shell__prompt">Bấm để đổi model</span>
          <ChevronsUpDown size={16} className="settings-select-shell__icon" />
        </div>
      </div>
    </div>
  );
}

const PROXY_MODEL_FAMILY_FILTERS = ['Tất cả', 'Gemini', 'Claude', 'OpenAI', 'Khác'];
const PRIMARY_PROXY_MODEL_FAMILIES = ['Gemini', 'Claude', 'OpenAI'];

function getProxyModelConfidenceLabel(confidence) {
  if (confidence === 'low' || confidence === 'medium') return 'Chưa chắc';
  if (confidence === 'unknown') return 'Chưa rõ';
  return '';
}

function CustomProxyModelPicker({
  models = [],
  selectedModel,
  onSelect,
  title = 'Model đã lấy',
  profileId = '',
  profileLabel = '',
}) {
  const [searchText, setSearchText] = useState('');
  const [familyFilter, setFamilyFilter] = useState('Tất cả');
  if (!models.length) return null;

  const context = { profileId, profileLabel };
  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredModels = models.filter((model) => {
    const meta = classifyProxyModel(model, context);
    const matchesSearch = !normalizedSearch
      || meta.id.toLowerCase().includes(normalizedSearch)
      || meta.channel.toLowerCase().includes(normalizedSearch)
      || meta.family.toLowerCase().includes(normalizedSearch);
    const matchesFamily = familyFilter === 'Tất cả'
      || (familyFilter === 'Khác'
        ? !PRIMARY_PROXY_MODEL_FAMILIES.includes(meta.family)
        : meta.family === familyFilter);
    return matchesSearch && matchesFamily;
  });
  const filteredGroups = groupProxyModelsForDisplay(filteredModels, context);

  return (
    <div className="custom-proxy-model-picker">
      <div className="custom-proxy-model-picker__header">
        <div>
          <strong>{title}</strong>
          <span>{models.length} model</span>
        </div>
      </div>
      <div className="custom-proxy-model-tools">
        <input
          className="input custom-proxy-model-search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Tìm model..."
        />
        <div className="custom-proxy-model-filters" role="group" aria-label="Lọc theo họ model">
          {PROXY_MODEL_FAMILY_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`custom-proxy-model-filter ${familyFilter === filter ? 'is-active' : ''}`}
              onClick={() => setFamilyFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>
      <div className="custom-proxy-model-list">
        {filteredGroups.length > 0 ? filteredGroups.map((group) => (
          <div className="custom-proxy-model-group" key={group.channel}>
            <div className="custom-proxy-model-group__header">
              <span>{group.channel}</span>
              <small>{group.models.length} model</small>
            </div>
            {group.families.map((familyGroup) => (
              <div className="custom-proxy-model-family" key={`${group.channel}:${familyGroup.family}`}>
                <div className="custom-proxy-model-family__label">{familyGroup.family}</div>
                {familyGroup.models.map((model) => {
                  const confidenceLabel = getProxyModelConfidenceLabel(model.confidence);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`custom-proxy-model-item ${selectedModel === model.id ? 'is-active' : ''}`}
                      onClick={() => onSelect(model.id)}
                    >
                      <span className="custom-proxy-model-item__id">{model.id}</span>
                      <span className="custom-proxy-model-item__badges">
                        <span className="custom-proxy-model-badge">{model.family}</span>
                        <span className="custom-proxy-model-badge custom-proxy-model-badge--muted">{model.channel}</span>
                        {confidenceLabel ? (
                          <span className="custom-proxy-model-badge custom-proxy-model-badge--warning">{confidenceLabel}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )) : (
          <div className="custom-proxy-model-empty">Không có model phù hợp.</div>
        )}
      </div>
    </div>
  );
}

function getProxyProfileTestKey(profileId) {
  return `${PROVIDERS.OPENAI_PROXY}:${profileId}`;
}

function getProxyEndpointPreview(profile, path) {
  try {
    return profile?.baseUrl ? buildOpenAIProxyEndpoint(profile.baseUrl, path) : '';
  } catch (error) {
      return toVietnameseErrorMessage(error, 'URL chưa hợp lệ');
  }
}

function readSettingsKeyCounts() {
  return {
    agProxy: keyManager.getKeyCount('gemini_proxy'),
    customProxy: keyManager.getKeyCount(PROVIDERS.OPENAI_PROXY),
    geminiDirect: keyManager.getKeyCount(PROVIDERS.GEMINI_DIRECT),
  };
}

function getSettingsProviderFeature(providerCardOrProvider) {
  if (providerCardOrProvider === PROVIDER_CARD_AG_PROXY) return ACCESS_FEATURES.AG_PROXY;
  if (providerCardOrProvider === PROVIDER_CARD_CUSTOM_PROXY) return ACCESS_FEATURES.CUSTOM_PROXY;
  if (providerCardOrProvider === PROVIDERS.AI_STUDIO_RELAY) return ACCESS_FEATURES.AI_STUDIO_RELAY;
  if (providerCardOrProvider === PROVIDERS.GEMINI_DIRECT) return ACCESS_FEATURES.GEMINI_DIRECT;
  return '';
}

export default function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const isMobileLayout = useMobileLayout(900);
  const { hasFeature, getDeniedMessage } = useUserAccess();
  const initialProxySettings = getOpenAIProxySettings();
  const initialAgProxyProfile = getAgOpenAIProxyProfile();
  const [activeProxyProfileId, setActiveProxyProfileId] = useState(initialProxySettings.activeProfileId);
  const [agProxyModels, setAgProxyModelList] = useState(initialAgProxyProfile.models);
  const [customProxyProfile, setCustomProxyProfile] = useState(initialProxySettings.customProfile);
  const [proxyModelFetchStatus, setProxyModelFetchStatus] = useState(null);
  const [fetchingProxyModels, setFetchingProxyModels] = useState(false);
  const [showCustomProxyAdvanced, setShowCustomProxyAdvanced] = useState(false);
  const [showCustomProxySetup, setShowCustomProxySetup] = useState(false);
  const [keyCounts, setKeyCounts] = useState(readSettingsKeyCounts);
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
  const selectedProxyPreset = PROXY_MODEL_PRESETS.find((model) => model.id === proxyModel)
    || (proxyModel ? { id: proxyModel, label: proxyModel } : PROXY_MODEL_PRESETS[1] || PROXY_MODEL_PRESETS[0]);
  const selectedProviderCard = provider === PROVIDERS.OPENAI_PROXY
    ? (activeProxyProfileId === CUSTOM_PROXY_PROFILE_ID ? PROVIDER_CARD_CUSTOM_PROXY : PROVIDER_CARD_AG_PROXY)
    : provider;
  const agProxyFetchedModels = normalizeAgProxyModelList(agProxyModels);
  const agProxyFallbackOptions = [
    ...(!PROXY_MODEL_PRESETS.some((model) => model.id === proxyModel) && proxyModel
      ? [getAgProxyModelOption(proxyModel)]
      : []),
    ...PROXY_MODEL_PRESETS,
  ];
  const agProxyModelOptions = agProxyFetchedModels.length > 0
    ? normalizeAgProxyModelList([proxyModel, ...agProxyFetchedModels]).map(getAgProxyModelOption)
    : agProxyFallbackOptions;
  const agProxyModelOptionGroups = groupProxyModelOptionsForSelect(agProxyModelOptions, {
    profileId: AG_PROXY_PROFILE_ID,
    profileLabel: 'AG Proxy',
  });
  const customProxyModels = String(customProxyProfile.baseUrl || '').trim()
    ? normalizeCustomProxyModelList([
      customProxyProfile.defaultModel,
      ...(Array.isArray(customProxyProfile.models) ? customProxyProfile.models : []),
    ])
    : [];
  const customProxyModelOptions = customProxyModels.map((model) => ({ id: model, label: model }));
  const customProxyModelOptionGroups = groupProxyModelOptionsForSelect(customProxyModelOptions, {
    profileId: CUSTOM_PROXY_PROFILE_ID,
    profileLabel: customProxyProfile.label || 'Custom Proxy',
  });
  const customProxyTransportMode = resolveProxyTransportMode(customProxyProfile);
  const customProxyChatPreview = getProxyEndpointPreview(
    customProxyProfile,
    customProxyProfile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH,
  );
  const customProxyModelsPreview = getProxyEndpointPreview(
    customProxyProfile,
    customProxyProfile.modelsPath || DEFAULT_PROXY_MODELS_PATH,
  );
  const customProxyKeyCount = keyCounts.customProxy;
  const geminiDirectKeyCount = keyCounts.geminiDirect;
  const aiStudioConnectorConnected = Boolean(aiStudioRelayStatus?.connectorConnected);
  const aiStudioClientConnected = Boolean(aiStudioRelayStatus?.clientConnected);
  const aiStudioRelayExpired = Boolean(aiStudioRelayStatus?.expired);
  const selectedOllamaPresetKey = detectOllamaModelType(ollamaModel);
  const selectedOllamaPreset = selectedOllamaPresetKey ? OLLAMA_MODEL_PRESETS[selectedOllamaPresetKey] : null;
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
        setAIStudioRelayStatusError(toVietnameseErrorMessage(error, 'Không đọc được trạng thái room.'));
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
    if (!hasFeature(ACCESS_FEATURES.AI_STUDIO_RELAY)) {
      setTestResults(p => ({
        ...p,
        [PROVIDERS.AI_STUDIO_RELAY]: {
          success: false,
          error: getDeniedMessage(ACCESS_FEATURES.AI_STUDIO_RELAY),
        },
      }));
      return;
    }

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
          error: toVietnameseErrorMessage(error, 'Không thể tạo room AI Studio Relay.'),
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
  const syncCustomProxyProfile = (patch = {}, { activate = false } = {}) => {
    const hasBaseUrlPatch = Object.prototype.hasOwnProperty.call(patch, 'baseUrl');
    const nextBaseUrl = String((patch.baseUrl ?? customProxyProfile.baseUrl) || '').trim();
    const baseUrlChanged = hasBaseUrlPatch
      && nextBaseUrl !== String(customProxyProfile.baseUrl || '').trim();
    const shouldClearStoredModels = !nextBaseUrl || baseUrlChanged;
    const nextProfile = {
      ...customProxyProfile,
      ...patch,
      label: String((patch.label ?? customProxyProfile.label) || 'Custom OpenAI-compatible').trim(),
      baseUrl: nextBaseUrl,
      defaultModel: String((shouldClearStoredModels ? '' : (patch.defaultModel ?? customProxyProfile.defaultModel)) || '').trim(),
      chatCompletionsPath: String(
        (patch.chatCompletionsPath ?? customProxyProfile.chatCompletionsPath) || DEFAULT_PROXY_CHAT_PATH,
      ).trim() || DEFAULT_PROXY_CHAT_PATH,
      modelsPath: String((patch.modelsPath ?? customProxyProfile.modelsPath) || DEFAULT_PROXY_MODELS_PATH).trim()
        || DEFAULT_PROXY_MODELS_PATH,
      models: normalizeCustomProxyModelList(shouldClearStoredModels ? [] : (patch.models ?? customProxyProfile.models ?? [])),
      supportsGeminiSafetySettings: Boolean(
        patch.supportsGeminiSafetySettings ?? customProxyProfile.supportsGeminiSafetySettings,
      ),
      transport: String((patch.transport ?? customProxyProfile.transport) || 'auto').trim() || 'auto',
    };
    const saved = updateCustomOpenAIProxyProfile(nextProfile);
    setCustomProxyProfile(saved);
    if (activate) {
      setOpenAIProxyActiveProfile(CUSTOM_PROXY_PROFILE_ID);
      setActiveProxyProfileId(CUSTOM_PROXY_PROFILE_ID);
      setProvider(PROVIDERS.OPENAI_PROXY);
      modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);
    }
    return saved;
  };

  const handleProviderSelect = (nextProvider) => {
    const feature = getSettingsProviderFeature(nextProvider);
    if (feature && !hasFeature(feature)) {
      setProxyModelFetchStatus({
        type: 'error',
        text: getDeniedMessage(feature),
      });
      return;
    }

    if (nextProvider === PROVIDER_CARD_AG_PROXY) {
      setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
      setActiveProxyProfileId(AG_PROXY_PROFILE_ID);
      setProvider(PROVIDERS.OPENAI_PROXY);
      modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);
      return;
    }

    if (nextProvider === PROVIDER_CARD_CUSTOM_PROXY) {
      syncCustomProxyProfile({}, { activate: true });
      return;
    }

    setProvider(nextProvider);
    modelRouter.setPreferredProvider(nextProvider);
  };
  const handleOpenAiStudio = () => {
    window.open('https://aistudio.google.com/app/apikey', '_blank', 'noopener,noreferrer');
  };
  const handleGoBack = () => {
    navigateBackOr(navigate, '/', { location });
  };
  const handleKeysChange = () => setKeyCounts(readSettingsKeyCounts());

  const handleSelectAgProxyModel = (model) => {
    const normalized = String(model || '').trim();
    setProxyModel(normalized);
    modelRouter.setProxyModel(normalized);
  };

  const handleSelectOllamaModel = (model) => {
    const normalized = String(model || '').trim();
    setOllamaModel(normalized);
    modelRouter.setOllamaModel(normalized);
  };

  const handleSaveOllamaSettings = () => {
    const normalizedUrl = ollamaUrl.trim().replace(/\/+$/u, '') || 'http://localhost:11434';
    setOllamaUrl(normalizedUrl);
    saveSettings({ ollamaUrl: normalizedUrl });
    if (ollamaModel.trim()) modelRouter.setOllamaModel(ollamaModel.trim());
  };

  const handleApplyOllamaPreset = (presetKey) => {
    const preset = OLLAMA_MODEL_PRESETS[presetKey];
    if (!preset?.recommended) return;
    handleSelectOllamaModel(preset.recommended);
  };

  const handleFetchAgProxyModels = async () => {
    if (!hasFeature(ACCESS_FEATURES.AG_PROXY)) {
      setProxyModelFetchStatus({ type: 'error', text: getDeniedMessage(ACCESS_FEATURES.AG_PROXY) });
      return;
    }

    setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
    setActiveProxyProfileId(AG_PROXY_PROFILE_ID);
    setProvider(PROVIDERS.OPENAI_PROXY);
    modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);

    const profile = getAgOpenAIProxyProfile();
    setFetchingProxyModels(true);
    setProxyModelFetchStatus({ type: 'pending', text: 'Đang lấy danh sách models từ Gemini Proxy mặc định...' });
    try {
      const models = await fetchOpenAIProxyModels({
        profile,
        apiKey: keyManager.getNextKey(getOpenAIProxyKeyProvider(profile)) || '',
        signal: AbortSignal.timeout(15000),
      });
      const allModels = normalizeProxyModelList(models);
      const uniqueModels = normalizeAgProxyModelList(allModels);
      if (uniqueModels.length === 0) {
        setProxyModelFetchStatus({
          type: 'error',
          text: `Đã lấy ${allModels.length} models nhưng không thấy model hợp lệ. Vẫn giữ danh sách preset có sẵn.`,
        });
        return;
      }

      const savedModels = setAgProxyModels(uniqueModels);
      setAgProxyModelList(savedModels);
      const stableFlashModel = PROXY_MODEL_PRESETS[1]?.id;
      const nextModel = savedModels.includes(proxyModel)
        ? proxyModel
        : (savedModels.includes(stableFlashModel) ? stableFlashModel : savedModels[0]);
      handleSelectAgProxyModel(nextModel);
      setProxyModelFetchStatus({
        type: 'success',
        text: `Đã lấy ${allModels.length} models, lưu ${savedModels.length} model cho ag.`,
      });
    } catch (error) {
      setProxyModelFetchStatus({
        type: 'error',
        text: `${toVietnameseErrorMessage(error, 'Không lấy được danh sách model')}. Vẫn có thể dùng preset Gemini Proxy có sẵn.`,
      });
    } finally {
      setFetchingProxyModels(false);
    }
  };

  const handleFetchCustomProxyModels = async () => {
    if (!hasFeature(ACCESS_FEATURES.CUSTOM_PROXY)) {
      setProxyModelFetchStatus({ type: 'error', text: getDeniedMessage(ACCESS_FEATURES.CUSTOM_PROXY) });
      return;
    }

    const profile = syncCustomProxyProfile({}, { activate: true });
    if (!profile.baseUrl) {
      setProxyModelFetchStatus({ type: 'error', text: 'Nhập Base URL trước khi lấy models.' });
      return;
    }

    setFetchingProxyModels(true);
    setProxyModelFetchStatus({ type: 'pending', text: 'Đang lấy danh sách models...' });
    try {
      const models = await fetchOpenAIProxyModels({
        profile,
        apiKey: keyManager.getNextKey(getOpenAIProxyKeyProvider(profile)) || '',
        signal: AbortSignal.timeout(15000),
      });
      const allModels = normalizeProxyModelList(models);
      const uniqueModels = normalizeCustomProxyModelList(allModels);
      if (uniqueModels.length === 0) {
        setProxyModelFetchStatus({
          type: 'error',
          text: `Đã lấy ${allModels.length} models nhưng không thấy model hợp lệ. Bạn vẫn có thể nhập model thủ công.`,
        });
        return;
      }

      const defaultModel = profile.defaultModel || uniqueModels[0];
      const saved = syncCustomProxyProfile({
        models: uniqueModels,
        defaultModel,
      }, { activate: true });
      setProxyModelFetchStatus({
        type: 'success',
        text: `Đã lấy ${allModels.length} models, lưu ${saved.models.length} model Custom Proxy.`,
      });
    } catch (error) {
      setProxyModelFetchStatus({
        type: 'error',
        text: `${toVietnameseErrorMessage(error, 'Không lấy được danh sách model')}. Nếu bị CORS hoặc proxy không có /v1/models, nhập model thủ công.`,
      });
    } finally {
      setFetchingProxyModels(false);
    }
  };

  const handleTest = async (prov, resultKey = prov) => {
    const feature = getSettingsProviderFeature(
      resultKey === getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)
        ? PROVIDER_CARD_CUSTOM_PROXY
        : resultKey === getProxyProfileTestKey(AG_PROXY_PROFILE_ID)
          ? PROVIDER_CARD_AG_PROXY
          : prov,
    );
    if (feature && !hasFeature(feature)) {
      setTestResults(p => ({
        ...p,
        [resultKey]: {
          success: false,
          error: getDeniedMessage(feature),
        },
      }));
      return;
    }

    if (prov === PROVIDERS.OLLAMA) {
      handleSaveOllamaSettings();
    }
    if (prov === PROVIDERS.AI_STUDIO_RELAY) {
      handleSaveAIStudioRelay();
    }
    if (prov === PROVIDERS.OPENAI_PROXY && resultKey === getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)) {
      syncCustomProxyProfile({}, { activate: true });
    }
    if (prov === PROVIDERS.OPENAI_PROXY && resultKey === getProxyProfileTestKey(AG_PROXY_PROFILE_ID)) {
      setOpenAIProxyActiveProfile(AG_PROXY_PROFILE_ID);
      setActiveProxyProfileId(AG_PROXY_PROFILE_ID);
      setProvider(PROVIDERS.OPENAI_PROXY);
      modelRouter.setPreferredProvider(PROVIDERS.OPENAI_PROXY);
    }
    setTesting(p => ({ ...p, [resultKey]: true }));
    const result = await aiService.testConnection(prov);
    setTestResults(p => ({ ...p, [resultKey]: result }));
    setTesting(p => ({ ...p, [resultKey]: false }));
    if (prov === PROVIDERS.OLLAMA && result.success) {
      const models = result.models || [];
      setOllamaModels(models);
      if (!ollamaModel.trim() && models[0]) {
        handleSelectOllamaModel(models[0]);
      }
    }
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
        <AccountAccessSummary />

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
              { value: PROVIDER_CARD_AG_PROXY, icon: Server, label: 'Gemini Proxy mặc định', desc: '/api/proxy - ag' },
              { value: PROVIDER_CARD_CUSTOM_PROXY, icon: Server, label: 'Custom OpenAI-compatible', desc: 'one-api / NewAPI / proxy clone' },
              { value: PROVIDERS.GEMINI_DIRECT, icon: Cloud, label: 'Gemini Direct', desc: 'AI Studio, dành cho VIP' },
              { value: PROVIDERS.AI_STUDIO_RELAY, icon: Cloud, label: 'AI Studio Relay', desc: 'Experimental' },
              { value: PROVIDERS.OLLAMA, icon: Cpu, label: 'Ollama', desc: 'Local AI' },
            ].map((p) => {
              const feature = getSettingsProviderFeature(p.value);
              const locked = feature && !hasFeature(feature);
              return (
                <button
                  key={p.value}
                  className={`settings-radio-card compact ${selectedProviderCard === p.value ? 'settings-radio-card--active' : ''} ${locked ? 'settings-radio-card--locked' : ''}`}
                  onClick={() => handleProviderSelect(p.value)}
                  title={locked ? getDeniedMessage(feature) : undefined}
                >
                  <p.icon size={18} />
                  <div>
                    <div className="settings-radio-label">{p.label}</div>
                    <div className="settings-radio-desc">{locked ? getDeniedMessage(feature) : p.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedProviderCard === PROVIDER_CARD_AG_PROXY ? (
            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
              <ModelDefaultCallout
                eyebrow="Model AG Proxy"
                value={selectedProxyPreset?.label || 'Chưa chọn model'}
                hint="Bấm vào hộp bên dưới để đổi model mặc định cho toàn bộ tác vụ AG Proxy."
                selectLabel="Chọn model AG mặc định"
                selectValue={proxyModel}
                options={agProxyModelOptions}
                optionGroups={agProxyModelOptionGroups}
                onChange={handleSelectAgProxyModel}
              />
              <div className="settings-action-row settings-action-row--spaced">
                <button
                  className="btn btn-secondary"
                  onClick={handleFetchAgProxyModels}
                  disabled={fetchingProxyModels}
                >
                  {fetchingProxyModels ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Lấy models
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleTest(PROVIDERS.OPENAI_PROXY, getProxyProfileTestKey(AG_PROXY_PROFILE_ID))}
                  disabled={testing[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)]}
                >
                  {testing[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)] ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />}
                  Test
                </button>
              </div>
              <CustomProxyModelPicker
                models={agProxyFetchedModels}
                selectedModel={proxyModel}
                onSelect={handleSelectAgProxyModel}
                title="Danh sách model AG"
                profileId={AG_PROXY_PROFILE_ID}
                profileLabel="AG Proxy"
              />
              {proxyModelFetchStatus ? (
                <div className={`settings-test-result ${proxyModelFetchStatus.type === 'success' ? 'success' : proxyModelFetchStatus.type === 'pending' ? 'pending' : 'error'}`}>
                  {proxyModelFetchStatus.type === 'success' ? <CheckCircle size={14} /> : proxyModelFetchStatus.type === 'pending' ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
                  {proxyModelFetchStatus.text}
                </div>
              ) : null}
              {testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)] ? (
                <div className={`settings-test-result ${testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)].success ? 'success' : 'error'}`}>
                  {testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)].success
                    ? <><CheckCircle size={14} /> Kết nối OK</>
                    : <><XCircle size={14} /> {testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)].error}</>}
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedProviderCard === PROVIDER_CARD_CUSTOM_PROXY ? (
            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
              <div className="settings-provider-setup-banner">
                <div>
                  <strong>Cấu hình Custom Proxy</strong>
                  <p>
                    Sửa Base URL, API key riêng, lấy models, path và transport ở trang setup lớn.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowCustomProxySetup(true)}
                >
                  <Server size={14} /> Mở setup Custom
                </button>
              </div>

              <ModelDefaultCallout
                eyebrow="Model Custom Proxy"
                value={customProxyProfile.defaultModel || 'Chưa chọn model'}
                hint="Model này áp dụng cho mọi tác vụ khi bạn chọn Custom OpenAI-compatible."
                selectLabel="Chọn model Custom Proxy mặc định"
                selectValue={customProxyProfile.defaultModel || ''}
                options={customProxyModelOptions}
                optionGroups={customProxyModelOptionGroups}
                onChange={(model) => syncCustomProxyProfile({ defaultModel: model }, { activate: true })}
                disabled={customProxyModelOptions.length === 0}
              />

              <div className="form-group">
                <label className="form-label">Nhập model thủ công</label>
                <input
                  className="input"
                  value={customProxyProfile.defaultModel || ''}
                  onChange={(event) => syncCustomProxyProfile({ defaultModel: event.target.value }, { activate: true })}
                  placeholder="gcli-gemini-3.1-pro-preview, gemini-2.5-flash..."
                />
                <p className="settings-hint">
                  Nếu chưa lấy được danh sách model, nhập đúng model id của proxy rồi bấm Test.
                </p>
              </div>

              <div className="settings-action-row settings-action-row--spaced">
                <button
                  className="btn btn-secondary"
                  onClick={handleFetchCustomProxyModels}
                  disabled={fetchingProxyModels || !String(customProxyProfile.baseUrl || '').trim()}
                >
                  {fetchingProxyModels ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Lấy models
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleTest(PROVIDERS.OPENAI_PROXY, getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID))}
                  disabled={testing[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] || !String(customProxyProfile.baseUrl || '').trim()}
                >
                  {testing[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />}
                  Test
                </button>
              </div>

              {proxyModelFetchStatus ? (
                <div className={`settings-test-result ${proxyModelFetchStatus.type === 'success' ? 'success' : proxyModelFetchStatus.type === 'pending' ? 'pending' : 'error'}`}>
                  {proxyModelFetchStatus.type === 'success' ? <CheckCircle size={14} /> : proxyModelFetchStatus.type === 'pending' ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
                  {proxyModelFetchStatus.text}
                </div>
              ) : null}
              {testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] ? (
                <div className={`settings-test-result ${testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)].success ? 'success' : 'error'}`}>
                  {testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)].success
                    ? <><CheckCircle size={14} /> Kết nối OK</>
                    : <><XCircle size={14} /> {testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)].error}</>}
                </div>
              ) : null}
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
              <p>Keys tách riêng theo từng nguồn. Key của ag không dùng chung với Custom Proxy.</p>
            </div>
          </div>

          <div className="settings-key-grid">
            <KeySection
              provider="gemini_proxy"
              providerLabel="Gemini Proxy mặc định (ag)"
              description="Dùng cho preset /api/proxy trên Vercel."
              icon={Server}
              onKeysChange={handleKeysChange}
            />
            <KeySection
              provider={PROVIDERS.OPENAI_PROXY}
              providerLabel="Custom OpenAI-compatible"
              description="Dùng riêng cho web/proxy custom. Không dùng chung với Gemini Proxy mặc định ag."
              icon={Server}
              onKeysChange={handleKeysChange}
            />
            <KeySection
              provider={PROVIDERS.GEMINI_DIRECT}
              providerLabel="Gemini Direct (AI Studio)"
              description="Dùng cho API key từ Google AI Studio."
              icon={Cloud}
              onKeysChange={handleKeysChange}
            />
          </div>
        </section>

        {/* === GEMINI PROXY === */}
        <section className="settings-section card animate-slide-up" style={{ animationDelay: '120ms' }}>
          <div className="settings-section-header">
            <Server size={20} />
            <div>
              <h2>Gemini Proxy mặc định</h2>
              <p>ag.beijixingxing - OpenAI-compatible qua /api/proxy để tránh CORS trên Vercel.</p>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Proxy URL</label>
            <div className="settings-input-row">
              <input className="input" value="/api/proxy" readOnly placeholder="/api/proxy" />
              <button className="btn btn-secondary" onClick={() => handleProviderSelect(PROVIDER_CARD_AG_PROXY)}>Dùng preset</button>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => handleTest(PROVIDERS.OPENAI_PROXY, getProxyProfileTestKey(AG_PROXY_PROFILE_ID))}
                disabled={testing[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)]}
              >
                {testing[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)] ? <RefreshCw size={16} className="animate-spin" /> : <TestTube size={16} />}
              </button>
            </div>
            <p className="settings-hint">Mặc định: <code>/api/proxy</code> (Vercel rewrite -&gt; ag.beijixingxing.com). Không cần đổi trừ khi dùng proxy khác.</p>
            {testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)] && (
              <div className={`settings-test-result ${testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)].success ? 'success' : 'error'}`}>
                {testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)].success
                  ? <><CheckCircle size={14} /> Kết nối OK</>
                  : <><XCircle size={14} /> {testResults[getProxyProfileTestKey(AG_PROXY_PROFILE_ID)].error}</>}
              </div>
            )}
          </div>
        </section>

        <section className="settings-section card animate-slide-up" style={{ animationDelay: '150ms' }}>
          <div className="settings-section-header settings-section-header--with-action">
            <div className="settings-section-header__title">
              <Server size={20} />
              <div>
                <h2>Custom OpenAI-compatible</h2>
                <p>Nhập web proxy OpenAI-compatible. Hosted HTTPS dùng Vercel relay; local/private URL dùng direct và cần CORS.</p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                syncCustomProxyProfile({}, { activate: true });
                setShowCustomProxySetup(true);
              }}
            >
              <Server size={14} /> Mở cấu hình
            </button>
          </div>

          <div className="settings-summary-grid">
            <div className="settings-summary-tile">
              <span>Base URL</span>
              <strong>{customProxyProfile.baseUrl || 'Chưa cấu hình'}</strong>
            </div>
            <div className="settings-summary-tile">
              <span>Model</span>
              <strong>{customProxyProfile.defaultModel || 'Chưa chọn'}</strong>
            </div>
            <div className="settings-summary-tile">
              <span>Keys riêng</span>
              <strong>{customProxyKeyCount} keys</strong>
            </div>
            <div className="settings-summary-tile">
              <span>Transport</span>
              <strong>{customProxyTransportMode === 'relay' ? 'Vercel relay' : 'Direct'}</strong>
            </div>
          </div>

          <div className="settings-action-row settings-action-row--spaced">
            <button
              className="btn btn-secondary"
              onClick={() => {
                syncCustomProxyProfile({}, { activate: true });
                setProxyModelFetchStatus({ type: 'success', text: 'Đã chọn Custom Proxy.' });
              }}
            >
              <Check size={14} /> Dùng custom
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                syncCustomProxyProfile({}, { activate: true });
                setShowCustomProxySetup(true);
              }}
            >
              <Server size={14} /> Mở setup Custom
            </button>
          </div>
          <p className="settings-hint">
            Đổi model nhanh ở khối Provider đang dùng. Mở setup khi cần sửa Base URL, key riêng, path hoặc transport.
          </p>
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
                disabled={testing[PROVIDERS.GEMINI_DIRECT] || geminiDirectKeyCount === 0}>
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
              <input
                className="input"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <button className="btn btn-secondary" onClick={handleSaveOllamaSettings}>Lưu</button>
              <button className="btn btn-secondary" onClick={() => handleTest(PROVIDERS.OLLAMA)} disabled={testing[PROVIDERS.OLLAMA]}>
                {testing[PROVIDERS.OLLAMA] ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Lấy models
              </button>
              <button className="btn btn-ghost" onClick={() => handleTest(PROVIDERS.OLLAMA)} disabled={testing[PROVIDERS.OLLAMA]}>
                {testing[PROVIDERS.OLLAMA] ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />}
                Test
              </button>
            </div>
            <p className="settings-hint">
              Bấm Test hoặc Lấy models sẽ lưu URL hiện tại trước khi gọi <code>/api/tags</code>. Nếu bị lỗi, chạy <code>ollama serve</code> rồi thử lại.
            </p>
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
              <select className="select" value={ollamaModel} onChange={(e) => handleSelectOllamaModel(e.target.value)}>
                <option value="">Chọn...</option>
                {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" placeholder="llama3, gemma2, qwen2.5..." value={ollamaModel}
                onChange={(e) => handleSelectOllamaModel(e.target.value)} />
            )}
            {selectedOllamaPreset ? (
              <p className="settings-hint">
                Preset đang áp dụng: <strong>{selectedOllamaPreset.name}</strong>. StoryForge sẽ tự gửi options phù hợp và bật thinking mode nếu model hỗ trợ.
              </p>
            ) : (
              <p className="settings-hint">
                Có thể nhập thủ công tên model đã cài, ví dụ <code>qwen3:4b</code>, <code>llama3.2:3b</code>.
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Preset nhanh như Dịch truyện</label>
            <div className="model-list">
              {OLLAMA_PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`model-item ${selectedOllamaPresetKey === preset.key ? 'model-item--active' : ''}`}
                  onClick={() => handleApplyOllamaPreset(preset.key)}
                >
                  <span className={`model-status ${selectedOllamaPresetKey === preset.key ? 'model-status--on' : ''}`}>
                    {selectedOllamaPresetKey === preset.key ? '✓' : '○'}
                  </span>
                  <div className="model-info">
                    <span className="model-name">{preset.name}</span>
                    <span className="model-meta">{preset.recommended}</span>
                  </div>
                </button>
              ))}
            </div>
            {selectedOllamaPreset ? (
              <p className="settings-hint">{selectedOllamaPreset.tips}</p>
            ) : null}
          </div>
        </section>
        <CloudSyncSection />

      </div>

      {showCustomProxySetup ? (
        <div className="modal-overlay ai-studio-relay-overlay openai-proxy-setup-overlay" role="presentation" onClick={() => setShowCustomProxySetup(false)}>
          <div
            className="modal ai-studio-relay-modal openai-proxy-setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="openai-proxy-setup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="ai-studio-relay-modal__eyebrow">Custom provider</div>
                <h2 className="modal-title" id="openai-proxy-setup-title">Thiết lập Custom OpenAI-compatible</h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowCustomProxySetup(false)}
                aria-label="Đóng thiết lập Custom OpenAI-compatible"
              >
                <X size={16} />
              </button>
            </div>

            <div className="ai-studio-relay-modal__body openai-proxy-setup-body">
              <div className="ai-studio-relay-hero openai-proxy-hero">
                <div>
                  <p className="ai-studio-relay-hero__kicker">Dành cho proxy OpenAI-compatible</p>
                  <p>
                    Dùng cho one-api, NewAPI, OpenRouter, Gemini CLI proxy clone hoặc endpoint có dạng
                    <code> /v1/chat/completions</code>. Nếu là URL HTTPS public, StoryForge có thể đi qua Vercel relay.
                    Nếu là localhost hoặc mạng riêng, trình duyệt sẽ gọi direct và server đó cần bật CORS.
                  </p>
                </div>
                <div className="ai-studio-relay-hero__status openai-proxy-hero__status">
                  <span>Trạng thái</span>
                  <strong>{activeProxyProfileId === CUSTOM_PROXY_PROFILE_ID ? 'Đang dùng Custom' : 'Chưa chọn Custom'}</strong>
                  <small>
                    {customProxyKeyCount} keys riêng · {customProxyModels.length} models · {customProxyTransportMode === 'relay' ? 'Vercel relay' : 'Direct'}
                  </small>
                </div>
              </div>

              <div className="ai-studio-relay-layout openai-proxy-layout">
                <aside className="ai-studio-relay-guide openai-proxy-guide">
                  <h3>Cách cấu hình</h3>
                  <div className="ai-studio-relay-steps">
                    {[
                      ['Nhập Base URL', 'Dán root domain, /v1 hoặc full /v1/chat/completions. StoryForge sẽ tự chuẩn hóa endpoint.'],
                      ['Thêm key riêng', 'Key ở đây chỉ dùng cho Custom Proxy, không trộn với key Gemini Proxy mặc định ag.'],
                      ['Lấy hoặc nhập model', 'Bấm Lấy models nếu proxy có /v1/models. Nếu fail, nhập model thủ công vẫn dùng được.'],
                      ['Test rồi dùng', 'Bấm Test để kiểm tra kết nối, sau đó bấm Lưu và dùng để áp dụng toàn app.'],
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
                    <strong>Lưu ý Vercel</strong>
                    <p>
                      Hosted HTTPS public có thể dùng relay cùng origin. Localhost, LM Studio local hoặc IP mạng riêng
                      phải dùng direct vì Vercel cloud không gọi được máy local của người dùng.
                    </p>
                  </div>
                </aside>

                <section className="ai-studio-relay-config openai-proxy-config">
                  <div className="openai-proxy-config-grid">
                    <div className="openai-proxy-subblock">
                      <div className="openai-proxy-subblock__title">Kết nối</div>
                      <div className="form-group">
                        <label className="form-label">Tên hiển thị</label>
                        <input
                          className="input"
                          value={customProxyProfile.label || ''}
                          onChange={(event) => setCustomProxyProfile((prev) => ({ ...prev, label: event.target.value }))}
                          placeholder="Custom OpenAI-compatible"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Base URL</label>
                        <input
                          className="input"
                          value={customProxyProfile.baseUrl || ''}
                          onChange={(event) => setCustomProxyProfile((prev) =>
                            resetCustomProxyModelsOnBaseUrlChange(prev, event.target.value)
                          )}
                          placeholder="https://proxy.example.com hoặc http://localhost:1234/v1"
                        />
                        <p className="settings-hint">
                          Có thể nhập root, /v1 hoặc full /v1/chat/completions. Không nối trùng /v1.
                        </p>
                      </div>
                      <div className="openai-proxy-preview">
                        <span>Chat</span>
                        <code>{customProxyChatPreview || 'Nhập Base URL để xem endpoint'}</code>
                      </div>
                      <div className="openai-proxy-preview">
                        <span>Models</span>
                        <code>{customProxyModelsPreview || 'Nhập Base URL để xem endpoint'}</code>
                      </div>
                    </div>

                    <div className="openai-proxy-subblock">
                      <div className="openai-proxy-subblock__title">API key riêng</div>
                      <KeySection
                        provider={PROVIDERS.OPENAI_PROXY}
                        providerLabel="Custom Proxy"
                        description="Key này chỉ dùng cho Base URL custom, không dùng cho ag."
                        icon={Key}
                        onKeysChange={handleKeysChange}
                      />
                    </div>
                  </div>

                  <div className="openai-proxy-subblock">
                    <div className="openai-proxy-subblock__title">Models</div>
                    <div className="settings-action-row">
                      <button
                        className="btn btn-secondary"
                        onClick={handleFetchCustomProxyModels}
                        disabled={fetchingProxyModels || !String(customProxyProfile.baseUrl || '').trim()}
                      >
                        {fetchingProxyModels ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Lấy models
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          syncCustomProxyProfile({}, { activate: true });
                          setProxyModelFetchStatus({ type: 'success', text: 'Đã lưu Custom Proxy.' });
                        }}
                      >
                        <Check size={14} /> Lưu
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleTest(PROVIDERS.OPENAI_PROXY, getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID))}
                        disabled={testing[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] || !String(customProxyProfile.baseUrl || '').trim()}
                      >
                        {testing[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />}
                        Test
                      </button>
                    </div>

                    <CustomProxyModelPicker
                      models={customProxyModels}
                      selectedModel={customProxyProfile.defaultModel || ''}
                      onSelect={(model) => setCustomProxyProfile((prev) => ({ ...prev, defaultModel: model }))}
                      title="Danh sách model Custom Proxy"
                      profileId={CUSTOM_PROXY_PROFILE_ID}
                      profileLabel={customProxyProfile.label || 'Custom Proxy'}
                    />

                    <div className="form-group">
                      <label className="form-label">Nhập model thủ công</label>
                      <input
                        className="input"
                        value={customProxyProfile.defaultModel || ''}
                        onChange={(event) => setCustomProxyProfile((prev) => ({ ...prev, defaultModel: event.target.value }))}
                        placeholder="gemini-2.5-flash, openai/gpt-4.1, llama3..."
                      />
                    </div>
                  </div>

                  <div className="openai-proxy-subblock">
                    <div className="openai-proxy-subblock__title">Trạng thái</div>
                    <div className="openai-proxy-status-grid">
                      <span>Profile</span>
                      <strong>{activeProxyProfileId === CUSTOM_PROXY_PROFILE_ID ? 'Custom đang dùng' : 'Đang lưu sẵn'}</strong>
                      <span>Transport</span>
                      <strong>{customProxyTransportMode === 'relay' ? 'Vercel relay' : 'Direct'}</strong>
                      <span>Models</span>
                      <strong>{customProxyModels.length}</strong>
                      <span>Keys</span>
                      <strong>{customProxyKeyCount}</strong>
                      <span>Gemini safety</span>
                      <strong>{customProxyProfile.supportsGeminiSafetySettings ? 'Bật' : 'Tắt'}</strong>
                    </div>
                    {proxyModelFetchStatus ? (
                      <div className={`settings-test-result ${proxyModelFetchStatus.type === 'success' ? 'success' : proxyModelFetchStatus.type === 'pending' ? 'pending' : 'error'}`}>
                        {proxyModelFetchStatus.type === 'success' ? <CheckCircle size={14} /> : proxyModelFetchStatus.type === 'pending' ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
                        {proxyModelFetchStatus.text}
                      </div>
                    ) : null}
                    {testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] ? (
                      <div className={`settings-test-result ${testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)].success ? 'success' : 'error'}`}>
                        {testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)].success
                          ? <><CheckCircle size={14} /> Kết nối OK</>
                          : <><XCircle size={14} /> {testResults[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)].error}</>}
                      </div>
                    ) : null}
                  </div>

                  <details
                    className="openai-proxy-advanced"
                    open={showCustomProxyAdvanced}
                    onToggle={(event) => setShowCustomProxyAdvanced(event.currentTarget.open)}
                  >
                    <summary>Nâng cao</summary>
                    <div className="openai-proxy-advanced__grid">
                      <label>
                        <span>Chat path</span>
                        <input
                          className="input"
                          value={customProxyProfile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH}
                          onChange={(event) => setCustomProxyProfile((prev) => ({ ...prev, chatCompletionsPath: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Models path</span>
                        <input
                          className="input"
                          value={customProxyProfile.modelsPath || DEFAULT_PROXY_MODELS_PATH}
                          onChange={(event) => setCustomProxyProfile((prev) => ({ ...prev, modelsPath: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>Transport</span>
                        <select
                          className="select"
                          value={customProxyProfile.transport || 'auto'}
                          onChange={(event) => setCustomProxyProfile((prev) => ({ ...prev, transport: event.target.value }))}
                        >
                          <option value="auto">Auto</option>
                          <option value="relay">Vercel relay</option>
                          <option value="direct">Direct</option>
                        </select>
                      </label>
                      <label className="openai-proxy-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(customProxyProfile.supportsGeminiSafetySettings)}
                          onChange={(event) => setCustomProxyProfile((prev) => ({
                            ...prev,
                            supportsGeminiSafetySettings: event.target.checked,
                          }))}
                        />
                        <span>Gửi Gemini safety settings</span>
                      </label>
                    </div>
                  </details>
                </section>
              </div>
            </div>

            <div className="modal-actions ai-studio-relay-modal__actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleFetchCustomProxyModels}
                disabled={fetchingProxyModels || !String(customProxyProfile.baseUrl || '').trim()}
              >
                {fetchingProxyModels ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Lấy models
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleTest(PROVIDERS.OPENAI_PROXY, getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID))}
                disabled={testing[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] || !String(customProxyProfile.baseUrl || '').trim()}
              >
                {testing[getProxyProfileTestKey(CUSTOM_PROXY_PROFILE_ID)] ? <RefreshCw size={14} className="animate-spin" /> : <TestTube size={14} />}
                Test
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  syncCustomProxyProfile({}, { activate: true });
                  setProxyModelFetchStatus({ type: 'success', text: 'Đã lưu và chọn Custom Proxy.' });
                  setShowCustomProxySetup(false);
                }}
              >
                <Check size={14} /> Lưu và dùng
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
