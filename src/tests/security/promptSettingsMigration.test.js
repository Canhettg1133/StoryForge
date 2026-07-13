import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('prompt settings Supabase migration', () => {
  it('creates a dedicated RLS-protected prompt table and service-role-only RPC', () => {
    const migration = read('docs/supabase-access-control/013_prompt_settings.sql');

    expect(migration).toContain('create table if not exists public.prompt_settings');
    expect(migration).toContain('primary key (domain, key)');
    expect(migration).toContain("domain in ('translator', 'writing')");
    expect(migration).toContain('alter table public.prompt_settings enable row level security;');
    expect(migration).not.toMatch(/create\s+policy/iu);
    expect(migration).toContain('create or replace function public.upsert_prompt_setting');
    expect(migration).toContain('security definer');
    expect(migration).toContain('PROMPT_SETTING_REVISION_CONFLICT');
    expect(migration).toContain('revoke all on function public.upsert_prompt_setting(text, text, text, boolean, integer, uuid) from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.upsert_prompt_setting(text, text, text, boolean, integer, uuid) to service_role;');
  });

  it('seeds translator deploy prompts without overwriting admin-edited rows', () => {
    const seed = read('docs/supabase-access-control/014_prompt_settings_seed.sql');

    for (const key of [
      'convert',
      'novel',
      'wuxia',
      'romance',
      'adult',
      'sacHiep',
      'sacHiepPro',
      'sacHiepENI',
    ]) {
      expect(seed).toContain(`'translator', '${key}'`);
    }

    expect(seed).toContain('on conflict (domain, key) do update');
    expect(seed).toContain("public.prompt_settings.content = ''");
    expect(seed).toContain('public.prompt_settings.enabled = false');
    expect(seed).toContain('public.prompt_settings.revision = 1');
    expect(seed).toContain('set content = excluded.content');
    expect(seed).toContain('enabled = false');
    expect(seed).not.toMatch(/create\s+policy/iu);
  });
});
