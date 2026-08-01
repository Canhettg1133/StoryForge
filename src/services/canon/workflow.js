import db, { scheduleBackgroundCanonRebuild } from '../db/database';
import aiService from '../ai/client';
import { buildPrompt } from '../ai/promptBuilder';
import { TASK_TYPES } from '../ai/router';
import { parseAIJsonValue } from '../../utils/aiJson';
import {
  CANON_OP_TYPES,
  CANON_SEVERITY,
  CHAPTER_COMMIT_STATUS,
  CHAPTER_REVISION_STATUS,
} from './constants';
import {
  createReport,
  getChapterAndProject,
  getChapterScenes,
  getOrCreateChapterCommit,
  loadPreChapterTruth,
  loadRevisionOps,
  replaceValidatorReports,
  updateChapterCommitSummary,
} from './core';
import { dedupeCandidateOps, mapAiOpsToCandidateOpsDetailed } from './opMapping';
import { invalidateFromChapter, rebuildCanonFromChapter } from './projection';
import { buildCharacterStateSummary, buildRelationshipPairKey } from './state';
import {
  filterCommitReadyOps,
  reportsHaveErrors,
  validateCandidateOps,
  validateDraftTextAgainstTruth,
  validateGeneratedProseDiscipline,
} from './validation';
import { resolveCanonFactRegistration } from '../entityIdentity/factIdentity.js';
import { assertCanonRunAllowed } from './runLock.js';
import {
  buildCanonChapterTextFromScenes,
  buildCanonContentSignature,
  cleanText,
  normalizeKey,
} from './utils';

function normalizeAiOpsResponse(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.ops)) return parsed.ops;
  return null;
}

const RETRYABLE_CANON_EXTRACTION_RULES = new Set([
  'CANON_OP_MISSING_REFERENCE_FILTERED',
  'CANON_OP_UNSUPPORTED_TYPE_FILTERED',
  'CANON_EVIDENCE_NOT_GROUNDED',
  'INVALID_CANON_OP_PAYLOAD',
  'LOW_CONFIDENCE_CANON_OP_FILTERED',
]);

function shouldRetryCanonExtraction({ extractedCount, committedCount, reports = [] }) {
  return extractedCount > 0
    && committedCount === 0
    && reports.some((report) => RETRYABLE_CANON_EXTRACTION_RULES.has(report.rule_code));
}

function buildCanonExtractionRetryMessage(reports = []) {
  const reportLines = reports.slice(0, 12).map((report, index) => {
    const evidence = cleanText(report.evidence || '');
    return [
      `${index + 1}. [${report.rule_code || 'CANON_INVALID'}] ${cleanText(report.message || '')}`,
      evidence ? `Evidence đã trả: ${evidence}` : '',
    ].filter(Boolean).join('\n');
  });
  return {
    role: 'user',
    content: [
      '[SỬA PHẢN HỒI CANON LẦN TRƯỚC]',
      'Phản hồi trước không có operation nào đủ điều kiện commit vì các lỗi dưới đây:',
      ...reportLines,
      '',
      'Hãy đọc lại DANH SÁCH CẢNH và toàn bộ roster trong prompt gốc, rồi trả lại TOÀN BỘ object {"ops":[...]} đã sửa.',
      'Evidence phải là một đoạn nguyên văn liên tục trong đúng scene_index; không nối các câu rời bằng dấu ba chấm.',
      'Tên nhân vật, địa điểm, vật phẩm và tuyến truyện phải dùng đúng tên hoặc alias có trong roster. Thông tin như địa chỉ/tên người không được biến thành vật phẩm.',
      'Nếu sau khi đọc lại thực sự không có thay đổi canon, trả chính xác {"ops":[]}. Chỉ trả JSON, không giải thích.',
    ].join('\n'),
  };
}

const SUPERSEDED_CANON_SUGGESTION_TYPES = new Set([
  'canon_op_review',
  'character_status',
  'canon_fact',
  'relationship_update',
]);

async function supersedeLegacyCanonSuggestions(projectId, chapterId) {
  const pending = await db.suggestions
    .where('project_id').equals(projectId)
    .filter((suggestion) => (
      suggestion.status === 'pending'
      && suggestion.source_chapter_id === chapterId
      && SUPERSEDED_CANON_SUGGESTION_TYPES.has(suggestion.type)
    ))
    .toArray();
  const now = Date.now();
  await Promise.all(pending.map((suggestion) => db.suggestions.update(suggestion.id, {
    status: 'superseded',
    superseded_at: now,
    last_error: '',
  })));
  return pending.length;
}

function sendAiTask(taskType, messages, options = {}) {
  return new Promise((resolve, reject) => {
    aiService.send({
      taskType,
      messages,
      stream: false,
      routeOptions: options.routeOptions,
      nsfwMode: options.nsfwMode,
      superNsfwMode: options.superNsfwMode,
      allowConcurrent: !!options.allowConcurrent,
      onComplete: (text) => resolve(text),
      onError: reject,
    });
  });
}

function buildCanonExtractError(error, rawText = '') {
  const rawMessage = cleanText(error?.message || '');
  const lowerMessage = rawMessage.toLowerCase();
  const baseMessage = lowerMessage.includes('no json found')
    ? 'AI không trả về JSON canon hợp lệ.'
    : lowerMessage.includes('incomplete json')
      ? 'JSON canon từ AI chưa hoàn chỉnh.'
      : lowerMessage.includes('malformed json')
        ? 'JSON canon từ AI sai cấu trúc.'
        : rawMessage || 'Không trích xuất được dữ liệu canon từ phản hồi AI.';
  const rawSnippet = cleanText(rawText).slice(0, 240);
  if (rawSnippet) {
    return new Error(`${baseMessage} | Phản hồi thô: ${rawSnippet}`);
  }
  return new Error(baseMessage);
}

