import { ANALYSIS_CONFIG, ANALYSIS_PROVIDERS } from './analysisConfig.js';

function createRequestError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

function getErrorCodeFromHttpStatus(status) {
  if (status === 429) return 'AI_RATE_LIMIT';
  if (status === 401 || status === 403) return 'AI_UNAUTHORIZED';
  if (status >= 500) return 'AI_SERVICE_UNAVAILABLE';
  return 'AI_REQUEST_FAILED';
}

function resolveProxyUrl(explicitUrl) {
  const trimmed = String(explicitUrl || '').trim();

  if (trimmed) {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // #region agent log
      fetch('http://127.0.0.1:7318/ingest/696724e1-b2c9-4252-acee-7b5a42d39699',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c624c'},body:JSON.stringify({sessionId:'8c624c',location:'sessionClient.js:resolveProxyUrl',message:'Using absolute proxy URL',data:{url:trimmed},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      return trimmed;
    }
  }

  const fallback = (
    process.env.STORYFORGE_GEMINI_PROXY_URL
    || process.env.STORYFORGE_PROXY_URL
    || process.env.PROXY_URL
    || null
  );
  // #region agent log
  fetch('http://127.0.0.1:7318/ingest/696724e1-b2c9-4252-acee-7b5a42d39699',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c624c'},body:JSON.stringify({sessionId:'8c624c',location:'sessionClient.js:resolveProxyUrl',message:'No explicit URL, using fallback or null',data:{fallback,explicit:trimmed||'none'},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  return fallback;
}

function resolveDirectUrl(explicitUrl) {
  if (explicitUrl) {
    return explicitUrl;
  }

  return (
    process.env.STORYFORGE_GEMINI_DIRECT_URL
    || process.env.GEMINI_DIRECT_URL
    || 'https://generativelanguage.googleapis.com'
  );
}

function parseApiKeys(input) {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  return String(input)
    .split(/[\n,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueKeys(keys = []) {
  return [...new Set(keys)];
}

function resolveApiKeys(provider, explicitKeys, explicitKey) {
  const incoming = uniqueKeys([
    ...parseApiKeys(explicitKeys),
    ...parseApiKeys(explicitKey),
  ]);

  if (incoming.length > 0) {
    return incoming;
  }

  if (provider === ANALYSIS_PROVIDERS.GEMINI_DIRECT) {
    return uniqueKeys([
      ...parseApiKeys(process.env.STORYFORGE_GEMINI_DIRECT_API_KEYS),
      ...parseApiKeys(process.env.STORYFORGE_GEMINI_DIRECT_API_KEY),
      ...parseApiKeys(process.env.GEMINI_API_KEY),
    ]);
  }

  return uniqueKeys([
    ...parseApiKeys(process.env.STORYFORGE_GEMINI_PROXY_KEYS),
    ...parseApiKeys(process.env.STORYFORGE_GEMINI_PROXY_KEY),
    ...parseApiKeys(process.env.STORYFORGE_PROXY_API_KEY),
    ...parseApiKeys(process.env.GEMINI_PROXY_API_KEY),
  ]);
}

function toOpenAIMessages(systemPrompt, history) {
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  for (const item of history) {
    messages.push({
      role: item.role,
      content: item.content,
    });
  }

  return messages;
}

function toGeminiContents(history) {
  return history.map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.content }],
  }));
}

function parseGeminiText(responsePayload) {
  const parts = responsePayload?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || '')
    .join('')
    .trim();
}

function parseGeminiFinishReason(responsePayload) {
  return responsePayload?.candidates?.[0]?.finishReason || 'STOP';
}

function parseProxyText(payload) {
  return payload?.choices?.[0]?.message?.content?.trim() || '';
}

function parseProxyFinishReason(payload) {
  return payload?.choices?.[0]?.finish_reason || 'stop';
}

