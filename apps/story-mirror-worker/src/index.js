import {
  DEFAULT_STORY_MIRROR_QUOTA_BYTES,
  processStoryMirrorEvent,
} from './eventProcessor.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const SETTINGS_TABLE = 'story_mirror_settings';
const PROJECTS_TABLE = 'story_mirror_projects';
const CHAPTERS_TABLE = 'story_mirror_chapters';
const SCENES_TABLE = 'story_mirror_scenes';
const EVENTS_TABLE = 'story_mirror_events';
const MAX_STORY_MIRROR_EVENTS_PER_BATCH = 50;
const MAX_STORY_MIRROR_BATCH_BYTES = 5 * 1024 * 1024;

function makeError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function validateEnv(env = {}) {
  const supabaseUrl = trimTrailingSlash(env.SUPABASE_URL);
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const allowedOrigins = String(env.STORY_MIRROR_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const quotaBytes = Number(env.STORY_MIRROR_USER_QUOTA_BYTES || DEFAULT_STORY_MIRROR_QUOTA_BYTES);

  if (!supabaseUrl || !serviceRoleKey) {
    throw makeError(500, 'STORY_MIRROR_ENV_MISSING', 'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY cho Story Mirror Worker.');
  }
  if (!env.STORY_MIRROR_BUCKET) {
    throw makeError(500, 'STORY_MIRROR_R2_MISSING', 'Thiếu binding STORY_MIRROR_BUCKET cho R2.');
  }
  if (allowedOrigins.some((origin) => origin === '*')) {
    throw makeError(500, 'STORY_MIRROR_CORS_WILDCARD_BLOCKED', 'Story Mirror Worker không cho phép CORS wildcard.');
  }
  if (allowedOrigins.length === 0) {
    throw makeError(500, 'STORY_MIRROR_CORS_ORIGINS_MISSING', 'Thiếu STORY_MIRROR_ALLOWED_ORIGINS.');
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    allowedOrigins,
    bucket: env.STORY_MIRROR_BUCKET,
    quotaBytes: Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : DEFAULT_STORY_MIRROR_QUOTA_BYTES,
  };
}

function corsHeaders(request, config) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    Vary: 'Origin',
  };
  if (origin && config.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function isOriginAllowed(request, config) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

function json(payload, status = 200, cors = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, ...SECURITY_HEADERS, ...JSON_HEADERS },
  });
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_STORY_MIRROR_BATCH_BYTES) {
    throw makeError(413, 'STORY_MIRROR_PAYLOAD_TOO_LARGE', 'Story Mirror payload is too large.');
  }
  try {
    return await request.json();
  } catch {
    throw makeError(400, 'STORY_MIRROR_BAD_JSON', 'Nội dung JSON gửi lên không hợp lệ.');
  }
}

function getBearerToken(request) {
  const header = String(request.headers.get('Authorization') || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra,
  };
}

