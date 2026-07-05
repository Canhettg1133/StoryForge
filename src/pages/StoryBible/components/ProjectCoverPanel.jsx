import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Image as ImageIcon, Loader2, Palette, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { getGenreLabel, TONES } from '../../../utils/constants.js';
import keyManager from '../../../services/ai/keyManager.js';
import { PROVIDERS } from '../../../services/ai/router.js';
import {
  AG_PROXY_PROFILE_ID,
  CUSTOM_PROXY_PROFILE_ID,
  OPENAI_PROXY_SETTINGS_CHANGED_EVENT,
  getActiveOpenAIProxyProfile,
  getAgOpenAIProxyProfile,
} from '../../../services/ai/openAIProxyConfig.js';
import {
  COVER_ASSET_SOURCES,
  COVER_IMAGE_ACCEPT,
  createProjectCoverAsset,
  createProjectCoverAssetFromFile,
  dataUrlFromBase64,
  deleteProjectCoverAsset,
  getActiveProjectCover,
  getProjectCoverGenerationSettings,
  listProjectCoverAssets,
  setProjectCoverAsset,
} from '../../../services/projectCovers/coverRepository.js';
import {
  buildCoverArtworkPrompt,
  AG_COVER_IMAGE_MODELS,
  CLOUDFLARE_COVER_IMAGE_MODELS,
  CLOUDFLARE_WORKERS_AI_SETTINGS_CHANGED_EVENT,
  COVER_IMAGE_PROVIDERS,
  DEFAULT_COVER_IMAGE_SIZE,
  DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL,
  DEFAULT_GEMINI_COVER_IMAGE_MODEL,
  GEMINI_COVER_IMAGE_MODELS,
  generateCoverImage,
  getCloudflareWorkersAIModelOptions,
  getCloudflareWorkersAISettings,
  getCoverProviderLabel,
  isLikelyCoverImageModel,
  sortCoverImageModels,
} from '../../../services/projectCovers/coverImageProvider.js';

function getToneLabel(value) {
  return TONES.find((tone) => tone.value === value)?.label || value || '';
}

function getProxyProfileIdForProvider(provider) {
  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) return AG_PROXY_PROFILE_ID;
  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) return CUSTOM_PROXY_PROFILE_ID;
  return '';
}

function getProxyProfileForProvider(provider, profiles) {
  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) return profiles.ag;
  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) return profiles.custom;
  return null;
}

function readProjectCoverProxyProfiles() {
  return {
    ag: getAgOpenAIProxyProfile(),
    custom: getActiveOpenAIProxyProfile(CUSTOM_PROXY_PROFILE_ID),
  };
}

function getProxyModelOptions(provider, profiles) {
  const profile = getProxyProfileForProvider(provider, profiles);
  if (!profile) return [];
  return sortCoverImageModels([
    ...(provider === COVER_IMAGE_PROVIDERS.AG_PROXY ? AG_COVER_IMAGE_MODELS.map((item) => item.id) : []),
    profile.defaultModel,
    ...(profile.models || []),
  ]);
}

function getDefaultModelForProvider(provider, profiles) {
  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) {
    return getProxyModelOptions(provider, profiles)[0] || AG_COVER_IMAGE_MODELS[0].id;
  }
  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) {
    return getProxyModelOptions(provider, profiles)[0] || '';
  }
  if (provider === COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI) {
    return getCloudflareWorkersAISettings().defaultModel || DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL;
  }
  return DEFAULT_GEMINI_COVER_IMAGE_MODEL;
}

function getProviderKeyCount(provider) {
  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) {
    return keyManager.getKeyCount(PROVIDERS.GEMINI_PROXY);
  }
  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) {
    return keyManager.getKeyCount(PROVIDERS.OPENAI_PROXY);
  }
  if (provider === COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI) {
    return keyManager.getKeyCount(PROVIDERS.CLOUDFLARE_WORKERS_AI);
  }
  return keyManager.getKeyCount(PROVIDERS.GEMINI_DIRECT);
}

