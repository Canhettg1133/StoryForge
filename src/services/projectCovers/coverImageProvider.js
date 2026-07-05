import keyManager from '../ai/keyManager.js';
import { PROVIDERS } from '../ai/router.js';
import { getGeminiDirectBaseUrl } from '../ai/client.js';
import {
  AG_PROXY_PROFILE_ID,
  CUSTOM_PROXY_PROFILE_ID,
  DEFAULT_PROXY_CHAT_PATH,
  DEFAULT_PROXY_IMAGE_GENERATIONS_PATH,
  getActiveOpenAIProxyProfile,
  getOpenAIProxyKeyProvider,
  resolveOpenAIProxyDirectRequest,
  resolveOpenAIProxyRequest,
  shouldFallbackOpenAIProxyRelay,
} from '../ai/openAIProxyConfig.js';
import { getStoryForgeAccessToken } from '../access/accessClient.js';

export const COVER_IMAGE_PROVIDERS = Object.freeze({
  GEMINI_DIRECT: PROVIDERS.GEMINI_DIRECT,
  AG_PROXY: PROVIDERS.GEMINI_PROXY,
  OPENAI_PROXY: PROVIDERS.OPENAI_PROXY,
  CLOUDFLARE_WORKERS_AI: PROVIDERS.CLOUDFLARE_WORKERS_AI,
});

export const GEMINI_COVER_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image Preview' },
  { id: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image' },
  { id: 'gemini-3.1-flash-lite-image-preview', label: 'Gemini 3.1 Flash Lite Image Preview' },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
];

export const AG_COVER_IMAGE_MODELS = [
  { id: 'gemini-3-pro-image-[星星公益站-反重力渠道]', label: 'Gemini 3 Pro Image (AG)' },
  { id: 'gemini-3-pro-image-preview-[星星公益站-反重力渠道]', label: 'Gemini 3 Pro Image Preview (AG)' },
];

export const CLOUDFLARE_COVER_IMAGE_MODELS = [
  {
    id: '@cf/leonardo/lucid-origin',
    label: 'Leonardo Lucid Origin',
    family: 'Leonardo',
    channel: 'Khuyến nghị bìa truyện',
    badge: 'Prompt bìa tốt',
    note: 'Bám prompt, hợp bìa có visual style rõ.',
  },
  {
    id: '@cf/black-forest-labs/flux-2-dev',
    label: 'FLUX.2 Dev',
    family: 'FLUX',
    channel: 'Khuyến nghị bìa truyện',
    badge: 'Chất lượng cao',
    note: 'Ưu tiên chi tiết và độ thực.',
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    label: 'FLUX.2 Klein 9B',
    family: 'FLUX',
    channel: 'Khuyến nghị bìa truyện',
    badge: 'Cân bằng',
    note: 'Nhanh, chất lượng cao, hợp preview.',
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-4b',
    label: 'FLUX.2 Klein 4B',
    family: 'FLUX',
    channel: 'FLUX',
    badge: 'Nhanh',
    note: 'Nhẹ hơn 9B, hợp tạo nhiều biến thể.',
  },
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    label: 'FLUX.1 Schnell',
    family: 'FLUX',
    channel: 'FLUX',
    badge: 'Nhanh/rẻ',
    note: 'Model cũ ổn định, chi phí thấp.',
  },
  {
    id: '@cf/bytedance/stable-diffusion-xl-lightning',
    label: 'SDXL Lightning',
    family: 'Stable Diffusion',
    channel: 'Stable Diffusion',
    badge: 'Beta nhanh',
    note: 'Tạo ảnh 1024px trong ít bước.',
  },
  {
    id: '@cf/lykon/dreamshaper-8-lcm',
    label: 'DreamShaper 8 LCM',
    family: 'Stable Diffusion',
    channel: 'Stable Diffusion',
    badge: 'Photoreal',
    note: 'Fallback thiên photoreal.',
  },
  {
    id: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    label: 'SDXL Base 1.0',
    family: 'Stable Diffusion',
    channel: 'Stable Diffusion',
    badge: 'Beta',
    note: 'Fallback SDXL cơ bản.',
  },
];

