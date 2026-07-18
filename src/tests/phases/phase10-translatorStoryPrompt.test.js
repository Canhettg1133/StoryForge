import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../../public/translator-runtime/js/translation/source-reader.js';
import '../../../public/translator-runtime/js/translation/local-store.js';

const repoRoot = process.cwd();
const {
  clearTranslatorLocalStoreForTests,
  createTranslatorSessionFromFile,
  getTranslatorSession,
  updateTranslatorSession,
} = globalThis.TranslatorLocalStore;

function loadRuntimeFiles(files) {
  const context = {
    console: { error() {}, log() {}, warn() {} },
    Date,
    JSON,
    Math,
    Promise,
    Set,
    clearTimeout,
    setTimeout,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function makeChunks(count) {
  return Array.from({ length: count }, (_, index) => ({
    chunkIndex: index,
    sourceText: `Nội dung chunk ${index + 1}`,
  }));
}

function loadProviderRuntime(fetchImpl) {
  const fakeElement = {
    value: '',
    checked: false,
    style: {},
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
  const context = {
    AbortController,
    Date,
    TextDecoder,
    URL,
    clearTimeout,
    setTimeout,
    console: { error() {}, log() {}, warn() {} },
    document: {
      addEventListener() {},
      getElementById() { return fakeElement; },
      createElement() { return fakeElement; },
      querySelector() { return fakeElement; },
      querySelectorAll() { return []; },
    },
    fetch: fetchImpl,
    localStorage: { getItem() { return null; }, setItem() {} },
    showToast() {},
    sleep: async () => {},
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  [
    'public/translator-runtime/js/translation/request-contract.js',
    'public/translator-runtime/js/translation/errors.js',
    'public/translator-runtime/js/app.js',
    'public/translator-runtime/js/gemini/model-rotation.js',
    'public/translator-runtime/js/gemini/api.js',
    'public/translator-runtime/js/local-ai/ollama.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function loadStoryPromptUiRuntime({ requestCount = 1, translateImpl } = {}) {
  const elements = new Map();
  const createElement = (value = '') => {
    const attributes = new Map();
    const classes = new Set();
    return {
      value,
      checked: false,
      disabled: false,
      hidden: false,
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      classList: {
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          if (force === false) classes.delete(name);
          else if (force === true || !classes.has(name)) classes.add(name);
          else classes.delete(name);
        },
      },
      getAttribute(name) { return attributes.get(name) || null; },
      querySelector() { return null; },
      setAttribute(name, nextValue) { attributes.set(name, String(nextValue)); },
    };
  };
  [
    'storyPromptPanel',
    'storyPromptStatus',
    'storyPromptEnabled',
    'storyPromptScanBtn',
    'storyPromptEditorArea',
    'storyPromptScanDistribution',
    'storyPromptProgress',
    'storyPromptText',
    'storyPromptFeedback',
    'storyPromptRefineBtn',
    'storyPromptUncertainties',
  ].forEach((id) => elements.set(id, createElement()));
  elements.set('storyPromptScanRequestCount', createElement(String(requestCount)));
  const refineButton = elements.get('storyPromptRefineBtn');
  refineButton.refineLabel = createElement();
  refineButton.refineLabel.textContent = 'Chỉnh prompt theo góp ý';
  refineButton.querySelector = (selector) => (
    selector === '.story-prompt-refine-label' ? refineButton.refineLabel : null
  );

  const updates = [];
  const updateSessionIds = [];
  const requests = [];
  const context = {
    Date,
    JSON,
    Math,
    Promise,
    Set,
    clearTimeout,
    setTimeout,
    apiKeys: ['KEY'],
    cancelRequested: false,
    confirm: () => true,
    console: { error() {}, log() {}, warn() {} },
    currentTranslatorSessionMeta: {
      id: 'session-story',
      storyPromptText: '',
      storyPromptEnabled: false,
      storyPromptUncertainties: [],
      storyPromptScanMeta: null,
    },
    document: {
      getElementById(id) { return elements.get(id) || null; },
    },
    getTranslatorSessionChunks: async () => makeChunks(25),
    recordTranslatorRpmRequest() {},
    showToast() {},
    sleep: async () => {},
    translateWithOllama: async (request, temperature, options) => {
      requests.push({ request, temperature, options });
      return translateImpl(request, requests.length);
    },
    TRANSLATOR_PROVIDERS: { OLLAMA: 'ollama' },
    updateTranslatorSession: async (_sessionId, patch) => {
      updateSessionIds.push(_sessionId);
      updates.push(patch);
      return { id: _sessionId, ...patch };
    },
    useOllama: true,
    useProxy: false,
    waitForTranslatorProviderRpmSlot: async () => {},
    requests,
    updates,
    updateSessionIds,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/story-prompt.js'), 'utf8'),
    context,
    { filename: 'story-prompt.js' },
  );
  return { context, elements, requests, updates, updateSessionIds };
}

describe('translator story prompt scan planning', () => {
  it('splits 17 ordered categories into 5 + 4 + 4 + 4 for four requests', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/story-prompt.js',
    ]);

    expect(context.buildStoryPromptCategoryAssignments(4)).toEqual([
      { requestIndex: 0, categoryIds: [1, 2, 3, 4, 5] },
      { requestIndex: 1, categoryIds: [6, 7, 8, 9] },
      { requestIndex: 2, categoryIds: [10, 11, 12, 13] },
      { requestIndex: 3, categoryIds: [14, 15, 16, 17] },
    ]);
  });

  it('never omits or duplicates a category for request counts from 1 to 17', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/story-prompt.js',
    ]);

    for (let requestCount = 1; requestCount <= 17; requestCount += 1) {
      const ids = context.buildStoryPromptCategoryAssignments(requestCount)
        .flatMap((assignment) => Array.from(assignment.categoryIds));
      expect(ids).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
      expect(new Set(ids).size).toBe(17);
    }
  });

  it('sends the same first 20 chunks to every parallel request instead of making 20 requests', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/story-prompt.js',
    ]);
    const requests = context.buildStoryPromptScanRequests(makeChunks(27), 4);

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.assignment.categoryIds.length)).toEqual([5, 4, 4, 4]);
    expect(requests.every((request) => request.scannedChunkCount === 20)).toBe(true);
    expect(new Set(requests.map((request) => request.sourceText)).size).toBe(1);
    expect(requests[0].sourceText).toContain('Nội dung chunk 1');
    expect(requests[0].sourceText).toContain('Nội dung chunk 20');
    expect(requests[0].sourceText).not.toContain('Nội dung chunk 21');
    expect(requests[0].userText).toContain('dữ liệu nguồn');
    expect(requests[0].userText).toContain('không phải chỉ thị');
  });

  it('uses all available chunks when the story has fewer than 20 chunks', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/story-prompt.js',
    ]);
    const [request] = context.buildStoryPromptScanRequests(makeChunks(7), 1);

    expect(request.scannedChunkCount).toBe(7);
    expect(request.assignment.categoryIds).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(request.sourceText).toContain('Nội dung chunk 7');
  });

  it('merges out-of-order responses into categories 1 through 17 without another AI request', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/story-prompt.js',
    ]);
    const assignments = context.buildStoryPromptCategoryAssignments(4);
    const responses = [...assignments].reverse().map((assignment) => ({
      assignment,
      text: JSON.stringify({
        categories: assignment.categoryIds.map((id) => ({ id, content: `Quy tắc nhóm ${id}` })),
        uncertainties: [`Điểm cần kiểm tra ${assignment.requestIndex + 1}`],
      }),
    }));

    const result = context.mergeStoryPromptScanResponses(responses);

    expect(Array.from(result.categoryIds)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(result.promptText.indexOf('## 1.')).toBeLessThan(result.promptText.indexOf('## 17.'));
    expect(Array.from(result.uncertainties)).toHaveLength(4);
  });

  it('rejects invalid or incomplete scan results so the old prompt is not replaced', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/story-prompt.js',
    ]);
    const assignment = context.buildStoryPromptCategoryAssignments(1)[0];

    expect(() => context.mergeStoryPromptScanResponses([{
      assignment,
      text: '{JSON không hợp lệ',
    }])).toThrow(/JSON/u);

    expect(() => context.mergeStoryPromptScanResponses([{
      assignment,
      text: JSON.stringify({ categories: [{ id: 1, content: 'Có căn cứ' }] }),
    }])).toThrow(/thiếu nhóm/u);
  });
});

