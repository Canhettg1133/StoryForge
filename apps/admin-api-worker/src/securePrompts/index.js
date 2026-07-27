import { ADMIN_PERMISSIONS } from '../../../../packages/access/src/index.js';
import {
  decryptSecurePrompt,
  encryptSecurePrompt,
  getSecurePromptKey,
} from '../../../../packages/server-security/src/securePromptCrypto.js';

const PROMPT_KEY = 'supreme_chat';
const PROMPT_ROUTE = 'supreme-chat';
const ADMIN_BODY_MAX_BYTES = 512 * 1024;
const HISTORY_PAGE_SIZE = 25;
const SECURE_PROMPT_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
});
const HEAD_SELECT = 'prompt_key,draft_version_id,published_version_id,enabled,updated_by,created_at,updated_at';
const VERSION_METADATA_SELECT = 'id,prompt_key,revision,encryption_key_version,content_hash,content_length,created_by,created_at';
const VERSION_SECRET_SELECT = `${VERSION_METADATA_SELECT},ciphertext,iv`;

function makeError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

function first(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function filterEq(column, value) {
  return `${column}=eq.${encodeURIComponent(String(value))}`;
}

function normalizeContent(value) {
  const content = String(value ?? '').replace(/\r\n?/gu, '\n').trim();
  if (!content) throw makeError(422, 'SECURE_PROMPT_CONTENT_REQUIRED', 'Prompt Tối Thượng không được để trống.');
  if (content.length > 60000) {
    throw makeError(422, 'SECURE_PROMPT_CONTENT_TOO_LONG', 'Prompt Tối Thượng vượt quá 60.000 ký tự.');
  }
  return content;
}

function asRevision(value, field) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw makeError(422, 'SECURE_PROMPT_REVISION_REQUIRED', `${field} không hợp lệ.`);
  }
  return revision;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function getHead(config, helpers) {
  return first(await helpers.supabaseRest(config, 'secure_prompt_heads', {
    query: `select=${HEAD_SELECT}&${filterEq('prompt_key', PROMPT_KEY)}&limit=1`,
    prefer: '',
  }));
}

async function getVersions(config, helpers, beforeRevision = 0) {
  const cursorFilter = beforeRevision > 0 ? `&revision=lt.${beforeRevision}` : '';
  const rows = await helpers.supabaseRest(config, 'secure_prompt_versions', {
    query: `select=${VERSION_METADATA_SELECT}&${filterEq('prompt_key', PROMPT_KEY)}${cursorFilter}&order=revision.desc&limit=${HISTORY_PAGE_SIZE + 1}`,
    prefer: '',
  });
  const normalized = Array.isArray(rows) ? rows : [];
  const versions = normalized.slice(0, HISTORY_PAGE_SIZE);
  return {
    versions,
    historyNextBeforeRevision: normalized.length > HISTORY_PAGE_SIZE
      ? Number(versions.at(-1)?.revision || 0)
      : null,
  };
}

async function getVersion(config, helpers, versionId) {
  return first(await helpers.supabaseRest(config, 'secure_prompt_versions', {
    query: `select=${VERSION_SECRET_SELECT}&${filterEq('prompt_key', PROMPT_KEY)}&${filterEq('id', versionId)}&limit=1`,
    prefer: '',
  }));
}

async function getVersionMetadata(config, helpers, versionId) {
  return first(await helpers.supabaseRest(config, 'secure_prompt_versions', {
    query: `select=${VERSION_METADATA_SELECT}&${filterEq('prompt_key', PROMPT_KEY)}&${filterEq('id', versionId)}&limit=1`,
    prefer: '',
  }));
}

function versionMetadata(version) {
  if (!version) return null;
  return {
    id: version.id,
    revision: Number(version.revision || 0),
    contentHash: version.content_hash,
    contentLength: Number(version.content_length || 0),
    encryptionKeyVersion: Number(version.encryption_key_version || 0),
    createdBy: version.created_by || null,
    createdAt: version.created_at || null,
  };
}

async function decryptVersion(env, version) {
  if (!version) return '';
  let key;
  try {
    ({ key } = getSecurePromptKey(env, version.encryption_key_version));
    return await decryptSecurePrompt({
      ciphertext: version.ciphertext,
      iv: version.iv,
      key,
      promptKey: version.prompt_key,
      versionId: version.id,
      keyVersion: version.encryption_key_version,
    });
  } catch (error) {
    mapCryptoError(error);
  } finally {
    key?.fill(0);
  }
}

