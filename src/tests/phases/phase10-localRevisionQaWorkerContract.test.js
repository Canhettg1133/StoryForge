import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { analyzeLocalManuscript } from '../../services/revisionQa/localAnalysis.js';

describe('local Revision QA Worker contract', () => {
  it('exposes the pure analyzer through Comlink and contains no network API', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/revisionQa/localAnalysisWorker.js'), 'utf8');
    expect(source).toContain("expose({ analyze: analyzeLocalManuscript })");
    expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/u);
  });

  it('analyzes without invoking fetch even when fetch exists in the worker-like global', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network forbidden')));
    globalThis.fetch = fetchSpy;
    try {
      const result = await analyzeLocalManuscript({
        sources: [{ projectId: 1, chapterId: 11, sceneId: 101, text: 'Mai đi  rồi.', sourceText: 'Mai đi  rồi.', offsetBase: 0 }],
        scope: 'scene',
        profile: 'overview',
        phraseConfig: { blacklist: [], whitelist: [] },
      });
      expect(result.findings.some((finding) => finding.rule_id === 'MULTIPLE_SPACES')).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