export const DEFAULT_GEMINI_COVER_IMAGE_MODEL = GEMINI_COVER_IMAGE_MODELS[0].id;
export const DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL = CLOUDFLARE_COVER_IMAGE_MODELS[0].id;
export const DEFAULT_COVER_IMAGE_SIZE = '1024x1536';
export const CLOUDFLARE_WORKERS_AI_SETTINGS_CHANGED_EVENT = 'storyforge:cloudflare-workers-ai-settings-changed';
const CLOUDFLARE_WORKERS_AI_SETTINGS_KEY = 'sf-cloudflare-workers-ai-settings';
const IMAGE_MODEL_PATTERN = /(image|imagen|nano[-_\s]?banana|gpt[-_]?image|dall[-_]?e|flux|stable[-_\s]?diffusion|midjourney|lucid|phoenix|dreamshaper)/iu;

function trimText(value) {
  return String(value || '').trim();
}

function getModelId(value) {
  return trimText(value?.id || value);
}

function readJsonStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function dispatchCloudflareWorkersAISettingsChanged(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(CLOUDFLARE_WORKERS_AI_SETTINGS_CHANGED_EVENT, { detail }));
  } catch {
    // Settings persistence must still work if CustomEvent is unavailable.
  }
}

export function getCloudflareWorkersAISettings() {
  const saved = readJsonStorage(CLOUDFLARE_WORKERS_AI_SETTINGS_KEY, {});
  return {
    accountId: trimText(saved?.accountId),
    defaultModel: trimText(saved?.defaultModel) || DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL,
    models: normalizeCloudflareWorkersAIModelList(saved?.models),
  };
}

export function saveCloudflareWorkersAISettings(patch = {}) {
  const current = getCloudflareWorkersAISettings();
  const next = {
    accountId: trimText(patch.accountId ?? current.accountId),
    defaultModel: trimText(patch.defaultModel ?? current.defaultModel) || DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL,
    models: normalizeCloudflareWorkersAIModelList(patch.models ?? current.models),
  };
  localStorage.setItem(CLOUDFLARE_WORKERS_AI_SETTINGS_KEY, JSON.stringify(next));
  dispatchCloudflareWorkersAISettingsChanged({ key: CLOUDFLARE_WORKERS_AI_SETTINGS_KEY });
  return next;
}

function normalizeCloudflareWorkersAIModelList(models = []) {
  return sortCoverImageModels(
    (Array.isArray(models) ? models : [])
      .map((model) => trimText(model?.id || model?.name || model?.model || model))
      .filter((model) => model.startsWith('@cf/')),
  );
}

export function getCloudflareWorkersAIModelOptions() {
  const settings = getCloudflareWorkersAISettings();
  return sortCoverImageModels([
    ...CLOUDFLARE_COVER_IMAGE_MODELS.map((item) => item.id),
    ...settings.models,
  ]);
}

export function getCloudflareWorkersAIModelMeta(model) {
  const id = getModelId(model);
  const known = CLOUDFLARE_COVER_IMAGE_MODELS.find((item) => item.id === id);
  if (known) return known;
  if (id.includes('/black-forest-labs/')) {
    return { id, label: id, family: 'FLUX', channel: 'Model đã lấy từ Cloudflare API', badge: 'Fetched', note: '' };
  }
  if (id.includes('/leonardo/')) {
    return { id, label: id, family: 'Leonardo', channel: 'Model đã lấy từ Cloudflare API', badge: 'Fetched', note: '' };
  }
  if (/(stable-diffusion|dreamshaper|bytedance|stabilityai|lykon)/iu.test(id)) {
    return { id, label: id, family: 'Stable Diffusion', channel: 'Model đã lấy từ Cloudflare API', badge: 'Fetched', note: '' };
  }
  return { id, label: id || 'Model Cloudflare', family: 'Khác', channel: 'Model đã lấy từ Cloudflare API', badge: 'Fetched', note: '' };
}

export function getCloudflareWorkersAIModelLabel(model) {
  const meta = getCloudflareWorkersAIModelMeta(model);
  return meta.label || meta.id || '';
}

export function isLikelyCoverImageModel(model) {
  return IMAGE_MODEL_PATTERN.test(getModelId(model));
}

