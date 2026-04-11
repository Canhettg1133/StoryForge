import { describe, expect, it } from 'vitest';
import {
  CHUNK_PRESETS,
  CONTEXT_LIMITS,
  calculateNewChunks,
  estimateAnalysisTime,
  getContextLimits,
  getPartsPerChunk,
  normalizeParallelChunks,
  resolveChunkSizeWords,
  resolveModel,
  validateChunkSize,
} from '../../services/corpus/chunkCalculator.js';
import { createRechunkRows } from '../../services/corpus/rechunker.js';

describe('Phase 2.1 - Chunk Optimizer', () => {
  it('exposes expected context limits and presets', () => {
    expect(CONTEXT_LIMITS['gemini-3.1-pro-high']).toEqual(
      expect.objectContaining({
        inputTokens: 1000000,
        recommendedInput: 650000,
        outputTokens: 65536,
      }),
    );

    expect(CHUNK_PRESETS.optimal.words).toBe(500000);
    expect(CHUNK_PRESETS.fast.model).toBe('gemini-2.5-flash');
  });

  it('resolves model/chunk size and parallel values safely', () => {
    expect(resolveModel('gemini-3.1-pro-high', 'optimal')).toBe('gemini-3.1-pro-high');
    expect(resolveModel(null, 'balanced')).toBe('gemini-3.1-pro-low');

    expect(resolveChunkSizeWords({ preset: 'optimal' })).toBe(500000);
    expect(resolveChunkSizeWords({ preset: 'custom', customWords: 12345 })).toBe(12345);

    expect(normalizeParallelChunks(0)).toBe(1);
    expect(normalizeParallelChunks(8)).toBe(8);
    expect(normalizeParallelChunks(999)).toBe(20);
  });

  it('calculates new chunk counts and analysis time estimates', () => {
    const chunkStats = calculateNewChunks(1_500_000, 500_000, 3000);

    expect(chunkStats).toEqual(
      expect.objectContaining({
        originalChunkCount: 3000,
        newChunkCount: 3,
        wordsPerChunk: 500000,
      }),
    );

    const partsPerChunk = getPartsPerChunk('gemini-3.1-pro-high');
    const estimate = estimateAnalysisTime(chunkStats.newChunkCount, partsPerChunk, 6);

    expect(estimate.totalOutputs).toBe(9);
    expect(estimate.batches).toBe(2);
    expect(estimate.estimatedMinutes).toBeGreaterThan(0);
  });

  it('validates chunk size against model limits', () => {
    const valid = validateChunkSize(500000, 'gemini-3.1-pro-high');
    expect(valid.valid).toBe(true);
    expect(valid.warning).toBeNull();

    const warning = validateChunkSize(660000, 'gemini-3.1-pro-high');
    expect(warning.valid).toBe(true);
    expect(warning.severity).toBe('warning');

    const tooLarge = validateChunkSize(700000, 'gemini-3.1-pro-high');
    expect(tooLarge.valid).toBe(false);
    expect(tooLarge.severity).toBe('error');

    const tooSmall = validateChunkSize(500, 'gemini-3.1-pro-high');
    expect(tooSmall.valid).toBe(false);
    expect(tooSmall.warning).toMatch(/Chunk qu(?:a|á) nh(?:o|ỏ)/u);

    expect(getContextLimits('gemini-unknown').label).toContain('Gemini 3.1 Pro High');
  });

  it('re-chunks chapters into contiguous chunk rows with start positions', () => {
    const chapters = [
      {
        id: 'ch-1',
        content: 'alpha '.repeat(700),
      },
      {
        id: 'ch-2',
        content: 'beta '.repeat(650),
      },
    ];

    const rows = createRechunkRows({
      corpusId: 'corpus-1',
      chapters,
      chunkSizeWords: 500,
      preserveParagraphs: false,
    });

    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((row) => row.corpusId === 'corpus-1')).toBe(true);
    expect(rows.every((row) => row.wordCount > 0)).toBe(true);

    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index].startPosition).toBeGreaterThanOrEqual(rows[index - 1].startPosition);
    }
  });
});
