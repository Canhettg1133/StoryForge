import { ADMIN_PERMISSIONS } from '../../../../packages/access/src/index.js';

const SETTINGS_TABLE = 'story_mirror_settings';
const PROJECTS_TABLE = 'story_mirror_projects';
const CHAPTERS_TABLE = 'story_mirror_chapters';
const SCENES_TABLE = 'story_mirror_scenes';
const AUDIT_TABLE = 'story_mirror_admin_audit';
const PROFILES_TABLE = 'profiles';

function makeError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value) {
  return String(value ?? '').trim();
}

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireBucket(env = {}) {
  if (!env.STORY_MIRROR_BUCKET) {
    throw makeError(500, 'ADMIN_STORY_MIRROR_R2_MISSING', 'Thiếu binding STORY_MIRROR_BUCKET cho Admin API.');
  }
  return env.STORY_MIRROR_BUCKET;
}

async function readR2Json(bucket, key) {
  const object = await bucket.get(key);
  if (!object) throw makeError(404, 'ADMIN_STORY_MIRROR_OBJECT_NOT_FOUND', 'Không tìm thấy nội dung truyện trên R2.');
  if (typeof object.json === 'function') return object.json();
  const text = typeof object.text === 'function' ? await object.text() : '';
  return text ? JSON.parse(text) : null;
}

async function audit(config, request, actor, helpers, {
  action,
  targetUserId = null,
  projectId = null,
  sceneId = null,
  details = {},
} = {}) {
  await helpers.supabaseRest(config, AUDIT_TABLE, {
    method: 'POST',
    body: {
      actor_user_id: actor.id,
      action,
      target_user_id: targetUserId,
      project_id: projectId,
      scene_id: sceneId,
      details_json: details,
      ip_address: helpers.getClientIp(request),
      user_agent: request.headers.get('User-Agent') || '',
    },
    prefer: 'return=minimal',
  });
}

async function getSettings(config, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const rows = await helpers.supabaseRest(config, SETTINGS_TABLE, {
    query: 'select=*&key=eq.global&limit=1',
    prefer: '',
  });
  const item = asArray(rows)[0] || null;
  return {
    settings: {
      enabled: item?.enabled === true,
      testOnly: item?.test_only === true,
      testUserIds: asArray(item?.test_user_ids).map(String),
      perUserQuotaBytes: toInteger(item?.per_user_quota_bytes, 104857600),
      retentionDays: toInteger(item?.retention_days, 90),
      updatedAt: item?.updated_at || null,
    },
  };
}

function normalizeSettingsPatch(body = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) patch.enabled = body.enabled === true;
  if (Object.prototype.hasOwnProperty.call(body, 'testOnly')) patch.test_only = body.testOnly === true;
  if (Object.prototype.hasOwnProperty.call(body, 'testUserIds')) {
    patch.test_user_ids = asArray(body.testUserIds)
      .map((item) => toText(item))
      .filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'perUserQuotaBytes')) {
    const quota = toInteger(body.perUserQuotaBytes, 104857600);
    if (quota <= 0) throw makeError(422, 'ADMIN_STORY_MIRROR_BAD_QUOTA', 'Quota phải lớn hơn 0.');
    patch.per_user_quota_bytes = quota;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'retentionDays')) {
    const days = toInteger(body.retentionDays, 90);
    if (days < 1 || days > 365) throw makeError(422, 'ADMIN_STORY_MIRROR_BAD_RETENTION', 'Số ngày lưu event phải từ 1 đến 365.');
    patch.retention_days = days;
  }
  patch.updated_at = new Date().toISOString();
  return patch;
}

async function updateSettings(config, request, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_WRITE);
  const patch = normalizeSettingsPatch(await helpers.readJson(request));
  const rows = await helpers.supabaseRest(config, SETTINGS_TABLE, {
    method: 'POST',
    query: 'on_conflict=key',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      key: 'global',
      ...patch,
    },
  });
  await audit(config, request, actor, helpers, {
    action: 'story_mirror.settings.update',
    details: patch,
  });
  const item = asArray(rows)[0] || {};
  return {
    ok: true,
    settings: {
      enabled: item.enabled === true,
      testOnly: item.test_only === true,
      testUserIds: asArray(item.test_user_ids).map(String),
      perUserQuotaBytes: toInteger(item.per_user_quota_bytes, 104857600),
      retentionDays: toInteger(item.retention_days, 90),
      updatedAt: item.updated_at || null,
    },
  };
}

