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

  it('lets the translator runtime ask the host UI to confirm adult terms', () => {
    const app = read('public/translator-runtime/js/app.js');
    const host = read('src/components/translator/PersistentTranslatorHost.jsx');

    expect(app).toContain('requestStoryForgeAdultTermsConfirmation');
    expect(app).toContain('STORYFORGE_CONFIRM_ADULT_TERMS');
    expect(app).toContain('STORYFORGE_ADULT_TERMS_RESULT');
    expect(host).toContain('STORYFORGE_CONFIRM_ADULT_TERMS');
    expect(host).toContain('Xác nhận điều khoản 18+');
    expect(host).toContain('Tôi đủ 18 tuổi và đồng ý');
  });

  it('escapes translator runtime HTML sinks that receive upstream or key data', () => {
    const app = read('public/translator-runtime/js/app.js');
    const modelRotation = read('public/translator-runtime/js/gemini/model-rotation.js');
    const proxyApi = read('public/translator-runtime/js/proxy/proxy-api.js');
    const settings = read('public/translator-runtime/js/ui/settings.js');
    const chunkTracker = read('public/translator-runtime/js/ui/chunk-tracker.js');

    expect(proxyApi).toContain('function escapeProxyHtml');
    expect(proxyApi).toContain('${escapeProxyHtml(errorMsg)}');
    expect(proxyApi).toContain('${escapeProxyHtml(data.model || proxyModel)}');
    expect(proxyApi).toContain('${escapeProxyHtml(content.substring(0, 200))}');
    expect(proxyApi).toContain('${escapeProxyHtml(maskProxyKey(key))}');
    expect(app).toContain('function escapeRuntimeHtml');
    expect(app).toContain('${escapeRuntimeHtml(maskApiKey(key))}');
    expect(modelRotation).toContain('function escapeModelRotationHtml');
    expect(modelRotation).toContain('${escapeModelRotationHtml(fullKeyList)}');
    expect(modelRotation).not.toContain('console.log(`Key ${index + 1}: ${key}`)');
    expect(modelRotation).not.toContain('result.newKeys);');
    expect(settings).toContain("alertText.textContent = ''");
    expect(settings).not.toContain('alertText.innerHTML = `');
    expect(chunkTracker).toContain('const safeModel = escapeHtml(data.model ||');
    expect(chunkTracker).toContain('const safeError = escapeHtml(data.error ||');
  });

  it('keeps new access-control UI copy in Vietnamese with accents and avoids common mojibake', () => {
    const adminUi = `${read('apps/admin/src/App.jsx')}\n${read('apps/admin/src/views/AdminViews.jsx')}`;
    const translatorSettings = read('public/translator-runtime/js/ui/settings.js');
    const combined = `${adminUi}\n${translatorSettings}`;

    expect(combined).toContain('Tự kiểm tra quyền');
    expect(combined).toContain('Hủy gói hiện tại');
    expect(combined).toContain('Truyện 18+');
    expect(combined).not.toMatch(/Ă|Æ|áº|á»|â€|Ä|Å|�/u);
  });
});
