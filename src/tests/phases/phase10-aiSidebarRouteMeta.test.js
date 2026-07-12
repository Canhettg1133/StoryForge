import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('phase10 AI sidebar route metadata', () => {
  it('guards route metadata before rendering the mobile results tab', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/components/ai/AISidebar.jsx'), 'utf8');

    expect(source).toContain('lastRouteInfo?.provider');
    expect(source).toContain('lastRouteInfo?.model');
    expect(source).not.toMatch(/lastRouteInfo\.provider\b/);
    expect(source).not.toMatch(/lastRouteInfo\.model\b/);
  });
});
