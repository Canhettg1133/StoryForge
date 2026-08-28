import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStack() {
  vi.resetModules();
  return {
    review: await import('../../features/manuscriptReview/modelRouting.js'),
    completion: await import('../../services/ai/chapterCompletionModelRouting.js'),
    router: (await import('../../services/ai/router.js')).default,
    proxy: await import('../../services/ai/openAIProxyConfig.js'),
  };
}

describe('manuscript review model preferences', () => {
  beforeEach(() => localStorage.clear());

  it('suggests the effective completion model without writing either preference', async () => {
    const { review, completion, router } = await loadStack();
    router.setPreferredProvider('gemini_direct');
    completion.saveChapterCompletionModelPreference({ provider: 'gemini_direct', model: 'gemini-2.5-flash' });
    const before = localStorage.getItem(completion.CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY);
    expect(review.getManuscriptReviewModelState()).toMatchObject({
      selectedModel: 'gemini-2.5-flash', shouldPrompt: true, suggestedFromCompletion: true,
    });
    expect(localStorage.getItem(review.REVIEW_MODEL_PREFERENCE_KEY)).toBeNull();
    expect(localStorage.getItem(completion.CHAPTER_COMPLETION_MODEL_PREFERENCE_KEY)).toBe(before);
  });

  it('remembers review independently and never changes global routing or completion', async () => {
    const { review, completion, router } = await loadStack();
    router.setPreferredProvider('gemini_direct');
    router.setQualityMode('best');
    completion.saveChapterCompletionModelPreference({ provider: 'gemini_direct', model: 'gemini-2.5-flash' });
    review.saveManuscriptReviewModelPreference({ provider: 'gemini_direct', model: 'gemini-3.1-flash-lite-preview' });
    expect(completion.getChapterCompletionModelState().selectedModel).toBe('gemini-2.5-flash');
    completion.saveChapterCompletionModelPreference({ provider: 'gemini_direct', model: 'gemini-3-flash-preview' });
    expect(review.getManuscriptReviewModelState()).toMatchObject({ selectedModel: 'gemini-3.1-flash-lite-preview', shouldPrompt: false });
    expect(router.getPreferredProvider()).toBe('gemini_direct');
    expect(router.getQualityMode()).toBe('best');
  });

  it('treats an explicitly inherited global model as a confirmed choice, not a new seed', async () => {
    const { review, completion, router } = await loadStack();
    router.setPreferredProvider('gemini_direct');
    router.setQualityMode('best');
    review.saveManuscriptReviewModelPreference({ provider: 'gemini_direct', model: '' });
    completion.saveChapterCompletionModelPreference({ provider: 'gemini_direct', model: 'gemini-2.5-flash' });
    expect(review.getManuscriptReviewModelState()).toMatchObject({
      selectedModel: '', shouldPrompt: false, suggestedFromCompletion: false,
      routeOptions: { modelOverride: 'gemini-3-flash-preview' },
    });
  });

  it('isolates proxy profiles and asks again for missing or corrupt preferences', async () => {
    const { review, router, proxy } = await loadStack();
    router.setPreferredProvider('openai_proxy');
    proxy.setOpenAIProxyActiveProfile(proxy.AG_PROXY_PROFILE_ID);
    const ag = review.getManuscriptReviewModelState();
    review.saveManuscriptReviewModelPreference({ ...ag, model: ag.options[0].id });
    proxy.updateCustomOpenAIProxyProfile({ baseUrl: 'https://example.test', defaultModel: 'small', models: ['small'] });
    proxy.setOpenAIProxyActiveProfile(proxy.CUSTOM_PROXY_PROFILE_ID);
    expect(review.getManuscriptReviewModelState().shouldPrompt).toBe(true);
    review.saveManuscriptReviewModelPreference({ ...review.getManuscriptReviewModelState(), model: 'small' });
    proxy.updateCustomOpenAIProxyProfile({ defaultModel: 'new', models: ['new'] });
    expect(review.getManuscriptReviewModelState().shouldPrompt).toBe(true);
    localStorage.setItem(review.REVIEW_MODEL_PREFERENCE_KEY, '{broken');
    expect(review.getManuscriptReviewModelState().shouldPrompt).toBe(true);
  });

  it('asks again when a confirmed current-model choice has no configured model or endpoint', async () => {
    const { review, router, proxy } = await loadStack();
    router.setPreferredProvider('openai_proxy');
    proxy.updateCustomOpenAIProxyProfile({ baseUrl: '', defaultModel: '', models: [] });
    proxy.setOpenAIProxyActiveProfile(proxy.CUSTOM_PROXY_PROFILE_ID);
    review.saveManuscriptReviewModelPreference({ provider: 'openai_proxy', proxyProfileId: proxy.CUSTOM_PROXY_PROFILE_ID, model: '' });
    expect(review.getManuscriptReviewModelState().shouldPrompt).toBe(true);
  });

  it('does not treat an uninstalled Ollama model as available just because it is still the global model', async () => {
    const { review, router } = await loadStack();
    const { setOllamaModelCatalog } = await import('../../services/ai/modelOptions.js');
    router.setPreferredProvider('ollama'); router.setOllamaModel('old-model');
    review.saveManuscriptReviewModelPreference({ provider: 'ollama', model: 'old-model' });
    setOllamaModelCatalog(['new-model']);
    expect(review.getManuscriptReviewModelState().shouldPrompt).toBe(true);
    expect(review.getManuscriptReviewModelState().options.map((item) => item.id)).toEqual(['new-model']);
    review.saveManuscriptReviewModelPreference({ provider: 'ollama', model: '' });
    expect(review.getManuscriptReviewModelState({ ollamaModels: [] }).shouldPrompt).toBe(true);
  });
});
