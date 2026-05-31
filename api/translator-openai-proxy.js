import { ACCESS_FEATURES } from './_lib/access-control.js';
import { config, createOpenAIProxyHandler } from './openai-proxy.js';

export { config };

export function createTranslatorOpenAIProxyHandler(options = {}) {
  return createOpenAIProxyHandler({
    ...options,
    workflowFeature: ACCESS_FEATURES.TRANSLATOR_ACCESS,
    requireTranslatorTemplate: true,
  });
}

export default createTranslatorOpenAIProxyHandler();
