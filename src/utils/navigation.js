function isSafeInternalPath(value) {
  const raw = String(value || '').trim();
  return Boolean(
    raw
      && raw.startsWith('/')
      && !raw.startsWith('//')
      && !/^\/\\/u.test(raw)
      && !/[\r\n]/u.test(raw),
  );
}

export function normalizeInternalPath(value, fallback = '/') {
  const normalizedFallback = isSafeInternalPath(fallback) ? String(fallback).trim() : '/';
  return isSafeInternalPath(value) ? String(value).trim() : normalizedFallback;
}

export function canNavigateBackInApp(historyState = globalThis.window?.history?.state) {
  const idx = Number(historyState?.idx);
  return Number.isFinite(idx) && idx > 0;
}

export function getLocationReturnTo(location) {
  const returnTo = location?.state?.returnTo;
  const currentPath = `${location?.pathname || ''}${location?.search || ''}${location?.hash || ''}`;
  if (!isSafeInternalPath(returnTo)) return '';
  const normalized = String(returnTo).trim();
  return normalized === currentPath ? '' : normalized;
}

export function navigateBackOr(navigate, fallback = '/', { location, replace = true } = {}) {
  const returnTo = getLocationReturnTo(location);
  if (returnTo) {
    navigate(returnTo, { replace });
    return;
  }

  if (canNavigateBackInApp()) {
    navigate(-1);
    return;
  }

  navigate(normalizeInternalPath(fallback, '/'), { replace });
}
