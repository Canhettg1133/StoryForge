/**
 * StoryForge — Project Export/Import (Phase 9)
 * 
 * JSON backup of entire project data.
 * Version 4: Added factions, plotThreads, threadBeats,
 *            suggestions, entityTimeline, macro_arcs, arcs
 *
 * Import handles full ID remapping for all cross-references.
 */

import db from '../db/database';
import {
  getStoryCreationSettings,
  saveStoryCreationSettings,
} from '../ai/storyCreationSettings';

function parseProjectBackup(jsonString) {
  const data = JSON.parse(jsonString);

  if (!data._storyforge_version || !data.project) {
    throw new Error('File khong hop le - khong phai backup StoryForge');
  }

  return data;
}

function resolveImportedProjectTitle(title, titleMode = 'imported') {
  const normalizedTitle = String(title || 'Project').trim() || 'Project';
  if (titleMode === 'original') {
    return normalizedTitle;
  }

  if (/\(Imported\)$/i.test(normalizedTitle)) {
    return normalizedTitle;
  }

  return `${normalizedTitle} (Imported)`;
}

function resolveImportedChatTitle(title, titleMode = 'imported') {
  const normalizedTitle = String(title || 'Cuoc tro chuyen moi').trim() || 'Cuoc tro chuyen moi';
  if (titleMode === 'original') {
    return normalizedTitle;
  }

  if (/\(Imported\)$/i.test(normalizedTitle)) {
    return normalizedTitle;
  }

  return `${normalizedTitle} (Imported)`;
}

function parseChatBackup(jsonString) {
  const data = JSON.parse(jsonString);

  if (!data?._storyforge_version || data?._cloud_scope !== 'chat' || !data?.thread || !Array.isArray(data?.messages)) {
    throw new Error('File khong hop le - khong phai backup chat StoryForge');
  }

  return data;
}

function parsePromptBundleBackup(jsonString) {
  const data = JSON.parse(jsonString);

  if (!data?._storyforge_version || data?._cloud_scope !== 'prompt_bundle' || !data?.story_creation_settings) {
    throw new Error('File khong hop le - khong phai backup prompt StoryForge');
  }

  return data;
}

function remapIdList(items, idMap) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => idMap[item] || item);
}

function remapCanonSnapshot(snapshotJson, maps) {
  try {
    const snapshot = typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
    if (!snapshot || typeof snapshot !== 'object') return snapshotJson;

    const next = { ...snapshot };

    if (Array.isArray(next.entityStates)) {
      next.entityStates = next.entityStates.map((state) => ({
        ...state,
        entity_id: state.entity_type === 'character'
          ? (maps.characterIdMap[state.entity_id] || state.entity_id)
          : state.entity_id,
        last_event_id: maps.eventIdMap[state.last_event_id] || state.last_event_id || null,
        source_revision_id: maps.revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
      }));
    }

    if (Array.isArray(next.threadStates)) {
      next.threadStates = next.threadStates.map((state) => ({
        ...state,
        thread_id: maps.plotThreadIdMap[state.thread_id] || state.thread_id,
        focus_entity_ids: remapIdList(state.focus_entity_ids, maps.characterIdMap),
        last_event_id: maps.eventIdMap[state.last_event_id] || state.last_event_id || null,
        source_revision_id: maps.revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
      }));
    }

    if (Array.isArray(next.factStates)) {
      next.factStates = next.factStates.map((fact) => ({
        ...fact,
        id: maps.canonFactIdMap[fact.id] || fact.id,
        subject_id: fact.subject_type === 'character'
          ? (maps.characterIdMap[fact.subject_id] || fact.subject_id)
          : fact.subject_type === 'location'
            ? (maps.locationIdMap[fact.subject_id] || fact.subject_id)
            : fact.subject_id,
      }));
    }

    if (Array.isArray(next.itemStates)) {
      next.itemStates = next.itemStates.map((state) => ({
        ...state,
        object_id: maps.objectIdMap[state.object_id] || state.object_id,
        owner_character_id: maps.characterIdMap[state.owner_character_id] || state.owner_character_id || null,
        current_location_id: maps.locationIdMap[state.current_location_id] || state.current_location_id || null,
        last_event_id: maps.eventIdMap[state.last_event_id] || state.last_event_id || null,
        source_revision_id: maps.revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
      }));
    }

    if (Array.isArray(next.relationshipStates)) {
      next.relationshipStates = next.relationshipStates.map((state) => ({
        ...state,
        character_a_id: maps.characterIdMap[state.character_a_id] || state.character_a_id,
        character_b_id: maps.characterIdMap[state.character_b_id] || state.character_b_id,
        last_event_id: maps.eventIdMap[state.last_event_id] || state.last_event_id || null,
        source_revision_id: maps.revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
        pair_key: state.character_a_id && state.character_b_id
          ? [
            maps.characterIdMap[state.character_a_id] || state.character_a_id,
            maps.characterIdMap[state.character_b_id] || state.character_b_id,
          ].sort((a, b) => Number(a) - Number(b)).join(':')
          : state.pair_key,
      }));
    }

    return JSON.stringify(next);
  } catch {
    return snapshotJson;
  }
}

