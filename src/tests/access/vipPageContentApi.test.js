import { describe, expect, it } from 'vitest';
import { createVipPageContentHandler } from '../../../api/vip-page-content.js';

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

describe('/api/vip-page-content', () => {
  it('returns only whitelisted VIP page fields from plan metadata', async () => {
    const handler = createVipPageContentHandler({
      fetchVipPlan: async () => ({
        key: 'vip',
        name: 'VIP',
        description: 'Không trả nguyên description nếu metadata đã có nội dung riêng.',
        metadata: {
          vipPage: {
            title: 'Tài khoản VIP StoryForge',
            priceLabel: '80.000đ',
            paymentNotice: 'VIP 80.000đ. Admin kích hoạt theo email Google.',
            internalNote: 'không được lộ',
          },
          privateBankNote: 'không được trả ra client',
        },
      }),
    });

    const { req, res } = createReqRes();
    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(payload.vipPage).toMatchObject({
      title: 'Tài khoản VIP StoryForge',
      priceLabel: '80.000đ',
      paymentNotice: 'VIP 80.000đ. Admin kích hoạt theo email Google.',
    });
    expect(JSON.stringify(payload)).not.toContain('internalNote');
    expect(JSON.stringify(payload)).not.toContain('privateBankNote');
  });

  it('keeps the page usable with fallback content when the catalog cannot be read', async () => {
    const handler = createVipPageContentHandler({
      fetchVipPlan: async () => {
        throw new Error('SUPABASE_DOWN');
      },
    });

    const { req, res } = createReqRes();
    await handler(req, res);
    const payload = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(payload.source).toBe('fallback');
    expect(payload.vipPage.priceLabel).toBe('50.000đ');
  });
});
