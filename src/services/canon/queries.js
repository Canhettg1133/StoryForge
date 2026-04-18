import db from '../db/database';
import { CANON_SEVERITY, CHAPTER_COMMIT_STATUS } from './constants';
import { collectFactStatesFromSnapshot, loadPreChapterTruth } from './core';
import { validateDraftTextAgainstTruth } from './validation';
import {
  buildCanonChapterTextFromScenes,
  buildCanonContentSignature,
  cleanText,
  isRevisionFreshForCanonText,
  normalizeKey,
  uniqueList,
} from './utils';

const RETRIEVAL_MODE_CONFIG = {
  compact: {
    chapterMemoryCount: 1,
    entityCap: 6,
    itemCap: 6,
    relationshipCap: 4,
    chapterEventCount: 6,
    chapterEvidenceCount: 3,
    relevantEvidenceCount: 4,
    includeFullProse: false,
  },
  standard: {
    chapterMemoryCount: 2,
    entityCap: 8,
    itemCap: 8,
    relationshipCap: 6,
    chapterEventCount: 10,
    chapterEvidenceCount: 4,
    relevantEvidenceCount: 6,
    includeFullProse: true,
  },
  near_memory_3: {
    chapterMemoryCount: 3,
    entityCap: 12,
    itemCap: 10,
    relationshipCap: 8,
    chapterEventCount: 16,
    chapterEvidenceCount: 8,
    relevantEvidenceCount: 10,
    includeFullProse: true,
  },
  audit_long: {
    chapterMemoryCount: 5,
    entityCap: 20,
    itemCap: 16,
    relationshipCap: 12,
    chapterEventCount: 28,
    chapterEvidenceCount: 14,
    relevantEvidenceCount: 20,
    includeFullProse: true,
  },
};

function resolveRetrievalModeConfig(mode) {
  return RETRIEVAL_MODE_CONFIG[mode] || RETRIEVAL_MODE_CONFIG.standard;
}

