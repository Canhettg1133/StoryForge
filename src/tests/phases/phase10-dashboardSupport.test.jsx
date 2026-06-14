import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_CONTACT } from '../../config/supportContact.js';

let projectState;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../pages/Dashboard/NewProjectModal', () => ({
  default: () => null,
}));

vi.mock('../../components/common/ExportModal', () => ({
  default: () => null,
}));

vi.mock('../../components/mobile/MobileSheet', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

async function loadDashboard() {
  vi.resetModules();
  const module = await import('../../pages/Dashboard/Dashboard.jsx');
  return module.default;
}

describe('phase10 dashboard support actions', () => {
  let container;
  let root;

  beforeEach(() => {
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
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  async function renderDashboard() {
    const Dashboard = await loadDashboard();
    const router = createMemoryRouter([
      { path: '/', element: <Dashboard /> },
    ], {
      initialEntries: ['/'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
  }

  it('places a donate button under the dashboard quick tools and opens the shared donate modal', async () => {
    await renderDashboard();

    const tools = container.querySelector('.dashboard-tools');
    const supportButton = tools?.querySelector('.dashboard-support-button');
    expect(supportButton).not.toBeNull();
    expect(supportButton.textContent).toContain('Ủng hộ dự án');
    expect(container.textContent).not.toContain('Thông tin ủng hộ dự án');

    await act(async () => {
      supportButton.click();
    });

    expect(container.textContent).toContain('Thông tin ủng hộ dự án');
    expect(container.textContent).toContain(SUPPORT_CONTACT.donate.bankName);
    expect(container.textContent).toContain(SUPPORT_CONTACT.donate.accountNumber);
    expect(container.textContent).toContain(SUPPORT_CONTACT.donate.accountHolder);

    const qrImage = container.querySelector('img[alt="QR ủng hộ StoryForge"]');
    expect(qrImage?.getAttribute('src')).toBe(SUPPORT_CONTACT.donate.qrImageUrl);

    const backButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quay về'));
    expect(backButton).toBeDefined();

    await act(async () => {
      backButton.click();
    });

    expect(container.textContent).not.toContain('Thông tin ủng hộ dự án');
  });
});
