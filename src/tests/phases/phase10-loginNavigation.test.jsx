import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.hoisted(() => ({
  current: null,
}));

vi.mock('../../hooks/useUserAccess.js', () => ({
  useUserAccess: () => accessMock.current,
}));

vi.mock('../../services/cloud/cloudAuthService.js', async () => {
  const actual = await vi.importActual('../../services/cloud/cloudAuthService.js');
  return {
    ...actual,
    isCloudAuthConfigured: () => true,
    signInWithGoogle: vi.fn(),
  };
});

async function loadLogin() {
  vi.resetModules();
  const module = await import('../../pages/Login/Login.jsx');
  return module.default;
}

function createAuthenticatedAccess() {
  return {
    authenticated: true,
    user: { email: 'vip@example.com' },
    plan: { key: 'vip' },
    features: {
      'translator.access': { allowed: true },
      'content.adult_mode': { allowed: true },
    },
  };
}

describe('phase10 account page navigation', () => {
  let container;
  let root;

  beforeEach(() => {
    accessMock.current = {
      access: createAuthenticatedAccess(),
      loading: false,
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

  async function renderLogin(initialPath = '/login?returnTo=%2Fsettings') {
    const Login = await loadLogin();
    const router = createMemoryRouter([
      { path: '/', element: <div>Trang chủ</div> },
      { path: '/settings', element: <div>Cài đặt</div> },
      { path: '/login', element: <Login /> },
    ], {
      initialEntries: [initialPath],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    return router;
  }

  it('uses the top account back button as a stable home action', async () => {
    const router = await renderLogin();

    const homeButton = container.querySelector('.login-page__back');
    expect(homeButton).not.toBeNull();
    expect(homeButton.textContent).toContain('Về trang chủ');

    await act(async () => {
      homeButton.click();
    });

    expect(router.state.location.pathname).toBe('/');
  });

  it('uses Continue for returnTo and replaces the login page in history', async () => {
    const router = await renderLogin();

    const continueButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Tiếp tục'));
    expect(continueButton).toBeDefined();

    await act(async () => {
      continueButton.click();
    });

    expect(router.state.location.pathname).toBe('/settings');

    await act(async () => {
      await router.navigate(-1);
    });

    expect(router.state.location.pathname).toBe('/settings');
  });
});