export async function buildRetrievalPacket({
  projectId,
  chapterId,
  sceneId = null,
  detectedCharacterIds = [],
  detectedObjectIds = [],
  mode = 'standard',
}) {
  const modeConfig = resolveRetrievalModeConfig(mode);
  const [
    project,
    chapters,
    chapterCommits,
    entityStates,
    threadStates,
    canonFacts,
    scenes,
    plotThreads,
    objects,
    itemStates,
    relationshipStates,
    chapterMetas,
    memoryEvidence,
    storyEvents,
  ] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.chapter_commits.where('project_id').equals(projectId).toArray(),
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    chapterId ? db.scenes.where('chapter_id').equals(chapterId).toArray() : Promise.resolve([]),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
    db.chapterMeta.where('project_id').equals(projectId).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).toArray(),
    db.story_events.where('project_id').equals(projectId).toArray(),
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
  const relevantObjectIds = uniqueList([
    ...detectedObjectIds,
  ]);
  const relevantEntityStates = relevantCharacterIds.length > 0
    ? entityStates.filter((state) => relevantCharacterIds.includes(state.entity_id))
    : entityStates.slice(0, modeConfig.entityCap);
  const relevantItemStates = relevantObjectIds.length > 0
    ? itemStates.filter((state) => relevantObjectIds.includes(state.object_id))
    : itemStates.slice(0, modeConfig.itemCap);
  const relevantRelationshipStates = relevantCharacterIds.length > 0
    ? relationshipStates.filter((state) => relevantCharacterIds.includes(state.character_a_id) || relevantCharacterIds.includes(state.character_b_id))
    : relationshipStates.slice(0, modeConfig.relationshipCap);

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

  const previousChapters = chapter
    ? chapters.filter((item) => item.order_index < chapter.order_index).slice(-modeConfig.chapterMemoryCount)
    : chapters.slice(-modeConfig.chapterMemoryCount);
  const recentChapterMemory = await Promise.all(previousChapters.map(async (memoryChapter) => {
    const [chapterScenes, chapterMeta] = await Promise.all([
      db.scenes.where('chapter_id').equals(memoryChapter.id).sortBy('order_index'),
      Promise.resolve(chapterMetas.find((meta) => meta.chapter_id === memoryChapter.id) || null),
    ]);
    const prose = chapterScenes
      .map((chapterScene) => cleanText(chapterScene.draft_text || chapterScene.final_text || ''))
      .filter(Boolean)
      .join('\n\n');
    const chapterEvents = storyEvents
      .filter((event) => event.chapter_id === memoryChapter.id && event.status !== 'superseded')
      .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || (a.id || 0) - (b.id || 0))
      .slice(0, modeConfig.chapterEventCount);
    const chapterEvidence = memoryEvidence
      .filter((item) => item.chapter_id === memoryChapter.id)
      .slice(0, modeConfig.chapterEvidenceCount);
    return {
      chapter_id: memoryChapter.id,
      chapter_title: memoryChapter.title || `Chuong ${memoryChapter.order_index + 1}`,
      chapter_order: memoryChapter.order_index,
      summary: chapterMeta?.summary || memoryChapter.summary || '',
      bridge_buffer: chapterMeta?.last_prose_buffer || '',
      emotional_state: chapterMeta?.emotional_state || null,
      prose: modeConfig.includeFullProse ? prose : '',
      events: chapterEvents,
      evidence: chapterEvidence,
    };
  }));

  const recentChapterIds = new Set(previousChapters.map((item) => item.id));
  const relevantEvidence = memoryEvidence
    .filter((item) => recentChapterIds.has(item.chapter_id))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, modeConfig.relevantEvidenceCount);

  const criticalConstraints = {
    deadCharacters: entityStates
      .filter((state) => state.alive_status === 'dead')
      .map((state) => state.entity_id),
    locationAnchors: relevantEntityStates
      .filter((state) => state.current_location_name)
      .map((state) => ({
        entity_id: state.entity_id,
        location_name: state.current_location_name,
      })),
    unavailableItems: relevantItemStates
      .filter((state) => state.is_consumed || ['consumed', 'destroyed', 'lost'].includes(cleanText(state.availability)))
      .map((state) => ({
        object_id: state.object_id,
        object_name: objects.find((object) => object.id === state.object_id)?.name || '',
        availability: state.availability,
      })),
    resolvedThreads: threadStates
      .filter((state) => state.state === 'resolved')
      .map((state) => state.thread_id),
    revealedFacts: factStates
      .filter((fact) => fact.fact_type === 'fact')
      .map((fact) => ({
        id: fact.id,
        description: fact.description,
      })),
    relationshipConstraints: relevantRelationshipStates.map((state) => ({
      pair_key: state.pair_key,
      intimacy_level: state.intimacy_level,
      secrecy_state: state.secrecy_state,
      consent_state: state.consent_state,
      emotional_aftermath: state.emotional_aftermath,
      summary: state.summary,
    })),
  };

  return {
    retrievalMode: mode,
    project,
    chapter,
    chapterCommit: commit,
    relevantEntityStates,
    relevantItemStates,
    relevantRelationshipStates,
    activeThreadStates,
    factStates,
    plotThreads,
    recentChapterMemory,
    relevantEvidence,
    criticalConstraints,
  };
}

const SPENT_ITEM_REPORT_RULE = 'DRAFT_REFERENCES_SPENT_ITEM';

async function filterObsoleteSpentItemReports(projectId, chapterId, revision, reports, fallbackText) {
  if (!reports.some((report) => report.rule_code === SPENT_ITEM_REPORT_RULE)) {
    return reports;
  }

  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const currentSpentItemReports = validateDraftTextAgainstTruth({
    projectId,
    chapterId,
    revisionId: revision?.id || null,
    sceneText: revision?.chapter_text || fallbackText || '',
    threadStates: [],
    factStates: [],
    characters: [],
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
  }).filter((report) => report.rule_code === SPENT_ITEM_REPORT_RULE);
  const activeMessages = new Set(currentSpentItemReports.map((report) => normalizeKey(report.message)));

  return reports.filter((report) => (
    report.rule_code !== SPENT_ITEM_REPORT_RULE
    || activeMessages.has(normalizeKey(report.message))
  ));
}

async function pruneObsoleteRevisionReports(projectId, revisionId, originalReports, filteredReports) {
  const filteredIdSet = new Set(filteredReports.map((report) => report.id).filter(Boolean));
  const obsoleteIds = originalReports
    .map((report) => report.id)
    .filter((id) => id && !filteredIdSet.has(id));
  if (obsoleteIds.length === 0) return;
  await db.validator_reports.bulkDelete(obsoleteIds);
}

