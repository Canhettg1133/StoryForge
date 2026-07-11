import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { indexedDB } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function loadHistoryRuntime() {
  document.body.innerHTML = '<div id="historyList"></div><span id="historyCount"></span>';
  const context = {
    Blob,
    Date,
    FileReader,
    Math,
    TextEncoder,
    URL,
    confirm: vi.fn(() => true),
    console,
    crypto: globalThis.crypto,
    document,
    indexedDB,
    localStorage,
    setTimeout,
    showToast: vi.fn(),
    translationHistory: [],
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    readFileSync(resolve(process.cwd(), 'public/translator-runtime/js/history/history.js'), 'utf8'),
    context,
  );
  return context;
}

describe('translator history import security', () => {
  beforeEach(() => {
    localStorage.clear();
    delete globalThis.__translatorHistoryXss;
  });

  it('allowlists imported fields, regenerates ids, and renders without inline handlers', () => {
    const runtime = loadHistoryRuntime();
    const attackerId = "x');globalThis.__translatorHistoryXss=true;//";
    const normalized = runtime.normalizeHistoryItems([{
      id: attackerId,
      name: '"><img src=x onerror="globalThis.__translatorHistoryXss=true">',
      date: 'not-a-date',
      originalText: 'source',
      translatedText: 'result',
      completedChunks: '1',
      totalChunks: '2',
      translatedChunksData: ['done', { injected: true }],
      sessionId: 'session-1',
      isComplete: 'false',
      unknown: { retained: true },
    }], { regenerateIds: true });

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).not.toBe(attackerId);
    expect(normalized[0]).not.toHaveProperty('unknown');
    expect(normalized[0].completedChunks).toBe(1);
    expect(normalized[0].totalChunks).toBe(2);
    expect(normalized[0].translatedChunksData).toEqual(['done', null]);
    expect(normalized[0].isComplete).toBe(false);
    expect(Number.isNaN(Date.parse(normalized[0].date))).toBe(false);

    runtime.translationHistory = normalized;
    runtime.renderHistoryList();

    const container = document.getElementById('historyList');
    expect(container.querySelectorAll('[onclick],[onerror],[onload]')).toHaveLength(0);
    expect(container.querySelector('[data-history-id]')?.getAttribute('data-history-id')).toBe(normalized[0].id);
    expect(container.textContent).toContain('<img src=x onerror=');
    expect(globalThis.__translatorHistoryXss).toBeUndefined();
  });
});
