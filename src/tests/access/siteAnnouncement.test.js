import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_ANNOUNCEMENT,
  DEFAULT_SITE_ANNOUNCEMENT_URL,
  SITE_ANNOUNCEMENT_KEY,
  getSiteAnnouncementDismissKey,
  hasSiteAnnouncementContentChanged,
  normalizeSiteAnnouncement,
  toPublicSiteAnnouncement,
} from '../../../packages/access/src/index.js';

const MOJIBAKE_PATTERN = /\u0102|\u00c6|\u00e1\u00ba|\u00e1\u00bb|\u00e2\u20ac|\u00c4|\u00c5|\ufffd/u;

describe('site announcement content config', () => {
  it('keeps the fallback announcement enabled and points to the backup StoryForge URL', () => {
    expect(DEFAULT_SITE_ANNOUNCEMENT).toMatchObject({
      key: SITE_ANNOUNCEMENT_KEY,
      enabled: true,
      revision: 1,
      primaryActionLabel: 'Mở bản dự phòng',
      primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
    });
    expect(DEFAULT_SITE_ANNOUNCEMENT.body).toContain('https://story-forge-kohl.vercel.app/');
  });

  it('normalizes only public fields and rejects unsafe action URLs', () => {
    const content = normalizeSiteAnnouncement({
      key: 'other-key',
      enabled: true,
      revision: 4,
      title: 'Thông báo mới',
      body: 'Dòng 1\nDòng 2',
      primaryActionLabel: 'Mở link',
      primaryActionUrl: 'javascript:alert(1)',
      internalNote: 'không được lộ',
    });

    expect(content).toEqual({
      key: SITE_ANNOUNCEMENT_KEY,
      enabled: true,
      revision: 4,
      title: 'Thông báo mới',
      body: 'Dòng 1\nDòng 2',
      primaryActionLabel: 'Mở link',
      primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
    });
    expect(content.internalNote).toBeUndefined();
  });

  it('projects database rows with an allowlist instead of leaking stored metadata', () => {
    const publicContent = toPublicSiteAnnouncement({
      key: SITE_ANNOUNCEMENT_KEY,
      revision: 9,
      updated_by: 'admin-1',
      value_json: {
        enabled: false,
        title: 'Tạm tắt',
        body: 'Không hiển thị popup.',
        primaryActionLabel: 'Mở bản dự phòng',
        primaryActionUrl: 'https://story-forge-kohl.vercel.app/',
        privateField: 'không được lộ',
      },
    });

    expect(publicContent).toEqual({
      key: SITE_ANNOUNCEMENT_KEY,
      enabled: false,
      revision: 9,
      title: 'Tạm tắt',
      body: 'Không hiển thị popup.',
      primaryActionLabel: 'Mở bản dự phòng',
      primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
    });
    expect(JSON.stringify(publicContent)).not.toContain('admin-1');
    expect(JSON.stringify(publicContent)).not.toContain('privateField');
  });

  it('compares only user-facing content when deciding whether to bump revision', () => {
    const current = normalizeSiteAnnouncement({ enabled: true, revision: 3 });
    const toggledOnly = normalizeSiteAnnouncement({ ...current, enabled: false, revision: 3 });
    const changedBody = normalizeSiteAnnouncement({ ...current, body: `${current.body}\nCập nhật thêm.` });

    expect(hasSiteAnnouncementContentChanged(current, toggledOnly)).toBe(false);
    expect(hasSiteAnnouncementContentChanged(current, changedBody)).toBe(true);
    expect(getSiteAnnouncementDismissKey(current)).toBe(`${SITE_ANNOUNCEMENT_KEY}:3`);
  });

  it('keeps Vietnamese accented text and avoids mojibake in defaults', () => {
    const combined = JSON.stringify(DEFAULT_SITE_ANNOUNCEMENT);

    expect(combined).toContain('Thông báo');
    expect(combined).toContain('dự phòng');
    expect(combined).not.toMatch(MOJIBAKE_PATTERN);
  });
});
