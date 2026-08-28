import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const benchmarkSource = fs.readFileSync(
  path.join(process.cwd(), 'scripts/benchmark-editor-browser.mjs'),
  'utf8',
);
const sceneEditorSource = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/SceneEditor/SceneEditor.jsx'),
  'utf8',
);
const storyEditorSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/editor/StoryEditor.jsx'),
  'utf8',
);
const chapterListSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/common/ChapterList.jsx'),
  'utf8',
);
const aiSidebarSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/ai/AISidebar.jsx'),
  'utf8',
);

describe('editor production browser benchmark contract', () => {
  it('measures twenty warm route rounds against the interaction budget', () => {
    expect(benchmarkSource).toContain("process.argv.includes('--interactions')");
    expect(benchmarkSource).toMatch(/routeRounds\s*=\s*20/);
    expect(benchmarkSource).toContain('routeP95Ms');
    expect(benchmarkSource).toMatch(/routeP95Ms\s*<=\s*200/);
  });

  it('checks fifty mobile panel cycles for DOM and retained-heap growth', () => {
    expect(benchmarkSource).toMatch(/panelCycles\s*=\s*50/);
    expect(benchmarkSource).toContain('panelDomGrowthPercent');
    expect(benchmarkSource).toContain('panelHeapGrowthPercent');
    expect(benchmarkSource).toMatch(/panelHeapGrowthPercent\s*<=\s*10/);
  });

  it('isolates mobile panel toggles from the editor and chapter trees', () => {
    expect(storyEditorSource).toContain('export default React.memo(StoryEditor)');
    expect(chapterListSource).toContain('export default React.memo(ChapterList)');
    expect(sceneEditorSource).toContain('onOpenChapters={handleOpenChapters}');
    expect(sceneEditorSource).toContain('onItemSelect={handleMobileItemSelect}');
    expect(sceneEditorSource).not.toContain("onOpenChapters={() => openMobilePanel('chapters')}");
  });

  it('keeps the retained AI panel isolated from unrelated mobile sheet toggles', () => {
    expect(aiSidebarSource).toContain('export default React.memo(AISidebar)');
  });
});
