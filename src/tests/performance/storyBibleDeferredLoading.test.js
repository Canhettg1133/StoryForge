import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/StoryBible/StoryBible.jsx'),
  'utf8',
);

describe('Story Bible below-fold loading', () => {
  it('keeps the overview eager and splits deferred sections into idle chunks', () => {
    expect(source).toContain("import StoryBibleOverviewSection from './sections/StoryBibleOverviewSection'");
    expect(source).toContain('useProgressiveIdleSections(5)');
    expect(source.match(/React\.lazy\(\(\) => import\(/g)?.length || 0).toBeGreaterThanOrEqual(5);
    expect(source).toContain('<React.Suspense fallback={null}>');
  });

  it('refreshes canon through the inspector returned by the Story Bible hook', () => {
    expect(source).toContain('canonState.loadCanonOverview()');
    expect(source).not.toMatch(/\n\s+loadCanonOverview\(\),/);
  });

  it('declares navigation hooks before the empty-project return', () => {
    const navigationHook = source.indexOf('const buildProjectPath = useCallback');
    const emptyProjectReturn = source.indexOf('if (!currentProject)');

    expect(navigationHook).toBeGreaterThanOrEqual(0);
    expect(navigationHook).toBeLessThan(emptyProjectReturn);
  });
});