function getCoverModelHint(provider) {
  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) {
    return 'Ưu tiên model ảnh AG; danh sách phụ lấy từ profile Gemini Proxy đã lưu.';
  }
  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) {
    return 'Danh sách lấy từ Custom Proxy trong Cài đặt; nếu proxy không list model ảnh, nhập thủ công.';
  }
  if (provider === COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI) {
    return 'Model ảnh Cloudflare Workers AI; cần Account ID và API token trong Cài đặt.';
  }
  return 'Model ảnh Gemini Direct; AI chỉ tạo artwork, chữ sẽ do giao diện xử lý.';
}

function CoverModelCombobox({
  value,
  options = [],
  disabled = false,
  onChange,
  onCommit,
  placeholder = 'Chọn model tạo bìa',
}) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const normalizedOptions = useMemo(() => sortCoverImageModels(options), [options]);
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? normalizedOptions.filter((option) => option.toLowerCase().includes(needle))
      : normalizedOptions;
    return matched.slice(0, 80);
  }, [normalizedOptions, query]);
  const imageModelCount = useMemo(
    () => normalizedOptions.filter((option) => isLikelyCoverImageModel(option)).length,
    [normalizedOptions],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = globalThis.setTimeout(() => searchRef.current?.focus(), 0);
    return () => globalThis.clearTimeout(focusTimer);
  }, [open]);

  const selectModel = useCallback((nextModel) => {
    const normalizedModel = String(nextModel || '').trim();
    if (!normalizedModel) return;
    onChange(normalizedModel);
    onCommit?.(normalizedModel);
    setOpen(false);
    setQuery('');
  }, [onChange, onCommit]);

  const openMenu = () => {
    if (disabled) return;
    setQuery('');
    setOpen((current) => !current);
  };

  const manualModel = query.trim();
  const canUseManualModel = Boolean(manualModel)
    && !normalizedOptions.some((option) => option.toLowerCase() === manualModel.toLowerCase());
  const selectedLooksLikeImage = isLikelyCoverImageModel(value);

  return (
    <div className="project-cover-model-combobox" ref={rootRef}>
      <button
        type="button"
        className={`project-cover-model-combobox__control ${open ? 'project-cover-model-combobox__control--open' : ''}`}
        onClick={openMenu}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Search size={14} />
        <span className={`project-cover-model-combobox__value ${value ? '' : 'project-cover-model-combobox__value--empty'}`}>
          {value || placeholder}
        </span>
        {value && (
          <span className={`project-cover-model-badge ${selectedLooksLikeImage ? 'project-cover-model-badge--image' : ''}`}>
            {selectedLooksLikeImage ? 'Model ảnh' : 'Chưa rõ ảnh'}
          </span>
        )}
        <ChevronDown size={15} className="project-cover-model-combobox__chevron" />
      </button>

      {open && (
        <div className="project-cover-model-menu" role="listbox">
          <div className="project-cover-model-menu__search">
            <Search size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm model hoặc nhập thủ công"
              aria-label="Tìm model tạo bìa"
            />
          </div>
          <div className="project-cover-model-menu__meta">
            <span>{imageModelCount > 0 ? `${imageModelCount} model ảnh ưu tiên` : 'Chưa phát hiện model ảnh'}</span>
            <span>Nhập thủ công được</span>
          </div>

          {canUseManualModel && (
            <button
              type="button"
              className="project-cover-model-option project-cover-model-option--manual"
              onClick={() => selectModel(manualModel)}
            >
              <span className="project-cover-model-option__name">{manualModel}</span>
              <span className="project-cover-model-badge">Dùng model đã nhập</span>
            </button>
          )}

          <div className="project-cover-model-menu__list">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = option === value;
                const isImageModel = isLikelyCoverImageModel(option);
                return (
                  <button
                    type="button"
                    key={option}
                    className={`project-cover-model-option ${isSelected ? 'project-cover-model-option--selected' : ''}`}
                    onClick={() => selectModel(option)}
                    role="option"
                    aria-selected={isSelected}
                    title={option}
                  >
                    <span className="project-cover-model-option__name">{option}</span>
                    <span className={`project-cover-model-badge ${isImageModel ? 'project-cover-model-badge--image' : ''}`}>
                      {isImageModel ? 'Model ảnh' : 'Text'}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="project-cover-model-menu__empty">
                Không thấy model khớp. Có thể nhập thủ công model ảnh của proxy.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectCoverPanel({ project, onSaveProjectSettings }) {
  const projectId = Number(project?.id || 0);
  const [proxyProfiles, setProxyProfiles] = useState(readProjectCoverProxyProfiles);
  const [covers, setCovers] = useState([]);
  const [activeCover, setActiveCover] = useState(null);
  const [provider, setProvider] = useState(COVER_IMAGE_PROVIDERS.GEMINI_DIRECT);
  const [model, setModel] = useState(DEFAULT_GEMINI_COVER_IMAGE_MODEL);
  const [prompt, setPrompt] = useState('');
  const [variationCount, setVariationCount] = useState(2);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(0);
  const [brokenCoverIds, setBrokenCoverIds] = useState(() => new Set());
  const [activeCoverImageFailed, setActiveCoverImageFailed] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const refreshProxyProfiles = useCallback(() => {
    setProxyProfiles(readProjectCoverProxyProfiles());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(OPENAI_PROXY_SETTINGS_CHANGED_EVENT, refreshProxyProfiles);
    window.addEventListener(CLOUDFLARE_WORKERS_AI_SETTINGS_CHANGED_EVENT, refreshProxyProfiles);
    window.addEventListener('storage', refreshProxyProfiles);
    window.addEventListener('focus', refreshProxyProfiles);
    return () => {
      window.removeEventListener(OPENAI_PROXY_SETTINGS_CHANGED_EVENT, refreshProxyProfiles);
      window.removeEventListener(CLOUDFLARE_WORKERS_AI_SETTINGS_CHANGED_EVENT, refreshProxyProfiles);
      window.removeEventListener('storage', refreshProxyProfiles);
      window.removeEventListener('focus', refreshProxyProfiles);
    };
  }, [refreshProxyProfiles]);

  const modelOptions = useMemo(() => {
    if (
      provider === COVER_IMAGE_PROVIDERS.AG_PROXY
      || provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY
    ) {
      return getProxyModelOptions(provider, proxyProfiles);
    }
    if (provider === COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI) {
      return getCloudflareWorkersAIModelOptions();
    }
    return GEMINI_COVER_IMAGE_MODELS.map((item) => item.id);
  }, [provider, proxyProfiles]);
  const visibleModelOptions = useMemo(() => sortCoverImageModels([model, ...modelOptions]), [model, modelOptions]);

  const keyCount = useMemo(() => getProviderKeyCount(provider), [provider, proxyProfiles]);
  const activeCoverUrl = activeCover?.thumbnail_data_url || activeCover?.data_url || '';

  useEffect(() => {
    setActiveCoverImageFailed(false);
  }, [activeCoverUrl]);

  useEffect(() => {
    setBrokenCoverIds(new Set());
  }, [covers]);

  const markCoverImageBroken = useCallback((assetId) => {
    const normalizedAssetId = Number(assetId || 0);
    if (!normalizedAssetId) return;
    setBrokenCoverIds((current) => {
      if (current.has(normalizedAssetId)) return current;
      const next = new Set(current);
      next.add(normalizedAssetId);
      return next;
    });
  }, []);

  const reloadCovers = useCallback(async () => {
    if (!projectId) return;
    const [assetList, cover] = await Promise.all([
      listProjectCoverAssets(projectId),
      getActiveProjectCover(projectId),
    ]);
    setCovers(assetList);
    setActiveCover(cover);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    reloadCovers().catch((loadError) => {
      setError(loadError?.message || 'Không tải được bìa truyện.');
    });
  }, [projectId, project?.cover_asset_id, reloadCovers]);

  useEffect(() => {
    if (!project) return;
    const settings = getProjectCoverGenerationSettings(project);
    const nextProvider = settings.provider || COVER_IMAGE_PROVIDERS.GEMINI_DIRECT;
    setProvider(nextProvider);
    setModel(settings.model || getDefaultModelForProvider(nextProvider, proxyProfiles));
    setPrompt(settings.prompt || '');
  }, [
    project?.id,
    project?.cover_image_model,
    project?.cover_image_prompt,
    project?.cover_image_provider,
    proxyProfiles,
  ]);

  const persistSettings = useCallback(async (patch = {}) => {
    const nextProvider = patch.provider ?? provider;
    const nextModel = patch.model ?? model;
    const nextPrompt = patch.prompt ?? prompt;
    const nextProxyProfileId = getProxyProfileIdForProvider(nextProvider);

    await onSaveProjectSettings?.({
      cover_image_provider: nextProvider,
      cover_image_model: nextModel,
      cover_image_proxy_profile_id: nextProxyProfileId,
      cover_image_prompt: nextPrompt,
    });
  }, [model, onSaveProjectSettings, prompt, provider]);

  const handleProviderChange = async (event) => {
    const nextProvider = event.target.value;
    const nextModel = getDefaultModelForProvider(nextProvider, proxyProfiles);
    setProvider(nextProvider);
    setModel(nextModel);
    setConfirmingDeleteId(0);
    setStatus('');
    setError('');
    await persistSettings({ provider: nextProvider, model: nextModel });
  };

  const handleModelChange = (nextModel) => {
    setModel(nextModel);
    setConfirmingDeleteId(0);
    setStatus('');
    setError('');
  };

  const handleModelCommit = useCallback((nextModel = model) => {
    const normalizedModel = String(nextModel || '').trim();
    setModel(normalizedModel);
    persistSettings({ model: normalizedModel }).catch((saveError) => {
      setError(saveError?.message || 'Không lưu được model tạo bìa.');
    });
  }, [model, persistSettings]);

  const handlePromptBlur = () => {
    persistSettings({ prompt }).catch((saveError) => {
      setError(saveError?.message || 'Không lưu được prompt bìa.');
    });
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !projectId) return;
    setUploading(true);
    setConfirmingDeleteId(0);
    setStatus('');
    setError('');
    try {
      const asset = await createProjectCoverAssetFromFile(projectId, file);
      await onSaveProjectSettings?.({
        cover_asset_id: asset.id,
        cover_thumbnail_data_url: asset.thumbnail_data_url || asset.data_url || '',
      });
      await reloadCovers();
      setStatus('Đã tải bìa lên.');
    } catch (uploadError) {
      setError(uploadError?.message || 'Không tải được bìa truyện.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!projectId || generating) return;
    const selectedModel = String(model || '').trim();
    if (!selectedModel) {
      setError('Chưa chọn model tạo bìa.');
      return;
    }

    setGenerating(true);
    setConfirmingDeleteId(0);
    setStatus('');
    setError('');
    try {
      await persistSettings({
        provider,
        model: selectedModel,
        prompt,
      });
      const artworkPrompt = buildCoverArtworkPrompt({
        prompt,
        title: project?.title,
        genre: getGenreLabel(project?.genre_primary),
        tone: getToneLabel(project?.tone),
        synopsis: project?.synopsis,
      });
      const created = [];
      let activatedCover = null;
      const shouldAutoActivateGeneratedCover = Number(project?.cover_asset_id || 0) <= 0;
      for (let index = 0; index < variationCount; index += 1) {
        const result = await generateCoverImage({
          provider,
          model: selectedModel,
          proxyProfileId: getProxyProfileIdForProvider(provider),
          prompt: artworkPrompt,
          size: DEFAULT_COVER_IMAGE_SIZE,
        });
        const dataUrl = result.imageUrl || dataUrlFromBase64(result.b64, result.mimeType);
        const activateGeneratedCover = shouldAutoActivateGeneratedCover && created.length === 0;
        const asset = await createProjectCoverAsset({
          projectId,
          source: COVER_ASSET_SOURCES.GENERATED,
          mimeType: result.mimeType,
          dataUrl,
          thumbnailDataUrl: dataUrl,
          prompt: artworkPrompt,
          revisedPrompt: result.revisedPrompt,
          provider,
          model: selectedModel,
          proxyProfileId: getProxyProfileIdForProvider(provider),
          activate: activateGeneratedCover,
        });
        if (activateGeneratedCover) {
          activatedCover = asset;
        }
        created.push(asset);
      }
      if (activatedCover) {
        await onSaveProjectSettings?.({
          cover_asset_id: activatedCover.id,
          cover_thumbnail_data_url: activatedCover.thumbnail_data_url || activatedCover.data_url || '',
        });
      }
      await reloadCovers();
      setStatus(`Đã tạo ${created.length} biến thể bìa.`);
    } catch (generateError) {
      setError(generateError?.message || 'Không tạo được bìa truyện.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSetActive = async (assetId) => {
    if (!projectId) return;
    setConfirmingDeleteId(0);
    setStatus('');
    setError('');
    try {
      const asset = await setProjectCoverAsset(projectId, assetId);
      await onSaveProjectSettings?.({
        cover_asset_id: asset.id,
        cover_thumbnail_data_url: asset.thumbnail_data_url || asset.data_url || '',
      });
      await reloadCovers();
      setStatus('Đã đổi bìa chính.');
    } catch (setErrorValue) {
      setError(setErrorValue?.message || 'Không đặt được bìa.');
    }
  };

  const handleDeleteCover = async (assetId) => {
    if (!projectId) return;
    if (Number(confirmingDeleteId) !== Number(assetId)) {
      setConfirmingDeleteId(Number(assetId));
      setStatus('Bấm "Xác nhận xóa" để xóa bìa này khỏi dự án.');
      setError('');
      return;
    }

    setStatus('');
    setError('');
    try {
      const result = await deleteProjectCoverAsset(projectId, assetId);
      const nextActiveCover = result.activeCover;
      await onSaveProjectSettings?.({
        cover_asset_id: nextActiveCover?.id || 0,
        cover_thumbnail_data_url: nextActiveCover?.thumbnail_data_url || nextActiveCover?.data_url || '',
      });
      await reloadCovers();
      setConfirmingDeleteId(0);
      setStatus(nextActiveCover ? 'Đã xóa bìa và chuyển bìa chính.' : 'Đã xóa bìa.');
    } catch (deleteError) {
      setConfirmingDeleteId(0);
      setError(deleteError?.message || 'Không xóa được bìa.');
    }
  };

  return (
    <section className="project-cover-panel" id="project-cover-panel">
      <div className="project-cover-panel__header">
        <div>
          <h3><Palette size={16} /> Bìa & nhận diện truyện</h3>
          <span>{activeCover ? 'Đang có bìa chính' : 'Chưa có bìa chính'}</span>
        </div>
        <div className="project-cover-panel__actions">
          <label className="btn btn-secondary btn-sm project-cover-upload">
            <Upload size={14} />
            <span>{uploading ? 'Đang tải...' : 'Thêm bìa'}</span>
            <input
              type="file"
              accept={COVER_IMAGE_ACCEPT}
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      <div className="project-cover-panel__body">
        <div className="project-cover-preview">
          {activeCoverUrl && !activeCoverImageFailed ? (
            <img
              src={activeCoverUrl}
              referrerPolicy="no-referrer"
              alt="Bìa truyện hiện tại"
              onError={() => setActiveCoverImageFailed(true)}
            />
          ) : (
            <div className="project-cover-preview__empty">
              <ImageIcon size={30} />
              <span>Chưa có bìa</span>
            </div>
          )}
          <div className="project-cover-preview__overlay">
            <strong>{project?.title || 'Tên truyện'}</strong>
            <span>{project?.author_name || project?.author || 'Tác giả'}</span>
          </div>
        </div>

        <div className="project-cover-controls">
          <div className="bible-edit-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Nhà cung cấp ảnh</label>
              <select className="select" value={provider} onChange={handleProviderChange}>
                <option value={COVER_IMAGE_PROVIDERS.GEMINI_DIRECT}>Gemini Direct</option>
                <option value={COVER_IMAGE_PROVIDERS.AG_PROXY}>Gemini Proxy mặc định (AG)</option>
                <option value={COVER_IMAGE_PROVIDERS.OPENAI_PROXY}>Custom OpenAI-compatible</option>
                <option value={COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI}>Cloudflare Workers AI</option>
              </select>
              <span className="form-hint">{getCoverProviderLabel(provider)} · {keyCount} key</span>
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Model tạo bìa</label>
              <CoverModelCombobox
                value={model}
                options={visibleModelOptions}
                onChange={handleModelChange}
                onCommit={handleModelCommit}
                disabled={generating}
                placeholder="Chọn hoặc nhập model ảnh"
              />
              <span className="form-hint">{getCoverModelHint(provider)}</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Prompt bìa</label>
            <textarea
              className="textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={handlePromptBlur}
              rows={3}
              placeholder="Ví dụ: nhân vật đứng trước thành cổ, ánh sáng lạnh, phong cách điện ảnh..."
            />
          </div>

          <div className="project-cover-actions">
            <label className="project-cover-count">
              <span>Số biến thể</span>
              <select
                className="select select-mini"
                value={variationCount}
                onChange={(event) => setVariationCount(Number(event.target.value) || 2)}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating || uploading}
            >
              {generating ? <Loader2 size={14} className="project-cover-spin" /> : <Sparkles size={14} />}
              {generating ? 'Đang tạo...' : 'Tạo bìa AI'}
            </button>
          </div>

          {(status || error) && (
            <div className={`project-cover-message ${error ? 'project-cover-message--error' : ''}`} role="status">
              {error || status}
            </div>
          )}
        </div>
      </div>

      {covers.length > 0 && (
        <div className="project-cover-variants" aria-label="Biến thể bìa">
          {covers.map((cover) => {
            const coverUrl = cover.thumbnail_data_url || cover.data_url;
            const isActive = Number(activeCover?.id) === Number(cover.id);
            const coverId = Number(cover.id || 0);
            const hasCoverImage = Boolean(coverUrl) && !brokenCoverIds.has(coverId);
            return (
              <div key={cover.id} className={`project-cover-variant ${isActive ? 'project-cover-variant--active' : ''}`}>
                <div className="project-cover-variant__poster">
                  {hasCoverImage ? (
                    <img
                      src={coverUrl}
                      referrerPolicy="no-referrer"
                      alt="Biến thể bìa"
                      onError={() => markCoverImageBroken(cover.id)}
                    />
                  ) : (
                    <span className="project-cover-variant__placeholder">
                      <ImageIcon size={24} />
                      <span>Chưa có ảnh</span>
                    </span>
                  )}
                </div>
                <div className="project-cover-variant__footer">
                  <div className="project-cover-variant__status">
                    <span className="project-cover-variant__source">
                      {cover.source === COVER_ASSET_SOURCES.GENERATED ? 'AI' : 'Upload'}
                    </span>
                    {isActive && (
                      <span className="project-cover-variant__active">
                        <Check size={12} /> Bìa chính
                      </span>
                    )}
                  </div>
                  <div className="project-cover-variant__actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs project-cover-variant__use"
                      onClick={() => handleSetActive(cover.id)}
                      disabled={isActive}
                    >
                      {isActive ? <Check size={12} /> : <ImageIcon size={12} />}
                      {isActive ? 'Đang dùng' : 'Đổi bìa'}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-ghost btn-xs project-cover-delete ${Number(confirmingDeleteId) === Number(cover.id) ? 'project-cover-delete--confirm' : ''}`}
                      onClick={() => handleDeleteCover(cover.id)}
                      disabled={generating || uploading}
                    >
                      <Trash2 size={12} />
                      {Number(confirmingDeleteId) === Number(cover.id) ? 'Xác nhận xóa' : 'Xóa bìa'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
