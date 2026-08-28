import { z } from 'zod';
import { LITERARY_CRITERIA, REVIEW_LIMITS, SIGNAL_CRITERIA } from './constants.js';
import { resolveSnapshotEvidence } from './snapshot.js';

const text = z.string().max(1600);
const evidenceSchema = z.object({ paragraph_id: z.string().max(32), quote: z.string().min(1).max(1000), prefix: z.string().max(80).optional(), suffix: z.string().max(80).optional() }).strict();
const evidenceList = z.array(evidenceSchema).max(3);
const findingSchema = z.object({ criterion_id: z.string().min(1).max(100), severity: z.enum(['low', 'medium', 'high']), explanation: text, suggestion: text, confidence: z.number().min(0).max(1), evidence: evidenceList }).strict();
const common = { summary: text, findings: z.array(findingSchema).max(6) };
const schemas = {
  signals: z.object({ ...common, signal_level: z.enum(['none', 'low', 'medium', 'high', 'insufficient_context']) }).strict(),
  adherence: z.object({ ...common, criteria: z.array(z.object({ criterion_id: z.string(), status: z.enum(['met', 'partial', 'violated', 'not_observable', 'conflict']), reason: text, evidence: evidenceList }).strict()).max(REVIEW_LIMITS.requirements) }).strict(),
  literary: z.object({ ...common, scores: z.array(z.object({ criterion_id: z.string(), score: z.number().int().min(1).max(5).nullable(), strength: text.nullable(), limitation: text, evidence: evidenceList, confidence: z.number().min(0).max(1) }).strict()).length(7) }).strict(),
};

export function getReviewResponseSchema(mode, contract = { requirements: [] }) {
  if (!schemas[mode]) throw new Error('Phần phân tích không hợp lệ.');
  const ids = mode === 'adherence' ? contract.requirements.map((item) => item.id)
    : mode === 'literary' ? LITERARY_CRITERIA.map((item) => item.id) : Object.keys(SIGNAL_CRITERIA);
  const criterion_id = ids.length ? z.enum(ids) : z.never();
  const fields = { findings: z.array(findingSchema.extend({ criterion_id })).max(6) };
  if (mode === 'adherence') fields.criteria = z.array(schemas.adherence.shape.criteria.element.extend({ criterion_id })).length(ids.length);
  if (mode === 'literary') fields.scores = z.array(schemas.literary.shape.scores.element.extend({ criterion_id })).length(7);
  return schemas[mode].extend(fields);
}

export function getReviewJsonSchema(mode, contract) {
  return z.toJSONSchema(getReviewResponseSchema(mode, contract));
}

function assertCriteria(items, expected) {
  const ids = items.map((item) => item.criterion_id);
  if (ids.length !== expected.length || new Set(ids).size !== ids.length || expected.some((id) => !ids.includes(id))) {
    throw new Error('AI trả thiếu, trùng hoặc sai tiêu chí. Hãy thử lại phần phân tích này.');
  }
}

function containsAuthorshipClaim(raw) {
  // A character's quoted words are evidence, not a claim by the evaluator.
  if (Array.isArray(raw)) return raw.some(containsAuthorshipClaim);
  if (raw && typeof raw === 'object') return Object.entries(raw).some(([key, value]) => key !== 'evidence' && containsAuthorshipClaim(value));
  if (typeof raw !== 'string') return false;
  const normalized = raw.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gu, 'd').toLowerCase();
  if (/\d+(?:[.,]\d+)?\s*%[^.!?]{0,60}\b(?:ai|nguoi viet|human)\b/u.test(normalized)) return true;
  return normalized.split(/[.!?;\n]|\b(?:nhung|tuy nhien|but|however)\b/u).some((clause) => {
    const origin = /\b(?:(?:do|boi)\s+(?:ai|nguoi(?:\s+that)?)\s+(?:viet|tao|sang tac)|ai\s+(?:da\s+)?(?:viet|tao ra|sang tac)|(?:ai|human)[ -](?:generated|written|authored)|(?:written|generated|authored)\s+by\s+(?:an?\s+)?(?:ai|human)|(?:xac suat|chac chan|ket luan|ro rang)[^.!?]{0,80}\b(?:ai|nguoi viet|human)\b)\b/gu;
    return [...clause.matchAll(origin)].some((match) => {
      const before = clause.slice(0, match.index);
      const throughClaim = clause.slice(0, match.index + match[0].length);
      return !/\b(?:khong(?: the)? (?:ket luan|xac dinh|suy ra)|chua (?:the|du can cu)|cannot (?:conclude|determine|infer)|does not (?:mean|prove))\b/u.test(throughClaim)
        && !/\b(?:not|khong phai)\s*$/u.test(before);
    });
  });
}

