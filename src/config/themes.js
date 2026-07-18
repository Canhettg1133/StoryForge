export const THEME_STORAGE_KEY = 'sf-theme';
export const DEFAULT_THEME = 'dark';
const LEGACY_WRITING_THEME_STORAGE_KEY = 'sf-content-background';

export const THEMES = Object.freeze([
  {
    id: 'dark',
    label: 'Tối',
    shortLabel: 'Tối',
    description: 'Tương phản cao, phù hợp viết ban đêm',
    swatches: ['#0a0e1a', '#1a2340', '#8b5cf6'],
    family: 'dark',
    group: 'base',
  },
  {
    id: 'light',
    label: 'Sáng',
    shortLabel: 'Sáng',
    description: 'Sạch và trung tính',
    swatches: ['#f8fafc', '#ffffff', '#8b5cf6'],
    family: 'light',
    group: 'base',
  },
  {
    id: 'cream',
    label: 'Giấy Kem Mềm',
    shortLabel: 'Giấy Kem',
    description: 'Tông giấy ấm, dịu mắt khi đọc và viết lâu',
    swatches: ['#f7f5f0', '#fffaf2', '#a94b08'],
    family: 'paper',
    group: 'base',
  },
  {
    id: 'soft-cream',
    label: 'Kem Dịu',
    shortLabel: 'Kem Dịu',
    description: 'Be trầm, giảm độ chói trên màn hình sáng',
    swatches: ['#ebe5dc', '#f5eee2', '#98502a'],
    family: 'paper',
    group: 'reading',
  },
  {
    id: 'sepia',
    label: 'Sepia',
    shortLabel: 'Sepia',
    description: 'Sắc giấy cũ ấm, hợp đọc và viết dài',
    swatches: ['#ded2bd', '#f0e3cb', '#96532a'],
    family: 'paper',
    group: 'reading',
  },
  {
    id: 'sage-paper',
    label: 'Xanh Giấy',
    shortLabel: 'Xanh Giấy',
    description: 'Xanh xám nhẹ, êm mắt trong ánh sáng ban ngày',
    swatches: ['#dbe3d8', '#edf1e9', '#965735'],
    family: 'paper',
    group: 'reading',
  },
  {
    id: 'mist',
    label: 'Xám Sương',
    shortLabel: 'Xám Sương',
    description: 'Xám trung tính, ít ám màu và dễ tập trung',
    swatches: ['#dde2e5', '#f0f2f3', '#99563a'],
    family: 'paper',
    group: 'reading',
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
    const legacyTheme = storage.getItem(LEGACY_WRITING_THEME_STORAGE_KEY);
    if (legacyTheme && legacyTheme !== 'classic' && THEME_ID_SET.has(legacyTheme)) {
      storage.setItem(THEME_STORAGE_KEY, legacyTheme);
      storage.removeItem(LEGACY_WRITING_THEME_STORAGE_KEY);
      return legacyTheme;
    }
    if (legacyTheme) storage.removeItem(LEGACY_WRITING_THEME_STORAGE_KEY);

    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function persistTheme(value, storage = globalThis.localStorage) {
  const theme = normalizeTheme(value);
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
    storage?.removeItem(LEGACY_WRITING_THEME_STORAGE_KEY);
  } catch {
    // Theme still applies for the current session when storage is unavailable.
  }
  return theme;
}

export function applyDocumentTheme(value, root = globalThis.document?.documentElement) {
  const theme = normalizeTheme(value);
  const definition = getThemeDefinition(theme);
  root?.setAttribute('data-theme', theme);
  root?.setAttribute('data-theme-family', definition.family);
  return theme;
}

export function getThemeDefinition(value) {
  const theme = normalizeTheme(value);
  return THEMES.find((item) => item.id === theme) || THEMES[0];
}
