import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createStoryBundle: vi.fn(),
  saveAs: vi.fn(),
}));

function makeCountTable({ rows = [] } = {}) {
  return {
    where: () => ({
      equals: () => ({
        count: async () => rows.length,
        toArray: async () => rows,
      }),
    }),
  };
}

vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));

vi.mock('../../services/db/database.js', () => ({
  default: {
    chapters: makeCountTable(),
    scenes: makeCountTable(),
    ai_chat_threads: makeCountTable(),
    ai_chat_attachments: makeCountTable(),
    project_assets: makeCountTable(),
  },
}));

vi.mock('../../services/storyBundle/storyBundle.js', () => ({
  createStoryBundle: mocks.createStoryBundle,
  importStoryBundle: vi.fn(),
  inspectStoryBundle: vi.fn(),
  isStoryBundleCryptoAvailable: () => true,
}));

import StoryBundleModal from '../../components/storyBundle/StoryBundleModal.jsx';

describe('phase21 Story Bundle iOS file saving', () => {
  let container;
  let root;
  let userAgentSpy;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.createStoryBundle.mockResolvedValue({
      blob: new Blob(['story'], { type: 'application/vnd.storyforge.bundle' }),
      fileName: 'story.storyforge',
    });
  });

  afterEach(async () => {
    userAgentSpy?.mockRestore();
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderExportModal(onClose = vi.fn()) {
    await act(async () => {
      root.render(<StoryBundleModal mode="export" project={{ id: 1, title: 'Story' }} onClose={onClose} />);
      await Promise.resolve();
    });
    return onClose;
  }

  function exportButton() {
    return container.querySelector('.story-bundle-modal__actions .btn-primary');
  }

  it('does not filter custom Story Bundle files out of the iOS picker', async () => {
    await act(async () => {
      root.render(<StoryBundleModal mode="import" projects={[]} onClose={vi.fn()} />);
    });

    const fileInput = container.querySelector('input[type="file"]');

    expect(fileInput).not.toBeNull();
    expect(fileInput.hasAttribute('accept')).toBe(false);
  });

  it('waits for a second user click before saving on iOS', async () => {
    userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
    const onClose = await renderExportModal();

    await act(async () => {
      exportButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createStoryBundle).toHaveBeenCalledTimes(1);
    expect(mocks.saveAs).not.toHaveBeenCalled();
    expect(exportButton().textContent).toContain('.storyforge');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      exportButton().click();
    });

    expect(mocks.createStoryBundle).toHaveBeenCalledTimes(1);
    expect(mocks.saveAs).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps one-click saving on non-iOS browsers', async () => {
    userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0');
    const onClose = await renderExportModal();

    await act(async () => {
      exportButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createStoryBundle).toHaveBeenCalledTimes(1);
    expect(mocks.saveAs).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
