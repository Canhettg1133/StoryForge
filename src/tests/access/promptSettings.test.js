import { describe, expect, it } from 'vitest';
import {
  PROMPT_SETTING_MAX_CONTENT_CHARS,
  PROMPT_SETTINGS_DOMAINS,
  TRANSLATOR_PROMPT_KEYS,
  buildPromptSettingsList,
  normalizePromptSettingPatch,
  toPublicTranslatorPromptSettings,
} from '../../../packages/access/src/index.js';

describe('prompt settings access model', () => {
  it('keeps translator prompts on an explicit allowlist and reserves future domains', () => {
    expect(PROMPT_SETTINGS_DOMAINS.TRANSLATOR).toBe('translator');
    expect(PROMPT_SETTINGS_DOMAINS.WRITING).toBe('writing');
    expect(TRANSLATOR_PROMPT_KEYS).toEqual([
      'convert',
      'novel',
      'wuxia',
      'romance',
      'adult',
      'sacHiep',
      'sacHiepPro',
      'sacHiepENI',
    ]);
  });

  it('normalizes prompt patches with revision and content limits', () => {
    const patch = normalizePromptSettingPatch({
      content: '  Prompt hệ thống mới  ',
      enabled: true,
      expectedRevision: 4,
    }, {
      content: 'Prompt cũ',
      enabled: false,
    });

    expect(patch).toEqual({
      content: 'Prompt hệ thống mới',
      enabled: true,
      expectedRevision: 4,
    });

    expect(() => normalizePromptSettingPatch({
      content: 'x'.repeat(PROMPT_SETTING_MAX_CONTENT_CHARS + 1),
      enabled: true,
      expectedRevision: 1,
    })).toThrow(/ADMIN_PROMPT_CONTENT_TOO_LONG/u);

    expect(() => normalizePromptSettingPatch({
      content: 'Prompt',
      enabled: true,
    })).toThrow(/ADMIN_PROMPT_REVISION_REQUIRED/u);
  });

  it('builds a stable admin list without leaking unknown keys', () => {
    const items = buildPromptSettingsList('translator', [
      {
        domain: 'translator',
        key: 'sacHiepPro',
        content: 'Prompt deploy global',
        enabled: true,
        revision: 3,
        updated_by: 'owner-1',
      },
      {
        domain: 'translator',
        key: 'unknown',
        content: 'không được trả',
        enabled: true,
        revision: 99,
      },
    ]);

    expect(items).toHaveLength(TRANSLATOR_PROMPT_KEYS.length);
    expect(items.find((item) => item.key === 'sacHiepPro')).toMatchObject({
      domain: 'translator',
      key: 'sacHiepPro',
      content: 'Prompt deploy global',
      enabled: true,
      revision: 3,
    });
    expect(items.some((item) => item.key === 'unknown')).toBe(false);
    expect(JSON.stringify(items)).not.toContain('owner-1');
  });

  it('publishes only active translator prompt content to the runtime', () => {
    const publicPayload = toPublicTranslatorPromptSettings([
      {
        domain: 'translator',
        key: 'sacHiepPro',
        content: 'Prompt active',
        enabled: true,
        revision: 8,
        updated_by: 'owner-1',
        actor_email: 'owner@example.com',
      },
      {
        domain: 'translator',
        key: 'adult',
        content: 'Prompt disabled',
        enabled: false,
        revision: 9,
      },
      {
        domain: 'writing',
        key: 'outline',
        content: 'Không thuộc runtime dịch',
        enabled: true,
        revision: 11,
      },
    ]);

    expect(publicPayload).toEqual({
      prompts: {
        sacHiepPro: 'Prompt active',
      },
      revision: 8,
    });
    expect(JSON.stringify(publicPayload)).not.toContain('owner');
    expect(JSON.stringify(publicPayload)).not.toContain('Prompt disabled');
    expect(JSON.stringify(publicPayload)).not.toContain('Không thuộc runtime dịch');
  });
});
