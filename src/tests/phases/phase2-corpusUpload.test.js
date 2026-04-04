import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createChunks } from '../../services/corpus/chunker.js';
import {
  detectFileType,
  parseCorpusFile,
  SUPPORTED_TYPES,
} from '../../services/corpus/parser/index.js';
import {
  detectFandom,
  getFandomSuggestion,
} from '../../services/corpus/detector/fandomDetector.js';

describe('Phase 2 - Corpus Upload & Parse', () => {
  it('detects supported file types from extension and mime type', () => {
    expect(SUPPORTED_TYPES).toEqual(expect.arrayContaining(['txt', 'epub', 'pdf', 'docx']));

    expect(detectFileType({ fileName: 'story.txt' })).toBe('txt');
    expect(detectFileType({ fileName: 'book.epub' })).toBe('epub');
    expect(detectFileType({ fileName: 'scan.pdf' })).toBe('pdf');
    expect(detectFileType({ fileName: 'doc.docx' })).toBe('docx');
    expect(
      detectFileType({ fileName: 'unknown.bin', mimeType: 'text/plain' }),
    ).toBe('txt');
  });

  it('parses txt corpus into chapters and metadata', async () => {
    const text = [
      'Chapter 1: The Beginning',
      'Harry Potter walked into Hogwarts.',
      '',
      'Chapter 2: The Duel',
      'Draco challenged Harry in the hallway.',
    ].join('\n');

    const parsed = await parseCorpusFile({
      buffer: Buffer.from(text, 'utf8'),
      fileName: 'demo-story.txt',
      mimeType: 'text/plain',
      options: { language: 'en' },
    });

    expect(parsed.fileType).toBe('txt');
    expect(parsed.metadata.title).toContain('demo story');
    expect(parsed.chapters.length).toBeGreaterThanOrEqual(2);
    expect(parsed.rawText.length).toBeGreaterThan(10);
  });

  it('throws a clear error for unsupported file type', async () => {
    await expect(
      parseCorpusFile({
        buffer: Buffer.from('binary content', 'utf8'),
        fileName: 'archive.bin',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('chunks chapter text and returns chunk metadata', () => {
    const chapter = {
      id: 'chapter-1',
      title: 'Chapter 1',
      content: 'word '.repeat(1800),
    };

    const chunks = createChunks(chapter, {
      chunkSize: 500,
      overlap: 60,
      preserveParagraphs: false,
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        chapterId: 'chapter-1',
        chapterTitle: 'Chapter 1',
        text: expect.any(String),
        wordCount: expect.any(Number),
        startWord: expect.any(String),
        endWord: expect.any(String),
      }),
    );
    expect(chunks.every((chunk) => chunk.wordCount > 0)).toBe(true);
  });

  it('detects fandom candidates and top suggestion', () => {
    const sample = [
      'Harry Potter and Hermione arrived at Hogwarts.',
      'Voldemort used dark magic and escaped Azkaban.',
      'The Quidditch match started at sunset.',
    ].join(' ');

    const detected = detectFandom(sample);
    expect(detected.length).toBeGreaterThan(0);
    expect(detected[0].key).toBe('harry_potter');

    const suggestion = getFandomSuggestion(sample);
    expect(suggestion).toEqual(
      expect.objectContaining({
        fandom: 'harry_potter',
        label: 'Harry Potter',
      }),
    );
    expect(suggestion.confidence).toBeGreaterThan(0.2);
  });
});