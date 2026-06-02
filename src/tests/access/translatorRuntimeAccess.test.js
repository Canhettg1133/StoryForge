import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('translator runtime access gates', () => {
  it('revalidates StoryForge access and blocks locked translator/provider/bulk flows', () => {
    const app = read('public/translator-runtime/js/app.js');
    const engine = read('public/translator-runtime/js/translation/engine.js');
    const modelRotation = read('public/translator-runtime/js/gemini/model-rotation.js');
    const proxyApi = read('public/translator-runtime/js/proxy/proxy-api.js');

    expect(app).toContain('/api/me/access');
    expect(engine).toContain("requireStoryForgeFeature('translator.access')");
    expect(engine).toContain("hasStoryForgeFeature('translator.parallel_high')");
    expect(engine).toContain("'provider.ag_proxy'");
    expect(engine).toContain("'provider.custom_proxy'");
    expect(modelRotation).toContain("requireStoryForgeFeature('translator.bulk_keys')");
    expect(proxyApi).toContain("requireStoryForgeFeature('translator.bulk_keys')");
  });

  it('routes translator relay through the translator endpoint with server-recognized template context', () => {
    const app = read('public/translator-runtime/js/app.js');
    const proxyApi = read('public/translator-runtime/js/proxy/proxy-api.js');
    const geminiApi = read('public/translator-runtime/js/gemini/api.js');

    expect(app).toContain('/api/translator-openai-proxy');
    expect(app).toContain('TRANSLATOR_ADULT_TEMPLATE_IDS');
    expect(app).toContain("'content.adult_mode'");
    expect(proxyApi).toContain('templateId');
    expect(geminiApi).toContain('templateId');
  });

  it('guards 18+ translator templates independently of client adultMode hints', () => {
    const app = read('public/translator-runtime/js/app.js');
    const engine = read('public/translator-runtime/js/translation/engine.js');
    const settings = read('public/translator-runtime/js/ui/settings.js');

    expect(app).toContain('adult');
    expect(app).toContain('sacHiepENI');
    expect(app).toContain('isTranslatorAdultTemplate');
    expect(engine).toContain('requireStoryForgeAdultTemplateAccess');
    expect(settings).toContain('requireStoryForgeAdultTemplateAccess');
    expect(`${app}\n${engine}\n${settings}`).not.toContain('adultMode: false');
  });

  it('keeps new access-control UI copy in Vietnamese with accents and avoids common mojibake', () => {
    const adminUi = read('apps/admin/src/App.jsx');
    const translatorSettings = read('public/translator-runtime/js/ui/settings.js');
    const combined = `${adminUi}\n${translatorSettings}`;

    expect(combined).toContain('Tự kiểm tra quyền');
    expect(combined).toContain('Hủy gói hiện tại');
    expect(combined).toContain('Truyện 18+');
    expect(combined).not.toMatch(/Ă|Æ|áº|á»|â€|Ä|Å|�/u);
  });
});
