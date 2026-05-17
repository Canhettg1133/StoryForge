export const OUTLINE_PROGRESS_STOPWORDS = new Set([
  'va', 'voi', 'cua', 'cho', 'khi', 'sau', 'truoc', 'trong', 'tren', 'duoi',
  'mot', 'nhung', 'cac', 'nay', 'kia', 'roi', 'da', 'se', 'dang', 'la',
  'bi', 'duoc', 'tu', 'den', 'hay', 'neu', 'thi', 'ma', 'tai', 'nhan', 'vat',
  'chuong', 'canh', 'beat', 'plot', 'thread', 'noi', 'dung',
]);

export function normalizePlanningText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
