import 'fake-indexeddb/auto';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../services/db/database.js';
import modelRouter from '../../services/ai/router.js';
import ManuscriptReviewPanel from '../../features/manuscriptReview/ManuscriptReviewPanel.jsx';
import ManuscriptReviewModelSetting from '../../features/manuscriptReview/ManuscriptReviewModelSetting.jsx';
import { REVIEW_MODEL_PREFERENCE_KEY, saveManuscriptReviewModelPreference } from '../../features/manuscriptReview/modelRouting.js';
import { createManuscriptSnapshot, hashReviewValue } from '../../features/manuscriptReview/snapshot.js';
import { buildReviewContract } from '../../features/manuscriptReview/contract.js';
import ReviewReport from '../../features/manuscriptReview/ReviewReport.jsx';
import { LITERARY_CRITERIA } from '../../features/manuscriptReview/constants.js';
import { resetManuscriptReviewRunStoreForTests } from '../../features/manuscriptReview/runStore.js';

describe('review UI with real Tiptap and service', () => {
  let container, root, editor, editorElement;
  const project = { id: 1 };
  const scene = { id: 3, chapter_id: 2 };
  const render = async (props = {}) => act(async () => root.render(<StrictMode><ManuscriptReviewPanel editor={editor} project={project} scene={scene} active {...props} /></StrictMode>));
  const button = (label) => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
  const click = async (element) => act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const chooseMode = async (label) => {
    await click(container.querySelector('[aria-label="Phần phân tích"]'));
    await click([...container.querySelectorAll('[role="option"]')].find((item) => item.textContent === label));
  };

  beforeEach(async () => {
    resetManuscriptReviewRunStoreForTests();
    localStorage.clear(); vi.stubGlobal('crypto', webcrypto);
    modelRouter.setPreferredProvider('gemini_direct'); modelRouter.setQualityMode('best');
    await db.qaReports.clear();
    container = document.createElement('div'); editorElement = document.createElement('div');
    document.body.append(container, editorElement); root = createRoot(container);
    editor = new Editor({ element: editorElement, extensions: [StarterKit], content: '<p>Mưa gõ mái hiên.</p><p>Lan khép cửa.</p>' });
  });
  afterEach(async () => { await act(async () => root.unmount()); resetManuscriptReviewRunStoreForTests(); editor.destroy(); container.remove(); editorElement.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each([
    ['Phạm vi phân tích', ['Đoạn đang chọn', 'Cảnh hiện tại'], 'Cảnh hiện tại'],
    ['Phần phân tích', ['Toàn diện — cả ba phần', 'Bám yêu cầu', 'Chấm văn', 'Dấu hiệu máy móc'], 'Toàn diện — cả ba phần'],
  ])('renders %s options inside the review instead of a native browser popup', async (label, labels, selected) => {
    vi.stubGlobal('fetch', vi.fn());
    await render();
    const control = container.querySelector(`[aria-label="${label}"]`);
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('role')).toBe('combobox');
    await click(control);
    const menu = document.getElementById(control.getAttribute('aria-controls'));
    expect(control.parentElement.contains(menu)).toBe(true);
    expect(menu.getAttribute('role')).toBe('listbox');
    expect([...menu.querySelectorAll('[role="option"]')].map((item) => item.textContent)).toEqual(labels);
    expect(menu.querySelector('[aria-selected="true"]').textContent).toBe(selected);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('browses options without changing scope and lets Escape close only the open list', async () => {
    const onClose = vi.fn();
    await render({ mobileOpen: true, onClose });
    const scope = container.querySelector('[aria-label="Phạm vi phân tích"]');
    await click(scope);
    await act(async () => scope.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
    expect(document.getElementById(scope.getAttribute('aria-activedescendant')).textContent).toBe('Đoạn đang chọn');
    expect(scope.value).toBe('scene');
    await act(async () => scope.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(scope.value).toBe('scene');
    expect(document.activeElement).toBe(scope);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => scope.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('commits scope and mode by pointer without submitting or changing model preferences', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await render();
    const scope = container.querySelector('[aria-label="Phạm vi phân tích"]');
    const mode = container.querySelector('[aria-label="Phần phân tích"]');
    await click(scope);
    await click([...container.querySelectorAll('[role="option"]')].find((item) => item.textContent === 'Đoạn đang chọn'));
    expect(scope.value).toBe('selection');
    expect(document.activeElement).toBe(scope);
    await click(mode);
    await click([...container.querySelectorAll('[role="option"]')].find((item) => item.textContent === 'Bám yêu cầu'));
    expect(mode.value).toBe('adherence');
    expect(container.textContent).toContain('Một request cho phần đã chọn.');
    expect(button('Chạy phân tích')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(REVIEW_MODEL_PREFERENCE_KEY)).toBeNull();
  });

  it('opens only one list, closes on outside interaction and keeps keyboard selection usable', async () => {
    await render();
    const scope = container.querySelector('[aria-label="Phạm vi phân tích"]');
    const mode = container.querySelector('[aria-label="Phần phân tích"]');
    await click(scope);
    await act(async () => mode.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    await click(mode);
    expect(scope.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    for (const key of ['End', 'ArrowUp', 'Home', 'ArrowDown', 'Enter']) {
      await act(async () => mode.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    }
    expect(mode.value).toBe('adherence');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await click(mode);
    await act(async () => container.querySelector('textarea').dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('keeps popup width local and options on the same responsive font as the control', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/features/manuscriptReview/ManuscriptReview.css', 'utf8');
    document.head.append(style);
    try {
      const rules = [...style.sheet.cssRules];
      const rule = (selector) => rules.find((item) => item.selectorText === selector)?.style;
      expect(rule('.manuscript-review-select')?.getPropertyValue('position')).toBe('relative');
      const menu = rule('.manuscript-review-select-menu');
      expect(menu?.getPropertyValue('inset-inline')).toBe('0px');
      expect(menu?.getPropertyValue('max-width')).toBe('100%');
      expect(menu?.getPropertyValue('font')).toBe('inherit');
      const control = rule('.manuscript-review .manuscript-review-select-trigger');
      expect(control?.getPropertyValue('font')).toBe('inherit');
      expect(control?.getPropertyValue('height')).toBe('auto');
      expect(rule('.manuscript-review-select-option')?.getPropertyValue('overflow-wrap')).toBe('anywhere');
      const mobile = rules.find((item) => item.conditionText === '(max-width: 640px)');
      expect([...mobile.cssRules].some((item) => item.selectorText?.includes('.manuscript-review-select') && item.style.getPropertyValue('font-size') === 'var(--text-md)')).toBe(true);
    } finally { style.remove(); }
  });

  it('supports type-ahead, Space and Tab without submitting the form', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await render();
    const mode = container.querySelector('[aria-label="Phần phân tích"]');
    mode.focus();
    for (const key of ['c', 'h']) {
      await act(async () => mode.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    }
    expect(document.getElementById(mode.getAttribute('aria-activedescendant')).textContent).toBe('Chấm văn');
    expect(mode.value).toBe('all');
    await act(async () => mode.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    expect(mode.value).toBe('literary');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    for (const key of [' ', 'ArrowUp']) {
      await act(async () => mode.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    }
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => mode.dispatchEvent(tab));
    expect(mode.value).toBe('adherence');
    expect(tab.defaultPrevented).toBe(false);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await click(mode);
    await act(async () => container.querySelector('textarea').focus());
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('asks once; Escape/cancel neither save a preference nor call AI', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await render();
    const start = button('Phân tích toàn diện'); start.focus();
    await click(start);
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Chọn model phân tích');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(localStorage.getItem(REVIEW_MODEL_PREFERENCE_KEY)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(start);
  });

  it('lets only the top model dialog handle Escape on mobile', async () => {
    const outerEscape = vi.fn();
    const listener = (event) => { if (event.key === 'Escape') outerEscape(); };
    document.addEventListener('keydown', listener);
    try {
      await render({ mobileOpen: true, onClose: outerEscape });
      await click(button('Phân tích toàn diện'));
      const select = document.querySelector('.manuscript-review-dialog select');
      await act(async () => select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(outerEscape).not.toHaveBeenCalled();
      expect(document.querySelector('.manuscript-review-dialog')).toBeNull();
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    } finally { document.removeEventListener('keydown', listener); }
  });

  it('keeps evidence buttons out of the focus trap until their criterion is expanded', async () => {
    const report = { mode: 'literary', provider: 'test', model: 'test', created_at: new Date().toISOString(), rubric_version: '1.0', result: {
      score: 80, summary: 'Tham khảo.', findings: [], scores: LITERARY_CRITERIA.map(({ id }) => ({ criterion_id: id, score: 4, strength: 'Rõ.', limitation: 'Chưa đủ cảnh.', confidence: 0.7, evidence: [{ paragraph_id: 'p1', quote: 'Mưa' }] })),
    } };
    await act(async () => root.render(<ReviewReport report={report} onEvidence={() => {}} onRetry={() => {}} />));
    await click(button('Xem chi tiết (0 nhận xét)'));
    expect(container.querySelectorAll('.manuscript-review-evidence')).toHaveLength(0);
    await click(button('Giọng kể, cá tính ngôn ngữ — 4/5'));
    expect(container.querySelectorAll('.manuscript-review-evidence')).toHaveLength(1);
  });

  it('separates each report title and score into a clear summary header', async () => {
    const report = { mode: 'literary', provider: 'test', model: 'test', created_at: new Date().toISOString(), rubric_version: '1.0', result: {
      score: 80, summary: 'Đoạn văn có giọng kể nhất quán.', findings: [], scores: [],
    } };
    await act(async () => root.render(<ReviewReport report={report} onEvidence={() => {}} onRetry={() => {}} />));

    const heading = container.querySelector('.manuscript-review-report-heading');
    const score = heading?.querySelector('.manuscript-review-score');
    const css = readFileSync('src/features/manuscriptReview/ManuscriptReview.css', 'utf8');
    const headingRule = css.match(/\.manuscript-review-report-heading\s*\{[^}]+\}/)?.[0] || '';
    const scoreRule = css.match(/\.manuscript-review-score\s*\{[^}]+\}/)?.[0] || '';

    expect(heading?.querySelector('h3')?.textContent).toBe('Chấm văn');
    expect(score?.textContent).toBe('80/100');
    expect(headingRule).toContain('background:');
    expect(scoreRule).toContain('border:');
  });

  it('saves only the analysis Settings choice without changing completion, global model or quality', async () => {
    const chapterPreference = JSON.stringify({ version: 1, scopes: { gemini_direct: { model: 'gemini-2.5-flash', prompted: true } } });
    localStorage.setItem('sf-chapter-completion-model-preferences', chapterPreference);
    await act(async () => root.render(<StrictMode><ManuscriptReviewModelSetting /></StrictMode>));
    const select = container.querySelector('select');
    await act(async () => { select.value = 'gemini-3.1-flash-lite-preview'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem(REVIEW_MODEL_PREFERENCE_KEY)).scopes.gemini_direct.model).toBe('gemini-3.1-flash-lite-preview');
    expect(localStorage.getItem('sf-chapter-completion-model-preferences')).toBe(chapterPreference);
    expect(modelRouter.getQualityMode()).toBe('best'); expect(modelRouter.getPreferredProvider()).toBe('gemini_direct');
  });

  it('confirms first use once and reruns directly with the independent saved choice', async () => {
    modelRouter.setPreferredProvider('ollama'); modelRouter.setOllamaModel('qwen3:small');
    const chatCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen3:small' }] }));
      chatCalls.push(JSON.parse(init.body));
      return new Response(`${JSON.stringify({ done: false, message: { content: JSON.stringify({ summary: 'Chưa thấy rõ tín hiệu.', signal_level: 'none', findings: [] }) } })}\n{"done":true}\n`);
    }));
    await render();
    await chooseMode('Dấu hiệu máy móc');
    await click(button('Chạy phân tích'));
    await act(async () => { await vi.waitFor(() => expect(button('Xác nhận và phân tích').disabled).toBe(false)); });
    expect(chatCalls).toHaveLength(0);
    await click(button('Xác nhận và phân tích'));
    await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); expect(button('Chạy phân tích').disabled).toBe(false); });
    expect(document.querySelector('.manuscript-review-dialog')).toBeNull();
    expect(chatCalls).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(REVIEW_MODEL_PREFERENCE_KEY)).scopes.ollama.prompted).toBe(true);
    expect(localStorage.getItem('sf-chapter-completion-model-preferences')).toBeNull();
    await click(button('Chạy phân tích'));
    await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); expect(button('Chạy phân tích').disabled).toBe(false); });
    expect(chatCalls).toHaveLength(2);
    expect(document.querySelector('.manuscript-review-dialog')).toBeNull();
    expect(await db.qaReports.count()).toBe(1);
  });

  it('blocks a changed manuscript in the first-use model dialog without saving or calling AI', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await render(); await click(button('Phân tích toàn diện'));
    await act(async () => editor.commands.insertContent('Đã đổi.'));
    await click(button('Xác nhận và phân tích'));
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Bản thảo đã đổi');
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(REVIEW_MODEL_PREFERENCE_KEY)).toBeNull();
  });

  it('restores reports on remount and marks silent Tiptap changes stale without hash-per-keystroke', async () => {
    const snapshot = createManuscriptSnapshot(editor, { project, scene });
    await db.qaReports.add({ project_id: 1, scene_id: 3, chapter_id: 2, scope: 'scene', mode: 'signals', report_type: 'manuscript_review:signals:scene', created_at: new Date().toISOString(),
      author_request: '', requirements: [], rubric_version: '1.0', provider: 'ollama', model: 'test',
      source_signature: await hashReviewValue(snapshot.paragraphs.map((item) => item.text)), scene_signature: await hashReviewValue(snapshot.sceneParagraphs), config_signature: await hashReviewValue(buildReviewContract(snapshot.context)),
      result: { summary: 'Báo cáo được khôi phục.', findings: [{ id: 'f1', criterion_id: 'repetition', severity: 'high', confidence: 0.9,
        explanation: 'Có đoạn lặp.', suggestion: 'Cân nhắc bỏ đoạn lặp.', evidence: [{ paragraph_id: 'p1', quote: 'Mưa' }] }], signal_level: 'high', score: null },
    });
    await render();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.textContent).toContain('Báo cáo được khôi phục.');
    expect(container.textContent).not.toContain('Báo cáo cũ');
    expect(container.textContent).toContain('Ưu tiên cân nhắc');
    const hashSpy = vi.spyOn(webcrypto.subtle, 'digest');
    await act(async () => editor.commands.setContent('<p>Nội dung mới từ thao tác editor.</p>', false));
    expect(container.textContent).toContain('Báo cáo cũ');
    expect(container.textContent).not.toContain('Ưu tiên cân nhắc');
    for (let i = 0; i < 10; i++) await act(async () => editor.commands.insertContent(' gõ'));
    expect(hashSpy).not.toHaveBeenCalled();
    const currentSource = JSON.stringify([editor.getText({ blockSeparator: '\n\n' })]);
    const notes = container.querySelector('textarea');
    for (const value of ['Cảnh', 'Cảnh tĩnh', 'Cảnh tĩnh nhé']) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(notes, value);
      notes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(hashSpy.mock.calls.filter(([, bytes]) => new TextDecoder().decode(bytes) === currentSource)).toHaveLength(0);
  });

  it('keeps a review running after the panel unmounts and persists its verified result', async () => {
    modelRouter.setPreferredProvider('ollama'); modelRouter.setOllamaModel('qwen3:small');
    saveManuscriptReviewModelPreference({ provider: 'ollama', model: 'qwen3:small' });
    let signal; let finish;
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((resolve, reject) => {
      signal = init.signal; finish = resolve;
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    })));
    await render();
    await chooseMode('Dấu hiệu máy móc');
    await click(button('Chạy phân tích'));
    await act(async () => { await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); });
    for (const label of ['Phạm vi phân tích', 'Phần phân tích']) {
      const control = container.querySelector(`[aria-label="${label}"]`);
      expect(control.disabled).toBe(true);
      await act(async () => control.click());
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    }
    await render({ active: false }); expect(signal.aborted).toBe(false);
    await act(async () => root.render(<div>Đã rời Editor</div>));
    expect(signal.aborted).toBe(false);
    await act(async () => {
      finish(new Response(`${JSON.stringify({ done: false, message: { content: JSON.stringify({ summary: 'Đã chạy xong ở nền.', signal_level: 'none', findings: [] }) } })}\n{"done":true}\n`));
      await vi.waitFor(async () => expect(await db.qaReports.count()).toBe(1));
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect((await db.qaReports.toArray())[0].result.summary).toBe('Đã chạy xong ở nền.');
  });

  it('uses the live selected text, allows typing while pending, persists verified findings and marks changed text stale', async () => {
    modelRouter.setPreferredProvider('ollama'); localStorage.setItem('sf-ollama-model', 'qwen3:small');
    saveManuscriptReviewModelPreference({ provider: 'ollama', model: 'qwen3:small' });
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.firstChild.nodeSize - 1 });
    let finish;
    const requests = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((resolve) => { finish = resolve; requests.push(JSON.parse(init.body)); })));
    const navigate = vi.fn();
    await render({ onNavigateEvidence: navigate });
    expect(container.querySelector('[aria-label="Phạm vi phân tích"]').value).toBe('selection');
    await chooseMode('Dấu hiệu máy móc');
    await click(button('Chạy phân tích'));
    await act(async () => { await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); });
    const userData = JSON.parse(requests[0].messages.find((message) => message.role === 'user').content);
    expect(userData.manuscript.map((item) => item.text).join('')).toBe('Mưa gõ mái hiên.');
    // A request does not lock the editor or write a result into it.
    await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Mới gõ.'));
    expect(editor.isEditable).toBe(true);
    await act(async () => {
      finish(new Response(`${JSON.stringify({ done: false, message: { content: JSON.stringify({ summary: 'Một nhận xét.', signal_level: 'low', findings: [{ criterion_id: 'generic_imagery', severity: 'low', explanation: 'Cân nhắc chi tiết.', suggestion: 'Thêm dấu ấn riêng.', confidence: 0.7, evidence: [{ paragraph_id: 'p1', quote: 'Mưa' }] }] }) } })}\n{"done":true}\n`));
      await vi.waitFor(async () => expect(await db.qaReports.count()).toBe(1));
      await vi.waitFor(() => expect(button('Chạy phân tích').disabled).toBe(false));
      await vi.waitFor(() => expect(container.textContent).toContain('Báo cáo cũ'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Báo cáo cũ');
    expect(editor.getText()).toContain('Mới gõ.');
    expect(editor.getText()).not.toContain('Thêm dấu ấn');
    await click(button('Xem chi tiết (1 nhận xét)'));
    await act(async () => {
      button('Xem bằng chứng: Mưa').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(() => expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('Mưa'));
    });
    expect(navigate).toHaveBeenCalledOnce();
    await render({ active: false });
    await render({ active: true });
    expect(container.textContent).toContain('Một nhận xét.');
  });
});
