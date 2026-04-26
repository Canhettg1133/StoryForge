import { describe, expect, it } from 'vitest';
import { detectLabLiteFileType } from '../../services/labLite/fileReader.js';

describe('Lab Lite Phase 1 - DOCX file reader contract', () => {
  it('recognizes DOCX mime type even without extension', () => {
    expect(detectLabLiteFileType({
      name: 'download',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })).toBe('docx');
  });

  it('does not classify PDF or EPUB as supported Lab Lite MVP input', () => {
    expect(detectLabLiteFileType({ name: 'book.pdf', type: 'application/pdf' })).toBeNull();
    expect(detectLabLiteFileType({ name: 'book.epub', type: 'application/epub+zip' })).toBeNull();
  });

  it('normalizes mime parameters before detection', () => {
    expect(detectLabLiteFileType({ name: 'blob', type: 'text/plain; charset=utf-8' })).toBe('txt');
  });
});
