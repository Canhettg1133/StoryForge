import db from '../db/database.js';
import { validateChatAttachmentFile } from '../chatAttachments/fileSafety.js';

export const PROJECT_ASSET_ROLES = Object.freeze({
  COVER: 'cover',
});

export const COVER_ASSET_SOURCES = Object.freeze({
  UPLOAD: 'upload',
  GENERATED: 'generated',
});

export const COVER_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

const SUPPORTED_COVER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function normalizeProjectId(projectId) {
  const normalized = Number(projectId);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error('ID dự án không hợp lệ.');
  }
  return normalized;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function isRemoteCoverImageUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && /\.(png|jpe?g|webp)$/iu.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeDataUrl(dataUrl, mimeType = '') {
  const normalized = normalizeText(dataUrl);
  if (isRemoteCoverImageUrl(normalized)) {
    return normalized;
  }
  if (!normalized.startsWith('data:image/')) {
    throw new Error('Dữ liệu ảnh bìa không hợp lệ.');
  }
  if (mimeType && !normalized.startsWith(`data:${mimeType};base64,`)) {
    throw new Error('Dữ liệu ảnh bìa không khớp MIME type.');
  }
  return normalized;
}

export function dataUrlFromBase64(b64, mimeType = 'image/png') {
  const normalizedMime = normalizeText(mimeType) || 'image/png';
  const normalizedBase64 = normalizeText(b64);
  if (!normalizedBase64) throw new Error('Provider không trả về dữ liệu ảnh.');
  return `data:${normalizedMime};base64,${normalizedBase64}`;
}

export function getProjectCoverGenerationSettings(project = {}) {
  return {
    provider: normalizeText(project.cover_image_provider) || 'gemini_direct',
    model: normalizeText(project.cover_image_model) || '',
    proxyProfileId: normalizeText(project.cover_image_proxy_profile_id) || '',
    prompt: normalizeText(project.cover_image_prompt) || '',
  };
}

export async function saveProjectCoverGenerationSettings(projectId, settings = {}) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const patch = {
    cover_image_provider: normalizeText(settings.provider),
    cover_image_model: normalizeText(settings.model),
    cover_image_proxy_profile_id: normalizeText(settings.proxyProfileId),
    cover_image_prompt: normalizeText(settings.prompt),
    updated_at: Date.now(),
  };
  await db.projects.update(normalizedProjectId, patch);
  return db.projects.get(normalizedProjectId);
}

export async function createProjectCoverAsset({
  projectId,
  source = COVER_ASSET_SOURCES.UPLOAD,
  mimeType = 'image/png',
  dataUrl,
  thumbnailDataUrl = '',
  prompt = '',
  revisedPrompt = '',
  provider = '',
  model = '',
  proxyProfileId = '',
  activate = true,
} = {}) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedMimeType = normalizeText(mimeType) || 'image/png';
  if (!SUPPORTED_COVER_MIME_TYPES.has(normalizedMimeType)) {
    throw new Error('Chỉ hỗ trợ ảnh PNG, JPEG hoặc WEBP cho bìa truyện.');
  }

  const normalizedDataUrl = normalizeDataUrl(dataUrl, normalizedMimeType);
  const normalizedThumbnailDataUrl = thumbnailDataUrl ? normalizeDataUrl(thumbnailDataUrl) : normalizedDataUrl;
  const now = Date.now();
  const assetId = await db.project_assets.add({
    project_id: normalizedProjectId,
    role: PROJECT_ASSET_ROLES.COVER,
    source: source === COVER_ASSET_SOURCES.GENERATED ? COVER_ASSET_SOURCES.GENERATED : COVER_ASSET_SOURCES.UPLOAD,
    mime_type: normalizedMimeType,
    data_url: normalizedDataUrl,
    thumbnail_data_url: normalizedThumbnailDataUrl,
    prompt: normalizeText(prompt),
    revised_prompt: normalizeText(revisedPrompt),
    provider: normalizeText(provider),
    model: normalizeText(model),
    proxy_profile_id: normalizeText(proxyProfileId),
    created_at: now,
    updated_at: now,
  });

  if (activate) {
    await db.projects.update(normalizedProjectId, {
      cover_asset_id: assetId,
      cover_thumbnail_data_url: normalizedThumbnailDataUrl,
      updated_at: now,
    });
  }

  return db.project_assets.get(assetId);
}

