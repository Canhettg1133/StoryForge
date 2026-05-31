import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadRuntimeContext(files, extraContext = {}) {
  const fakeElement = {
    value: '',
    checked: false,
    style: {},
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  };
  const context = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    document: {
      addEventListener() {},
      getElementById() {
        return fakeElement;
      },
      querySelectorAll() {
        return [];
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    ...extraContext,
  };
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), 'utf8'), context, { filename: file });
  });
  return context;
}

describe('phase10 translator prompt patcher', () => {
  it('inserts name and pronoun rules inside the existing instruction section', () => {
    const context = loadRuntimeContext(['public/translator-runtime/js/app.js']);
    const prompt = `[QUAN TRỌNG]

YÊU CẦU:
- Giữ nguyên tên nhân vật, địa danh
- Sửa câu dịch máy thành tiếng Việt tự nhiên

ĐOẠN VĂN CẦN VIẾT LẠI:
`;

    const patched = context.ensureCharacterNameConsistencyPrompt(prompt, { templateId: 'wuxia' });

    const keepNameIndex = patched.indexOf('- Giữ nguyên tên nhân vật, địa danh');
    const nameRuleIndex = patched.indexOf('[YÊU CẦU BẮT BUỘC VỀ TÊN RIÊNG VÀ THUẬT NGỮ]');
    const markerIndex = patched.indexOf('ĐOẠN VĂN CẦN VIẾT LẠI:');

    expect(keepNameIndex).toBeGreaterThan(-1);
    expect(nameRuleIndex).toBeGreaterThan(keepNameIndex);
    expect(nameRuleIndex).toBeLessThan(markerIndex);
    expect(patched).toContain('Dạ Kinh Đường');
    expect(patched).toContain('không đổi thành Đêm Kinh Đường');
    expect(patched).toContain('Hạn chế mạnh anh, em, tôi, chị, cô, cậu');
  });

  it('does not duplicate prompt patch blocks when normalized repeatedly', () => {
    const context = loadRuntimeContext(['public/translator-runtime/js/app.js']);
    const prompt = `=== TRANSLATION STYLE GUIDE ===
Keep character names, place names, cultivation terms as-is.

[BEGIN MANUSCRIPT]
`;

    const once = context.ensureCharacterNameConsistencyPrompt(prompt, { templateId: 'sacHiep' });
    const twice = context.ensureCharacterNameConsistencyPrompt(once, { templateId: 'sacHiep' });

    expect(twice.match(/\[YÊU CẦU BẮT BUỘC VỀ TÊN RIÊNG VÀ THUẬT NGỮ\]/g)).toHaveLength(1);
    expect(twice.match(/\[YÊU CẦU BẮT BUỘC VỀ XƯNG HÔ CỔ PHONG\]/g)).toHaveLength(1);
    expect(twice.indexOf('[YÊU CẦU BẮT BUỘC VỀ TÊN RIÊNG VÀ THUẬT NGỮ]')).toBeLessThan(
      twice.indexOf('[BEGIN MANUSCRIPT]')
    );
  });

  it('uses a modern pronoun policy for romance instead of forcing cổ phong speech', () => {
    const context = loadRuntimeContext(['public/translator-runtime/js/app.js']);
    const patched = context.ensureCharacterNameConsistencyPrompt(`YÊU CẦU:
- Giữ nguyên cảm xúc nhân vật

ĐOẠN VĂN:
`, { templateId: 'romance' });

    expect(patched).toContain('Không ép lời thoại hiện đại/ngôn tình đô thị thành ta/ngươi');
    expect(patched).not.toContain('Hạn chế mạnh anh, em, tôi, chị, cô, cậu trong lời thoại cổ phong');
  });

  it('keeps the original prompt prefix when auto-splitting a prompted chunk', async () => {
    const calls = [];
    const context = loadRuntimeContext(['public/translator-runtime/js/translation/retry.js'], {
      cancelRequested: false,
      useOllama: false,
      useProxy: false,
      sleep: async () => {},
      getNextModelKeyPairWithQueue: () => ({ keyIndex: 0 }),
      recordKeySuccess: () => {},
      translateChunk: async (partText) => {
        calls.push(partText);
        return `[AUTO-SPLIT]Bản dịch ${calls.length}`;
      },
    });

    const sourceText = Array.from({ length: 12 }, (_, index) =>
      `Dòng ${index + 1}: ${'nội dung '.repeat(35)}`
    ).join('\n');
    const promptedChunk = `PROMPT RULES

[Đoạn nguồn]
${sourceText}`;

    await context.translateLargeChunkBySplitting(promptedChunk, 0);

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => call.startsWith('PROMPT RULES\n\n[Đoạn nguồn]\n[AUTO-SPLIT]\n'))).toBe(true);
  });

  it('auto-resizes the prompt textarea to fit generated prompt content', () => {
    const promptElement = {
      value: 'Một prompt dài',
      scrollHeight: 420,
      style: { height: '64px' },
      addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {} },
    };
    const context = loadRuntimeContext(['public/translator-runtime/js/ui/settings.js'], {
      document: {
        getElementById(id) {
          return id === 'customPrompt' ? promptElement : null;
        },
        querySelectorAll() {
          return [];
        },
        querySelector() {
          return null;
        },
      },
    });

    context.autoResizePromptTextarea();

    expect(promptElement.style.height).toBe('422px');

    const css = fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/style.css'), 'utf8');
    expect(css).toMatch(/\.prompt-panel textarea[\s\S]*overflow-y:\s*hidden/u);
    expect(css).toMatch(/\.prompt-panel textarea[\s\S]*resize:\s*none/u);
  });
});
