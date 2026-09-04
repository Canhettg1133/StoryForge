import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Corpus Lab Gemini Direct model catalog', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
  });

  it('shows fetched and manual Gemini Direct models instead of the legacy preset list', async () => {
    const { default: modelRouter } = await import('../../services/ai/router.js');
    modelRouter.setDirectModelCatalog([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', source: 'fetched' },
      { id: 'gemma-3-27b-it', label: 'Gemma 3 27B', source: 'fetched' },
    ]);
    modelRouter.setDirectModel('gemini-writing-preview');

    const { default: AnalysisConfig } = await import('../../pages/Lab/CorpusLab/components/AnalysisConfig.jsx');
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AnalysisConfig
          corpus={{ wordCount: 1000, chunkCount: 1 }}
          config={{
            provider: 'gemini_direct',
            model: 'gemini-writing-preview',
            runMode: 'balanced',
            maxParts: 3,
            temperature: 0.2,
            layers: ['l1'],
            geminiDirectApiKeys: [],
            geminiProxyApiKeys: [],
          }}
          onChange={() => {}}
        />,
      );
    });

    const modelSelect = [...container.querySelectorAll('select')]
      .find((select) => select.parentElement?.querySelector('span')?.textContent === 'Mô hình');
    expect([...modelSelect.options].map((option) => option.value)).toEqual([
      'gemini-writing-preview',
      'gemini-2.5-flash',
      'gemma-3-27b-it',
    ]);
  });
});