export function sortCoverImageModels(models = []) {
  const seen = new Set();
  const agPriority = new Map(AG_COVER_IMAGE_MODELS.map((item, index) => [item.id, index]));
  const cloudflarePriority = new Map(CLOUDFLARE_COVER_IMAGE_MODELS.map((item, index) => [item.id, index]));
  return (Array.isArray(models) ? models : [])
    .map((model, index) => ({ id: getModelId(model), index }))
    .filter(({ id }) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((left, right) => {
      const leftPriority = agPriority.has(left.id) ? agPriority.get(left.id) : Number.POSITIVE_INFINITY;
      const rightPriority = agPriority.has(right.id) ? agPriority.get(right.id) : Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftCloudflarePriority = cloudflarePriority.has(left.id) ? cloudflarePriority.get(left.id) : Number.POSITIVE_INFINITY;
      const rightCloudflarePriority = cloudflarePriority.has(right.id) ? cloudflarePriority.get(right.id) : Number.POSITIVE_INFINITY;
      if (leftCloudflarePriority !== rightCloudflarePriority) return leftCloudflarePriority - rightCloudflarePriority;

      const leftIsImage = isLikelyCoverImageModel(left.id);
      const rightIsImage = isLikelyCoverImageModel(right.id);
      if (leftIsImage !== rightIsImage) return leftIsImage ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ id }) => id);
}

function createProviderError(message, code = 'COVER_IMAGE_PROVIDER_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readJsonResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function assertImageResponseOk(response, providerLabel) {
  if (response.ok) return;
  const payload = await readJsonResponse(response);
  const rawMessage = trimText(
    payload?.error?.message
    || payload?.error
    || payload?.message
    || '',
  );
  const lower = rawMessage.toLowerCase();
  if (
    response.status === 429
    || lower.includes('rate limit')
    || lower.includes('quota')
    || lower.includes('too many')
  ) {
    throw createProviderError(
      `${providerLabel} đang giới hạn lượt hoặc quota tạo ảnh. Hãy chờ rồi thử lại, hoặc đổi key/model.`,
      'COVER_IMAGE_RATE_LIMITED',
    );
  }
  if (
    response.status === 404
    || response.status === 405
    || lower.includes('model')
    || lower.includes('image')
    || lower.includes('endpoint')
  ) {
    throw createProviderError(
      'Model này không hỗ trợ tạo ảnh qua endpoint hiện tại.',
      'COVER_IMAGE_UNSUPPORTED_MODEL',
    );
  }
  throw createProviderError(rawMessage || `${providerLabel} không tạo được ảnh bìa.`);
}

export function buildCoverArtworkPrompt({
  prompt = '',
  title = '',
  genre = '',
  tone = '',
  synopsis = '',
} = {}) {
  const lines = [
    'Tạo artwork bìa sách theo chiều dọc, giàu không khí, dùng được làm bìa tiểu thuyết.',
    'Không đưa chữ, không logo, không watermark, không tiêu đề, không tên tác giả, không typography trong ảnh.',
  ];
  if (title) lines.push(`Tên truyện để lấy tinh thần, không viết vào ảnh: ${title}`);
  if (genre) lines.push(`Thể loại: ${genre}`);
  if (tone) lines.push(`Tone: ${tone}`);
  if (synopsis) lines.push(`Tóm tắt ngắn: ${synopsis}`);
  if (prompt) lines.push(`Ý tưởng bìa của tác giả: ${prompt}`);
  return lines.join('\n');
}

export function parseOpenAIImageGenerationResponse(payload = {}) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  const b64 = trimText(first?.b64_json || first?.b64 || payload?.b64_json);
  if (!b64) {
    throw createProviderError('Provider không trả về dữ liệu ảnh bìa.', 'COVER_IMAGE_EMPTY_RESPONSE');
  }
  const outputFormat = trimText(first?.output_format || payload?.output_format).replace(/^image\//u, '');
  return {
    b64,
    mimeType: trimText(first?.mime_type) || (outputFormat ? `image/${outputFormat}` : 'image/png'),
    revisedPrompt: trimText(first?.revised_prompt || payload?.revised_prompt),
  };
}

function getOpenAIChatContentText(payload = {}) {
  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.delta?.content || '';
  if (Array.isArray(content)) {
    return content
      .map((part) => trimText(part?.text || part?.image_url?.url || part?.url || ''))
      .filter(Boolean)
      .join('\n');
  }
  return trimText(content);
}

