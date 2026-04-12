import crypto from 'node:crypto';
import { Pool } from 'pg';

const DATABASE_URL =
  process.env.STORYFORGE_DATABASE_URL
  || process.env.POSTGRES_URL
  || process.env.DATABASE_URL
  || process.env.POSTGRES_PRISMA_URL
  || process.env.SUPABASE_DB_URL
  || '';

let pool = null;
let schemaReadyPromise = null;

function getPool() {
  if (!DATABASE_URL) {
    throw new Error('Missing database connection string. Set STORYFORGE_DATABASE_URL or POSTGRES_URL in Vercel.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function ensureSchema() {
  if (!schemaReadyPromise) {
    const sql = `
      create table if not exists storyforge_cloud_snapshots (
        id bigserial primary key,
        workspace_slug text not null,
        project_slug text not null,
        project_title text not null,
        access_hash text not null,
        snapshot_json text not null,
        snapshot_version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (workspace_slug, project_slug)
      );

      create index if not exists idx_storyforge_cloud_snapshots_workspace_hash
        on storyforge_cloud_snapshots (workspace_slug, access_hash);
    `;

    schemaReadyPromise = getPool().query(sql);
  }

  await schemaReadyPromise;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readCredentials(req) {
  const workspaceSlug = String(req.headers['x-storyforge-workspace'] || '').trim().toLowerCase();
  const accessKey = String(req.headers['x-storyforge-access-key'] || '').trim();

  if (!workspaceSlug || !accessKey) {
    return null;
  }

  return { workspaceSlug, accessKey };
}

function hashAccess(workspaceSlug, accessKey) {
  return crypto
    .createHash('sha256')
    .update(`${workspaceSlug}::${accessKey}`)
    .digest('hex');
}

function normalizeSlug(value, fallback = 'project') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function listSnapshots(res, workspaceSlug, accessHash) {
  const query = `
    select project_slug, project_title, updated_at, octet_length(snapshot_json) as size_bytes
    from storyforge_cloud_snapshots
    where workspace_slug = $1 and access_hash = $2
    order by updated_at desc
  `;
  const result = await getPool().query(query, [workspaceSlug, accessHash]);

  sendJson(res, 200, {
    items: result.rows.map((row) => ({
      projectSlug: row.project_slug,
      projectTitle: row.project_title,
      updatedAt: row.updated_at,
      sizeBytes: Number(row.size_bytes || 0),
    })),
  });
}

async function getSnapshot(res, workspaceSlug, accessHash, projectSlug) {
  const query = `
    select project_slug, project_title, snapshot_json, updated_at, octet_length(snapshot_json) as size_bytes
    from storyforge_cloud_snapshots
    where workspace_slug = $1 and access_hash = $2 and project_slug = $3
    limit 1
  `;
  const result = await getPool().query(query, [workspaceSlug, accessHash, projectSlug]);
  const row = result.rows[0];

  if (!row) {
    sendJson(res, 404, { error: 'Cloud snapshot not found.', code: 'CLOUD_SNAPSHOT_NOT_FOUND' });
    return;
  }

  sendJson(res, 200, {
    item: {
      projectSlug: row.project_slug,
      projectTitle: row.project_title,
      snapshotJson: row.snapshot_json,
      updatedAt: row.updated_at,
      sizeBytes: Number(row.size_bytes || 0),
    },
  });
}

async function upsertSnapshot(req, res, workspaceSlug, accessHash) {
  const body = await readJsonBody(req);
  const projectSlug = normalizeSlug(body?.projectSlug, 'project');
  const projectTitle = String(body?.projectTitle || projectSlug).trim().slice(0, 200);
  const snapshotJson = String(body?.snapshotJson || '');

  if (!snapshotJson) {
    sendJson(res, 400, { error: 'Missing snapshotJson.', code: 'CLOUD_SNAPSHOT_REQUIRED' });
    return;
  }

  if (snapshotJson.length > 4_000_000) {
    sendJson(res, 413, {
      error: 'Snapshot qua lon cho cloud function hien tai. Hay giam kich thuoc hoac doi sang Blob/Storage khac.',
      code: 'CLOUD_SNAPSHOT_TOO_LARGE',
    });
    return;
  }

  const existing = await getPool().query(
    `
      select access_hash
      from storyforge_cloud_snapshots
      where workspace_slug = $1 and project_slug = $2
      limit 1
    `,
    [workspaceSlug, projectSlug],
  );

  const existingHash = existing.rows[0]?.access_hash;
  if (existingHash && existingHash !== accessHash) {
    sendJson(res, 403, {
      error: 'Snapshot nay dang thuoc ve mot access key khac.',
      code: 'CLOUD_SNAPSHOT_FORBIDDEN',
    });
    return;
  }

  const query = `
    insert into storyforge_cloud_snapshots (
      workspace_slug,
      project_slug,
      project_title,
      access_hash,
      snapshot_json,
      updated_at
    )
    values ($1, $2, $3, $4, $5, now())
    on conflict (workspace_slug, project_slug)
    do update set
      project_title = excluded.project_title,
      access_hash = excluded.access_hash,
      snapshot_json = excluded.snapshot_json,
      updated_at = now()
    returning project_slug, project_title, updated_at, octet_length(snapshot_json) as size_bytes
  `;

  const result = await getPool().query(query, [
    workspaceSlug,
    projectSlug,
    projectTitle,
    accessHash,
    snapshotJson,
  ]);

  const row = result.rows[0];
  sendJson(res, 200, {
    ok: true,
    item: {
      projectSlug: row.project_slug,
      projectTitle: row.project_title,
      updatedAt: row.updated_at,
      sizeBytes: Number(row.size_bytes || 0),
    },
  });
}

async function deleteSnapshot(res, workspaceSlug, accessHash, projectSlug) {
  const result = await getPool().query(
    `
      delete from storyforge_cloud_snapshots
      where workspace_slug = $1 and access_hash = $2 and project_slug = $3
    `,
    [workspaceSlug, accessHash, projectSlug],
  );

  if (result.rowCount === 0) {
    sendJson(res, 404, { error: 'Cloud snapshot not found.', code: 'CLOUD_SNAPSHOT_NOT_FOUND' });
    return;
  }

  sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || 'Cloud database initialization failed.',
      code: 'CLOUD_DATABASE_UNAVAILABLE',
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const credentials = readCredentials(req);
  if (!credentials) {
    sendJson(res, 400, {
      error: 'Missing Cloud Sync credentials.',
      code: 'CLOUD_SYNC_MISSING_CREDENTIALS',
    });
    return;
  }

  const { workspaceSlug, accessKey } = credentials;
  const accessHash = hashAccess(workspaceSlug, accessKey);
  const projectSlug = normalizeSlug(req.query?.projectSlug || '', '');

  try {
    if (req.method === 'GET') {
      if (projectSlug) {
        await getSnapshot(res, workspaceSlug, accessHash, projectSlug);
        return;
      }

      await listSnapshots(res, workspaceSlug, accessHash);
      return;
    }

    if (req.method === 'POST') {
      await upsertSnapshot(req, res, workspaceSlug, accessHash);
      return;
    }

    if (req.method === 'DELETE') {
      if (!projectSlug) {
        sendJson(res, 400, { error: 'Missing projectSlug.', code: 'CLOUD_PROJECT_SLUG_REQUIRED' });
        return;
      }

      await deleteSnapshot(res, workspaceSlug, accessHash, projectSlug);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || 'Unexpected cloud sync error.',
      code: 'CLOUD_SYNC_UNEXPECTED_ERROR',
    });
  }
}
