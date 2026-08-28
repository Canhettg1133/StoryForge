import { describe, expect, it } from 'vitest';
import { buildReviewContract } from '../../features/manuscriptReview/contract.js';
import { parseReviewResult } from '../../features/manuscriptReview/results.js';
import { LITERARY_CRITERIA } from '../../features/manuscriptReview/constants.js';

const snapshot = { paragraphs: [{ id: 'p1', text: 'Mưa gõ mái hiên.', runs: [{ offset: 0, length: 15, from: 1 }] }] };
const evidence = { paragraph_id: 'p1', quote: 'Mưa' };
const finding = { criterion_id: 'repetition', severity: 'low', explanation: 'Một mô-típ.', suggestion: 'Cân nhắc mục đích lặp.', confidence: 0.7, evidence: [evidence] };

describe('review contract and scoring', () => {
  it('keeps author rules traceable and groups the phrase blacklist', () => {
    const contract = buildReviewContract({ project: { ai_guidelines: 'Chậm.\nGiữ POV.', prompt_templates: JSON.stringify({ style_dna: ['Lạnh.'], anti_ai_blacklist: ['cụm một', 'cụm hai'] }) }, authorRequest: 'Đây là cảnh nghỉ.' });
    expect(contract.requirements.map((item) => item.source)).toContain('author_request');
    expect(contract.requirements.filter((item) => item.source === 'anti_ai_blacklist')).toHaveLength(1);
    expect(new Set(contract.requirements.map((item) => item.id)).size).toBe(contract.requirements.length);
  });

  it('excludes conflict/unobservable requirements and computes coverage itself', () => {
    const contract = { requirements: ['a', 'b', 'c', 'd'].map((id) => ({ id })) };
    const result = parseReviewResult(JSON.stringify({ summary: 'Nhận xét.', findings: [], criteria: [
      { criterion_id: 'a', status: 'met', reason: 'Đạt.', evidence: [evidence] },
      { criterion_id: 'b', status: 'partial', reason: 'Một phần.', evidence: [evidence] },
      { criterion_id: 'c', status: 'conflict', reason: 'Yêu cầu mâu thuẫn.', evidence: [] },
      { criterion_id: 'd', status: 'not_observable', reason: 'Thiếu dữ liệu.', evidence: [] },
    ] }), { mode: 'adherence', snapshot, contract });
    expect(result.score).toBe(75);
    expect(result.coverage).toEqual({ observed: 2, total: 4 });
  });

  it('requires every supplied requirement exactly once', () => {
    expect(() => parseReviewResult(JSON.stringify({ summary: 'Thiếu.', findings: [], criteria: [] }), {
      mode: 'adherence', snapshot, contract: { requirements: [{ id: 'a' }] },
    })).toThrow();
  });

  it('calculates literary score with N/A and suppresses unsupported scores', () => {
    const scores = LITERARY_CRITERIA.map((criterion) => ({ criterion_id: criterion.id, score: criterion.id === 'dialogue' ? null : 4,
      strength: 'Có hiệu quả.', limitation: 'Có thể tiết chế.', evidence: criterion.id === 'dialogue' ? [] : [evidence], confidence: 0.7 }));
    const run = (items) => parseReviewResult(JSON.stringify({ summary: 'Có kiểm soát.', findings: [], scores: items }), { mode: 'literary', snapshot, contract: { requirements: [] } });
    expect(run(scores).score).toBe(80);
    const unsupported = scores.map((item) => ({ ...item, evidence: [{ paragraph_id: 'p1', quote: 'Không tồn tại' }] }));
    expect(run(unsupported).score).toBeNull();
    expect(run(unsupported).scores.every((item) => item.score === null)).toBe(true);
    expect(run(scores.map((item, index) => ({ ...item, score: index < 2 ? 4 : null }))).score).toBeNull();
  });

  it('drops invented evidence, merges identical findings and never accepts more than six', () => {
    const run = (findings) => parseReviewResult(JSON.stringify({ summary: 'Tín hiệu.', signal_level: 'low', findings }), { mode: 'signals', snapshot, contract: { requirements: [] } });
    expect(run([finding, finding]).findings).toHaveLength(1);
    expect(run([{ ...finding, evidence: [{ paragraph_id: 'p9', quote: 'Mưa' }] }]).findings).toHaveLength(0);
    expect(run([{ ...finding, evidence: [{ paragraph_id: 'p9', quote: 'Mưa' }] }]).signal_level).toBe('insufficient_context');
    expect(() => run(Array(7).fill(finding))).toThrow();
    expect(() => run([{ ...finding, confidence: 2 }])).toThrow();
  });

  it('rejects authorship probabilities and invalid JSON instead of fabricating a report', () => {
    expect(() => parseReviewResult('{broken', { mode: 'signals', snapshot })).toThrow();
    expect(() => parseReviewResult(JSON.stringify({ summary: '87% do AI viết.', signal_level: 'high', findings: [] }), { mode: 'signals', snapshot })).toThrow();
    expect(() => parseReviewResult(JSON.stringify({ summary: 'Nhận xét.', signal_level: 'low', findings: [], ai_probability: 0.87 }), { mode: 'signals', snapshot })).toThrow();
  });

  it('rejects unknown finding criteria and does not penalize conflicting requirements', () => {
    expect(() => parseReviewResult(JSON.stringify({ summary: 'Nhận xét.', signal_level: 'low', findings: [{ ...finding, criterion_id: 'fake' }] }), { mode: 'signals', snapshot })).toThrow();
    const result = parseReviewResult(JSON.stringify({ summary: 'Yêu cầu xung đột.', findings: [{ ...finding, criterion_id: 'a' }],
      criteria: [{ criterion_id: 'a', status: 'conflict', reason: 'Mâu thuẫn với b.', evidence: [] }],
    }), { mode: 'adherence', snapshot, contract: { requirements: [{ id: 'a' }] } });
    expect(result.score).toBeNull();
    expect(result.findings).toHaveLength(0);
  });

  it('does not mistake quoted manuscript content for an evaluator authorship claim', () => {
    const text = '87% do AI viết.';
    const quotedSnapshot = { paragraphs: [{ id: 'p1', text, runs: [{ offset: 0, from: 1, length: text.length }] }] };
    const raw = JSON.stringify({ summary: 'Đây là lời nhân vật, không xác định tác giả.', signal_level: 'low', findings: [{ ...finding, evidence: [{ paragraph_id: 'p1', quote: text }] }] });
    expect(parseReviewResult(raw, { mode: 'signals', snapshot: quotedSnapshot }).findings).toHaveLength(1);
  });
});
