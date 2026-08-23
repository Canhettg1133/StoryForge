import { createCloudflareWorkersAIWebHandler } from '../api/cloudflare-workers-ai.js';
import { createOpenAIProxyWebHandler } from '../api/openai-proxy.js';
import { createTranslatorOpenAIProxyWebHandler } from '../api/translator-openai-proxy.js';
import { createSupremeChatWebHandler } from '../api/supreme-chat.js';
import { createSupremeChatCapabilitiesWebHandler } from '../api/supreme-chat-capabilities.js';
import { createAdultConsentWebHandler, createMeAccessWebHandler } from '../api/_web/access.js';
import { createLegacyCloudWebHandler } from '../api/_web/cloud.js';
import { createEdgeTtsWebHandler, createGoogleFreeTtsWebHandler } from '../api/_web/tts.js';
import {
  createSiteAnnouncementWebHandler,
  createSetupGuidesWebHandler,
  createTranslatorPromptSettingsWebHandler,
  createVipPageContentWebHandler,
} from '../api/_web/public-content.js';
import { isPreviewRuntime, jsonResponse, normalizeRuntime } from '../api/_lib/web.js';

const DEFAULT_HANDLERS = Object.freeze({
  '/api/openai-proxy': createOpenAIProxyWebHandler(),
  '/api/translator-openai-proxy': createTranslatorOpenAIProxyWebHandler(),
  '/api/supreme-chat': createSupremeChatWebHandler(),
  '/api/supreme-chat-capabilities': createSupremeChatCapabilitiesWebHandler(),
  '/api/cloudflare-workers-ai': createCloudflareWorkersAIWebHandler(),
  '/api/me/access': createMeAccessWebHandler(),
  '/api/me/adult-consent': createAdultConsentWebHandler(),
  '/api/site-announcement': createSiteAnnouncementWebHandler(),
  '/api/setup-guides': createSetupGuidesWebHandler(),
  '/api/translator-prompt-settings': createTranslatorPromptSettingsWebHandler(),
  '/api/vip-page-content': createVipPageContentWebHandler(),
  '/api/cloud': createLegacyCloudWebHandler(),
  '/api/tts/edge': createEdgeTtsWebHandler(),
  '/api/tts/google-free': createGoogleFreeTtsWebHandler(),
});

export async function handleStoryForgeWorkerRequest(request, env = {}, ctx = {}, options = {}) {
  const runtime = normalizeRuntime({ env, ctx, platform: 'cloudflare' });
  const url = new URL(request.url);
  const handlers = { ...DEFAULT_HANDLERS, ...(options.handlers || {}) };

  if (url.pathname === '/api/me/adult-consent' && isPreviewRuntime(runtime)) {
    return jsonResponse({ error: 'Preview is read-only.', code: 'PREVIEW_READ_ONLY' }, 403);
  }

  const handler = handlers[url.pathname];
  if (handler) {
    try {
      return await handler(request, runtime);
    } catch (error) {
      console.error('[storyforge-worker] unhandled API error', {
        path: url.pathname,
        code: error?.code || 'API_REQUEST_FAILED',
      });
      return jsonResponse({
        error: 'StoryForge API request failed.',
        code: 'API_REQUEST_FAILED',
      }, 500);
    }
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return jsonResponse({ error: 'API route not found.', code: 'API_ROUTE_NOT_FOUND' }, 404);
  }

  if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
  return new Response('Not found', { status: 404 });
}

export default {
  fetch(request, env, ctx) {
    return handleStoryForgeWorkerRequest(request, env, ctx);
  },
};
