import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fallbackAnnouncement = {
  key: 'site_announcement',
  enabled: true,
  revision: 1,
  title: 'Thông báo hệ thống',
  body: 'Nếu StoryForge hiện tại gặp lỗi, hãy dùng bản dự phòng.',
  primaryActionLabel: 'Mở bản dự phòng',
  primaryActionUrl: 'https://story-forge-kohl.vercel.app/',
};

async function loadSiteAnnouncementCenter() {
  vi.resetModules();
  return (await import('../../components/siteAnnouncement/SiteAnnouncementCenter.jsx')).default;
}

async function loadNotificationsPage() {
  vi.resetModules();
  return (await import('../../pages/Notifications/Notifications.jsx')).default;
}

function okFetch(announcement = fallbackAnnouncement) {
  return vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    source: 'database',
    announcement,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }));
}

describe('phase14 site announcement UI', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  async function renderCenter(fetchMock = okFetch(), initialPath = '/') {
    vi.stubGlobal('fetch', fetchMock);
    const SiteAnnouncementCenter = await loadSiteAnnouncementCenter();
    const router = createMemoryRouter([
      { path: '/', element: <SiteAnnouncementCenter /> },
      { path: '/project/:projectId/editor', element: <SiteAnnouncementCenter /> },
    ], {
      initialEntries: [initialPath],
    });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <RouterProvider router={router} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    return fetchMock;
  }

  it('auto-opens once per announcement revision and stays dismissed after remount', async () => {
    const fetchMock = await renderCenter();

    expect(fetchMock).toHaveBeenCalledWith('/api/site-announcement', expect.objectContaining({ cache: 'no-store' }));
    expect(container.textContent).toContain('Thông báo hệ thống');
    expect(container.textContent).toContain('Tiếp tục vào web');
    expect(container.textContent).not.toContain('Xem trang thông báo');

    const dismissButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Tiếp tục vào web'));
    expect(dismissButton).toBeDefined();

    await act(async () => {
      dismissButton.click();
    });

    expect(container.textContent).not.toContain('Tiếp tục vào web');
    expect(localStorage.getItem('sf-site-announcement-dismissed-v1')).toBe('site_announcement:1');

    await act(async () => {
      root.unmount();
    });
    root = null;
    container.innerHTML = '';

    await renderCenter(okFetch({ ...fallbackAnnouncement, revision: 1 }));
    expect(container.textContent).not.toContain('Tiếp tục vào web');
    expect(container.textContent).toContain('Thông báo');

    await act(async () => {
      root.unmount();
    });
    root = null;
    container.innerHTML = '';

    await renderCenter(okFetch({ ...fallbackAnnouncement, revision: 2, body: 'Nội dung mới.' }));
    expect(container.textContent).toContain('Nội dung mới.');
    expect(container.textContent).toContain('Tiếp tục vào web');
  });

  it('lets the bell reopen a dismissed announcement without clearing dismissed state', async () => {
    await renderCenter();

    const dismissButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Tiếp tục vào web'));
    await act(async () => {
      dismissButton.click();
    });

    const bellButton = container.querySelector('[aria-label="Mở thông báo hệ thống"]');
    expect(bellButton).not.toBeNull();

    await act(async () => {
      bellButton.click();
    });

    expect(container.textContent).toContain('Mở bản dự phòng');
    expect(container.textContent).not.toContain('Xem trang thông báo');
    expect(localStorage.getItem('sf-site-announcement-dismissed-v1')).toBe('site_announcement:1');
  });

  it('uses cached announcement content when the API request fails', async () => {
    localStorage.setItem('sf-site-announcement-cache-v1', JSON.stringify({
      ...fallbackAnnouncement,
      revision: 5,
      title: 'Thông báo từ cache',
      body: 'Nội dung cache vẫn dùng được.',
    }));

    await renderCenter(vi.fn(async () => {
      throw new Error('NETWORK_DOWN');
    }));

    expect(container.textContent).toContain('Thông báo từ cache');
    expect(container.textContent).toContain('Nội dung cache vẫn dùng được.');
  });

  it('falls back to default content when API and cache both fail', async () => {
    localStorage.setItem('sf-site-announcement-cache-v1', '{not-json');

    await renderCenter(vi.fn(async () => {
      throw new Error('NETWORK_DOWN');
    }));

    expect(container.textContent).toContain('Thông báo hệ thống');
    expect(container.textContent).toContain('story-forge-kohl.vercel.app');
  });

  it('does not render the launcher when the announcement is disabled', async () => {
    await renderCenter(okFetch({ ...fallbackAnnouncement, enabled: false }));

    expect(container.querySelector('[aria-label="Mở thông báo hệ thống"]')).toBeNull();
    expect(container.textContent).not.toContain('Tiếp tục vào web');
  });

  it('only fetches and renders the announcement center on the home page', async () => {
    const fetchMock = await renderCenter(okFetch(), '/project/project-1/editor');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Mở thông báo hệ thống"]')).toBeNull();
    expect(container.textContent).not.toContain('Tiếp tục vào web');
  });
});

describe('phase14 notifications route', () => {
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderPage(announcement) {
    vi.stubGlobal('fetch', okFetch(announcement));
    const Notifications = await loadNotificationsPage();
    const router = createMemoryRouter([
      { path: '/', element: <div>Trang chủ</div> },
      { path: '/thong-bao', element: <Notifications /> },
    ], {
      initialEntries: ['/thong-bao'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it('shows the current announcement on /thong-bao when enabled', async () => {
    await renderPage({
      ...fallbackAnnouncement,
      revision: 8,
      title: 'Thông báo chính thức',
      body: 'Nội dung hiển thị ở trang thông báo.',
    });

    expect(container.textContent).toContain('Thông báo chính thức');
    expect(container.textContent).toContain('Nội dung hiển thị ở trang thông báo.');
    expect(container.textContent).toContain('Phiên bản 8');
    expect(container.textContent).toContain('Quay về');
  });

  it('shows an empty state on /thong-bao when disabled', async () => {
    await renderPage({ ...fallbackAnnouncement, enabled: false });

    expect(container.textContent).toContain('Hiện chưa có thông báo mới.');
    expect(container.textContent).not.toContain('Mở bản dự phòng');
  });

  it('has a safe back action on /thong-bao for mobile users', async () => {
    await renderPage(fallbackAnnouncement);

    const backButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quay về'));
    expect(backButton).toBeDefined();

    await act(async () => {
      backButton.click();
    });

    expect(container.textContent).toContain('Trang chủ');
  });
});
