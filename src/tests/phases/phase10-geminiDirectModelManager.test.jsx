import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import keyManager from '../../services/ai/keyManager.js';
import modelRouter, { PROVIDERS } from '../../services/ai/router.js';
import GeminiDirectModelManager from '../../pages/Settings/GeminiDirectModelManager.jsx';

function setInputValue(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Settings Gemini Direct model manager', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    keyManager.replaceKeys(PROVIDERS.GEMINI_DIRECT, ['direct-key-for-test']);
    modelRouter.setDirectModelCatalog([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'fetched' },
    ]);
    modelRouter.setDirectModel('gemini-2.5-flash');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    keyManager.replaceKeys(PROVIDERS.GEMINI_DIRECT, []);
    vi.restoreAllMocks();
  });

  it('keeps the current model when a fetched catalog no longer contains it, then selects an exact fetched model', async () => {
    const fetchModels = vi.fn().mockResolvedValue([
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', source: 'fetched' },
    ]);
    await act(async () => root.render(<GeminiDirectModelManager fetchModels={fetchModels} />));

    await act(async () => [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Lấy models')).click());

    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'direct-key-for-test',
      signal: expect.any(AbortSignal),
    }));
    expect(modelRouter.getDirectModel()).toBe('gemini-2.5-flash');
    expect(modelRouter.getDirectModelCatalog()).toEqual([
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', source: 'fetched' },
    ]);
    expect(container.querySelector('[role="status"]').textContent)
      .toContain('vẫn giữ model hiện tại');

    const select = container.querySelector('select[aria-label="Chọn model Gemini Direct"]');
    expect([...select.options].map((option) => option.value))
      .toEqual(['gemini-2.5-flash', 'gemma-3-27b-it']);
    await act(async () => {
      select.value = 'gemma-3-27b-it';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(modelRouter.getDirectModel()).toBe('gemma-3-27b-it');
  });

  it('preserves the saved catalog and model after a recoverable fetch error', async () => {
    const fetchModels = vi.fn().mockRejectedValue(new Error('offline secret-key'));
    await act(async () => root.render(<GeminiDirectModelManager fetchModels={fetchModels} />));

    await act(async () => [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Lấy models')).click());

    expect(modelRouter.getDirectModel()).toBe('gemini-2.5-flash');
    expect(modelRouter.getDirectModelCatalog()).toEqual([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'fetched' },
    ]);
    expect(container.querySelector('[role="alert"]').textContent).toContain('Không lấy được danh sách model');
    expect(container.querySelector('[role="alert"]').textContent).not.toContain('secret-key');
  });

  it('normalizes and persists a manual model as unverified', async () => {
    await act(async () => root.render(<GeminiDirectModelManager />));

    const input = container.querySelector('input[aria-label="Nhập model Gemini Direct thủ công"]');
    await act(async () => {
      setInputValue(input, ' models/gemma-3-12b-it ');
    });
    await act(async () => [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Dùng model nhập tay')).click());

    expect(modelRouter.getDirectModel()).toBe('gemma-3-12b-it');
    expect(container.querySelector('[role="status"]').textContent).toContain('chưa xác minh');
  });

  it('aborts an in-flight ListModels request when the panel unmounts', async () => {
    let requestSignal;
    const fetchModels = vi.fn(({ signal }) => {
      requestSignal = signal;
      return new Promise(() => {});
    });
    await act(async () => root.render(<GeminiDirectModelManager fetchModels={fetchModels} />));
    await act(async () => [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Lấy models')).click());

    expect(requestSignal.aborted).toBe(false);
    await act(async () => root.render(<div>Đã đổi provider</div>));
    expect(requestSignal.aborted).toBe(true);
  });
});