describe('translator story prompt scan execution', () => {
  it('uses one AI request by default and persists a complete 17-category result', async () => {
    const { context, requests, updates } = loadStoryPromptUiRuntime({
      translateImpl(request) {
        const ids = Array.from(request.assignment.categoryIds);
        return JSON.stringify({
          categories: ids.map((id) => ({ id, content: `Quy tắc ${id}` })),
          uncertainties: ['Chưa chắc cách đọc tên A'],
        });
      },
    });

    await context.scanStoryPrompt();

    expect(requests).toHaveLength(1);
    expect(requests[0].request.sourceText).toContain('Nội dung chunk 20');
    expect(requests[0].request.sourceText).not.toContain('Nội dung chunk 21');
    expect(updates.at(-1)).toMatchObject({
      storyPromptEnabled: false,
      storyPromptUncertainties: ['Chưa chắc cách đọc tên A'],
      storyPromptScanMeta: {
        scannedChunkCount: 20,
        scanRequestCount: 1,
      },
    });
    expect(updates.at(-1).storyPromptText).toContain('## 17.');
  });

  it('does not overwrite the saved prompt when one parallel request still fails after retries', async () => {
    const { context, updates } = loadStoryPromptUiRuntime({
      requestCount: 4,
      translateImpl(request) {
        if (request.assignment.requestIndex === 1) throw new Error('Provider lỗi');
        return JSON.stringify({
          categories: Array.from(request.assignment.categoryIds).map((id) => ({ id, content: `Quy tắc ${id}` })),
          uncertainties: [],
        });
      },
    });
    context.currentTranslatorSessionMeta.storyPromptText = 'PROMPT CŨ PHẢI GIỮ';

    await context.scanStoryPrompt();

    expect(updates.some((patch) => Object.prototype.hasOwnProperty.call(patch, 'storyPromptText'))).toBe(false);
    expect(context.currentTranslatorSessionMeta.storyPromptText).toBe('PROMPT CŨ PHẢI GIỮ');
  });

  it('refines from the current prompt and feedback without sending the 20 source chunks again', async () => {
    const { context, elements, requests, updates } = loadStoryPromptUiRuntime({
      translateImpl: () => 'SYSTEM PROMPT ĐÃ CHỈNH',
    });
    context.currentTranslatorSessionMeta.storyPromptText = 'SYSTEM PROMPT HIỆN TẠI';
    elements.get('storyPromptText').value = 'SYSTEM PROMPT HIỆN TẠI';
    elements.get('storyPromptFeedback').value = 'Đổi cách xưng hô của nhân vật A';

    await context.refineStoryPromptFromFeedback();

    expect(requests).toHaveLength(1);
    expect(requests[0].request.userText).toContain('SYSTEM PROMPT HIỆN TẠI');
    expect(requests[0].request.userText).toContain('Đổi cách xưng hô của nhân vật A');
    expect(requests[0].request.userText).not.toContain('Nội dung chunk 1');
    expect(updates.at(-1).storyPromptText).toBe('SYSTEM PROMPT ĐÃ CHỈNH');
    expect(elements.get('storyPromptFeedback').value).toBe('');
  });

  it('shows progress directly on the refine button while AI is working', async () => {
    let finishRefine;
    const { context, elements } = loadStoryPromptUiRuntime({
      translateImpl: () => new Promise((resolve) => { finishRefine = resolve; }),
    });
    context.currentTranslatorSessionMeta.storyPromptText = 'SYSTEM PROMPT HIỆN TẠI';
    elements.get('storyPromptText').value = 'SYSTEM PROMPT HIỆN TẠI';
    elements.get('storyPromptFeedback').value = 'Chỉnh lại cách xưng hô';

    const pending = context.refineStoryPromptFromFeedback();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const refineButton = elements.get('storyPromptRefineBtn');
    expect(refineButton.disabled).toBe(true);
    expect(refineButton.classList.contains('is-loading')).toBe(true);
    expect(refineButton.getAttribute('aria-busy')).toBe('true');
    expect(refineButton.refineLabel.textContent).toBe('Đang chỉnh prompt...');

    finishRefine('SYSTEM PROMPT ĐÃ CHỈNH');
    await pending;

    expect(refineButton.disabled).toBe(false);
    expect(refineButton.classList.contains('is-loading')).toBe(false);
    expect(refineButton.getAttribute('aria-busy')).toBe('false');
    expect(refineButton.refineLabel.textContent).toBe('Chỉnh prompt theo góp ý');
  });

  it('persists a completed scan to the session that started it even if the workspace switches files', async () => {
    const { context, updateSessionIds } = loadStoryPromptUiRuntime({
      translateImpl(request) {
        context.currentTranslatorSessionMeta = {
          id: 'session-khac',
          storyPromptText: 'PROMPT CỦA FILE KHÁC',
        };
        return JSON.stringify({
          categories: Array.from(request.assignment.categoryIds).map((id) => ({ id, content: `Quy tắc ${id}` })),
          uncertainties: [],
        });
      },
    });

    await context.scanStoryPrompt();

    expect(updateSessionIds.at(-1)).toBe('session-story');
    expect(context.currentTranslatorSessionMeta).toMatchObject({
      id: 'session-khac',
      storyPromptText: 'PROMPT CỦA FILE KHÁC',
    });
  });
});