function inferImageMimeTypeFromUrl(url = '') {
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = trimText(url).toLowerCase();
  }
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export function parseOpenAIChatImageResponse(payload = {}) {
  const content = getOpenAIChatContentText(payload);
  const match = content.match(/data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/_=-]+)/iu);
  if (match) {
    return {
      b64: match[2],
      mimeType: match[1],
      revisedPrompt: '',
    };
  }
  if (!match) {
    const urlMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|\b(https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp)(?:\?[^\s)]*)?)/iu);
    const imageUrl = trimText(urlMatch?.[1] || urlMatch?.[2]);
    if (imageUrl) {
      return {
        b64: '',
        imageUrl,
        mimeType: inferImageMimeTypeFromUrl(imageUrl),
        revisedPrompt: '',
      };
    }
    throw createProviderError('Provider không trả về dữ liệu ảnh bìa.', 'COVER_IMAGE_EMPTY_RESPONSE');
  }
}

function findGeminiOutputImage(payload = {}) {
  if (payload?.output_image?.data) return payload.output_image;
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (const step of steps) {
    const parts = Array.isArray(step?.parts) ? step.parts : [];
    const imagePart = parts.find((part) => part?.type === 'image' && part?.data);
    if (imagePart) return imagePart;
  }
  return null;
}

export function parseGeminiInteractionImageResponse(payload = {}) {
  const image = findGeminiOutputImage(payload);
  const b64 = trimText(image?.data);
  if (!b64) {
    throw createProviderError('Gemini không trả về dữ liệu ảnh bìa.', 'COVER_IMAGE_EMPTY_RESPONSE');
  }
  return {
    b64,
    mimeType: trimText(image?.mime_type || image?.mimeType) || 'image/png',
    revisedPrompt: '',
  };
}

export function parseCloudflareWorkersAIImageResponse(payload = {}) {
  const providerMessage = Array.isArray(payload?.errors)
    ? payload.errors
      .map((item) => trimText(item?.message || item?.code || item))
      .filter(Boolean)
      .join(' ')
    : '';
  if (payload?.success === false && providerMessage) {
    throw createProviderError(providerMessage, 'COVER_IMAGE_PROVIDER_ERROR');
  }

  const b64 = trimText(payload?.result?.image || payload?.image);
  if (!b64) {
    throw createProviderError('Cloudflare không trả về dữ liệu ảnh bìa.', 'COVER_IMAGE_EMPTY_RESPONSE');
  }
  return {
    b64,
    mimeType: trimText(payload?.mimeType || payload?.result?.mimeType || payload?.result?.mime_type) || 'image/jpeg',
    revisedPrompt: '',
  };
}

export function parseCloudflareWorkersAIModelIds(payload = {}) {
  const items = Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return sortCoverImageModels(items
    .map((item) => trimText(
      item?.id
      || item?.name
      || item?.model
      || item?.value
      || item?.slug
      || item,
    ))
    .filter((model) => model.startsWith('@cf/') && isLikelyCoverImageModel(model)));
}

function getGeminiEndpoint() {
  const baseUrl = trimText(getGeminiDirectBaseUrl()).replace(/\/+$/u, '');
  const versionBase = baseUrl.endsWith('/v1beta') ? baseUrl : `${baseUrl}/v1beta`;
  return `${versionBase}/interactions`;
}

async function generateGeminiCoverImage({ model, prompt, signal }) {
  const apiKey = keyManager.getNextKey(PROVIDERS.GEMINI_DIRECT);
  if (!apiKey) {
    throw createProviderError('Chưa có API key Gemini Direct để tạo bìa.', 'COVER_IMAGE_MISSING_API_KEY');
  }

  const response = await fetch(getGeminiEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: trimText(model) || DEFAULT_GEMINI_COVER_IMAGE_MODEL,
      input: [{ type: 'text', text: prompt }],
    }),
    signal,
  });
  await assertImageResponseOk(response, 'Gemini');
  return parseGeminiInteractionImageResponse(await response.json());
}

