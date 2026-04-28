import React, { useState } from 'react';
import { Shield, Key, AlertCircle, CheckCircle2, Loader2, Plus, Server, RefreshCw, Power } from 'lucide-react';

const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET_SESSION_KEY = 'gcp-api-fixer-oauth-client-secret';
const OAUTH_REDIRECT_URI = "http://localhost:11451";
const OAUTH_SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email";
const OAUTH_STEP_SESSION_KEY = 'gcp-api-fixer-oauth-step';
const OAUTH_REDIRECT_SESSION_KEY = 'gcp-api-fixer-redirect-url';
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const CODE_ASSIST_BASE_URL = 'https://cloudcode-pa.googleapis.com/v1internal';

const SERVICES_TO_ENABLE = [
  {
    id: 'cloudaicompanion.googleapis.com',
    label: 'Gemini for Google Cloud API',
    required: true,
  },
  {
    id: 'generativelanguage.googleapis.com',
    label: 'Gemini API công khai',
    required: false,
  },
  {
    id: 'geminicloudassist.googleapis.com',
    label: 'Gemini Cloud Assist API',
    required: false,
  },
];

const IAM_ROLES_TO_GRANT = [
  {
    id: 'roles/cloudaicompanion.user',
    label: 'Gemini for Google Cloud User',
  },
  {
    id: 'roles/serviceusage.serviceUsageConsumer',
    label: 'Service Usage Consumer',
  },
  {
    id: 'roles/cloudaicompanion.codeToolsUser',
    label: 'Gemini Code Assist Tools User',
  },
];

interface GoogleProject {
  projectId: string;
  name: string;
  lifecycleState: string;
}

interface IamPolicyBinding {
  role: string;
  members?: string[];
  condition?: unknown;
}

interface IamPolicy {
  version?: number;
  etag?: string;
  bindings?: IamPolicyBinding[];
}

interface CodeAssistTier {
  id?: string;
  name?: string;
  tierName?: string;
  isDefault?: boolean;
  reasonCode?: string;
  reasonMessage?: string;
  validationUrl?: string;
  validationUrlLinkText?: string;
  hasOnboardedPreviously?: boolean;
}

export const isDoneOperationName = (name?: string) => {
  const operationId = String(name || '').split('/').pop();
  return operationId === 'DONE_OPERATION';
};

export const shouldPollOperation = (operation: any) => {
  return Boolean(operation?.name && !operation?.done && !isDoneOperationName(operation.name));
};

export const selectDefaultCodeAssistTier = (tiers: CodeAssistTier[] = []) => {
  return tiers.find(tier => tier.isDefault) || tiers[0] || null;
};

export const isCloudCodePrivateApiDisabledError = (message: string) => {
  return /cloudcode-pa\.googleapis\.com/i.test(message)
    && /has not been used|is disabled|Enable it by visiting|SERVICE_DISABLED/i.test(message);
};

export const isToSViolationError = (message: string) => {
  return /violation of Terms of Service|disabled.*Terms of Service|Terms of Service.*disabled/i.test(message);
};

// Gemini CLI sends the selected project in the request body. Adding
// X-Goog-User-Project here forces Service Usage checks on cloudcode-pa,
// which normal projects cannot enable because it is an internal IDE API.
export const buildCodeAssistHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

export const pickSelectedProjectId = (
  projects: GoogleProject[] = [],
  preferredProjectId = '',
  currentProjectId = '',
) => {
  const activeIds = new Set(projects.map(project => project.projectId));
  if (preferredProjectId && activeIds.has(preferredProjectId)) return preferredProjectId;
  if (currentProjectId && activeIds.has(currentProjectId)) return currentProjectId;
  return projects[0]?.projectId || '';
};