async function rebuildCanonProjectionAfterCommit(projectId, chapterId) {
  try {
    const result = await rebuildCanonFromChapter(projectId, chapterId);
    await db.projects.update(projectId, {
      canon_rebuild_required: false,
      updated_at: Date.now(),
    });
    return result;
  } catch (error) {
    scheduleBackgroundCanonRebuild(db, { delayMs: 1000 });
    throw error;
  }
}

async function blockRevisionAfterProjectionFailure({
  projectId,
  chapterId,
  revisionId,
  reports = [],
  error,
}) {
  const projectionReport = createReport({
    severity: CANON_SEVERITY.ERROR,
    ruleCode: 'CANON_PROJECTION_REBUILD_FAILED',
    message: 'Đã lưu kết quả phân tích nhưng chưa dựng được trạng thái canon hiện tại. Hãy chạy lại phân tích chương.',
    projectId,
    chapterId,
    revisionId,
    evidence: cleanText(error?.message || String(error || '')),
  });
  const nextReports = [
    ...reports.filter((report) => report.rule_code !== projectionReport.rule_code),
    projectionReport,
  ];
  const revision = await db.chapter_revisions.get(revisionId);
  let validatorSummary = {};
  try {
    validatorSummary = JSON.parse(revision?.validator_summary || '{}');
  } catch {
    validatorSummary = {};
  }

  await replaceValidatorReports(projectId, revisionId, nextReports);
  await db.chapter_revisions.update(revisionId, {
    status: CHAPTER_REVISION_STATUS.BLOCKED,
    validator_summary: JSON.stringify({
      ...validatorSummary,
      warning_count: nextReports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
      error_count: nextReports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
    }),
    updated_at: Date.now(),
  });
  await updateChapterCommitSummary(
    projectId,
    chapterId,
    CHAPTER_COMMIT_STATUS.BLOCKED,
    nextReports,
    revisionId,
  );
  return nextReports;
}

function normalizeAdjudicationResponse(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.decisions)) return parsed.decisions;
  if (parsed && Array.isArray(parsed.reports)) return parsed.reports;
  return [];
}

function clampAdjudicationConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

const AI_ADJUDICATABLE_WARNING_RULES = new Set([
  'DEAD_CHARACTER_ACTIVE',
  'DRAFT_TOUCHES_HIDDEN_SECRET',
  'DRAFT_REFERENCES_SPENT_ITEM',
  'ITEM_REUSE_NEEDS_REVIEW',
  'ITEM_QUANTITY_NEEDS_REVIEW',
]);

const ITEM_ADJUDICATION_RULES = new Set([
  'DRAFT_REFERENCES_SPENT_ITEM',
  'ITEM_REUSE_NEEDS_REVIEW',
  'ITEM_QUANTITY_NEEDS_REVIEW',
]);

const SECRET_ADJUDICATION_RULES = new Set([
  'DRAFT_TOUCHES_HIDDEN_SECRET',
]);

function shouldAdjudicateWarning(report) {
  return report?.severity === CANON_SEVERITY.WARNING
    && AI_ADJUDICATABLE_WARNING_RULES.has(report.rule_code);
}

function buildSceneOrderMap(scenes = []) {
  return new Map((scenes || []).map((scene, index) => [scene.id, scene.order_index ?? index]));
}

function extractLocalContext(chapterText = '', evidence = '') {
  const text = String(chapterText || '');
  const cleanEvidence = cleanText(evidence);
  if (!text) return '';
  if (!cleanEvidence) return cleanText(text.slice(0, 1200));

  const exactIndex = text.toLowerCase().indexOf(cleanEvidence.toLowerCase());
  if (exactIndex >= 0) {
    return cleanText(text.slice(Math.max(0, exactIndex - 500), exactIndex + cleanEvidence.length + 500));
  }

  const normalizedText = normalizeKey(text);
  const normalizedEvidence = normalizeKey(cleanEvidence);
  const normalizedIndex = normalizedEvidence ? normalizedText.indexOf(normalizedEvidence.slice(0, 80)) : -1;
  if (normalizedIndex >= 0) {
    const ratio = text.length / Math.max(1, normalizedText.length);
    const approxIndex = Math.floor(normalizedIndex * ratio);
    return cleanText(text.slice(Math.max(0, approxIndex - 500), approxIndex + 700));
  }

  return cleanText(text.slice(0, 1200));
}

function pickRelevantItemsForReport(report, preTruth) {
  const haystack = normalizeKey(`${report.message || ''} ${report.evidence || ''}`);
  return (preTruth.objects || [])
    .filter((object) => normalizeKey(object.name) && haystack.includes(normalizeKey(object.name)))
    .slice(0, 8)
    .map((object) => {
      const state = (preTruth.itemStates || []).find((itemState) => itemState.object_id === object.id) || null;
      return {
        id: object.id,
        name: object.name || '',
        aliases: object.aliases || [],
        description: object.description || '',
        state: state ? {
          availability: state.availability || '',
          item_category: state.item_category || '',
          quantity_remaining: state.quantity_remaining ?? null,
          quantity_total: state.quantity_total ?? null,
          quantity_unit: state.quantity_unit || '',
          is_consumed: !!state.is_consumed,
          is_damaged: !!state.is_damaged,
          owner_character_id: state.owner_character_id || null,
          holder_character_id: state.holder_character_id || null,
          summary: state.summary || '',
        } : null,
      };
    });
}

function pickRelevantFactsForReport(report, preTruth) {
  const haystack = normalizeKey(`${report.message || ''} ${report.evidence || ''}`);
  return (preTruth.canonFacts || [])
    .filter((fact) => {
      const normalizedDescription = normalizeKey(fact.description || '');
      return normalizedDescription && haystack.includes(normalizedDescription);
    })
    .slice(0, 6)
    .map((fact) => ({
      id: fact.id,
      description: fact.description || '',
      fact_type: fact.fact_type || '',
      revealed_at_chapter: fact.revealed_at_chapter ?? null,
    }));
}

