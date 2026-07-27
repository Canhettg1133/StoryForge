import { fetchStoryForgeApi } from '../access/accessClient.js';
import keyManager from './keyManager.js';
import { getOpenAIProxyKeyProvider } from './openAIProxyConfig.js';

const SUPREME_CHAT_ENDPOINT = '/api/supreme-chat';
const SUPREME_CHAT_CAPABILITIES_ENDPOINT = '/api/supreme-chat-capabilities';
const AG_PROXY_PROFILE_ID = 'ag-gemini-proxy';

function getUpstreamKey(route = {}) {
  if (route.provider === 'gemini_direct') {
    return keyManager.getNextKey('gemini_direct') || '';
  }
  if (route.provider === 'openai_proxy' && route.proxyProfileId === AG_PROXY_PROFILE_ID) {
    return keyManager.getNextKey(getOpenAIProxyKeyProvider(AG_PROXY_PROFILE_ID)) || '';
  }
  return '';
}

class SupremeChatClient {
  constructor() {
    this.activeController = null;
  }

  async send({
    operation = 'chat',
    route,
    messages,
    attachments = [],
    signal,
  } = {}) {
    const upstreamKey = getUpstreamKey(route);
    if (!upstreamKey) {
      const error = new Error('Chưa có API key cho provider Tối Thượng đang chọn.');
      error.code = 'MISSING_API_KEY';
      throw error;
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
    this.activeController = controller;

    try {
      return await fetchStoryForgeApi(SUPREME_CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'X-StoryForge-Upstream-Key': upstreamKey,
        },
        body: {
          operation,
          route,
          messages,
          attachments,
        },
        signal: controller.signal,
      });
    } finally {
      signal?.removeEventListener?.('abort', abortFromCaller);
      if (this.activeController === controller) this.activeController = null;
    }
  }

  async getCapabilities({ signal } = {}) {
    return fetchStoryForgeApi(SUPREME_CHAT_CAPABILITIES_ENDPOINT, { signal });
  }

  abort() {
    this.activeController?.abort('user-aborted');
  }
}

const supremeChatClient = new SupremeChatClient();

export default supremeChatClient;
