import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let projectState;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => true,
}));

vi.mock('../../pages/Dashboard/NewProjectModal', () => ({
  default: () => null,
}));

vi.mock('../../components/common/ExportModal', () => ({
  default: () => null,
}));

vi.mock('../../components/mobile/MobileSheet', () => ({
  default: () => null,
}));

vi.mock('../../components/support/SupportDonateModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../../components/storyBundle/StoryBundleModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../../services/projectCovers/coverRepository.js', () => ({
  getActiveProjectCoversForProjects: vi.fn(async () => ({})),
}));

describe('phase10 dashboard mobile theme picker', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
    projectState = {
      projects: [],
      loadProjects: vi.fn(),
      loadProject: vi.fn(),
      deleteProject: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('shows all themes on the mobile home and applies the selected interface immediately', async () => {
    const { default: Dashboard } = await import('../../pages/Dashboard/Dashboard.jsx');
    const router = createMemoryRouter([
      { path: '/', element: <Dashboard /> },
    ], {
      initialEntries: ['/'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const mobileThemeSection = container.querySelector('.dashboard-mobile-theme');
    expect(mobileThemeSection).not.toBeNull();
    expect(mobileThemeSection.textContent).toContain('Đổi giao diện');

    const themeChoices = [...mobileThemeSection.querySelectorAll('[role="radio"]')];
    expect(themeChoices).toHaveLength(3);

    const creamChoice = themeChoices.find((choice) => choice.textContent.includes('Giấy Kem Mềm'));
    await act(async () => creamChoice.click());

    expect(creamChoice.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('cream');
    expect(localStorage.getItem('sf-theme')).toBe('cream');
  });
});
