import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptSettingsPage from '../../../apps/admin/src/features/promptSettings/PromptSettingsPage.jsx';
import { canDiscardSecurePromptDraft } from '../../../apps/admin/src/features/promptSettings/dirtyNavigation.js';

function click(button) {
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  ).set;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Supreme Admin dirty-state navigation', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('blocks app navigation and reload when a dirty secure draft is not confirmed', () => {
    const confirm = vi.fn().mockReturnValue(false);

    expect(canDiscardSecurePromptDraft({
      dirty: true,
      confirm,
    })).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(canDiscardSecurePromptDraft({
      dirty: false,
      confirm,
    })).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps the secure editor mounted when the owner cancels leaving an unsaved draft', async () => {
    const adminApi = {
      promptSettings: vi.fn().mockResolvedValue({ items: [] }),
      securePrompts: vi.fn().mockResolvedValue({
        enabled: false,
        draftContent: 'Bản đã lưu',
        draftRevision: 1,
        publishedRevision: 0,
        draftVersionId: 'draft-1',
        publishedVersionId: null,
        versions: [],
      }),
    };
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    await act(async () => {
      root.render(<PromptSettingsPage adminApi={adminApi} />);
    });
    const supremeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Tối Thượng'));
    await act(async () => click(supremeButton));
    await act(async () => Promise.resolve());

    const textarea = container.querySelector('#supreme-prompt-content');
    await act(async () => setTextareaValue(textarea, 'Bản chưa lưu'));
    const translatorButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Dịch truyện'));
    await act(async () => click(translatorButton));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#supreme-prompt-content')).toBeTruthy();
  });

  it('does not discard an unsaved secure draft from the panel reload button', async () => {
    const adminApi = {
      promptSettings: vi.fn().mockResolvedValue({ items: [] }),
      securePrompts: vi.fn().mockResolvedValue({
        enabled: false,
        draftContent: 'Bản đã lưu',
        draftRevision: 1,
        publishedRevision: 0,
        draftVersionId: 'draft-1',
        publishedVersionId: null,
        versions: [],
      }),
    };
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    await act(async () => {
      root.render(<PromptSettingsPage adminApi={adminApi} />);
    });
    const supremeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Tối Thượng'));
    await act(async () => click(supremeButton));
    await act(async () => Promise.resolve());

    const textarea = container.querySelector('#supreme-prompt-content');
    await act(async () => setTextareaValue(textarea, 'Bản chưa lưu'));
    const reloadButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Tải lại');
    await act(async () => click(reloadButton));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(adminApi.securePrompts).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#supreme-prompt-content').value).toBe('Bản chưa lưu');
  });

  it('loads older history pages without replacing the decrypted draft', async () => {
    const adminApi = {
      promptSettings: vi.fn().mockResolvedValue({ items: [] }),
      securePrompts: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          draftContent: 'Bản nháp đang sửa',
          draftRevision: 30,
          publishedRevision: 29,
          draftVersionId: 'version-30',
          publishedVersionId: 'version-29',
          versions: [{ id: 'version-30', revision: 30 }],
          historyNextBeforeRevision: 30,
        })
        .mockResolvedValueOnce({
          versions: [{ id: 'version-29', revision: 29 }],
          historyNextBeforeRevision: null,
        }),
    };

    await act(async () => {
      root.render(<PromptSettingsPage adminApi={adminApi} />);
    });
    const supremeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Tối Thượng'));
    await act(async () => click(supremeButton));
    await act(async () => Promise.resolve());

    const loadMoreButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Tải thêm revision'));
    await act(async () => click(loadMoreButton));
    await act(async () => Promise.resolve());

    expect(adminApi.securePrompts).toHaveBeenLastCalledWith({
      historyBeforeRevision: 30,
      metadataOnly: true,
    });
    expect(container.querySelector('#supreme-prompt-content').value).toBe('Bản nháp đang sửa');
    expect(container.textContent).toContain('29');
  });

  it('disables publish when the current draft is already published', async () => {
    const adminApi = {
      promptSettings: vi.fn().mockResolvedValue({ items: [] }),
      securePrompts: vi.fn().mockResolvedValue({
        enabled: true,
        draftContent: 'Bản đang chạy',
        draftRevision: 2,
        publishedRevision: 2,
        draftVersionId: 'version-2',
        publishedVersionId: 'version-2',
        versions: [{ id: 'version-2', revision: 2 }],
      }),
    };

    await act(async () => {
      root.render(<PromptSettingsPage adminApi={adminApi} />);
    });
    const supremeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Tối Thượng'));
    await act(async () => click(supremeButton));
    await act(async () => Promise.resolve());

    const publishButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Xuất bản');
    expect(publishButton.disabled).toBe(true);
  });
});
