import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileSheet from '../../components/mobile/MobileSheet.jsx';
import {
  ConfirmDialogProvider,
  useConfirmDialog,
} from '../../components/common/ConfirmDialogProvider.jsx';

function ConfirmHarness() {
  const confirm = useConfirmDialog();
  const [result, setResult] = React.useState('');
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const accepted = await confirm({
            title: 'Xóa dữ liệu?',
            message: 'Thao tác này không thể hoàn tác.',
            confirmLabel: 'Xóa',
            danger: true,
          });
          setResult(accepted ? 'accepted' : 'cancelled');
        }}
      >
        Mở xác nhận
      </button>
      <output>{result}</output>
    </>
  );
}

describe('shared modal accessibility behavior', () => {
  let container;
  let root;
  let trigger;

  beforeEach(() => {
    trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    trigger.remove();
  });

  it('moves focus inside, traps Tab, closes on Escape, and restores focus', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <MobileSheet open title="Bảng kiểm tra" onClose={onClose}>
          <button type="button">Hành động cuối</button>
        </MobileSheet>,
      );
    });

    const dialog = container.querySelector('[role="dialog"]');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    expect(dialog.contains(document.activeElement)).toBe(true);

    buttons.at(-1).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
    }));
    expect(document.activeElement).toBe(buttons[0]);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<MobileSheet open={false} title="Bảng kiểm tra" onClose={onClose} />);
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves destructive confirmations without using the browser confirm API', async () => {
    await act(async () => {
      root.render(
        <ConfirmDialogProvider>
          <ConfirmHarness />
        </ConfirmDialogProvider>,
      );
    });

    await act(async () => {
      container.querySelector('button').click();
    });

    expect(container.querySelector('[role="dialog"]').textContent).toContain('Thao tác này không thể hoàn tác.');
    const deleteButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Xóa');

    await act(async () => {
      deleteButton.click();
    });

    expect(container.querySelector('output').textContent).toBe('accepted');
  });
});