function buildGeminiDirectUrl(baseUrl, model, apiKey) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/u, '');
  const versionBase = normalizedBase.endsWith('/v1beta')
    ? normalizedBase
    : `${normalizedBase}/v1beta`;

  return `${versionBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export class SessionClient {
  constructor(options = {}) {
    this.provider = options.provider || ANALYSIS_CONFIG.provider;
    this.model = options.model;
    this.temperature = Number(options.temperature) || ANALYSIS_CONFIG.defaults.temperature;
    this.maxOutputTokens = Number(options.maxOutputTokens) || ANALYSIS_CONFIG.session.maxOutputPerPart;
    this.apiKeys = resolveApiKeys(this.provider, options.apiKeys, options.apiKey);
    const cursorInput = Number(options.apiKeyCursorStart);
    this.apiKeyCursor = Number.isFinite(cursorInput) && cursorInput >= 0
      ? Math.floor(cursorInput)
      : 0;
    this.proxyUrl = resolveProxyUrl(options.proxyUrl);
    this.directUrl = resolveDirectUrl(options.directUrl);
    this.systemPrompt = '';
    this.history = [];

    if (!this.model) {
      throw createRequestError('Thiếu model cho session phân tích.', 'INVALID_MODEL');
    }

    if (!this.apiKeys.length) {
      throw createRequestError(
        `Thiếu khóa API cho provider ${this.provider}.`,
        'MISSING_API_KEY',
      );
    }

    if (this.apiKeys.length > 0) {
      this.apiKeyCursor %= this.apiKeys.length;
    }

    if (this.provider === ANALYSIS_PROVIDERS.GEMINI_PROXY && !this.proxyUrl) {
      throw createRequestError(
        'Thiếu Gemini proxy URL. Hãy đặt STORYFORGE_GEMINI_PROXY_URL.',
        'MISSING_PROXY_URL',
      );
    }
  }

  async startSession(text, systemPrompt, options = {}) {
    this.systemPrompt = String(systemPrompt || '').trim();
    this.history = [
      {
        role: 'user',
        content: String(text || ''),
      },
    ];

    return this.requestCompletion(options);
  }

  async continueSession(prompt, options = {}) {
    if (this.history.length === 0) {
      throw createRequestError('Không có session đang hoạt động.', 'NO_ACTIVE_SESSION');
    }

    this.history.push({
      role: 'user',
      content: String(prompt || ANALYSIS_CONFIG.session.continuePrompt),
    });

    return this.requestCompletion(options);
  }

  endSession() {
    this.history = [];
    this.systemPrompt = '';
  }

  getKeyAtIndex(index) {
    const keyCount = this.apiKeys.length;
    if (!keyCount) {
      return null;
    }

    const safeIndex = ((index % keyCount) + keyCount) % keyCount;
    return this.apiKeys[safeIndex];
  }

  async executeWithApiKeyRotation(requestFn) {
    const keyCount = this.apiKeys.length;
    let lastRetryableError = null;
    const retryableCodes = new Set([
      'AI_RATE_LIMIT',
      'AI_UNAUTHORIZED',
      'AI_SERVICE_UNAVAILABLE',
    ]);

    for (let offset = 0; offset < keyCount; offset += 1) {
      const keyIndex = (this.apiKeyCursor + offset) % keyCount;
      const apiKey = this.getKeyAtIndex(keyIndex);

      if (!apiKey) {
        continue;
      }

      try {
        const result = await requestFn(apiKey);
        this.apiKeyCursor = (keyIndex + 1) % keyCount;
        return result;
      } catch (error) {
        if (retryableCodes.has(error?.code)) {
          lastRetryableError = error;
          continue;
        }

        throw error;
      }
    }

    if (lastRetryableError) {
      throw lastRetryableError;
    }

    throw createRequestError(
      `Không thể hoàn tất request cho provider ${this.provider}.`,
      'AI_REQUEST_FAILED',
    );
  }

  async requestCompletion(options = {}) {
    if (this.provider === ANALYSIS_PROVIDERS.GEMINI_DIRECT) {
      return this.requestGeminiDirect(options);
    }

    return this.requestGeminiProxy(options);
  }

  async requestGeminiProxy(options = {}) {
    const url = `${this.proxyUrl.replace(/\/+$/u, '')}/v1/chat/completions`;
    const body = {
      model: this.model,
      messages: toOpenAIMessages(this.systemPrompt, this.history),
      stream: false,
      temperature: this.temperature,
      max_tokens: this.maxOutputTokens,
    };

    const payload = await this.executeWithApiKeyRotation(async (apiKey) => {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });
      } catch (error) {
        throw createRequestError(
          `Không thể kết nối Gemini proxy: ${error?.message || 'Network error'}`,
          'AI_SERVICE_UNAVAILABLE',
          { cause: error?.message || String(error || '') },
        );
      }

      const responsePayload = await response.json().catch(() => null);

      if (!response.ok) {
        throw createRequestError(
          responsePayload?.error?.message
            || responsePayload?.error
            || `Yêu cầu Gemini proxy thất bại với mã ${response.status}`,
          getErrorCodeFromHttpStatus(response.status),
          {
            ...(responsePayload && typeof responsePayload === 'object'
              ? responsePayload
              : { payload: responsePayload }),
            status: response.status,
          },
        );
      }

      return responsePayload;
    });

    const text = parseProxyText(payload);
    const finishReason = parseProxyFinishReason(payload);

    this.history.push({ role: 'assistant', content: text });

    return {
      text,
      finishReason,
      usageMetadata: {
        promptTokenCount: payload?.usage?.prompt_tokens ?? null,
        candidatesTokenCount: payload?.usage?.completion_tokens ?? null,
        totalTokenCount: payload?.usage?.total_tokens ?? null,
      },
    };
  }

  async requestGeminiDirect(options = {}) {
    const body = {
      contents: toGeminiContents(this.history),
      generationConfig: {
        maxOutputTokens: this.maxOutputTokens,
        temperature: this.temperature,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    if (this.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: this.systemPrompt }],
      };
    }

    const payload = await this.executeWithApiKeyRotation(async (apiKey) => {
      const requestUrl = buildGeminiDirectUrl(this.directUrl, this.model, apiKey);
      let response;
      try {
        response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });
      } catch (error) {
        throw createRequestError(
          `Không thể kết nối Gemini direct: ${error?.message || 'Network error'}`,
          'AI_SERVICE_UNAVAILABLE',
          { cause: error?.message || String(error || '') },
        );
      }

      const responsePayload = await response.json().catch(() => null);

      if (!response.ok) {
        throw createRequestError(
          responsePayload?.error?.message || `Yêu cầu Gemini trực tiếp thất bại với mã ${response.status}`,
          getErrorCodeFromHttpStatus(response.status),
          {
            ...(responsePayload && typeof responsePayload === 'object'
              ? responsePayload
              : { payload: responsePayload }),
            status: response.status,
          },
        );
      }

      return responsePayload;
    });

    const text = parseGeminiText(payload);
    const finishReason = parseGeminiFinishReason(payload);

    this.history.push({ role: 'assistant', content: text });

    return {
      text,
      finishReason,
      usageMetadata: {
        promptTokenCount: payload?.usageMetadata?.promptTokenCount ?? null,
        candidatesTokenCount: payload?.usageMetadata?.candidatesTokenCount ?? null,
        totalTokenCount: payload?.usageMetadata?.totalTokenCount ?? null,
      },
    };
  }
}

export default SessionClient;
