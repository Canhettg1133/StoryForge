import db from '../db/database';
import aiService from '../ai/client';
import { buildPrompt } from '../ai/promptBuilder';
import { TASK_TYPES } from '../ai/router';
import { parseAIJsonValue } from '../../utils/aiJson';
import {
  CANON_OP_TYPES,
  CANON_SEVERITY,
  CHAPTER_COMMIT_STATUS,
  CHAPTER_REVISION_STATUS,
  CANON_REPORT_STATUS,
  CANON_EXTRACTABLE_OPS,
} from './constants';

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueList(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function splitGoals(value) {
  if (Array.isArray(value)) {
    return uniqueList(value.map((item) => cleanText(item)).filter(Boolean));
  }
  return uniqueList(
    String(value || '')
      .split(/[,\n;|]/)
      .map((item) => cleanText(item))
      .filter(Boolean)
  );
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function normalizeOpType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return CANON_EXTRACTABLE_OPS.has(normalized) ? normalized : null;
}

function normalizeAiOpsResponse(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.ops)) return parsed.ops;
  return [];
}

function chapterTextFromScenes(scenes) {
  return (scenes || [])
    .map((scene) => cleanText(scene.draft_text || scene.final_text || ''))
    .filter(Boolean)
    .join('\n\n');
}

