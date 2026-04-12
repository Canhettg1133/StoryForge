import db from '../db/database.js';
import { exportProject, importProject } from '../db/exportImport.js';

const STORAGE_KEY = 'sf-cloud-sync-config';
const DEFAULT_API_BASE_URL = import.meta.env.VITE_CLOUD_SYNC_BASE_URL || '/api/cloud';

function normalizeApiBaseUrl(value) {
  const raw = String(value || DEFAULT_API_BASE_URL).trim();
  if (!raw) return DEFAULT_API_BASE_URL;
  return raw.replace(/\/+$/, '') || DEFAULT_API_BASE_URL;
}

function normalizeConfig(config = {}) {
  return {
    workspaceSlug: String(config.workspaceSlug || '').trim().toLowerCase(),
    accessKey: String(config.accessKey || '').trim(),
    apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
  };
}

function slugify(value, fallback = 'project') {
  const base = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || fallback;
}

function buildHeaders(config) {
  return {
    'Content-Type': 'application/json',
    'x-storyforge-workspace': config.workspaceSlug,
    'x-storyforge-access-key': config.accessKey,
  };
}

async function request(config, method = 'GET', body = null, query = null) {
  const normalized = normalizeConfig(config);
  if (!normalized.workspaceSlug || !normalized.accessKey) {
    const error = new Error('Cloud Sync chua duoc cau hinh day du.');
    error.code = 'CLOUD_SYNC_NOT_CONFIGURED';
    throw error;
  }

  const url = new URL(normalized.apiBaseUrl, window.location.origin);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: buildHeaders(normalized),
      body: body ? JSON.stringify(body) : null,
    });
  } catch (networkError) {
    const error = new Error(
      `Khong ket noi duoc Cloud Sync API tai ${normalized.apiBaseUrl}. Neu dang dev local, hay dung Vercel deployment hoac vercel dev.`,
    );
    error.code = 'CLOUD_SYNC_UNREACHABLE';
    error.cause = networkError;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    const error = new Error(payload?.error || `Cloud Sync request failed: ${response.status}`);
    error.code = payload?.code || 'CLOUD_SYNC_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function getCloudSyncConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeConfig();
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return normalizeConfig();
  }
}

export function saveCloudSyncConfig(config) {
  const normalized = normalizeConfig(config);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function resolveCloudProjectSlug(project) {
  const existing = String(project?.cloud_project_slug || '').trim();
  if (existing) return existing;
  return slugify(project?.title, `project-${project?.id || 'draft'}`);
}

export async function listCloudSnapshots(config) {
  const response = await request(config, 'GET');
  return Array.isArray(response?.items) ? response.items : [];
}

export async function syncProjectToCloud(project, config) {
  if (!project?.id) {
    throw new Error('Khong tim thay du an local de backup.');
  }

  const projectSlug = resolveCloudProjectSlug(project);
  const snapshotJson = await exportProject(project.id);

  const response = await request(config, 'POST', {
    projectSlug,
    projectTitle: project.title || `Project ${project.id}`,
    snapshotJson,
  });

  await db.projects.update(project.id, {
    cloud_project_slug: projectSlug,
    cloud_last_synced_at: Date.now(),
  });

  return {
    ...response?.item,
    projectSlug,
  };
}

export async function restoreCloudSnapshot(projectSlug, config) {
  const response = await request(config, 'GET', null, { projectSlug });
  const snapshotJson = response?.item?.snapshotJson;
  if (!snapshotJson) {
    throw new Error('Khong tim thay snapshot cloud.');
  }

  const newProjectId = await importProject(snapshotJson);
  return {
    newProjectId,
    project: response.item,
  };
}

export async function deleteCloudSnapshot(projectSlug, config) {
  return request(config, 'DELETE', null, { projectSlug });
}