function pickRelevantCandidateOpsForReport(report, candidateOps, relatedItems, relatedFacts) {
  const itemIds = new Set(relatedItems.map((item) => item.id));
  const factIds = new Set(relatedFacts.map((fact) => fact.id));
  const reportText = normalizeKey(`${report.message || ''} ${report.evidence || ''}`);

  return (candidateOps || [])
    .filter((op) => {
      if (ITEM_ADJUDICATION_RULES.has(report.rule_code)) {
        if (itemIds.size > 0 && itemIds.has(op.object_id)) return true;
        if (normalizeKey(op.object_name || '') && reportText.includes(normalizeKey(op.object_name || ''))) return true;
        return false;
      }
      if (SECRET_ADJUDICATION_RULES.has(report.rule_code)) {
        if (factIds.size > 0 && factIds.has(op.fact_id)) return true;
        return [
          'SECRET_REVEALED',
          'FACT_REGISTERED',
        ].includes(String(op.op_type || ''));
      }
      return false;
    })
    .slice(0, 12)
    .map((op) => ({
      op_type: op.op_type,
      scene_id: op.scene_id || null,
      subject_name: op.subject_name || '',
      target_name: op.target_name || '',
      object_name: op.object_name || '',
      fact_description: op.fact_description || '',
      summary: op.summary || '',
      evidence: op.evidence || '',
      payload: op.payload || {},
    }));
}

function buildWarningAdjudicationMessages({
  project,
  chapter,
  revision,
  reports,
  candidateOps,
  preTruth,
}) {
  const warningPayload = reports.map((report, index) => {
    const relatedItems = pickRelevantItemsForReport(report, preTruth);
    const relatedFacts = pickRelevantFactsForReport(report, preTruth);
    return {
      warning_index: index,
      rule_code: report.rule_code || '',
      severity: report.severity || '',
      message: report.message || '',
      evidence: report.evidence || '',
      local_context: extractLocalContext(revision.chapter_text || '', report.evidence || report.message || ''),
      related_items: relatedItems,
      related_facts: relatedFacts,
      candidate_ops: pickRelevantCandidateOpsForReport(report, candidateOps, relatedItems, relatedFacts),
    };
  });

  return [
    {
      role: 'system',
      content: [
        'Bạn là bộ phận adjudication cho cảnh báo continuity/canon của StoryForge.',
        'Nhiệm vụ: xem từng WARNING có phải lỗi continuity thật hay false-positive của validator.',
        'Chỉ đưa kết luận dựa trên evidence/local_context/canon_state được cung cấp. Không bịa thêm.',
        'Nếu đoạn văn chỉ nhớ lại, đặt câu hỏi, so sánh, hồi tưởng, nhắc đến vật phẩm/sự kiện thì không xem là dùng lại.',
        'Nếu warning nói về bí mật, hãy phân biệt giữa việc nhắc/bàn/rumor/hoài nghi về bí mật với việc thực sự tiết lộ hay xác nhận bí mật đó.',
        'Nếu có hành động rõ ràng dùng lại/tiêu hao/chuyển giao trong khi canon cấm và không có sự kiện mua lại/tìm lại/khôi phục/trả lại thì giữ warning.',
        'Nếu thiếu dữ liệu số lượng/phân loại/chuỗi sự kiện thì verdict needs_review, không khẳng định lỗi.',
        'Trả về JSON hợp lệ duy nhất.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        output_schema: {
          decisions: [{
            warning_index: 0,
            verdict: 'false_positive | true_issue | needs_review',
            confidence: 0.0,
            reason: 'ngan gon',
            suggested_action: 'dismiss_report | keep_warning | needs_review',
            suggested_ops: [],
          }],
        },
        project: {
          id: project?.id || null,
          title: project?.title || '',
          genre: project?.genre_primary || '',
        },
        chapter: {
          id: chapter?.id || null,
          title: chapter?.title || '',
          order_index: chapter?.order_index ?? null,
        },
        warnings: warningPayload,
      }),
    },
  ];
}

async function adjudicateWarningReports({
  project,
  chapter,
  revision,
  reports,
  candidateOps,
  preTruth,
  routeOptions = null,
  allowConcurrent = false,
}) {
  const warningReports = reports.filter((report) => shouldAdjudicateWarning(report));
  if (warningReports.length === 0) return reports;
  if (!TASK_TYPES.CANON_ADJUDICATE_WARNINGS) return reports;

  try {
    const messages = buildWarningAdjudicationMessages({
      project,
      chapter,
      revision,
      reports: warningReports,
      candidateOps,
      preTruth,
    });
    const rawText = await sendAiTask(TASK_TYPES.CANON_ADJUDICATE_WARNINGS, messages, {
      routeOptions: routeOptions || undefined,
      nsfwMode: !!project?.nsfw_mode,
      superNsfwMode: !!project?.super_nsfw_mode,
      allowConcurrent,
    });
    const decisions = normalizeAdjudicationResponse(parseAIJsonValue(rawText));
    const decisionByIndex = new Map();
    decisions.forEach((decision) => {
      const index = Number(decision?.warning_index ?? decision?.index);
      if (Number.isInteger(index)) {
        decisionByIndex.set(index, {
          verdict: cleanText(decision.verdict || ''),
          confidence: clampAdjudicationConfidence(decision.confidence),
          reason: cleanText(decision.reason || ''),
          suggested_action: cleanText(decision.suggested_action || ''),
          suggested_ops: Array.isArray(decision.suggested_ops) ? decision.suggested_ops : [],
        });
      }
    });

    let warningCursor = -1;
    return reports
      .map((report) => {
        if (!shouldAdjudicateWarning(report)) return report;
        warningCursor += 1;
        const decision = decisionByIndex.get(warningCursor);
        if (!decision) return report;
        return {
          ...report,
          ai_adjudication: decision,
        };
      })
      .filter((report) => {
        const decision = report.ai_adjudication;
        if (!decision) return true;
        return !(
          decision.verdict === 'false_positive'
          && decision.suggested_action === 'dismiss_report'
          && decision.confidence >= 0.8
        );
      });
  } catch (error) {
    console.warn('[Canon] warning adjudication failed, keeping validator warnings:', error);
    return reports;
  }
}