describe('translator system and user request contract', () => {
  it('keeps base prompt, Canon Pack, and enabled story prompt only in systemText', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/request-contract.js',
    ]);

    const request = context.compileTranslationRequest({
      basePromptText: 'PROMPT NỀN\n\nVĂN BẢN CẦN BIÊN TẬP:',
      canonPromptText: 'CANON PACK',
      storyPromptText: 'PROMPT RIÊNG CỦA TRUYỆN',
      storyPromptEnabled: true,
      sourceLang: 'ja',
      contextText: 'NGỮ CẢNH TRƯỚC CHUNK',
      sourceText: 'ĐOẠN NGUỒN HIỆN TẠI',
    });

    expect(request).toEqual({
      systemText: expect.any(String),
      userText: expect.any(String),
      sourceText: 'ĐOẠN NGUỒN HIỆN TẠI',
    });
    expect(request.systemText).toContain('PROMPT NỀN');
    expect(request.systemText).not.toContain('VĂN BẢN CẦN BIÊN TẬP:');
    expect(request.systemText).toContain('CANON PACK');
    expect(request.systemText).toContain('PROMPT RIÊNG CỦA TRUYỆN');
    expect(request.systemText.indexOf('PROMPT NỀN')).toBeLessThan(request.systemText.indexOf('CANON PACK'));
    expect(request.systemText.indexOf('CANON PACK')).toBeLessThan(request.systemText.indexOf('PROMPT RIÊNG CỦA TRUYỆN'));
    expect(request.userText).toContain('Tiếng Nhật');
    expect(request.userText).toContain('NGỮ CẢNH TRƯỚC CHUNK');
    expect(request.userText).toContain('ĐOẠN NGUỒN HIỆN TẠI');
    expect(request.userText).not.toContain('PROMPT NỀN');
    expect(request.userText).not.toContain('CANON PACK');
    expect(request.userText).not.toContain('PROMPT RIÊNG CỦA TRUYỆN');
  });

  it('does not send a disabled or empty story prompt', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/request-contract.js',
    ]);

    const disabled = context.compileTranslationRequest({
      basePromptText: 'PROMPT NỀN',
      storyPromptText: 'PROMPT RIÊNG',
      storyPromptEnabled: false,
      sourceText: 'NGUỒN',
    });
    const empty = context.compileTranslationRequest({
      basePromptText: 'PROMPT NỀN',
      storyPromptText: '   ',
      storyPromptEnabled: true,
      sourceText: 'NGUỒN',
    });

    expect(disabled.systemText).not.toContain('PROMPT RIÊNG');
    expect(empty.systemText).not.toContain('PROMPT RIÊNG');
  });

  it('adds retry rules without losing sourceText or the story prompt', () => {
    const context = loadRuntimeFiles([
      'public/translator-runtime/js/translation/request-contract.js',
    ]);
    const request = context.compileTranslationRequest({
      basePromptText: 'PROMPT NỀN',
      storyPromptText: 'PROMPT RIÊNG',
      storyPromptEnabled: true,
      sourceText: 'NGUỒN GỐC',
    });

    const retried = context.prependTranslationSystemRule(request, 'QUY TẮC RETRY');

    expect(retried.sourceText).toBe('NGUỒN GỐC');
    expect(retried.userText).toBe(request.userText);
    expect(retried.systemText).toContain('QUY TẮC RETRY');
    expect(retried.systemText).toContain('PROMPT RIÊNG');
    expect(retried.systemText.endsWith('PROMPT RIÊNG')).toBe(true);
  });
});