export async function getChapterCanonState(projectId, chapterId) {
  const scenes = chapterId && db.scenes?.where
    ? await db.scenes.where('chapter_id').equals(chapterId).sortBy('order_index')
    : [];
  const currentChapterText = buildCanonChapterTextFromScenes(scenes);
  const currentContentSignature = buildCanonContentSignature(currentChapterText);
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
      canonicalRevision: null,
      currentContentSignature,
      revisionContentSignature: '',
      isFresh: false,
      isStale: false,
    };
  }
  const revision = commit.current_revision_id ? await db.chapter_revisions.get(commit.current_revision_id) : null;
  const canonicalRevision = commit.canonical_revision_id && commit.canonical_revision_id !== commit.current_revision_id
    ? await db.chapter_revisions.get(commit.canonical_revision_id)
    : (commit.canonical_revision_id ? revision : null);
  const freshnessRevision = canonicalRevision || revision;
  const revisionContentSignature = freshnessRevision?.content_signature
    || buildCanonContentSignature(freshnessRevision?.chapter_text || '');
  const isFresh = isRevisionFreshForCanonText(freshnessRevision, currentChapterText);
  const storedReports = commit.current_revision_id
    ? await db.validator_reports.where('[project_id+revision_id]').equals([projectId, commit.current_revision_id]).toArray()
    : [];
  const reports = await filterObsoleteSpentItemReports(
    projectId,
    chapterId,
    revision,
    storedReports,
    currentChapterText
  );
  if (reports.length !== storedReports.length && commit.current_revision_id) {
    await pruneObsoleteRevisionReports(projectId, commit.current_revision_id, storedReports, reports);
  }
  const warningCount = reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length;
  const errorCount = reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length;
  const effectiveStatus = commit.status === CHAPTER_COMMIT_STATUS.HAS_WARNINGS && warningCount === 0 && errorCount === 0
    ? CHAPTER_COMMIT_STATUS.CANONICAL
    : (commit.status === CHAPTER_COMMIT_STATUS.BLOCKED && errorCount === 0
      ? (warningCount > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL)
      : commit.status);
  return {
    status: effectiveStatus,
    warningCount,
    errorCount,
    reports,
    revision,
    canonicalRevision,
    commit,
    currentContentSignature,
    revisionContentSignature,
    isFresh,
    isStale: Boolean(freshnessRevision && !isFresh),
  };
}

