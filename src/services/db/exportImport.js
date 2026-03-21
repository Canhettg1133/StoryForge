/**
 * StoryForge — Project Export/Import (Phase 4)
 * 
 * JSON backup of entire project data:
 * project + chapters + scenes + characters + locations + objects +
 * worldTerms + taboos + relationships + canonFacts + chapterMeta
 */

import db from '../db/database';

/**
 * Export a project and all related data as JSON.
 * @param {number} projectId
 * @returns {Promise<string>} JSON string
 */
export async function exportProject(projectId) {
  const [project, chapters, scenes, characters, locations, objects, worldTerms, taboos, relationships, canonFacts, chapterMeta] =
    await Promise.all([
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
    ]);

  if (!project) throw new Error('Không tìm thấy dự án');

  const data = {
    _storyforge_version: 3,
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
 * @param {string} jsonString
 * @returns {Promise<number>} new project ID
 */
export async function importProject(jsonString) {
  const data = JSON.parse(jsonString);

  if (!data._storyforge_version || !data.project) {
    throw new Error('File không hợp lệ — không phải backup StoryForge');
  }

  // Create new project (strip old ID)
  const { id: _oldProjectId, ...projectData } = data.project;
  const now = Date.now();
  const newProjectId = await db.projects.add({
    ...projectData,
    title: `${projectData.title} (Imported)`,
    created_at: now,
    updated_at: now,
  });

  // Build ID mapping for chapters and scenes
  const chapterIdMap = {};
  for (const ch of (data.chapters || [])) {
    const { id: oldId, project_id: _, ...chData } = ch;
    const newId = await db.chapters.add({ ...chData, project_id: newProjectId });
    chapterIdMap[oldId] = newId;
  }

  // Build character ID mapping
  const characterIdMap = {};
  for (const c of (data.characters || [])) {
    const { id: oldId, project_id: _, ...cData } = c;
    const newId = await db.characters.add({ ...cData, project_id: newProjectId });
    characterIdMap[oldId] = newId;
  }

  // Build location ID mapping
  const locationIdMap = {};
  for (const l of (data.locations || [])) {
    const { id: oldId, project_id: _, ...lData } = l;
    const newId = await db.locations.add({ ...lData, project_id: newProjectId });
    locationIdMap[oldId] = newId;
  }

  // Import scenes with remapped chapter/character/location IDs
  for (const s of (data.scenes || [])) {
    const { id: _, project_id: __, ...sData } = s;
    await db.scenes.add({
      ...sData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[s.chapter_id] || s.chapter_id,
      pov_character_id: characterIdMap[s.pov_character_id] || s.pov_character_id,
      location_id: locationIdMap[s.location_id] || s.location_id,
    });
  }

  // Import objects with remapped owner
  for (const o of (data.objects || [])) {
    const { id: _, project_id: __, ...oData } = o;
    await db.objects.add({
      ...oData,
      project_id: newProjectId,
      owner_character_id: characterIdMap[o.owner_character_id] || o.owner_character_id,
    });
  }

  // Import world terms
  for (const t of (data.worldTerms || [])) {
    const { id: _, project_id: __, ...tData } = t;
    await db.worldTerms.add({ ...tData, project_id: newProjectId });
  }

  // Import taboos with remapped character
  for (const t of (data.taboos || [])) {
    const { id: _, project_id: __, ...tData } = t;
    await db.taboos.add({
      ...tData,
      project_id: newProjectId,
      character_id: characterIdMap[t.character_id] || t.character_id,
    });
  }

  // Import relationships with remapped characters
  for (const r of (data.relationships || [])) {
    const { id: _, project_id: __, ...rData } = r;
    await db.relationships.add({
      ...rData,
      project_id: newProjectId,
      character_a_id: characterIdMap[r.character_a_id] || r.character_a_id,
      character_b_id: characterIdMap[r.character_b_id] || r.character_b_id,
    });
  }

  // Import canon facts with remapped subject
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

  // Import chapter meta with remapped chapter
  for (const m of (data.chapterMeta || [])) {
    const { id: _, project_id: __, ...mData } = m;
    await db.chapterMeta.add({
      ...mData,
      project_id: newProjectId,
      chapter_id: chapterIdMap[m.chapter_id] || m.chapter_id,
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
