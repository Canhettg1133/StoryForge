import {
  DEFAULT_SITE_ANNOUNCEMENT,
  getSiteAnnouncementDismissKey,
  normalizeSiteAnnouncement,
} from '../../config/siteAnnouncement.js';

export const SITE_ANNOUNCEMENT_CACHE_KEY = 'sf-site-announcement-cache-v1';
export const SITE_ANNOUNCEMENT_DISMISSED_KEY = 'sf-site-announcement-dismissed-v1';

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort cache only.
  }
}

export function readCachedSiteAnnouncement() {
  const raw = readStorage(SITE_ANNOUNCEMENT_CACHE_KEY);
  if (!raw) return null;
  try {
    return normalizeSiteAnnouncement(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function cacheSiteAnnouncement(announcement) {
  const normalized = normalizeSiteAnnouncement(announcement);
  writeStorage(SITE_ANNOUNCEMENT_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getDismissedSiteAnnouncementKey() {
  return readStorage(SITE_ANNOUNCEMENT_DISMISSED_KEY) || '';
}

export function dismissSiteAnnouncement(announcement) {
  writeStorage(SITE_ANNOUNCEMENT_DISMISSED_KEY, getSiteAnnouncementDismissKey(announcement));
}

export async function fetchSiteAnnouncement({ signal } = {}) {
  try {
    const response = await fetch('/api/site-announcement', { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`SITE_ANNOUNCEMENT_HTTP_${response.status}`);
    const payload = await response.json().catch(() => ({}));
    return {
      announcement: cacheSiteAnnouncement(payload?.announcement),
      source: payload?.source || 'network',
    };
  } catch {
    const cached = readCachedSiteAnnouncement();
    return {
      announcement: cached || DEFAULT_SITE_ANNOUNCEMENT,
      source: cached ? 'cache' : 'fallback',
    };
  }
}