export function parseReviewResult(rawText, { mode, snapshot, contract = { requirements: [] } }) {
  if (rawText.length > REVIEW_LIMITS.outputCharacters) throw new Error('Phản hồi AI vượt giới hạn cho phép.');
  // Strip an optional outer wrapper only; fences inside quoted manuscript data are literal.
  let value;
  try { value = JSON.parse(rawText.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/iu, '$1')); }
  catch { throw new Error('AI trả JSON không hợp lệ. Hãy thử lại phần này.'); }
  const parsed = getReviewResponseSchema(mode, contract).safeParse(value);
  if (!parsed?.success) throw new Error('AI trả sai định dạng hoặc vượt giới hạn sáu nhận xét. Hãy thử lại phần này.');
  const raw = parsed.data;
  if (containsAuthorshipClaim(raw)) throw new Error('AI đã kết luận nguồn gốc tác giả trái yêu cầu. Báo cáo này không được sử dụng.');
  let rejectedEvidence = 0;
  const ground = (items) => items.flatMap((item) => {
    const match = resolveSnapshotEvidence(snapshot, item);
    if (!match) rejectedEvidence++;
    return match ? [match] : [];
  });
  const groups = new Map();
  for (const finding of raw.findings) {
    const evidence = ground(finding.evidence);
    if (!evidence.length) continue;
    const key = `${finding.criterion_id}:${finding.explanation.trim()}`;
    const existing = groups.get(key);
    if (existing) {
      const seen = new Set(existing.evidence.map((item) => `${item.from}:${item.to}`));
      existing.evidence = [...existing.evidence, ...evidence.filter((item) => !seen.has(`${item.from}:${item.to}`))].slice(0, 3);
    } else groups.set(key, { ...finding, id: `finding-${groups.size + 1}`, evidence });
  }
  const result = { ...raw, findings: [...groups.values()], score: null };
  if (mode === 'adherence') {
    assertCriteria(raw.criteria, contract.requirements.map((item) => item.id));
    result.criteria = raw.criteria.map((item) => {
      const evidence = ground(item.evidence);
      const unsupported = ['met', 'partial', 'violated'].includes(item.status) && !evidence.length;
      return { ...item, evidence, status: unsupported ? 'not_observable' : item.status,
        reason: unsupported ? 'Không xác minh được bằng chứng cho tiêu chí này.' : item.reason };
    });
    const observed = result.criteria.filter((item) => ['met', 'partial', 'violated'].includes(item.status));
    result.findings = result.findings.filter((item) => observed.some((criterion) => criterion.criterion_id === item.criterion_id && criterion.status !== 'met'));
    result.coverage = { observed: observed.length, total: result.criteria.length };
    result.score = observed.length ? Math.round(100 * observed.reduce((sum, item) => sum + ({ met: 1, partial: 0.5, violated: 0 }[item.status]), 0) / observed.length) : null;
  }
  if (mode === 'literary') {
    assertCriteria(raw.scores, LITERARY_CRITERIA.map((item) => item.id));
    result.scores = raw.scores.map((item) => {
      const evidence = ground(item.evidence);
      const unsupported = item.score !== null && !evidence.length;
      return { ...item, evidence, score: unsupported ? null : item.score,
        limitation: unsupported ? 'Không xác minh được bằng chứng; chưa chấm tiêu chí này.' : item.limitation };
    });
    const applicable = result.scores.filter((item) => item.score !== null);
    result.findings = result.findings.filter((item) => applicable.some((criterion) => criterion.criterion_id === item.criterion_id));
    const weightOf = (item) => LITERARY_CRITERIA.find((criterion) => criterion.id === item.criterion_id).weight;
    const weight = applicable.reduce((sum, item) => sum + weightOf(item), 0);
    result.coverage = { observed: applicable.length, total: 7, weight };
    if (applicable.length >= 3 && weight >= 50) result.score = Math.round(20 * applicable.reduce((sum, item) => sum + item.score * weightOf(item), 0) / weight);
  }
  if (mode === 'signals' && !result.findings.length && !['none', 'insufficient_context'].includes(result.signal_level)) result.signal_level = 'insufficient_context';
  return { ...result, rejected_evidence: rejectedEvidence };
}