export async function createChapterRevision({
  projectId,
  chapterId,
  chapterText,
  status = CHAPTER_REVISION_STATUS.DRAFT,
  metadata = {},
}) {
  const existing = await db.chapter_revisions
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .toArray();
  const revisionNumber = existing.reduce((maxValue, item) => Math.max(maxValue, item.revision_number || 0), 0) + 1;
  const now = Date.now();
  const revisionId = await db.chapter_revisions.add({
    project_id: projectId,
    chapter_id: chapterId,
    revision_number: revisionNumber,
    status,
    chapter_text: chapterText,
    content_signature: buildCanonContentSignature(chapterText),
    candidate_ops: '[]',
    validator_summary: null,
    ...metadata,
    created_at: now,
    updated_at: now,
  });
  return db.chapter_revisions.get(revisionId);
}

export async function extractCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  chapterText = '',
  scenes = [],
  preTruth = null,
  routeOptions = null,
  allowConcurrent = false,
  retryReports = [],
}) {
  const { project } = await getChapterAndProject(projectId, chapterId);
  const truth = preTruth || await loadPreChapterTruth(projectId, chapterId);
  const entityStateById = new Map((truth.entityStates || []).map((state) => [state.entity_id, state]));
  const threadStateById = new Map((truth.threadStates || []).map((state) => [state.thread_id, state]));
  const itemStateById = new Map((truth.itemStates || []).map((state) => [state.object_id, state]));
  const relationshipStateByPair = new Map(
    (truth.relationshipStates || []).map((state) => [state.pair_key, state]),
  );
  const canonFacts = (truth.factStates || []).map((fact) => ({
    ...fact,
    status: fact.status || 'active',
  }));
  const factDescriptionById = new Map(canonFacts.map((fact) => [
    String(fact.id),
    fact.description || '',
  ]));
  const characters = (truth.characters || []).map((character) => {
    const state = entityStateById.get(character.id);
    return {
      ...character,
      current_status: buildCharacterStateSummary(state, character.current_status || ''),
      canon_state: state || null,
      known_canon_facts: Object.entries(state?.knowledge || {})
        .filter(([, known]) => known)
        .map(([factId]) => factDescriptionById.get(String(factId)))
        .filter(Boolean),
    };
  });
  const locations = truth.locations || [];
  const plotThreads = (truth.plotThreads || []).map((thread) => ({
    ...thread,
    ...(threadStateById.get(thread.id) || {}),
  }));
  const objects = (truth.objects || []).map((object) => ({
    ...object,
    ...(itemStateById.get(object.id) || {}),
  }));
  const characterNameById = new Map(characters.map((character) => [character.id, character.name]));
  const relationships = (truth.relationships || []).map((relationship) => {
    const pairKey = buildRelationshipPairKey(
      relationship.character_a_id,
      relationship.character_b_id,
    );
    const projectedState = relationshipStateByPair.get(pairKey) || {};
    return {
      ...relationship,
      ...projectedState,
      charA: characterNameById.get(relationship.character_a_id) || `#${relationship.character_a_id}`,
      charB: characterNameById.get(relationship.character_b_id) || `#${relationship.character_b_id}`,
      label: projectedState.relationship_type || relationship.relation_type || 'other',
    };
  });

  let promptTemplates = {};
  if (project?.prompt_templates) {
    try {
      promptTemplates = JSON.parse(project.prompt_templates);
    } catch {
      promptTemplates = {};
    }
  }

  const messages = buildPrompt(TASK_TYPES.CANON_EXTRACT_OPS, {
    projectId,
    chapterId,
    sceneText: chapterText,
    sceneList: scenes.map((scene, index) => ({
      index: index + 1,
      title: scene.title || `Canh ${index + 1}`,
      text: cleanText(scene.draft_text || scene.final_text || ''),
    })),
    characters,
    locations,
    plotThreads,
    canonFacts,
    objects,
    relationships,
    genre: project?.genre_primary || '',
    projectTitle: project?.title || '',
    promptTemplates,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  if (retryReports.length > 0) {
    messages.push(buildCanonExtractionRetryMessage(retryReports));
  }

  const rawText = await sendAiTask(TASK_TYPES.CANON_EXTRACT_OPS, messages, {
    routeOptions: routeOptions || undefined,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
    allowConcurrent,
  });
  if (!cleanText(rawText)) {
    throw buildCanonExtractError(new Error('AI không trả về nội dung trích xuất canon.'), rawText);
  }

  let parsed;
  try {
    parsed = parseAIJsonValue(rawText);
  } catch (error) {
    throw buildCanonExtractError(error, rawText);
  }

  const extractedOps = normalizeAiOpsResponse(parsed);
  if (!extractedOps) {
    throw buildCanonExtractError(new Error('JSON canon phải là một mảng hoặc object có trường ops là mảng.'), rawText);
  }

  const mapping = mapAiOpsToCandidateOpsDetailed(extractedOps, {
    chapterId,
    scenes,
    characters,
    locations,
    plotThreads,
    canonFacts,
    objects,
  });

  if (revisionId) {
    await db.chapter_revisions.update(revisionId, {
      candidate_ops: JSON.stringify(mapping.candidateOps),
      updated_at: Date.now(),
    });
  }

  return {
    candidateOps: mapping.candidateOps,
    mappingFilteredOps: mapping.filteredOps,
    extractedCount: extractedOps.length,
  };
}

function buildMappingFilteredReports({
  filteredOps = [],
  projectId,
  chapterId,
  revisionId,
}) {
  return filteredOps.map((filteredOp) => {
    const missingReferences = filteredOp.missingReferences?.filter(Boolean) || [];
    const message = filteredOp.reasonCode === 'CANON_OP_DUPLICATE_FILTERED'
      ? `Thao tác ${filteredOp.opType || 'không rõ loại'} trùng nghĩa với một thao tác khác trong cùng phản hồi AI nên đã được loại.`
      : filteredOp.reasonCode === 'CANON_OP_MISSING_REFERENCE_FILTERED'
        ? `Thao tác ${filteredOp.opType || 'không rõ loại'} không ánh xạ được tham chiếu bắt buộc${missingReferences.length > 0 ? ` (${missingReferences.join(', ')})` : ''} nên đã được loại.`
        : `Thao tác AI dùng loại không được hỗ trợ (${filteredOp.opType || 'trống'}) nên đã được loại.`;
    return createReport({
      severity: CANON_SEVERITY.WARNING,
      ruleCode: filteredOp.reasonCode,
      message,
      projectId,
      chapterId,
      revisionId,
      sceneId: filteredOp.mappedOp?.scene_id || null,
      relatedEntityIds: [
        filteredOp.mappedOp?.subject_id,
        filteredOp.mappedOp?.target_id,
      ],
      relatedThreadIds: [filteredOp.mappedOp?.thread_id],
      evidence: filteredOp.evidence || '',
    });
  });
}

export async function validateRevision(chapterRevisionId, mode = 'draft', options = {}) {
  const revision = await db.chapter_revisions.get(chapterRevisionId);
  if (!revision) {
    throw new Error('Không tìm thấy chapter revision để validate.');
  }

  const scenes = await getChapterScenes(revision.chapter_id);
  const sceneOrderMap = buildSceneOrderMap(scenes);
  const preTruth = await loadPreChapterTruth(revision.project_id, revision.chapter_id);
  const project = await db.projects.get(revision.project_id);
  let candidateOps = loadRevisionOps(revision);
  const extractionFallbackReports = [];
  let commitReadinessReports = [];
  const shouldFailClosed = mode === 'canonicalize';
  let extractionAttempted = false;
  let extractionSucceeded = false;
  let extractionRetried = false;
  let extractionAttemptCount = 0;
  let extractedCount = candidateOps.length;
  const sceneTextById = new Map(scenes.map((scene) => [
    scene.id,
    cleanText(scene.draft_text || scene.final_text || ''),
  ]));

  const runExtractionAttempt = async (retryReports = []) => {
    extractionAttempted = true;
    extractionAttemptCount += 1;
    const extraction = await extractCandidateOps({
      projectId: revision.project_id,
      chapterId: revision.chapter_id,
      revisionId: revision.id,
      chapterText: revision.chapter_text,
      scenes,
      preTruth,
      routeOptions: options.routeOptions || null,
      allowConcurrent: !!options.allowConcurrent,
      retryReports,
    });
    let nextOps = extraction.candidateOps;
    const nextReports = buildMappingFilteredReports({
      filteredOps: extraction.mappingFilteredOps,
      projectId: revision.project_id,
      chapterId: revision.chapter_id,
      revisionId: revision.id,
    });
    if (shouldFailClosed) {
      const filtered = filterCommitReadyOps(nextOps, {
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        requireConfidence: true,
        requireEvidenceGrounding: true,
        sceneTextById,
        entityStates: preTruth.entityStates,
      });
      nextOps = filtered.ops;
      nextReports.push(...filtered.reports);
    }
    return {
      candidateOps: nextOps,
      reports: nextReports,
      extractedCount: extraction.extractedCount,
    };
  };

  if (!options.skipExtraction && candidateOps.length === 0 && cleanText(revision.chapter_text)) {
    try {
      const extraction = await runExtractionAttempt();
      candidateOps = extraction.candidateOps;
      extractionSucceeded = true;
      extractedCount = extraction.extractedCount;
      commitReadinessReports = extraction.reports;

      if (shouldRetryCanonExtraction({
        extractedCount,
        committedCount: candidateOps.length,
        reports: commitReadinessReports,
      })) {
        extractionRetried = true;
        const retryFeedback = commitReadinessReports;
        try {
          const retry = await runExtractionAttempt(retryFeedback);
          candidateOps = retry.candidateOps;
          extractedCount = retry.extractedCount;
          commitReadinessReports = retry.reports;
          if (candidateOps.length > 0) {
            commitReadinessReports.unshift(createReport({
              severity: CANON_SEVERITY.INFO,
              ruleCode: 'CANON_EXTRACT_RETRY_SUCCEEDED',
              message: 'Phản hồi canon đầu tiên không hợp lệ; hệ thống đã yêu cầu AI sửa một lần và dùng kết quả đã được kiểm chứng lại.',
              projectId: revision.project_id,
              chapterId: revision.chapter_id,
              revisionId: revision.id,
            }));
          } else {
            extractionSucceeded = false;
            commitReadinessReports.push(createReport({
              severity: CANON_SEVERITY.ERROR,
              ruleCode: 'CANON_EXTRACT_RETRY_EXHAUSTED',
              message: 'AI vẫn không trả về thao tác canon có thể kiểm chứng sau lần sửa tự động; chương chưa được đánh dấu hoàn thành.',
              projectId: revision.project_id,
              chapterId: revision.chapter_id,
              revisionId: revision.id,
              evidence: retry.reports.map((report) => report.message).filter(Boolean).join(' | ')
                || 'Phản hồi sửa lỗi không còn thao tác canon có thể commit.',
            }));
          }
        } catch (error) {
          extractionSucceeded = false;
          candidateOps = [];
          commitReadinessReports = [createReport({
            severity: CANON_SEVERITY.ERROR,
            ruleCode: 'CANON_EXTRACT_RETRY_FAILED',
            message: 'Không thể hoàn tất lần sửa tự động cho phản hồi canon; chương chưa được đánh dấu hoàn thành.',
            projectId: revision.project_id,
            chapterId: revision.chapter_id,
            revisionId: revision.id,
            evidence: error?.message || '',
          })];
        }
      }
    } catch (error) {
      console.warn('[Canon] extractCandidateOps failed, falling back to heuristic-only validation:', error);
      candidateOps = [];
      extractionFallbackReports.push(createReport({
        severity: shouldFailClosed ? CANON_SEVERITY.ERROR : CANON_SEVERITY.INFO,
        ruleCode: 'CANON_EXTRACT_FALLBACK',
        message: shouldFailClosed
          ? 'AI không trích xuất được canon ops nên chương chưa thể hoàn thành canon.'
          : 'AI không trích xuất được canon ops, hệ thống chỉ tiếp tục kiểm tra bản nháp và chưa ghi canon.',
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        evidence: error?.message || '',
      }));
    }
  }

  if (shouldFailClosed && !extractionAttempted) {
    const filtered = filterCommitReadyOps(candidateOps, {
      projectId: revision.project_id,
      chapterId: revision.chapter_id,
      revisionId: revision.id,
      requireConfidence: false,
      requireEvidenceGrounding: false,
      sceneTextById,
      entityStates: preTruth.entityStates,
    });
    candidateOps = filtered.ops;
    commitReadinessReports.push(...filtered.reports);
  }
  const committedCount = candidateOps.length;
  const filteredCount = Math.max(0, extractedCount - committedCount);

  const schemaReports = validateCandidateOps({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    candidateOps,
    sceneOrderMap,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    itemStates: preTruth.itemStates,
    relationshipStates: preTruth.relationshipStates,
  });

  const heuristicReports = validateDraftTextAgainstTruth({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    sceneText: revision.chapter_text,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
    candidateOps,
  });

  let reports = [...schemaReports, ...heuristicReports, ...commitReadinessReports, ...extractionFallbackReports];
  reports = await adjudicateWarningReports({
    project,
    chapter: preTruth.chapter,
    revision,
    reports,
    candidateOps,
    preTruth,
    routeOptions: options.routeOptions || null,
    allowConcurrent: !!options.allowConcurrent,
  });
  await replaceValidatorReports(revision.project_id, revision.id, reports);

  const hasErrors = reportsHaveErrors(reports);
  const status = hasErrors
    ? CHAPTER_REVISION_STATUS.BLOCKED
    : (mode === 'canonicalize' ? CHAPTER_REVISION_STATUS.VALIDATED : CHAPTER_REVISION_STATUS.DRAFT);
  const extractionStatus = extractionAttempted
    ? (extractionSucceeded ? 'succeeded' : 'failed')
    : 'skipped';

  await db.chapter_revisions.update(revision.id, {
    status,
    candidate_ops: JSON.stringify(candidateOps),
    validator_summary: JSON.stringify({
      warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
      error_count: reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
      extraction_status: extractionStatus,
      extracted_count: extractedCount,
      committed_count: committedCount,
      filtered_count: filteredCount,
      extraction_retried: extractionRetried,
      extraction_attempt_count: extractionAttemptCount,
    }),
    updated_at: Date.now(),
  });

  await updateChapterCommitSummary(
    revision.project_id,
    revision.chapter_id,
    hasErrors ? CHAPTER_COMMIT_STATUS.BLOCKED
      : (reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.DRAFT),
    reports,
    revision.id
  );

  return {
    revision: await db.chapter_revisions.get(revision.id),
    candidateOps,
    reports,
    hasErrors,
    extractionStatus,
    extractedCount,
    committedCount,
    filteredCount,
    extractionRetried,
    extractionAttemptCount,
  };
}

function buildStoryEventsFromOps(projectId, revisionId, candidateOps) {
  return candidateOps.map((op) => ({
    project_id: projectId,
    chapter_id: op.chapter_id,
    revision_id: revisionId,
    scene_id: op.scene_id,
    op_type: op.op_type,
    subject_id: op.subject_id,
    target_id: op.target_id,
    thread_id: op.thread_id,
    location_id: op.location_id,
    fact_id: op.fact_id,
    object_id: op.object_id || null,
    status: 'committed',
    subject_name: op.subject_name,
    target_name: op.target_name,
    thread_title: op.thread_title,
    location_name: op.location_name,
    fact_description: op.fact_description,
    object_name: op.object_name,
    summary: op.summary,
    payload: op.payload,
    confidence: op.confidence,
    created_at: Date.now(),
  }));
}

function buildEvidenceFromOps(projectId, revisionId, candidateOps) {
  return candidateOps.map((op, index) => ({
    project_id: projectId,
    chapter_id: op.chapter_id,
    revision_id: revisionId,
    scene_id: op.scene_id,
    target_type: 'candidate_op',
    target_id: `${revisionId}:${index}:${op.op_type}`,
    source_type: 'chapter_text',
    evidence_text: op.evidence,
    summary: op.summary,
    created_at: Date.now(),
  }));
}

function resolveFactRegistrations(candidateOps, factStates) {
  return candidateOps.map((op) => {
    if (op.op_type !== CANON_OP_TYPES.FACT_REGISTERED) {
      return op;
    }
    const resolved = resolveCanonFactRegistration({
      fact_description: op.fact_description || op.payload?.description || op.summary || '',
      fact_type: op.payload?.fact_type || 'fact',
      subject_type: op.payload?.subject_type || '',
      subject_id: op.subject_id ?? op.payload?.subject_id ?? null,
      subject_name: op.subject_name || op.payload?.subject_name || '',
      subject_scope: op.payload?.subject_scope || '',
    }, factStates);
    return {
      ...op,
      fact_id: op.fact_id || resolved.existingFact?.id || null,
      fact_description: op.fact_description || op.payload?.description || op.summary || '',
      payload: {
        ...(op.payload || {}),
        normalized_description: resolved.normalized_description,
        subject_scope: resolved.subject_scope,
        fact_fingerprint: resolved.fact_fingerprint,
      },
    };
  });
}

export async function canonicalizeChapter(projectId, chapterId, options = {}) {
  assertCanonRunAllowed(options.bulkRunToken || null);
  const scenes = await getChapterScenes(chapterId);
  const chapterText = buildCanonChapterTextFromScenes(scenes);
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const validation = await validateRevision(revision.id, 'canonicalize', {
    routeOptions: options.routeOptions || null,
    allowConcurrent: !!options.allowConcurrent,
  });
  if (validation.hasErrors) {
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, validation.reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports: validation.reports,
      extractionStatus: validation.extractionStatus,
      extractedCount: validation.extractedCount,
      committedCount: 0,
      filteredCount: validation.filteredCount,
      extractionRetried: validation.extractionRetried,
      extractionAttemptCount: validation.extractionAttemptCount,
      invalidatedChapterIds: [],
    };
  }

  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const candidateOps = resolveFactRegistrations(validation.candidateOps, preTruth.factStates);
  const storyEvents = buildStoryEventsFromOps(projectId, revision.id, candidateOps);
  const memoryEvidence = buildEvidenceFromOps(projectId, revision.id, candidateOps);

  if (commit.canonical_revision_id) {
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.SUPERSEDED,
      updated_at: Date.now(),
    });
    const previousEvents = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();
    await Promise.all(previousEvents.map((event) => db.story_events.update(event.id, { status: 'superseded' })));
  }

  const invalidatedChapterIds = await invalidateFromChapter(projectId, chapterId);

  await db.transaction('rw',
    db.projects,
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    db.suggestions,
    async () => {
      await db.projects.update(projectId, {
        canon_rebuild_required: true,
        updated_at: Date.now(),
      });

      await db.chapter_revisions.update(revision.id, {
        status: CHAPTER_REVISION_STATUS.CANONICAL,
        candidate_ops: JSON.stringify(candidateOps),
        updated_at: Date.now(),
      });

      if (storyEvents.length > 0) {
        await db.story_events.bulkAdd(storyEvents);
      }
      if (memoryEvidence.length > 0) {
        await db.memory_evidence.bulkAdd(memoryEvidence);
      }
      await supersedeLegacyCanonSuggestions(projectId, chapterId);

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: validation.reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: validation.reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  try {
    await rebuildCanonProjectionAfterCommit(projectId, chapterId);
  } catch (error) {
    const reports = await blockRevisionAfterProjectionFailure({
      projectId,
      chapterId,
      revisionId: revision.id,
      reports: validation.reports,
      error,
    });
    return {
      ok: false,
      revisionId: revision.id,
      reports,
      invalidatedChapterIds,
      invalidatedChapterCount: invalidatedChapterIds.length,
      extractionStatus: validation.extractionStatus,
      extractedCount: validation.extractedCount,
      committedCount: 0,
      filteredCount: validation.filteredCount,
      extractionRetried: validation.extractionRetried,
      extractionAttemptCount: validation.extractionAttemptCount,
    };
  }
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports: validation.reports,
    invalidatedChapterIds,
    invalidatedChapterCount: invalidatedChapterIds.length,
    extractionStatus: validation.extractionStatus,
    extractedCount: validation.extractedCount,
    committedCount: candidateOps.length,
    filteredCount: validation.filteredCount,
    extractionRetried: validation.extractionRetried,
    extractionAttemptCount: validation.extractionAttemptCount,
  };
}

