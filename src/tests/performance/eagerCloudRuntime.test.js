import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('eager cloud runtime budget', () => {
  it('keeps background auto-sync and the Supabase SDK out of the eager app shell', () => {
    const layout = read('src/components/common/AppLayout.jsx');
    const auth = read('src/services/cloud/cloudAuthService.js');

    expect(layout).not.toContain("import CloudAutoSyncAgent from '../cloud/CloudAutoSyncAgent'");
    expect(layout).toContain("React.lazy(() => import('../cloud/CloudAutoSyncAgent'))");
    expect(auth).not.toContain("from './supabaseClient.js'");
    expect(auth).toContain("import('./supabaseClient.js')");
  });
});