async function callCloudflareWorkersAIRelay({ apiKey, body, signal }) {
  const storyForgeToken = await getStoryForgeAccessToken();
  const response = await fetch('/api/cloudflare-workers-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(storyForgeToken ? { Authorization: `Bearer ${storyForgeToken}` } : {}),
      'X-StoryForge-Upstream-Key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });
  await assertImageResponseOk(response, 'Cloudflare Workers AI');
  return readCloudflareWorkersAIRelayResponse(response);
}

function base64FromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function readCloudflareWorkersAIRelayResponse(response) {
  const contentType = trimText(response.headers.get('content-type')).toLowerCase();
  if (contentType.startsWith('image/')) {
    const mimeType = contentType.split(';')[0] || 'image/jpeg';
    const b64 = base64FromArrayBuffer(await response.arrayBuffer());
    return { result: { image: b64 }, mimeType };
  }
  return response.json();
}

function isCloudflareWorkersAIFormModel(model) {
  return /^@cf\/black-forest-labs\/flux-2-/iu.test(trimText(model));
}

function isLeonardoWorkersAIModel(model) {
  return /^@cf\/leonardo\//iu.test(trimText(model));
}

function isStableDiffusionWorkersAIModel(model) {
  const normalizedModel = trimText(model);
  return /^@cf\/(bytedance|lykon|stabilityai)\//iu.test(normalizedModel)
    || /(stable-diffusion|dreamshaper)/iu.test(normalizedModel);
}

function getCoverSizeDimensions(size = DEFAULT_COVER_IMAGE_SIZE) {
  const match = trimText(size).match(/^(\d+)x(\d+)$/u);
  if (!match) return {};
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
  return { width, height };
}

function buildCloudflareWorkersAIPayload({ model, prompt, size }) {
  const normalizedModel = trimText(model);
  const dimensions = getCoverSizeDimensions(size);
  if (isCloudflareWorkersAIFormModel(normalizedModel)) {
    return {
      prompt,
      steps: 25,
      ...dimensions,
    };
  }

  if (isLeonardoWorkersAIModel(normalizedModel)) {
    return {
      prompt,
      guidance: 4.5,
      num_steps: 30,
      ...dimensions,
    };
  }

  if (isStableDiffusionWorkersAIModel(normalizedModel)) {
    return {
      prompt,
      num_steps: normalizedModel.includes('lightning') ? 4 : 20,
      ...dimensions,
    };
  }

  return {
    prompt,
    steps: 4,
  };
}

async function generateCloudflareWorkersAICoverImage({ model, prompt, size, signal }) {
  const apiKey = keyManager.getNextKey(PROVIDERS.CLOUDFLARE_WORKERS_AI);
  if (!apiKey) {
    throw createProviderError('Chưa có API token Cloudflare Workers AI để tạo bìa.', 'COVER_IMAGE_MISSING_API_KEY');
  }

  const settings = getCloudflareWorkersAISettings();
  const accountId = trimText(settings.accountId);
  if (!accountId) {
    throw createProviderError('Chưa có Account ID Cloudflare để tạo bìa.', 'COVER_IMAGE_MISSING_ACCOUNT_ID');
  }

  const normalizedModel = trimText(model) || settings.defaultModel || DEFAULT_CLOUDFLARE_COVER_IMAGE_MODEL;
  const payload = await callCloudflareWorkersAIRelay({
    apiKey,
    body: {
      action: 'run',
      accountId,
      model: normalizedModel,
      payload: buildCloudflareWorkersAIPayload({ model: normalizedModel, prompt, size }),
    },
    signal,
  });
  return parseCloudflareWorkersAIImageResponse(payload);
}

export async function fetchCloudflareWorkersAIModels({ search = 'image', signal } = {}) {
  const apiKey = keyManager.getNextKey(PROVIDERS.CLOUDFLARE_WORKERS_AI);
  if (!apiKey) {
    throw createProviderError('Chưa có API token Cloudflare Workers AI để lấy model.', 'COVER_IMAGE_MISSING_API_KEY');
  }

  const settings = getCloudflareWorkersAISettings();
  const accountId = trimText(settings.accountId);
  if (!accountId) {
    throw createProviderError('Chưa có Account ID Cloudflare để lấy model.', 'COVER_IMAGE_MISSING_ACCOUNT_ID');
  }

  const payload = await callCloudflareWorkersAIRelay({
    apiKey,
    body: {
      action: 'models',
      accountId,
      search,
    },
    signal,
  });
  return parseCloudflareWorkersAIModelIds(payload);
}

function buildOpenAIImagePayload({ model, prompt, size }) {
  return {
    model: trimText(model),
    prompt,
    n: 1,
    size: trimText(size) || DEFAULT_COVER_IMAGE_SIZE,
    response_format: 'b64_json',
  };
}

function getAspectRatioFromSize(size) {
  const match = trimText(size).match(/^(\d+)x(\d+)$/u);
  if (!match) return '';
  let width = Number(match[1]);
  let height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  while (height) {
    const next = width % height;
    width = height;
    height = next;
  }
  const divisor = width || 1;
  return `${Number(match[1]) / divisor}:${Number(match[2]) / divisor}`;
}

function buildOpenAIChatImagePayload({ model, prompt, size }) {
  const normalizedSize = trimText(size) || DEFAULT_COVER_IMAGE_SIZE;
  const aspectRatio = getAspectRatioFromSize(normalizedSize);
  return {
    model: trimText(model),
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    }],
    stream: false,
    size: normalizedSize,
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
  };
}

