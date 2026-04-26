import { describe, expect, it } from 'vitest';
import { detectLabLiteFileType, readLabLiteFile } from '../../services/labLite/fileReader.js';

function makeFile(name, content, type = 'text/plain') {
  return new File([content], name, { type });
}

describe('Lab Lite Phase 1 - browser file reader', () => {
  it('detects txt, markdown, and docx from extension and mime type', () => {
    expect(detectLabLiteFileType({ name: 'story.txt', type: '' })).toBe('txt');
    expect(detectLabLiteFileType({ name: 'notes.md', type: '' })).toBe('md');
    expect(detectLabLiteFileType({ name: 'draft.docx', type: '' })).toBe('docx');
    expect(detectLabLiteFileType({ name: 'unknown.bin', type: 'text/plain' })).toBe('txt');
    expect(detectLabLiteFileType({ name: 'unknown.bin', type: 'text/markdown' })).toBe('md');
  });

  it('rejects unsupported files before parsing', async () => {
    await expect(readLabLiteFile(makeFile('archive.epub', 'binary', 'application/epub+zip')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('reads txt files and returns parsed browser-only chapter data', async () => {
    const parsed = await readLabLiteFile(makeFile('long_story.txt', [
      'Chapter 1: Start',
      '',
      'Opening chapter body with enough text for the detector to keep this chapter.',
      '',
      'Chapter 2: Change',
      '',
      'Second chapter body with a reveal and a new state for the protagonist.',
    ].join('\n')));

    expect(parsed.fileType).toBe('txt');
    expect(parsed.title).toBe('long story');
    expect(parsed.sourceFileName).toBe('long_story.txt');
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]).toEqual(expect.objectContaining({
      index: 1,
      wordCount: expect.any(Number),
      estimatedTokens: expect.any(Number),
    }));
  });

  it('reads markdown files with chapter headings as plain text', async () => {
    const parsed = await readLabLiteFile(makeFile('canon_notes.md', [
      '# Story notes',
      '',
      'Chapter 1: Arrival',
      '',
      'The hero arrives and meets the first guide.',
      '',
      'Chapter 2: Rule',
      '',
      'The world rule is explained through an action scene.',
    ].join('\n'), 'text/markdown'));

    expect(parsed.fileType).toBe('md');
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.rawText).toContain('# Story notes');
  });

  it('derives a readable title from dashed and underscored file names', async () => {
    const parsed = await readLabLiteFile(makeFile('my-long_story-v2.txt', 'Just one fallback chapter body.'));

    expect(parsed.title).toBe('my long story v2');
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].title).toBe('Chapter 1');
  });
});
