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
  ]);

  if (!project) throw new Error('Không tìm thấy dự án');

  // threadBeats: no project_id index → query via plotThread IDs
  const plotThreadIds = plotThreads.map(pt => pt.id);
  const threadBeats = plotThreadIds.length > 0
    ? await db.threadBeats.where('plot_thread_id').anyOf(plotThreadIds).toArray()
    : [];

  const data = {
    _storyforge_version: 4,
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
 * @returns {Promise<number>} new project ID
 */
export async function importProject(jsonString) {
  const data = JSON.parse(jsonString);

  if (!data._storyforge_version || !data.project) {
    throw new Error('File không hợp lệ — không phải backup StoryForge');
  }

  // ═══════════════════════════════════════════
  // 1. Create new project (strip old ID)
  // ═══════════════════════════════════════════
  const { id: _oldProjectId, ...projectData } = data.project;
  const now = Date.now();
  const newProjectId = await db.projects.add({
    ...projectData,
    title: `${projectData.title} (Imported)`,
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

  // Objects (uses characterIdMap for owner)
  for (const o of (data.objects || [])) {
    const { id: _, project_id: __, ...oData } = o;
    await db.objects.add({
      ...oData,
      project_id: newProjectId,
      owner_character_id: characterIdMap[o.owner_character_id] || o.owner_character_id,
    });
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
    const { id: _, project_id: __, ...fData } = f;
    await db.canonFacts.add({
      ...fData,
      project_id: newProjectId,
      subject_id: f.subject_type === 'character' ? (characterIdMap[f.subject_id] || f.subject_id) :
                  f.subject_type === 'location' ? (locationIdMap[f.subject_id] || f.subject_id) :
                  f.subject_id,
    });
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

  return newProjectId;
}

/**
 * Import project from File input.
 * @param {File} file
 * @returns {Promise<number>} new project ID
 */
export async function importProjectFromFile(file) {
  const text = await file.text();
  return importProject(text);
}