export async function canonicalizeCandidateOps({
  projectId,
  chapterId,
  candidateOps = [],
  chapterText = '',
  sourceType = 'manual_review',
  allowConcurrent = false,
}) {
  const scenes = await getChapterScenes(chapterId);
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const currentCanonicalRevision = commit.canonical_revision_id
    ? await db.chapter_revisions.get(commit.canonical_revision_id)
    : null;
  const baseOps = loadRevisionOps(currentCanonicalRevision);
  const mergedOps = dedupeCandidateOps([...baseOps, ...candidateOps]);
  const fallbackText = chapterText || buildCanonChapterTextFromScenes(scenes);
  const sceneOrderMap = buildSceneOrderMap(scenes);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: fallbackText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const filtered = filterCommitReadyOps(mergedOps, {
    projectId,
    chapterId,
    revisionId: revision.id,
    requireConfidence: false,
  });
  const commitReadyOps = filtered.ops;
  const [preTruth, project] = await Promise.all([
    loadPreChapterTruth(projectId, chapterId),
    db.projects.get(projectId),
  ]);
  const resolvedCommitReadyOps = resolveFactRegistrations(commitReadyOps, preTruth.factStates);
  let reports = [
    ...validateCandidateOps({
      projectId,
      chapterId,
      revisionId: revision.id,
      candidateOps: resolvedCommitReadyOps,
      sceneOrderMap,
      entityStates: preTruth.entityStates,
      threadStates: preTruth.threadStates,
      factStates: preTruth.factStates,
      itemStates: preTruth.itemStates,
      relationshipStates: preTruth.relationshipStates,
    }),
    ...filtered.reports,
  ];
  if (mergedOps.length > 0 && commitReadyOps.length === 0) {
    reports.push(createReport({
      severity: CANON_SEVERITY.ERROR,
      ruleCode: 'NO_COMMITTABLE_CANON_OPS',
      message: 'Tất cả thao tác canon đề xuất đều bị loại, không có thao tác hợp lệ để lưu.',
      projectId,
      chapterId,
      revisionId: revision.id,
      evidence: cleanText(fallbackText).slice(0, 240),
    }));
  }
  reports = await adjudicateWarningReports({
    project,
    chapter: preTruth.chapter,
    revision,
    reports,
    candidateOps: resolvedCommitReadyOps,
    preTruth,
    allowConcurrent,
  });

  await replaceValidatorReports(projectId, revision.id, reports);

  if (reportsHaveErrors(reports)) {
    await db.chapter_revisions.update(revision.id, {
      status: CHAPTER_REVISION_STATUS.BLOCKED,
      candidate_ops: JSON.stringify(resolvedCommitReadyOps),
      updated_at: Date.now(),
    });
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports,
    };
  }

  const storyEvents = buildStoryEventsFromOps(projectId, revision.id, resolvedCommitReadyOps);
  const memoryEvidence = buildEvidenceFromOps(projectId, revision.id, resolvedCommitReadyOps).map((item) => ({
    ...item,
    source_type: sourceType,
  }));

  if (commit.canonical_revision_id) {
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.SUPERSEDED,
      updated_at: Date.now(),
    });
    const previousEvents = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();
    await Promise.all(previousEvents.map((event) => db.story_events.update(event.id, { status: 'superseded' })));
  }

  const invalidatedChapterIds = await invalidateFromChapter(projectId, chapterId);

  await db.transaction('rw',
    db.projects,
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    async () => {
      await db.projects.update(projectId, {
        canon_rebuild_required: true,
        updated_at: Date.now(),
      });

      await db.chapter_revisions.update(revision.id, {
        status: CHAPTER_REVISION_STATUS.CANONICAL,
        candidate_ops: JSON.stringify(resolvedCommitReadyOps),
        updated_at: Date.now(),
      });

      if (storyEvents.length > 0) {
        await db.story_events.bulkAdd(storyEvents);
      }
      if (memoryEvidence.length > 0) {
        await db.memory_evidence.bulkAdd(memoryEvidence);
      }

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  try {
    await rebuildCanonProjectionAfterCommit(projectId, chapterId);
  } catch (error) {
    const failureReports = await blockRevisionAfterProjectionFailure({
      projectId,
      chapterId,
      revisionId: revision.id,
      reports,
      error,
    });
    return {
      ok: false,
      revisionId: revision.id,
      reports: failureReports,
      invalidatedChapterIds,
    };
  }
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports,
    invalidatedChapterIds,
  };
}