function restUrl(config, table, query = '') {
  return `${config.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
}

async function readSupabaseJson(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseRest(config, table, {
  method = 'GET',
  query = '',
  body,
  prefer = 'return=representation',
} = {}) {
  const response = await fetch(restUrl(config, table, query), {
    method,
    headers: supabaseHeaders(config, {
      ...JSON_HEADERS,
      ...(prefer ? { Prefer: prefer } : {}),
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readSupabaseJson(response);
  if (!response.ok) {
    throw makeError(response.status || 500, 'STORY_MIRROR_SUPABASE_FAILED', payload?.message || payload?.error || 'Supabase REST trả về lỗi.');
  }
  return payload;
}

async function authenticate(request, config) {
  const token = getBearerToken(request);
  if (!token) {
    throw makeError(401, 'STORY_MIRROR_AUTH_REQUIRED', 'Cần đăng nhập trước khi đồng bộ truyện.');
  }
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: supabaseHeaders(config, {
      Authorization: `Bearer ${token}`,
    }),
  });
  const user = await readSupabaseJson(response);
  if (!response.ok || !user?.id) {
    throw makeError(401, 'STORY_MIRROR_AUTH_INVALID', 'Phiên đăng nhập không hợp lệ.');
  }
  return user;
}

async function getSettings(config) {
  const rows = await supabaseRest(config, SETTINGS_TABLE, {
    query: 'select=key,enabled,test_only,test_user_ids,per_user_quota_bytes,updated_at&key=eq.global&limit=1',
    prefer: '',
  }).catch(() => []);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  return {
    enabled: row?.enabled === true,
    testOnly: row?.test_only === true,
    testUserIds: Array.isArray(row?.test_user_ids) ? row.test_user_ids.map(String) : [],
    perUserQuotaBytes: Number(row?.per_user_quota_bytes || config.quotaBytes) || config.quotaBytes,
    updatedAt: row?.updated_at || null,
  };
}

function canUserMirror(user, settings) {
  if (!settings.enabled) return { ok: false, code: 'STORY_MIRROR_DISABLED', status: 'disabled' };
  if (settings.testOnly && !settings.testUserIds.includes(String(user.id))) {
    return { ok: false, code: 'STORY_MIRROR_TEST_ONLY', status: 'disabled' };
  }
  return { ok: true };
}

function upsertQuery(columns) {
  return `on_conflict=${columns.join(',')}`;
}

function createRepository(config) {
  return {
    async findEventByKey(userId, idempotencyKey) {
      const rows = await supabaseRest(config, EVENTS_TABLE, {
        query: `select=id,idempotency_key,status&user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
        prefer: '',
      });
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async recordEvent(row) {
      const rows = await supabaseRest(config, EVENTS_TABLE, {
        method: 'POST',
        body: row,
      });
      return Array.isArray(rows) ? rows[0] || row : row;
    },
    async upsertProject(userId, row) {
      const rows = await supabaseRest(config, PROJECTS_TABLE, {
        method: 'POST',
        query: upsertQuery(['user_id', 'client_project_id']),
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          ...row,
          user_id: userId,
          updated_at: new Date().toISOString(),
        },
      });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async findProjectByClientId(userId, clientProjectId) {
      const rows = await supabaseRest(config, PROJECTS_TABLE, {
        query: `select=id,user_id,client_project_id&user_id=eq.${encodeURIComponent(userId)}&client_project_id=eq.${encodeURIComponent(clientProjectId)}&limit=1`,
        prefer: '',
      });
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async upsertChapter(userId, row) {
      const rows = await supabaseRest(config, CHAPTERS_TABLE, {
        method: 'POST',
        query: upsertQuery(['project_id', 'client_chapter_id']),
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          ...row,
          user_id: userId,
          updated_at: new Date().toISOString(),
        },
      });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async findScene(userId, projectId, clientSceneId) {
      const rows = await supabaseRest(config, SCENES_TABLE, {
        query: `select=id,client_updated_at,content_hash,size_bytes&user_id=eq.${encodeURIComponent(userId)}&project_id=eq.${encodeURIComponent(projectId)}&client_scene_id=eq.${encodeURIComponent(clientSceneId)}&limit=1`,
        prefer: '',
      });
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async upsertScene(userId, row) {
      const rows = await supabaseRest(config, SCENES_TABLE, {
        method: 'POST',
        query: upsertQuery(['project_id', 'client_scene_id']),
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          ...row,
          user_id: userId,
          updated_at: new Date().toISOString(),
        },
      });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async listProjectScenes(userId, projectId) {
      const rows = await supabaseRest(config, SCENES_TABLE, {
        query: `select=id,client_scene_id,client_chapter_id,title,order_index,status,content_hash,size_bytes,storage_key,client_updated_at&user_id=eq.${encodeURIComponent(userId)}&project_id=eq.${encodeURIComponent(projectId)}&order=order_index.asc&limit=10000`,
        prefer: '',
      });
      return Array.isArray(rows) ? rows : [];
    },
    async getUserUsageBytes(userId) {
      const rows = await supabaseRest(config, PROJECTS_TABLE, {
        query: `select=storage_used_bytes&user_id=eq.${encodeURIComponent(userId)}&limit=1000`,
        prefer: '',
      });
      return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (Number(row.storage_used_bytes) || 0), 0);
    },
    async updateProjectStorageBytes(projectId, storageUsedBytes) {
      await supabaseRest(config, PROJECTS_TABLE, {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(projectId)}`,
        prefer: 'return=minimal',
        body: {
          storage_used_bytes: Number(storageUsedBytes) || 0,
          updated_at: new Date().toISOString(),
        },
      });
    },
    async deleteProject(projectId) {
      await supabaseRest(config, PROJECTS_TABLE, {
        method: 'DELETE',
        query: `id=eq.${encodeURIComponent(projectId)}`,
        prefer: 'return=minimal',
      });
    },
  };
}

async function handleBatch(request, config, user) {
  const settings = await getSettings(config);
  const access = canUserMirror(user, settings);
  const body = await readJson(request);
  if (body?.events !== undefined && !Array.isArray(body.events)) {
    throw makeError(400, 'STORY_MIRROR_EVENTS_MALFORMED', 'Story Mirror events must be an array.');
  }
  if (Array.isArray(body?.events) && body.events.length > MAX_STORY_MIRROR_EVENTS_PER_BATCH) {
    throw makeError(413, 'STORY_MIRROR_TOO_MANY_EVENTS', 'Story Mirror batch has too many events.');
  }
  const events = Array.isArray(body?.events) ? body.events : [];
  if (events.length === 0) {
    return { ok: true, results: [] };
  }
  if (!access.ok) {
    return {
      ok: true,
      disabled: true,
      results: events.map((event) => ({
        idempotencyKey: event?.idempotencyKey || '',
        status: access.status,
        code: access.code,
      })),
    };
  }

  const repo = createRepository(config);
  const results = [];
  for (const event of events) {
    try {
      results.push(await processStoryMirrorEvent({
        event,
        user,
        quotaBytes: settings.perUserQuotaBytes,
        repo,
        bucket: config.bucket,
      }));
    } catch (error) {
      results.push({
        idempotencyKey: event?.idempotencyKey || '',
        status: 'failed',
        code: error.code || 'STORY_MIRROR_EVENT_FAILED',
        error: error.message || 'Không xử lý được story mirror event.',
      });
    }
  }
  return { ok: true, results };
}

async function handleStatus(config, user) {
  const settings = await getSettings(config);
  const access = canUserMirror(user, settings);
  const repo = createRepository(config);
  return {
    ok: true,
    enabled: access.ok,
    disabledCode: access.ok ? '' : access.code,
    quotaBytes: settings.perUserQuotaBytes,
    usedBytes: await repo.getUserUsageBytes(user.id),
    updatedAt: settings.updatedAt,
  };
}

async function handleProjectDelete(config, user, clientProjectId) {
  const repo = createRepository(config);
  const project = await repo.findProjectByClientId(user.id, clientProjectId);
  if (!project) return { ok: true, deleted: false };
  const scenes = await repo.listProjectScenes(user.id, project.id);
  await Promise.all(scenes.map((scene) => config.bucket.delete(scene.storage_key).catch(() => null)));
  await config.bucket.delete(`users/${encodeURIComponent(user.id)}/projects/${encodeURIComponent(clientProjectId)}/manifest.json`).catch(() => null);
  await repo.deleteProject(project.id);
  return { ok: true, deleted: true, sceneCount: scenes.length };
}

function cleanPath(url) {
  const pathname = url.pathname
    .replace(/^\/api\/mirror(?=\/|$)/u, '/mirror')
    .replace(/^\/+|\/+$/gu, '');
  return pathname.split('/').filter(Boolean);
}

async function routeRequest(request, config, user) {
  const url = new URL(request.url);
  const [root, version, resource, id, action] = cleanPath(url);
  if (root !== 'mirror' || version !== 'v1') {
    throw makeError(404, 'STORY_MIRROR_ROUTE_NOT_FOUND', 'Không tìm thấy route Story Mirror.');
  }
  if (resource === 'status' && request.method === 'GET') {
    return handleStatus(config, user);
  }
  if (resource === 'events' && id === 'batch' && request.method === 'POST') {
    return handleBatch(request, config, user);
  }
  if (resource === 'projects' && id && action === 'delete' && request.method === 'POST') {
    return handleProjectDelete(config, user, id);
  }
  throw makeError(404, 'STORY_MIRROR_ROUTE_NOT_FOUND', 'Không tìm thấy route Story Mirror.');
}

async function handle(request, env = {}) {
  let config;
  try {
    config = validateEnv(env);
  } catch (error) {
    return json({ error: error.message, code: error.code || 'STORY_MIRROR_CONFIG_ERROR' }, error.status || 500);
  }

  const cors = corsHeaders(request, config);
  if (!isOriginAllowed(request, config)) {
    return json({ error: 'Origin không được phép gọi Story Mirror.', code: 'STORY_MIRROR_ORIGIN_NOT_ALLOWED' }, 403, cors);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  }
  if (new URL(request.url).pathname.endsWith('/health')) {
    return json({ ok: true, service: 'storyforge-story-mirror' }, 200, cors);
  }

  try {
    const user = await authenticate(request, config);
    const payload = await routeRequest(request, config, user);
    return json(payload, 200, cors);
  } catch (error) {
    return json({
      error: error.message || 'Story Mirror gặp lỗi ngoài dự kiến.',
      code: error.code || 'STORY_MIRROR_UNEXPECTED_ERROR',
    }, error.status || 500, cors);
  }
}

export default {
  fetch: handle,
};
