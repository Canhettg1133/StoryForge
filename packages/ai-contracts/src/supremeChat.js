export const SUPREME_GEMINI_DIRECT_MODELS = Object.freeze([
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
]);

export const SUPREME_AG_PROXY_MODELS = Object.freeze([
  'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
  'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  'gemini-3-flash-medium-真流-[星星公益站-CLI渠道]',
  'gemini-3-flash-preview-真流-[星星公益站-CLI渠道]',
  'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  'gemini-3-pro-high-真流-[星星公益站-CLI渠道]',
  'gemini-3-pro-low-真流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-high-真流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-low-真流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-high-假流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-low-假流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-high-search-真流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-low-search-真流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-high-search-假流-[星星公益站-CLI渠道]',
  'gemini-3.1-pro-low-search-假流-[星星公益站-CLI渠道]',
]);

const DIRECT_MODEL_SET = new Set(SUPREME_GEMINI_DIRECT_MODELS);
const AG_MODEL_SET = new Set(SUPREME_AG_PROXY_MODELS);

export function isSupremeModelAllowed(route = {}) {
  if (route.provider === 'gemini_direct') {
    return DIRECT_MODEL_SET.has(String(route.model || ''));
  }
  if (
    route.provider === 'openai_proxy'
    && route.proxyProfileId === 'ag-gemini-proxy'
  ) {
    return AG_MODEL_SET.has(String(route.model || ''));
  }
  return false;
}
