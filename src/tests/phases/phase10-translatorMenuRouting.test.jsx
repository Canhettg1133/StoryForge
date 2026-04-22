import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../components/jobs/JobNotificationToast.jsx', () => ({
  default: () => null,
}));

vi.mock('../../components/jobs/JobQueuePanel.jsx', () => ({
  default: () => null,
}));

vi.mock('../../components/common/StorageWarning.jsx', () => ({
  default: () => null,
}));

vi.mock('../../components/cloud/CloudAutoSyncAgent.jsx', () => ({
  default: () => null,
}));

async function loadAppLayout() {
  vi.resetModules();
  const module = await import('../../components/common/AppLayout.jsx');
  return module.default;
}

describe('phase10 translator menu routing', () => {
  let container;
  let root;

  beforeEach(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
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

  it('returns to translator via SPA navigation instead of a full reload', async () => {
    const AppLayout = await loadAppLayout();
    const router = createMemoryRouter([
      {
        element: <AppLayout />,
        children: [
          { path: '/translator', element: <div>Translator</div> },
          { path: '/settings', element: <div>Settings</div> },
        ],
      },
    ], {
      initialEntries: ['/translator'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const iframeBefore = container.querySelector('iframe[title="StoryForge Translator"]');
    expect(iframeBefore).not.toBeNull();

    const settingsButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Cài đặt'));
    expect(settingsButton).toBeDefined();

    await act(async () => {
      settingsButton.click();
    });
    expect(router.state.location.pathname).toBe('/settings');

    const translatorButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Dịch truyện'));
    expect(translatorButton).toBeDefined();

    await act(async () => {
      translatorButton.click();
    });

    expect(router.state.location.pathname).toBe('/translator');
    expect(container.querySelector('iframe[title="StoryForge Translator"]')).toBe(iframeBefore);
  });
});
