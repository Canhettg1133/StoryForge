/**
 * StoryForge — AI Client v2
 * 
 * 3 Providers, keys tách riêng:
 *   1. Gemini Proxy (星星) — keys từ pool 'gemini_proxy'
 *   2. Gemini Direct (AI Studio) — keys từ pool 'gemini_direct'
 *   3. Ollama — không cần key
 */

import keyManager from './keyManager';
import { PROVIDERS } from './router';

const SETTINGS_KEY = 'sf-ai-settings';

function getSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

export function saveSettings(settings) {
  const current = getSettings();
  const merged = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function getProxyUrl() {
  return getSettings().proxyUrl || '/api/proxy';
}

export function getOllamaUrl() {
  return getSettings().ollamaUrl || 'http://localhost:11434';
}

// ================================
// Gemini Proxy (OpenAI-compatible)
// ================================
async function callGeminiProxy({ model, messages, stream = true, signal, onToken, onComplete, onError }) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) throw new Error('Chưa cấu hình Proxy URL.');

  const apiKey = keyManager.getNextKey('gemini_proxy');
  if (!apiKey) throw new Error('Không có API key cho Gemini Proxy.');

  const url = `${proxyUrl}/v1/chat/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream }),
      signal,
    });

    if (response.status === 429) {
      keyManager.markRateLimited(apiKey, 60000);
      throw new Error('RATE_LIMITED');
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Proxy error ${response.status}: ${errText}`);
    }

    if (!stream) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      onComplete?.(text);
      return text;
    }
    return await streamSSE(response, { onToken, onComplete, onError });
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.message === 'RATE_LIMITED') throw err;
    onError?.(err);
    throw err;
  }
}

// ================================
// Gemini Direct (Google AI Studio)
// ================================
async function callGeminiDirect({ model, messages, stream = true, signal, onToken, onComplete, onError }) {
  const apiKey = keyManager.getNextKey('gemini_direct');
  if (!apiKey) throw new Error('Không có API key cho Gemini Direct.');

  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}${stream ? '&alt=sse' : ''}`;

  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find(m => m.role === 'system');
  const body = {
    contents,
    ...(systemInstruction && {
      systemInstruction: { parts: [{ text: systemInstruction.content }] },
    }),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (response.status === 429) {
      keyManager.markRateLimited(apiKey, 60000);
      throw new Error('RATE_LIMITED');
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini error ${response.status}: ${errText}`);
    }

    if (!stream) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      onComplete?.(text);
      return text;
    }
    return await streamGeminiSSE(response, { onToken, onComplete, onError });
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.message === 'RATE_LIMITED') throw err;
    onError?.(err);
    throw err;
  }
}

// ================================
// Ollama
// ================================
async function callOllama({ model, messages, stream = true, signal, onToken, onComplete, onError }) {
  const url = `${getOllamaUrl()}/api/chat`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 404) throw new Error(`Model "${model}" không tìm thấy. Chạy: ollama pull ${model}`);
      throw new Error(`Ollama error ${response.status}: ${errText}`);
    }

    if (!stream) {
      const data = await response.json();
      onComplete?.(data.message?.content || '');
      return;
    }
    return await streamNDJSON(response, { onToken, onComplete, onError });
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError?.(err);
    throw err;
  }
}

// ================================
// Stream Parsers
// ================================
async function streamSSE(response, { onToken, onComplete, onError }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '', buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const d = t.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          const delta = p.choices?.[0]?.delta?.content || '';
          if (delta) { fullText += delta; onToken?.(delta, fullText); }
        } catch { }
      }
    }
    onComplete?.(fullText);
  } catch (err) {
    if (err.name === 'AbortError') { onComplete?.(fullText); return; }
    // Preserve partial text on error
    if (fullText) { onComplete?.(fullText); } else { onError?.(err); }
  }
}

async function streamGeminiSSE(response, { onToken, onComplete, onError }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '', buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(t.slice(6));
          const text = p.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) { fullText += text; onToken?.(text, fullText); }
        } catch { }
      }
    }
    onComplete?.(fullText);
  } catch (err) {
    if (err.name === 'AbortError') { onComplete?.(fullText); return; }
    // Preserve partial text on error
    if (fullText) { onComplete?.(fullText); } else { onError?.(err); }
  }
}

async function streamNDJSON(response, { onToken, onComplete, onError }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '', buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const p = JSON.parse(t);
          if (p.done) continue;
          const c = p.message?.content || '';
          if (c) { fullText += c; onToken?.(c, fullText); }
        } catch { }
      }
    }
    onComplete?.(fullText);
  } catch (err) {
    if (err.name === 'AbortError') { onComplete?.(fullText); return; }
    // Preserve partial text on error
    if (fullText) { onComplete?.(fullText); } else { onError?.(err); }
  }
}

// ================================
// Provider selector
// ================================
function getCallFn(provider) {
  switch (provider) {
    case PROVIDERS.GEMINI_DIRECT: return callGeminiDirect;
    case PROVIDERS.GEMINI_PROXY: return callGeminiProxy;
    case PROVIDERS.OLLAMA: return callOllama;
    default: return callGeminiProxy;
  }
}

// ================================
// AI Service
// ================================
class AIService {
  constructor() {
    this.activeController = null;
    this._router = null;
  }

  setRouter(router) { this._router = router; }

  send({ taskType, messages, stream = true, onToken, onComplete, onError, routeOptions = {} }) {
    this.abort();
    const controller = new AbortController();
    this.activeController = controller;

    const route = this._router.route(taskType, routeOptions);
    const startTime = Date.now();

    const wrappedOnComplete = (text) => {
      this.activeController = null;
      onComplete?.(text, { model: route.model, provider: route.provider, elapsed: Date.now() - startTime });
    };

    const wrappedOnError = async (err) => {
      if (err.message === 'RATE_LIMITED' && this._router) {
        const fallbacks = this._router.getFallbacks(route);
        for (const fb of fallbacks) {
          try {
            await getCallFn(fb.provider)({
              model: fb.model, messages, stream, signal: controller.signal,
              onToken, onComplete: wrappedOnComplete,
              onError: (e) => { this.activeController = null; onError?.(e); },
            });
            return;
          } catch { continue; }
        }
      }
      this.activeController = null;
      onError?.(err);
    };

    getCallFn(route.provider)({
      model: route.model, messages, stream, signal: controller.signal,
      onToken, onComplete: wrappedOnComplete, onError: wrappedOnError,
    }).catch(wrappedOnError);

    return { abort: () => this.abort(), routeInfo: route };
  }

  abort() {
    if (this.activeController) { this.activeController.abort(); this.activeController = null; }
  }

  isActive() { return this.activeController !== null; }

  async testConnection(provider) {
    try {
      if (provider === PROVIDERS.OLLAMA) {
        const res = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        return { success: true, models: data.models?.map(m => m.name) || [] };
      }
      if (provider === PROVIDERS.GEMINI_PROXY) {
        const apiKey = keyManager.getNextKey('gemini_proxy') || 'test';
        const res = await fetch(`${getProxyUrl()}/v1/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        return { success: true, models: data.data?.map(m => m.id) || [] };
      }
      if (provider === PROVIDERS.GEMINI_DIRECT) {
        const apiKey = keyManager.getNextKey('gemini_direct');
        if (!apiKey) return { success: false, error: 'Chưa có API key' };
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return { success: true, models: [] };
      }
      return { success: false, error: 'Unknown provider' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

const aiService = new AIService();
export default aiService;
