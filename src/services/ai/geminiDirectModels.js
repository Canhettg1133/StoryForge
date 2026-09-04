const DEFAULT_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 15_000;
const EXCLUDED_MODEL_MARKERS = [
  'embedding',
  'embed-',
  'imagen',
  'image-generation',
  'veo',
  'video',
  'tts',
  'speech',
  'audio',
  'aqa',
  'live',
];

export class GeminiDirectModelsError extends Error {
  constructor(code, message, { status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GeminiDirectModelsError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeGeminiDirectModelId(modelId) {
  const normalized = String(modelId || '')
    .trim()
    .replace(/^models\//i, '');
  const lower = normalized.toLowerCase();
  if (!/^(gemini|gemma)(?:[-_.][a-z0-9][a-z0-9._-]*)$/i.test(normalized)) return '';
  if (EXCLUDED_MODEL_MARKERS.some((marker) => lower.includes(marker))) return '';
  return lower;
}

export function isUsableGeminiDirectTextModel(model) {
  const id = normalizeGeminiDirectModelId(model?.name);
  if (!id) return false;
  const methods = Array.isArray(model?.supportedGenerationMethods)
    ? model.supportedGenerationMethods
    : [];
  return methods.some((method) => String(method).toLowerCase() === 'generatecontent');
}

export function getGeminiDirectModelsUrl(baseUrl = DEFAULT_MODELS_URL) {
  const url = new URL(String(baseUrl || DEFAULT_MODELS_URL).trim());
  const path = url.pathname.replace(/\/+$/u, '');
  if (path.endsWith('/v1beta/models')) {
    url.pathname = path;
  } else if (path.endsWith('/v1beta')) {
    url.pathname = `${path}/models`;
  } else {
    url.pathname = `${path}/v1beta/models`.replace(/^\/+/u, '/');
  }
  url.search = '';
  url.hash = '';
  return url;
}

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new GeminiDirectModelsError(
      'UNAUTHORIZED',
      'API key Gemini không hợp lệ hoặc chưa được cấp quyền ListModels.',
      { status },
    );
  }
  if (status === 429) {
    return new GeminiDirectModelsError(
      'RATE_LIMITED',
      'Google AI Studio đang giới hạn yêu cầu. Vui lòng thử lại sau.',
      { status },
    );
  }
  return new GeminiDirectModelsError(
    'HTTP_ERROR',
    `Không thể lấy danh sách model từ Google AI Studio (HTTP ${status}).`,
    { status },
  );
}

export async function fetchGeminiDirectModels({
  apiKey,
  baseUrl = DEFAULT_MODELS_URL,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedKey = String(apiKey || '').trim();
  if (!normalizedKey) {
    throw new GeminiDirectModelsError(
      'MISSING_KEY',
      'Hãy thêm ít nhất một API key Gemini Direct trước khi lấy model.',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new GeminiDirectModelsError('NETWORK', 'Trình duyệt không hỗ trợ gửi yêu cầu mạng.');
  }

  const requestController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => requestController.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

  const catalog = new Map();
  const seenPageTokens = new Set();
  let nextPageToken = '';

  try {
    do {
      const url = getGeminiDirectModelsUrl(baseUrl);
      url.searchParams.set('pageSize', '1000');
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          headers: { 'x-goog-api-key': normalizedKey },
          signal: requestController.signal,
        });
      } catch (error) {
        if (timedOut) {
          throw new GeminiDirectModelsError('TIMEOUT', 'Yêu cầu lấy model đã quá thời gian chờ.', { cause: error });
        }
        if (requestController.signal.aborted) {
          throw new GeminiDirectModelsError('ABORTED', 'Đã hủy yêu cầu lấy model.', { cause: error });
        }
        throw new GeminiDirectModelsError(
          'NETWORK',
          'Không thể kết nối Google AI Studio. Hãy kiểm tra mạng rồi thử lại.',
          { cause: error },
        );
      }

      if (!response?.ok) throw mapHttpError(Number(response?.status) || 0);

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new GeminiDirectModelsError(
          'INVALID_RESPONSE',
          'Google AI Studio trả về dữ liệu không hợp lệ.',
          { cause: error },
        );
      }

      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.models)) {
        throw new GeminiDirectModelsError(
          'INVALID_RESPONSE',
          'Google AI Studio trả về dữ liệu không hợp lệ.',
        );
      }

      payload.models.forEach((model) => {
        if (!isUsableGeminiDirectTextModel(model)) return;
        const id = normalizeGeminiDirectModelId(model.name);
        if (catalog.has(id)) return;
        catalog.set(id, {
          id,
          label: String(model.displayName || '').trim() || id,
          source: 'fetched',
        });
      });

      const candidateToken = String(payload.nextPageToken || '').trim();
      if (candidateToken && seenPageTokens.has(candidateToken)) {
        throw new GeminiDirectModelsError(
          'INVALID_RESPONSE',
          'Google AI Studio trả về phân trang không hợp lệ.',
        );
      }
      if (candidateToken) seenPageTokens.add(candidateToken);
      nextPageToken = candidateToken;
    } while (nextPageToken);

    const models = [...catalog.values()];
    if (models.length === 0) {
      throw new GeminiDirectModelsError(
        'NO_MODELS',
        'Không tìm thấy model Gemini/Gemma nào hỗ trợ viết văn bản.',
      );
    }
    return models;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
