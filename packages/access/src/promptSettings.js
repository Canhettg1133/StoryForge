export const PROMPT_SETTINGS_DOMAINS = Object.freeze({
  TRANSLATOR: 'translator',
  WRITING: 'writing',
});

export const TRANSLATOR_PROMPT_KEYS = Object.freeze([
  'convert',
  'novel',
  'wuxia',
  'romance',
  'adult',
  'sacHiep',
  'sacHiepPro',
  'sacHiepENI',
]);

export const PROMPT_SETTINGS_ACTIVE_DOMAINS = Object.freeze([
  PROMPT_SETTINGS_DOMAINS.TRANSLATOR,
]);

export const PROMPT_SETTING_MAX_CONTENT_CHARS = 60_000;
export const PROMPT_SETTINGS_ADMIN_BODY_MAX_BYTES = 96 * 1024;

export const TRANSLATOR_PROMPT_LABELS = Object.freeze({
  convert: 'Convert (làm mượt)',
  novel: 'Tiểu thuyết',
  wuxia: 'Tu tiên/Kiếm hiệp',
  romance: 'Ngôn tình',
  adult: 'Truyện 18+',
  sacHiep: 'Sắc hiệp',
  sacHiepPro: 'Sắc hiệp PRO',
  sacHiepENI: 'Sắc hiệp ENI',
});

const TRANSLATOR_PROMPT_KEY_SET = new Set(TRANSLATOR_PROMPT_KEYS);

function promptSettingsError(status, code, message) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  error.publicMessage = message;
  return error;
}

function toInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

export function normalizePromptSettingsDomain(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizePromptSettingKey(value) {
  return String(value || '').trim();
}

export function assertPromptSettingsDomain(value) {
  const domain = normalizePromptSettingsDomain(value);
  if (!PROMPT_SETTINGS_ACTIVE_DOMAINS.includes(domain)) {
    throw promptSettingsError(
      400,
      'ADMIN_PROMPT_DOMAIN_UNSUPPORTED',
      'Domain prompt chưa được hỗ trợ.',
    );
  }
  return domain;
}

export function assertPromptSettingsKey(domainValue, keyValue) {
  const domain = assertPromptSettingsDomain(domainValue);
  const key = normalizePromptSettingKey(keyValue);
  if (domain === PROMPT_SETTINGS_DOMAINS.TRANSLATOR && !TRANSLATOR_PROMPT_KEY_SET.has(key)) {
    throw promptSettingsError(
      400,
      'ADMIN_PROMPT_KEY_UNSUPPORTED',
      'Mẫu prompt không nằm trong allowlist.',
    );
  }
  return key;
}

export function isTranslatorPromptKey(key) {
  return TRANSLATOR_PROMPT_KEY_SET.has(normalizePromptSettingKey(key));
}

function normalizePromptContent(value) {
  const content = String(value ?? '').trim();
  if (content.length > PROMPT_SETTING_MAX_CONTENT_CHARS) {
    throw promptSettingsError(
      422,
      'ADMIN_PROMPT_CONTENT_TOO_LONG',
      'Prompt vượt quá giới hạn ký tự cho phép.',
    );
  }
  return content;
}

function normalizeExpectedRevision(value) {
  if (value === undefined || value === null || value === '') {
    throw promptSettingsError(
      422,
      'ADMIN_PROMPT_REVISION_REQUIRED',
      'Cần expectedRevision để tránh ghi đè nhầm.',
    );
  }
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw promptSettingsError(
      422,
      'ADMIN_PROMPT_REVISION_INVALID',
      'expectedRevision không hợp lệ.',
    );
  }
  return revision;
}

export function normalizePromptSettingPatch(body = {}, current = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw promptSettingsError(
      400,
      'ADMIN_PROMPT_BODY_INVALID',
      'Nội dung cập nhật prompt không hợp lệ.',
    );
  }
  const hasContent = Object.prototype.hasOwnProperty.call(body, 'content');
  const hasEnabled = Object.prototype.hasOwnProperty.call(body, 'enabled');
  return {
    content: normalizePromptContent(hasContent ? body.content : current.content),
    enabled: hasEnabled ? body.enabled === true : current.enabled === true,
    expectedRevision: normalizeExpectedRevision(body.expectedRevision),
  };
}

export function normalizePromptSettingRow(row = {}) {
  const domain = normalizePromptSettingsDomain(row.domain);
  const key = normalizePromptSettingKey(row.key);
  return {
    domain,
    key,
    label: TRANSLATOR_PROMPT_LABELS[key] || key,
    content: String(row.content ?? ''),
    enabled: row.enabled === true,
    revision: Math.max(0, toInteger(row.revision, 0)),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

export function buildPromptSettingsList(domainValue, rows = []) {
  const domain = assertPromptSettingsDomain(domainValue);
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizePromptSettingRow(row);
    if (normalized.domain !== domain) continue;
    if (domain === PROMPT_SETTINGS_DOMAINS.TRANSLATOR && !TRANSLATOR_PROMPT_KEY_SET.has(normalized.key)) continue;
    byKey.set(normalized.key, normalized);
  }

  if (domain === PROMPT_SETTINGS_DOMAINS.TRANSLATOR) {
    return TRANSLATOR_PROMPT_KEYS.map((key) => byKey.get(key) || {
      domain,
      key,
      label: TRANSLATOR_PROMPT_LABELS[key] || key,
      content: '',
      enabled: false,
      revision: 0,
      updatedAt: null,
    });
  }

  return [];
}

export function toPublicTranslatorPromptSettings(rows = []) {
  const prompts = {};
  let revision = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizePromptSettingRow(row);
    if (normalized.domain !== PROMPT_SETTINGS_DOMAINS.TRANSLATOR) continue;
    if (!TRANSLATOR_PROMPT_KEY_SET.has(normalized.key)) continue;
    if (!normalized.enabled || !normalized.content.trim()) continue;
    prompts[normalized.key] = normalized.content;
    revision = Math.max(revision, normalized.revision);
  }
  return { prompts, revision };
}
