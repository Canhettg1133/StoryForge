import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/pages/OutlineBoard/OutlineBoard.jsx'),
  'utf8',
);

describe('OutlineBoard large-project rendering contract', () => {
  it('virtualizes unassigned, act-lane, and flat chapter collections', () => {
    expect(source).toContain('<VirtualOutlineGrid');
    expect(source.match(/<VirtualOutlineStack/g)).toHaveLength(2);
    expect(source).not.toMatch(/chaptersByAct\.unassigned\.map\(renderChapterCard\)/);
    expect(source).not.toMatch(/chaptersByAct\[act\.id\]\.map\(renderChapterCard\)/);
    expect(source).not.toMatch(/\{chapters\.map\(\(chapter, idx\) =>/);
  });
});
