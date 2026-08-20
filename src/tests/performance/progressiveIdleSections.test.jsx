import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useProgressiveIdleSections from '../../hooks/useProgressiveIdleSections.js';

describe('progressive idle section mounting', () => {
  let container;
  let root;
  let idleCallbacks;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    idleCallbacks = [];
    window.requestIdleCallback = vi.fn((callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    window.cancelIdleCallback = vi.fn();
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    delete window.requestIdleCallback;
    delete window.cancelIdleCallback;
    container.remove();
  });

  it('mounts one below-fold section per idle slice', async () => {
    function Harness() {
      const visibleSections = useProgressiveIdleSections(3);
      return <output>{visibleSections}</output>;
    }

    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toBe('0');

    await act(async () => idleCallbacks.shift()({ didTimeout: false, timeRemaining: () => 8 }));
    expect(container.textContent).toBe('1');
    expect(idleCallbacks).toHaveLength(1);

    await act(async () => idleCallbacks.shift()({ didTimeout: false, timeRemaining: () => 8 }));
    expect(container.textContent).toBe('2');
  });
});