function secureResponse(helpers, payload) {
  return helpers.withResponseHeaders(payload, SECURE_PROMPT_RESPONSE_HEADERS);
}

function mapRpcError(error) {
  const message = String(error?.message || '');
  if (/REVISION_CONFLICT/iu.test(message)) {
    throw makeError(409, 'SECURE_PROMPT_REVISION_CONFLICT', 'Prompt đã được cập nhật ở nơi khác. Hãy tải lại trước khi tiếp tục.');
  }
  if (/VERSION_NOT_FOUND/iu.test(message)) {
    throw makeError(422, 'SECURE_PROMPT_VERSION_NOT_FOUND', 'Không tìm thấy revision cần sử dụng.');
  }
  throw error;
}

function auditContext(request, helpers) {
  return {
    p_request_id: String(
      request.headers.get('X-Request-Id')
      || request.headers.get('X-Correlation-Id')
      || crypto.randomUUID(),
    ).slice(0, 120),
    p_ip_address: String(helpers.getClientIp?.(request) || '').slice(0, 200),
    p_user_agent: String(request.headers.get('User-Agent') || '').slice(0, 500),
  };
}

function mapCryptoError(error) {
  const code = String(error?.code || error?.message || '');
  if (/SUPREME_PROMPT_(?:KEY|IV|DECRYPT)/u.test(code)) {
    throw makeError(
      503,
      'SECURE_PROMPT_ENCRYPTION_UNAVAILABLE',
      'Khóa mã hóa prompt Tối Thượng chưa được cấu hình hoặc không thể giải mã dữ liệu.',
    );
  }
  throw error;
}

async function getSecurePrompt(config, env, actor, helpers, request) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_READ);
  const url = new URL(request.url);
  const historyBeforeRevision = Number.parseInt(
    url.searchParams.get('historyBeforeRevision') || '0',
    10,
  );
  const metadataOnly = url.searchParams.get('metadataOnly') === '1';
  const historyCursor = Number.isInteger(historyBeforeRevision) && historyBeforeRevision > 0
    ? historyBeforeRevision
    : 0;
  const historyPromise = getVersions(config, helpers, historyCursor);
  if (metadataOnly) {
    const history = await historyPromise;
    return secureResponse(helpers, {
      ok: true,
      versions: history.versions.map(versionMetadata),
      historyNextBeforeRevision: history.historyNextBeforeRevision,
    });
  }

  const [head, history] = await Promise.all([
    getHead(config, helpers),
    historyPromise,
  ]);
  if (!head) throw makeError(503, 'SECURE_PROMPT_HEAD_MISSING', 'Kho prompt bảo mật chưa được khởi tạo.');
  const versions = history.versions;
  let draft = null;
  let published = versions.find((version) => version.id === head.published_version_id) || null;
  const [missingDraft, missingPublished] = await Promise.all([
    head.draft_version_id
      ? getVersion(config, helpers, head.draft_version_id)
      : null,
    !published && head.published_version_id
      ? getVersionMetadata(config, helpers, head.published_version_id)
      : null,
  ]);
  draft = missingDraft;
  published ||= missingPublished;
  const draftContent = draft ? await decryptVersion(env, draft) : '';

  return secureResponse(helpers, {
    ok: true,
    promptKey: PROMPT_KEY,
    enabled: head.enabled === true,
    draftContent,
    draftRevision: Number(draft?.revision || 0),
    publishedRevision: Number(published?.revision || 0),
    draftVersionId: draft?.id || null,
    publishedVersionId: published?.id || null,
    contentHash: draft?.content_hash || '',
    contentLength: Number(draft?.content_length || 0),
    updatedAt: head.updated_at || null,
    updatedBy: head.updated_by || null,
    versions: versions.map(versionMetadata),
    historyNextBeforeRevision: history.historyNextBeforeRevision,
  });
}

