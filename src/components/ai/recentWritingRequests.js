export const RECENT_WRITING_REQUESTS_KEY = 'sf-recent-writing-requests-v1';
export const RECENT_WRITING_REQUESTS_LIMIT = 3;

function normalizeRecentWritingRequests(requests) {
  if (!Array.isArray(requests)) return [];

  const normalized = [];
  requests.forEach((request) => {
    const text = typeof request === 'string' ? request.trim() : '';
    if (!text || normalized.includes(text)) return;
    normalized.push(text);
  });

  return normalized.slice(0, RECENT_WRITING_REQUESTS_LIMIT);
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function addRecentWritingRequest(requests, request) {
  const text = typeof request === 'string' ? request.trim() : '';
  const current = normalizeRecentWritingRequests(requests);
  if (!text) return current;

  return [text, ...current.filter((item) => item !== text)]
    .slice(0, RECENT_WRITING_REQUESTS_LIMIT);
}

export function loadRecentWritingRequests(storage) {
  const target = resolveStorage(storage);
  if (!target) return [];

  try {
    return normalizeRecentWritingRequests(
      JSON.parse(target.getItem(RECENT_WRITING_REQUESTS_KEY) || '[]'),
    );
  } catch {
    return [];
  }
}

export function persistRecentWritingRequests(requests, storage) {
  const normalized = normalizeRecentWritingRequests(requests);
  const target = resolveStorage(storage);

  try {
    target?.setItem(RECENT_WRITING_REQUESTS_KEY, JSON.stringify(normalized));
  } catch {
    // The UI history still works for the current session if storage is unavailable.
  }

  return normalized;
}
