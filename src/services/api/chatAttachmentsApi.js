import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';

function isLocalHost() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

const CHAT_ATTACHMENT_API_BASE_URL = (
  import.meta.env.VITE_JOB_SERVER_URL || (isLocalHost() ? 'http://localhost:3847' : '')
).trim();

function requireBaseUrl() {
  if (!CHAT_ATTACHMENT_API_BASE_URL) {
    const error = new Error('Thiếu VITE_JOB_SERVER_URL cho API đọc tệp đính kèm.');
    error.code = 'CHAT_ATTACHMENT_API_BASE_URL_MISSING';
    throw error;
  }
  return CHAT_ATTACHMENT_API_BASE_URL;
}

async function request(pathname, options = {}) {
  const url = new URL(pathname, requireBaseUrl());
  let response;
  try {
    response = await fetch(url.toString(), options);
  } catch (networkError) {
    const error = new Error(
      `Không thể kết nối API đọc tệp tại ${CHAT_ATTACHMENT_API_BASE_URL}. Hãy chạy jobs server (npm run jobs:server).`,
    );
    error.code = 'API_UNREACHABLE';
    error.cause = networkError;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(toVietnameseErrorMessage(payload?.error || `Request failed: ${response.status}`, 'Không thể đọc tệp đính kèm.'));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const chatAttachmentsApi = {
  parseFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return request('/api/chat-attachments/parse', {
      method: 'POST',
      body: formData,
    });
  },
};

export default chatAttachmentsApi;
