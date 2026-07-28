import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import AutoResizeTextarea, {
  resizeTextareaToContent,
} from '../../components/common/AutoResizeTextarea.jsx';

describe('phase10 AutoResizeTextarea', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
  });

  async function renderTextarea() {
    let updatePrompt;

    function Harness() {
      const [value, setValue] = useState('');
      updatePrompt = setValue;

      return (
        <AutoResizeTextarea
          aria-label="Prompt"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={{ maxHeight: '120px' }}
        />
      );
    }

    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    return {
      textarea: container.querySelector('textarea'),
      updatePrompt,
    };
  }

  it('expands to content height and hides overflow while under max height', async () => {
    const { textarea, updatePrompt } = await renderTextarea();
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 96,
    });

    await act(async () => {
      updatePrompt('Prompt ngắn');
    });

    expect(textarea.style.height).toBe('96px');
    expect(textarea.style.overflowY).toBe('hidden');
  });

  it('caps very long prompt content at max height and enables internal scroll', async () => {
    const { textarea, updatePrompt } = await renderTextarea();
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 240,
    });

    await act(async () => {
      updatePrompt('Prompt dài\n'.repeat(30));
    });

    expect(textarea.style.height).toBe('120px');
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('does not let a long placeholder inflate an empty field', async () => {
    const { textarea } = await renderTextarea();
    textarea.setAttribute('placeholder', 'Gợi ý rất dài '.repeat(20));
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => textarea.hasAttribute('placeholder') ? 180 : 38,
    });

    resizeTextareaToContent(textarea);

    expect(textarea.style.height).toBe('38px');
    expect(textarea.placeholder).toContain('Gợi ý rất dài');
  });
});
