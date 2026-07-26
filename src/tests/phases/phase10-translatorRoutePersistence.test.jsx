import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const accessMock = vi.hoisted(() => ({
  current: null,
}));
const accessTokenMock = vi.hoisted(() => ({
  current: 'story-token',
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../hooks/useUserAccess.js', () => ({
  useUserAccess: () => accessMock.current,
}));

vi.mock('../../services/access/accessClient.js', () => ({
  getCachedAccessToken: () => accessTokenMock.current,
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
    accessTokenMock.current = 'story-token';
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
      refreshAccess: vi.fn(async () => {
        accessTokenMock.current = 'fresh-story-token';
        return {
          authenticated: true,
          features: {
            'translator.access': { allowed: true },
            'content.adult_mode': { allowed: false, reason: 'ADULT_TERMS_REQUIRED' },
          },
        };
      }),
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

  it('does not create the translator iframe until the first authorized visit', async () => {
    const AppLayout = await loadAppLayout();
    const router = createMemoryRouter([
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <div>Dashboard</div> },
          { path: '/translator', element: <div>Translator</div> },
          { path: '/settings', element: <div>Settings</div> },
        ],
      },
    ], {
      initialEntries: ['/'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    expect(container.querySelector('iframe[title="StoryForge Translator"]')).toBeNull();

    await act(async () => {
      await router.navigate('/translator');
    });

    const iframe = container.querySelector('iframe[title="StoryForge Translator"]');
    expect(iframe).not.toBeNull();

    await act(async () => {
      await router.navigate('/settings');
    });

    expect(container.querySelector('iframe[title="StoryForge Translator"]')).toBe(iframe);
  });

  it('does not create the translator iframe for an unauthorized visit', async () => {
    accessMock.current = {
      ...accessMock.current,
      hasFeature: () => false,
      getDecision: () => ({ allowed: false, reason: 'AUTH_REQUIRED' }),
      getDeniedMessage: () => 'Bạn cần đăng nhập để dùng Translator.',
    };
    const AppLayout = await loadAppLayout();
    const router = createMemoryRouter([
      {
        element: <AppLayout />,
        children: [
          { path: '/translator', element: <div>Translator</div> },
        ],
      },
    ], {
      initialEntries: ['/translator'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    expect(container.querySelector('iframe[title="StoryForge Translator"]')).toBeNull();
    expect(container.textContent).toContain('Quyền truy cập');
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

  it('waits for the iframe readiness handshake before sending access context', async () => {
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
      iframe.dispatchEvent(new Event('load'));
    });

    expect(postMessageSpy.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload?.type === 'STORYFORGE_ACCESS_CONTEXT')).toBeUndefined();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_TRANSLATOR_READY',
        },
      }));
    });

    const contextMessage = postMessageSpy.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload?.type === 'STORYFORGE_ACCESS_CONTEXT');
    expect(contextMessage).toMatchObject({
      type: 'STORYFORGE_ACCESS_CONTEXT',
      token: 'story-token',
      access: accessMock.current.access,
    });
    expect(contextMessage.access).not.toHaveProperty('nativeEvent');
  });

  it('sends the current theme after readiness and whenever the theme changes', async () => {
    const { default: useUIStore } = await import('../../stores/uiStore.js');
    useUIStore.getState().setTheme('cream');
    const module = await import('../../components/translator/PersistentTranslatorHost.jsx');
    const PersistentTranslatorHost = module.default;

    root = createRoot(container);
    await act(async () => {
      root.render(<PersistentTranslatorHost active />);
    });

    const iframe = container.querySelector('iframe[title="StoryForge Translator"]');
    const postMessageSpy = vi.spyOn(iframe.contentWindow, 'postMessage');

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_TRANSLATOR_READY',
        },
      }));
    });

    expect(postMessageSpy.mock.calls.map(([payload]) => payload)).toContainEqual({
      type: 'STORYFORGE_THEME_CONTEXT',
      theme: 'cream',
    });

    await act(async () => {
      useUIStore.getState().setTheme('light');
    });

    expect(postMessageSpy.mock.calls.map(([payload]) => payload)).toContainEqual({
      type: 'STORYFORGE_THEME_CONTEXT',
      theme: 'light',
    });
  });

  it('accepts only validated translator status messages from its own iframe', async () => {
    const module = await import('../../components/translator/PersistentTranslatorHost.jsx');
    const PersistentTranslatorHost = module.default;
    const onStatusChange = vi.fn();

    root = createRoot(container);
    await act(async () => {
      root.render(<PersistentTranslatorHost active onStatusChange={onStatusChange} />);
    });

    const iframe = container.querySelector('iframe[title="StoryForge Translator"]');
    expect(iframe).not.toBeNull();
    onStatusChange.mockClear();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_TRANSLATOR_STATUS',
          state: 'running',
          completed: 3,
          total: 10,
          sessionId: 'session-safe',
        },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_TRANSLATOR_STATUS',
          state: 'unknown-state',
          completed: -4,
          total: 'secret',
          sessionId: { unsafe: true },
        },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://attacker.example',
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_TRANSLATOR_STATUS',
          state: 'completed',
          completed: 10,
          total: 10,
          sessionId: 'forged',
        },
      }));
    });

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith({
      state: 'running',
      completed: 3,
      total: 10,
      sessionId: 'session-safe',
    });
  });

  it('refreshes and returns a new access context when the translator iframe requests it', async () => {
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
          type: 'STORYFORGE_REFRESH_ACCESS_CONTEXT',
          requestId: 'refresh-request-1',
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(accessMock.current.refreshAccess).toHaveBeenCalledWith({ silent: true });
    const resultMessage = postMessageSpy.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload?.type === 'STORYFORGE_ACCESS_REFRESH_RESULT');
    expect(resultMessage).toMatchObject({
      type: 'STORYFORGE_ACCESS_REFRESH_RESULT',
      requestId: 'refresh-request-1',
      ok: true,
      token: 'fresh-story-token',
      access: {
        features: {
          'translator.access': { allowed: true },
        },
      },
    });
  });

  it('never returns a cached token after translator access is revoked', async () => {
    accessMock.current.refreshAccess = vi.fn(async () => ({
      authenticated: true,
      features: {
        'translator.access': { allowed: false, reason: 'FEATURE_DISABLED' },
      },
    }));
    accessTokenMock.current = 'token-that-must-not-reach-translator';
    const module = await import('../../components/translator/PersistentTranslatorHost.jsx');
    const PersistentTranslatorHost = module.default;

    root = createRoot(container);
    await act(async () => {
      root.render(<PersistentTranslatorHost active />);
    });

    const iframe = container.querySelector('iframe[title="StoryForge Translator"]');
    const postMessageSpy = vi.spyOn(iframe.contentWindow, 'postMessage');

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        source: iframe.contentWindow,
        data: {
          type: 'STORYFORGE_REFRESH_ACCESS_CONTEXT',
          requestId: 'refresh-revoked-1',
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const resultMessage = postMessageSpy.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload?.type === 'STORYFORGE_ACCESS_REFRESH_RESULT');
    expect(resultMessage).toMatchObject({
      type: 'STORYFORGE_ACCESS_REFRESH_RESULT',
      requestId: 'refresh-revoked-1',
      ok: true,
      token: '',
      access: {
        features: {
          'translator.access': { allowed: false },
        },
      },
    });
  });
});
