import db from '../db/database.js';

export const STORY_MIRROR_IDENTITY_KEY = 'identity:v1';

function nowMs() {
  return Date.now();
}

function createInstallationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `local-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatMirrorClientId(installationId, type, localId) {
  const cleanInstallationId = String(installationId || '').trim();
  const cleanType = String(type || 'item').trim();
  const cleanLocalId = String(localId ?? '').trim();
  if (!cleanInstallationId) return cleanLocalId;
  return `install:${cleanInstallationId}:${cleanType}:${cleanLocalId}`;
}

export function buildMirrorClientIds({ installationId, projectId, chapterId, sceneId } = {}) {
  return {
    projectId: formatMirrorClientId(installationId, 'project', projectId),
    chapterId: formatMirrorClientId(installationId, 'chapter', chapterId),
    sceneId: formatMirrorClientId(installationId, 'scene', sceneId),
  };
}

export async function getStoryMirrorInstallationId() {
  const table = db?.storyMirrorStatus;
  const existing = await table?.get?.(STORY_MIRROR_IDENTITY_KEY);
  if (existing?.installation_id) return String(existing.installation_id);

  const installationId = createInstallationId();
  await table?.put?.({
    id: STORY_MIRROR_IDENTITY_KEY,
    project_id: 0,
    status: 'ready',
    installation_id: installationId,
    updated_at: nowMs(),
  });
  return installationId;
}

export default {
  STORY_MIRROR_IDENTITY_KEY,
  buildMirrorClientIds,
  formatMirrorClientId,
  getStoryMirrorInstallationId,
};
