import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_FEATURES,
  ADMIN_PERMISSIONS,
  hasPermission,
} from '../../../packages/access/src/index.js';

function readPlannedFile(path) {
  const absolutePath = resolve(process.cwd(), path);
  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

describe('Supreme feature and owner-only permissions', () => {
  it('defines a dedicated feature and three dedicated permissions', () => {
    expect(ACCESS_FEATURES.AI_CHAT_SUPREME).toBe('ai_chat.supreme');
    expect(ADMIN_PERMISSIONS.SECURE_PROMPTS_READ).toBe('secure_prompts.read');
    expect(ADMIN_PERMISSIONS.SECURE_PROMPTS_WRITE).toBe('secure_prompts.write');
    expect(ADMIN_PERMISSIONS.SECURE_PROMPTS_PUBLISH).toBe('secure_prompts.publish');
  });

  it.each(['user', 'support', 'admin'])('does not grant secure prompt access to %s', (role) => {
    const actor = { role };

    expect(hasPermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_READ)).toBe(false);
    expect(hasPermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_WRITE)).toBe(false);
    expect(hasPermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_PUBLISH)).toBe(false);
  });

  it('grants all secure prompt permissions to owner', () => {
    const actor = { role: 'owner' };

    expect(hasPermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_READ)).toBe(true);
    expect(hasPermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_WRITE)).toBe(true);
    expect(hasPermission(actor, ADMIN_PERMISSIONS.SECURE_PROMPTS_PUBLISH)).toBe(true);
  });
});

describe('Supreme secure prompt Admin API contract', () => {
  it('registers owner-only draft, publish, rollback, disable, and detail routes', () => {
    const worker = readPlannedFile('apps/admin-api-worker/src/index.js');
    const route = readPlannedFile('apps/admin-api-worker/src/securePrompts/index.js');

    expect(worker).toContain("resource === 'secure-prompts'");
    expect(worker).toContain('segments: segments.slice(1)');
    expect(route).toContain("const PROMPT_ROUTE = 'supreme-chat'");
    expect(route).toMatch(/request\.method === 'GET' && !action/iu);
    expect(route).toMatch(/request\.method === 'PUT' && action === 'draft'/iu);
    expect(route).toMatch(/request\.method === 'POST' && action === 'publish'/iu);
    expect(route).toMatch(/request\.method === 'POST' && action === 'rollback'/iu);
    expect(route).toMatch(/request\.method === 'POST' && action === 'disable'/iu);
    expect(route).toContain('SECURE_PROMPTS_READ');
    expect(route).toContain('SECURE_PROMPTS_WRITE');
    expect(route).toContain('SECURE_PROMPTS_PUBLISH');
    expect(route).toContain('expectedDraftRevision');
    expect(route).toContain('expectedPublishedRevision');
    expect(route).toContain('secure_prompt.rollback');
    expect(route).toMatch(/key\?\.fill\(0\)/u);
    expect(route).not.toMatch(/auditMutation[\s\S]{0,500}\bcontent\s*:/iu);
  });

  it('returns no-store responses and only one plaintext revision at a time', () => {
    const route = readPlannedFile('apps/admin-api-worker/src/securePrompts/index.js');

    expect(route).toContain('Cache-Control');
    expect(route).toContain('no-store');
    expect(route).toContain('Pragma');
    expect(route).toContain('no-cache');
    expect(route).toContain('X-Content-Type-Options');
    expect(route).toContain('nosniff');
    expect(route).toContain('draftContent');
    expect(route).toContain('versions');
    expect(route).not.toContain('versionContents');
  });
});

describe('Supreme secure prompt Admin UI contract', () => {
  it('adds a separate Chat Tối Thượng editor without a clipboard action', () => {
    const page = readPlannedFile('apps/admin/src/features/promptSettings/PromptSettingsPage.jsx');
    const panel = readPlannedFile('apps/admin/src/features/promptSettings/SupremePromptSettingsPanel.jsx');
    const api = readPlannedFile('apps/admin/src/adminApi.js');

    for (const label of [
      'Chat Tối Thượng',
      'Lưu bản nháp',
      'Xuất bản',
      'Hoàn tác thay đổi chưa lưu',
      'Tắt Tối Thượng',
      'Khôi phục revision này',
      'Prompt chỉ hiển thị cho owner',
      'Bản nháp chưa ảnh hưởng người dùng',
    ]) {
      expect(`${page}\n${panel}`).toContain(label);
    }

    expect(panel).not.toMatch(/clipboard|copy prompt/iu);
    expect(api).toContain('securePrompts');
    expect(api).toContain('/secure-prompts/supreme-chat');
  });

  it('includes loading, conflict, disabled, dirty, error, and accessible status states', () => {
    const panel = readPlannedFile('apps/admin/src/features/promptSettings/SupremePromptSettingsPanel.jsx');

    expect(panel).toContain('aria-live');
    expect(panel).toMatch(/beforeunload/iu);
    expect(panel).toMatch(/dirty/iu);
    expect(panel).toMatch(/conflict/iu);
    expect(panel).toMatch(/loading/iu);
    expect(panel).toMatch(/enabled/iu);
    expect(panel).toMatch(/60000/u);
    expect(panel).toMatch(/textarea/iu);
    expect(panel).toMatch(/label/iu);
    expect(panel).toContain('supreme-prompt-loading__line');
    expect(panel).toContain('focusTarget()?.focus?.()');
  });
});
