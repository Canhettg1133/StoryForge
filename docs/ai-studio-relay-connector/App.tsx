/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @ts-nocheck

import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';

const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET_SESSION_KEY = "storyforge_oauth_client_secret";
const OAUTH_REDIRECT_URI = "http://localhost:11451";
const OAUTH_SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

type CredentialStatus = 'Ready' | 'In Use' | 'Limit Exceeded' | 'Expired' | 'Invalid Token' | 'Refreshing';

interface Credential {
  id: string;
  client_id: string;
  client_secret?: string;
  refresh_token: string;
  access_token?: string;
  token_expiry?: number;
  status: CredentialStatus;
  requestsUsed: number;
  lastResetTime: number;
  email?: string;
}

function sanitizeCredential(cred: Credential): Credential {
  return { ...cred, client_secret: '' };
}

function sanitizeStoredCredentials(value: unknown): Credential[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(Boolean)
    .map((cred) => sanitizeCredential(cred as Credential));
}

const refreshGoogleToken = async (cred: Credential, oauthClientSecret: string): Promise<Partial<Credential> | null> => {
  try {
    const clientSecret = String(cred.client_secret || oauthClientSecret || '').trim();
    if (!clientSecret) return null;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.client_id,
        client_secret: clientSecret,
        refresh_token: cred.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    const data = await res.json();
    if (data.access_token) {
      return { access_token: data.access_token, token_expiry: Date.now() + data.expires_in * 1000, status: 'Ready' };
    }
    return null;
  } catch (e) { return null; }
};

const DEFAULT_RELAY_URL = 'https://storyforge-ai-studio-relay.canhettg113.workers.dev';
const HEARTBEAT_INTERVAL_MS = 15000;
const POLL_INTERVAL_MS = 1000;
const BACKGROUND_RECOVERY_NOTICE_MS = 3000;

const DEFAULT_MODEL_OPTIONS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest', note: 'Alias mới nhất, Google tự trỏ tới bản Flash hiện hành' },
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite Latest', note: 'Alias mới nhất, nhẹ và tiết kiệm hơn' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro Latest', note: 'Alias mới nhất, ưu tiên chất lượng' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', note: 'Preview, có thể bị giới hạn theo tài khoản' },
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview', note: 'Preview, tối ưu tốc độ và chi phí' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', note: 'Preview, nhanh trong dòng Gemini 3' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Ổn định, nên dùng khi model preview/latest lỗi' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', note: 'Ổn định, nhanh và nhẹ hơn' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'Ổn định, chất lượng cao hơn' },
  { id: 'gemini-2.5-flash-preview-09-2025', label: 'Gemini 2.5 Flash Preview 09-2025', note: 'Preview nếu tài khoản còn hỗ trợ' },
  { id: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite Preview 09-2025', note: 'Preview nếu tài khoản còn hỗ trợ' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: 'Model cũ hơn, dùng để fallback' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', note: 'Model cũ hơn, nhẹ và tiết kiệm' },
];

type ConnectorStatus = 'idle' | 'connecting' | 'connected' | 'running' | 'error';

type StoryForgeMessage = {
  role?: string;
  content?: string;
};

type RelayPayload = {
  type?: string;
  requestId?: string;
  model?: string;
  messages?: StoryForgeMessage[];
  text?: string;
  code?: string;
  message?: string;
  ts?: number;
};

type ModelOption = {
  id: string;
  label: string;
  note: string;
};

function getStatusText(status: ConnectorStatus) {
  if (status === 'connecting') return 'Đang kết nối';
  if (status === 'connected') return 'Đã kết nối';
  if (status === 'running') return 'Đang chạy';
  if (status === 'error') return 'Có lỗi';
  return 'Đang chờ';
}

function getStatusClass(status: ConnectorStatus) {
  if (status === 'connected') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'connecting') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function getStatusDotClass(status: ConnectorStatus) {
  if (status === 'connected') return 'bg-emerald-600';
  if (status === 'running') return 'animate-pulse bg-blue-600';
  if (status === 'error') return 'bg-red-600';
  if (status === 'connecting') return 'animate-pulse bg-amber-500';
  return 'bg-slate-500';
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  if (minutes <= 0) return `${rest} giây`;
  return `${minutes} phút ${rest} giây`;
}

function toRelayWebSocketUrl(relayUrl: string, roomCode: string) {
  const url = new URL(relayUrl.trim());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/rooms/${encodeURIComponent(roomCode.trim())}`;
  url.search = 'role=connector';
  return url.toString();
}

function toRelayHttpUrl(relayUrl: string, roomCode: string, action: 'poll' | 'send') {
  const url = new URL(relayUrl.trim());
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/rooms/${encodeURIComponent(roomCode.trim())}/${action}`;
  url.search = 'role=connector';
  return url.toString();
}

