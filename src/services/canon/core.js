import db from '../db/database';
import { normalizeCanonFactRecord } from '../entityIdentity/factIdentity.js';
import {
  CANON_REPORT_STATUS,
  CANON_SEVERITY,
  CHAPTER_COMMIT_STATUS,
} from './constants';
import {
  createInitialEntityState,
  createInitialItemState,
  createInitialRelationshipState,
  createInitialThreadState,
} from './state';
import { cleanText, uniqueList } from './utils';

export const CANON_MIN_CONFIDENCE = 0.55;

export function loadSnapshotValue(snapshot, key, fallback) {
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

export function createReport({
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

export function buildFactStates(canonFacts) {
  return (canonFacts || []).map((fact) => ({
    ...fact,
    ...normalizeCanonFactRecord(fact),
  }));
}

export function collectFactStatesFromSnapshot(snapshot, canonFacts) {
  const snapshotFacts = loadSnapshotValue(snapshot, 'factStates', null);
  return Array.isArray(snapshotFacts) ? snapshotFacts.map((fact) => ({ ...fact })) : buildFactStates(canonFacts);
}

export function loadRevisionOps(revision) {
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

export async function getChapterScenes(chapterId) {
  return db.scenes.where('chapter_id').equals(chapterId).sortBy('order_index');
}

export async function getChapterAndProject(projectId, chapterId) {
  const [project, chapter] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.get(chapterId),
  ]);
  return { project, chapter };
}

export async function getOrCreateChapterCommit(projectId, chapterId) {
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

export async function updateChapterCommitSummary(projectId, chapterId, status, reports, revisionId) {
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

export async function replaceValidatorReports(projectId, revisionId, reports) {
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

export async function loadPreChapterTruth(projectId, chapterId) {
  const [characters, locations, plotThreads, canonFacts, chapters, objects, relationships] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.relationships.where('project_id').equals(projectId).toArray(),
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
  const itemStates = snapshot
    ? loadSnapshotValue(snapshot, 'itemStates', []).map((state) => ({ ...state }))
    : objects.map((object) => createInitialItemState(object));
  const relationshipStates = snapshot
    ? loadSnapshotValue(snapshot, 'relationshipStates', []).map((state) => ({ ...state }))
    : relationships.map((relationship) => createInitialRelationshipState(relationship));

  return {
    chapter,
    chapterOrder,
    chapters,
    characters,
    locations,
    plotThreads,
    objects,
    relationships,
    canonFacts,
    entityStates,
    threadStates,
    factStates,
    itemStates,
    relationshipStates,
  };
}

export async function writeSnapshot(projectId, chapterId, revisionId, snapshot) {
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