describe('translator provider role separation', () => {
  it('sends separate system and user content to Gemini Direct', async () => {
    const requests = [];
    const context = loadProviderRuntime(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: 'Bản dịch tiếng Việt hợp lệ và đủ dài. '.repeat(20) }] },
          }],
        }),
      };
    });
    vm.runInContext('useProxy = false; cancelRequested = false;', context);

    await context.translateChunk({
      systemText: 'SYSTEM RIÊNG',
      userText: 'USER CÓ ĐOẠN NGUỒN',
      sourceText: 'Đoạn nguồn cần dịch. '.repeat(20),
    }, { model: 'gemini-2.5-flash', key: 'KEY', keyIndex: 0 });

    expect(requests[0].systemInstruction.parts[0].text).toBe('SYSTEM RIÊNG');
    expect(requests[0].contents[0].parts[0].text).toBe('USER CÓ ĐOẠN NGUỒN');
  });

  it('sends separate system and user messages to Proxy', async () => {
    const requests = [];
    const context = loadProviderRuntime(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Bản dịch tiếng Việt hợp lệ và đủ dài. '.repeat(20) } }],
        }),
      };
    });
    vm.runInContext(`
      useProxy = true;
      cancelRequested = false;
      storyForgeAccessToken = 'TOKEN';
      proxyBaseUrl = 'https://proxy.example/v1/chat/completions';
      proxyModel = 'model-test';
      proxyApiKey = 'KEY';
      proxyApiKeys = ['KEY'];
    `, context);

    await context.translateChunkViaProxy({
      systemText: 'SYSTEM RIÊNG',
      userText: 'USER CÓ ĐOẠN NGUỒN',
      sourceText: 'Đoạn nguồn cần dịch. '.repeat(20),
    }, 0.7, 'KEY');

    const messages = requests[0].payload?.messages || requests[0].messages;
    expect(messages).toEqual([
      { role: 'system', content: 'SYSTEM RIÊNG' },
      { role: 'user', content: 'USER CÓ ĐOẠN NGUỒN' },
    ]);
  });

  it('sends separate system and user messages to Ollama', async () => {
    const requests = [];
    const context = loadProviderRuntime(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: 'Bản dịch tiếng Việt hợp lệ và đủ dài. '.repeat(20) } }),
      };
    });
    vm.runInContext(`
      cancelRequested = false;
      document.getElementById = (id) => ({
        value: id === 'ollamaUrl' ? 'http://localhost:11434' : 'qwen3:4b',
        style: {},
        classList: { add() {}, remove() {}, toggle() {} }
      });
    `, context);

    await context.translateWithOllama({
      systemText: 'SYSTEM RIÊNG',
      userText: 'USER CÓ ĐOẠN NGUỒN',
      sourceText: 'Đoạn nguồn cần dịch. '.repeat(20),
    });

    expect(requests[0].messages).toEqual([
      { role: 'system', content: 'SYSTEM RIÊNG' },
      { role: 'user', content: 'USER CÓ ĐOẠN NGUỒN' },
    ]);
  });
});

