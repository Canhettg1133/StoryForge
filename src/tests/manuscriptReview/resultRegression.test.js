import { describe, expect, it } from 'vitest';
import { parseReviewResult } from '../../features/manuscriptReview/results.js';
import { LITERARY_CRITERIA } from '../../features/manuscriptReview/constants.js';

const text = 'Mưa gõ mái hiên.';
const snapshot = { paragraphs: [{ id: 'p1', text, runs: [{ offset: 0, from: 1, length: text.length }] }] };
const signals = (summary) => JSON.stringify({ summary, signal_level: 'none', findings: [] });

describe('review parser regressions against valid and prohibited evaluator output', () => {
  it.each(['Văn bản này do AI viết.', 'This passage is AI-generated.', 'Chắc chắn AI đã viết đoạn này.'])('rejects an origin claim without a percentage: %s', (summary) => {
    expect(() => parseReviewResult(signals(summary), { mode: 'signals', snapshot })).toThrow(/nguồn gốc/u);
  });

  it('does not reject an explicit disclaimer as an authorship conclusion', () => {
    const summary = 'Không thể kết luận văn bản do AI viết. Chỉ đánh giá dấu hiệu văn phong.';
    expect(parseReviewResult(signals(summary), { mode: 'signals', snapshot }).summary).toBe(summary);
  });

  it.each([false, true])('preserves literal Markdown code fences inside evidence (outer fenced JSON: %s)', (fenced) => {
    const quote = 'Cô gõ ```json vào cửa sổ rồi dừng lại.';
    const input = { paragraphs: [{ id: 'p1', text: quote, runs: [{ offset: 0, from: 1, length: quote.length }] }] };
    const raw = JSON.stringify({ summary: 'Một chi tiết cụ thể.', signal_level: 'low', findings: [{ criterion_id: 'repetition', severity: 'low', explanation: 'Cân nhắc nhịp.', suggestion: 'Đọc lại trong cảnh.', confidence: 0.7, evidence: [{ paragraph_id: 'p1', quote }] }] });
    const result = parseReviewResult(fenced ? `\`\`\`json\n${raw}\n\`\`\`` : raw, { mode: 'signals', snapshot: input });
    expect(result.rejected_evidence).toBe(0);
    expect(result.findings[0]?.evidence[0].quote).toBe(quote);
  });

  it('accepts an absent strength without inventing praise or scoring an N/A criterion', () => {
    const scores = LITERARY_CRITERIA.map(({ id }) => ({ criterion_id: id, score: id === 'dialogue' ? null : 2,
      strength: null, limitation: 'Chưa có điểm mạnh đủ căn cứ.', confidence: 0.8, evidence: id === 'dialogue' ? [] : [{ paragraph_id: 'p1', quote: text }] }));
    const findings = [{ criterion_id: 'dialogue', severity: 'high', explanation: 'Yêu cầu thoại mâu thuẫn.', suggestion: 'Làm rõ yêu cầu.', confidence: 1, evidence: [{ paragraph_id: 'p1', quote: text }] }];
    const result = parseReviewResult(JSON.stringify({ summary: 'Cần biên tập.', scores, findings }), { mode: 'literary', snapshot });
    expect(result.score).toBe(40);
    expect(result.findings).toHaveLength(0);
    expect(result.scores.find((item) => item.criterion_id === 'dialogue').score).toBeNull();
  });

  it('does not turn a met requirement into a priority to fix', () => {
    const result = parseReviewResult(JSON.stringify({ summary: 'Đạt yêu cầu.', criteria: [{ criterion_id: 'a', status: 'met', reason: 'Đạt.', evidence: [{ paragraph_id: 'p1', quote: text }] }],
      findings: [{ criterion_id: 'a', severity: 'low', explanation: 'Tuân thủ tốt.', suggestion: 'Tiếp tục phát huy.', confidence: 1, evidence: [{ paragraph_id: 'p1', quote: text }] }],
    }), { mode: 'adherence', snapshot, contract: { requirements: [{ id: 'a' }] } });
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  it('drops a finding with no evidence instead of rejecting the otherwise valid pass', () => {
    const finding = { criterion_id: 'dialogue', severity: 'high', explanation: 'Không có thoại.', suggestion: 'Xem lại yêu cầu.', confidence: 1, evidence: [] };
    const scores = LITERARY_CRITERIA.map(({ id }) => ({ criterion_id: id, score: id === 'dialogue' ? null : 3,
      strength: null, limitation: 'Nhận xét có căn cứ.', confidence: 0.8, evidence: id === 'dialogue' ? [] : [{ paragraph_id: 'p1', quote: text }] }));
    const result = parseReviewResult(JSON.stringify({ summary: 'Đánh giá hợp lệ.', scores, findings: [finding] }), { mode: 'literary', snapshot });
    expect(result.score).toBe(60);
    expect(result.findings).toEqual([]);
  });
});
