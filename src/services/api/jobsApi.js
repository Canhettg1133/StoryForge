import { toVietnameseErrorMessage } from '../../utils/errorMessages';

function isLocalHost() {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

const JOB_API_BASE_URL = (
  import.meta.env.VITE_JOB_SERVER_URL || (isLocalHost() ? 'http://localhost:3847' : '')
).trim();

function requireJobApiBaseUrl() {
  if (!JOB_API_BASE_URL) {
    const error = new Error('Thiếu VITE_JOB_SERVER_URL cho Job API.');
    error.code = 'JOB_API_BASE_URL_MISSING';
    throw error;
  }
  return JOB_API_BASE_URL;
}

function buildUrl(pathname, query = {}) {
  const url = new URL(pathname, requireJobApiBaseUrl());
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request(pathname, options = {}) {
  const { query, ...requestOptions } = options;

  let response;

  try {
    response = await fetch(buildUrl(pathname, query), {
      headers: {
        'Content-Type': 'application/json',
        ...(requestOptions.headers || {}),
      },
      ...requestOptions,
    });
  } catch (networkError) {
    const error = new Error(
      `Không thể kết nối Job API tại ${JOB_API_BASE_URL}. Hãy chạy jobs server (npm run jobs:server).`,
    );
    error.code = 'API_UNREACHABLE';
    error.cause = networkError;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    const error = new Error(toVietnameseErrorMessage(payload?.error || `Request failed: ${response.status}`, 'Yêu cầu Job API thất bại.'));
    error.status = response.status;
    throw error;
  }

  return payload;
}

export const jobsApi = {
  create(type, inputData, options = {}) {
    return request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type,
        inputData,
        dependsOn: options.dependsOn || [],
        priority: options.priority,
      }),
    });
  },

  getStatus(jobId) {
    return request(`/api/jobs/${jobId}`);
  },

  list(params = {}) {
    return request('/api/jobs', { query: params });
  },

  cancel(jobId) {
    return request(`/api/jobs/${jobId}`, { method: 'DELETE' });
  },

  subscribeProgress(jobId) {
    return new EventSource(buildUrl(`/api/jobs/${jobId}/progress`));
  },
};