function splitMessages(messages: StoryForgeMessage[] = []) {
  const systemParts: string[] = [];
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const message of messages) {
    const content = String(message?.content || '');
    if (!content) continue;

    if (message.role === 'system') {
      systemParts.push(content);
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content }],
    });
  }

  return {
    systemInstruction: systemParts.join('\n\n'),
    contents,
  };
}

function readChunkText(chunk: any) {
  if (!chunk) return '';
  if (typeof chunk.text === 'function') return chunk.text();
  if (typeof chunk.text === 'string') return chunk.text;
  return chunk.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('') || '';
}

function normalizeModelName(name: string) {
  return String(name || '').replace(/^models\//u, '').trim();
}

function toDisplayName(modelId: string) {
  return normalizeModelName(modelId)
    .replace(/^gemini-/u, 'Gemini ')
    .replace(/-/gu, ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function isLikelyMobileBrowser() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const narrowScreen = typeof window !== 'undefined'
    ? Boolean(window.matchMedia?.('(max-width: 900px)').matches)
    : false;
  return /Android|iPhone|iPad|iPod|Mobile/iu.test(userAgent) || (touchPoints > 1 && narrowScreen);
}

function isSocketOpen(socket: WebSocket | null) {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

export default function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>(() => {
    try {
      const saved = localStorage.getItem('gemini_oauth_credentials');
      return saved ? sanitizeStoredCredentials(JSON.parse(saved)) : [];
    } catch { return []; }
  });
  const [oauthClientSecret, setOauthClientSecret] = useState(() => {
    try {
      return sessionStorage.getItem(OAUTH_CLIENT_SECRET_SESSION_KEY) || '';
    } catch { return ''; }
  });
  const [oauthStep, setOauthStep] = useState(1);
  const [redirectUrl, setRedirectUrl] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState('');
  const [activeKeyInUse, setActiveKeyInUse] = useState<string>('');

  useEffect(() => {
    localStorage.setItem('gemini_oauth_credentials', JSON.stringify(credentials.map(sanitizeCredential)));
  }, [credentials]);

  useEffect(() => {
    try {
      if (oauthClientSecret.trim()) {
        sessionStorage.setItem(OAUTH_CLIENT_SECRET_SESSION_KEY, oauthClientSecret);
      } else {
        sessionStorage.removeItem(OAUTH_CLIENT_SECRET_SESSION_KEY);
      }
    } catch { /* noop */ }
  }, [oauthClientSecret]);

  const removeCredential = (id: string) => {
    setCredentials(prev => prev.filter(c => c.id !== id));
  };

  const updateCredential = (id: string, updates: Partial<Credential>) => {
    setCredentials(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleLogin = () => {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPES)}&access_type=offline&prompt=consent`;
    window.open(url, '_blank');
    setOauthStep(2);
  };

  const handleExchange = async () => {
    try {
      setOauthLoading(true); setOauthError('');
      const urlObj = new URL(redirectUrl);
      const code = urlObj.searchParams.get('code');
      if (!code) throw new Error('Không tìm thấy mã code trong URL (bạn đã copy đúng trang lỗi ở port 11451 chưa?)');

      const clientSecret = oauthClientSecret.trim();
      if (!clientSecret) throw new Error('Nhap OAuth Client Secret truoc khi hoan tat OAuth.');

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: OAUTH_CLIENT_ID, client_secret: clientSecret, code,
          grant_type: 'authorization_code', redirect_uri: OAUTH_REDIRECT_URI
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error_description || data.error);

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      const userData = await userRes.json();

      const newCred: Credential = {
        id: Math.random().toString(36).substring(7),
        client_id: OAUTH_CLIENT_ID, client_secret: '',
        refresh_token: data.refresh_token, access_token: data.access_token,
        token_expiry: Date.now() + data.expires_in * 1000,
        status: 'Ready', requestsUsed: 0, lastResetTime: Date.now(), email: userData.email
      };

      setCredentials(prev => [...prev, newCred]);
      setOauthStep(1); setRedirectUrl(''); log(`Đã đăng nhập thành công tài khoản: ${newCred.email}`);
    } catch (err: any) { setOauthError(err.message); } finally { setOauthLoading(false); }
  };

  const pollIntervalRef = useRef<number | null>(null);
  const pollingActiveRef = useRef(false);
  const websocketOpenedRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const wakeLockRef = useRef<any>(null);
  const wakeLockWantedRef = useRef(false);
  const cancelledRequestsRef = useRef(new Set<string>());
  const lastHiddenAtRef = useRef<number | null>(null);
  const backgroundNoticeShownRef = useRef(false);

  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [roomCode, setRoomCode] = useState('');
  const [model, setModel] = useState('gemini-flash-latest');
  const [customModel, setCustomModel] = useState('');
  const [status, setStatus] = useState<ConnectorStatus>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [dynamicModels, setDynamicModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [wakeLockSupported] = useState(() => Boolean((navigator as any).wakeLock));
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [activeModel, setActiveModel] = useState('');
  const [activeRequestId, setActiveRequestId] = useState('');
  const [requestCount, setRequestCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [outputChars, setOutputChars] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [transportMode, setTransportMode] = useState<'none' | 'websocket' | 'polling'>('none');
  const [preferPolling, setPreferPolling] = useState(() => isLikelyMobileBrowser());
  const [pageVisibility, setPageVisibility] = useState(() => (
    typeof document === 'undefined' ? 'visible' : document.visibilityState
  ));

  const selectedModel = customModel.trim() || model;
  const connectedSeconds = connectedAt ? Math.floor((clockTick - connectedAt) / 1000) : 0;
  const lastActivitySeconds = lastActivityAt ? Math.floor((clockTick - lastActivityAt) / 1000) : null;

  const modelOptions = useMemo(() => {
    const byId = new Map<string, ModelOption>();
    for (const item of DEFAULT_MODEL_OPTIONS) byId.set(item.id, item);
    for (const item of dynamicModels) byId.set(item.id, item);
    return [...byId.values()];
  }, [dynamicModels]);

  const log = (line: string) => {
    setLogLines((current) => [`${new Date().toLocaleTimeString()} - ${line}`, ...current].slice(0, 50));
  };

  const markActivity = () => {
    setLastActivityAt(Date.now());
  };

  const send = (payload: RelayPayload) => {
    const socket = socketRef.current;
    if (isSocketOpen(socket)) {
      socket.send(JSON.stringify(payload));
      markActivity();
      return true;
    }

    if (pollingActiveRef.current) {
      void sendViaHttp(payload);
      return true;
    }

    return false;
  };

  const sendViaHttp = async (payload: RelayPayload) => {
    if (!pollingActiveRef.current) return false;
    try {
      const response = await fetch(toRelayHttpUrl(relayUrl, roomCode, 'send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      markActivity();
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        log(errorPayload?.error || `Relay HTTP send lỗi HTTP ${response.status}.`);
        return false;
      }
      return true;
    } catch (error: any) {
      setStatus('error');
      log(error?.message || 'Không gửi được dữ liệu qua HTTP polling.');
      return false;
    }
  };

  const stopPolling = () => {
    pollingActiveRef.current = false;
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleRelayPayload = (payload: RelayPayload | null) => {
    if (!payload) return;

    if (payload.type === 'heartbeat') {
      send({ type: 'heartbeat', ts: Date.now() });
      return;
    }

    if (payload.type === 'ready') {
      log('Relay đã sẵn sàng.');
      return;
    }

    if (payload.type === 'cancel') {
      if (payload.requestId) cancelledRequestsRef.current.add(payload.requestId);
      setStatus('connected');
      setActiveRequestId('');
      log(`Đã hủy yêu cầu ${payload.requestId || ''}.`);
      return;
    }

    if (payload.type === 'generate') {
      runGeminiRequest(payload);
    }
  };

  const pollRelay = async () => {
    if (!pollingActiveRef.current) return;
    try {
      const response = await fetch(toRelayHttpUrl(relayUrl, roomCode, 'poll'), {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || `Relay polling lỗi HTTP ${response.status}.`);
      }
      const payload = await response.json();
      markActivity();
      for (const message of payload?.messages || []) {
        handleRelayPayload(message);
      }
    } catch (error: any) {
      if (!pollingActiveRef.current) return;
      setStatus('error');
      log(error?.message || 'Mất kết nối HTTP polling tới relay.');
    }
  };

  const startPolling = (reason = '') => {
    stopHeartbeat();
    stopPolling();
    pollingActiveRef.current = true;

    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // noop
      }
      socketRef.current = null;
    }

    setTransportMode('polling');
    setStatus('connected');
    const now = Date.now();
    setConnectedAt(now);
    setLastActivityAt(now);
    log(reason ? `${reason} Chuyển sang HTTP polling.` : 'Đã kết nối bằng HTTP polling.');
    void pollRelay();
    pollIntervalRef.current = window.setInterval(() => {
      void pollRelay();
    }, POLL_INTERVAL_MS);
    markActivity();
    return true;
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatRef.current = window.setInterval(() => {
      send({ type: 'heartbeat', ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  };

  const releaseWakeLock = async () => {
    try {
      await wakeLockRef.current?.release?.();
    } catch {
      // noop
    }
    wakeLockRef.current = null;
    setWakeLockEnabled(false);
    wakeLockWantedRef.current = false;
  };

  const requestWakeLock = async () => {
    if (!(navigator as any).wakeLock) {
      log('Trình duyệt này không hỗ trợ Wake Lock. Hãy giữ màn hình sáng thủ công nếu dùng điện thoại.');
      return false;
    }

    try {
      const lock = await (navigator as any).wakeLock.request('screen');
      wakeLockRef.current = lock;
      wakeLockWantedRef.current = true;
      setWakeLockEnabled(true);
      lock.addEventListener?.('release', () => {
        wakeLockRef.current = null;
        setWakeLockEnabled(false);
      });
      log('Đã bật giữ màn hình sáng.');
      return true;
    } catch (error: any) {
      log(error?.message || 'Không bật được giữ màn hình sáng.');
      return false;
    }
  };

  const toggleWakeLock = async () => {
    if (wakeLockEnabled) {
      await releaseWakeLock();
      log('Đã tắt giữ màn hình sáng.');
      return;
    }
    await requestWakeLock();
  };

  const getApiKey = () => {
    const env = typeof process !== 'undefined' ? process.env || {} : {};
    return env.GEMINI_API_KEY || env.API_KEY || '';
  };

  const loadModelsFromAIStudio = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      log('Không tìm thấy API key trong môi trường AI Studio. Connector vẫn dùng danh sách mặc định.');
      return;
    }

    setLoadingModels(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || `Không tải được danh sách model: HTTP ${response.status}`);
      }

      const fetched = (payload.models || [])
        .filter((item: any) => {
          const methods = item.supportedGenerationMethods || [];
          return methods.includes('generateContent') || methods.includes('streamGenerateContent');
        })
        .map((item: any) => {
          const id = normalizeModelName(item.name);
          return {
            id,
            label: item.displayName || toDisplayName(id),
            note: 'Tải từ tài khoản AI Studio hiện tại',
          };
        })
        .filter((item: ModelOption) => item.id.startsWith('gemini-'));

      setDynamicModels(fetched);
      log(`Đã tải ${fetched.length} model có thể gọi generateContent.`);
    } catch (error: any) {
      log(error?.message || 'Không tải được danh sách model. Connector vẫn dùng danh sách mặc định.');
    } finally {
      setLoadingModels(false);
    }
  };

  const disconnect = (silent = false) => {
    manualDisconnectRef.current = true;
    stopHeartbeat();
    stopPolling();
    socketRef.current?.close();
    socketRef.current = null;
    websocketOpenedRef.current = false;
    setTransportMode('none');
    setStatus('idle');
    setConnectedAt(null);
    setActiveRequestId('');
    setActiveModel('');
    if (!silent) log('Đã ngắt kết nối.');
  };

  const runGeminiRequest = async (request: RelayPayload) => {
    const requestId = request.requestId || `req-${Date.now()}`;
    const requestModel = request.model || selectedModel;
    cancelledRequestsRef.current.delete(requestId);
    setStatus('running'); setActiveRequestId(requestId); setActiveModel(requestModel);
    setRequestCount((value) => value + 1); setChunkCount(0); setOutputChars(0);
    markActivity(); log(`Nhận yêu cầu ${requestId} với model ${requestModel}.`);

    const envKey = getApiKey();
    const availableCreds = credentials.filter(c => c.status !== 'In Use' && c.status !== 'Invalid Token');

    const keysToTry: ('ENV' | Credential)[] = [];
    if (envKey) keysToTry.push('ENV');
    keysToTry.push(...availableCreds.sort((a, b) => a.requestsUsed - b.requestsUsed));

    if (keysToTry.length === 0) {
      send({ type: 'error', requestId, code: 'NO_ACCOUNT', message: 'Không có tài khoản nào hợp lệ (cần cấu hình OAuth).' });
      setStatus('error'); log('Lỗi: Cần có ít nhất 1 tài khoản đăng nhập!'); return;
    }

    let completed = false;
    let lastError: any = null;

    for (let i = 0; i < keysToTry.length; i++) {
      const item = keysToTry[i];
      if (cancelledRequestsRef.current.has(requestId)) {
        completed = true; break;
      }

      try {
        let fullText = '';
        const { systemInstruction, contents } = splitMessages(request.messages);

        if (item === 'ENV') {
          setActiveKeyInUse('Mặc định');
          log('Đang chạy bằng API Key mặc định của AI Studio...');
          const ai = new GoogleGenAI({ apiKey: envKey });
          const stream = await ai.models.generateContentStream({
            model: requestModel, contents,
            config: { maxOutputTokens: 65000, ...(systemInstruction ? { systemInstruction } : {}) },
          } as any);

          for await (const chunk of stream as any) {
            if (cancelledRequestsRef.current.has(requestId)) break;
            const text = readChunkText(chunk);
            if (!text) continue;
            fullText += text;
            setChunkCount(v => v + 1); setOutputChars(fullText.length);
            send({ type: 'chunk', requestId, text });
          }
        } else {
          let cred = item as Credential;
          setActiveKeyInUse(cred.email || 'OAuth');
          log(`Đang gọi Gemini bằng tài khoản OAuth: ${cred.email}...`);

          if (!cred.access_token || Date.now() >= (cred.token_expiry || 0)) {
            log(`Token tài khoản ${cred.email} hết hạn, đang làm mới...`);
            updateCredential(cred.id, { status: 'Refreshing' });
            const refreshed = await refreshGoogleToken(cred, oauthClientSecret);
            if (!refreshed) {
              updateCredential(cred.id, { status: 'Invalid Token' });
              throw new Error('Failed to refresh token. Nhap lai OAuth Client Secret roi thu lai.');
            }
            updateCredential(cred.id, refreshed);
            cred = { ...cred, ...refreshed } as Credential;
          }

          updateCredential(cred.id, { status: 'In Use' });
          const rawBody = {
            contents,
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
            generationConfig: { maxOutputTokens: 65000 }
          };

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${normalizeModelName(requestModel)}:streamGenerateContent?alt=sse`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cred.access_token}` },
            body: JSON.stringify(rawBody)
          });

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error('Failed to refresh token (401)');
            if (response.status === 429) throw new Error('Quota Exceeded (429)');
            throw new Error(`Lỗi HTTP ${response.status}`);
          }
          if (!response.body) throw new Error('No body returned from API');

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          while (true) {
            if (cancelledRequestsRef.current.has(requestId)) break;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6);
                if (dataStr.trim() === '[DONE]') continue;
                try {
                  const data = JSON.parse(dataStr);
                  const textChunk = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
                  if (textChunk) {
                    fullText += textChunk;
                    setChunkCount(v => v + 1); setOutputChars(fullText.length);
                    send({ type: 'chunk', requestId, text: textChunk });
                  }
                } catch (e) { }
              }
            }
          }

          updateCredential(cred.id, { status: 'Ready', requestsUsed: cred.requestsUsed + 1 });
        }

        if (!cancelledRequestsRef.current.has(requestId)) {
          send({ type: 'done', requestId, text: fullText });
          log(`Hoàn tất yêu cầu ${requestId}.`);
        }
        completed = true; break;

      } catch (error: any) {
        lastError = error;
        const message = String(error?.message || '').toLowerCase();
        const isQuota = message.includes('quota') || message.includes('rate limit') || message.includes('429');
        const is401 = message.includes('401') || message.includes('failed to refresh');

        if (item !== 'ENV') {
          updateCredential((item as Credential).id, { status: isQuota ? 'Limit Exceeded' : (is401 ? 'Invalid Token' : 'Ready') });
        }

        if (isQuota || is401) {
          log(`Tài khoản ${item === 'ENV' ? 'mặc định' : (item as Credential).email} gặp lỗi (${isQuota ? 'Hết lượt 429' : 'Token lỗi 401'}). Chuyển tài khoản tiếp...`);
          await new Promise(r => setTimeout(r, 600));
          continue;
        } else {
          log(`Lỗi API: ${error?.message}. Ngừng thử nghiệm lại.`);
          break;
        }
      }
    }

    setActiveKeyInUse('');
    if (!completed && lastError && !cancelledRequestsRef.current.has(requestId)) {
      send({ type: 'error', requestId, code: 'ERROR', message: lastError?.message || 'Lỗi khi gọi API.' });
      setStatus('error'); log(lastError?.message || 'Lỗi khi gọi Gemini tất cả lượt thử.');
    } else if (completed) {
      setStatus('connected'); setActiveRequestId('');
    }
  };

  const connect = () => {
    if (!relayUrl.trim() || !roomCode.trim()) {
      setStatus('error');
      log('Cần nhập Relay URL và mã phòng trước khi kết nối.');
      return;
    }

    try {
      disconnect(true);
      manualDisconnectRef.current = false;
      websocketOpenedRef.current = false;
      setStatus('connecting');
      setTransportMode('none');
      log('Đang kết nối tới relay...');

      if (preferPolling) {
        startPolling('Chế độ điện thoại đang bật để relay giữ hàng đợi ngắn khi tab nền.');
        return;
      }

      const socket = new WebSocket(toRelayWebSocketUrl(relayUrl, roomCode));
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        websocketOpenedRef.current = true;
        const now = Date.now();
        setStatus('connected');
        setTransportMode('websocket');
        setConnectedAt(now);
        setLastActivityAt(now);
        startHeartbeat();
        log('Đã kết nối relay bằng WebSocket. Hãy quay lại StoryForge để chạy AI.');
      });

      socket.addEventListener('message', (event) => {
        markActivity();
        let payload: RelayPayload | null = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        handleRelayPayload(payload);
      });

      socket.addEventListener('close', (event) => {
        if (manualDisconnectRef.current || pollingActiveRef.current) return;
        stopHeartbeat();
        socketRef.current = null;
        if (!websocketOpenedRef.current) {
          startPolling('WebSocket không mở được trong AI Studio.');
          return;
        }
        const detail = event.code ? ` Mã đóng: ${event.code}${event.reason ? `, lý do: ${event.reason}` : ''}.` : '';
        if (!event.wasClean) {
          startPolling(`Relay WebSocket bị ngắt bất thường.${detail}`);
          return;
        }

        setStatus('idle');
        setTransportMode('none');
        setConnectedAt(null);
        setActiveRequestId('');
        websocketOpenedRef.current = false;
        log(`Relay đã đóng kết nối.${detail}`);
      });

      socket.addEventListener('error', () => {
        if (!websocketOpenedRef.current && !pollingActiveRef.current) {
          startPolling('WebSocket relay bị chặn hoặc không ổn định.');
          return;
        }
        if (!pollingActiveRef.current) {
          startPolling('Lỗi WebSocket relay.');
        }
      });
    } catch (error: any) {
      setStatus('error');
      log(error?.message || 'Kết nối thất bại.');
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    setClockTick(Date.now());
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    manualDisconnectRef.current = true;
    stopHeartbeat();
    stopPolling();
    socketRef.current?.close();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visibility = document.visibilityState;
      setPageVisibility(visibility);

      if (visibility !== 'visible') {
        lastHiddenAtRef.current = Date.now();
        if ((status === 'connected' || status === 'running') && !backgroundNoticeShownRef.current) {
          backgroundNoticeShownRef.current = true;
          log('Tab connector đang ở nền. Wake Lock không giữ được tab nền; trên điện thoại nên dùng chia đôi màn hình hoặc quay lại tab này nếu request không chạy.');
        }
        return;
      }

      const hiddenForMs = lastHiddenAtRef.current ? Date.now() - lastHiddenAtRef.current : 0;
      backgroundNoticeShownRef.current = false;

      if (wakeLockWantedRef.current && !wakeLockRef.current) {
        requestWakeLock();
      }

      if (!manualDisconnectRef.current && relayUrl.trim() && roomCode.trim() && hiddenForMs >= BACKGROUND_RECOVERY_NOTICE_MS) {
        log('Đã quay lại connector, đang kiểm tra lại relay.');
      }

      if (pollingActiveRef.current) {
        void pollRelay();
        return;
      }

      if (isSocketOpen(socketRef.current)) {
        send({ type: 'heartbeat', ts: Date.now() });
        return;
      }

      if (!manualDisconnectRef.current && relayUrl.trim() && roomCode.trim() && (status === 'connected' || status === 'error')) {
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [relayUrl, roomCode, status]);

  useEffect(() => {
    document.title = status === 'running'
      ? 'Đang chạy - StoryForge Connector'
      : `${getStatusText(status)} - StoryForge Connector`;
  }, [status]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      wakeLockRef.current?.release?.();
      socketRef.current?.close();
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-950 sm:p-6">
      <section className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-950 p-6 text-white sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-200">StoryForge AI Studio Relay</p>
              <h1 className="mt-2 text-3xl font-semibold">AI Studio Connector</h1>
              <p className="mt-3 text-base leading-7 text-slate-300">
                Tab này nhận yêu cầu từ StoryForge, gọi Gemini bằng phiên AI Studio của bạn, rồi gửi kết quả trả về StoryForge.
                Trên điện thoại, trình duyệt có thể tạm dừng tab nền; nếu request không chạy, quay lại tab connector để nó thức lại.
              </p>
            </div>

            <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${getStatusClass(status)}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${getStatusDotClass(status)}`} />
              {getStatusText(status)}
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[0.9fr_1.25fr] lg:p-8">
          <aside className="space-y-5">
            <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
              <h2 className="text-lg font-semibold text-blue-950">Hướng dẫn cho người mới</h2>
              <ol className="mt-4 space-y-3">
                {[
                  ['Tạo room trong StoryForge', 'Vào Settings, chọn AI Studio Relay, bấm Tạo room. StoryForge sẽ hiện mã dạng ABC-123.'],
                  ['Dán mã vào connector', 'Quay lại tab này, nhập đúng Relay URL và mã phòng vừa tạo.'],
                  ['Bật chế độ điện thoại', 'Nếu dùng điện thoại, để Chế độ điện thoại bật và bấm giữ màn hình sáng nếu trình duyệt hỗ trợ.'],
                  ['Kết nối và quay lại viết', 'Bấm Kết nối. Nếu mobile tạm dừng tab nền, mở lại connector để nó nhận request đang chờ.'],
                ].map(([title, detail], index) => (
                  <li className="flex gap-3" key={title}>
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <strong className="block text-sm text-blue-950">{title}</strong>
                      <p className="mt-1 text-sm leading-6 text-blue-900">{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-lg font-semibold text-amber-950">Lưu ý quan trọng</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-900">
                <li>Không dán cookie, token Google, hoặc mật khẩu vào StoryForge.</li>
                <li>Connector dùng quota AI Studio/Gemini API của tài khoản Google đang mở tab này.</li>
                <li>Nếu mất kết nối, hãy tạo room mới trong StoryForge rồi kết nối lại.</li>
                <li>Wake Lock chỉ giữ màn hình sáng khi tab đang hiện, không chặn được mobile browser suspend hoặc kill tab nền.</li>
                <li>Chế độ điện thoại dùng HTTP polling để relay giữ request chờ ngắn hạn, nhưng request vẫn chỉ chạy khi trình duyệt cho tab connector thức.</li>
              </ul>
            </section>
          </aside>

          <section className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Thời gian kết nối</div>
                <div className="mt-2 text-xl font-semibold">{connectedAt ? formatDuration(connectedSeconds) : '-'}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Kiểu kết nối</div>
                <div className="mt-2 text-xl font-semibold">
                  {transportMode === 'websocket' ? 'WebSocket' : transportMode === 'polling' ? 'HTTP polling' : '-'}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {pageVisibility === 'visible' ? 'Tab đang hiện' : 'Tab đang ở nền'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Hoạt động gần nhất</div>
                <div className="mt-2 text-xl font-semibold">{lastActivitySeconds === null ? '-' : `${lastActivitySeconds} giây trước`}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Yêu cầu đã nhận</div>
                <div className="mt-2 text-xl font-semibold">{requestCount}</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-5">
              <div className="grid gap-4">
                <label className="block">
                  <span className="text-sm font-semibold">Relay URL</span>
                  <input
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3"
                    placeholder="https://your-relay.workers.dev"
                  />
                  <span className="mt-1 block text-xs text-slate-500">URL này thường đã được StoryForge điền sẵn. Chỉ sửa nếu bạn đổi relay server.</span>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold">Mã phòng</span>
                  <input
                    value={roomCode}
                    onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 font-mono"
                    placeholder="ABC-123"
                  />
                  <span className="mt-1 block text-xs text-slate-500">Lấy mã này từ nút Tạo room trong StoryForge Settings.</span>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold">Model dự phòng trên connector</span>
                  <select
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3"
                  >
                    {modelOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.label} - {item.note}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">StoryForge gửi model trong mỗi request và model đó sẽ được ưu tiên. Mục này chỉ dùng khi request không có model.</span>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold">Model tùy chỉnh</span>
                  <input
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 font-mono"
                    placeholder="Để trống nếu dùng danh sách phía trên"
                  />
                  <span className="mt-1 block text-xs text-slate-500">Dùng khi AI Studio có model mới nhưng danh sách chưa cập nhật.</span>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <input
                    type="checkbox"
                    checked={preferPolling}
                    disabled={status === 'connected' || status === 'running' || status === 'connecting'}
                    onChange={(event) => setPreferPolling(event.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-semibold">Chế độ điện thoại: dùng HTTP polling</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      Nên bật khi dùng điện thoại hoặc tablet. Relay sẽ giữ request chờ vài phút nếu tab connector bị đưa nền; ngắt kết nối rồi kết nối lại để đổi chế độ.
                    </span>
                  </span>
                </label>

                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    onClick={loadModelsFromAIStudio}
                    disabled={loadingModels}
                    className="rounded-lg border border-slate-300 px-4 py-3 font-semibold disabled:opacity-50"
                  >
                    {loadingModels ? 'Đang tải model...' : 'Tải model từ AI Studio'}
                  </button>
                  <button
                    onClick={toggleWakeLock}
                    disabled={!wakeLockSupported}
                    className={`rounded-lg border px-4 py-3 font-semibold disabled:opacity-50 ${wakeLockEnabled ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300'}`}
                  >
                    {wakeLockEnabled ? 'Đang giữ màn hình sáng' : 'Bật giữ màn hình sáng'}
                  </button>
                  <button
                    onClick={connect}
                    disabled={status === 'connected' || status === 'running' || status === 'connecting'}
                    className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Kết nối
                  </button>
                  <button
                    onClick={() => disconnect()}
                    className="rounded-lg border border-slate-300 px-4 py-3 font-semibold"
                  >
                    Ngắt kết nối
                  </button>
                </div>
              </div>
            </div>

            {/* OAuth Manager */}
            <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-purple-800 flex items-center gap-2">
                Quản lý Tài Khoản Google (OAuth)
              </h2>

              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm">
                    <div>
                      <span className="font-semibold text-blue-900">Key môi trường AI Studio</span>
                      <span className="ml-2 text-xs text-blue-700">(Mặc định)</span>
                    </div>
                    <span className={`font-mono text-xs font-bold ${activeKeyInUse === 'Mặc định' ? 'text-purple-700' : 'text-blue-800'}`}>{activeKeyInUse === 'Mặc định' ? 'ĐANG CHẠY' : 'SẴN SÀNG'}</span>
                  </div>

                  {credentials.map((cred) => {
                    const inUse = activeKeyInUse === cred.email;
                    const exhausted = cred.status === 'Limit Exceeded';
                    return (
                      <div key={cred.id} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${inUse ? 'border-purple-400 bg-purple-100 shadow-sm' : exhausted ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                        <div>
                          <span className={`font-semibold ${exhausted ? 'text-amber-800' : 'text-slate-800'}`}>{cred.email || 'Tài khoản ẩn danh'}</span>
                          <span className="ml-2 text-xs text-slate-500">({cred.requestsUsed} reqs) - {cred.status}</span>
                          {inUse && <span className="ml-2 text-xs text-purple-800 font-bold">(Đang chạy lệnh này)</span>}
                        </div>
                        <button onClick={() => removeCredential(cred.id)} className="text-red-500 hover:text-red-700 hover:underline px-2 py-0.5 rounded text-xs font-semibold transition-colors">Xóa</button>
                      </div>
                    )
                  })}
                </div>

                <div className="bg-white p-4 rounded-lg border border-purple-200 shadow-sm space-y-3">
                  <div className="space-y-1">
                    <input
                      type="password"
                      value={oauthClientSecret}
                      onChange={e => setOauthClientSecret(e.target.value)}
                      placeholder="OAuth Client Secret"
                      autoComplete="off"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-purple-500 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500 leading-snug">Secret nay chi giu trong phien tab hien tai va khong duoc luu vao danh sach tai khoan.</p>
                  </div>
                  <h3 className="text-sm font-semibold text-purple-900">Thêm tài khoản Google mới</h3>
                  {oauthStep === 1 && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-600 leading-snug">Nhấn Đăng nhập Google. Khi trang chuyển đến <code>localhost:11451</code> và báo lỗi, hãy sao chép toàn bộ đường link (URL) trang lỗi đó.</p>
                      <button onClick={handleLogin} disabled={!oauthClientSecret.trim()} className="w-full rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 font-semibold text-purple-800 hover:bg-purple-100 transition text-sm disabled:opacity-50">
                        1. Đăng nhập bằng Google
                      </button>
                    </div>
                  )}
                  {oauthStep === 2 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-purple-800">Dán link <code>localhost:11451</code> bạn vừa sao chép vào đây:</p>
                      <input type="text" value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)} placeholder="http://localhost:11451/?code=..." className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-purple-500 focus:outline-none" />
                      {oauthError && <p className="text-xs font-semibold text-red-600">{oauthError}</p>}
                      <div className="flex gap-2">
                        <button onClick={handleExchange} disabled={oauthLoading || !redirectUrl} className="flex-1 rounded-lg bg-purple-600 px-4 py-2.5 font-semibold text-white hover:bg-purple-700 transition text-sm disabled:opacity-50">
                          {oauthLoading ? 'Đang xử lý...' : '2. Hoàn tất việc lấy Tài Khoản'}
                        </button>
                        <button onClick={() => { setOauthStep(1); setRedirectUrl(''); }} className="px-3 py-2 bg-slate-100 font-semibold text-slate-600 rounded-lg text-sm border hover:bg-slate-200">
                          Hủy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-purple-700 opacity-90 leading-relaxed">Hệ thống sẽ thử dùng Key mặc định. Khi quá tải [429 Quota Exceeded], Connector sẽ tự động chuyển sang tài khoản OAuth tiếp theo hoàn toàn trong suốt với StoryForge.</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Model đang chạy</div>
                <div className="mt-2 break-all text-sm font-semibold">{activeModel || selectedModel}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Request hiện tại</div>
                <div className="mt-2 break-all text-sm font-semibold">{activeRequestId || '-'}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Stream</div>
                <div className="mt-2 text-sm font-semibold">{chunkCount} chunks / {outputChars} ký tự</div>
              </div>
            </div>

            <section className="rounded-xl border border-slate-200 p-5">
              <h2 className="mb-3 text-lg font-semibold">Nhật ký</h2>
              <pre className="min-h-52 rounded-lg bg-slate-950 p-4 text-sm text-slate-50 whitespace-pre-wrap">
                {logLines.join('\n') || 'Chưa có sự kiện.'}
              </pre>
            </section>
          </section>
        </div>
      </section>
    </main>
  );
}
