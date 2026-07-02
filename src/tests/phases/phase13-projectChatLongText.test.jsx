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
  CHAT_LONG_PASTE_CHAR_THRESHOLD,
  buildCollapsedMessagePreview,
  formatLongTextStats,
  getLongTextStats,
  isLongComposerPaste,
  shouldCollapseUserMessage,
} from '../../pages/ProjectChat/chatLongText.js';

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

async function waitForAssertion(assertion, attempts = 30) {
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

function makeLongUserText() {
  const lines = Array.from({ length: 18 }, (_, index) =>
    `Dòng ${index + 1}: Nội dung tiếng Việt có dấu để kiểm tra hiển thị gọn gàng.`,
  );
  return `${lines.join('\n')}\nTAIL_NGUYEN_VAN_KHONG_DUOC_MAT`;
}

function makeLongPasteText() {
  return [
    'Mở đầu paste dài tiếng Việt có dấu.',
    'CODE_LINE\tgiữ nguyên tab và khoảng trắng    trong raw text.',
    'Nội dung giữa. '.repeat(360),
    'TAIL_PASTE_RAW_KHONG_DUOC_MAT',
  ].join('\n');
}

describe('phase13 ProjectChat long text UX', () => {
  beforeEach(async () => {
    await resetDb();
    routerMocks.navigate.mockReset();
    aiMocks.send.mockReset();
    aiMocks.abort.mockReset();
    aiMocks.lastRequest = null;
    aiMocks.send.mockImplementation((request) => {
      aiMocks.lastRequest = request;
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
  });

  afterEach(async () => {
    if (db.isOpen()) db.close();
    await db.delete();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds long text stats and collapsed previews without changing source text', () => {
    const source = makeLongUserText();
    const preview = buildCollapsedMessagePreview(source);
    const stats = getLongTextStats(source);

    expect(shouldCollapseUserMessage(source)).toBe(true);
    expect(isLongComposerPaste('x'.repeat(CHAT_LONG_PASTE_CHAR_THRESHOLD - 1))).toBe(false);
    expect(isLongComposerPaste('x'.repeat(CHAT_LONG_PASTE_CHAR_THRESHOLD))).toBe(true);
    expect(preview).toContain('Dòng 1');
    expect(preview).not.toContain('TAIL_NGUYEN_VAN_KHONG_DUOC_MAT');
    expect(source).toContain('TAIL_NGUYEN_VAN_KHONG_DUOC_MAT');
    expect(stats.charCount).toBe(source.length);
    expect(stats.lineCount).toBe(19);
    expect(formatLongTextStats(stats)).toContain('ký tự');
    expect(formatLongTextStats(stats)).toContain('dòng');
  });

  it('collapses only long user messages while preserving copy and edit source content', async () => {
    const threadId = await db.ai_chat_threads.add(buildThreadPayload({
      scopedProjectId: 0,
      mode: 'free',
      projectScopeEnabled: false,
      now: 1,
    }));
    const longText = makeLongUserText();
    await db.ai_chat_messages.add({
      project_id: 0,
      thread_id: threadId,
      role: 'user',
      content: longText,
      created_at: 2,
    });
    await db.ai_chat_messages.add({
      project_id: 0,
      thread_id: threadId,
      role: 'assistant',
      content: `Phản hồi AI vẫn hiển thị đầy đủ. ${'AI_CONTENT '.repeat(220)} AI_TAIL_VISIBLE`,
      created_at: 3,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ProjectChat />);
    });
    await waitForAssertion(() => {
      expect(container.textContent).toContain('Đã thu gọn');
    });

    expect(container.textContent).toContain('Dòng 1');
    expect(container.textContent).not.toContain('TAIL_NGUYEN_VAN_KHONG_DUOC_MAT');
    expect(container.textContent).toContain('AI_TAIL_VISIBLE');

    const userToolButtons = container.querySelectorAll('.project-chat-message.is-user .project-chat-message__tools button');
    const copyButton = userToolButtons[0];
    expect(copyButton).not.toBeNull();
    await act(async () => {
      copyButton.click();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(longText);

    const expandButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Mở rộng'));
    expect(expandButton).not.toBeNull();
    await act(async () => {
      expandButton.click();
    });
    expect(container.textContent).toContain('TAIL_NGUYEN_VAN_KHONG_DUOC_MAT');

    const collapseButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Thu gọn'));
    expect(collapseButton).not.toBeNull();
    await act(async () => {
      collapseButton.click();
    });
    expect(container.textContent).not.toContain('TAIL_NGUYEN_VAN_KHONG_DUOC_MAT');

    const editButton = userToolButtons[1];
    expect(editButton).not.toBeNull();
    await act(async () => {
      editButton.click();
    });
    const textarea = container.querySelector('textarea');
    expect(textarea.value).toBe(longText);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('turns long pasted text into a chip but sends and stores the raw text unchanged', async () => {
    const threadId = await db.ai_chat_threads.add(buildThreadPayload({
      scopedProjectId: 0,
      mode: 'free',
      projectScopeEnabled: false,
      now: 1,
    }));
    const longPaste = makeLongPasteText();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ProjectChat />);
    });
    await waitForAssertion(() => {
      expect(container.querySelector('.project-chat-thread.is-active')).not.toBeNull();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      setNativeTextValue(textarea, 'Hãy đọc phần paste này.');
    });
    // jsdom's ClipboardEvent is incomplete in some versions, so dispatch a paste-like event with clipboardData.
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [],
        getData: (type) => (type === 'text/plain' ? longPaste : ''),
      },
    });
    await act(async () => {
      textarea.dispatchEvent(pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('Hãy đọc phần paste này.');
    expect(container.textContent).toContain('Văn bản đã dán');
    expect(container.textContent).toContain('Hiện trong ô nhập');
    expect(container.textContent).not.toContain('TAIL_PASTE_RAW_KHONG_DUOC_MAT');

    const sendButton = container.querySelector('.project-chat-composer__submit-button');
    await act(async () => {
      sendButton.click();
    });
    await waitForAssertion(() => {
      expect(aiMocks.send).toHaveBeenCalledTimes(1);
    });

    const savedMessages = await db.ai_chat_messages.where('thread_id').equals(threadId).toArray();
    const savedUser = savedMessages.find((message) => message.role === 'user');
    expect(savedUser.content).toContain('Hãy đọc phần paste này.');
    expect(savedUser.content).toContain('CODE_LINE\tgiữ nguyên tab và khoảng trắng    trong raw text.');
    expect(savedUser.content).toContain('TAIL_PASTE_RAW_KHONG_DUOC_MAT');
    expect(JSON.stringify(aiMocks.lastRequest.messages)).toContain('TAIL_PASTE_RAW_KHONG_DUOC_MAT');
    expect(container.textContent).not.toContain('Văn bản đã dán');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('can restore or delete pending paste chips before sending', async () => {
    await db.ai_chat_threads.add(buildThreadPayload({
      scopedProjectId: 0,
      mode: 'free',
      projectScopeEnabled: false,
      now: 1,
    }));
    const longPaste = makeLongPasteText();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ProjectChat />);
    });
    await waitForAssertion(() => {
      expect(container.querySelector('.project-chat-thread.is-active')).not.toBeNull();
    });

    const textarea = container.querySelector('textarea');
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [],
        getData: (type) => (type === 'text/plain' ? longPaste : ''),
      },
    });
    await act(async () => {
      textarea.dispatchEvent(pasteEvent);
    });

    const showInInputButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Hiện trong ô nhập'));
    expect(showInInputButton).not.toBeNull();
    await act(async () => {
      showInInputButton.click();
    });
    expect(textarea.value).toContain('TAIL_PASTE_RAW_KHONG_DUOC_MAT');
    expect(container.textContent).not.toContain('Văn bản đã dán');

    await act(async () => {
      setNativeTextValue(textarea, '');
      textarea.dispatchEvent(pasteEvent);
    });
    expect(container.textContent).toContain('Văn bản đã dán');

    const deleteButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Xóa'));
    expect(deleteButton).not.toBeNull();
    await act(async () => {
      deleteButton.click();
    });
    expect(container.textContent).not.toContain('Văn bản đã dán');
    expect(container.querySelector('.project-chat-composer__submit-button')?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps new Vietnamese long-text UI copy free of mojibake markers', async () => {
    const uiCopy = [
      'Đã thu gọn',
      'Mở rộng',
      'Thu gọn',
      'Văn bản đã dán',
      'Hiện trong ô nhập',
      'Xóa',
      'ký tự',
      'dòng',
    ].join('\n');

    expect(uiCopy).not.toMatch(/Ä‚|Ă„|Ă¡Â»|Ă¡Âº|Ă†|ï¿½/u);
  });
});
