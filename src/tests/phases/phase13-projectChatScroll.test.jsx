import 'fake-indexeddb/auto';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const aiMocks = vi.hoisted(() => ({
  send: vi.fn(),
  abort: vi.fn(),
  lastRequest: null,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/chat' }),
  useNavigate: () => routerMocks.navigate,
  useParams: () => ({}),
}));

vi.mock('../../stores/projectStore', () => ({
  default: () => ({
    currentProject: null,
    loadProject: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMobileLayout', () => ({
  default: () => false,
}));

vi.mock('../../hooks/useUserAccess', () => ({
  useUserAccess: () => ({
    hasFeature: () => true,
    getDeniedMessage: () => '',
  }),
}));

vi.mock('../../components/access/AccessGate.jsx', () => ({
  default: () => <div data-testid="access-gate" />,
}));

vi.mock('../../services/ai/client', () => ({
  default: aiMocks,
}));

import db from '../../services/db/database.js';
import ProjectChat, { buildThreadPayload } from '../../pages/ProjectChat/ProjectChat.jsx';
import {
  createRafTextBatcher,
  isChatScrollNearBottom,
  scrollChatMessageToTop,
} from '../../pages/ProjectChat/chatScroll.js';

async function resetDb() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForAssertion(assertion, attempts = 25) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushReact();
    }
  }
  throw lastError;
}

function setNativeTextValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('phase13 ProjectChat scroll UX', () => {
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let originalScrollIntoView;

  beforeEach(async () => {
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    await resetDb();
    routerMocks.navigate.mockReset();
    aiMocks.send.mockReset();
    aiMocks.abort.mockReset();
    aiMocks.lastRequest = null;
    aiMocks.send.mockImplementation((request) => {
      aiMocks.lastRequest = request;
    });
  });

  afterEach(async () => {
    if (db.isOpen()) db.close();
    await db.delete();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('computes chat scroll anchors without relying on scrollIntoView', () => {
    const scrollTo = vi.fn();
    const container = {
      scrollTop: 80,
      scrollHeight: 1200,
      clientHeight: 360,
      scrollTo,
      getBoundingClientRect: () => ({ top: 20 }),
    };
    const message = {
      getBoundingClientRect: () => ({ top: 60 }),
    };

    expect(isChatScrollNearBottom(container)).toBe(false);
    scrollChatMessageToTop(container, message, { padding: 12, behavior: 'smooth' });

    expect(scrollTo).toHaveBeenCalledWith({ top: 108, behavior: 'smooth' });
  });

  it('batches streaming text updates into animation frames and flushes the latest text', () => {
    const callbacks = [];
    const cancelFrame = vi.fn();
    const onFlush = vi.fn();
    const batcher = createRafTextBatcher(onFlush, {
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame,
    });

    batcher.push('Xin');
    batcher.push('Xin chào');

    expect(onFlush).not.toHaveBeenCalled();
    callbacks[0]();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenLastCalledWith('Xin chào');

    batcher.push('Xin chào Anh Đạt');
    batcher.flush();
    expect(cancelFrame).toHaveBeenCalledWith(2);
    expect(onFlush).toHaveBeenLastCalledWith('Xin chào Anh Đạt');
  });

  it('anchors a newly sent question near the top and keeps streaming from pulling the chat down', async () => {
    const frameCallbacks = [];
    window.requestAnimationFrame = vi.fn((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    window.cancelAnimationFrame = vi.fn();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    await db.ai_chat_threads.add(buildThreadPayload({
      scopedProjectId: 0,
      mode: 'free',
      projectScopeEnabled: false,
      now: 1,
    }));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ProjectChat />);
    });
    await flushReact();
    await waitForAssertion(() => {
      expect(container.querySelector('.project-chat-thread.is-active')).not.toBeNull();
    });

    const messagesEl = container.querySelector('.project-chat-messages');
    expect(messagesEl).not.toBeNull();
    Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, value: 1400 });
    Object.defineProperty(messagesEl, 'clientHeight', { configurable: true, value: 420 });
    Object.defineProperty(messagesEl, 'scrollTop', { configurable: true, writable: true, value: 0 });
    messagesEl.scrollTo = vi.fn((options) => {
      messagesEl.scrollTop = Number(options?.top || 0);
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      setNativeTextValue(textarea, 'Bạn là ai?');
    });
    await waitForAssertion(() => {
      expect(container.querySelector('.project-chat-composer__submit-button')?.disabled).toBe(false);
    });

    const sendButton = container.querySelector('.project-chat-composer__submit-button');
    await act(async () => {
      sendButton.click();
    });
    await waitForAssertion(() => {
      expect(aiMocks.send).toHaveBeenCalledTimes(1);
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(messagesEl.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));

    const scrollCallsAfterQuestion = messagesEl.scrollTo.mock.calls.length;
    await act(async () => {
      aiMocks.lastRequest.onToken('Xin', 'Xin');
      aiMocks.lastRequest.onToken(' chào', 'Xin chào');
    });

    expect(container.textContent).not.toContain('Xin chào');
    await act(async () => {
      frameCallbacks.shift()?.();
    });

    expect(container.textContent).toContain('Xin chào');
    expect(messagesEl.scrollTo).toHaveBeenCalledTimes(scrollCallsAfterQuestion);

    await flushReact();
    const jumpButton = container.querySelector('button[aria-label="Cuộn xuống cuối"]');
    expect(jumpButton).not.toBeNull();

    await act(async () => {
      jumpButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(messagesEl.scrollTo).toHaveBeenLastCalledWith({ top: 1400, behavior: 'smooth' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
