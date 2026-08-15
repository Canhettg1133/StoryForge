import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRuntimeFile(relativePath) {
  return fs
    .readFileSync(path.join(repoRoot, relativePath), 'utf8')
    .replace(/\r\n/gu, '\n');
}

describe('Translator source preview tools', () => {
  it('separates file metrics from the two source actions without changing their handlers', () => {
    const html = readRuntimeFile('public/translator-runtime/index.html');
    const header = html.match(/<div class="preview-header">([\s\S]*?)<textarea id="originalText"/)?.[1] || '';
    const tools = header.match(/<div class="preview-tools"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    const metrics = header.match(/<div class="preview-stats"[\s\S]*?<\/div>/)?.[0] || '';

    expect(header).toContain('class="preview-header__top"');
    expect(tools).toContain('data-click-action="openHanFileAudit"');
    expect(tools).toContain('data-click-action="openSourceChapterReader"');
    expect(tools).toContain('Quét và sửa chữ Trung còn sót trong TXT đã dịch');
    expect(tools).toContain('Mục lục, đọc truyện và xuất EPUB');
    expect(metrics).toContain('id="charCount"');
    expect(metrics).toContain('id="chunkCount"');
    expect(metrics).toContain('id="estimatedTime"');
    expect(metrics).not.toContain('data-click-action');
  });

  it('uses distinct action treatments and responsive layouts with accessible touch targets', () => {
    const css = readRuntimeFile('public/translator-runtime/style.css');

    expect(css).toContain('.preview-tool--audit');
    expect(css).toContain('.preview-tool--reader');
    expect(css).toMatch(/\.preview-tool\s*\{[^}]*min-height:\s*(?:[4-9]\d|\d{3,})px;/su);
    expect(css).toContain('grid-template-columns: 1fr;');
    expect(css).toMatch(/@media \(min-width: 640px\)[\s\S]*?\.preview-tools\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.preview-tool:hover/u);
    expect(css).toContain('.preview-tool:focus-visible');
  });
});
