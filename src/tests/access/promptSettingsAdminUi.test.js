import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const MOJIBAKE_PATTERN = /Ä‚|Ă†|Ă¡Âº|Ă¡Â»|Ă¢â‚¬|Ă„|Ă…|ï¿½/u;

describe('prompt settings admin UI contract', () => {
  it('adds an owner-gated Prompt Center page with Vietnamese copy', () => {
    const page = read('apps/admin/src/features/promptSettings/PromptSettingsPage.jsx');
    const css = read('apps/admin/src/features/promptSettings/promptSettings.css');
    const nav = read('apps/admin/src/constants/navigation.js');
    const app = read('apps/admin/src/App.jsx');
    const api = read('apps/admin/src/adminApi.js');

    for (const label of [
      'Prompt mẫu dịch truyện',
      'Dịch truyện',
      'Viết truyện',
      'Sắp hỗ trợ',
      'Prompt này không phải bí mật trong kiến trúc runtime browser hiện tại.',
      'Lưu bản nháp',
      'Khôi phục bản deploy',
      'Copy',
      'Bật override',
      'Tắt override',
      'Bản deploy',
      'Override đang tắt',
      'Override đang bật',
      'Dùng prompt deploy',
      'Override trống',
      'Cần nhập nội dung prompt trước khi bật override.',
    ]) {
      expect(`${page}\n${nav}`).toContain(label);
    }

    expect(page).toContain('getPromptItemLengthLabel');
    expect(page).toContain('enableWithoutContent');
    expect(page).toContain('nextEnabled && !String(nextContent || \'\').trim()');
    expect(page).not.toContain('{formatNumber(item.content.length)} ký tự');
    expect(nav).toContain("permission: ADMIN_PERMISSIONS.PROMPTS_READ");
    expect(app).toContain('visibleNavGroups');
    expect(app).toContain('hasPermission(actor, item.permission)');
    expect(app).toContain("activeView === 'prompt-settings'");
    expect(app).toContain('promptSettingsReloadSignal');
    expect(app).toContain('setPromptSettingsReloadSignal((value) => value + 1)');
    expect(app).toContain('reloadSignal={promptSettingsReloadSignal}');
    expect(page).toContain('reloadSignal = 0');
    expect(page).toContain('}, [loadData, reloadSignal])');
    expect(api).toContain('promptSettings:');
    expect(api).toContain("request(`/prompt-settings?${query.toString()}`)");
    expect(api).toContain('updatePromptSetting:');
    expect(css).toContain('.prompt-settings-page');
    expect(css).toContain('.prompt-settings-workspace');
  });

  it('keeps prompt editor rendering safe and avoids mojibake in new files', () => {
    const combined = [
      read('apps/admin/src/features/promptSettings/PromptSettingsPage.jsx'),
      read('apps/admin/src/features/promptSettings/promptSettings.css'),
      read('apps/admin-api-worker/src/promptSettings/index.js'),
      read('packages/access/src/promptSettings.js'),
    ].join('\n');

    expect(combined).toContain('<textarea');
    expect(combined).toContain('value={draftContent}');
    expect(combined).not.toContain('dangerouslySetInnerHTML');
    expect(combined).not.toContain('innerHTML');
    expect(combined).not.toMatch(MOJIBAKE_PATTERN);
  });
});
