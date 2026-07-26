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

  it('restores the app after overlapping modals close out of order', async () => {
    const renderModals = async (firstOpen, secondOpen) => {
      await act(async () => {
        root.render(
          <>
            <main data-testid="app-content">
              <button type="button">Menu chính</button>
            </main>
            <MobileSheet open={firstOpen} title="Modal thứ nhất" onClose={() => {}}>
              <button type="button">Đóng modal thứ nhất</button>
            </MobileSheet>
            <MobileSheet open={secondOpen} title="Modal thứ hai" onClose={() => {}}>
              <button type="button">Đóng modal thứ hai</button>
            </MobileSheet>
          </>,
        );
      });
    };

    await renderModals(true, false);
    await renderModals(true, true);
    await renderModals(false, true);

    const appContent = container.querySelector('[data-testid="app-content"]');
    const inertWhileSecondModalRemainsOpen = appContent.inert;

    await renderModals(false, false);

    expect({
      inertWhileSecondModalRemainsOpen,
      inertAfterBothModalsClose: appContent.inert,
      ariaHiddenAfterBothModalsClose: appContent.getAttribute('aria-hidden'),
    }).toEqual({
      inertWhileSecondModalRemainsOpen: true,
      inertAfterBothModalsClose: false,
      ariaHiddenAfterBothModalsClose: null,
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('lets only the topmost modal handle Escape', async () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();

    await act(async () => {
      root.render(
        <>
          <MobileSheet open title="First modal" onClose={closeFirst}>
            <button type="button">First action</button>
          </MobileSheet>
          <MobileSheet open title="Second modal" onClose={closeSecond}>
            <button type="button">Second action</button>
          </MobileSheet>
        </>,
      );
    });

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    }));

    expect(closeFirst).not.toHaveBeenCalled();
    expect(closeSecond).toHaveBeenCalledTimes(1);
  });

  it('reactivates the underlying modal when the topmost modal closes', async () => {
    const renderModals = async (secondOpen) => {
      await act(async () => {
        root.render(
          <>
            <main data-testid="app-content">
              <button type="button">Menu</button>
            </main>
            <MobileSheet open title="First modal" onClose={() => {}}>
              <button type="button">First action</button>
            </MobileSheet>
            <MobileSheet open={secondOpen} title="Second modal" onClose={() => {}}>
              <button type="button">Second action</button>
            </MobileSheet>
          </>,
        );
      });
    };

    await renderModals(true);
    await renderModals(false);

    const appContent = container.querySelector('[data-testid="app-content"]');
    const firstDialog = container.querySelector('[aria-label="First modal"]');
    expect(appContent.inert).toBe(true);
    expect(firstDialog.parentElement.inert).toBe(false);
    expect(firstDialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      root.render(null);
    });

    expect(appContent.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus and background locking to a modal after its confirm dialog closes', async () => {
    const renderSheet = async (open) => {
      await act(async () => {
        root.render(
          <ConfirmDialogProvider>
            <main data-testid="app-content">
              <button type="button">Menu</button>
            </main>
            <MobileSheet open={open} title="Parent modal" onClose={() => {}}>
              <ConfirmHarness />
            </MobileSheet>
          </ConfirmDialogProvider>,
        );
      });
    };

    await renderSheet(true);
    const parentDialog = container.querySelector('[aria-label="Parent modal"]');
    const openConfirmButton = Array.from(parentDialog.querySelectorAll('button'))
      .find((button) => button.textContent.trim());

    await act(async () => {
      openConfirmButton.click();
    });

    const dialogs = Array.from(container.querySelectorAll('[role="dialog"]'));
    const confirmDialog = dialogs.at(-1);
    expect(dialogs).toHaveLength(2);
    expect(parentDialog.parentElement.inert).toBe(true);
    expect(confirmDialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      confirmDialog.querySelector('button').click();
    });

    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(parentDialog.parentElement.inert).toBe(false);
    expect(parentDialog.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('[data-testid="app-content"]').inert).toBe(true);

    await renderSheet(false);
    expect(container.querySelector('[data-testid="app-content"]').inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('makes a newly opened nested modal branch interactive', async () => {
    const renderModals = async (secondOpen) => {
      await act(async () => {
        root.render(
          <>
            <MobileSheet open title="First modal" onClose={() => {}}>
              <button type="button">First action</button>
            </MobileSheet>
            <div data-testid="nested-branch">
              <MobileSheet open={secondOpen} title="Second modal" onClose={() => {}}>
                <button type="button">Second action</button>
              </MobileSheet>
            </div>
          </>,
        );
      });
    };

    await renderModals(false);
    const nestedBranch = container.querySelector('[data-testid="nested-branch"]');
    expect(nestedBranch.inert).toBe(true);

    await renderModals(true);

    expect(nestedBranch.inert).toBe(false);
    expect(container.querySelector('[aria-label="First modal"]').parentElement.inert).toBe(true);
    expect(container.querySelector('[aria-label="Second modal"]').contains(document.activeElement)).toBe(true);

    await renderModals(false);
    expect(nestedBranch.inert).toBe(true);
  });

  it('cleans up all accessibility locks when stacked modals unmount together', async () => {
    await act(async () => {
      root.render(
        <>
          <MobileSheet open title="First modal" onClose={() => {}}>
            <button type="button">First action</button>
          </MobileSheet>
          <MobileSheet open title="Second modal" onClose={() => {}}>
            <button type="button">Second action</button>
          </MobileSheet>
        </>,
      );
    });

    expect(trigger.inert).toBe(true);

    await act(async () => {
      root.render(null);
    });

    expect(trigger.inert).toBe(false);
    expect(trigger.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('preserves accessibility state that existed before the modal session', async () => {
    trigger.inert = true;
    trigger.setAttribute('aria-hidden', 'legacy');

    await act(async () => {
      root.render(
        <MobileSheet open title="Modal" onClose={() => {}}>
          <button type="button">Action</button>
        </MobileSheet>,
      );
    });

    await act(async () => {
      root.render(<MobileSheet open={false} title="Modal" onClose={() => {}} />);
    });

    expect(trigger.inert).toBe(true);
    expect(trigger.getAttribute('aria-hidden')).toBe('legacy');
  });

  it('does not leak modal locks through React StrictMode effect replay', async () => {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <MobileSheet open title="Strict modal" onClose={() => {}}>
            <button type="button">Action</button>
          </MobileSheet>
        </React.StrictMode>,
      );
    });

    expect(trigger.inert).toBe(true);

    await act(async () => {
      root.render(
        <React.StrictMode>
          <MobileSheet open={false} title="Strict modal" onClose={() => {}} />
        </React.StrictMode>,
      );
    });

    expect(trigger.inert).toBe(false);
    expect(trigger.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
