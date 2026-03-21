import Dexie from 'dexie';

const db = new Dexie('StoryForgeDB');

db.version(1).stores({
  // Core
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',

  // Characters & Relationships
  characters: '++id, project_id, name, role',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',

  // World Building
  locations: '++id, project_id, name',
  objects: '++id, project_id, name, owner_character_id',

  // Canon & Plot
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status',
  plotThreads: '++id, project_id, title, type, state',
  threadBeats: '++id, plot_thread_id, scene_id, beat_type',
  timelineEvents: '++id, project_id, scene_id, date_marker',

  // Style & Voice
  stylePacks: '++id, project_id, name, type, source_kind',
  voicePacks: '++id, project_id, character_id',
  styleJobs: '++id, project_id, style_pack_id, parsing_status',
  genrePacks: '++id, name',

  // AI & Revision
  aiJobs: '++id, project_id, scene_id, chapter_id, job_type, status',
  revisions: '++id, scene_id, objective, created_at',
  qaReports: '++id, project_id, chapter_id, scene_id, report_type, severity',
});

// Phase 3 — Memory: new tables
db.version(2).stores({
  // Keep all v1 tables
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name',
  objects: '++id, project_id, name, owner_character_id',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status',
  plotThreads: '++id, project_id, title, type, state',
  threadBeats: '++id, plot_thread_id, scene_id, beat_type',
  timelineEvents: '++id, project_id, scene_id, date_marker',
  stylePacks: '++id, project_id, name, type, source_kind',
  voicePacks: '++id, project_id, character_id',
  styleJobs: '++id, project_id, style_pack_id, parsing_status',
  genrePacks: '++id, name',
  aiJobs: '++id, project_id, scene_id, chapter_id, job_type, status',
  revisions: '++id, scene_id, objective, created_at',
  qaReports: '++id, project_id, chapter_id, scene_id, report_type, severity',

  // New in v2
  worldTerms: '++id, project_id, name, category',
  taboos: '++id, project_id, character_id, effective_before_chapter',
  chapterMeta: '++id, chapter_id, project_id',
});

// Phase 4 — Canon & Genre: new fields
db.version(3).stores({
  // Keep all v2 tables (indexes unchanged — Dexie only cares about indexed fields)
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name',
  objects: '++id, project_id, name, owner_character_id',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status',
  plotThreads: '++id, project_id, title, type, state',
  threadBeats: '++id, plot_thread_id, scene_id, beat_type',
  timelineEvents: '++id, project_id, scene_id, date_marker',
  stylePacks: '++id, project_id, name, type, source_kind',
  voicePacks: '++id, project_id, character_id',
  styleJobs: '++id, project_id, style_pack_id, parsing_status',
  genrePacks: '++id, name',
  aiJobs: '++id, project_id, scene_id, chapter_id, job_type, status',
  revisions: '++id, scene_id, objective, created_at',
  qaReports: '++id, project_id, chapter_id, scene_id, report_type, severity',
  worldTerms: '++id, project_id, name, category',
  taboos: '++id, project_id, character_id, effective_before_chapter',
  chapterMeta: '++id, chapter_id, project_id',
}).upgrade(tx => {
  // Migrate existing projects: add default ai_guidelines and ai_strictness
  return tx.table('projects').toCollection().modify(project => {
    if (!project.ai_guidelines) project.ai_guidelines = '';
    if (!project.ai_strictness) project.ai_strictness = 'balanced';
  });
});

// Phase A — Suggestion Inbox: new table
db.version(4).stores({
  // Keep all v3 tables
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name',
  objects: '++id, project_id, name, owner_character_id',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status',
  plotThreads: '++id, project_id, title, type, state',
  threadBeats: '++id, plot_thread_id, scene_id, beat_type',
  timelineEvents: '++id, project_id, scene_id, date_marker',
  stylePacks: '++id, project_id, name, type, source_kind',
  voicePacks: '++id, project_id, character_id',
  styleJobs: '++id, project_id, style_pack_id, parsing_status',
  genrePacks: '++id, name',
  aiJobs: '++id, project_id, scene_id, chapter_id, job_type, status',
  revisions: '++id, scene_id, objective, created_at',
  qaReports: '++id, project_id, chapter_id, scene_id, report_type, severity',
  worldTerms: '++id, project_id, name, category',
  taboos: '++id, project_id, character_id, effective_before_chapter',
  chapterMeta: '++id, chapter_id, project_id',

  // New in v4: Suggestion Inbox
  suggestions: '++id, project_id, type, status, source_chapter_id, target_id, created_at',
});

// Phase 4.5 — Continuity & Intelligence: new table
db.version(5).stores({
  // Keep all v4 tables
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name',
  objects: '++id, project_id, name, owner_character_id',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status',
  plotThreads: '++id, project_id, title, type, state',
  threadBeats: '++id, plot_thread_id, scene_id, beat_type',
  timelineEvents: '++id, project_id, scene_id, date_marker',
  stylePacks: '++id, project_id, name, type, source_kind',
  voicePacks: '++id, project_id, character_id',
  styleJobs: '++id, project_id, style_pack_id, parsing_status',
  genrePacks: '++id, name',
  aiJobs: '++id, project_id, scene_id, chapter_id, job_type, status',
  revisions: '++id, scene_id, objective, created_at',
  qaReports: '++id, project_id, chapter_id, scene_id, report_type, severity',
  worldTerms: '++id, project_id, name, category',
  taboos: '++id, project_id, character_id, effective_before_chapter',
  chapterMeta: '++id, chapter_id, project_id',
  suggestions: '++id, project_id, type, status, source_chapter_id, target_id, created_at',

  // New in v5: Changelog Timeline
  entityTimeline: '++id, project_id, entity_id, entity_type, chapter_id, type, timestamp',
});

// Phase 5 — AI Auto Generation: new project fields
db.version(6).stores({
  // Keep all v5 tables
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name',
  objects: '++id, project_id, name, owner_character_id',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status',
  plotThreads: '++id, project_id, title, type, state',
  threadBeats: '++id, plot_thread_id, scene_id, beat_type',
  timelineEvents: '++id, project_id, scene_id, date_marker',
  stylePacks: '++id, project_id, name, type, source_kind',
  voicePacks: '++id, project_id, character_id',
  styleJobs: '++id, project_id, style_pack_id, parsing_status',
  genrePacks: '++id, name',
  aiJobs: '++id, project_id, scene_id, chapter_id, job_type, status',
  revisions: '++id, scene_id, objective, created_at',
  qaReports: '++id, project_id, chapter_id, scene_id, report_type, severity',
  worldTerms: '++id, project_id, name, category',
  taboos: '++id, project_id, character_id, effective_before_chapter',
  chapterMeta: '++id, chapter_id, project_id',
  suggestions: '++id, project_id, type, status, source_chapter_id, target_id, created_at',
  entityTimeline: '++id, project_id, entity_id, entity_type, chapter_id, type, timestamp',
}).upgrade(tx => {
  return tx.table('projects').toCollection().modify(project => {
    if (!project.target_length) project.target_length = 0;
    if (!project.target_length_type) project.target_length_type = 'unset';
    if (!project.ultimate_goal) project.ultimate_goal = '';
    if (!project.milestones) project.milestones = '[]';
  });
});

export default db;
