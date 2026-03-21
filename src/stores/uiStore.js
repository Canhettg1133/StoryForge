import { create } from 'zustand';

const useUIStore = create((set, get) => ({
  theme: localStorage.getItem('sf-theme') || 'dark',
  sidebarCollapsed: false,
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

  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

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
