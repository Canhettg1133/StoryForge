import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupGuidesPage from './SetupGuidesPage.jsx';

function click(element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SetupGuidesPage', () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('batches edit, add, disable and reorder changes into one revision-checked save', async () => {
    const initial = {
      key: 'setup_guides',
      revision: 4,
      items: [{ id: 'direct', label: 'Direct', url: '/guide', enabled: true, icon: 'book' }],
    };
    const adminApi = {
      setupGuides: vi.fn().mockResolvedValue({ setupGuides: initial }),
      updateSetupGuides: vi.fn(async (body) => ({
        setupGuides: { key: 'setup_guides', revision: 5, items: body.items },
      })),
    };
    const onDirtyChange = vi.fn();

    await act(async () => {
      root.render(<SetupGuidesPage adminApi={adminApi} actor={{ role: 'admin' }} onDirtyChange={onDirtyChange} />);
    });

    const firstLabel = container.querySelector('.setup-guide-item input:not([type="checkbox"])');
    await act(async () => setInputValue(firstLabel, 'Direct đã sửa'));
    await act(async () => click([...container.querySelectorAll('button')].find((button) => button.textContent.includes('Thêm nút'))));

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    await act(async () => click(checkboxes[0]));
    await act(async () => click(container.querySelector('button[aria-label^="Đưa Direct đã sửa xuống"]')));
    await act(async () => click([...container.querySelectorAll('button')].find((button) => button.textContent.includes('Lưu thay đổi'))));

    expect(adminApi.updateSetupGuides).toHaveBeenCalledTimes(1);
    expect(adminApi.updateSetupGuides).toHaveBeenCalledWith({
      expectedRevision: 4,
      items: [
        expect.objectContaining({ label: 'Hướng dẫn mới', enabled: true }),
        expect.objectContaining({ id: 'direct', label: 'Direct đã sửa', enabled: false }),
      ],
    });
    expect(container.textContent).toContain('Đã lưu revision 5');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('fails closed instead of exposing editable fallback data when the initial load fails', async () => {
    const adminApi = {
      setupGuides: vi.fn().mockRejectedValue(new Error('Không tải được cấu hình thật.')),
      updateSetupGuides: vi.fn(),
    };

    await act(async () => {
      root.render(<SetupGuidesPage adminApi={adminApi} actor={{ role: 'admin' }} />);
    });

    expect(container.textContent).toContain('Không tải được cấu hình thật.');
    expect([...container.querySelectorAll('button')].some((button) => button.textContent.includes('Tải lại'))).toBe(true);
    expect(container.textContent).not.toContain('Thêm nút');
    expect(container.textContent).not.toContain('Lưu thay đổi');
    expect(adminApi.updateSetupGuides).not.toHaveBeenCalled();
  });
});


