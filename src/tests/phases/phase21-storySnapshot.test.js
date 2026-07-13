import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '../../services/db/database.js';
import { exportProject, importProject } from '../../services/db/exportImport.js';

async function resetDatabase() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

async function createProject(title = 'Snapshot source') {
  return db.projects.add({
    title,
    genre_primary: 'fantasy',
    status: 'draft',
    created_at: 1,
    updated_at: 1,
  });
}

describe('phase21 project snapshot schema 8', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (db.isOpen()) db.close();
    await db.delete();
  });

  it('exports every durable project table that legacy schema 7 omitted', async () => {
    const projectId = await createProject();
    const chapterId = await db.chapters.add({ project_id: projectId, title: 'Chapter', order_index: 1 });
    const sceneId = await db.scenes.add({ project_id: projectId, chapter_id: chapterId, title: 'Scene', order_index: 1 });
    const characterId = await db.characters.add({ project_id: projectId, name: 'Linh' });
    const threadId = await db.plotThreads.add({ project_id: projectId, title: 'Main thread' });
    const revisionId = await db.chapter_revisions.add({ project_id: projectId, chapter_id: chapterId, revision_number: 1 });

    await Promise.all([
      db.characterStates.add({ project_id: projectId, character_id: characterId, scene_id: sceneId, state: 'ready' }),
      db.timelineEvents.add({ project_id: projectId, scene_id: sceneId, date_marker: 'Day 1' }),
      db.stylePacks.add({ project_id: projectId, name: 'Narration', type: 'project' }),
      db.voicePacks.add({ project_id: projectId, character_id: characterId, name: 'Linh voice' }),
      db.revisions.add({ scene_id: sceneId, objective: 'legacy revision', created_at: 1 }),
      db.qaReports.add({ project_id: projectId, chapter_id: chapterId, scene_id: sceneId, report_type: 'continuity' }),
      db.linked_events.add({ project_id: projectId, event_id: 'event-1', corpus_id: 'corpus-1', chapter_id: chapterId, scene_id: sceneId }),
      db.project_analysis_snapshots.add({ project_id: projectId, corpus_id: 'corpus-1', analysis_id: 'analysis-1' }),
      db.canon_purge_archives.add({ project_id: projectId, chapter_id: chapterId, payload: '{}' }),
      db.entity_resolution_candidates.add({
        project_id: projectId,
        chapter_id: chapterId,
        revision_id: revisionId,
        entity_kind: 'character',
        matched_entity_id: characterId,
      }),
      db.threadBeats.add({ plot_thread_id: threadId, scene_id: sceneId, beat_type: 'turn' }),
    ]);

    const snapshot = JSON.parse(await exportProject(projectId));

    expect(snapshot._storyforge_version).toBe(8);
    expect(snapshot.characterStates).toHaveLength(1);
    expect(snapshot.timelineEvents).toHaveLength(1);
    expect(snapshot.stylePacks).toHaveLength(1);
    expect(snapshot.voicePacks).toHaveLength(1);
    expect(snapshot.revisions).toHaveLength(1);
    expect(snapshot.qaReports).toHaveLength(1);
    expect(snapshot.linked_events).toHaveLength(1);
    expect(snapshot.project_analysis_snapshots).toHaveLength(1);
    expect(snapshot.canon_purge_archives).toHaveLength(1);
    expect(snapshot.entity_resolution_candidates).toHaveLength(1);
  });

  it('remaps hierarchy and typed object references instead of retaining source IDs', async () => {
    const source = {
      _storyforge_version: 7,
      project: { id: 10, title: 'Remap source', status: 'draft' },
      chapters: [{ id: 20, project_id: 10, title: 'Chapter', order_index: 1 }],
      scenes: [{ id: 30, project_id: 10, chapter_id: 20, title: 'Scene', order_index: 1 }],
      locations: [
        { id: 40, project_id: 10, name: 'Parent' },
        { id: 41, project_id: 10, name: 'Child', parent_location_id: 40 },
      ],
      objects: [{ id: 50, project_id: 10, name: 'Sword', current_location_id: 41 }],
      worldTerms: [{ id: 60, project_id: 10, name: 'Mana', category: 'magic' }],
      factions: [{ id: 70, project_id: 10, name: 'Guild' }],
      canonFacts: [
        { id: 80, project_id: 10, subject_type: 'object', subject_id: 50, fact_type: 'state', value: 'awake' },
        { id: 81, project_id: 10, subject_type: 'world_term', subject_id: 60, fact_type: 'rule', value: 'rare' },
        { id: 82, project_id: 10, subject_type: 'faction', subject_id: 70, fact_type: 'rule', value: 'secret' },
      ],
      entityTimeline: [{ id: 90, project_id: 10, entity_type: 'object', entity_id: 50, chapter_id: 20 }],
      story_events: [{
        id: 100,
        project_id: 10,
        chapter_id: 20,
        scene_id: 30,
        op_type: 'OBJECT_MOVED',
        object_id: 50,
        location_id: 41,
        fact_id: 80,
      }],
    };

    const importedProjectId = await importProject(JSON.stringify(source), { titleMode: 'original' });
    const importedLocations = await db.locations.where('project_id').equals(importedProjectId).sortBy('id');
    const importedObject = await db.objects.where('project_id').equals(importedProjectId).first();
    const importedTerm = await db.worldTerms.where('project_id').equals(importedProjectId).first();
    const importedFaction = await db.factions.where('project_id').equals(importedProjectId).first();
    const importedFacts = await db.canonFacts.where('project_id').equals(importedProjectId).sortBy('id');
    const importedTimeline = await db.entityTimeline.where('project_id').equals(importedProjectId).first();
    const importedEvent = await db.story_events.where('project_id').equals(importedProjectId).first();

    expect(importedLocations[1].parent_location_id).toBe(importedLocations[0].id);
    expect(importedLocations[1].parent_location_id).not.toBe(40);
    expect(importedTimeline.entity_id).toBe(importedObject.id);
    expect(importedEvent.object_id).toBe(importedObject.id);
    expect(importedEvent.location_id).toBe(importedLocations[1].id);
    expect(importedEvent.fact_id).toBe(importedFacts[0].id);
    expect(importedFacts.map((fact) => fact.subject_id)).toEqual([
      importedObject.id,
      importedTerm.id,
      importedFaction.id,
    ]);
  });

  it('rolls back a replace import when a write fails midway', async () => {
    const targetProjectId = await createProject('Target project');
    const targetChapterId = await db.chapters.add({
      project_id: targetProjectId,
      title: 'Keep me',
      order_index: 1,
    });
    const incoming = {
      _storyforge_version: 7,
      project: { id: 100, title: 'Incoming project', status: 'draft' },
      chapters: [{ id: 200, project_id: 100, title: 'Incoming chapter', order_index: 1 }],
      scenes: [{ id: 300, project_id: 100, chapter_id: 200, title: 'Incoming scene', order_index: 1 }],
    };
    vi.spyOn(db.scenes, 'add').mockRejectedValueOnce(new Error('injected write failure'));

    await expect(importProject(JSON.stringify(incoming), {
      replaceProjectId: targetProjectId,
      titleMode: 'original',
    })).rejects.toThrow('injected write failure');

    expect(await db.projects.toArray()).toEqual([
      expect.objectContaining({ id: targetProjectId, title: 'Target project' }),
    ]);
    expect(await db.chapters.toArray()).toEqual([
      expect.objectContaining({ id: targetChapterId, project_id: targetProjectId, title: 'Keep me' }),
    ]);
    expect(await db.scenes.count()).toBe(0);
  });
});
