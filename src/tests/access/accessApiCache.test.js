import { describe, expect, it } from 'vitest';

import {
  buildAccessData,
  clearAccessRuntimeCaches,
} from '../../../api/_lib/access-control.js';

function createFakeSupabase(state = {}) {
  const calls = [];
  const dataByTable = {
    features: [{ key: 'ai_chat.access', active: true }],
    plan_features: [{ plan_id: 'plan-vip', feature_key: 'ai_chat.access', enabled: true }],
    consent_versions: [{ key: 'adult_terms', version: '1', active: true }],
    user_plans: [{ id: 'plan-row', user_id: 'user-1', plan_id: 'plan-vip', status: 'active', plans: { key: 'vip', name: 'VIP' } }],
    user_entitlement_overrides: [],
  };

  function createBuilder(table) {
    const builder = {
      filters: [],
      selected: '',
      select(value) {
        this.selected = value;
        return this;
      },
      eq(column, value) {
        this.filters.push([column, value]);
        return this;
      },
      maybeSingle() {
        calls.push({ table, mode: 'maybeSingle', filters: [...this.filters] });
        if (table === 'access_versions') {
          return Promise.resolve({ data: { version: state.version || 1 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        calls.push({ table, mode: 'select', filters: [...this.filters], selected: this.selected });
        return Promise.resolve({ data: dataByTable[table] || [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    calls,
    from(table) {
      return createBuilder(table);
    },
  };
}

describe('access API runtime cache', () => {
  it('reuses global catalog and per-user snapshots until access_version changes', async () => {
    clearAccessRuntimeCaches();
    const state = { version: 1 };
    const supabase = createFakeSupabase(state);
    const user = { id: 'user-1' };
    const profile = {
      user_id: 'user-1',
      email: 'reader@example.com',
      system_role: 'user',
      status: 'active',
    };

    await buildAccessData(supabase, user, profile);
    await buildAccessData(supabase, user, profile);

    expect(supabase.calls.filter((call) => call.table === 'access_versions')).toHaveLength(2);
    expect(supabase.calls.filter((call) => call.table === 'features')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'plan_features')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'consent_versions')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'user_plans')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'user_entitlement_overrides')).toHaveLength(1);

    state.version = 2;
    await buildAccessData(supabase, user, profile);

    expect(supabase.calls.filter((call) => call.table === 'features')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'plan_features')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'consent_versions')).toHaveLength(1);
    expect(supabase.calls.filter((call) => call.table === 'user_plans')).toHaveLength(2);
    expect(supabase.calls.filter((call) => call.table === 'user_entitlement_overrides')).toHaveLength(2);
  });
});
