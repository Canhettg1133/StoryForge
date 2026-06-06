import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const accessMock = vi.hoisted(() => ({
  current: null,
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../hooks/useUserAccess.js', () => ({
  useUserAccess: () => accessMock.current,
}));

vi.mock('../../services/access/accessClient.js', () => ({
  getCachedAccessToken: () => 'story-token',
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
    accessMock.current = {
      access: {
        authenticated: true,
        features: {
          'translator.access': { allowed: true },
          'content.adult_mode': { allowed: false, reason: 'ADULT_TERMS_REQUIRED' },
        },
      },
      hasFeature: (featureKey) => featureKey === 'translator.access',
      confirmAdultTerms: vi.fn(async () => ({
        authenticated: true,
        features: {
          'translator.access': { allowed: true },
          'content.adult_mode': { allowed: true },
        },
      })),
    };
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

  it('lets the translator iframe request the 18+ consent modal and receives the confirmed access snapshot', async () => {
    const module = await import('../../components/translator/PersistentTranslatorHost.jsx');
    const PersistentTranslatorHost = module.default;

    root = createRoot(container);
    await act(async () => {
      root.render(<PersistentTranslatorHost active />);
    });

    const iframe = container.querySelector('iframe[title="StoryForge Translator"]');
    expect(iframe).not.toBeNull();
    const postMessageSpy = vi.spyOn(iframe.contentWindow, 'postMessage');

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_CONFIRM_ADULT_TERMS',
          requestId: 'adult-request-1',
          templateId: 'sacHiep',
          message: 'Bạn cần đồng ý điều khoản 18+ mới nhất.',
        },
      }));
    });

    expect(container.textContent).toContain('Xác nhận điều khoản 18+');
    expect(container.textContent).toContain('Bạn cần đồng ý điều khoản 18+ mới nhất.');

    const confirmButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Tôi đủ 18 tuổi và đồng ý'));
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton.click();
    });

    expect(accessMock.current.confirmAdultTerms).toHaveBeenCalledTimes(1);
    const resultMessage = postMessageSpy.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload?.type === 'STORYFORGE_ADULT_TERMS_RESULT');
    expect(resultMessage).toMatchObject({
      type: 'STORYFORGE_ADULT_TERMS_RESULT',
      requestId: 'adult-request-1',
      ok: true,
      access: {
        features: {
          'content.adult_mode': { allowed: true },
        },
      },
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
