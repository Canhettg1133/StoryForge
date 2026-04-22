import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../components/common/Sidebar.jsx', () => ({
  default: () => <div data-testid="sidebar" />,
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

describe('phase10 translator route persistence', () => {
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

  it('keeps the translator iframe mounted across SPA route changes', async () => {
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
    expect(iframeBefore?.getAttribute('src')).toContain('/translator-runtime/index.html');

    await act(async () => {
      await router.navigate('/settings');
    });

    const iframeAfter = container.querySelector('iframe[title="StoryForge Translator"]');
    expect(iframeAfter).toBe(iframeBefore);

    await act(async () => {
      await router.navigate('/translator');
    });

    expect(container.querySelector('iframe[title="StoryForge Translator"]')).toBe(iframeBefore);
  });
});