function loadSnapshotValue(snapshot, key, fallback) {
  if (!snapshot) return fallback;
  try {
    const parsed = typeof snapshot.snapshot_json === 'string'
      ? JSON.parse(snapshot.snapshot_json)
      : snapshot.snapshot_json;
    return parsed?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

function createReport({
  severity,
  ruleCode,
  message,
  projectId,
  chapterId,
  revisionId = null,
  sceneId = null,
  relatedEntityIds = [],
  relatedThreadIds = [],
  relatedEventIds = [],
  evidence = '',
}) {
  return {
    project_id: projectId,
    chapter_id: chapterId,
    revision_id: revisionId,
    scene_id: sceneId,
    severity,
    rule_code: ruleCode,
    message,
    related_entity_ids: uniqueList(relatedEntityIds),
    related_thread_ids: uniqueList(relatedThreadIds),
    related_event_ids: uniqueList(relatedEventIds),
    evidence: cleanText(evidence),
    status: CANON_REPORT_STATUS.ACTIVE,
    created_at: Date.now(),
  };
}

export function inferAliveStatus(summary = '') {
  const normalized = normalizeKey(summary);
  if (!normalized) return 'alive';
  if (/(da chet|tu tran|hy sinh|chet|mat mang)/.test(normalized)) return 'dead';
  if (/(song sot|duoc cuu|binh an|con song)/.test(normalized)) return 'alive';
  return 'alive';
}

export function buildCharacterStateSummary(state, fallbackSummary = '') {
  const parts = [];
  if (state?.alive_status === 'dead') parts.push('Da chet');
  else if (state?.alive_status === 'alive') parts.push('Con song');
  if (state?.rescued) parts.push('Da duoc cuu');
  if (state?.injury_level && state.injury_level !== 'none') parts.push(`Bi thuong: ${state.injury_level}`);
  if (state?.current_location_name) parts.push(`Dang o ${state.current_location_name}`);
  if (state?.allegiance) parts.push(`Phe: ${state.allegiance}`);
  if (Array.isArray(state?.goals_active) && state.goals_active.length > 0) {
    parts.push(`Muc tieu: ${state.goals_active.join(', ')}`);
  }
  if (state?.summary) parts.push(state.summary);
  if (parts.length === 0 && fallbackSummary) parts.push(fallbackSummary);
  return uniqueList(parts).join(' | ');
}

export function createInitialEntityState(character = {}) {
  return {
    project_id: character.project_id,
    entity_id: character.id,
    entity_type: 'character',
    alive_status: inferAliveStatus(character.current_status || ''),
    current_location_id: null,
    current_location_name: '',
    injury_level: 'none',
    rescued: false,
    goals_active: splitGoals(character.goals),
    goals_abandoned: [],
    knowledge: {},
    allegiance: '',
    summary: cleanText(character.current_status || ''),
    last_event_id: null,
    source_revision_id: null,
    updated_at: Date.now(),
  };
}

export function createInitialThreadState(thread = {}) {
  return {
    project_id: thread.project_id,
    thread_id: thread.id,
    state: thread.state || 'active',
    summary: cleanText(thread.description || ''),
    focus_entity_ids: [],
    last_event_id: null,
    source_revision_id: null,
    updated_at: Date.now(),
  };
}

function buildStateMaps(entityStates, threadStates) {
  const entityMap = new Map(entityStates.map((state) => [state.entity_id, cloneValue(state)]));
  const threadMap = new Map(threadStates.map((state) => [state.thread_id, cloneValue(state)]));
  return { entityMap, threadMap };
}

function buildFactStates(canonFacts) {
  return (canonFacts || []).map((fact) => ({ ...fact }));
}

function collectFactStatesFromSnapshot(snapshot, canonFacts) {
  const snapshotFacts = loadSnapshotValue(snapshot, 'factStates', null);
  return Array.isArray(snapshotFacts) ? snapshotFacts.map((fact) => ({ ...fact })) : buildFactStates(canonFacts);
}

function toEntityStateRecords(projectId, entityMap) {
  return Array.from(entityMap.values()).map((state) => ({
    ...state,
    project_id: projectId,
    updated_at: Date.now(),
  }));
}

function toThreadStateRecords(projectId, threadMap) {
  return Array.from(threadMap.values()).map((state) => ({
    ...state,
    project_id: projectId,
    updated_at: Date.now(),
  }));
}

function findCharacterByName(characters, name) {
  const target = normalizeKey(name);
  if (!target) return null;
  return characters.find((character) => {
    const aliases = Array.isArray(character.aliases) ? character.aliases : [];
    return [character.name, ...aliases].some((value) => normalizeKey(value) === target);
  }) || null;
}

function findLocationByName(locations, name) {
  const target = normalizeKey(name);
  if (!target) return null;
  return locations.find((location) => normalizeKey(location.name) === target) || null;
}

function findThreadByTitle(threads, title) {
  const target = normalizeKey(title);
  if (!target) return null;
  return threads.find((thread) => normalizeKey(thread.title) === target) || null;
}

function findFactByDescription(facts, description) {
  const target = normalizeKey(description);
  if (!target) return null;
  return facts.find((fact) => normalizeKey(fact.description) === target) || null;
}

function mapAiOpsToCandidateOps(rawOps, refs) {
  const sceneMap = new Map(refs.scenes.map((scene, index) => [index + 1, scene]));
  return rawOps
    .map((rawOp) => {
      const opType = normalizeOpType(rawOp?.op_type);
      if (!opType) return null;

      const scene = sceneMap.get(Number(rawOp.scene_index) || 1) || refs.scenes[0] || null;
      const subject = findCharacterByName(refs.characters, rawOp.subject_name);
      const target = findCharacterByName(refs.characters, rawOp.target_name);
      const location = findLocationByName(refs.locations, rawOp.location_name);
      const thread = findThreadByTitle(refs.plotThreads, rawOp.thread_title);
      const fact = findFactByDescription(refs.canonFacts, rawOp.fact_description);

      return {
        op_type: opType,
        chapter_id: refs.chapterId,
        scene_id: scene?.id || null,
        scene_label: scene?.title || '',
        subject_id: subject?.id || null,
        subject_name: cleanText(rawOp.subject_name || subject?.name || ''),
        target_id: target?.id || null,
        target_name: cleanText(rawOp.target_name || target?.name || ''),
        location_id: location?.id || null,
        location_name: cleanText(rawOp.location_name || location?.name || ''),
        thread_id: thread?.id || null,
        thread_title: cleanText(rawOp.thread_title || thread?.title || ''),
        fact_id: fact?.id || null,
        fact_description: cleanText(rawOp.fact_description || fact?.description || ''),
        summary: cleanText(rawOp.summary || ''),
        confidence: Number(rawOp.confidence) || 0,
        evidence: cleanText(rawOp.evidence || ''),
        payload: normalizePayload(rawOp.payload),
      };
    })
    .filter(Boolean);
}

export function applyEventToEntityState(prevState, event) {
  const next = {
    ...(prevState || {}),
    goals_active: Array.isArray(prevState?.goals_active) ? [...prevState.goals_active] : [],
    goals_abandoned: Array.isArray(prevState?.goals_abandoned) ? [...prevState.goals_abandoned] : [],
    knowledge: prevState?.knowledge ? { ...prevState.knowledge } : {},
    updated_at: Date.now(),
    last_event_id: event.id || prevState?.last_event_id || null,
    source_revision_id: event.revision_id || prevState?.source_revision_id || null,
  };
  const payload = normalizePayload(event.payload);

  switch (event.op_type) {
    case CANON_OP_TYPES.CHARACTER_STATUS_CHANGED:
      next.summary = cleanText(payload.status_summary || event.summary || next.summary || '');
      next.alive_status = inferAliveStatus(next.summary || payload.status_summary);
      break;
    case CANON_OP_TYPES.CHARACTER_LOCATION_CHANGED:
      next.current_location_id = event.location_id || payload.location_id || null;
      next.current_location_name = cleanText(event.location_name || payload.location_name || '');
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    case CANON_OP_TYPES.CHARACTER_RESCUED:
      next.rescued = true;
      next.alive_status = 'alive';
      next.summary = cleanText(payload.status_summary || event.summary || 'Da duoc cuu');
      break;
    case CANON_OP_TYPES.CHARACTER_DIED:
      next.alive_status = 'dead';
      next.rescued = false;
      next.summary = cleanText(payload.status_summary || event.summary || 'Da chet');
      break;
    case CANON_OP_TYPES.GOAL_CHANGED: {
      const newGoals = uniqueList([
        ...splitGoals(payload.new_goal || ''),
        ...splitGoals(payload.goals_active || []),
      ]);
      const abandoned = uniqueList([
        ...splitGoals(payload.old_goal || ''),
        ...splitGoals(payload.goals_abandoned || []),
      ]);
      next.goals_active = newGoals.length > 0 ? newGoals : next.goals_active;
      next.goals_abandoned = uniqueList([...next.goals_abandoned, ...abandoned]);
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    }
    case CANON_OP_TYPES.ALLEGIANCE_CHANGED:
      next.allegiance = cleanText(payload.allegiance || payload.new_allegiance || event.summary || '');
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    case CANON_OP_TYPES.SECRET_REVEALED: {
      const knowledgeKey = String(event.fact_id || normalizeKey(event.fact_description || payload.fact_description || ''));
      if (knowledgeKey) next.knowledge[knowledgeKey] = true;
      if (payload.status_summary) next.summary = cleanText(payload.status_summary);
      break;
    }
    default:
      break;
  }

  return next;
}

export function applyEventToThreadState(prevState, event) {
  const next = {
    ...(prevState || {}),
    focus_entity_ids: Array.isArray(prevState?.focus_entity_ids) ? [...prevState.focus_entity_ids] : [],
    updated_at: Date.now(),
    last_event_id: event.id || prevState?.last_event_id || null,
    source_revision_id: event.revision_id || prevState?.source_revision_id || null,
  };
  const payload = normalizePayload(event.payload);

  switch (event.op_type) {
    case CANON_OP_TYPES.THREAD_OPENED:
    case CANON_OP_TYPES.THREAD_PROGRESS:
      next.state = 'active';
      next.summary = cleanText(payload.summary || event.summary || next.summary || '');
      next.focus_entity_ids = uniqueList([...next.focus_entity_ids, event.subject_id, event.target_id]);
      break;
    case CANON_OP_TYPES.THREAD_RESOLVED:
      next.state = 'resolved';
      next.summary = cleanText(payload.summary || event.summary || next.summary || '');
      next.focus_entity_ids = uniqueList([...next.focus_entity_ids, event.subject_id, event.target_id]);
      break;
    default:
      break;
  }

  return next;
}

function applyEventToFactStates(prevFactStates, event, chapterOrder) {
  const facts = prevFactStates.map((fact) => ({ ...fact }));
  const payload = normalizePayload(event.payload);

  if (event.op_type === CANON_OP_TYPES.SECRET_REVEALED) {
    const targetFact = facts.find((fact) => fact.id === event.fact_id)
      || facts.find((fact) => normalizeKey(fact.description) === normalizeKey(event.fact_description));
    if (targetFact) {
      targetFact.revealed_at_chapter = chapterOrder + 1;
      targetFact.fact_type = 'fact';
    }
    return facts;
  }

  if (event.op_type === CANON_OP_TYPES.FACT_REGISTERED) {
    facts.push({
      id: event.fact_id || `event:${event.id || `${event.chapter_id}:${facts.length}`}`,
      description: cleanText(event.fact_description || payload.description || event.summary || ''),
      fact_type: cleanText(payload.fact_type || 'fact') || 'fact',
      status: 'active',
      source_chapter_id: event.chapter_id,
      revealed_at_chapter: payload.fact_type === 'secret' ? null : chapterOrder + 1,
    });
  }

  return facts;
}

function tokenizeFactDescription(description) {
  return normalizeKey(description)
    .split(' ')
    .filter((token) => token.length > 3);
}

function loadRevisionOps(revision) {
  if (!revision?.candidate_ops) return [];
  try {
    const parsed = typeof revision.candidate_ops === 'string'
      ? JSON.parse(revision.candidate_ops)
      : revision.candidate_ops;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
      onComplete: (text) => resolve(text),
      onError: reject,
    });
  });
}

