import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => true,
}));

vi.mock('../../pages/Settings/CloudSyncSection', () => ({
  default: () => null,
  CloudSyncWorkspace: () => null,
}));

async function loadCloudSyncPage() {
  vi.resetModules();
  const module = await import('../../pages/CloudSync/CloudSyncPage.jsx');
  return module.default;
}

describe('phase10 cloud sync back navigation', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it('returns from standalone mobile cloud sync to the dashboard instead of settings', async () => {
    const CloudSyncPage = await loadCloudSyncPage();
    const router = createMemoryRouter([
      { path: '/', element: <div>Dashboard</div> },
      { path: '/settings', element: <div>Settings</div> },
      { path: '/cloud-sync', element: <CloudSyncPage /> },
    ], {
      initialEntries: ['/', '/cloud-sync'],
      initialIndex: 1,
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const backButton = container.querySelector('.cloud-sync-page__mobile-back button');
    expect(backButton).not.toBeNull();

    await act(async () => {
      backButton.click();
    });

    expect(router.state.location.pathname).toBe('/');
  });

  it('replaces cloud sync in history when returning to settings', async () => {
    const CloudSyncPage = await loadCloudSyncPage();
    const router = createMemoryRouter([
      { path: '/settings', element: <div>Settings</div> },
      { path: '/cloud-sync', element: <CloudSyncPage /> },
    ], {
      initialEntries: [
        '/settings',
        { pathname: '/cloud-sync', state: { returnTo: '/settings' } },
      ],
      initialIndex: 1,
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const backButton = container.querySelector('.cloud-sync-page__mobile-back button');
    expect(backButton).not.toBeNull();

    await act(async () => {
      backButton.click();
    });

    expect(router.state.location.pathname).toBe('/settings');

    await act(async () => {
      await router.navigate(-1);
    });

    expect(router.state.location.pathname).toBe('/settings');
  });
});
