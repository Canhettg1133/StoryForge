import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_CONTACT } from '../../config/supportContact.js';

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

  it('shows support actions and opens the donate modal only after the user clicks donate', async () => {
    await renderLogin();

    expect(container.textContent).toContain('Hỗ trợ & cộng đồng');
    expect(container.textContent).not.toContain('Thông tin ủng hộ dự án');

    const donateButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Ủng hộ dự án'));
    expect(donateButton).toBeDefined();

    const discordLink = Array.from(container.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Vào Discord'));
    const adminLink = Array.from(container.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Nhắn admin'));

    expect(discordLink?.getAttribute('href')).toBe(SUPPORT_CONTACT.discordUrl);
    expect(adminLink?.getAttribute('href')).toBe(SUPPORT_CONTACT.adminMessageUrl);

    await act(async () => {
      donateButton.click();
    });

    expect(container.textContent).toContain('Thông tin ủng hộ dự án');
    expect(container.textContent).toContain(SUPPORT_CONTACT.donate.bankName);
    expect(container.textContent).toContain(SUPPORT_CONTACT.donate.accountNumber);
    expect(container.textContent).toContain(SUPPORT_CONTACT.donate.accountHolder);

    const closeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Đóng thông tin ủng hộ');
    expect(closeButton).toBeDefined();

    await act(async () => {
      closeButton.click();
    });

    expect(container.textContent).not.toContain('Thông tin ủng hộ dự án');
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