/**
 * Export a project and all related data as JSON.
 * @param {number} projectId
 * @returns {Promise<string>} JSON string
 */
export async function exportProject(projectId) {
  const [
    project, chapters, scenes, characters, locations, objects,
    worldTerms, taboos, relationships, canonFacts, chapterMeta,
    plotThreads, factions, suggestions, entityTimeline, macroArcs, arcs,
    storyEvents, entityStateCurrent, plotThreadState, validatorReports,
    memoryEvidence, chapterRevisions, chapterCommits, chapterSnapshots,
    itemStateCurrent, relationshipStateCurrent,
  ] = await Promise.all([
    db.projects.get(projectId),
    db.chapters.where('project_id').equals(projectId).toArray(),
    db.scenes.where('project_id').equals(projectId).toArray(),
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.worldTerms.where('project_id').equals(projectId).toArray(),
    db.taboos.where('project_id').equals(projectId).toArray(),
    db.relationships.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.chapterMeta.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.factions.where('project_id').equals(projectId).toArray(),
    db.suggestions.where('project_id').equals(projectId).toArray(),
    db.entityTimeline.where('project_id').equals(projectId).toArray(),
    db.macro_arcs.where('project_id').equals(projectId).toArray(),
    db.arcs.where('project_id').equals(projectId).toArray(),
    db.story_events.where('project_id').equals(projectId).toArray(),
    db.entity_state_current.where('project_id').equals(projectId).toArray(),
    db.plot_thread_state.where('project_id').equals(projectId).toArray(),
    db.validator_reports.where('project_id').equals(projectId).toArray(),
    db.memory_evidence.where('project_id').equals(projectId).toArray(),
    db.chapter_revisions.where('project_id').equals(projectId).toArray(),
    db.chapter_commits.where('project_id').equals(projectId).toArray(),
    db.chapter_snapshots.where('project_id').equals(projectId).toArray(),
    db.item_state_current.where('project_id').equals(projectId).toArray(),
    db.relationship_state_current.where('project_id').equals(projectId).toArray(),
  ]);

  if (!project) throw new Error('Không tìm thấy dự án');

  // threadBeats: no project_id index → query via plotThread IDs
  const plotThreadIds = plotThreads.map(pt => pt.id);
  const threadBeats = plotThreadIds.length > 0
    ? await db.threadBeats.where('plot_thread_id').anyOf(plotThreadIds).toArray()
    : [];

  const data = {
    _storyforge_version: 6,
    _exported_at: new Date().toISOString(),
    project,
    chapters,
    scenes,
    characters,
    locations,
    objects,
    worldTerms,
    taboos,
    relationships,
    canonFacts,
    chapterMeta,
    plotThreads,
    threadBeats,
    factions,
    suggestions,
    entityTimeline,
    macro_arcs: macroArcs,
    arcs,
    story_events: storyEvents,
    entity_state_current: entityStateCurrent,
    plot_thread_state: plotThreadState,
    validator_reports: validatorReports,
    memory_evidence: memoryEvidence,
    chapter_revisions: chapterRevisions,
    chapter_commits: chapterCommits,
    chapter_snapshots: chapterSnapshots,
    item_state_current: itemStateCurrent,
    relationship_state_current: relationshipStateCurrent,
  };

  return JSON.stringify(data, null, 2);
}

