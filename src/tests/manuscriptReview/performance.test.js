import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createManuscriptSnapshot, hashReviewValue } from '../../features/manuscriptReview/snapshot.js';
import { parseReviewResult } from '../../features/manuscriptReview/results.js';
import { buildReviewContract } from '../../features/manuscriptReview/contract.js';
import { buildReviewMessages } from '../../features/manuscriptReview/prompts.js';
import { estimateTokens } from '../../services/labLite/tokenEstimator.js';

afterEach(() => vi.unstubAllGlobals());

it.each([3000, 10000])('measures preparation/validation of %i words (Node/jsdom, not device/browser evidence)', async (words) => {
  vi.stubGlobal('crypto', webcrypto);
  const base = 'Mưa rơi qua mái hiên. Lan khép cửa rồi ngồi.'.split(' ');
  const content = Array.from({ length: words / 100 }, (_item, index) => ({ type: 'paragraph', content: [{ type: 'text',
    text: Array.from({ length: 100 }, (_word, offset) => offset === 0 ? `Mốc-${index}` : base[offset % base.length]).join(' '),
  }] }));
  const editor = new Editor({ extensions: [StarterKit], content: { type: 'doc', content } });
  try {
    const samples = { snapshot: [], prompt: [], validate: [], sha256: [] };
    for (let index = 0; index < 35; index++) {
      let start = performance.now();
      const snapshot = createManuscriptSnapshot(editor, { project: { id: 1 }, scene: { id: 2 } });
      const snapshotMs = performance.now() - start;
      start = performance.now();
      const contract = buildReviewContract();
      const messages = buildReviewMessages({ snapshot, contract, mode: 'signals' });
      const tokens = estimateTokens(messages.map((item) => item.content).join('\n'));
      const promptMs = performance.now() - start;
      const findings = Array.from({ length: 6 }, (_item, number) => ({ criterion_id: 'repetition', severity: 'low', explanation: `Nhóm ${number}`, suggestion: 'Cân nhắc nhịp.', confidence: 0.7,
        evidence: [0, 1, 2].map((offset) => ({ paragraph_id: `p${number * 3 + offset + 1}`, quote: `Mốc-${number * 3 + offset}` })),
      }));
      const raw = JSON.stringify({ summary: 'Dữ liệu benchmark tổng hợp.', signal_level: 'low', findings });
      start = performance.now();
      const result = parseReviewResult(raw, { mode: 'signals', snapshot, contract });
      const validateMs = performance.now() - start;
      start = performance.now(); await hashReviewValue(snapshot.paragraphs.map((item) => item.text)); const hashMs = performance.now() - start;
      expect(result.findings).toHaveLength(6); expect(tokens).toBeGreaterThan(0);
      expect(snapshot.text.split(/\s+/u)).toHaveLength(words);
      if (index >= 5) { samples.snapshot.push(snapshotMs); samples.prompt.push(promptMs); samples.validate.push(validateMs); samples.sha256.push(hashMs); }
    }
    const measurements = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
      values.sort((a, b) => a - b);
      return [name, { medianMs: Number(values[15].toFixed(3)), p95Ms: Number(values[28].toFixed(3)) }];
    }));
    console.info('MANUSCRIPT_REVIEW_BENCHMARK', JSON.stringify({ words, runtime: process.version, environment: 'Node + jsdom; no provider; no browser layout', measurements }));
  } finally { editor.destroy(); }
});
