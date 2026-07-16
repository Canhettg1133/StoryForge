import { createVercelHandler } from './_lib/web.js';
import {
  MAX_CHAT_STREAM_BATCH_SIZE,
  TRANSLATOR_ADULT_TEMPLATE_IDS,
  TRANSLATOR_TEMPLATE_IDS,
  createOpenAIProxyWebHandler,
  isTranslatorAdultTemplate,
} from './_web/openai-proxy.js';

export {
  MAX_CHAT_STREAM_BATCH_SIZE,
  TRANSLATOR_ADULT_TEMPLATE_IDS,
  TRANSLATOR_TEMPLATE_IDS,
  createOpenAIProxyWebHandler,
  isTranslatorAdultTemplate,
};

export const config = {
  maxDuration: 300,
};

export function createOpenAIProxyHandler(options = {}) {
  return createVercelHandler(createOpenAIProxyWebHandler(options));
}

export default createOpenAIProxyHandler();