export async function exportChatThread(threadId) {
  const normalizedThreadId = Number(threadId);
  if (!Number.isFinite(normalizedThreadId) || normalizedThreadId <= 0) {
    throw new Error('Khong tim thay thread chat de backup.');
  }

  const [thread, messages] = await Promise.all([
    db.ai_chat_threads.get(normalizedThreadId),
    db.ai_chat_messages.where('thread_id').equals(normalizedThreadId).sortBy('created_at'),
  ]);

  if (!thread) {
    throw new Error('Khong tim thay thread chat local.');
  }

  let projectTitle = '';
  let projectCloudSlug = '';
  if (Number(thread.project_id) > 0) {
    const project = await db.projects.get(Number(thread.project_id));
    projectTitle = String(project?.title || '').trim();
    projectCloudSlug = String(project?.cloud_project_slug || '').trim();
  }

  const data = {
    _storyforge_version: 1,
    _cloud_scope: 'chat',
    _exported_at: new Date().toISOString(),
    thread,
    messages,
    metadata: {
      project_title: projectTitle,
      project_cloud_slug: projectCloudSlug,
      message_count: messages.length,
    },
  };

  return JSON.stringify(data, null, 2);
}

export async function exportPromptBundle() {
  const data = {
    _storyforge_version: 1,
    _cloud_scope: 'prompt_bundle',
    _exported_at: new Date().toISOString(),
    story_creation_settings: getStoryCreationSettings(),
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Download project as JSON file.
 * @param {number} projectId
 */
export async function downloadProjectJSON(projectId) {
  const json = await exportProject(projectId);
  const project = await db.projects.get(projectId);
  const filename = `${(project?.title || 'project').replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '_')}_backup_${Date.now()}.json`;

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import project from JSON data.
 * Creates a NEW project (new IDs) to avoid conflicts.
 * Handles full ID remapping for all cross-referenced tables.
 *
 * Import order matters — tables that are referenced by others come first:
 *   1. project
 *   2. macro_arcs → macroArcIdMap
 *   3. arcs → arcIdMap (uses macroArcIdMap)
 *   4. characters → characterIdMap
 *   5. locations → locationIdMap
 *   6. plotThreads → plotThreadIdMap
 *   7. chapters → chapterIdMap (uses arcIdMap)
 *   8. scenes → sceneIdMap (uses chapterIdMap, characterIdMap, locationIdMap)
 *   9. Everything else — uses accumulated ID maps
 *
 * @param {string} jsonString
 * @param {{ titleMode?: 'imported' | 'original', preserveCloudMetadata?: boolean }} [options]
 * @returns {Promise<number>} new project ID
 */
export async function importProject(jsonString, options = {}) {
  const data = parseProjectBackup(jsonString);
  const titleMode = options.titleMode === 'original' ? 'original' : 'imported';
  const preserveCloudMetadata = options.preserveCloudMetadata === true;

  if (!data._storyforge_version || !data.project) {
    throw new Error('File không hợp lệ — không phải backup StoryForge');
  }

  // ═══════════════════════════════════════════
  // 1. Create new project (strip old ID)
  // ═══════════════════════════════════════════
  const { id: _oldProjectId, ...projectData } = data.project;
  const normalizedProjectData = { ...projectData };
  if (!preserveCloudMetadata) {
    delete normalizedProjectData.cloud_project_slug;
    delete normalizedProjectData.cloud_last_synced_at;
    delete normalizedProjectData.cloud_last_server_updated_at;
    delete normalizedProjectData.cloud_owner_user_id;
  }
  const now = Date.now();
  const newProjectId = await db.projects.add({
    ...normalizedProjectData,
    title: resolveImportedProjectTitle(projectData.title, titleMode),
    created_at: now,
    updated_at: now,
  });

  // ═══════════════════════════════════════════
  // 2. macro_arcs → macroArcIdMap
  // ═══════════════════════════════════════════
  const macroArcIdMap = {};
  for (const ma of (data.macro_arcs || [])) {
    const { id: oldId, project_id: _, ...maData } = ma;
    const newId = await db.macro_arcs.add({ ...maData, project_id: newProjectId });
    macroArcIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 3. arcs → arcIdMap (uses macroArcIdMap)
  // ═══════════════════════════════════════════
  const arcIdMap = {};
  for (const a of (data.arcs || [])) {
    const { id: oldId, project_id: _, ...aData } = a;
    const newId = await db.arcs.add({
      ...aData,
      project_id: newProjectId,
      macro_arc_id: macroArcIdMap[a.macro_arc_id] || a.macro_arc_id || null,
    });
    arcIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 4. characters → characterIdMap
  // ═══════════════════════════════════════════
  const characterIdMap = {};
  for (const c of (data.characters || [])) {
    const { id: oldId, project_id: _, ...cData } = c;
    const newId = await db.characters.add({ ...cData, project_id: newProjectId });
    characterIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 5. locations → locationIdMap
  // ═══════════════════════════════════════════
  const locationIdMap = {};
  for (const l of (data.locations || [])) {
    const { id: oldId, project_id: _, ...lData } = l;
    const newId = await db.locations.add({ ...lData, project_id: newProjectId });
    locationIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 6. plotThreads → plotThreadIdMap
  // ═══════════════════════════════════════════
  const plotThreadIdMap = {};
  for (const pt of (data.plotThreads || [])) {
    const { id: oldId, project_id: _, ...ptData } = pt;
    const newId = await db.plotThreads.add({ ...ptData, project_id: newProjectId });
    plotThreadIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 7. chapters → chapterIdMap (uses arcIdMap)
  // ═══════════════════════════════════════════
  const chapterIdMap = {};
  for (const ch of (data.chapters || [])) {
    const { id: oldId, project_id: _, ...chData } = ch;
    const newId = await db.chapters.add({
      ...chData,
      project_id: newProjectId,
      arc_id: arcIdMap[ch.arc_id] || ch.arc_id || null,
    });
    chapterIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 8. scenes → sceneIdMap (uses chapterIdMap, characterIdMap, locationIdMap)
  // ═══════════════════════════════════════════
  const sceneIdMap = {};
  for (const s of (data.scenes || [])) {
    const { id: oldId, project_id: __, ...sData } = s;

    // Remap character IDs inside characters_present JSON array
    let remappedPresent = sData.characters_present;
    try {
      const presentIds = JSON.parse(s.characters_present || '[]');
      if (Array.isArray(presentIds) && presentIds.length > 0) {
        remappedPresent = JSON.stringify(presentIds.map(id => characterIdMap[id] || id));
      }
    } catch { /* keep original */ }

    const newId = await db.scenes.add({
      ...sData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[s.chapter_id] || s.chapter_id,
      pov_character_id: characterIdMap[s.pov_character_id] || s.pov_character_id,
      location_id: locationIdMap[s.location_id] || s.location_id,
      characters_present: remappedPresent,
    });
    sceneIdMap[oldId] = newId;
  }

  // ═══════════════════════════════════════════
  // 9. Remaining tables — uses accumulated ID maps
  // ═══════════════════════════════════════════

  const canonFactIdMap = {};
  const objectIdMap = {};

  // Objects (uses characterIdMap for owner)
  for (const o of (data.objects || [])) {
    const { id: _, project_id: __, ...oData } = o;
    const newId = await db.objects.add({
      ...oData,
      project_id: newProjectId,
      owner_character_id: characterIdMap[o.owner_character_id] || o.owner_character_id,
    });
    objectIdMap[o.id] = newId;
  }

  // World terms
  for (const t of (data.worldTerms || [])) {
    const { id: _, project_id: __, ...tData } = t;
    await db.worldTerms.add({ ...tData, project_id: newProjectId });
  }

  // Taboos (uses characterIdMap)
  for (const t of (data.taboos || [])) {
    const { id: _, project_id: __, ...tData } = t;
    await db.taboos.add({
      ...tData,
      project_id: newProjectId,
      character_id: characterIdMap[t.character_id] || t.character_id,
    });
  }

  // Relationships (uses characterIdMap)
  for (const r of (data.relationships || [])) {
    const { id: _, project_id: __, ...rData } = r;
    await db.relationships.add({
      ...rData,
      project_id: newProjectId,
      character_a_id: characterIdMap[r.character_a_id] || r.character_a_id,
      character_b_id: characterIdMap[r.character_b_id] || r.character_b_id,
    });
  }

  // Canon facts (uses characterIdMap, locationIdMap)
  for (const f of (data.canonFacts || [])) {
    const { id: oldId, project_id: __, ...fData } = f;
    const newId = await db.canonFacts.add({
      ...fData,
      project_id: newProjectId,
      subject_id: f.subject_type === 'character' ? (characterIdMap[f.subject_id] || f.subject_id) :
                  f.subject_type === 'location' ? (locationIdMap[f.subject_id] || f.subject_id) :
                  f.subject_id,
    });
    canonFactIdMap[oldId] = newId;
  }

  // Chapter meta (uses chapterIdMap)
  for (const m of (data.chapterMeta || [])) {
    const { id: _, project_id: __, ...mData } = m;
    await db.chapterMeta.add({
      ...mData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[m.chapter_id] || m.chapter_id,
    });
  }

  // Thread beats (uses plotThreadIdMap, sceneIdMap)
  for (const tb of (data.threadBeats || [])) {
    const { id: _, ...tbData } = tb;
    await db.threadBeats.add({
      ...tbData,
      plot_thread_id: plotThreadIdMap[tb.plot_thread_id] || tb.plot_thread_id,
      scene_id: sceneIdMap[tb.scene_id] || tb.scene_id,
    });
  }

  // Factions
  for (const f of (data.factions || [])) {
    const { id: _, project_id: __, ...fData } = f;
    await db.factions.add({ ...fData, project_id: newProjectId });
  }

  // Suggestions (uses chapterIdMap, characterIdMap)
  for (const s of (data.suggestions || [])) {
    const { id: _, project_id: __, ...sData } = s;
    await db.suggestions.add({
      ...sData,
      project_id: newProjectId,
      source_chapter_id: chapterIdMap[s.source_chapter_id] || s.source_chapter_id,
      target_id: s.type === 'character_status'
        ? (characterIdMap[s.target_id] || s.target_id)
        : s.target_id,
    });
  }

  // Entity timeline (uses characterIdMap, locationIdMap, chapterIdMap)
  for (const et of (data.entityTimeline || [])) {
    const { id: _, project_id: __, ...etData } = et;
    let mappedEntityId = et.entity_id;
    if (et.entity_type === 'character') mappedEntityId = characterIdMap[et.entity_id] || et.entity_id;
    else if (et.entity_type === 'location') mappedEntityId = locationIdMap[et.entity_id] || et.entity_id;

    await db.entityTimeline.add({
      ...etData,
      project_id: newProjectId,
      entity_id: mappedEntityId,
      chapter_id: chapterIdMap[et.chapter_id] || et.chapter_id,
    });
  }

  const revisionIdMap = {};
  for (const revision of (data.chapter_revisions || [])) {
    const { id: oldId, project_id: __, ...revisionData } = revision;
    const newId = await db.chapter_revisions.add({
      ...revisionData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[revision.chapter_id] || revision.chapter_id,
    });
    revisionIdMap[oldId] = newId;
  }

  const eventIdMap = {};
  for (const event of (data.story_events || [])) {
    const { id: oldId, project_id: __, ...eventData } = event;
    const newId = await db.story_events.add({
      ...eventData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[event.chapter_id] || event.chapter_id,
      revision_id: revisionIdMap[event.revision_id] || event.revision_id || null,
      scene_id: sceneIdMap[event.scene_id] || event.scene_id || null,
      subject_id: characterIdMap[event.subject_id] || event.subject_id || null,
      target_id: characterIdMap[event.target_id] || event.target_id || null,
      location_id: locationIdMap[event.location_id] || event.location_id || null,
      thread_id: plotThreadIdMap[event.thread_id] || event.thread_id || null,
      fact_id: canonFactIdMap[event.fact_id] || event.fact_id || null,
    });
    eventIdMap[oldId] = newId;
  }

  for (const state of (data.entity_state_current || [])) {
    const { id: _, project_id: __, ...stateData } = state;
    await db.entity_state_current.add({
      ...stateData,
      project_id: newProjectId,
      entity_id: state.entity_type === 'character'
        ? (characterIdMap[state.entity_id] || state.entity_id)
        : state.entity_id,
      last_event_id: eventIdMap[state.last_event_id] || state.last_event_id || null,
      source_revision_id: revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
    });
  }

  for (const state of (data.plot_thread_state || [])) {
    const { id: _, project_id: __, ...stateData } = state;
    await db.plot_thread_state.add({
      ...stateData,
      project_id: newProjectId,
      thread_id: plotThreadIdMap[state.thread_id] || state.thread_id,
      focus_entity_ids: remapIdList(state.focus_entity_ids, characterIdMap),
      last_event_id: eventIdMap[state.last_event_id] || state.last_event_id || null,
      source_revision_id: revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
    });
  }

  for (const state of (data.item_state_current || [])) {
    const { id: _, project_id: __, ...stateData } = state;
    await db.item_state_current.add({
      ...stateData,
      project_id: newProjectId,
      object_id: objectIdMap[state.object_id] || state.object_id,
      owner_character_id: characterIdMap[state.owner_character_id] || state.owner_character_id || null,
      current_location_id: locationIdMap[state.current_location_id] || state.current_location_id || null,
      last_event_id: eventIdMap[state.last_event_id] || state.last_event_id || null,
      source_revision_id: revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
    });
  }

  for (const state of (data.relationship_state_current || [])) {
    const { id: _, project_id: __, ...stateData } = state;
    const mappedA = characterIdMap[state.character_a_id] || state.character_a_id;
    const mappedB = characterIdMap[state.character_b_id] || state.character_b_id;
    await db.relationship_state_current.add({
      ...stateData,
      project_id: newProjectId,
      character_a_id: mappedA,
      character_b_id: mappedB,
      pair_key: mappedA && mappedB ? [mappedA, mappedB].sort((a, b) => Number(a) - Number(b)).join(':') : state.pair_key,
      last_event_id: eventIdMap[state.last_event_id] || state.last_event_id || null,
      source_revision_id: revisionIdMap[state.source_revision_id] || state.source_revision_id || null,
    });
  }

  for (const report of (data.validator_reports || [])) {
    const { id: _, project_id: __, ...reportData } = report;
    await db.validator_reports.add({
      ...reportData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[report.chapter_id] || report.chapter_id,
      revision_id: revisionIdMap[report.revision_id] || report.revision_id || null,
      scene_id: sceneIdMap[report.scene_id] || report.scene_id || null,
      related_entity_ids: remapIdList(report.related_entity_ids, characterIdMap),
      related_thread_ids: remapIdList(report.related_thread_ids, plotThreadIdMap),
      related_event_ids: remapIdList(report.related_event_ids, eventIdMap),
    });
  }

  for (const evidence of (data.memory_evidence || [])) {
    const { id: _, project_id: __, ...evidenceData } = evidence;
    let mappedTargetId = evidence.target_id;
    if (evidence.target_type === 'story_event') mappedTargetId = eventIdMap[evidence.target_id] || evidence.target_id;
    if (evidence.target_type === 'chapter_revision') mappedTargetId = revisionIdMap[evidence.target_id] || evidence.target_id;
    if (evidence.target_type === 'character') mappedTargetId = characterIdMap[evidence.target_id] || evidence.target_id;
    if (evidence.target_type === 'plot_thread') mappedTargetId = plotThreadIdMap[evidence.target_id] || evidence.target_id;
    if (evidence.target_type === 'canon_fact') mappedTargetId = canonFactIdMap[evidence.target_id] || evidence.target_id;

    await db.memory_evidence.add({
      ...evidenceData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[evidence.chapter_id] || evidence.chapter_id,
      revision_id: revisionIdMap[evidence.revision_id] || evidence.revision_id || null,
      scene_id: sceneIdMap[evidence.scene_id] || evidence.scene_id || null,
      target_id: mappedTargetId,
    });
  }

  for (const commit of (data.chapter_commits || [])) {
    const { id: _, project_id: __, ...commitData } = commit;
    await db.chapter_commits.add({
      ...commitData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[commit.chapter_id] || commit.chapter_id,
      current_revision_id: revisionIdMap[commit.current_revision_id] || commit.current_revision_id || null,
      canonical_revision_id: revisionIdMap[commit.canonical_revision_id] || commit.canonical_revision_id || null,
    });
  }

  for (const snapshot of (data.chapter_snapshots || [])) {
    const { id: _, project_id: __, ...snapshotData } = snapshot;
    await db.chapter_snapshots.add({
      ...snapshotData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[snapshot.chapter_id] || snapshot.chapter_id,
      revision_id: revisionIdMap[snapshot.revision_id] || snapshot.revision_id || null,
      snapshot_json: remapCanonSnapshot(snapshot.snapshot_json, {
        characterIdMap,
        locationIdMap,
        plotThreadIdMap,
        canonFactIdMap,
        objectIdMap,
        revisionIdMap,
        eventIdMap,
      }),
    });
  }

  return newProjectId;
}

/**
 * Import project from File input.
 * @param {File} file
 * @returns {Promise<number>} new project ID
 */
export async function importProjectFromFile(file, options = {}) {
  const text = await file.text();
  return importProject(text, options);
}

export async function importChatThread(jsonString, options = {}) {
  const data = parseChatBackup(jsonString);
  const titleMode = options.titleMode === 'original' ? 'original' : 'imported';
  const preserveCloudMetadata = options.preserveCloudMetadata !== false;
  const originalThread = data.thread || {};
  const originalMessages = Array.isArray(data.messages) ? data.messages : [];
  const requestedProjectCloudSlug = String(data?.metadata?.project_cloud_slug || '').trim();

  let targetProjectId = 0;
  let nextChatMode = 'free';
  let nextSystemPrompt = '';

  if (requestedProjectCloudSlug) {
    const allProjects = await db.projects.toArray();
    const targetProject = allProjects.find(
      (project) => String(project?.cloud_project_slug || '').trim() === requestedProjectCloudSlug,
    ) || null;
    if (targetProject) {
      targetProjectId = Number(targetProject.id);
      nextChatMode = originalThread.chat_mode || 'story';
      nextSystemPrompt = String(originalThread.system_prompt || '').trim();
    }
  }

  const now = Date.now();
  const { id: _oldThreadId, ...threadData } = originalThread;
  const normalizedThreadData = { ...threadData };
  if (!preserveCloudMetadata) {
    delete normalizedThreadData.cloud_chat_slug;
    delete normalizedThreadData.cloud_last_synced_at;
    delete normalizedThreadData.cloud_last_server_updated_at;
    delete normalizedThreadData.cloud_owner_user_id;
  }
  const newThreadId = await db.ai_chat_threads.add({
    ...normalizedThreadData,
    project_id: targetProjectId,
    chat_mode: nextChatMode,
    system_prompt: nextSystemPrompt,
    title: resolveImportedChatTitle(normalizedThreadData.title, titleMode),
    created_at: now,
    updated_at: now,
  });

  const baseCreatedAt = now;
  for (let index = 0; index < originalMessages.length; index += 1) {
    const message = originalMessages[index];
    const { id: _oldMessageId, thread_id: _oldMessageThreadId, ...messageData } = message;
    await db.ai_chat_messages.add({
      ...messageData,
      project_id: targetProjectId,
      thread_id: newThreadId,
      created_at: baseCreatedAt + index,
    });
  }

  return {
    newThreadId,
    projectId: targetProjectId,
    messageCount: originalMessages.length,
  };
}

export function importPromptBundle(jsonString) {
  const data = parsePromptBundleBackup(jsonString);
  return saveStoryCreationSettings(data.story_creation_settings);
}
