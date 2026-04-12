import { create } from 'zustand';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sf-sidebar-collapsed';

function readSidebarCollapsedPreference() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

function persistSidebarCollapsedPreference(value) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? 'true' : 'false');
}

const useUIStore = create((set, get) => ({
  theme: localStorage.getItem('sf-theme') || 'dark',
  sidebarCollapsed: readSidebarCollapsedPreference(),
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
