import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Sidebar from '../../components/common/Sidebar.jsx';
import MobileNavigationMenu from '../../components/mobile/MobileNavigationMenu.jsx';

let projectState;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/uiStore', () => ({
  default: () => ({
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    theme: 'dark',
  }),
}));

function findButton(container, label) {
  return Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent.includes(label));
}

describe('phase10 project-required navigation guidance', () => {
  let container;
  let root;

  beforeEach(() => {
    projectState = {
      currentProject: null,
      chapters: [],
      activeChapterId: null,
      projects: [],
    };
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('dims desktop project tools without lock icons and explains the group once', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar />
        </MemoryRouter>,
      );
    });

    const charactersButton = findButton(container, 'Nhân vật');
    expect(charactersButton.disabled).toBe(false);
    expect(charactersButton.getAttribute('aria-disabled')).toBe('true');
    expect(charactersButton.classList.contains('sidebar-item--disabled')).toBe(true);
    expect(container.querySelectorAll('.sidebar-item-lock')).toHaveLength(0);
    expect(container.textContent.match(/Tạo một truyện để sử dụng các mục này\./gu)).toHaveLength(1);

    const editorButton = findButton(container, 'Viết truyện');
    expect(editorButton.classList.contains('sidebar-item--primary')).toBe(false);

    await act(async () => charactersButton.click());
    expect(container.textContent).toContain('Mục Nhân vật dùng bên trong một truyện');
    expect(findButton(container, 'Tạo truyện mới')).toBeTruthy();
  });

  it('dims mobile project tools without lock icons and exposes the create action', async () => {
    const onCreateProject = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <MobileNavigationMenu
            activeProjectId={null}
            hasProjects={false}
            onCreateProject={onCreateProject}
          />
        </MemoryRouter>,
      );
    });

    const worldButton = findButton(container, 'Thế giới');
    expect(worldButton.disabled).toBe(false);
    expect(worldButton.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelectorAll('.dashboard-mobile-menu-lock')).toHaveLength(0);
    expect(container.textContent.match(/Tạo một truyện để sử dụng các mục này\./gu)).toHaveLength(1);
    await act(async () => worldButton.click());

    expect(container.textContent).toContain('Mục Thế giới dùng bên trong một truyện');
    await act(async () => findButton(container, 'Tạo truyện mới').click());
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  it('offers project selection instead of creation when stories already exist', async () => {
    projectState.projects = [{ id: 12, title: 'Truyện đã có' }];
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('Chọn một truyện để sử dụng các mục này.');
    await act(async () => findButton(container, 'Thế giới').click());
    expect(container.textContent).toContain('Hãy chọn một truyện để sử dụng mục Thế giới');
    expect(findButton(container, 'Chọn truyện')).toBeTruthy();
    expect(findButton(container, 'Tạo truyện mới')).toBeFalsy();
  });

  it('restores the primary writing treatment after a story is active', async () => {
    projectState.currentProject = { id: 12, title: 'Truyện đang viết' };
    projectState.projects = [projectState.currentProject];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings']}>
          <Sidebar />
        </MemoryRouter>,
      );
    });

    const editorButton = findButton(container, 'Viết truyện');
    expect(editorButton.getAttribute('aria-disabled')).toBeNull();
    expect(editorButton.classList.contains('sidebar-item--primary')).toBe(true);
    expect(container.textContent).not.toContain('sử dụng các mục này');
  });
});
