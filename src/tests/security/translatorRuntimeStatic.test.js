import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('translator runtime static hardening', () => {
  it('loads cache cleanup from an external script instead of an inline script block', () => {
    const html = read('public/translator-runtime/index.html');
    expect(html).toContain('<script src="js/cache-cleanup.js?v=1"></script>');
    expect(html).not.toContain('Clear translator PWA caches from previous embedded builds');
    expect(read('public/translator-runtime/js/cache-cleanup.js')).toContain('clearTranslatorRuntimeCaches');
  });
});