async function getChapterScenes(chapterId) {
  return db.scenes.where('chapter_id').equals(chapterId).sortBy('order_index');
}

async function getChapterAndProject(projectId, chapterId) {
  const [project, chapter] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.get(chapterId),
  ]);
  return { project, chapter };
}

async function getOrCreateChapterCommit(projectId, chapterId) {
  const existing = await db.chapter_commits
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .first();
  if (existing) return existing;
  const now = Date.now();
  const id = await db.chapter_commits.add({
    project_id: projectId,
    chapter_id: chapterId,
    current_revision_id: null,
    canonical_revision_id: null,
    status: CHAPTER_COMMIT_STATUS.DRAFT,
    warning_count: 0,
    error_count: 0,
    updated_at: now,
  });
  return db.chapter_commits.get(id);
}

export async function createChapterRevision({
  projectId,
  chapterId,
  chapterText,
  status = CHAPTER_REVISION_STATUS.DRAFT,
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
    candidate_ops: '[]',
    validator_summary: null,
    created_at: now,
    updated_at: now,
  });
  return db.chapter_revisions.get(revisionId);
}

async function updateChapterCommitSummary(projectId, chapterId, status, reports, revisionId) {
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const warningCount = reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length;
  const errorCount = reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length;
  await db.chapter_commits.update(commit.id, {
    current_revision_id: revisionId || commit.current_revision_id || null,
    status,
    warning_count: warningCount,
    error_count: errorCount,
    updated_at: Date.now(),
  });
}