async function callOpenAIProxyImageDirect({ target, apiKey, payload, signal }) {
  const response = await fetch(target.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  await assertImageResponseOk(response, 'OpenAI-compatible Proxy');
  return parseOpenAIImageGenerationResponse(await response.json());
}

async function callOpenAIProxyChatImageDirect({ profile, target, apiKey, payload, signal }) {
  const response = await fetch(target.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  await assertImageResponseOk(response, profile.label || 'OpenAI-compatible Proxy');
  return parseOpenAIChatImageResponse(await response.json());
}

async function callOpenAIProxyImageRelay({ profile, target, apiKey, payload, signal }) {
  const storyForgeToken = await getStoryForgeAccessToken();
  let response = await fetch(target.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(storyForgeToken ? { Authorization: `Bearer ${storyForgeToken}` } : {}),
      'X-StoryForge-Upstream-Key': apiKey,
    },
    body: JSON.stringify({
      action: 'image_generation',
      baseUrl: target.baseUrl,
      imageGenerationsPath: profile.imageGenerationsPath || DEFAULT_PROXY_IMAGE_GENERATIONS_PATH,
      payload,
      usage: {
        taskType: 'cover_generation',
        taskGroup: 'story_publishing',
        taskLabel: 'Tạo bìa truyện',
        surface: 'story_bible',
      },
    }),
    signal,
  });

  if (shouldFallbackOpenAIProxyRelay(response)) {
    const directTarget = resolveOpenAIProxyDirectRequest(profile, 'image_generation');
    response = await fetch(directTarget.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  }

  await assertImageResponseOk(response, profile.label || 'OpenAI-compatible Proxy');
  return parseOpenAIImageGenerationResponse(await response.json());
}

async function callOpenAIProxyChatImageRelay({ profile, target, apiKey, payload, signal }) {
  const storyForgeToken = await getStoryForgeAccessToken();
  let response = await fetch(target.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(storyForgeToken ? { Authorization: `Bearer ${storyForgeToken}` } : {}),
      'X-StoryForge-Upstream-Key': apiKey,
    },
    body: JSON.stringify({
      action: 'chat',
      baseUrl: target.baseUrl,
      chatCompletionsPath: profile.chatCompletionsPath || DEFAULT_PROXY_CHAT_PATH,
      payload,
      usage: {
        taskType: 'cover_generation',
        taskGroup: 'story_publishing',
        taskLabel: 'Tạo bìa truyện',
        surface: 'story_bible',
      },
    }),
    signal,
  });

  if (shouldFallbackOpenAIProxyRelay(response)) {
    const directTarget = resolveOpenAIProxyDirectRequest(profile, 'chat');
    response = await fetch(directTarget.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  }

  await assertImageResponseOk(response, profile.label || 'OpenAI-compatible Proxy');
  return parseOpenAIChatImageResponse(await response.json());
}

