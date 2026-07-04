import { getSession } from '../cloud/cloudAuthService.js';
import { getStoryMirrorBaseUrl } from './config.js';

async function readPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return { error: await response.text() };
}

async function request(path, options = {}) {
  const baseUrl = getStoryMirrorBaseUrl();
  if (!baseUrl) {
    const error = new Error('Chưa cấu hình VITE_STORY_MIRROR_BASE_URL.');
    error.code = 'STORY_MIRROR_BASE_URL_MISSING';
    throw error;
  }

  const session = await getSession();
  const token = session?.access_token || '';
  if (!token) {
    const error = new Error('Cần đăng nhập trước khi đồng bộ truyện nền.');
    error.code = 'STORY_MIRROR_AUTH_REQUIRED';
    throw error;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const error = new Error(payload?.error || `Story Mirror API trả về mã ${response.status}.`);
    error.code = payload?.code || 'STORY_MIRROR_API_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function postStoryMirrorBatch(events) {
  return request('/mirror/v1/events/batch', {
    method: 'POST',
    body: { events },
  });
}

export function getStoryMirrorStatus() {
  return request('/mirror/v1/status');
}

export default {
  postStoryMirrorBatch,
  getStoryMirrorStatus,
};
