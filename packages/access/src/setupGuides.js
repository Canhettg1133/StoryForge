export const SETUP_GUIDES_KEY = 'setup_guides';
export const SETUP_GUIDES_CACHE_TTL_MS = 5 * 60 * 1000;
export const SETUP_GUIDES_ADMIN_BODY_MAX_BYTES = 32 * 1024;
export const SETUP_GUIDES_MAX_ITEMS = 12;
export const SETUP_GUIDE_LABEL_MAX_LENGTH = 64;
export const SETUP_GUIDE_URL_MAX_LENGTH = 2048;
export const SETUP_GUIDE_ICONS = Object.freeze(['book', 'external']);

const ITEM_FIELDS = new Set(['id', 'label', 'url', 'enabled', 'icon']);
const CONFIG_FIELDS = new Set(['revision', 'expectedRevision', 'items']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const FORBIDDEN_TEXT_PATTERN = /[<>\u0000-\u001f\u007f]/u;

const DEFAULT_ITEMS = [
  { id: 'gemini-direct', label: 'Hướng dẫn Gemini Direct', url: '/guide', enabled: true, icon: 'book' },
  { id: 'gemini-proxy', label: 'Hướng dẫn Gemini Proxy', url: '/guide/proxy', enabled: true, icon: 'book' },
  {
    id: 'writing-setup',
    label: 'Hướng dẫn setup để viết truyện',
    url: 'https://youtu.be/4tf6rXf_nmo?si=8nnL0KGT1eKNNgYJ',
    enabled: true,
    icon: 'book',
  },
  {
    id: 'translation-guide',
    label: 'Hướng dẫn dịch truyện',
    url: 'https://youtu.be/jawxmA0Iyfk?si=dHkRVQXAV58JLl-o',
    enabled: true,
    icon: 'book',
  },
  {
    id: 'google-ai-studio',
    label: 'Mở Google AI Studio',
    url: 'https://aistudio.google.com/app/apikey',
    enabled: true,
    icon: 'external',
  },
];

function freezeConfig(config) {
  config.items.forEach(Object.freeze);
  Object.freeze(config.items);
  return Object.freeze(config);
}

export const DEFAULT_SETUP_GUIDES = freezeConfig({
  key: SETUP_GUIDES_KEY,
  revision: 1,
  items: DEFAULT_ITEMS.map((item) => ({ ...item })),
});

export const DEFAULT_PUBLIC_SETUP_GUIDES = freezeConfig({
  revision: 1,
  items: DEFAULT_ITEMS.map(({ enabled: _enabled, ...item }) => item),
});

export class SetupGuideValidationError extends Error {
  constructor(message, code = 'SETUP_GUIDES_INVALID') {
    super(message);
    this.name = 'SetupGuideValidationError';
    this.code = code;
  }
}

function cloneDefaultConfig(revision = DEFAULT_SETUP_GUIDES.revision) {
  return {
    key: SETUP_GUIDES_KEY,
    revision,
    items: DEFAULT_SETUP_GUIDES.items.map((item) => ({ ...item })),
  };
}

function normalizeRevision(value, { strict = false } = {}) {
  const revision = Number(value);
  if (Number.isInteger(revision) && revision >= 1) return revision;
  if (strict) throw new SetupGuideValidationError('Revision của danh sách hướng dẫn không hợp lệ.');
  return null;
}

export function isExternalSetupGuideUrl(value) {
  return /^https:\/\//iu.test(String(value || '').trim());
}

export function isSafeSetupGuideUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > SETUP_GUIDE_URL_MAX_LENGTH) return false;
  if (FORBIDDEN_TEXT_PATTERN.test(raw) || raw.includes('\\')) return false;

  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) return false;
    try {
      const parsed = new URL(raw, 'https://storyforge.local');
      return parsed.origin === 'https://storyforge.local'
        && parsed.username === ''
        && parsed.password === '';
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function validateItem(input, index, { publicItem = false, allowUnknown = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SetupGuideValidationError(`Nút hướng dẫn số ${index + 1} không hợp lệ.`);
  }

  if (!publicItem && !allowUnknown) {
    const unknownField = Object.keys(input).find((field) => !ITEM_FIELDS.has(field));
    if (unknownField) {
      throw new SetupGuideValidationError(`Nút hướng dẫn có field không hợp lệ: ${unknownField}.`);
    }
  }

  const id = String(input.id ?? '').trim();
  const label = String(input.label ?? '').trim();
  const url = String(input.url ?? '').trim();
  const icon = String(input.icon ?? '').trim().toLowerCase();

  if (!ID_PATTERN.test(id)) {
    throw new SetupGuideValidationError(`ID của nút hướng dẫn số ${index + 1} không hợp lệ.`);
  }
  if (!label || label.length > SETUP_GUIDE_LABEL_MAX_LENGTH) {
    throw new SetupGuideValidationError(`Nhãn nút phải có từ 1 đến ${SETUP_GUIDE_LABEL_MAX_LENGTH} ký tự.`);
  }
  if (FORBIDDEN_TEXT_PATTERN.test(label)) {
    throw new SetupGuideValidationError('Nhãn nút không được chứa HTML hoặc ký tự điều khiển.');
  }
  if (!isSafeSetupGuideUrl(url)) {
    throw new SetupGuideValidationError(`URL của nút hướng dẫn số ${index + 1} không an toàn.`);
  }
  if (!SETUP_GUIDE_ICONS.includes(icon)) {
    throw new SetupGuideValidationError(`Icon của nút hướng dẫn số ${index + 1} không hợp lệ.`);
  }
  if (!publicItem && typeof input.enabled !== 'boolean') {
    throw new SetupGuideValidationError(`Trạng thái bật/tắt của nút hướng dẫn số ${index + 1} không hợp lệ.`);
  }

  return {
    id,
    label,
    url,
    ...(!publicItem ? { enabled: input.enabled } : {}),
    icon,
  };
}

function validateItems(items, options = {}) {
  if (!Array.isArray(items)) {
    throw new SetupGuideValidationError('Danh sách nút hướng dẫn phải là một mảng.');
  }
  if (items.length > SETUP_GUIDES_MAX_ITEMS) {
    throw new SetupGuideValidationError(`Chỉ được cấu hình tối đa ${SETUP_GUIDES_MAX_ITEMS} nút hướng dẫn.`);
  }
  const normalized = items.map((item, index) => validateItem(item, index, options));
  const seen = new Set();
  for (const item of normalized) {
    if (seen.has(item.id)) throw new SetupGuideValidationError(`ID nút hướng dẫn bị trùng: ${item.id}.`);
    seen.add(item.id);
  }
  return normalized;
}

export function validateSetupGuideConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SetupGuideValidationError('Cấu hình hướng dẫn không hợp lệ.');
  }
  const unknownField = Object.keys(input).find((field) => !CONFIG_FIELDS.has(field));
  if (unknownField) {
    throw new SetupGuideValidationError(`Cấu hình hướng dẫn có field không hợp lệ: ${unknownField}.`);
  }
  const revision = normalizeRevision(input.revision ?? input.expectedRevision, { strict: true });
  return {
    key: SETUP_GUIDES_KEY,
    revision,
    items: validateItems(input.items),
  };
}

