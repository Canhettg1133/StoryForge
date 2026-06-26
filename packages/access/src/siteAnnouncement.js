export const SITE_ANNOUNCEMENT_KEY = 'site_announcement';
export const DEFAULT_SITE_ANNOUNCEMENT_URL = 'https://story-forge-kohl.vercel.app/';

const FIELD_LIMITS = Object.freeze({
  title: 90,
  body: 900,
  primaryActionLabel: 48,
  primaryActionUrl: 260,
});

function cleanText(value, fallback, maxLength) {
  const text = String(value ?? '').trim();
  const safe = text || fallback;
  return safe.length > maxLength ? safe.slice(0, maxLength).trim() : safe;
}

export function normalizeHttpsUrl(value, fallback = DEFAULT_SITE_ANNOUNCEMENT_URL) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function normalizeRevision(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.floor(number);
}

export function createDefaultSiteAnnouncement() {
  return {
    key: SITE_ANNOUNCEMENT_KEY,
    enabled: true,
    revision: 1,
    title: 'Thông báo hệ thống',
    body: 'Nếu StoryForge hiện tại gặp lỗi hoặc không vào được, bạn có thể dùng bản dự phòng tại https://story-forge-kohl.vercel.app/. Hãy lưu lại đường dẫn này để tiếp tục làm việc khi cần.',
    primaryActionLabel: 'Mở bản dự phòng',
    primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
  };
}

export const DEFAULT_SITE_ANNOUNCEMENT = Object.freeze(createDefaultSiteAnnouncement());

export function normalizeSiteAnnouncement(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fallback = DEFAULT_SITE_ANNOUNCEMENT;
  return {
    key: SITE_ANNOUNCEMENT_KEY,
    enabled: source.enabled === undefined || source.enabled === null ? fallback.enabled : Boolean(source.enabled),
    revision: normalizeRevision(source.revision),
    title: cleanText(source.title, fallback.title, FIELD_LIMITS.title),
    body: cleanText(source.body, fallback.body, FIELD_LIMITS.body),
    primaryActionLabel: cleanText(source.primaryActionLabel, fallback.primaryActionLabel, FIELD_LIMITS.primaryActionLabel),
    primaryActionUrl: normalizeHttpsUrl(source.primaryActionUrl, fallback.primaryActionUrl),
  };
}

export function toPublicSiteAnnouncement(row = null) {
  if (!row || typeof row !== 'object') return DEFAULT_SITE_ANNOUNCEMENT;
  const value = row.value_json && typeof row.value_json === 'object' && !Array.isArray(row.value_json)
    ? row.value_json
    : row;
  return normalizeSiteAnnouncement({
    enabled: value.enabled,
    revision: row.revision ?? value.revision,
    title: value.title,
    body: value.body,
    primaryActionLabel: value.primaryActionLabel,
    primaryActionUrl: value.primaryActionUrl,
  });
}

export function getSiteAnnouncementDismissKey(announcement = DEFAULT_SITE_ANNOUNCEMENT) {
  const normalized = normalizeSiteAnnouncement(announcement);
  return `${normalized.key}:${normalized.revision}`;
}

export function hasSiteAnnouncementContentChanged(current, next) {
  const left = normalizeSiteAnnouncement(current);
  const right = normalizeSiteAnnouncement(next);
  return left.title !== right.title
    || left.body !== right.body
    || left.primaryActionLabel !== right.primaryActionLabel
    || left.primaryActionUrl !== right.primaryActionUrl;
}
