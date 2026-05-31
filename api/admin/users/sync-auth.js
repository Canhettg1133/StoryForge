import { logAdminAudit, mapAuthUserToProfileRow, requireAdmin, sendAccessDenied } from '../../_lib/access-control.js';
import { sendJson } from '../../_lib/http.js';

const PER_PAGE = 1000;

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqByUserId(users) {
  const map = new Map();
  for (const user of users) {
    if (user?.id) map.set(user.id, user);
  }
  return [...map.values()];
}

async function listAllAuthUsers(supabase) {
  const users = [];
  for (let page = 1; page < 10000; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < PER_PAGE) break;
  }
  return uniqByUserId(users);
}

async function fetchExistingProfileIds(supabase, userIds) {
  const ids = new Set();
  for (const chunk of chunkArray(userIds, 500)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id')
      .in('user_id', chunk);
    if (error) throw error;
    for (const row of data || []) ids.add(row.user_id);
  }
  return ids;
}

async function insertMissingProfiles(supabase, rows) {
  if (rows.length === 0) return [];
  const inserted = [];
  for (const chunk of chunkArray(rows, 500)) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert(chunk, {
        onConflict: 'user_id',
        ignoreDuplicates: true,
      })
      .select('user_id');
    if (error) throw error;
    inserted.push(...(data || []));
  }
  return inserted;
}

async function refreshExistingProfileEmails(supabase, rows) {
  if (rows.length === 0) return 0;
  let updated = 0;
  for (const row of rows) {
    // Preserve system_role, status, consent fields, plans, and overrides.
    const { error } = await supabase
      .from('profiles')
      .update({
        email: row.email,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', row.user_id);
    if (error) throw error;
    updated += 1;
  }
  return updated;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      sendAccessDenied(res, admin);
      return;
    }

    const authUsers = await listAllAuthUsers(admin.supabase);
    const userIds = authUsers.map((user) => user.id);
    const existingIds = await fetchExistingProfileIds(admin.supabase, userIds);
    const rows = authUsers.map(mapAuthUserToProfileRow).filter((row) => row.user_id);
    const missingRows = rows.filter((row) => !existingIds.has(row.user_id));
    const existingRows = rows.filter((row) => existingIds.has(row.user_id));

    const inserted = await insertMissingProfiles(admin.supabase, missingRows);
    const updatedExisting = await refreshExistingProfileEmails(admin.supabase, existingRows);

    await logAdminAudit(admin.supabase, req, {
      actorUserId: admin.user.id,
      action: 'profiles.sync_auth',
      after: {
        totalAuthUsers: authUsers.length,
        created: inserted.length,
        existing: existingRows.length,
        updatedExisting,
      },
    });

    sendJson(res, 200, {
      ok: true,
      totalAuthUsers: authUsers.length,
      created: inserted.length,
      existing: existingRows.length,
      updatedExisting,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Không đồng bộ được người dùng từ Supabase Auth.',
      code: error?.code || 'ADMIN_SYNC_AUTH_USERS_FAILED',
    });
  }
}
