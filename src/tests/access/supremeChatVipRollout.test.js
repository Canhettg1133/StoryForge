import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'docs/supabase-access-control/017_enable_supreme_chat_for_vip.sql',
);

describe('Supreme Chat VIP rollout migration', () => {
  it('enables Supreme Chat and Story Mirror for both paid plans without per-user grants', () => {
    const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

    expect(migration).toContain("'ai_chat.supreme'");
    expect(migration).toContain("'story_mirror.access'");
    expect(migration).toContain("key in ('vip', 'lifetime')");
    expect(migration).toContain('insert into public.plan_features');
    expect(migration).toContain('cross join paid_features');
    expect(migration).toContain('on conflict (plan_id, feature_key) do update');
    expect(migration).toContain('enabled = excluded.enabled');
  });

  it('avoids rewriting mappings that are already enabled', () => {
    const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

    expect(migration).toContain(
      'where public.plan_features.enabled is distinct from excluded.enabled',
    );
  });

  it('pins the prompt encryption rollout to key version 3 in both Workers', () => {
    const webWrangler = fs.readFileSync(
      path.resolve(process.cwd(), 'wrangler.toml'),
      'utf8',
    );
    const adminWrangler = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/admin-api-worker/wrangler.toml'),
      'utf8',
    );

    expect(webWrangler).not.toContain('SUPREME_PROMPT_ACTIVE_KEY_VERSION = "2"');
    expect(webWrangler.match(/SUPREME_PROMPT_ACTIVE_KEY_VERSION = "3"/g)).toHaveLength(2);
    expect(adminWrangler).toContain('SUPREME_PROMPT_ACTIVE_KEY_VERSION = "3"');
  });
});