async function replaceValidatorReports(projectId, revisionId, reports) {
  const existing = await db.validator_reports
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .toArray();
  if (existing.length > 0) {
    await db.validator_reports.bulkDelete(existing.map((item) => item.id));
  }
  if (reports.length > 0) {
    await db.validator_reports.bulkAdd(reports);
  }
}

async function loadPreChapterTruth(projectId, chapterId) {
  const [characters, locations, plotThreads, canonFacts, chapters] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
  ]);

  const chapter = chapters.find((item) => item.id === chapterId) || null;
  const chapterOrder = chapter?.order_index ?? 0;
  const snapshots = await db.chapter_snapshots.where('project_id').equals(projectId).toArray();
  const snapshot = snapshots
    .filter((item) => {
      const snapChapter = chapters.find((chapterItem) => chapterItem.id === item.chapter_id);
      return snapChapter && snapChapter.order_index < chapterOrder;
    })
    .sort((a, b) => {
      const chapterA = chapters.find((item) => item.id === a.chapter_id);
      const chapterB = chapters.find((item) => item.id === b.chapter_id);
      return (chapterB?.order_index || 0) - (chapterA?.order_index || 0);
    })[0] || null;

  const entityStates = snapshot
    ? loadSnapshotValue(snapshot, 'entityStates', []).map((state) => ({ ...state }))
    : characters.map((character) => createInitialEntityState(character));
  const threadStates = snapshot
    ? loadSnapshotValue(snapshot, 'threadStates', []).map((state) => ({ ...state }))
    : plotThreads.map((thread) => createInitialThreadState(thread));
  const factStates = collectFactStatesFromSnapshot(snapshot, canonFacts);

  return {
    chapter,
    chapterOrder,
    chapters,
    characters,
    locations,
    plotThreads,
    canonFacts,
    entityStates,
    threadStates,
    factStates,
  };
}