const readSessionValue = (key: string) => {
  try {
    return window.sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeSessionValue = (key: string, value: string) => {
  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // AI Studio preview can temporarily block storage during hot reload.
  }
};

export default function App1() {
  const [credential, setCredential] = useState<{access_token: string, email: string} | null>(null);
  const [authStep, setAuthStepState] = useState(() => readSessionValue(OAUTH_STEP_SESSION_KEY) === '2' ? 2 : 1);
  const [redirectUrl, setRedirectUrlState] = useState(() => readSessionValue(OAUTH_REDIRECT_SESSION_KEY));
  const [oauthClientSecret, setOAuthClientSecretState] = useState(() => readSessionValue(OAUTH_CLIENT_SECRET_SESSION_KEY));

  const [loading, setLoading] = useState('');
  const [logs, setLogs] = useState<{msg: string, time: Date, isError: boolean}[]>([]);
  const [projects, setProjects] = useState<GoogleProject[]>([]);
  const [selectedProject, setSelectedProject] = useState('');

  const setAuthStep = (step: number) => {
    setAuthStepState(step);
    writeSessionValue(OAUTH_STEP_SESSION_KEY, step === 2 ? '2' : '');
  };

  const setRedirectUrl = (value: string) => {
    setRedirectUrlState(value);
    writeSessionValue(OAUTH_REDIRECT_SESSION_KEY, value);
  };

  const setOAuthClientSecret = (value: string) => {
    setOAuthClientSecretState(value);
    writeSessionValue(OAUTH_CLIENT_SECRET_SESSION_KEY, value.trim());
  };

  const log = (msg: string, isError = false) => {
    setLogs(prev => [...prev, { msg, time: new Date(), isError }]);
    console.log(`[App1] ${msg}`);
  };

  const readApiPayload = async (res: Response): Promise<any> => {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };

  const getApiErrorMessage = (data: any, fallback: string) => {
    return data?.error?.message || data?.error_description || data?.error || data?.raw || fallback;
  };

  const isBrowserNetworkBlock = (error: any) => {
    const message = String(error?.message || error || '');
    return error instanceof TypeError || /Failed to fetch|Load failed|NetworkError/i.test(message);
  };

  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Request quá ${Math.round(timeoutMs / 1000)} giây không phản hồi. Hãy bấm lại hoặc F5 nếu AI Studio vừa hot reload.`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleLogin = () => {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPES)}&access_type=offline&prompt=consent`;
    setAuthStep(2);
    const popup = window.open(url, '_blank');
    if (!popup) {
      log('Trình duyệt chặn popup đăng nhập. Hãy cho phép popup hoặc bấm Đăng Nhập Google lại.', true);
    }
    try {
      if (popup) popup.opener = null;
    } catch {
      // noop
    }
    popup?.focus?.();
  };

  const handleExchange = async () => {
    try {
      setLoading('Đang lấy Token...');
      const clientSecret = oauthClientSecret.trim();
      if (!clientSecret) throw new Error('Chua nhap OAuth Client Secret.');

      const urlObj = new URL(redirectUrl);
      const code = urlObj.searchParams.get('code');
      if (!code) throw new Error('Không tìm thấy mã code trong URL!');

      const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: OAUTH_CLIENT_ID, client_secret: clientSecret, code,
          grant_type: 'authorization_code', redirect_uri: OAUTH_REDIRECT_URI
        })
      });
      const data = await readApiPayload(res);
      if (!res.ok || data.error) throw new Error(getApiErrorMessage(data, 'Không đổi được OAuth code lấy access token.'));

      const userRes = await fetchWithTimeout('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      const userData = await readApiPayload(userRes);
      if (!userRes.ok || !userData.email) {
        throw new Error(getApiErrorMessage(userData, 'Không đọc được email từ token OAuth.'));
      }

      setCredential({ access_token: data.access_token, email: userData.email });
      setAuthStep(3);
      setRedirectUrl('');
      log(`Đã kết nối thành công tài khoản: ${userData.email}`);
      await fetchProjects(data.access_token);

    } catch (e: any) {
      log(`Lỗi đăng nhập: ${e.message}`, true);
    } finally {
      setLoading('');
    }
  };

  const fetchProjects = async (token: string, preferredProjectId = '') => {
    try {
      setLoading('Đang quét danh sách Project...');
      log('Bắt đầu quy trình quét danh sách Google Cloud Project ẩn...');
      const res = await fetchWithTimeout('https://cloudresourcemanager.googleapis.com/v1/projects', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await readApiPayload(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Lỗi quét dự án'));

      const activeProjects = (data.projects || []).filter((p: any) => p.lifecycleState === 'ACTIVE');
      setProjects(activeProjects);

      if (activeProjects.length > 0) {
        const nextProjectId = pickSelectedProjectId(activeProjects, preferredProjectId, selectedProject);
        setSelectedProject(nextProjectId);
        log(`Tìm thấy ${activeProjects.length} dự án. Đang chọn project [${nextProjectId}] cho Code Assist.`);
        return activeProjects;
      } else {
        log('Không tìm thấy dự án nào. Vui lòng tạo dự án mới.', true);
        return [];
      }
    } catch (e: any) {
      log(`Lỗi quét Project: ${e.message}. Có thể tài khoản này vừa bị Google cảnh báo.`, true);
      return [];
    } finally {
      setLoading('');
    }
  };

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  const pollOperation = async (endpoint: string, token: string, maxRetries = 45) => {
    for (let i = 0; i < maxRetries; i++) {
      await delay(2000);
      const res = await fetchWithTimeout(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      const data = await readApiPayload(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Không đọc được trạng thái operation.'));
      if (data.done) {
        if (data.error) throw new Error(data.error.message || 'Operation failed');
        return data;
      }
      log(`...Đang chờ Google xử lý (${i + 1}/${maxRetries})...`);
    }
    throw new Error('Hết thời gian chờ Google phản hồi.');
  };

  const getServiceState = async (projectId: string, serviceId: string, token: string) => {
    const res = await fetchWithTimeout(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${serviceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await readApiPayload(res);
    if (!res.ok) {
      throw new Error(getApiErrorMessage(data, `Không đọc được trạng thái ${serviceId}`));
    }
    return data?.state || '';
  };

  const waitForServiceEnabled = async (projectId: string, serviceId: string, token: string, maxRetries = 18) => {
    for (let i = 0; i < maxRetries; i++) {
      const state = await getServiceState(projectId, serviceId, token);
      if (state === 'ENABLED') {
        log(`${serviceId} đã ở trạng thái ENABLED.`);
        return;
      }

      log(`...Đang chờ ${serviceId} chuyển sang ENABLED (${i + 1}/${maxRetries}), hiện tại: ${state || 'UNKNOWN'}...`);
      await delay(5000);
    }

    throw new Error(`${serviceId} chưa chuyển sang ENABLED sau khi chờ propagate.`);
  };

  const enableService = async (projectId: string, serviceId: string, token: string) => {
    try {
      const state = await getServiceState(projectId, serviceId, token);
      if (state === 'ENABLED') {
        log(`${serviceId} đã được bật sẵn.`);
        return;
      }
      log(`${serviceId} hiện ở trạng thái ${state || 'UNKNOWN'}, bắt đầu bật...`);
    } catch (error: any) {
      log(`Không kiểm tra trước được trạng thái ${serviceId}: ${error.message}. Vẫn thử bật API...`, true);
    }

    const res = await fetchWithTimeout(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${serviceId}:enable`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await readApiPayload(res);

    if (!res.ok) {
      throw new Error(getApiErrorMessage(data, `Không thể bật ${serviceId}`));
    }

    if (data.done) {
      if (data.error) throw new Error(data.error.message || `Không thể bật ${serviceId}`);
      await waitForServiceEnabled(projectId, serviceId, token);
      return;
    }

    if (isDoneOperationName(data.name)) {
      log(`Google trả về ${data.name}; coi như ${serviceId} đã xử lý xong.`);
      await waitForServiceEnabled(projectId, serviceId, token);
      return;
    }

    if (shouldPollOperation(data)) {
      await pollOperation(`https://serviceusage.googleapis.com/v1/${data.name}`, token);
    }

    await waitForServiceEnabled(projectId, serviceId, token);
  };

  const getCodeAssistMetadata = (projectId: string) => ({
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
    duetProject: projectId,
  });

  const callCodeAssist = async (
    method: string,
    token: string,
    projectId: string,
    body?: Record<string, any>,
    httpMethod: 'GET' | 'POST' = 'POST',
  ) => {
    const res = await fetchWithTimeout(`${CODE_ASSIST_BASE_URL}:${method}`, {
      method: httpMethod,
      headers: buildCodeAssistHeaders(token),
      body: httpMethod === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    const data = await readApiPayload(res);
    if (!res.ok) {
      throw new Error(getApiErrorMessage(data, `${method} trả về HTTP ${res.status}`));
    }
    return data;
  };

  const callCodeAssistWithDiagnostics = async (
    method: string,
    token: string,
    projectId: string,
    body?: Record<string, any>,
    httpMethod: 'GET' | 'POST' = 'POST',
  ) => {
    try {
      return await callCodeAssist(method, token, projectId, body, httpMethod);
    } catch (error: any) {
      const message = String(error?.message || '');
      if (!isCloudCodePrivateApiDisabledError(message)) {
        throw error;
      }

      throw new Error(
        `Cloud Code Private API bị Google backend từ chối cho project [${projectId}]. `
        + 'API này là internal IDE API, không thể tự bật bằng Service Usage từ app web. '
        + `Chi tiết gốc: ${message}`,
      );
    }
  };

  const pollCodeAssistOperation = async (operationName: string, token: string, projectId: string, maxRetries = 24) => {
    if (isDoneOperationName(operationName)) return {};

    for (let i = 0; i < maxRetries; i++) {
      await delay(5000);
      const res = await fetchWithTimeout(`${CODE_ASSIST_BASE_URL}/${operationName}`, {
        headers: buildCodeAssistHeaders(token),
      });
      const data = await readApiPayload(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, 'Không đọc được Code Assist operation.'));
      }
      if (data.done) {
        if (data.error) throw new Error(data.error.message || 'Code Assist operation failed');
        return data;
      }
      log(`...Đang chờ Code Assist onboarding (${i + 1}/${maxRetries})...`);
    }

    throw new Error('Hết thời gian chờ Code Assist onboarding.');
  };

  const logCodeAssistTier = (prefix: string, tier?: CodeAssistTier | null) => {
    if (!tier) return;
    log(`${prefix}: ${tier.name || tier.id || 'không rõ'}${tier.hasOnboardedPreviously === false ? ' (chưa onboard trước đó)' : ''}.`);
  };

  const throwIneligibleCodeAssist = (ineligibleTiers: CodeAssistTier[]) => {
    const details = ineligibleTiers
      .map(tier => `${tier.tierName || tier.name || tier.id || 'tier'}: ${tier.reasonCode || 'UNKNOWN'} - ${tier.reasonMessage || 'Không có thông tin chi tiết'}`)
      .join(' | ');
    throw new Error(`Cloud Code API từ chối tài khoản này. ${details || 'Không có tier hợp lệ.'}`);
  };

  const ensureCodeAssistBackend = async (projectId: string, token: string) => {
    log('Đang kiểm tra Cloud Code Private API giống Gemini CLI (loadCodeAssist)...');

    try {
      const currentSetting = await callCodeAssistWithDiagnostics('getCodeAssistGlobalUserSetting', token, projectId, undefined, 'GET');
      if (currentSetting?.cloudaicompanionProject && currentSetting.cloudaicompanionProject !== projectId) {
        log(`Code Assist đang nhớ project cũ [${currentSetting.cloudaicompanionProject}], chuyển sang [${projectId}]...`);
      }
      if (currentSetting?.cloudaicompanionProject !== projectId) {
        await callCodeAssistWithDiagnostics('setCodeAssistGlobalUserSetting', token, projectId, {
          cloudaicompanionProject: projectId,
        });
        log('Đã ghi project mặc định cho Code Assist global setting.');
      }
    } catch (error: any) {
      if (isBrowserNetworkBlock(error)) {
        log('AI Studio/browser chặn kiểm tra global setting của cloudcode-pa. Bỏ qua bước này và tiếp tục cấu hình phần public API/IAM.', true);
        return;
      }
      const settingErrMsg = String(error?.message || '');
      if (isToSViolationError(settingErrMsg)) {
        throw new Error(
          `⛔ Account bị Google KHÓA vì vi phạm Terms of Service. `
          + `Cloud Code / Gemini Code Assist đã bị disable ở cấp ACCOUNT, không phải cấp project. `
          + `Tạo project mới, bật API, cấp IAM đều KHÔNG mở lại được. `
          + `Giải pháp: (1) Gửi appeal tới gemini-code-assist-user-feedback@google.com, `
          + `(2) Dùng account Google khác chưa bị flag, `
          + `(3) Dùng AI Studio API Key (GEMINI_API_KEY) thay vì OAuth nếu proxy hỗ trợ. `
          + `Gốc: ${settingErrMsg}`
        );
      }
      log(`Không đọc/ghi được Code Assist global setting: ${settingErrMsg}`, true);
    }

    const loadPayload = {
      cloudaicompanionProject: projectId,
      metadata: getCodeAssistMetadata(projectId),
      mode: 'FULL_ELIGIBILITY_CHECK',
    };

    const loadRes = await callCodeAssistWithDiagnostics('loadCodeAssist', token, projectId, loadPayload);
    logCodeAssistTier('Cloud Code API nhận diện tier hiện tại', loadRes.currentTier || loadRes.paidTier);

    if (loadRes.ineligibleTiers?.length > 0 && !loadRes.currentTier) {
      for (const tier of loadRes.ineligibleTiers) {
        log(`Không đủ điều kiện ${tier.tierName || tier.name || tier.id || 'tier'}: ${tier.reasonCode || 'UNKNOWN'} - ${tier.reasonMessage || 'Không có message'}`, true);
        if (tier.validationUrl) {
          log(`Google yêu cầu xác minh: ${tier.validationUrl}`, true);
        }
      }
      throwIneligibleCodeAssist(loadRes.ineligibleTiers);
    }

    if (loadRes.currentTier) {
      const activeProject = loadRes.cloudaicompanionProject || projectId;
      log(`Cloud Code API đã mở cho account này. Project server trả về: [${activeProject}].`);
      return;
    }

    const tier = selectDefaultCodeAssistTier(loadRes.allowedTiers || []);
    if (!tier) {
      throw new Error('Cloud Code API không trả currentTier hoặc allowedTiers. Account có thể đang bị risk-control hoặc backend chưa cấp entitlement.');
    }

    logCodeAssistTier('Cloud Code API cho phép onboard tier', tier);
    const onboardPayload = {
      tierId: tier.id,
      cloudaicompanionProject: tier.id === 'free-tier' ? undefined : projectId,
      metadata: tier.id === 'free-tier'
        ? {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          }
        : getCodeAssistMetadata(projectId),
    };

    const onboardRes = await callCodeAssistWithDiagnostics('onboardUser', token, projectId, onboardPayload);
    const finalOnboardRes = shouldPollOperation(onboardRes)
      ? await pollCodeAssistOperation(onboardRes.name, token, projectId)
      : onboardRes;
    const onboardedProject = finalOnboardRes?.response?.cloudaicompanionProject?.id || projectId;
    log(`Đã onboard Code Assist. Project dùng bởi server: [${onboardedProject}].`);

    const verifyRes = await callCodeAssistWithDiagnostics('loadCodeAssist', token, projectId, loadPayload);
    if (!verifyRes.currentTier && verifyRes.ineligibleTiers?.length > 0) {
      throwIneligibleCodeAssist(verifyRes.ineligibleTiers);
    }
    logCodeAssistTier('Xác minh sau onboarding', verifyRes.currentTier || verifyRes.paidTier);
  };

  const getProjectIamPolicy = async (projectId: string, token: string): Promise<IamPolicy> => {
    const res = await fetchWithTimeout(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: {
          requestedPolicyVersion: 3,
        },
      }),
    });
    const data = await readApiPayload(res);
    if (!res.ok) {
      throw new Error(getApiErrorMessage(data, 'Không đọc được IAM policy của project.'));
    }
    return data as IamPolicy;
  };

  const setProjectIamPolicy = async (projectId: string, policy: IamPolicy, token: string) => {
    const res = await fetchWithTimeout(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:setIamPolicy`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy }),
    });
    const data = await readApiPayload(res);
    if (!res.ok) {
      throw new Error(getApiErrorMessage(data, 'Không ghi được IAM policy của project.'));
    }
    return data as IamPolicy;
  };

  const ensureIamRoles = async (projectId: string, email: string, token: string) => {
    const member = `user:${email}`;
    log(`Đang kiểm tra IAM roles cho ${member}...`);

    const policy = await getProjectIamPolicy(projectId, token);
    const bindings = [...(policy.bindings || [])];
    const added: string[] = [];
    const alreadyPresent: string[] = [];

    for (const role of IAM_ROLES_TO_GRANT) {
      const existingBinding = bindings.find(binding => binding.role === role.id && !binding.condition);
      const existingMembers = existingBinding?.members || [];

      if (existingMembers.includes(member)) {
        alreadyPresent.push(role.label);
        continue;
      }

      if (existingBinding) {
        existingBinding.members = [...existingMembers, member].sort();
      } else {
        bindings.push({ role: role.id, members: [member] });
      }
      added.push(role.label);
    }

    if (added.length === 0) {
      log(`IAM đã đủ quyền: ${alreadyPresent.join(', ')}.`);
      return;
    }

    const hasConditions = bindings.some(binding => Boolean(binding.condition));
    const nextPolicy: IamPolicy = {
      ...policy,
      bindings,
      version: hasConditions ? 3 : (policy.version || 1),
    };

    await setProjectIamPolicy(projectId, nextPolicy, token);
    log(`Đã cấp IAM roles: ${added.join(', ')}.`);
    if (alreadyPresent.length > 0) {
      log(`Các role đã có sẵn: ${alreadyPresent.join(', ')}.`);
    }
  };

  const handleCreateProject = async () => {
    if (!credential) return;
    try {
      const newProjectId = `sf-proxy-${Math.random().toString(36).substring(2, 8)}-${Date.now().toString().slice(-4)}`;
      setLoading('Đang tạo Project mới...');
      log(`Tiến hành ra lệnh cho Google tạo dự án mới: [${newProjectId}]...`);

      const res = await fetchWithTimeout('https://cloudresourcemanager.googleapis.com/v1/projects', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${credential.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: newProjectId, name: 'Gemini Auto Proxy' })
      });
      const data = await readApiPayload(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, 'Không thể tạo project'));

      log('Đã gửi lệnh tạo. Đang chờ máy chủ Google cấp phát tài nguyên...');
      await pollOperation(`https://cloudresourcemanager.googleapis.com/v1/${data.name}`, credential.access_token);

      log(`Tuyệt vời! Đã tạo thành công dự án [${newProjectId}].`);
      const refreshedProjects = await fetchProjects(credential.access_token, newProjectId);
      if (!refreshedProjects.some(project => project.projectId === newProjectId)) {
        log(`Project [${newProjectId}] chưa xuất hiện trong danh sách, chờ Google đồng bộ rồi quét lại...`);
        await delay(5000);
        await fetchProjects(credential.access_token, newProjectId);
      }

    } catch (e: any) {
      log(`Tạo project thất bại: ${e.message}`, true);
    } finally {
      setLoading('');
    }
  };

  const handleFixApis = async () => {
    if (!credential || !selectedProject) return;
    try {
      setLoading('Đang kiểm tra tài khoản...');

      // ── PRE-CHECK: Phát hiện account bị ban TRƯỚC KHI tạo project / bật API / cấp IAM ──
      log('Kiểm tra sơ bộ: account có bị Google Cloud Code ban không...');
      try {
        await callCodeAssist('getCodeAssistGlobalUserSetting', credential.access_token, selectedProject, undefined, 'GET');
        log('Pre-check OK: Cloud Code backend chấp nhận account này.');
      } catch (preErr: any) {
        const preMsg = String(preErr?.message || '');
        if (isBrowserNetworkBlock(preErr)) {
          log('Browser chặn kiểm tra cloudcode-pa (bình thường trên AI Studio). Bỏ qua pre-check, tiếp tục.', true);
        } else if (isToSViolationError(preMsg)) {
          log(`⛔ ACCOUNT BỊ CHẶN: ${preMsg}`, true);
          log('Cloud Code / Gemini Code Assist đã bị disable ở cấp ACCOUNT do Google Trust & Safety.', true);
          log('Việc tạo project, bật API, cấp IAM đều KHÔNG thể mở lại được.', true);
          log('Giải pháp:', true);
          log('  (1) Gửi appeal tới gemini-code-assist-user-feedback@google.com', true);
          log('  (2) Dùng account Google khác chưa bị flag', true);
          log('  (3) Dùng AI Studio API Key (GEMINI_API_KEY) thay OAuth nếu proxy hỗ trợ', true);
          log('Dừng cấu hình. Các bước enable API / IAM sẽ vô ích cho account đã bị ban.', true);
          return;
        } else {
          log(`Pre-check Cloud Code: ${preMsg}. Có thể do chưa cấu hình — tiếp tục thử bật API...`);
        }
      }

      setLoading('Đang cấu hình Code Assist...');
      log(`Bắt đầu cấu hình project [${selectedProject}] cho Gemini Code Assist / Antigravity...`);
      log('Chỉ bật các API public bằng Service Usage. cloudcode-pa.googleapis.com là internal IDE API nên chỉ kiểm tra backend, không ép enable.');

      const enabled: string[] = [];
      const skipped: string[] = [];

      for (const service of SERVICES_TO_ENABLE) {
        try {
          log(`Đang bật ${service.label} (${service.id})...`);
          await enableService(selectedProject, service.id, credential.access_token);
          enabled.push(service.label);
          log(`Đã bật ${service.label}.`);
        } catch (error: any) {
          const message = error?.message || `Không thể bật ${service.label}.`;
          if (!service.required) {
            skipped.push(`${service.label}: ${message}`);
            log(`Bỏ qua ${service.label}: ${message}`, true);
            continue;
          }
          throw new Error(`${service.label}: ${message}`);
        }
      }

      await ensureIamRoles(selectedProject, credential.email, credential.access_token);
      await ensureCodeAssistBackend(selectedProject, credential.access_token);

      log(`Hoàn tất. Đã cấu hình API: ${enabled.join(', ')}.`, false);
      if (skipped.length > 0) {
        log(`Một số API phụ không bật được nhưng không chặn Code Assist core: ${skipped.join(' | ')}`, true);
      }
      log('Bước tiếp theo: quay lại web proxy, lấy callback/credential mới. Không dùng lại credential cũ đã báo 403.');
      alert('Đã bật API public, cấp IAM roles và kiểm tra Cloud Code backend. Hãy quay lại proxy lấy credential mới. Nếu vẫn 403, nhiều khả năng account chưa có quyền/licence Gemini Code Assist hoặc bị risk-control.');

    } catch (e: any) {
      const errMsg = String(e?.message || '');
      if (isToSViolationError(errMsg)) {
        log(`⛔ ACCOUNT BỊ GOOGLE KHÓA CODE ASSIST: ${errMsg}`, true);
        log('Đây là khóa ở cấp account do Google Trust & Safety. Không project/API/IAM nào mở lại được.', true);
        log('Giải pháp: (1) Appeal tới gemini-code-assist-user-feedback@google.com, (2) Dùng account khác, (3) Dùng AI Studio API Key.', true);
      } else {
        log(`Quá trình cấu hình thất bại: ${errMsg}`, true);
        if (/permission denied|forbidden|403/i.test(errMsg)) {
          log('Lỗi quyền truy cập. Hãy dùng project bạn sở hữu hoặc cấp Owner / Service Usage Admin / IAM Admin rồi chạy lại.', true);
        } else if (/Cloud Code Private API/i.test(errMsg)) {
          log('cloudcode-pa.googleapis.com là internal API. Account cần có entitlement Gemini Code Assist hợp lệ từ Google.', true);
        } else {
          log('Nếu lỗi là permission denied, hãy dùng project bạn sở hữu hoặc cấp Owner/Service Usage Admin/IAM Admin cho tài khoản này rồi chạy lại.', true);
        }
      }
    } finally {
      setLoading('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 p-8 font-sans flex justify-center">
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Bảng điều khiển Trái */}
        <div className="space-y-6">
          <header className="mb-6">
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500 flex items-center gap-3">
              <Shield className="w-8 h-8 text-emerald-400" />
              GCP API Fixer
            </h1>
            <p className="text-slate-400 mt-2 text-sm leading-relaxed">
              Công cụ thử nghiệm giúp cấu hình project cho Gemini Code Assist/Gemini CLI: bật API cần thiết, cấp IAM roles cho email OAuth và kiểm tra Cloud Code Private API <code>cloudcode-pa.googleapis.com</code>.
            </p>
          </header>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            {!credential ? (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-white mb-2">Bước 1: Nạp Tài Khoản Google</h2>
                <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <label className="block text-sm font-semibold text-amber-100" htmlFor="oauth-client-secret">
                    OAuth Client Secret
                  </label>
                  <input
                    id="oauth-client-secret"
                    type="password"
                    value={oauthClientSecret}
                    onChange={e => setOAuthClientSecret(e.target.value)}
                    placeholder="Nhap OAuth Client Secret luc chay, khong commit vao source"
                    autoComplete="off"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-400 transition"
                  />
                  <p className="text-xs leading-relaxed text-amber-100/80">
                    Secret chi luu tam trong sessionStorage cua tab nay de doi OAuth code lay token.
                  </p>
                </div>

                {authStep === 1 && (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-400">Mở cổng đăng nhập của Google và lấy mã. Trang hiển thị lỗi localhost là BÌNH THƯỜNG.</p>
                    <button onClick={handleLogin} disabled={!!loading} className="w-full flex justify-center items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-medium py-3 rounded-lg border border-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                      <Key className="w-5 h-5 text-emerald-400" /> Đăng Nhập Google
                    </button>
                  </div>
                )}

                {authStep === 2 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-emerald-400">Bước tiếp theo: Dán URL <code>localhost:11451</code> có chứa code vào đây:</p>
                    <input
                      type="text" value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)}
                      placeholder="http://localhost:11451/?code=..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                    />
                    <div className="flex gap-2">
                       <button onClick={handleExchange} disabled={!!loading || !redirectUrl || !oauthClientSecret.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2">
                         {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Trao Đổi Thông Tin Kêt Nối'}
                       </button>
                       <button onClick={() => { setAuthStep(1); setRedirectUrl(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-3 rounded-lg transition">Huỷ</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
                  <div>
                    <h3 className="text-emerald-400 text-sm font-bold">Đã Kết Nối (Access Token)</h3>
                    <p className="text-white font-medium mt-1">{credential.email}</p>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-white">Bước 2: Quản Lý Dự Án (Project)</h2>
                    <button onClick={() => fetchProjects(credential.access_token)} disabled={!!loading} className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-sm font-medium">
                      <RefreshCw className="w-4 h-4" /> Làm mới
                    </button>
                  </div>

                  {projects.length === 0 ? (
                    <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700 text-center">
                      <p className="text-sm text-slate-400 mb-4">Không tìm thấy dự án nào trong tài khoản này. Cần tạo một project để cấu hình Code Assist.</p>
                      <button onClick={handleCreateProject} disabled={!!loading} className="mx-auto flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white py-2 px-4 rounded-lg text-sm font-bold transition disabled:opacity-50">
                        <Plus className="w-4 h-4" /> Tạo Dự Án Mới
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-400">Chọn project mà proxy/CLI sẽ dùng. Nếu chưa chắc, hãy tạo một project mới rồi dùng đúng Project ID đó khi lấy credential.</p>
                      <select
                        value={selectedProject}
                        onChange={(e) => setSelectedProject(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500"
                      >
                        {projects.map(p => (
                          <option key={p.projectId} value={p.projectId}>{p.name} ({p.projectId})</option>
                        ))}
                      </select>

                      <button onClick={handleCreateProject} disabled={!!loading} className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 py-2.5 rounded-lg text-sm font-semibold transition border border-slate-700 disabled:opacity-50">
                        <Plus className="w-4 h-4" /> Tạo thêm dự án cách ly an toàn
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <h2 className="text-lg font-bold text-white mb-2">Bước 3: Cấu hình Code Assist</h2>
                  <div className="mb-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <p>Thao tác này bật Gemini for Google Cloud API và cấp IAM roles cần thiết. Cloud Code Private API là API nội bộ nên app chỉ kiểm tra backend, không thể ép bật bằng Service Usage. Sau khi chạy xong, phải lấy callback/credential mới trên proxy.</p>
                  </div>
                  <button
                    onClick={handleFixApis}
                    disabled={!!loading || !selectedProject}
                    className="w-full flex items-center justify-center relative gap-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-extrabold py-4 rounded-xl shadow-lg transition transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed"
                  >
                    <Power className="w-6 h-6" /> CẤU HÌNH PROJECT CHO CODE ASSIST
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Console / Log panel */}
        <div className="flex flex-col h-full bg-black/80 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
          <div className="bg-slate-900 border-b border-slate-800 p-3 flex items-center gap-2">
            <Server className="w-4 h-4 text-cyan-500" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Tiến Trình Chạy Lệnh Kép</span>
            {loading && <Loader2 className="w-4 h-4 text-emerald-400 animate-spin ml-auto" />}
          </div>

          <div className="flex-1 p-5 overflow-y-auto space-y-3 font-mono text-sm">
            {logs.length === 0 && (
              <div className="text-slate-600 text-center mt-10">... Đợi lệnh vận hành ...</div>
            )}
            {logs.map((L, i) => (
              <div key={i} className={`flex items-start gap-3 break-words ${L.isError ? 'text-red-400' : 'text-emerald-400'}`}>
                <span className="text-slate-600 shrink-0 select-none">[{L.time.toLocaleTimeString()}]</span>
                <span className={L.isError ? 'font-bold' : ''}>
                  {L.msg}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
