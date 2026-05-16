const AI_ERROR_CODES = {
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_MODEL: 'MISSING_MODEL',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  MODEL_CAPACITY_EXHAUSTED: 'MODEL_CAPACITY_EXHAUSTED',
  SAFETY_BLOCK: 'SAFETY_BLOCK',
  EMPTY_STREAM: 'EMPTY_STREAM',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  BAD_REQUEST: 'BAD_REQUEST',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  PROXY_ERROR: 'PROXY_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

const ACCENTED_VIETNAMESE_RE = /[À-ỹĐđ]/;

function hasAccentedVietnamese(value) {
  return ACCENTED_VIETNAMESE_RE.test(String(value || ''));
}

function tryParseJson(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function providerLabel(provider) {
  if (provider === 'openai_proxy') return 'OpenAI-compatible Proxy';
  if (provider === 'gemini_proxy') return 'Gemini Proxy';
  if (provider === 'gemini_direct') return 'Gemini Direct';
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'ai_studio_relay') return 'AI Studio Relay';
  return 'AI';
}

function summarizeModel(model) {
  if (!model) return 'model hiện tại';
  if (model.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
  if (model.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (model.includes('gemini-3.1-flash-lite-preview')) return 'Gemini 3.1 Flash Lite';
  if (model.includes('gemini-3-flash-preview')) return 'Gemini 3 Flash Preview';
  return model;
}

function extractReason(details = []) {
  if (!Array.isArray(details)) return null;
  for (const item of details) {
    if (item?.reason) return item.reason;
    if (item?.metadata?.reason) return item.metadata.reason;
  }
  return null;
}

function extractModel(details = [], fallbackModel = null) {
  if (!Array.isArray(details)) return fallbackModel;
  for (const item of details) {
    if (item?.metadata?.model) return item.metadata.model;
  }
  return fallbackModel;
}

function extractErrorShape(input = {}) {
  const sourceError = input.error ?? input;
  const payloadError = sourceError?.error && typeof sourceError.error === 'object'
    ? sourceError.error
    : null;

  const bodyPayload = tryParseJson(input.bodyText);
  const nestedBodyError = bodyPayload?.error && typeof bodyPayload.error === 'object'
    ? bodyPayload.error
    : (bodyPayload && typeof bodyPayload === 'object' ? bodyPayload : null);

  const directErrorData = sourceError && typeof sourceError === 'object' && sourceError !== input
    ? sourceError
    : null;
  const errorData = payloadError || nestedBodyError || directErrorData || null;
  const details = errorData?.details || [];

  const message = input.rawMessage
    || errorData?.message
    || sourceError?.message
    || input.bodyText
    || '';

  return {
    message: String(message || '').trim(),
    status: Number(input.status || errorData?.code || sourceError?.status || 0) || null,
    code: String(input.code || errorData?.code || errorData?.type || sourceError?.code || '').trim() || null,
    reason: String(input.reason || extractReason(details) || errorData?.status || errorData?.type || sourceError?.reason || '').trim() || null,
    details,
    model: extractModel(details, input.model || null),
  };
}

function createAIError({
  userMessage,
  code,
  provider,
  model,
  status = null,
  rawMessage = '',
  reason = null,
  details = [],
  retryable = false,
  shouldFallback = false,
}) {
  const error = new Error(userMessage);
  error.code = code || AI_ERROR_CODES.UNKNOWN_ERROR;
  error.status = status;
  error.provider = provider || null;
  error.model = model || null;
  error.rawMessage = rawMessage || '';
  error.reason = reason || null;
  error.details = Array.isArray(details) ? details : [];
  error.retryable = retryable;
  error.shouldFallback = shouldFallback;
  return error;
}

export function normalizeAIError(input = {}, context = {}) {
  const shape = extractErrorShape(input);
  const provider = context.provider || input.provider || null;
  const model = shape.model || context.model || input.model || null;
  const rawMessage = shape.message || 'Unknown AI error';
  const lower = rawMessage.toLowerCase();
  const codeLower = String(shape.code || '').toLowerCase();
  const reasonLower = String(shape.reason || '').toLowerCase();
  const modelName = summarizeModel(model);
  const providerName = providerLabel(provider);

  if (shape.code === AI_ERROR_CODES.MISSING_API_KEY || lower.includes('không có api key') || lower.includes('khong co api key')) {
    return createAIError({
      userMessage: `Chưa có API key cho ${providerName}. Vào Settings để thêm key.`,
      code: AI_ERROR_CODES.MISSING_API_KEY,
      provider,
      model,
      status: shape.status,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
    });
  }

  if (shape.code === AI_ERROR_CODES.MISSING_MODEL || lower.includes('chua chon model')) {
    return createAIError({
      userMessage: `Chưa chọn model cho ${providerName}. Vào Settings để lấy models hoặc nhập model thủ công.`,
      code: AI_ERROR_CODES.MISSING_MODEL,
      provider,
      model,
      status: shape.status,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
    });
  }

  if (shape.code === AI_ERROR_CODES.EMPTY_STREAM || lower.includes('empty_stream')) {
    return createAIError({
      userMessage: 'AI không trả nội dung. Thử lại hoặc đổi model/chất lượng trong Settings.',
      code: AI_ERROR_CODES.EMPTY_STREAM,
      provider,
      model,
      status: shape.status,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
      retryable: true,
      shouldFallback: true,
    });
  }

  if (shape.code === AI_ERROR_CODES.SAFETY_BLOCK || lower.includes('safety_block') || lower.includes('safety')) {
    return createAIError({
      userMessage: 'Nội dung bị chặn bởi bộ lọc an toàn của model hiện tại.',
      code: AI_ERROR_CODES.SAFETY_BLOCK,
      provider,
      model,
      status: shape.status,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
    });
  }

  if (shape.reason === 'MODEL_CAPACITY_EXHAUSTED' || lower.includes('no capacity available for model') || lower.includes('model_capacity_exhausted')) {
    return createAIError({
      userMessage: `${modelName} đang quá tải tạm thời ở phía server. Đây không phải lỗi hết lượt của tài khoản. Hãy thử lại sau ít giây hoặc đổi sang model Flash/Nhanh.`,
      code: AI_ERROR_CODES.MODEL_CAPACITY_EXHAUSTED,
      provider,
      model,
      status: shape.status || 429,
      rawMessage,
      reason: shape.reason || 'MODEL_CAPACITY_EXHAUSTED',
      details: shape.details,
      retryable: true,
      shouldFallback: true,
    });
  }

  if (
    codeLower === 'quota_exceeded'
    || reasonLower === 'quota_exceeded'
    || lower.includes('quota_exceeded')
    || lower.includes('daily limit reached')
    || lower.includes('quota exceeded')
    || lower.includes('resource_exhausted')
  ) {
    const isAgQuota = lower.includes('antigravity')
      || lower.includes('gemini3')
      || String(model || '').includes('真流')
      || String(model || '').includes('星星公益站');
    const quotaProviderName = isAgQuota ? 'Gemini Proxy/Antigravity' : providerName;
    const quotaModelName = lower.includes('gemini3') || String(model || '').includes('gemini-3')
      ? 'Gemini 3'
      : modelName;

    return createAIError({
      userMessage: `${quotaProviderName} đã hết quota ngày cho ${quotaModelName}. Đây là giới hạn từ proxy/upstream, không phải lỗi prompt. Hãy đổi sang Gemini 2.5 Flash hoặc model khác, thêm key còn quota, hoặc chờ quota ngày reset.`,
      code: AI_ERROR_CODES.QUOTA_EXCEEDED,
      provider,
      model,
      status: shape.status || 429,
      rawMessage,
      reason: shape.reason || 'quota_exceeded',
      details: shape.details,
      retryable: true,
      shouldFallback: true,
    });
  }

  if (shape.status === 429 || shape.code === '429' || lower.includes('rate_limited') || lower.includes('rate limit')) {
    return createAIError({
      userMessage: `${providerName} đang chặn tạm thời do giới hạn lượt gọi hoặc tốc độ gọi. Hãy thử lại sau ít giây, đổi key, hoặc hạ model/chất lượng.`,
      code: AI_ERROR_CODES.RATE_LIMITED,
      provider,
      model,
      status: shape.status || 429,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
      retryable: true,
      shouldFallback: true,
    });
  }

  if (shape.status === 401 || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return createAIError({
      userMessage: `${providerName} từ chối xác thực. Kiểm tra lại API key đang dùng.`,
      code: AI_ERROR_CODES.UNAUTHORIZED,
      provider,
      model,
      status: shape.status || 401,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
    });
  }

  if (shape.status === 403 || lower.includes('forbidden') || lower.includes('permission denied')) {
    return createAIError({
      userMessage: `API key hiện tại không có quyền dùng ${modelName} hoặc bị chặn truy cập.`,
      code: AI_ERROR_CODES.FORBIDDEN,
      provider,
      model,
      status: shape.status || 403,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
    });
  }

  if (shape.status === 400 || lower.includes('bad request') || lower.includes('invalid argument')) {
    return createAIError({
      userMessage: `Yêu cầu gửi tới ${providerName} không hợp lệ. Kiểm tra prompt đầu vào hoặc model đã chọn.`,
      code: AI_ERROR_CODES.BAD_REQUEST,
      provider,
      model,
      status: shape.status || 400,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
    });
  }

  if (shape.status >= 500 || lower.includes('proxy error 5') || lower.includes('gemini error 5') || lower.includes('server error')) {
    return createAIError({
      userMessage: `Máy chủ ${providerName} đang lỗi hoặc upstream không ổn định. Thử lại sau ít phút.`,
      code: AI_ERROR_CODES.SERVER_ERROR,
      provider,
      model,
      status: shape.status || 500,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
      retryable: true,
    });
  }

  if (
    shape.code === AI_ERROR_CODES.NETWORK_ERROR
    || lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('load failed')
    || lower.includes('cannot connect')
    || lower.includes('ai_studio_relay')
  ) {
    return createAIError({
      userMessage: `Không thể kết nối tới ${providerName}. Kiểm tra mạng hoặc URL cấu hình trong Settings.`,
      code: AI_ERROR_CODES.NETWORK_ERROR,
      provider,
      model,
      status: shape.status,
      rawMessage,
      reason: shape.reason,
      details: shape.details,
      retryable: true,
    });
  }

  return createAIError({
    userMessage: hasAccentedVietnamese(rawMessage)
      ? rawMessage
      : `Đã xảy ra lỗi AI chưa xác định từ ${providerName}. Hãy thử lại hoặc đổi model/API key.`,
    code: shape.code || AI_ERROR_CODES.UNKNOWN_ERROR,
    provider,
    model,
    status: shape.status,
    rawMessage,
    reason: shape.reason,
    details: shape.details,
  });
}

export function shouldFallbackForError(error) {
  return Boolean(
    error?.shouldFallback
    || error?.code === AI_ERROR_CODES.QUOTA_EXCEEDED
    || error?.code === AI_ERROR_CODES.RATE_LIMITED
    || error?.code === AI_ERROR_CODES.MODEL_CAPACITY_EXHAUSTED,
  );
}

export { AI_ERROR_CODES };
