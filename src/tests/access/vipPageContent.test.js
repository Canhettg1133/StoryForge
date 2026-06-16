import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIP_PAGE_CONTENT,
  normalizeVipPageContent,
} from '../../../packages/access/src/index.js';

describe('VIP page content config', () => {
  it('derives default copy from a changed VIP price without requiring a full CMS payload', () => {
    const content = normalizeVipPageContent({ priceLabel: '80.000đ' });

    expect(content.priceLabel).toBe('80.000đ');
    expect(content.introText).toContain('80.000đ');
    expect(content.paymentNotice).toContain('VIP 80.000đ');
    expect(content.title).toBe(DEFAULT_VIP_PAGE_CONTENT.title);
  });

  it('keeps only the public, schema-approved text fields', () => {
    const content = normalizeVipPageContent({
      title: 'Trang VIP StoryForge',
      supportText: 'Nhắn admin khi cần hỗ trợ tài khoản và VIP.',
      internalNote: 'không được lộ',
      paymentSecret: 'không được trả ra client',
    });

    expect(content).toMatchObject({
      title: 'Trang VIP StoryForge',
      supportText: 'Nhắn admin khi cần hỗ trợ tài khoản và VIP.',
    });
    expect(content.internalNote).toBeUndefined();
    expect(content.paymentSecret).toBeUndefined();
  });
});
