import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadRuntimeContext(files, extraContext = {}) {
  const context = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    ...extraContext,
  };
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });
  return context;
}

describe('Lab Lite Phase 10 - translator Canon Pack mode', () => {
  it('compacts Canon Pack into translator instructions with glossary, names, style, and restrictions', () => {
    const context = loadRuntimeContext(['public/translator-runtime/js/canon-pack.js']);
    const prompt = context.buildCanonPackTranslatorPrompt({
      title: 'Pack',
      characterCanon: [{ name: 'Lan', aliases: ['A Lan'], voice: 'calm' }],
      relationshipCanon: [{ characterA: 'Lan', characterB: 'Kha', relation: 'ally', change: 'fragile trust' }],
      styleCanon: { tone: 'restrained', observations: ['short dialogue'] },
      globalCanon: { worldRules: ['The shrine seal is closed.'] },
      canonRestrictions: ['Kha is missing.'],
      metadata: {
        worldUpdates: [
          { type: 'term', name: 'Linh lực', description: 'spiritual energy' },
          { type: 'location', name: 'Đền Cũ', description: 'old shrine' },
        ],
      },
    });

    expect(prompt).toContain('[CANON PACK TRANSLATION CONTEXT]');
    expect(prompt).toContain('Lan');
    expect(prompt).toContain('Linh lực');
    expect(prompt).toContain('restrained');
    expect(prompt).toContain('Kha is missing.');
    expect(prompt.length).toBeLessThan(7000);
  });

  it('injects Canon Pack prompt once and preserves the base translator prompt', () => {
    const context = loadRuntimeContext(['public/translator-runtime/js/canon-pack.js']);
    const base = 'Translate naturally.\n';
    const canon = '[CANON PACK TRANSLATION CONTEXT]\nNames: Lan\n';

    const once = context.applyCanonPackPromptToTranslatorPrompt(base, canon);
    const twice = context.applyCanonPackPromptToTranslatorPrompt(once, canon);

    expect(once).toContain(base.trim());
    expect(once.match(/\[CANON PACK TRANSLATION CONTEXT\]/g)).toHaveLength(1);
    expect(twice.match(/\[CANON PACK TRANSLATION CONTEXT\]/g)).toHaveLength(1);
  });

  it('loads Canon Packs from StoryForgeLabLiteDB through native IndexedDB contract', async () => {
    const openedNames = [];
    const fakeRequest = {};
    const fakeDb = {
      transaction(storeName) {
        expect(storeName).toBe('canonPacks');
        return {
          objectStore() {
            return {
              getAll() {
                const request = {};
                setTimeout(() => request.onsuccess?.({ target: { result: [{ id: 'pack_1', title: 'Pack 1' }] } }), 0);
                return request;
              },
            };
          },
        };
      },
    };
    const context = loadRuntimeContext(['public/translator-runtime/js/canon-pack.js'], {
      indexedDB: {
        open(name) {
          openedNames.push(name);
          setTimeout(() => fakeRequest.onsuccess?.({ target: { result: fakeDb } }), 0);
          return fakeRequest;
        },
      },
    });

    const packs = await context.loadStoryForgeCanonPacks();
    expect(openedNames).toEqual(['StoryForgeLabLiteDB']);
    expect(packs).toEqual([{ id: 'pack_1', title: 'Pack 1' }]);
  });
});
