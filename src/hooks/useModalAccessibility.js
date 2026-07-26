import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

const modalStack = [];
const lockedElements = new Map();
let sessionPreviousFocus = null;

function getInertSiblings(dialog) {
  const modalRoot = dialog.parentElement;
  const inertSiblings = [];
  let activeBranch = modalRoot;

  while (activeBranch?.parentElement) {
    const parent = activeBranch.parentElement;
    Array.from(parent.children).forEach((element) => {
      if (element !== activeBranch && !inertSiblings.includes(element)) {
        inertSiblings.push(element);
      }
    });
    activeBranch = parent;
    if (parent === document.body) break;
  }

  return inertSiblings;
}

function restoreBackground() {
  lockedElements.forEach(({ inert, ariaHidden }, element) => {
    element.inert = inert;
    if (ariaHidden == null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', ariaHidden);
  });
  lockedElements.clear();
}

function lockBackground(dialog) {
  getInertSiblings(dialog).forEach((element) => {
    lockedElements.set(element, {
      inert: Boolean(element.inert),
      ariaHidden: element.getAttribute('aria-hidden'),
    });
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
  });
}

function focusInitialElement(dialog) {
  const initialFocus = dialog.querySelector('[autofocus]') || getFocusableElements(dialog)[0] || dialog;
  initialFocus.focus();
}

function getTopModal() {
  return modalStack[modalStack.length - 1];
}

function activateModal(modal, shouldFocus) {
  restoreBackground();
  if (!modal) return;
  if (shouldFocus) focusInitialElement(modal.dialog);
  lockBackground(modal.dialog);
}

function registerModal(dialog) {
  if (modalStack.length === 0) sessionPreviousFocus = document.activeElement;
  const modal = { dialog };
  modalStack.push(modal);
  activateModal(modal, true);
  return modal;
}

function unregisterModal(modal) {
  const index = modalStack.indexOf(modal);
  if (index === -1) return;

  const wasTopModal = index === modalStack.length - 1;
  modalStack.splice(index, 1);
  const nextModal = getTopModal();

  if (nextModal) {
    const focusLeftTopModal = !nextModal.dialog.contains(document.activeElement);
    activateModal(nextModal, wasTopModal || focusLeftTopModal);
    return;
  }

  restoreBackground();
  const focusTarget = sessionPreviousFocus;
  sessionPreviousFocus = null;
  if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
    focusTarget.focus();
  }
}

export default function useModalAccessibility({ open, onClose, closeOnEscape = true }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnEscape]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    const modal = registerModal(dialog);

    const handleKeyDown = (event) => {
      if (getTopModal() !== modal) return;

      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterModal(modal);
    };
  }, [open]);

  return dialogRef;
}
