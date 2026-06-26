import { describe, expect, it } from 'vitest';
import { createSiteAnnouncementHandler } from '../../../api/site-announcement.js';
import {
  DEFAULT_SITE_ANNOUNCEMENT_URL,
  SITE_ANNOUNCEMENT_KEY,
} from '../../../packages/access/src/index.js';

function createReqRes({ method = 'GET' } = {}) {
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(chunks).toString('utf8');
      this.ended = true;
    },
  };
  return { req: { method }, res };
}

describe('/api/site-announcement', () => {
  it('returns only public announcement fields from site_settings', async () => {
    const handler = createSiteAnnouncementHandler({
      fetchSiteAnnouncement: async () => ({
        key: SITE_ANNOUNCEMENT_KEY,
        revision: 12,
        updated_by: 'admin-1',
        value_json: {
          enabled: true,
          title: 'Thông báo bảo trì',
          body: 'Nếu trang hiện tại lỗi, hãy dùng bản dự phòng.',
          primaryActionLabel: 'Mở bản dự phòng',
          primaryActionUrl: 'https://story-forge-kohl.vercel.app/',
          internalNote: 'không được trả ra client',
        },
      }),
    });

    const { req, res } = createReqRes();
    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(payload.source).toBe('database');
    expect(payload.announcement).toMatchObject({
      key: SITE_ANNOUNCEMENT_KEY,
      enabled: true,
      revision: 12,
      title: 'Thông báo bảo trì',
      primaryActionUrl: DEFAULT_SITE_ANNOUNCEMENT_URL,
    });
    expect(JSON.stringify(payload)).not.toContain('internalNote');
    expect(JSON.stringify(payload)).not.toContain('admin-1');
  });

  it('keeps the announcement usable with fallback content when storage cannot be read', async () => {
    const handler = createSiteAnnouncementHandler({
      fetchSiteAnnouncement: async () => {
        throw new Error('SUPABASE_DOWN');
      },
    });

    const { req, res } = createReqRes();
    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(payload.source).toBe('fallback');
    expect(payload.announcement.primaryActionUrl).toBe(DEFAULT_SITE_ANNOUNCEMENT_URL);
    expect(payload.announcement.enabled).toBe(true);
  });

  it('rejects unsupported methods', async () => {
    const handler = createSiteAnnouncementHandler();
    const { req, res } = createReqRes({ method: 'POST' });

    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(405);
    expect(payload.code).toBe('METHOD_NOT_ALLOWED');
  });
});
