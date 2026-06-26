import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const MOJIBAKE_PATTERN = /\u0102|\u00c6|\u00e1\u00ba|\u00e1\u00bb|\u00e2\u20ac|\u00c4|\u00c5|\ufffd/u;

describe('site announcement admin UI contract', () => {
  it('exposes the announcement admin workflow without adding plan concepts', () => {
    const app = read('apps/admin/src/App.jsx');
    const css = read('apps/admin/src/App.css');
    const api = read('apps/admin/src/adminApi.js');

    for (const label of [
      'Thông báo',
      'Chỉnh thông báo hệ thống',
      'Bật thông báo',
      'Nội dung thông báo',
      'Link nút chính',
      'Xem trước thông báo',
      'Lưu thông báo',
    ]) {
      expect(app).toContain(label);
    }

    expect(css).toContain('.announcement-settings');
    expect(css).toContain('.announcement-preview');
    expect(api).toContain("request('/announcement')");
    expect(api).toMatch(/updateAnnouncement:\s*\(body\)\s*=>\s*request\('\/announcement',\s*\{\s*method:\s*'PATCH',\s*body,\s*\}\)/u);
  });

  it('keeps new announcement copy in valid Vietnamese UTF-8', () => {
    const combined = [
      read('apps/admin/src/App.jsx'),
      read('apps/admin/src/App.css'),
      read('apps/admin-api-worker/src/index.js'),
      read('packages/access/src/siteAnnouncement.js'),
      read('src/components/siteAnnouncement/SiteAnnouncementCenter.jsx'),
      read('src/pages/Notifications/Notifications.jsx'),
    ].join('\n');

    for (const label of [
      'Thông báo',
      'Mở bản dự phòng',
      'Hiện chưa có thông báo mới.',
      'Tiếp tục vào web',
      'Quay về',
    ]) {
      expect(combined).toContain(label);
    }

    expect(combined).not.toMatch(MOJIBAKE_PATTERN);
  });
});
