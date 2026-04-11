import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYSIS_CONFIG,
  ANALYSIS_MODELS,
  resolveAnalysisConfig,
  resolveLayers,
} from '../../services/analysis/analysisConfig.js';
import { buildComprehensivePrompt } from '../../services/analysis/prompts/comprehensivePrompt.js';
import {
  mergeOutputParts,
  shouldContinueOutput,
  splitLayerResults,
} from '../../services/analysis/outputChunker.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Phase 3 - Analysis Engine', () => {
  it('resolves analysis config with defaults and clamped values', () => {
    const resolved = resolveAnalysisConfig({
      provider: 'gemini_proxy',
      model: ANALYSIS_MODELS.context_pro,
      chunkSize: 999999,
      chunkOverlap: 999999,
      temperature: 2,
      layers: ['L1', 'l2', 'invalid'],
      maxParts: 99,
    });

    expect(resolved.provider).toBe('gemini_proxy');
    expect(resolved.model).toBe(ANALYSIS_MODELS.context_pro);
    expect(resolved.chunkSize).toBe(ANALYSIS_CONFIG.session.maxInputWords);
    expect(resolved.chunkOverlap).toBeLessThanOrEqual(Math.floor(resolved.chunkSize / 2));
    expect(resolved.temperature).toBe(1);
    expect(resolved.layers).toEqual(['l1', 'l2']);
    expect(resolved.maxParts).toBe(12);

    expect(resolveLayers([])).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
  });

  it('builds a comprehensive prompt covering selected layers', () => {
    const prompt = buildComprehensivePrompt({
      layers: ['l1', 'l3', 'l6'],
    });

    expect(prompt).toContain('Ban la engine phan tich truyen chuyen nghiep.');
    expect(prompt).toContain('L1 structural');
    expect(prompt).toContain('L3 worldbuilding');
    expect(prompt).toContain('L6 craft');
    expect(prompt).toContain('Tra ve JSON theo schema nay');
    expect(prompt).toContain('"meta"');
  });

  it('decides continuation based on finish reason or hasMore flag', () => {
    expect(shouldContinueOutput({ text: '{"meta":{"hasMore":true}}' })).toBe(true);
    expect(shouldContinueOutput({ text: '{"meta":{"complete":true,"hasMore":false}}' })).toBe(false);
    expect(shouldContinueOutput({ text: '{"ok":true}', finishReason: 'MAX_TOKENS' })).toBe(true);
  });

  it('merges multiple output parts and splits L1-L6 payloads', () => {
    const merged = mergeOutputParts([
      JSON.stringify({
        meta: { part: 1, hasMore: true, complete: false },
        structural: { characters: [{ name: 'Harry' }] },
        events: { majorEvents: [{ id: 'evt-1' }] },
      }),
      JSON.stringify({
        meta: { part: 2, hasMore: false, complete: true },
        relationships: { ships: [{ id: 'ship-1' }] },
        craft: { style: { pov: 'third' } },
      }),
    ]);

    expect(merged.meta.complete).toBe(true);
    expect(merged.meta.hasMore).toBe(false);
    expect(merged.structural.characters).toHaveLength(1);
    expect(merged.events.majorEvents).toHaveLength(1);
    expect(merged.relationships.ships).toHaveLength(1);

    const layers = splitLayerResults(merged);
    expect(layers.resultL1).toContain('Harry');
    expect(layers.resultL2).toContain('evt-1');
    expect(layers.resultL5).toContain('ship-1');
    expect(layers.resultL6).toContain('third');
  });

  it('builds session input limited by max words', async () => {
    const { buildCorpusSessionInput } = await import('../../services/analysis/sessionAnalyzer.js');
    const chunks = [
      { id: '1', text: 'alpha '.repeat(600), wordCount: 600 },
      { id: '2', text: 'beta '.repeat(500), wordCount: 500 },
      { id: '3', text: 'gamma '.repeat(300), wordCount: 300 },
    ];

    const input = buildCorpusSessionInput(chunks, 320);

    // Implementation clamps maxWords to a minimum of 1000.
    expect(input.wordCount).toBeLessThanOrEqual(1000);
    expect(input.chunks.length).toBe(1);
    expect(input.text).toContain('alpha');
    expect(input.text).not.toContain('beta beta');
  });

  it('splits corpus into multiple sessions and covers all chunks', async () => {
    const { buildCorpusSessionInputs } = await import('../../services/analysis/sessionAnalyzer.js');
    const chunks = [
      { id: '1', text: 'alpha '.repeat(600), wordCount: 600 },
      { id: '2', text: 'beta '.repeat(500), wordCount: 500 },
      { id: '3', text: 'gamma '.repeat(450), wordCount: 450 },
    ];

    const sessions = buildCorpusSessionInputs(chunks, 1000);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].chunks).toHaveLength(1);
    expect(sessions[1].chunks).toHaveLength(2);
    expect(sessions[0].wordCount + sessions[1].wordCount).toBe(1550);
  });

  it('auto-continues and merges parts in session analyzer (mocked client)', async () => {
    vi.doMock('../../services/analysis/sessionClient.js', () => {
      class MockSessionClient {
        constructor() {
          this.continueCount = 0;
        }

        async startSession() {
          return {
            text: JSON.stringify({
              meta: { part: 1, hasMore: true, complete: false },
              structural: { characters: [{ name: 'A' }] },
            }),
            finishReason: 'STOP',
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
          };
        }

        async continueSession() {
          this.continueCount += 1;
          return {
            text: JSON.stringify({
              meta: { part: 2, hasMore: false, complete: true },
              events: { majorEvents: [{ id: 'evt-2' }] },
            }),
            finishReason: 'STOP',
            usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 21, totalTokenCount: 32 },
          };
        }

        endSession() {}
      }

      return {
        SessionClient: MockSessionClient,
        default: MockSessionClient,
      };
    });

    const { analyzeWithSession } = await import('../../services/analysis/sessionAnalyzer.js');

    const progressEvents = [];
    const partEvents = [];

    const result = await analyzeWithSession({
      text: 'mock corpus text',
      layers: ['l1', 'l2'],
      config: {
        provider: 'gemini_proxy',
        model: ANALYSIS_MODELS.context_pro,
        apiKey: 'fake-key',
        maxParts: 4,
        temperature: 0.2,
      },
      onProgress: (event) => progressEvents.push(event),
      onPart: (event) => partEvents.push(event),
    });

    expect(result.parts).toHaveLength(2);
    expect(result.merged.structural.characters).toHaveLength(1);
    expect(result.merged.events.majorEvents).toHaveLength(1);
    expect(result.tokenUsage.totalTokenCount).toBe(62);

    expect(progressEvents.length).toBeGreaterThan(1);
    expect(partEvents).toHaveLength(2);
    expect(partEvents[0].hasMore).toBe(true);
    expect(partEvents[1].hasMore).toBe(false);
  });
});
