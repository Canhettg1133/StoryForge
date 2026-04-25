import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function loadTranslatorErrorContext() {
  const context = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot, 'public/translator-runtime/js/translation/errors.js'), 'utf8'),
    context,
    { filename: 'public/translator-runtime/js/translation/errors.js' }
  );
  return context;
}

describe('phase10 translator notifications', () => {
  it('maps official Gemini HTTP failures to precise Vietnamese messages', () => {
    const context = loadTranslatorErrorContext();

    const cases = [
      [400, 'INVALID_ARGUMENT', 'Yêu cầu gửi tới Gemini không hợp lệ'],
      [403, 'PERMISSION_DENIED', 'API key không có quyền gọi Gemini'],
      [404, 'NOT_FOUND', 'Không tìm thấy model Gemini'],
      [429, 'RESOURCE_EXHAUSTED', 'đã vượt giới hạn quota hoặc rate limit'],
      [500, 'INTERNAL', 'Lỗi nội bộ phía Google'],
      [503, 'UNAVAILABLE', 'Gemini đang quá tải hoặc tạm thời không khả dụng'],
      [504, 'DEADLINE_EXCEEDED', 'Gemini xử lý quá lâu và đã quá hạn'],
    ];

    for (const [status, statusText, expectedText] of cases) {
      const error = context.createGeminiHttpError(
        status,
        { error: { status: statusText, message: `${statusText} raw details` } },
        { model: 'gemini-2.5-flash', keyIndex: 0 }
      );

      expect(context.formatTranslatorError(error)).toContain(expectedText);
      expect(context.formatTranslatorError(error)).not.toContain('raw details');
    }
  });

  it('maps Gemini block reasons and finish reasons to user-facing Vietnamese errors', () => {
    const context = loadTranslatorErrorContext();

    const safety = context.createGeminiBlockedError({
      candidates: [{ finishReason: 'SAFETY' }],
    });
    const prohibited = context.createGeminiBlockedError({
      promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
    });
    const recitation = context.createGeminiBlockedError({
      candidates: [{ finishReason: 'RECITATION' }],
    });
    const maxTokens = context.createGeminiBlockedError({
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });

    expect(context.formatTranslatorError(safety)).toContain('bị bộ lọc an toàn của Gemini chặn');
    expect(context.formatTranslatorError(prohibited)).toContain('Nội dung bị Gemini chặn theo chính sách');
    expect(context.formatTranslatorError(recitation)).toContain('có nguy cơ trùng lặp nội dung có bản quyền');
    expect(context.formatTranslatorError(maxTokens)).toContain('đụng giới hạn token đầu ra');
  });

  it('formats local validation failures without leaking machine codes to toasts', () => {
    const context = loadTranslatorErrorContext();

    const tooShort = context.createValidationTranslatorError({
      errorCode: 'OUTPUT_TOO_SHORT',
      details: 32,
    });
    const promptLeak = context.normalizeTranslatorError(new Error('PROMPT_LEAK:prompt_in_output'));

    expect(context.formatTranslatorError(tooShort)).toContain('Kết quả quá ngắn');
    expect(context.formatTranslatorError(tooShort)).toContain('32%');
    expect(context.formatTranslatorError(promptLeak)).toContain('AI lặp lại prompt');
    expect(context.formatTranslatorError(promptLeak)).not.toMatch(/PROMPT_LEAK|OUTPUT_TOO_SHORT/u);
  });

  it('keeps translator runtime notifications Vietnamese and avoids raw error toasts', () => {
    const files = [
      'public/translator-runtime/js/translation/engine.js',
      'public/translator-runtime/js/ui/chunk-tracker.js',
      'public/translator-runtime/js/proxy/proxy-api.js',
      'public/translator-runtime/js/local-ai/ollama.js',
      'public/translator-runtime/js/ui/settings.js',
      'public/translator-runtime/js/ui/progress.js',
      'public/translator-runtime/js/ui/controls.js',
      'public/translator-runtime/js/gemini/model-rotation.js',
      'public/translator-runtime/js/gemini/rpd-tracker.js',
      'public/translator-runtime/js/gemini/api.js',
      'public/translator-runtime/js/translation/errors.js',
    ];

    const combined = files
      .map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8'))
      .join('\n');

    expect(combined).not.toMatch(/showToast\(`Lỗi:\s*\$\{error\.message\}`/u);
    expect(combined).not.toMatch(/showToast\(`❌[^`]*\$\{e\.message\}`/u);
    expect(combined).not.toMatch(/\b(chua co|chua chon|Dang dung|San sang|Tat|Bat|ky tu|giay|Da chon template|Paste danh|Retry round|Kết nối OK)\b/u);
    expect(combined).not.toMatch(/Copy và paste|để backup|>\s*📋\s*Copy\b|Đang lấy danh sách models|Response không đúng|<strong>Response:|Settings (đã|tối ưu)|textContent = `\$\{chunkCount\} chunks`/u);
    expect(combined).not.toMatch(/Táº|Báº|â–¾/u);
  });
});
