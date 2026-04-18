import db from '../db/database';
import { CANON_OP_TYPES, CHAPTER_COMMIT_STATUS, CHAPTER_REVISION_STATUS } from './constants';
import { buildFactStates, writeSnapshot } from './core';
import {
  applyEventToEntityState,
  applyEventToFactStates,
  applyEventToItemState,
  applyEventToRelationshipState,
  applyEventToThreadState,
  buildRelationshipPairKey,
  createInitialEntityState,
  createInitialItemState,
  createInitialRelationshipState,
  createInitialThreadState,
  inferAliveStatus,
  isLivenessSummaryChunk,
} from './state';
import { cleanText, cloneValue, uniqueSummaryParts } from './utils';

function buildStateMaps(entityStates, threadStates) {
  const entityMap = new Map(entityStates.map((state) => [state.entity_id, cloneValue(state)]));
  const threadMap = new Map(threadStates.map((state) => [state.thread_id, cloneValue(state)]));
  return { entityMap, threadMap };
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

function cleanLegacyProjectionStatus(value) {
  const parts = uniqueSummaryParts([value]);
  if (parts.length === 0) return cleanText(value);
  const hasAliveLabel = parts.some((part) => isLivenessSummaryChunk(part, 'dead'));
  const hasDeadLabel = parts.some((part) => isLivenessSummaryChunk(part, 'alive'));
  if (!hasAliveLabel || !hasDeadLabel) {
    return cleanText(value);
  }
  const aliveStatus = inferAliveStatus(value);
  return uniqueSummaryParts(parts.filter((part) => !isLivenessSummaryChunk(part, aliveStatus))).join(' | ');
}

async function cleanLegacyCharacterProjection(projectId) {
  const characters = await db.characters.where('project_id').equals(projectId).toArray();
  await Promise.all(characters.map((character) => {
    const currentStatus = cleanText(character.current_status || '');
    if (!currentStatus) return Promise.resolve();
    const cleanedStatus = cleanLegacyProjectionStatus(currentStatus);
    if (!cleanedStatus || cleanedStatus === currentStatus) return Promise.resolve();
    return db.characters.update(character.id, {
      current_status: cleanedStatus,
      updated_at: Date.now(),
    });
  }));
}

async function clearCanonProjection(projectId) {
  const [entityRows, threadRows, itemRows, relationshipRows, timelineRows, snapshotRows] = await Promise.all([
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
    db.entityTimeline.where('project_id').equals(projectId).toArray(),
    db.chapter_snapshots.where('project_id').equals(projectId).toArray(),
  ]);

  await Promise.all([
    entityRows.length > 0 ? db.entity_state_current.bulkDelete(entityRows.map((row) => row.id)) : Promise.resolve(),
    threadRows.length > 0 ? db.plot_thread_state.bulkDelete(threadRows.map((row) => row.id)) : Promise.resolve(),
    itemRows.length > 0 ? db.item_state_current.bulkDelete(itemRows.map((row) => row.id)) : Promise.resolve(),
    relationshipRows.length > 0 ? db.relationship_state_current.bulkDelete(relationshipRows.map((row) => row.id)) : Promise.resolve(),
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

async function bulkDeleteByIds(table, rows = []) {
  if (!rows.length) return;
  await table.bulkDelete(rows.map((row) => row.id));
}

function buildPurgeArchivePayload(payload = {}) {
  return JSON.stringify(payload);
}

export async function purgeChapterCanonState(projectId, chapterId) {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter || chapter.project_id !== projectId) {
    return null;
  }

  const [
    commit,
    revisions,
    events,
    reports,
    evidence,
    snapshots,
    sourceFacts,
    sourceCharacters,
    sourceLocations,
    sourceTerms,
    sourceObjects,
  ] = await Promise.all([
    db.chapter_commits.where('[project_id+chapter_id]').equals([projectId, chapterId]).first(),
    db.chapter_revisions.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.story_events.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.validator_reports.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).filter((item) => item.chapter_id === chapterId).toArray(),
    db.chapter_snapshots.where('[project_id+chapter_id]').equals([projectId, chapterId]).toArray(),
    db.canonFacts.where('project_id').equals(projectId).filter((fact) => fact.source_chapter_id === chapterId).toArray(),
    db.characters.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
    db.locations.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
    db.worldTerms.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
    db.objects.where('project_id').equals(projectId).filter((item) => item.source_chapter_id === chapterId && item.source_kind === 'chapter_extract').toArray(),
  ]);

  const warnings = [
    'Manual or legacy codex entries without source provenance were preserved for review.',
  ];

  const archivePayload = {
    chapter: {
      id: chapter.id,
      title: chapter.title || '',
      order_index: chapter.order_index ?? null,
    },
    removed: {
      chapter_commit: commit ? cloneValue(commit) : null,
      chapter_revisions: revisions.map((item) => cloneValue(item)),
      story_events: events.map((item) => cloneValue(item)),
      validator_reports: reports.map((item) => cloneValue(item)),
      memory_evidence: evidence.map((item) => cloneValue(item)),
      chapter_snapshots: snapshots.map((item) => cloneValue(item)),
      canon_facts: sourceFacts.map((item) => cloneValue(item)),
      characters: sourceCharacters.map((item) => cloneValue(item)),
      locations: sourceLocations.map((item) => cloneValue(item)),
      world_terms: sourceTerms.map((item) => cloneValue(item)),
      objects: sourceObjects.map((item) => cloneValue(item)),
    },
    warnings,
  };

  await db.transaction(
    'rw',
    db.chapter_commits,
    db.chapter_revisions,
    db.story_events,
    db.validator_reports,
    db.memory_evidence,
    db.chapter_snapshots,
    db.canonFacts,
    db.characters,
    db.locations,
    db.worldTerms,
    db.objects,
    db.canon_purge_archives,
    async () => {
      if (commit?.id) {
        await db.chapter_commits.delete(commit.id);
      }
      await Promise.all([
        bulkDeleteByIds(db.chapter_revisions, revisions),
        bulkDeleteByIds(db.story_events, events),
        bulkDeleteByIds(db.validator_reports, reports),
        bulkDeleteByIds(db.memory_evidence, evidence),
        bulkDeleteByIds(db.chapter_snapshots, snapshots),
        bulkDeleteByIds(db.canonFacts, sourceFacts),
        bulkDeleteByIds(db.characters, sourceCharacters),
        bulkDeleteByIds(db.locations, sourceLocations),
        bulkDeleteByIds(db.worldTerms, sourceTerms),
        bulkDeleteByIds(db.objects, sourceObjects),
      ]);

      await db.canon_purge_archives.add({
        project_id: projectId,
        chapter_id: chapterId,
        chapter_title: chapter.title || '',
        chapter_order_index: chapter.order_index ?? null,
        warnings,
        removed_counts: {
          revisions: revisions.length,
          events: events.length,
          reports: reports.length,
          evidence: evidence.length,
          snapshots: snapshots.length,
          facts: sourceFacts.length,
          characters: sourceCharacters.length,
          locations: sourceLocations.length,
          world_terms: sourceTerms.length,
          objects: sourceObjects.length,
        },
        payload_json: buildPurgeArchivePayload(archivePayload),
        created_at: Date.now(),
      });
    },
  );

  return archivePayload;
}

export async function rebuildCanonFromChapter(projectId, chapterId = null, options = {}) {
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
  const baseObjects = await db.objects.where('project_id').equals(projectId).toArray();
  const baseRelationships = await db.relationships.where('project_id').equals(projectId).toArray();
  const { entityMap, threadMap } = buildStateMaps(
    baseCharacters.map((character) => createInitialEntityState(character)),
    baseThreads.map((thread) => createInitialThreadState(thread))
  );
  const itemMap = new Map(baseObjects.map((object) => [object.id, createInitialItemState(object)]));
  const relationshipMap = new Map(
    baseRelationships.map((relationship) => [
      buildRelationshipPairKey(relationship.character_a_id, relationship.character_b_id),
      createInitialRelationshipState(relationship),
    ])
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
        if (event.object_id) {
          const currentItem = itemMap.get(event.object_id)
            || createInitialItemState({ id: event.object_id, project_id: projectId });
          itemMap.set(event.object_id, applyEventToItemState(currentItem, event));
        }
        if (event.subject_id && event.target_id && [
          CANON_OP_TYPES.RELATIONSHIP_STATUS_CHANGED,
          CANON_OP_TYPES.RELATIONSHIP_SECRET_CHANGED,
          CANON_OP_TYPES.INTIMACY_LEVEL_CHANGED,
        ].includes(event.op_type)) {
          const pairKey = buildRelationshipPairKey(event.subject_id, event.target_id);
          const currentRelationship = relationshipMap.get(pairKey)
            || createInitialRelationshipState({
              project_id: projectId,
              character_a_id: Math.min(event.subject_id, event.target_id),
              character_b_id: Math.max(event.subject_id, event.target_id),
            });
          relationshipMap.set(pairKey, applyEventToRelationshipState(currentRelationship, event));
        }
        factStates = applyEventToFactStates(factStates, event, chapter.order_index);
        appendCompatibilityTimeline(timelineEvents, event);
      });

    await writeSnapshot(projectId, chapter.id, commit.canonical_revision_id, {
      entityStates: toEntityStateRecords(projectId, entityMap),
      threadStates: toThreadStateRecords(projectId, threadMap),
      factStates,
      itemStates: Array.from(itemMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() })),
      relationshipStates: Array.from(relationshipMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() })),
    });
  }

  const finalEntityStates = toEntityStateRecords(projectId, entityMap);
  const finalThreadStates = toThreadStateRecords(projectId, threadMap);
  const finalItemStates = Array.from(itemMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() }));
  const finalRelationshipStates = Array.from(relationshipMap.values()).map((state) => ({ ...state, project_id: projectId, updated_at: Date.now() }));
  if (finalEntityStates.length > 0) {
    await db.entity_state_current.bulkPut(finalEntityStates);
  }
  if (finalThreadStates.length > 0) {
    await db.plot_thread_state.bulkPut(finalThreadStates);
  }
  if (finalItemStates.length > 0) {
    await db.item_state_current.bulkPut(finalItemStates);
  }
  if (finalRelationshipStates.length > 0) {
    await db.relationship_state_current.bulkPut(finalRelationshipStates);
  }
  if (timelineEvents.length > 0) {
    await db.entityTimeline.bulkAdd(timelineEvents);
  }
  if (options.cleanLegacyProjection) {
    await cleanLegacyCharacterProjection(projectId);
  }

  return {
    entityStates: finalEntityStates,
    threadStates: finalThreadStates,
    factStates,
    itemStates: finalItemStates,
    relationshipStates: finalRelationshipStates,
  };
}