export async function getProjectCanonOverview(projectId, { limit = 12 } = {}) {
  const [
    chapters,
    plotThreads,
    objects,
    commits,
    revisions,
    events,
    reports,
    evidence,
    entityStates,
    threadStates,
    itemStates,
    relationshipStates,
    purgeArchives,
  ] = await Promise.all([
    db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.chapter_commits.where('project_id').equals(projectId).toArray(),
    db.chapter_revisions.where('project_id').equals(projectId).toArray(),
    db.story_events.where('project_id').equals(projectId).toArray(),
    db.validator_reports.where('project_id').equals(projectId).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).toArray(),
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
    db.canon_purge_archives.where('project_id').equals(projectId).toArray(),
  ]);

  const chapterMap = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const threadMap = new Map(plotThreads.map((thread) => [thread.id, thread]));
  const revisionMap = new Map(revisions.map((revision) => [revision.id, revision]));
  const objectMap = new Map(objects.map((object) => [object.id, object]));

  const chapterCommits = commits
    .map((commit) => {
      const chapter = chapterMap.get(commit.chapter_id) || null;
      return {
        ...commit,
        chapter_title: chapter?.title || `Chuong ${chapter?.order_index || commit.chapter_id}`,
        chapter_order: chapter?.order_index || 0,
        current_revision: revisionMap.get(commit.current_revision_id) || null,
        canonical_revision: revisionMap.get(commit.canonical_revision_id) || null,
      };
    })
    .sort((a, b) => a.chapter_order - b.chapter_order);

  const activeReportsByRevision = await Promise.all(chapterCommits
    .filter((commit) => commit.current_revision_id)
    .map(async (commit) => {
      const revision = revisionMap.get(commit.current_revision_id) || null;
      const revisionReports = reports.filter((report) => report.revision_id === commit.current_revision_id);
      const filteredReports = await filterObsoleteSpentItemReports(
        projectId,
        commit.chapter_id,
        revision,
        revisionReports,
        revision?.chapter_text || ''
      );
      if (filteredReports.length !== revisionReports.length) {
        await pruneObsoleteRevisionReports(projectId, commit.current_revision_id, revisionReports, filteredReports);
      }
      return filteredReports;
    }));
  const activeReports = activeReportsByRevision.flat();
  const activeReportCountByRevision = new Map(chapterCommits
    .filter((commit) => commit.current_revision_id)
    .map((commit, index) => [
      commit.current_revision_id,
      {
        warningCount: activeReportsByRevision[index].filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        errorCount: activeReportsByRevision[index].filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
      },
    ]));
  const effectiveChapterCommits = chapterCommits.map((commit) => {
    const counts = activeReportCountByRevision.get(commit.current_revision_id) || { warningCount: 0, errorCount: 0 };
    const status = commit.status === CHAPTER_COMMIT_STATUS.HAS_WARNINGS && counts.warningCount === 0 && counts.errorCount === 0
      ? CHAPTER_COMMIT_STATUS.CANONICAL
      : (commit.status === CHAPTER_COMMIT_STATUS.BLOCKED && counts.errorCount === 0
        ? (counts.warningCount > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL)
        : commit.status);
    return {
      ...commit,
      status,
      warning_count: counts.warningCount,
      error_count: counts.errorCount,
    };
  });

  const recentEvents = events
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((event) => {
      const chapter = chapterMap.get(event.chapter_id) || null;
      return {
        ...event,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
        thread_title: threadMap.get(event.thread_id)?.title || event.thread_title || '',
      };
    });

  const recentReports = activeReports
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((report) => {
      const chapter = chapterMap.get(report.chapter_id) || null;
      return {
        ...report,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
      };
    });

  const recentEvidence = evidence
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((item) => {
      const chapter = chapterMap.get(item.chapter_id) || null;
      return {
        ...item,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
      };
    });

  const recentRevisions = revisions
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit)
    .map((revision) => {
      const chapter = chapterMap.get(revision.chapter_id) || null;
      return {
        ...revision,
        chapter_title: chapter?.title || '',
        chapter_order: chapter?.order_index || 0,
      };
    });

  const decoratedThreadStates = threadStates
    .map((threadState) => ({
      ...threadState,
      thread_title: threadMap.get(threadState.thread_id)?.title || threadState.summary || `Thread ${threadState.thread_id}`,
    }))
    .sort((a, b) => String(a.thread_title || '').localeCompare(String(b.thread_title || '')));

  const decoratedItemStates = itemStates
    .map((itemState) => ({
      ...itemState,
      object_name: objectMap.get(itemState.object_id)?.name || `Vat pham ${itemState.object_id}`,
    }))
    .sort((a, b) => String(a.object_name || '').localeCompare(String(b.object_name || '')));

  const decoratedRelationshipStates = relationshipStates
    .map((state) => ({
      ...state,
      intimacy_level: state.intimacy_level === 'none' ? '' : state.intimacy_level,
      consent_state: (!state.intimacy_level || state.intimacy_level === 'none' || ['unknown', 'unclear'].includes(state.consent_state))
        ? ''
        : state.consent_state,
    }))
    .sort((a, b) => String(a.pair_key || '').localeCompare(String(b.pair_key || '')));

  const criticalConstraints = {
    deadCharacters: entityStates.filter((state) => state.alive_status === 'dead'),
    blockedItems: decoratedItemStates.filter((state) => state.is_consumed || ['consumed', 'destroyed', 'lost'].includes(cleanText(state.availability))),
    sensitiveRelationships: decoratedRelationshipStates.filter((state) => (
      (state.intimacy_level && state.intimacy_level !== 'none')
      || (state.secrecy_state && state.secrecy_state !== 'public')
      || (state.emotional_aftermath && cleanText(state.emotional_aftermath))
    )),
    activeWarnings: activeReports.filter((report) => report.severity === CANON_SEVERITY.WARNING || report.severity === CANON_SEVERITY.ERROR)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, limit),
  };

  const stats = {
    chapter_count: chapters.length,
    canonical_count: effectiveChapterCommits.filter((commit) => commit.status === CHAPTER_COMMIT_STATUS.CANONICAL).length,
    blocked_count: effectiveChapterCommits.filter((commit) => commit.status === CHAPTER_COMMIT_STATUS.BLOCKED).length,
    invalidated_count: effectiveChapterCommits.filter((commit) => commit.status === CHAPTER_COMMIT_STATUS.INVALIDATED).length,
    warning_count: activeReports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
    error_count: activeReports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
    event_count: events.length,
    evidence_count: evidence.length,
    revision_count: revisions.length,
    item_count: decoratedItemStates.length,
    relationship_count: decoratedRelationshipStates.length,
    purge_archive_count: purgeArchives.length,
  };

  const recentPurgeArchives = purgeArchives
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, Math.max(3, Math.min(limit, 8)))
    .map((item) => {
      let payload = null;
      try {
        payload = typeof item.payload_json === 'string' ? JSON.parse(item.payload_json) : item.payload_json;
      } catch {
        payload = null;
      }
      return {
        ...item,
        payload,
      };
    });

  return {
    stats,
    chapterCommits: effectiveChapterCommits,
    entityStates: entityStates.slice().sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id))),
    threadStates: decoratedThreadStates,
    itemStates: decoratedItemStates,
    relationshipStates: decoratedRelationshipStates,
    recentEvents,
    recentReports,
    recentEvidence,
    recentRevisions,
    recentPurgeArchives,
    plotThreads,
    criticalConstraints,
  };
}

