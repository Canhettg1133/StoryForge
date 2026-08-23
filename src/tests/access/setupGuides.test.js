import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP_GUIDES,
  SETUP_GUIDES_KEY,
  SetupGuideValidationError,
  normalizeSetupGuideConfig,
  toPublicSetupGuideConfig,
  validateSetupGuideConfig,
} from '../../../packages/access/src/setupGuides.js';

describe('setup guide domain', () => {
  it('ships the five approved guide buttons in a stable order', () => {
    expect(DEFAULT_SETUP_GUIDES).toEqual({
      key: SETUP_GUIDES_KEY,
      revision: 1,
      items: [
        expect.objectContaining({ label: 'Hướng dẫn Gemini Direct', url: '/guide', enabled: true }),
        expect.objectContaining({ label: 'Hướng dẫn Gemini Proxy', url: '/guide/proxy', enabled: true }),
        expect.objectContaining({
          label: 'Hướng dẫn setup để viết truyện',
          url: 'https://youtu.be/4tf6rXf_nmo?si=8nnL0KGT1eKNNgYJ',
          enabled: true,
        }),
        expect.objectContaining({
          label: 'Hướng dẫn dịch truyện',
          url: 'https://youtu.be/jawxmA0Iyfk?si=dHkRVQXAV58JLl-o',
          enabled: true,
        }),
        expect.objectContaining({
          label: 'Mở Google AI Studio',
          url: 'https://aistudio.google.com/app/apikey',
          enabled: true,
        }),
      ],
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,boom',
    '//evil.example/path',
    '/guide\\proxy',
    '/guide\nproxy',
    'http://example.com/guide',
    'https://user:password@example.com/guide',
  ])('rejects unsafe guide URL %s', (url) => {
    const config = {
      expectedRevision: 1,
      items: [{ id: 'unsafe', label: 'Guide an toàn', url, enabled: true, icon: 'book' }],
    };

    expect(() => validateSetupGuideConfig(config)).toThrow(SetupGuideValidationError);
  });

  it('rejects duplicate ids, markup labels, too many items and unknown icons', () => {
    const item = { id: 'same-id', label: 'Guide', url: '/guide', enabled: true, icon: 'book' };
    expect(() => validateSetupGuideConfig({ expectedRevision: 1, items: [item], secret: 'hidden' }))
      .toThrow(/field/iu);
    expect(() => validateSetupGuideConfig({ expectedRevision: 1, items: [item, item] })).toThrow(/trùng/iu);
    expect(() => validateSetupGuideConfig({
      expectedRevision: 1,
      items: [{ ...item, id: 'html', label: '<b>Guide</b>' }],
    })).toThrow(/HTML/iu);
    expect(() => validateSetupGuideConfig({
      expectedRevision: 1,
      items: Array.from({ length: 13 }, (_, index) => ({ ...item, id: `item-${index}` })),
    })).toThrow(/12/iu);
    expect(() => validateSetupGuideConfig({
      expectedRevision: 1,
      items: [{ ...item, id: 'icon', icon: 'script' }],
    })).toThrow(/icon/iu);
    expect(() => validateSetupGuideConfig({
      expectedRevision: 1,
      items: [{ ...item, id: 'long-label', label: 'x'.repeat(65) }],
    })).toThrow(/64/iu);
    expect(() => validateSetupGuideConfig({
      expectedRevision: 1,
      items: [{ ...item, id: 'long-url', url: `https://example.com/${'x'.repeat(2048)}` }],
    })).toThrow(/an toàn/iu);
  });

  it('falls back safely while preserving a valid stored revision for admin recovery', () => {
    expect(normalizeSetupGuideConfig({ revision: -10, items: 'bad' })).toEqual(DEFAULT_SETUP_GUIDES);
    expect(normalizeSetupGuideConfig({ revision: 7, value_json: { items: 'bad' } })).toEqual({
      ...DEFAULT_SETUP_GUIDES,
      revision: 7,
    });
  });

  it('only exposes enabled, whitelisted public fields', () => {
    const publicConfig = toPublicSetupGuideConfig({
      key: SETUP_GUIDES_KEY,
      revision: 7,
      value_json: {
        secret: 'must-not-leak',
        items: [
          { id: 'visible', label: 'Visible', url: '/guide', enabled: true, icon: 'book', token: 'hidden' },
          { id: 'hidden', label: 'Hidden', url: '/guide/proxy', enabled: false, icon: 'book' },
        ],
      },
    });

    expect(publicConfig).toEqual({
      revision: 7,
      items: [{ id: 'visible', label: 'Visible', url: '/guide', icon: 'book' }],
    });
    expect(JSON.stringify(publicConfig)).not.toContain('secret');
    expect(JSON.stringify(publicConfig)).not.toContain('token');
    expect(JSON.stringify(publicConfig)).not.toContain('enabled');
  });
});