export function validateCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  candidateOps = [],
  entityStates = [],
  threadStates = [],
  factStates = [],
}) {
  const reports = [];
  const entityMap = new Map(entityStates.map((state) => [state.entity_id, state]));
  const threadMap = new Map(threadStates.map((state) => [state.thread_id, state]));
  const factMap = new Map(factStates.map((fact) => [fact.id, fact]));

  candidateOps.forEach((op) => {
    if (!normalizeOpType(op.op_type)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.ERROR,
        ruleCode: 'INVALID_OP_TYPE',
        message: `Op type khong hop le: ${op.op_type || '(trong)'}.`,
        projectId,
        chapterId,
        revisionId,
        sceneId: op.scene_id || null,
        evidence: op.evidence,
      }));
      return;
    }

    if (!op.scene_id) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'MISSING_SCENE_LINK',
        message: `Op ${op.op_type} chua gan scene cu the.`,
        projectId,
        chapterId,
        revisionId,
        evidence: op.evidence,
      }));
    }

    if (op.subject_id) {
      const subjectState = entityMap.get(op.subject_id);
      if (subjectState?.alive_status === 'dead'
        && ![CANON_OP_TYPES.CHARACTER_DIED].includes(op.op_type)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'DEAD_CHARACTER_ACTIVE',
          message: `${op.subject_name || 'Nhan vat'} da chet nhung van phat sinh hanh dong ${op.op_type}.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.thread_id) {
      const threadState = threadMap.get(op.thread_id);
      if (threadState?.state === 'resolved'
        && [CANON_OP_TYPES.THREAD_OPENED, CANON_OP_TYPES.THREAD_PROGRESS].includes(op.op_type)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'THREAD_ALREADY_RESOLVED',
          message: `Thread "${op.thread_title || 'khong ro'}" da dong nhung draft van day tiep.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedThreadIds: [op.thread_id],
          evidence: op.evidence,
        }));
      }
    }

    if (op.op_type === CANON_OP_TYPES.SECRET_REVEALED) {
      const fact = factMap.get(op.fact_id);
      if (fact?.revealed_at_chapter) {
        reports.push(createReport({
          severity: CANON_SEVERITY.WARNING,
          ruleCode: 'SECRET_ALREADY_REVEALED',
          message: `Bi mat "${fact.description}" da duoc tiet lo truoc do.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          evidence: op.evidence,
        }));
      }
    }

    if (op.op_type === CANON_OP_TYPES.GOAL_CHANGED && op.subject_id) {
      const state = entityMap.get(op.subject_id);
      const payload = normalizePayload(op.payload);
      const nextGoals = splitGoals(payload.new_goal || payload.goals_active || '');
      const abandoned = new Set(state?.goals_abandoned || []);
      const conflicting = nextGoals.filter((goal) => abandoned.has(goal));
      if (conflicting.length > 0 && !cleanText(payload.reason || op.summary)) {
        reports.push(createReport({
          severity: CANON_SEVERITY.ERROR,
          ruleCode: 'GOAL_REVERSAL_WITHOUT_REASON',
          message: `${op.subject_name || 'Nhan vat'} quay lai muc tieu cu "${conflicting.join(', ')}" ma khong co giai thich ro rang.`,
          projectId,
          chapterId,
          revisionId,
          sceneId: op.scene_id || null,
          relatedEntityIds: [op.subject_id],
          evidence: op.evidence,
        }));
      }
    }
  });

  return reports;
}

export function reportsHaveErrors(reports = []) {
  return reports.some((report) => report.severity === CANON_SEVERITY.ERROR);
}

function validateDraftTextAgainstTruth({
  projectId,
  chapterId,
  revisionId = null,
  sceneText = '',
  entityStates = [],
  threadStates = [],
  factStates = [],
  characters = [],
}) {
  const reports = [];
  const normalizedText = normalizeKey(sceneText);
  if (!normalizedText) return reports;

  entityStates.forEach((state) => {
    if (state.alive_status !== 'dead') return;
    const character = characters.find((item) => item.id === state.entity_id);
    if (!character?.name) return;
    const target = normalizeKey(character.name);
    if (target && normalizedText.includes(target)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_MENTIONS_DEAD_CHARACTER',
        message: `Draft dang nhac toi ${character.name}, trong khi canon hien tai ghi nhan nhan vat nay da chet.`,
        projectId,
        chapterId,
        revisionId,
        relatedEntityIds: [character.id],
      }));
    }
  });

  threadStates.forEach((threadState) => {
    if (threadState.state !== 'resolved') return;
    const threadText = normalizeKey(threadState.summary || '');
    if (threadText && normalizedText.includes(threadText)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.INFO,
        ruleCode: 'DRAFT_REFERENCES_RESOLVED_THREAD',
        message: 'Draft dang goi lai mot thread da dong.',
        projectId,
        chapterId,
        revisionId,
        relatedThreadIds: [threadState.thread_id],
      }));
    }
  });

  factStates.forEach((fact) => {
    if (fact.fact_type !== 'secret' || fact.revealed_at_chapter) return;
    const tokens = tokenizeFactDescription(fact.description).slice(0, 5);
    if (tokens.length < 2) return;
    const hitCount = tokens.filter((token) => normalizedText.includes(token)).length;
    if (hitCount >= Math.min(3, tokens.length)) {
      reports.push(createReport({
        severity: CANON_SEVERITY.WARNING,
        ruleCode: 'DRAFT_TOUCHES_HIDDEN_SECRET',
        message: `Draft co dau hieu dong vao bi mat chua lo: "${fact.description}".`,
        projectId,
        chapterId,
        revisionId,
      }));
    }
  });

  return reports;
}

export async function extractCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  chapterText = '',
  scenes = [],
}) {
  const { project } = await getChapterAndProject(projectId, chapterId);
  const [characters, locations, plotThreads, canonFacts] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
  ]);

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
    genre: project?.genre_primary || '',
    projectTitle: project?.title || '',
    promptTemplates,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });

  const rawText = await sendAiTask(TASK_TYPES.CANON_EXTRACT_OPS, messages, {
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  const parsed = parseAIJsonValue(rawText);
  const candidateOps = mapAiOpsToCandidateOps(normalizeAiOpsResponse(parsed), {
    chapterId,
    scenes,
    characters,
    locations,
    plotThreads,
    canonFacts,
  });

  if (revisionId) {
    await db.chapter_revisions.update(revisionId, {
      candidate_ops: JSON.stringify(candidateOps),
      updated_at: Date.now(),
    });
  }

  return candidateOps;
}

export async function validateRevision(chapterRevisionId, mode = 'draft') {
  const revision = await db.chapter_revisions.get(chapterRevisionId);
  if (!revision) {
    throw new Error('Khong tim thay chapter revision de validate.');
  }

  const scenes = await getChapterScenes(revision.chapter_id);
  const preTruth = await loadPreChapterTruth(revision.project_id, revision.chapter_id);
  let candidateOps = loadRevisionOps(revision);

  if (candidateOps.length === 0 && cleanText(revision.chapter_text)) {
    candidateOps = await extractCandidateOps({
      projectId: revision.project_id,
      chapterId: revision.chapter_id,
      revisionId: revision.id,
      chapterText: revision.chapter_text,
      scenes,
    });
  }

  const schemaReports = validateCandidateOps({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    candidateOps,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
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
  });

  const reports = [...schemaReports, ...heuristicReports];
  await replaceValidatorReports(revision.project_id, revision.id, reports);

  const hasErrors = reportsHaveErrors(reports);
  const status = hasErrors
    ? CHAPTER_REVISION_STATUS.BLOCKED
    : (mode === 'canonicalize' ? CHAPTER_REVISION_STATUS.VALIDATED : CHAPTER_REVISION_STATUS.DRAFT);

  await db.chapter_revisions.update(revision.id, {
    status,
    validator_summary: JSON.stringify({
      warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
      error_count: reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
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
    status: 'committed',
    subject_name: op.subject_name,
    target_name: op.target_name,
    thread_title: op.thread_title,
    location_name: op.location_name,
    fact_description: op.fact_description,
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

async function writeSnapshot(projectId, chapterId, revisionId, snapshot) {
  const existing = await db.chapter_snapshots
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .first();
  const record = {
    project_id: projectId,
    chapter_id: chapterId,
    revision_id: revisionId,
    snapshot_json: JSON.stringify(snapshot),
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  if (existing) {
    await db.chapter_snapshots.update(existing.id, record);
    return existing.id;
  }
  return db.chapter_snapshots.add(record);
}

async function syncCompatibilityProjection(projectId, entityStates, threadStates) {
  const characters = await db.characters.where('project_id').equals(projectId).toArray();
  await Promise.all(entityStates.map((state) => {
    const character = characters.find((item) => item.id === state.entity_id);
    if (!character) return Promise.resolve();
    return db.characters.update(character.id, {
      current_status: buildCharacterStateSummary(state, character.current_status || ''),
    });
  }));

  await Promise.all(threadStates.map((threadState) => (
    db.plotThreads.update(threadState.thread_id, { state: threadState.state })
  )));
}

async function clearCanonProjection(projectId) {
  const [entityRows, threadRows, timelineRows, snapshotRows] = await Promise.all([
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.entityTimeline.where('project_id').equals(projectId).toArray(),
    db.chapter_snapshots.where('project_id').equals(projectId).toArray(),
  ]);

  await Promise.all([
    entityRows.length > 0 ? db.entity_state_current.bulkDelete(entityRows.map((row) => row.id)) : Promise.resolve(),
    threadRows.length > 0 ? db.plot_thread_state.bulkDelete(threadRows.map((row) => row.id)) : Promise.resolve(),
    timelineRows.length > 0 ? db.entityTimeline.bulkDelete(timelineRows.map((row) => row.id)) : Promise.resolve(),
    snapshotRows.length > 0 ? db.chapter_snapshots.bulkDelete(snapshotRows.map((row) => row.id)) : Promise.resolve(),
  ]);
}

function appendCompatibilityTimeline(timelineEvents, event) {
  if (!event.subject_id) return;
  timelineEvents.push({
    project_id: event.project_id,
    entity_id: event.subject_id,
    entity_type: 'character',
    chapter_id: event.chapter_id,
    type: event.op_type,
    description: cleanText(event.summary || event.op_type),
    oldValue: null,
    newValue: cleanText(event.summary || ''),
    timestamp: event.created_at,
  });
}

export async function invalidateFromChapter(projectId, chapterId) {
  const chapters = await db.chapters.where('project_id').equals(projectId).sortBy('order_index');
  const targetChapter = chapters.find((chapter) => chapter.id === chapterId);
  if (!targetChapter) return [];

  const downstream = chapters.filter((chapter) => chapter.order_index > targetChapter.order_index);
  const invalidatedIds = [];
  for (const chapter of downstream) {
    const commit = await db.chapter_commits
      .where('[project_id+chapter_id]')
      .equals([projectId, chapter.id])
      .first();
    if (!commit || !commit.canonical_revision_id) continue;
    invalidatedIds.push(chapter.id);
    await db.chapter_commits.update(commit.id, {
      status: CHAPTER_COMMIT_STATUS.INVALIDATED,
      updated_at: Date.now(),
    });
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.INVALIDATED,
      updated_at: Date.now(),
    });
  }
  return invalidatedIds;
}

export async function rebuildCanonFromChapter(projectId, chapterId = null) {
  const chapters = await db.chapters.where('project_id').equals(projectId).sortBy('order_index');
  const commits = await db.chapter_commits.where('project_id').equals(projectId).toArray();
  const canonicalCommits = commits
    .filter((commit) => commit.canonical_revision_id && commit.status === CHAPTER_COMMIT_STATUS.CANONICAL)
    .sort((a, b) => {
      const chapterA = chapters.find((chapter) => chapter.id === a.chapter_id);
      const chapterB = chapters.find((chapter) => chapter.id === b.chapter_id);
      return (chapterA?.order_index || 0) - (chapterB?.order_index || 0);
    });

  const baseCharacters = await db.characters.where('project_id').equals(projectId).toArray();
  const baseThreads = await db.plotThreads.where('project_id').equals(projectId).toArray();
  const baseFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();
  const { entityMap, threadMap } = buildStateMaps(
    baseCharacters.map((character) => createInitialEntityState(character)),
    baseThreads.map((thread) => createInitialThreadState(thread))
  );
  let factStates = buildFactStates(baseFacts);
  const timelineEvents = [];

  await clearCanonProjection(projectId);

  for (const commit of canonicalCommits) {
    const chapter = chapters.find((item) => item.id === commit.chapter_id);
    if (!chapter) continue;
    const events = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();

    events
      .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || a.id - b.id)
      .forEach((event) => {
        if (event.subject_id) {
          const current = entityMap.get(event.subject_id)
            || createInitialEntityState({ id: event.subject_id, project_id: projectId });
          entityMap.set(event.subject_id, applyEventToEntityState(current, event));
        }
        if (event.target_id && event.op_type === CANON_OP_TYPES.CHARACTER_RESCUED) {
          const targetState = entityMap.get(event.target_id)
            || createInitialEntityState({ id: event.target_id, project_id: projectId });
          entityMap.set(event.target_id, applyEventToEntityState(targetState, {
            ...event,
            subject_id: event.target_id,
            summary: event.summary || 'Da duoc cuu',
          }));
        }
        if (event.thread_id) {
          const currentThread = threadMap.get(event.thread_id)
            || createInitialThreadState({ id: event.thread_id, project_id: projectId });
          threadMap.set(event.thread_id, applyEventToThreadState(currentThread, event));
        }
        factStates = applyEventToFactStates(factStates, event, chapter.order_index);
        appendCompatibilityTimeline(timelineEvents, event);
      });

    await writeSnapshot(projectId, chapter.id, commit.canonical_revision_id, {
      entityStates: toEntityStateRecords(projectId, entityMap),
      threadStates: toThreadStateRecords(projectId, threadMap),
      factStates,
    });
  }

  const finalEntityStates = toEntityStateRecords(projectId, entityMap);
  const finalThreadStates = toThreadStateRecords(projectId, threadMap);
  if (finalEntityStates.length > 0) {
    await db.entity_state_current.bulkPut(finalEntityStates);
  }
  if (finalThreadStates.length > 0) {
    await db.plot_thread_state.bulkPut(finalThreadStates);
  }
  if (timelineEvents.length > 0) {
    await db.entityTimeline.bulkAdd(timelineEvents);
  }
  await syncCompatibilityProjection(projectId, finalEntityStates, finalThreadStates);

  return {
    entityStates: finalEntityStates,
    threadStates: finalThreadStates,
    factStates,
  };
}

export async function canonicalizeChapter(projectId, chapterId) {
  const scenes = await getChapterScenes(chapterId);
  const chapterText = chapterTextFromScenes(scenes);
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const validation = await validateRevision(revision.id, 'canonicalize');
  if (validation.hasErrors) {
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, validation.reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports: validation.reports,
    };
  }

  const candidateOps = validation.candidateOps;
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
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    async () => {
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

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: validation.reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: validation.reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  await rebuildCanonFromChapter(projectId, chapterId);
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports: validation.reports,
    invalidatedChapterIds,
  };
}

export async function buildRetrievalPacket({
  projectId,
  chapterId,
  sceneId = null,
  detectedCharacterIds = [],
}) {
  const [project, chapters, chapterCommits, entityStates, threadStates, canonFacts, scenes, plotThreads] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.chapter_commits.where('project_id').equals(projectId).toArray(),
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    chapterId ? db.scenes.where('chapter_id').equals(chapterId).toArray() : Promise.resolve([]),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
  ]);

  const chapter = chapters.find((item) => item.id === chapterId) || null;
  const scene = sceneId ? scenes.find((item) => item.id === sceneId) || null : null;
  let sceneCharacters = [];
  if (scene?.characters_present) {
    try {
      sceneCharacters = JSON.parse(scene.characters_present);
    } catch {
      sceneCharacters = [];
    }
  }

  const relevantCharacterIds = uniqueList([
    ...detectedCharacterIds,
    scene?.pov_character_id,
    ...sceneCharacters,
  ]);
  const relevantEntityStates = relevantCharacterIds.length > 0
    ? entityStates.filter((state) => relevantCharacterIds.includes(state.entity_id))
    : entityStates.slice(0, 8);

  const activeThreadStates = threadStates.filter((threadState) => threadState.state !== 'resolved');
  const commit = chapterCommits.find((row) => row.chapter_id === chapterId) || null;
  const snapshots = await db.chapter_snapshots.where('project_id').equals(projectId).toArray();
  const latestSnapshot = snapshots
    .filter((item) => {
      const snapChapter = chapters.find((chapterItem) => chapterItem.id === item.chapter_id);
      return snapChapter && (!chapter || snapChapter.order_index < chapter.order_index);
    })
    .sort((a, b) => {
      const chapterA = chapters.find((item) => item.id === a.chapter_id);
      const chapterB = chapters.find((item) => item.id === b.chapter_id);
      return (chapterB?.order_index || 0) - (chapterA?.order_index || 0);
    })[0] || null;

  const factStates = collectFactStatesFromSnapshot(latestSnapshot, canonFacts)
    .map((fact) => {
      if (fact.fact_type === 'secret' && fact.revealed_at_chapter && chapter && fact.revealed_at_chapter <= chapter.order_index + 1) {
        return { ...fact, fact_type: 'fact' };
      }
      return fact;
    });

  return {
    project,
    chapter,
    chapterCommit: commit,
    relevantEntityStates,
    activeThreadStates,
    factStates,
    plotThreads,
  };
}

export async function validateSceneDraft({
  projectId,
  chapterId,
  sceneId = null,
  sceneText = '',
}) {
  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const reports = validateDraftTextAgainstTruth({
    projectId,
    chapterId,
    sceneText,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
  });

  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: sceneText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
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

export async function getChapterCanonState(projectId, chapterId) {
  const commit = await db.chapter_commits
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .first();
  if (!commit) {
    return {
      status: CHAPTER_COMMIT_STATUS.DRAFT,
      warningCount: 0,
      errorCount: 0,
      reports: [],
      revision: null,
    };
  }
  const revision = commit.current_revision_id ? await db.chapter_revisions.get(commit.current_revision_id) : null;
  const reports = commit.current_revision_id
    ? await db.validator_reports.where('[project_id+revision_id]').equals([projectId, commit.current_revision_id]).toArray()
    : [];
  return {
    status: commit.status,
    warningCount: commit.warning_count || 0,
    errorCount: commit.error_count || 0,
    reports,
    revision,
    commit,
  };
}

export async function repairChapterRevision({ projectId, chapterId, revisionId }) {
  const revision = await db.chapter_revisions.get(revisionId);
  if (!revision) {
    throw new Error('Khong tim thay revision can repair.');
  }
  const reports = await db.validator_reports
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .toArray();
  const { project, chapter } = await getChapterAndProject(projectId, chapterId);
  const messages = buildPrompt(TASK_TYPES.CANON_REPAIR, {
    projectId,
    chapterTitle: chapter?.title || '',
    projectTitle: project?.title || '',
    sceneText: revision.chapter_text || '',
    validatorReports: reports,
    genre: project?.genre_primary || '',
  });
  return sendAiTask(TASK_TYPES.CANON_REPAIR, messages, {
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
}
