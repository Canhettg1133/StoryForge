import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CharacterTraitPicker from '../../pages/CharacterHub/CharacterTraitPicker.jsx';

function setInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('phase10 CharacterTraitPicker', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  async function renderPicker(props = {}) {
    root = createRoot(container);
    await act(async () => {
      root.render(<CharacterTraitPicker value="" onChange={() => {}} {...props} />);
    });
  }

  it('suggests Tomboy while typing tom and adds it to the stored value', async () => {
    const onChange = vi.fn();
    await renderPicker({ onChange });

    const search = container.querySelector('[data-testid="character-trait-search"]');
    await act(async () => setInputValue(search, 'tom'));

    const tomboy = Array.from(container.querySelectorAll('.character-trait-suggestion'))
      .find((button) => button.textContent.includes('Tomboy'));
    expect(tomboy).toBeDefined();

    await act(async () => tomboy.click());
    expect(onChange).toHaveBeenCalledWith('Tomboy');
  });

  it('keeps adult suggestions unlocked without checking the age field', async () => {
    await renderPicker({ age: '16, thiếu niên' });

    const adultCategory = container.querySelector('[data-category="adult"]');
    expect(adultCategory?.getAttribute('aria-disabled')).toBeNull();
    await act(async () => adultCategory.click());
    expect(container.textContent).toContain('Thống trị (Dominant)');
    expect(container.textContent).not.toContain('chỉ dành cho nhân vật trưởng thành');
  });
});