export function normalizeSetupGuideConfig(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!source) return cloneDefaultConfig();
  const value = source.value_json && typeof source.value_json === 'object' && !Array.isArray(source.value_json)
    ? source.value_json
    : source;
  const revision = normalizeRevision(source.revision ?? value.revision);
  if (!revision) return cloneDefaultConfig();
  if (!Array.isArray(value.items)) return cloneDefaultConfig(revision);
  try {
    return { key: SETUP_GUIDES_KEY, revision, items: validateItems(value.items, { allowUnknown: true }) };
  } catch {
    return cloneDefaultConfig(revision);
  }
}

export function normalizePublicSetupGuideConfig(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const revision = source ? normalizeRevision(source.revision) : null;
  if (!source || !revision || !Array.isArray(source.items)) {
    return {
      revision: DEFAULT_PUBLIC_SETUP_GUIDES.revision,
      items: DEFAULT_PUBLIC_SETUP_GUIDES.items.map((item) => ({ ...item })),
    };
  }
  try {
    return { revision, items: validateItems(source.items, { publicItem: true }) };
  } catch {
    return {
      revision: DEFAULT_PUBLIC_SETUP_GUIDES.revision,
      items: DEFAULT_PUBLIC_SETUP_GUIDES.items.map((item) => ({ ...item })),
    };
  }
}

export function toPublicSetupGuideConfig(row = null) {
  const config = normalizeSetupGuideConfig(row);
  return {
    revision: config.revision,
    items: config.items
      .filter((item) => item.enabled)
      .map(({ enabled: _enabled, ...item }) => ({ ...item })),
  };
}


