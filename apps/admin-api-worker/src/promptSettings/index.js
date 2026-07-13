import {
  ADMIN_PERMISSIONS,
  PROMPT_SETTINGS_ADMIN_BODY_MAX_BYTES,
  assertPromptSettingsDomain,
  assertPromptSettingsKey,
  buildPromptSettingsList,
  normalizePromptSettingPatch,
  normalizePromptSettingRow,
} from '../../../../packages/access/src/index.js';

const PROMPT_SETTINGS_TABLE = 'prompt_settings';
const PROMPT_SETTINGS_SELECT = 'domain,key,content,enabled,revision,updated_at';

function makeError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function filterEq(column, value) {
  return `${column}=eq.${encodeURIComponent(String(value))}`;
}

function firstRow(rows) {
  return asArray(rows)[0] || null;
}

function isPromptSettingsError(error) {
  return Boolean(error?.code && String(error.code).startsWith('ADMIN_PROMPT_'));
}

function rethrowPromptSettingsError(error) {
  if (isPromptSettingsError(error)) {
    throw makeError(error.status || 400, error.code, error.publicMessage || error.message);
  }
  throw error;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function promptAuditSnapshot(row = {}) {
  const normalized = normalizePromptSettingRow(row);
  return {
    domain: normalized.domain,
    key: normalized.key,
    enabled: normalized.enabled,
    revision: normalized.revision,
    contentLength: normalized.content.length,
    contentHash: `sha256:${await sha256Hex(normalized.content)}`,
  };
}

async function listPromptSettingRows(config, helpers, domain) {
  const rows = await helpers.supabaseRest(config, PROMPT_SETTINGS_TABLE, {
    query: `select=${PROMPT_SETTINGS_SELECT}&${filterEq('domain', domain)}&order=key.asc`,
    prefer: '',
  });
  return asArray(rows);
}

async function getPromptSettingRow(config, helpers, domain, key) {
  const rows = await helpers.supabaseRest(config, PROMPT_SETTINGS_TABLE, {
    query: `select=${PROMPT_SETTINGS_SELECT}&${filterEq('domain', domain)}&${filterEq('key', key)}&limit=1`,
    prefer: '',
  });
  return firstRow(rows);
}

async function getPromptSettings(config, actor, url, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.PROMPTS_READ);
  let domain;
  try {
    domain = assertPromptSettingsDomain(url.searchParams.get('domain') || 'translator');
  } catch (error) {
    rethrowPromptSettingsError(error);
  }
  const rows = await listPromptSettingRows(config, helpers, domain);
  return {
    ok: true,
    domain,
    items: buildPromptSettingsList(domain, rows),
  };
}

function mapPromptRpcError(error) {
  const message = String(error?.message || '');
  if (/PROMPT_SETTING_REVISION_CONFLICT/iu.test(message)) {
    throw makeError(
      409,
      'ADMIN_PROMPT_REVISION_CONFLICT',
      'Prompt đã được cập nhật ở nơi khác. Hãy tải lại trước khi lưu.',
    );
  }
  if (/PROMPT_SETTING_CONTENT_TOO_LONG/iu.test(message)) {
    throw makeError(422, 'ADMIN_PROMPT_CONTENT_TOO_LONG', 'Prompt vượt quá giới hạn ký tự cho phép.');
  }
  if (/PROMPT_SETTING_DOMAIN_UNSUPPORTED/iu.test(message)) {
    throw makeError(400, 'ADMIN_PROMPT_DOMAIN_UNSUPPORTED', 'Domain prompt chưa được hỗ trợ.');
  }
  if (/PROMPT_SETTING_KEY_UNSUPPORTED/iu.test(message)) {
    throw makeError(400, 'ADMIN_PROMPT_KEY_UNSUPPORTED', 'Mẫu prompt không nằm trong allowlist.');
  }
  throw error;
}

async function updatePromptSetting(config, request, actor, domainValue, keyValue, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.PROMPTS_WRITE);

  let domain;
  let key;
  try {
    domain = assertPromptSettingsDomain(domainValue);
    key = assertPromptSettingsKey(domain, keyValue);
  } catch (error) {
    rethrowPromptSettingsError(error);
  }

  const body = await helpers.readJsonLimited(request, PROMPT_SETTINGS_ADMIN_BODY_MAX_BYTES);
  const currentRow = await getPromptSettingRow(config, helpers, domain, key);
  const current = normalizePromptSettingRow(currentRow || {
    domain,
    key,
    content: '',
    enabled: false,
    revision: 0,
  });

  let patch;
  try {
    patch = normalizePromptSettingPatch(body, current);
  } catch (error) {
    rethrowPromptSettingsError(error);
  }

  let savedRow;
  try {
    const savedRows = await helpers.supabaseRest(config, 'rpc/upsert_prompt_setting', {
      method: 'POST',
      query: '',
      body: {
        p_domain: domain,
        p_key: key,
        p_content: patch.content,
        p_enabled: patch.enabled,
        p_expected_revision: patch.expectedRevision,
        p_updated_by: actor.id || null,
      },
    });
    savedRow = firstRow(savedRows) || {
      domain,
      key,
      content: patch.content,
      enabled: patch.enabled,
      revision: current.revision + 1,
    };
  } catch (error) {
    mapPromptRpcError(error);
  }

  const item = normalizePromptSettingRow(savedRow);
  await helpers.auditMutation(config, request, actor, 'prompt_settings.update', {
    before: await promptAuditSnapshot(current),
    after: await promptAuditSnapshot(item),
  });

  return { ok: true, item };
}

export async function routePromptSettingsAdmin({
  request,
  config,
  actor,
  segments,
  url,
  helpers,
}) {
  const [domain, key] = segments;

  if (request.method === 'GET' && !domain) {
    return getPromptSettings(config, actor, url, helpers);
  }

  if ((request.method === 'PATCH' || request.method === 'POST') && domain && key) {
    return updatePromptSetting(config, request, actor, domain, key, helpers);
  }

  throw makeError(404, 'ADMIN_PROMPT_SETTINGS_ROUTE_NOT_FOUND', 'Không tìm thấy route Prompt hệ thống.');
}

export default {
  routePromptSettingsAdmin,
};
