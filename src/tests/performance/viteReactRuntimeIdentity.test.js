// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { loadConfigFromFile } from 'vite';

describe('Vite React runtime identity', () => {
  it('deduplicates React and eagerly optimizes React hook consumers', async () => {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      './vite.config.js',
    );

    expect(loaded?.config?.resolve?.dedupe).toEqual(
      expect.arrayContaining(['react', 'react-dom']),
    );
    expect(loaded?.config?.optimizeDeps?.include).toEqual(
      expect.arrayContaining([
        'react',
        'react-dom',
        'react-dom/client',
        '@tanstack/react-virtual',
        '@tiptap/react',
      ]),
    );
  });
});