describe('translator retry request contract', () => {
  it('keeps story rules and sourceText unchanged on progressive retries', async () => {
    const sentRequests = [];
    const context = {
      cancelRequested: false,
      console: { error() {}, log() {}, warn() {} },
      createValidationTranslatorError: (validation) => Object.assign(new Error(validation.errorCode), validation),
      getFictionalPrompt: () => 'FICTIONAL RULE',
      normalizeTranslatorError: (error) => error,
      PROMPT_ENHANCERS: { emphatic: 'EMPHATIC RULE', literary: 'LITERARY RULE' },
      recordKeySuccess() {},
      sendDirectTranslationAttempt: async ({ text }) => {
        sentRequests.push(text);
        if (sentRequests.length === 1) {
          const error = new Error('OUTPUT_TOO_SHORT');
          error.code = 'OUTPUT_TOO_SHORT';
          throw error;
        }
        return { result: 'Bản dịch hợp lệ', modelKeyPair: { keyIndex: 0 } };
      },
      showToast() {},
      sleep: async () => {},
      trackChunkRetry() {},
      useOllama: false,
      useProxy: false,
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    [
      'public/translator-runtime/js/translation/request-contract.js',
      'public/translator-runtime/js/translation/retry.js',
    ].forEach((file) => {
      vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
    });
    const request = context.compileTranslationRequest({
      basePromptText: 'PROMPT NỀN',
      storyPromptText: 'PROMPT RIÊNG',
      storyPromptEnabled: true,
      sourceText: 'NGUỒN GỐC',
    });

    await context.translateChunkWithRetry(request, 0, 2);

    expect(sentRequests).toHaveLength(2);
    expect(sentRequests[1].sourceText).toBe('NGUỒN GỐC');
    expect(sentRequests[1].userText).toBe(request.userText);
    expect(sentRequests[1].systemText).toContain('EMPHATIC RULE');
    expect(sentRequests[1].systemText).toContain('PROMPT RIÊNG');
    expect(sentRequests[1].systemText.endsWith('PROMPT RIÊNG')).toBe(true);
  });
});

describe('translator story prompt session defaults', () => {
  beforeEach(async () => {
    await clearTranslatorLocalStoreForTests();
  });

  it('creates a file session with an empty disabled story prompt that can be persisted independently', async () => {
    const file = new File(['Một đoạn truyện ngắn.'], 'truyen-a.txt', { type: 'text/plain' });
    const session = await createTranslatorSessionFromFile(file, { chunkSize: 100 });

    expect(session).toMatchObject({
      storyPromptText: '',
      storyPromptEnabled: false,
      storyPromptUncertainties: [],
      storyPromptUpdatedAt: null,
      storyPromptScanMeta: null,
    });
    expect(await getTranslatorSession(session.id)).toMatchObject({
      storyPromptText: '',
      storyPromptEnabled: false,
    });
  });

  it('restores prompt, toggle, scan count, and uncertainties only for the matching file session', async () => {
    const first = await createTranslatorSessionFromFile(
      new File(['Truyện thứ nhất.'], 'truyen-mot.txt', { type: 'text/plain' }),
      { chunkSize: 100 },
    );
    const second = await createTranslatorSessionFromFile(
      new File(['Truyện thứ hai.'], 'truyen-hai.txt', { type: 'text/plain' }),
      { chunkSize: 100 },
    );
    await updateTranslatorSession(first.id, {
      storyPromptText: 'PROMPT RIÊNG TRUYỆN MỘT',
      storyPromptEnabled: true,
      storyPromptUncertainties: ['Cần kiểm tra giới tính nhân vật A'],
      storyPromptScanMeta: { scanRequestCount: 4, scannedChunkCount: 1 },
    });

    expect(await getTranslatorSession(first.id)).toMatchObject({
      storyPromptText: 'PROMPT RIÊNG TRUYỆN MỘT',
      storyPromptEnabled: true,
      storyPromptUncertainties: ['Cần kiểm tra giới tính nhân vật A'],
      storyPromptScanMeta: { scanRequestCount: 4 },
    });
    expect(await getTranslatorSession(second.id)).toMatchObject({
      storyPromptText: '',
      storyPromptEnabled: false,
      storyPromptUncertainties: [],
      storyPromptScanMeta: null,
    });
  });
});

describe('translator story prompt UI contract', () => {
  it('places a Vietnamese story profile card between source preview and the translate button', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8');
    const previewIndex = html.indexOf('class="preview-section glass-card"');
    const storyPromptIndex = html.indexOf('id="storyPromptPanel"');
    const translateIndex = html.indexOf('class="translate-actions"');

    expect(storyPromptIndex).toBeGreaterThan(previewIndex);
    expect(storyPromptIndex).toBeLessThan(translateIndex);
    expect(html).toContain('Hồ sơ dịch riêng của truyện');
    expect(html).toContain('Quét 20 chunk đầu');
    expect(html).toContain('Số request quét song song');
    expect(html).toContain('System prompt riêng của truyện');
    expect(html).toContain('Ý kiến để AI chỉnh lại prompt');
    expect(html).toContain('class="story-prompt-feedback-header"');
    expect(html).toContain('id="storyPromptFeedbackHint"');
    expect(html).toContain('aria-describedby="storyPromptFeedbackHint storyPromptFeedbackSaveNote"');
    expect(html).toContain('class="story-prompt-feedback-footer"');
    expect(html).toContain('class="story-prompt-refine-icon"');
    expect(html).toContain('class="story-prompt-refine-spinner"');
    expect(html).toContain('class="story-prompt-refine-label"');
    expect(html).toContain('Điểm cần kiểm tra');
    expect(html).toContain('data-click-action="scanStoryPrompt"');
    expect(html).toContain('data-click-action="refineStoryPromptFromFeedback"');
    expect(html).toContain('data-input-action="saveStoryPromptText"');
    expect(html).toContain('data-change-action="toggleStoryPromptEnabled"');
    expect(css).toContain('.story-prompt-panel');
    expect(css).toContain('.story-prompt-refine-btn:focus-visible');
    expect(css).toMatch(/@media[^}]+max-width:[^}]+[\s\S]*story-prompt/u);
  });

  it('loads the request contract before providers and keeps Vietnamese text free of mojibake', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/index.html'), 'utf8');
    const sources = [
      html,
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/request-contract.js'), 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/story-prompt.js'), 'utf8'),
    ].join('\n');

    expect(html.indexOf('js/translation/request-contract.js')).toBeLessThan(html.indexOf('js/gemini/api.js'));
    expect(html.indexOf('js/translation/story-prompt.js')).toBeLessThan(html.indexOf('js/init.js'));
    expect(sources).not.toMatch(/Táº|Báº|Ä‘|Ã|â€“|â€™/u);
  });
});
