import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('outline collection virtualization', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container.remove();
  });

  it('keeps a 1,000 chapter outline stack bounded', async () => {
    const { VirtualOutlineStack } = await import('../../pages/OutlineBoard/VirtualOutlineCollection.jsx');
    const chapters = Array.from({ length: 1_000 }, (_, index) => ({ id: index + 1 }));

    root = createRoot(container);
    await act(async () => root.render(
      <VirtualOutlineStack
        className="outline-list"
        items={chapters}
        estimateSize={() => 64}
        renderItem={(chapter) => <div className="test-outline-row">{chapter.id}</div>}
      />,
    ));

    expect(container.querySelectorAll('.test-outline-row').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.test-outline-row').length).toBeLessThan(30);
  });

  it('keeps a 1,000 chapter responsive outline grid bounded', async () => {
    const { VirtualOutlineGrid } = await import('../../pages/OutlineBoard/VirtualOutlineCollection.jsx');
    const chapters = Array.from({ length: 1_000 }, (_, index) => ({ id: index + 1 }));

    root = createRoot(container);
    await act(async () => root.render(
      <VirtualOutlineGrid
        className="outline-unassigned-list"
        items={chapters}
        minColumnWidth={260}
        estimateSize={() => 180}
        renderItem={(chapter) => <div className="test-outline-card">{chapter.id}</div>}
      />,
    ));

    expect(container.querySelectorAll('.test-outline-card').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.test-outline-card').length).toBeLessThan(40);
  });
});
