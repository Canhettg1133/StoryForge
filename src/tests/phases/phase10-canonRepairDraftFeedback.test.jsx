import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanonRepairDialog from '../../components/canon/CanonRepairDialog';

describe('phase10 canon repair draft feedback', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows where the draft is stored and prevents duplicate saves after success', async () => {
    await act(async () => {
      root.render(
        <CanonRepairDialog
          open
          preview={{
            text: 'Nội dung AI đã sửa',
            reports: [],
            savedRevisionId: 102,
          }}
          outcome={{
            ok: true,
            kind: 'success',
            message: 'Đã lưu bản sửa thành bản nháp r2 trong lịch sử canon.',
          }}
          onClose={vi.fn()}
          onCopy={vi.fn()}
          onSaveDraft={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Đã lưu bản sửa thành bản nháp r2 trong lịch sử canon.');
    expect(container.textContent).toContain('không thay nội dung chương đang mở trong trình soạn thảo');

    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Đã lưu bản nháp'));

    expect(saveButton).toBeTruthy();
    expect(saveButton.disabled).toBe(true);
  });

  it('shows a save error inside the dialog and keeps retry available', async () => {
    const onSaveDraft = vi.fn();
    await act(async () => {
      root.render(
        <CanonRepairDialog
          open
          preview={{ text: 'Nội dung AI đã sửa', reports: [], savedRevisionId: null }}
          outcome={{ ok: false, kind: 'error', message: 'Không thể lưu bản nháp.' }}
          onClose={vi.fn()}
          onCopy={vi.fn()}
          onSaveDraft={onSaveDraft}
        />,
      );
    });

    expect(container.textContent).toContain('Không thể lưu bản nháp.');

    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Lưu thành bản nháp'));

    expect(saveButton).toBeTruthy();
    expect(saveButton.disabled).toBe(false);
  });

  it('keeps cancellation dismissible and retryable inside the dialog', async () => {
    const onClose = vi.fn();
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        <CanonRepairDialog
          open
          preview={{
            text: '',
            reports: [],
            loading: false,
            error: 'Yêu cầu AI đã bị hủy.',
          }}
          onClose={onClose}
          onRetry={onRetry}
          onCopy={vi.fn()}
          onSaveDraft={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const closeButton = buttons.find((button) => button.textContent.includes('Đóng'));
    const retryButton = buttons.find((button) => button.textContent.includes('Thử lại'));

    expect(closeButton).toBeTruthy();
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton.click();
      closeButton.click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses a fixed dialog shell with only the body scrolling', () => {
    const css = readFileSync('src/components/canon/CanonRepairDialog.css', 'utf8');
    const dialogRule = css.match(/\.canon-repair-dialog\s*\{[^}]+\}/u)?.[0] || '';
    const headerRule = css.match(/\.canon-repair-dialog__header\s*\{[^}]+\}/u)?.[0] || '';
    const bodyRule = css.match(/\.canon-repair-dialog__body\s*\{[^}]+\}/u)?.[0] || '';

    expect(dialogRule).toContain('overflow: hidden');
    expect(dialogRule).toContain('flex-direction: column');
    expect(headerRule).toContain('flex-shrink: 0');
    expect(bodyRule).toContain('overflow-y: auto');
  });
});
