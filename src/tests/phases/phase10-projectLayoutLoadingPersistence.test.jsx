import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

let mockedProjectStoreState = {};

vi.mock('../../stores/projectStore', () => ({
  default: () => mockedProjectStoreState,
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

async function loadProjectLayout() {
  vi.resetModules();
  const module = await import('../../components/common/ProjectLayout.jsx');
  return module.default;
}

describe('phase10 project layout loading persistence', () => {
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

  it('keeps the editor outlet mounted during same-project background reloads', async () => {
    const ProjectLayout = await loadProjectLayout();
    const mountSpy = vi.fn();
    const unmountSpy = vi.fn();

    function EditorOutlet() {
      useEffect(() => {
        mountSpy();
        return () => unmountSpy();
      }, []);
      return <div data-testid="editor-outlet">Editor</div>;
    }

    mockedProjectStoreState = {
      currentProject: { id: 7, title: 'Project 7' },
      loading: false,
      loadProject: vi.fn(),
    };

    const router = createMemoryRouter([
      {
        path: '/project/:projectId',
        element: <ProjectLayout />,
        children: [{ path: 'editor', element: <EditorOutlet /> }],
      },
    ], {
      initialEntries: ['/project/7/editor'],
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    expect(container.querySelector('[data-testid="editor-outlet"]')).not.toBeNull();
    expect(mountSpy).toHaveBeenCalledTimes(1);

    mockedProjectStoreState = {
      ...mockedProjectStoreState,
      loading: true,
    };

    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    expect(container.querySelector('[data-testid="editor-outlet"]')).not.toBeNull();
    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(unmountSpy).not.toHaveBeenCalled();
  });
});
