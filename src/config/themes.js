export const THEME_STORAGE_KEY = 'sf-theme';
export const DEFAULT_THEME = 'dark';

export const THEMES = Object.freeze([
  {
    id: 'dark',
    label: 'Tối',
    shortLabel: 'Tối',
    description: 'Tương phản cao, phù hợp viết ban đêm',
    swatches: ['#0a0e1a', '#1a2340', '#8b5cf6'],
  },
  {
    id: 'light',
    label: 'Sáng',
    shortLabel: 'Sáng',
    description: 'Sạch và trung tính',
    swatches: ['#f8fafc', '#ffffff', '#8b5cf6'],
  },
  {
    id: 'cream',
    label: 'Giấy Kem Mềm',
    shortLabel: 'Giấy Kem',
    description: 'Tông giấy ấm, dịu mắt khi đọc và viết lâu',
    swatches: ['#f7f5f0', '#fffaf2', '#a94b08'],
  },
]);

export const THEME_IDS = Object.freeze(THEMES.map((theme) => theme.id));

const THEME_ID_SET = new Set(THEME_IDS);

export function normalizeTheme(value) {
  return THEME_ID_SET.has(value) ? value : DEFAULT_THEME;
}

export function readStoredTheme(storage = globalThis.localStorage) {
  if (!storage) return DEFAULT_THEME;
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function persistTheme(value, storage = globalThis.localStorage) {
  const theme = normalizeTheme(value);
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme still applies for the current session when storage is unavailable.
  }
  return theme;
}

export function applyDocumentTheme(value, root = globalThis.document?.documentElement) {
  const theme = normalizeTheme(value);
  root?.setAttribute('data-theme', theme);
  return theme;
}

export function getThemeDefinition(value) {
  const theme = normalizeTheme(value);
  return THEMES.find((item) => item.id === theme) || THEMES[0];
}