export async function getChapterRevisionHistory(projectId, chapterId) {
  const [chapter, commit, revisions, reports, events, evidence, snapshots] = await Promise.all([
    db.chapters.get(chapterId),
    db.chapter_commits.where('[project_id+chapter_id]').equals([projectId, chapterId]).first(),
    db.chapter_revisions.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.validator_reports.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.story_events.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).filter((item) => item.chapter_id === chapterId).toArray(),
    db.chapter_snapshots.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
  ]);

  const history = revisions
    .map((revision) => ({
      ...revision,
      report_count: reports.filter((report) => report.revision_id === revision.id).length,
      event_count: events.filter((event) => event.revision_id === revision.id).length,
      evidence_count: evidence.filter((item) => item.revision_id === revision.id).length,
      has_snapshot: snapshots.some((snapshot) => snapshot.revision_id === revision.id),
      is_current: commit?.current_revision_id === revision.id,
      is_canonical: commit?.canonical_revision_id === revision.id,
    }))
    .sort((a, b) => (b.revision_number || 0) - (a.revision_number || 0) || (b.created_at || 0) - (a.created_at || 0));

  return {
    chapter,
    commit,
    revisions: history,
  };
}

export async function getChapterRevisionDetail(projectId, revisionId) {
  const revision = await db.chapter_revisions.get(revisionId);
  if (!revision || revision.project_id !== projectId) return null;

  const [chapter, commit, reports, events, evidence, snapshot] = await Promise.all([
    db.chapters.get(revision.chapter_id),
    db.chapter_commits.where('[project_id+chapter_id]').equals([projectId, revision.chapter_id]).first(),
    db.validator_reports.where('[project_id+revision_id]').equals([projectId, revisionId]).toArray(),
    db.story_events.where('[project_id+revision_id]').equals([projectId, revisionId]).toArray(),
    db.memory_evidence.where('[project_id+revision_id]').equals([projectId, revisionId]).toArray(),
    db.chapter_snapshots.where('[project_id+revision_id]').equals([projectId, revisionId]).first(),
  ]);

  let snapshotData = null;
  if (snapshot?.snapshot_json) {
    try {
      snapshotData = typeof snapshot.snapshot_json === 'string'
        ? JSON.parse(snapshot.snapshot_json)
        : snapshot.snapshot_json;
    } catch {
      snapshotData = null;
    }
  }

  const sortedEvents = events
    .slice()
    .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || (a.id || 0) - (b.id || 0));

  const sortedEvidence = evidence
    .slice()
    .sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0) || (a.id || 0) - (b.id || 0));

  return {
    chapter,
    commit,
    revision: {
      ...revision,
      is_current: commit?.current_revision_id === revision.id,
      is_canonical: commit?.canonical_revision_id === revision.id,
    },
    reports: reports.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    events: sortedEvents,
    evidence: sortedEvidence,
    snapshot,
    snapshotData,
  };
}