export async function validateSceneDraft({
  projectId,
  chapterId,
  sceneId = null,
  sceneText = '',
  sceneCast = [],
  characterContextGate = null,
  allowConcurrent = false,
}) {
  const [preTruth, project] = await Promise.all([
    loadPreChapterTruth(projectId, chapterId),
    db.projects.get(projectId),
  ]);
  let reports = validateDraftTextAgainstTruth({
    projectId,
    chapterId,
    sceneText,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
  });

  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: sceneText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });
  let resolvedSceneCast = sceneCast;
  if ((!resolvedSceneCast || resolvedSceneCast.length === 0) && characterContextGate?.sceneCast?.length > 0) {
    resolvedSceneCast = characterContextGate.sceneCast;
  }
  if ((!resolvedSceneCast || resolvedSceneCast.length === 0) && sceneId) {
    try {
      const scene = await db.scenes.get(sceneId);
      const presentIds = (() => {
        try {
          return JSON.parse(scene?.characters_present || '[]');
        } catch {
          return [];
        }
      })();
      const ids = [scene?.pov_character_id, ...presentIds].filter((id) => id != null && id !== '');
      resolvedSceneCast = ids
        .map((id) => preTruth.characters.find((character) => String(character.id) === String(id)))
        .filter(Boolean);
    } catch {
      resolvedSceneCast = [];
    }
  }
  reports = [
    ...reports,
    ...validateGeneratedProseDiscipline({
      projectId,
      chapterId,
      revisionId: revision.id,
      sceneId,
      sceneText,
      characters: preTruth.characters,
      entityStates: preTruth.entityStates,
      factStates: preTruth.factStates,
      sceneCast: resolvedSceneCast || [],
      characterContextGate,
    }),
  ];
  reports = await adjudicateWarningReports({
    project,
    chapter: preTruth.chapter,
    revision,
    reports,
    candidateOps: [],
    preTruth,
    allowConcurrent,
  });
  const scopedReports = reports.map((report) => ({ ...report, scene_id: sceneId || report.scene_id }));
  await replaceValidatorReports(projectId, revision.id, scopedReports);
  await updateChapterCommitSummary(
    projectId,
    chapterId,
    scopedReports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : commit.status,
    scopedReports,
    revision.id
  );

  return {
    revisionId: revision.id,
    reports: scopedReports,
  };
}

