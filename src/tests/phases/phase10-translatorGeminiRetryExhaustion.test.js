import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const runtimeRoot = path.join(process.cwd(), 'public/translator-runtime');

function loadRuntime(output) {
  const requests = [];
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    sleep: async () => {}, showToast() {},
    fetch: async (url) => {
      requests.push(new URL(url).searchParams.get('key'));
      return { ok: true, status: 200, json: async () => ({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }],
      }) };
    },
  });
  for (const file of [
    'js/app.js', 'js/translation/request-contract.js', 'js/translation/errors.js',
    'js/gemini/model-rotation.js', 'js/gemini/api.js', 'js/translation/retry.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(runtimeRoot, file), 'utf8'), context, { filename: file });
  }
  vm.runInContext(`
    apiKeys = ['FAKE-KEY-1', 'FAKE-KEY-2', 'FAKE-KEY-3', 'FAKE-KEY-4', 'FAKE-KEY-5', 'FAKE-KEY-6'];
    GEMINI_MODELS = [{ name: 'gemini-diagnostic-model', enabled: true }];
    useProxy = false; useOllama = false; rpmPerKey = 10; cancelRequested = false;
  `, context);
  return { context, requests };
}

describe('Gemini retry exhaustion', () => {
  const sourceText = '她走到门前，轻轻敲门。'.repeat(20);
  const vietnamese = 'Nàng bước tới cửa, nhẹ nhàng gõ ba tiếng. '.repeat(20);
  const cases = [
    ['NO_VIETNAMESE', 'The door was closed and she waited outside. '.repeat(20)],
    ['ERROR_MARKER', `[LỖI DỊCH] ${vietnamese}`],
    ['PROMPT_LEAK', `INTERNAL SYSTEM DIRECTIVE\n${vietnamese}`],
  ];

  it.each(cases)('rejects with %s after the last invalid response', async (code, output) => {
    const { context, requests } = loadRuntime(output);
    const validation = context.validateTranslationOutput(sourceText, output);
    expect(validation).toMatchObject({ valid: false, errorCode: code });

    await expect(context.translateChunkWithRetry(
      { systemText: 'Dịch sang tiếng Việt.', userText: sourceText, sourceText },
      0,
      3,
    )).rejects.toMatchObject({ code });
    expect(requests).toEqual(['FAKE-KEY-1', 'FAKE-KEY-2', 'FAKE-KEY-3']);
  });

  it('propagates OUTPUT_TOO_SHORT after the last attempt as the contrasting correct path', async () => {
    const { context, requests } = loadRuntime('Ngắn.');
    await expect(context.translateChunkWithRetry({ systemText: '', userText: sourceText, sourceText }, 0, 3))
      .rejects.toMatchObject({ code: 'OUTPUT_TOO_SHORT' });
    expect(requests).toHaveLength(3);
  });
});
