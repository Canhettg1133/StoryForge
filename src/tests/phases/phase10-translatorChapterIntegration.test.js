import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = relativePath => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Translator chapter feature integration', () => {
  it('loads isolated chapter modules before delegated init without loading JSZip in the page', () => {
    const html = read('public/translator-runtime/index.html');
    const chapterFeatureAt = html.indexOf('js/chapter/chapter-feature.js');
    const initAt = html.indexOf('js/init.js');

    expect(chapterFeatureAt).toBeGreaterThan(0);
    expect(initAt).toBeGreaterThan(chapterFeatureAt);
    expect(html).toContain('chapter-reader.css');
    expect(html).not.toContain('vendor/jszip.min.js');
    expect(read('public/translator-runtime/js/chapter/chapter-worker.js')).toContain("importScripts('../../vendor/jszip.min.js')");
  });

  it('routes every reader control through the existing delegated action maps', () => {
    const html = read('public/translator-runtime/index.html');
    const init = read('public/translator-runtime/js/init.js');
    const actions = [...html.matchAll(/data-(?:click|change)-action="([^"]+)"/g)]
      .map(match => match[1])
      .filter(action => /Chapter|Reader|Epub/.test(action));

    expect(actions.length).toBeGreaterThan(10);
    for (const action of new Set(actions)) expect(init, action).toContain(`${action}:`);
  });

  it('resets the worker/cache on file replacement and clear, and bumps the iframe cache key', () => {
    const fileHandler = read('public/translator-runtime/js/ui/file-handler.js');
    const host = read('src/components/translator/PersistentTranslatorHost.jsx');

    expect(fileHandler.match(/TranslatorChapterFeature\?\.reset\(\)/g)).toHaveLength(2);
    expect(host).toContain('/translator-runtime/index.html?v=28');
  });

  it('keeps mobile, reduced-motion and bounded-reader guards in the isolated UI assets', () => {
    const css = read('public/translator-runtime/chapter-reader.css');
    const feature = read('public/translator-runtime/js/chapter/chapter-feature.js');

    expect(css).toContain('@media (max-width: 800px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(feature).toContain('const TOC_MAX_ROWS = 60');
    expect(feature).toContain('const PAGE_BYTES = 256 * 1024');
  });
});