async function saveDraft(config, env, request, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_WRITE);
  const body = await helpers.readJsonLimited(request, ADMIN_BODY_MAX_BYTES);
  const content = normalizeContent(body.content);
  const expectedDraftRevision = asRevision(body.expectedDraftRevision, 'expectedDraftRevision');
  const versionId = crypto.randomUUID();
  let key;
  let keyVersion;
  try {
    ({ key, keyVersion } = getSecurePromptKey(env));
  } catch (error) {
    mapCryptoError(error);
  }
  let encrypted;
  try {
    encrypted = await encryptSecurePrompt({
      plaintext: content,
      key,
      promptKey: PROMPT_KEY,
      versionId,
      keyVersion,
    });
  } catch (error) {
    mapCryptoError(error);
  } finally {
    key?.fill(0);
  }
  const contentHash = `sha256:${await sha256Hex(content)}`;

  let saved;
  try {
    saved = first(await helpers.supabaseRest(config, 'rpc/save_secure_prompt_draft', {
      method: 'POST',
      query: '',
      body: {
        p_prompt_key: PROMPT_KEY,
        p_version_id: versionId,
        p_ciphertext: encrypted.ciphertext,
        p_iv: encrypted.iv,
        p_encryption_key_version: keyVersion,
        p_content_hash: contentHash,
        p_content_length: content.length,
        p_expected_draft_revision: expectedDraftRevision,
        p_updated_by: actor.id || null,
        ...auditContext(request, helpers),
      },
    }));
  } catch (error) {
    mapRpcError(error);
  }

  return secureResponse(helpers, {
    ok: true,
    item: versionMetadata(saved || {
      id: versionId,
      revision: expectedDraftRevision + 1,
      content_hash: contentHash,
      content_length: content.length,
      encryption_key_version: keyVersion,
    }),
  });
}

async function publishVersion(config, request, actor, helpers, action) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_PUBLISH);
  const body = await helpers.readJsonLimited(request, ADMIN_BODY_MAX_BYTES);
  const expectedPublishedRevision = asRevision(
    body.expectedPublishedRevision,
    'expectedPublishedRevision',
  );
  const head = await getHead(config, helpers);
  const versionId = String(
    body.versionId
    || (action === 'publish' ? head?.draft_version_id : ''),
  ).trim();
  if (!versionId) throw makeError(422, 'SECURE_PROMPT_VERSION_REQUIRED', 'Cần chọn revision để xuất bản.');
  const version = await getVersionMetadata(config, helpers, versionId);
  if (!version || Number(version.content_length || 0) < 1) {
    throw makeError(422, 'SECURE_PROMPT_VERSION_NOT_FOUND', 'Không tìm thấy revision cần sử dụng.');
  }

  try {
    await helpers.supabaseRest(config, 'rpc/publish_secure_prompt_version', {
      method: 'POST',
      query: '',
      body: {
        p_prompt_key: PROMPT_KEY,
        p_version_id: versionId,
        p_expected_published_revision: expectedPublishedRevision,
        p_updated_by: actor.id || null,
        p_audit_action: action === 'rollback'
          ? 'secure_prompt.rollback'
          : 'secure_prompt.publish',
        ...auditContext(request, helpers),
      },
    });
  } catch (error) {
    mapRpcError(error);
  }

  return secureResponse(helpers, {
    ok: true,
    publishedRevision: Number(version.revision || 0),
    publishedVersionId: version.id,
    enabled: true,
  });
}

async function disablePrompt(config, request, actor, helpers) {
  helpers.requirePermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_PUBLISH);
  await helpers.supabaseRest(config, 'rpc/disable_secure_prompt', {
    method: 'POST',
    query: '',
    body: {
      p_prompt_key: PROMPT_KEY,
      p_updated_by: actor.id || null,
      ...auditContext(request, helpers),
    },
  });
  return secureResponse(helpers, { ok: true, enabled: false });
}

export async function routeSecurePromptsAdmin({
  request,
  env,
  config,
  actor,
  segments,
  helpers,
}) {
  const [promptRoute, action] = segments;
  if (promptRoute !== PROMPT_ROUTE) {
    throw makeError(404, 'SECURE_PROMPT_ROUTE_NOT_FOUND', 'Không tìm thấy kho prompt bảo mật.');
  }

  if (request.method === 'GET' && !action) {
    return getSecurePrompt(config, env, actor, helpers, request);
  }
  if (request.method === 'PUT' && action === 'draft') {
    return saveDraft(config, env, request, actor, helpers);
  }
  if (request.method === 'POST' && action === 'publish') {
    return publishVersion(config, request, actor, helpers, 'publish');
  }
  if (request.method === 'POST' && action === 'rollback') {
    return publishVersion(config, request, actor, helpers, 'rollback');
  }
  if (request.method === 'POST' && action === 'disable') {
    return disablePrompt(config, request, actor, helpers);
  }

  throw makeError(404, 'SECURE_PROMPT_ROUTE_NOT_FOUND', 'Không tìm thấy thao tác prompt bảo mật.');
}

export default {
  routeSecurePromptsAdmin,
};