async function getProfiles(config, helpers, userIds) {
  const ids = [...new Set(asArray(userIds).map(toText).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await helpers.supabaseRest(config, PROFILES_TABLE, {
    query: `select=user_id,email,display_name,system_role,status&user_id=in.(${ids.map(encodeURIComponent).join(',')})`,
    prefer: '',
  }).catch(() => []);
  return new Map(asArray(rows).map((row) => [String(row.user_id), row]));
}

function profileLabel(profile, userId) {
  return profile?.email || profile?.display_name || userId;
}

async function listUsers(config, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const projects = asArray(await helpers.supabaseRest(config, PROJECTS_TABLE, {
    query: 'select=*&order=updated_at.desc&limit=1000',
    prefer: '',
  }));
  const profileMap = await getProfiles(config, helpers, projects.map((item) => item.user_id));
  const byUser = new Map();
  for (const project of projects) {
    const userId = String(project.user_id);
    const current = byUser.get(userId) || {
      userId,
      email: profileMap.get(userId)?.email || '',
      displayName: profileMap.get(userId)?.display_name || '',
      label: profileLabel(profileMap.get(userId), userId),
      projectCount: 0,
      storageUsedBytes: 0,
      lastSyncedAt: '',
      failedSyncCount: 0,
    };
    current.projectCount += 1;
    current.storageUsedBytes += toInteger(project.storage_used_bytes);
    current.lastSyncedAt = [current.lastSyncedAt, project.updated_at].filter(Boolean).sort().at(-1) || '';
    byUser.set(userId, current);
  }
  return { items: [...byUser.values()].sort((a, b) => String(b.lastSyncedAt).localeCompare(String(a.lastSyncedAt))) };
}

async function listProjects(config, actor, url, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const query = new URLSearchParams({
    select: '*',
    order: 'updated_at.desc',
    limit: '500',
  });
  const userId = toText(url.searchParams.get('userId'));
  if (userId) query.set('user_id', `eq.${userId}`);
  const rows = asArray(await helpers.supabaseRest(config, PROJECTS_TABLE, {
    query: query.toString(),
    prefer: '',
  }));
  const profileMap = await getProfiles(config, helpers, rows.map((item) => item.user_id));
  return {
    items: rows.map((project) => ({
      ...project,
      user: {
        id: project.user_id,
        email: profileMap.get(String(project.user_id))?.email || '',
        displayName: profileMap.get(String(project.user_id))?.display_name || '',
        label: profileLabel(profileMap.get(String(project.user_id)), String(project.user_id)),
      },
    })),
  };
}

async function getProject(config, helpers, projectId) {
  const rows = await helpers.supabaseRest(config, PROJECTS_TABLE, {
    query: `select=*&id=eq.${encodeURIComponent(projectId)}&limit=1`,
    prefer: '',
  });
  const project = asArray(rows)[0] || null;
  if (!project) throw makeError(404, 'ADMIN_STORY_MIRROR_PROJECT_NOT_FOUND', 'Không tìm thấy truyện đã mirror.');
  return project;
}

async function listProjectScenes(config, actor, projectId, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  await getProject(config, helpers, projectId);
  const rows = await helpers.supabaseRest(config, SCENES_TABLE, {
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&order=order_index.asc&limit=10000`,
    prefer: '',
  });
  return { items: asArray(rows) };
}

async function getScene(config, request, env, actor, sceneId, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const rows = await helpers.supabaseRest(config, SCENES_TABLE, {
    query: `select=*&id=eq.${encodeURIComponent(sceneId)}&limit=1`,
    prefer: '',
  });
  const scene = asArray(rows)[0] || null;
  if (!scene) throw makeError(404, 'ADMIN_STORY_MIRROR_SCENE_NOT_FOUND', 'Không tìm thấy cảnh đã mirror.');
  const raw = await readR2Json(requireBucket(env), scene.storage_key);
  await audit(config, request, actor, helpers, {
    action: 'story_mirror.scene.view',
    targetUserId: scene.user_id,
    projectId: scene.project_id,
    sceneId: scene.id,
    details: { storageKey: scene.storage_key },
  });
  return {
    scene,
    content: raw?.scene?.content || raw?.content || '',
  };
}

async function exportProject(config, request, env, actor, projectId, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const [project, chapters, scenes] = await Promise.all([
    getProject(config, helpers, projectId),
    helpers.supabaseRest(config, CHAPTERS_TABLE, {
      query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&order=order_index.asc&limit=1000`,
      prefer: '',
    }),
    helpers.supabaseRest(config, SCENES_TABLE, {
      query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&order=order_index.asc&limit=10000`,
      prefer: '',
    }),
  ]);
  const bucket = requireBucket(env);
  const scenesWithContent = [];
  for (const scene of asArray(scenes)) {
    const raw = await readR2Json(bucket, scene.storage_key);
    scenesWithContent.push({
      ...scene,
      content: raw?.scene?.content || raw?.content || '',
    });
  }
  await audit(config, request, actor, helpers, {
    action: 'story_mirror.project.export',
    targetUserId: project.user_id,
    projectId: project.id,
    details: { sceneCount: scenesWithContent.length },
  });
  return {
    project,
    chapters: asArray(chapters).map((chapter) => ({
      ...chapter,
      scenes: scenesWithContent.filter((scene) => scene.chapter_id === chapter.id),
    })),
  };
}

async function deleteProject(config, request, env, actor, projectId, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_WRITE);
  const project = await getProject(config, helpers, projectId);
  const scenes = asArray(await helpers.supabaseRest(config, SCENES_TABLE, {
    query: `select=id,storage_key&project_id=eq.${encodeURIComponent(projectId)}&limit=10000`,
    prefer: '',
  }));
  await audit(config, request, actor, helpers, {
    action: 'story_mirror.project.delete',
    targetUserId: project.user_id,
    projectId: project.id,
    details: {
      clientProjectId: project.client_project_id,
      sceneCount: scenes.length,
    },
  });
  const bucket = requireBucket(env);
  await Promise.all(scenes.map((scene) => bucket.delete(scene.storage_key).catch(() => null)));
  await bucket.delete(`users/${encodeURIComponent(project.user_id)}/projects/${encodeURIComponent(project.client_project_id)}/manifest.json`).catch(() => null);
  await helpers.supabaseRest(config, PROJECTS_TABLE, {
    method: 'DELETE',
    query: `id=eq.${encodeURIComponent(projectId)}`,
    prefer: 'return=minimal',
  });
  return { ok: true, deleted: true, sceneCount: scenes.length };
}

async function listAudit(config, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const rows = await helpers.supabaseRest(config, AUDIT_TABLE, {
    query: 'select=*&order=created_at.desc&limit=200',
    prefer: '',
  });
  return { items: asArray(rows) };
}

async function health(config, env, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_READ);
  const settings = await getSettings(config, actor, helpers);
  return {
    ok: true,
    r2Configured: Boolean(env.STORY_MIRROR_BUCKET),
    settings: settings.settings,
  };
}

async function smokeTest(config, request, env, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.STORY_MIRROR_WRITE);
  const bucket = requireBucket(env);
  const key = `admin-smoke/${encodeURIComponent(actor.id)}/${Date.now()}.json`;
  const value = JSON.stringify({ ok: true, createdAt: new Date().toISOString() });
  await bucket.put(key, value, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  const stored = await readR2Json(bucket, key);
  await bucket.delete(key);
  await audit(config, request, actor, helpers, {
    action: 'story_mirror.health.r2_smoke',
    details: { key },
  });
  return { ok: stored?.ok === true, key };
}

export async function routeStoryMirrorAdmin({
  request,
  env,
  config,
  actor,
  segments,
  url,
  helpers,
}) {
  const [resource, id, action] = segments;

  if (resource === 'health' && !id && request.method === 'GET') {
    return health(config, env, actor, helpers);
  }
  if (resource === 'health' && id === 'r2-smoke' && request.method === 'POST') {
    return smokeTest(config, request, env, actor, helpers);
  }
  if (resource === 'settings') {
    if (request.method === 'GET') return getSettings(config, actor, helpers);
    if (request.method === 'PATCH' || request.method === 'POST') return updateSettings(config, request, actor, helpers);
  }
  if (resource === 'users' && request.method === 'GET') {
    return listUsers(config, actor, helpers);
  }
  if (resource === 'projects') {
    if (!id && request.method === 'GET') return listProjects(config, actor, url, helpers);
    if (id && action === 'scenes' && request.method === 'GET') return listProjectScenes(config, actor, id, helpers);
    if (id && action === 'export' && request.method === 'POST') return exportProject(config, request, env, actor, id, helpers);
    if (id && !action && request.method === 'DELETE') return deleteProject(config, request, env, actor, id, helpers);
  }
  if (resource === 'scenes' && id && request.method === 'GET') {
    return getScene(config, request, env, actor, id, helpers);
  }
  if (resource === 'audit' && request.method === 'GET') {
    return listAudit(config, actor, helpers);
  }
  throw makeError(404, 'ADMIN_STORY_MIRROR_ROUTE_NOT_FOUND', 'Không tìm thấy route Kho truyện.');
}

export default {
  routeStoryMirrorAdmin,
};