export async function setProjectCoverAsset(projectId, assetId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedAssetId = Number(assetId);
  const asset = await db.project_assets.get(normalizedAssetId);
  if (!asset || Number(asset.project_id) !== normalizedProjectId || asset.role !== PROJECT_ASSET_ROLES.COVER) {
    throw new Error('Không tìm thấy ảnh bìa của dự án này.');
  }

  await db.projects.update(normalizedProjectId, {
    cover_asset_id: normalizedAssetId,
    cover_thumbnail_data_url: asset.thumbnail_data_url || asset.data_url || '',
    updated_at: Date.now(),
  });
  return asset;
}

export async function clearProjectCoverAsset(projectId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  await db.projects.update(normalizedProjectId, {
    cover_asset_id: 0,
    cover_thumbnail_data_url: '',
    updated_at: Date.now(),
  });
  return null;
}

export async function deleteProjectCoverAsset(projectId, assetId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedAssetId = Number(assetId);
  const asset = await db.project_assets.get(normalizedAssetId);
  if (!asset || Number(asset.project_id) !== normalizedProjectId || asset.role !== PROJECT_ASSET_ROLES.COVER) {
    throw new Error('Không tìm thấy ảnh bìa của dự án này.');
  }

  const project = await db.projects.get(normalizedProjectId);
  await db.project_assets.delete(normalizedAssetId);

  if (Number(project?.cover_asset_id || 0) !== normalizedAssetId) {
    return { deletedAssetId: normalizedAssetId, activeCover: await getActiveProjectCover(normalizedProjectId) };
  }

  const [fallback] = await listProjectCoverAssets(normalizedProjectId);
  if (!fallback) {
    await clearProjectCoverAsset(normalizedProjectId);
    return { deletedAssetId: normalizedAssetId, activeCover: null };
  }

  await db.projects.update(normalizedProjectId, {
    cover_asset_id: fallback.id,
    cover_thumbnail_data_url: fallback.thumbnail_data_url || fallback.data_url || '',
    updated_at: Date.now(),
  });
  return { deletedAssetId: normalizedAssetId, activeCover: fallback };
}

export async function listProjectCoverAssets(projectId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const assets = await db.project_assets
    .where('[project_id+role]')
    .equals([normalizedProjectId, PROJECT_ASSET_ROLES.COVER])
    .toArray();
  return assets.sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0));
}

export async function getActiveProjectCover(projectOrId) {
  const project = typeof projectOrId === 'object'
    ? projectOrId
    : await db.projects.get(normalizeProjectId(projectOrId));
  if (!project) return null;

  const activeCoverId = Number(project.cover_asset_id || 0);
  if (activeCoverId > 0) {
    const asset = await db.project_assets.get(activeCoverId);
    if (asset?.role === PROJECT_ASSET_ROLES.COVER && Number(asset.project_id) === Number(project.id)) {
      return asset;
    }
  }

  const covers = await listProjectCoverAssets(project.id);
  return covers[0] || null;
}

export async function getActiveProjectCoversForProjects(projects = []) {
  const normalizedProjects = (Array.isArray(projects) ? projects : [])
    .filter((project) => Number(project?.id) > 0);
  if (normalizedProjects.length === 0) return {};

  const ids = normalizedProjects.map((project) => Number(project.id));
  const assets = await db.project_assets
    .where('project_id')
    .anyOf(ids)
    .toArray();
  const assetsById = new Map(assets.map((asset) => [Number(asset.id), asset]));
  const coversByProjectId = {};

  for (const project of normalizedProjects) {
    const active = assetsById.get(Number(project.cover_asset_id || 0));
    if (active?.role === PROJECT_ASSET_ROLES.COVER) {
      coversByProjectId[project.id] = active;
      continue;
    }
    const fallback = assets
      .filter((asset) => Number(asset.project_id) === Number(project.id) && asset.role === PROJECT_ASSET_ROLES.COVER)
      .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0))[0];
    if (fallback) coversByProjectId[project.id] = fallback;
  }

  return coversByProjectId;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh bìa.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export async function createProjectCoverAssetFromFile(projectId, file) {
  const validation = await validateChatAttachmentFile(file);
  if (!validation.ok || validation.fileType !== 'image') {
    throw new Error((validation.message || 'Ảnh bìa không hợp lệ.').replace('cho chat', 'cho bìa truyện'));
  }

  const dataUrl = await readFileAsDataUrl(file);
  return createProjectCoverAsset({
    projectId,
    source: COVER_ASSET_SOURCES.UPLOAD,
    mimeType: validation.mimeType || file.type || 'image/png',
    dataUrl,
    thumbnailDataUrl: dataUrl,
  });
}
