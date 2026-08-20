import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('hot interaction CSS', () => {
  it('does not transition every property in editor navigation surfaces', () => {
    const files = [
      'src/components/common/ChapterList.css',
      'src/components/common/Sidebar.css',
      'src/pages/SceneEditor/SceneEditor.css',
    ];

    for (const file of files) {
      const css = fs.readFileSync(path.join(root, file), 'utf8');
      expect(css, file).not.toMatch(/transition:\s*all\b/);
    }
  });

  it('isolates virtual chapter rows from surrounding layout and paint work', () => {
    const css = fs.readFileSync(path.join(root, 'src/components/common/ChapterList.css'), 'utf8');
    const rowRule = css.match(/\.chapter-virtual-row\s*\{([^}]*)\}/)?.[1] || '';

    expect(rowRule).toMatch(/contain:\s*layout\s+paint\s+style\s*;/);
  });
});