export async function repairChapterRevision({ projectId, chapterId, revisionId, reportId = null }) {
  const revision = await db.chapter_revisions.get(revisionId);
  if (!revision) {
    throw new Error('Không tìm thấy phiên bản chương cần sửa.');
  }
  const reports = await db.validator_reports
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .toArray();
  const scopedReports = reportId
    ? reports.filter((report) => String(report.id) === String(reportId))
    : reports;
  if (reportId && scopedReports.length === 0) {
    throw new Error('Không tìm thấy báo cáo cần sửa.');
  }
  const { project, chapter } = await getChapterAndProject(projectId, chapterId);
  const messages = buildPrompt(TASK_TYPES.CANON_REPAIR, {
    projectId,
    chapterTitle: chapter?.title || '',
    projectTitle: project?.title || '',
    sceneText: revision.chapter_text || '',
    validatorReports: scopedReports,
    genre: project?.genre_primary || '',
  });
  const text = await sendAiTask(TASK_TYPES.CANON_REPAIR, messages, {
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  return {
    text,
    report: scopedReports[0] || null,
    reports: scopedReports,
    revision,
  };
}

export async function saveRepairDraftRevision({
  projectId,
  chapterId,
  revisionId,
  reportId = null,
  chapterText,
}) {
  const trimmedText = String(chapterText || '').trim();
  if (!trimmedText) {
    throw new Error('Không có nội dung để lưu thành bản nháp.');
  }

  const draftRevision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: trimmedText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
    metadata: {
      source_revision_id: revisionId || null,
      source_report_id: reportId || null,
      repair_source: 'validator_report',
    },
  });

  const validation = await validateRevision(draftRevision.id, 'draft', {
    skipExtraction: true,
  });

  return {
    ...draftRevision,
    validation,
  };
}