async function generateOpenAIProxyCoverImage({ model, prompt, proxyProfileId, size, signal }) {
  const profile = getActiveOpenAIProxyProfile(proxyProfileId || CUSTOM_PROXY_PROFILE_ID);
  const apiKey = keyManager.getNextKey(getOpenAIProxyKeyProvider(profile));
  if (!apiKey) {
    throw createProviderError('Chưa có API key cho Custom OpenAI-compatible.', 'COVER_IMAGE_MISSING_API_KEY');
  }
  const normalizedModel = trimText(model);
  if (!normalizedModel) {
    throw createProviderError('Chưa chọn model tạo bìa.', 'COVER_IMAGE_MISSING_MODEL');
  }

  if (profile.id === AG_PROXY_PROFILE_ID) {
    const chatPayload = buildOpenAIChatImagePayload({ model: normalizedModel, prompt, size });
    const chatTarget = resolveOpenAIProxyRequest(profile, 'chat');
    if (chatTarget.mode === 'relay') {
      return callOpenAIProxyChatImageRelay({ profile, target: chatTarget, apiKey, payload: chatPayload, signal });
    }
    return callOpenAIProxyChatImageDirect({ profile, target: chatTarget, apiKey, payload: chatPayload, signal });
  }

  const payload = buildOpenAIImagePayload({ model: normalizedModel, prompt, size });
  if (!payload.model) {
    throw createProviderError('Chưa chọn model tạo bìa.', 'COVER_IMAGE_MISSING_MODEL');
  }

  const target = resolveOpenAIProxyRequest(profile, 'image_generation');
  try {
    if (target.mode === 'relay') {
      return await callOpenAIProxyImageRelay({ profile, target, apiKey, payload, signal });
    }
    return await callOpenAIProxyImageDirect({ target, apiKey, payload, signal });
  } catch (error) {
    if (error?.code !== 'COVER_IMAGE_UNSUPPORTED_MODEL') {
      throw error;
    }
  }

  const chatPayload = buildOpenAIChatImagePayload({ model: normalizedModel, prompt, size });
  const chatTarget = resolveOpenAIProxyRequest(profile, 'chat');
  if (chatTarget.mode === 'relay') {
    return callOpenAIProxyChatImageRelay({ profile, target: chatTarget, apiKey, payload: chatPayload, signal });
  }
  return callOpenAIProxyChatImageDirect({ profile, target: chatTarget, apiKey, payload: chatPayload, signal });
}

export async function generateCoverImage({
  provider = COVER_IMAGE_PROVIDERS.GEMINI_DIRECT,
  model = '',
  prompt = '',
  proxyProfileId = '',
  size = DEFAULT_COVER_IMAGE_SIZE,
  signal,
} = {}) {
  const normalizedPrompt = trimText(prompt);
  if (!normalizedPrompt) {
    throw createProviderError('Chưa có prompt tạo bìa.', 'COVER_IMAGE_MISSING_PROMPT');
  }

  if (provider === COVER_IMAGE_PROVIDERS.GEMINI_DIRECT) {
    return generateGeminiCoverImage({ model, prompt: normalizedPrompt, signal });
  }

  if (provider === COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI) {
    return generateCloudflareWorkersAICoverImage({ model, prompt: normalizedPrompt, size, signal });
  }

  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) {
    return generateOpenAIProxyCoverImage({
      model,
      prompt: normalizedPrompt,
      proxyProfileId: AG_PROXY_PROFILE_ID,
      size,
      signal,
    });
  }

  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) {
    return generateOpenAIProxyCoverImage({ model, prompt: normalizedPrompt, proxyProfileId, size, signal });
  }

  throw createProviderError('Nhà cung cấp ảnh chưa được hỗ trợ.', 'COVER_IMAGE_UNSUPPORTED_PROVIDER');
}

export function getCoverProviderLabel(provider) {
  if (provider === COVER_IMAGE_PROVIDERS.GEMINI_DIRECT) return 'Gemini Direct';
  if (provider === COVER_IMAGE_PROVIDERS.AG_PROXY) return 'Gemini Proxy mặc định (AG)';
  if (provider === COVER_IMAGE_PROVIDERS.OPENAI_PROXY) return 'Custom OpenAI-compatible';
  if (provider === COVER_IMAGE_PROVIDERS.CLOUDFLARE_WORKERS_AI) return 'Cloudflare Workers AI';
  return 'Chưa chọn';
}
