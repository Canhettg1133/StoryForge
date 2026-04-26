import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Lab Lite Phase 0 - surface contract', () => {
  it('registers the project route behind the Lab Lite gate', () => {
    const app = read('src/App.jsx');

    expect(app).toContain("import LabLite from './pages/Lab/LabLite/LabLite'");
    expect(app).toContain('path="lab-lite"');
    expect(app).toContain('PRODUCT_SURFACE.showLabLite ? <LabLite /> : labFallback');
  });

  it('adds a sidebar item next to the lab surfaces', () => {
    const sidebar = read('src/components/common/Sidebar.jsx');

    expect(sidebar).toContain("path: '/lab-lite'");
    expect(sidebar).toContain("label: 'Lab Lite'");
    expect(sidebar).toContain("surface: 'lab-lite'");
    expect(sidebar.indexOf("id: 'lab'")).toBeLessThan(sidebar.indexOf("id: 'lab-lite'"));
    expect(sidebar.indexOf("id: 'lab-lite'")).toBeLessThan(sidebar.indexOf("id: 'corpus-lab'"));
  });

  it('documents MVP boundaries and product language', () => {
    const docs = read('docs/LAB_LITE_CANON_ENGINE_PLAN.md');

    expect(docs).toContain('MVP Phase 0-3 Locked Scope');
    expect(docs).toContain('/project/:projectId/lab-lite');
    expect(docs).toContain('StoryForgeLabLiteDB');
    expect(docs).toContain('Khong dung `corpusApi`');
    expect(docs).toContain('Khong hua AI dam bao canon 100%');
  });

  it('keeps Lab Lite code independent from corpusApi and the main StoryForgeDB schema', () => {
    const files = [
      'src/pages/Lab/LabLite/LabLite.jsx',
      'src/stores/labLiteStore.js',
      'src/services/labLite/labLiteDb.js',
      'src/services/labLite/fileReader.js',
    ].map(read).join('\n');

    expect(files).not.toContain('corpusApi');
    expect(files).not.toContain("new Dexie('StoryForgeDB')");
    expect(files).toContain("new Dexie('StoryForgeLabLiteDB')");
  });
});
