import { create } from 'zustand';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sf-sidebar-collapsed';
const CONTENT_FONT_SIZE_STORAGE_KEY = 'sf-content-font-size';

export const CONTENT_FONT_SIZE_MIN = 5;
export const CONTENT_FONT_SIZE_MAX = 22;
export const DEFAULT_CONTENT_FONT_SIZE = 18;

function readSidebarCollapsedPreference() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

function persistSidebarCollapsedPreference(value) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? 'true' : 'false');
}

export function normalizeContentFontSize(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(CONTENT_FONT_SIZE_MIN, Math.min(CONTENT_FONT_SIZE_MAX, parsed));
}

function readContentFontSizePreference() {
  if (typeof window === 'undefined') return null;
  return normalizeContentFontSize(localStorage.getItem(CONTENT_FONT_SIZE_STORAGE_KEY));
}

function persistContentFontSizePreference(value) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeContentFontSize(value);
  if (normalized === null) {
    localStorage.removeItem(CONTENT_FONT_SIZE_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CONTENT_FONT_SIZE_STORAGE_KEY, String(normalized));
}

const useUIStore = create((set, get) => ({
  theme: localStorage.getItem('sf-theme') || 'dark',
  sidebarCollapsed: readSidebarCollapsedPreference(),
  contentFontSize: readContentFontSizePreference(),
  rightPanelOpen: false,
  activePage: 'dashboard',

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sf-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  toggleSidebar: () => set((s) => {
    const next = !s.sidebarCollapsed;
    persistSidebarCollapsedPreference(next);
    return { sidebarCollapsed: next };
  }),
  setSidebarCollapsed: (v) => {
    persistSidebarCollapsedPreference(v);
    set({ sidebarCollapsed: v });
  },

  setContentFontSize: (value) => {
    const normalized = normalizeContentFontSize(value);
    persistContentFontSizePreference(normalized);
    set({ contentFontSize: normalized });
  },
  resetContentFontSize: () => {
    persistContentFontSizePreference(null);
    set({ contentFontSize: null });
  },

  toggleRightPanel: () => set(s => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelOpen: (v) => set({ rightPanelOpen: v }),

  setActivePage: (page) => set({ activePage: page }),

  // Initialize theme on app load
  initTheme: () => {
    const theme = localStorage.getItem('sf-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
}));

export default useUIStore;
