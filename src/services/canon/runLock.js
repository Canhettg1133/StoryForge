let activeBulkRunToken = null;

export function beginBulkCanonRun() {
  if (activeBulkRunToken) return null;
  activeBulkRunToken = Symbol('bulk-canon-run');
  return activeBulkRunToken;
}

export function endBulkCanonRun(token) {
  if (token && token === activeBulkRunToken) {
    activeBulkRunToken = null;
  }
}

export function assertCanonRunAllowed(token = null) {
  if (activeBulkRunToken && token !== activeBulkRunToken) {
    const error = new Error('Hệ thống đang rà lại toàn bộ chương. Hãy chờ tác vụ hiện tại hoàn tất.');
    error.code = 'CANON_BULK_RUNNING';
    throw error;
  }
}
