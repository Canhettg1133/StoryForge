import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.hoisted(() => ({
  current: null,
}));
const cloudAuthMock = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

vi.mock('../../hooks/useUserAccess.js', () => ({
  useUserAccess: () => accessMock.current,
}));

vi.mock('../../services/cloud/cloudAuthService.js', async () => {
  const actual = await vi.importActual('../../services/cloud/cloudAuthService.js');
  return {
    ...actual,
    isCloudAuthConfigured: () => true,
    signInWithGoogle: cloudAuthMock.signInWithGoogle,
    signOut: cloudAuthMock.signOut,
  };
});

async function loadLogin() {
  vi.resetModules();
  const module = await import('../../pages/Login/Login.jsx');
  return module.default;
}

async function loadAccountAccessSummary() {
  vi.resetModules();
  const module = await import('../../components/access/AccountAccessSummary.jsx');
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

  it('lets a signed-in user log out from the account page without implying local data deletion', async () => {
    await renderLogin();

    const logoutButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Đăng xuất'));
    expect(logoutButton).toBeDefined();

    await act(async () => {
      logoutButton.click();
    });

    expect(cloudAuthMock.signOut).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Đã đăng xuất. Dữ liệu local vẫn được giữ trên máy này.');
  });

  it('also exposes logout inside Settings account access summary', async () => {
    const AccountAccessSummary = await loadAccountAccessSummary();
    const router = createMemoryRouter([
      { path: '/settings', element: <AccountAccessSummary /> },
      { path: '/login', element: <div>Trang tài khoản</div> },
    ], {
      initialEntries: ['/settings'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const logoutButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Đăng xuất'));
    expect(logoutButton).toBeDefined();

    await act(async () => {
      logoutButton.click();
    });

    expect(cloudAuthMock.signOut).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Đã đăng xuất. Dữ liệu local vẫn được giữ trên máy này.');

    accessMock.current = {
      access: { authenticated: false, features: {} },
      loading: false,
    };
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    expect(container.textContent).toContain('Đã đăng xuất. Dữ liệu local vẫn được giữ trên máy này.');
  });
});
