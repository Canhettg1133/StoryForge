import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function runRuntimeFile(context, relativePath) {
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    context,
    { filename: relativePath }
  );
}

function createGeminiContext(responseData) {
  const warnings = [];
  const requests = [];
  const context = {
    AbortController,
    clearTimeout,
    setTimeout,
    cancelRequested: false,
    cleanGeminiResponse: (text) => text,
    console: {
      error() {},
      log() {},
      warn(message) {
        warnings.push(message);
      },
    },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => responseData,
      };
    },
    registerActiveRequestController() {},
    unregisterActiveRequestController() {},
    useProxy: false,
    validateTranslationOutput: () => ({ valid: true }),
    warnings,
    requests,
  };

  vm.createContext(context);
  runRuntimeFile(context, 'public/translator-runtime/js/translation/errors.js');
  runRuntimeFile(context, 'public/translator-runtime/js/gemini/api.js');
  return context;
}

describe('translator Gemini prohibited-content diagnostics', () => {
  it('classifies PROHIBITED_CONTENT only from Gemini promptFeedback', async () => {
    const context = createGeminiContext({
      promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
    });
    const translateChunk = vm.runInContext('translateChunk', context);

    const promptedChunk = 'Translate faithfully\n\n[Đoạn nguồn]\ntext';
    await expect(translateChunk(promptedChunk, {
      model: 'gemini-2.5-flash',
      key: 'test-key',
      keyIndex: 0,
    })).rejects.toMatchObject({
      code: 'CONTENT_BLOCKED_PROHIBITED',
      blockReason: 'PROHIBITED_CONTENT',
      retryable: false,
    });

    expect(context.warnings).toContain(
      '[Gemini API] Prompt blocked with blockReason=PROHIBITED_CONTENT'
    );
    expect(context.requests[0].safetySettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threshold: 'OFF' }),
      ])
    );
    expect(context.requests[0].systemInstruction.parts[0].text).toBe('Translate faithfully');
    expect(context.requests[0].contents[0].parts[0].text).toBe(promptedChunk);
  });

  it('uses emphatic first and literary second, then propagates the final prohibited-content error', async () => {
    const sentPrompts = [];
    const context = {
      cancelRequested: false,
      console: { error() {}, log() {}, warn() {} },
      document: {
        getElementById: () => ({ value: 'BASE' }),
      },
      getFictionalPrompt: (text) => `FICTIONAL:${text}`,
      normalizeTranslatorError: (error) => error,
      PROMPT_ENHANCERS: {
        emphatic: ':EMPHATIC',
        literary: 'LITERARY:',
      },
      recordKeySuccess() {},
      sanitizeTranslatorPromptText: (text) => text,
      sendDirectTranslationAttempt: async ({ text }) => {
        sentPrompts.push(text);
        const error = new Error('Nội dung bị Gemini chặn theo chính sách.');
        error.code = 'CONTENT_BLOCKED_PROHIBITED';
        error.rawMessage = 'PROHIBITED_CONTENT';
        error.retryable = false;
        error.modelKeyPairUsed = {
          model: 'gemini-2.5-flash',
          key: 'test-key',
          keyIndex: 0,
        };
        throw error;
      },
      sleep: async () => {},
      trackChunkRetry() {},
      updateTranslationRuntimeStatus() {},
      useOllama: false,
      useProxy: false,
    };

    vm.createContext(context);
    runRuntimeFile(context, 'public/translator-runtime/js/translation/request-contract.js');
    runRuntimeFile(context, 'public/translator-runtime/js/translation/retry.js');
    const translateChunkWithRetry = vm.runInContext('translateChunkWithRetry', context);

    await expect(translateChunkWithRetry('BASE\n\n[Đoạn nguồn]\ntext', 0, 3))
      .rejects.toMatchObject({ code: 'CONTENT_BLOCKED_PROHIBITED' });
    expect(sentPrompts).toHaveLength(3);
    expect(sentPrompts[0]).toMatchObject({ sourceText: 'text' });
    expect(sentPrompts[0].systemText).toContain('BASE');
    expect(sentPrompts[1].systemText).toContain(':EMPHATIC');
    expect(sentPrompts[1].systemText).not.toContain('LITERARY:');
    expect(sentPrompts[2].systemText).toContain('LITERARY:');
    expect(sentPrompts[2].systemText).toContain(':EMPHATIC');
  });

  it('must propagate the final prohibited-content error instead of fulfilling undefined', async () => {
    const context = {
      cancelRequested: false,
      console: { error() {}, log() {}, warn() {} },
      document: { getElementById: () => ({ value: '' }) },
      normalizeTranslatorError: (error) => error,
      recordKeySuccess() {},
      sendDirectTranslationAttempt: async () => {
        const error = new Error('Nội dung bị Gemini chặn theo chính sách.');
        error.code = 'CONTENT_BLOCKED_PROHIBITED';
        error.rawMessage = 'PROHIBITED_CONTENT';
        error.retryable = false;
        error.modelKeyPairUsed = {
          model: 'gemini-2.5-flash',
          key: 'test-key',
          keyIndex: 0,
        };
        throw error;
      },
      sleep: async () => {},
      trackChunkRetry() {},
      useOllama: false,
      useProxy: false,
    };

    vm.createContext(context);
    runRuntimeFile(context, 'public/translator-runtime/js/translation/retry.js');
    const translateChunkWithRetry = vm.runInContext('translateChunkWithRetry', context);

    await expect(translateChunkWithRetry('[Đoạn nguồn]\ntext', 0, 1))
      .rejects.toMatchObject({ code: 'CONTENT_BLOCKED_PROHIBITED' });
  });
});
