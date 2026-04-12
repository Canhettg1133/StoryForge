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
  return tx.table('projects').toCollection().modify(project => {
    if (!project.ai_guidelines) project.ai_guidelines = '';
    if (!project.ai_strictness) project.ai_strictness = 'balanced';
  });
});

// Phase A — Suggestion Inbox: new table
db.version(4).stores({
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

  // New in v4
  suggestions: '++id, project_id, type, status, source_chapter_id, target_id, created_at',
});

// Phase 4.5 — Continuity & Intelligence: new table
db.version(5).stores({
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

  // New in v5
  entityTimeline: '++id, project_id, entity_id, entity_type, chapter_id, type, timestamp',
});

// Phase 5 — AI Auto Generation: new project fields
db.version(6).stores({
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

// Phase 6 — Factions & Aliases: new table
// Thêm bảng factions (Thế lực / Tông môn / Bang phái)
// Field aliases trên characters/locations/worldTerms là non-indexed
// nên Dexie không cần khai báo lại schema của các bảng đó.
db.version(7).stores({
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

  // New in v7: Factions (Thế lực / Tông môn / Bang phái)
  // faction_type: sect | kingdom | organization | other
  factions: '++id, project_id, name, faction_type',
});

// Phase 7 — Bridge Memory: Working Memory fields on chapterMeta
//
// Các trường mới được lưu trên bảng chapterMeta (non-indexed):
//   last_prose_buffer  : string  — ~150 từ cuối của lần generate gần nhất
//   emotional_state    : object  — { mood, activeConflict, lastAction }
//   tension_level      : number  — thang 1-10, do tác giả hoặc AI cập nhật
//
// Lý do KHÔNG thêm vào schema string:
//   Dexie chỉ yêu cầu khai báo các trường CẦN INDEX (để query WHERE).
//   Ba trường trên chỉ được đọc theo chapter_id (đã indexed) nên không cần index riêng.
//   Thêm vào schema string sẽ tạo index thừa, lãng phí storage và làm chậm write.
//
// Upgrade function dưới đây khởi tạo giá trị mặc định cho các record cũ.
db.version(8).stores({
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
  factions: '++id, project_id, name, faction_type',
}).upgrade(tx => {
  // Khởi tạo các trường Bridge Memory cho tất cả record chapterMeta cũ
  return tx.table('chapterMeta').toCollection().modify(meta => {
    if (meta.last_prose_buffer === undefined) meta.last_prose_buffer = '';
    if (meta.emotional_state === undefined) meta.emotional_state = null;
    if (meta.tension_level === undefined) meta.tension_level = null;
  });
});

// Phase 9 — Grand Strategy: macro_arcs & arcs tables
//
// macro_arcs: 5-8 cột mốc lớn của toàn bộ truyện (do tác giả định nghĩa thủ công / AI gợi ý)
//   Indexed  : project_id, order_index
//   Non-indexed (lưu nhưng không query WHERE): title, description, chapter_from,
//              chapter_to, emotional_peak
//
// arcs: Các hồi truyện (50-100 chương / hồi), thuộc về một macro_arc
//   Indexed  : project_id, macro_arc_id, order_index
//   Non-indexed: title, summary, goal, chapter_start, chapter_end,
//               status, power_level_start, power_level_end
//
// Quan hệ:
//   projects (1) → macro_arcs (N) → arcs (N) → chapters (N)
//   chapters.arc_id đã có từ v1, nay được dùng thực sự
//
// Không cần upgrade function vì đây là bảng mới — dữ liệu cũ không bị ảnh hưởng.
db.version(9).stores({
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
  factions: '++id, project_id, name, faction_type',

  // New in v9: Grand Strategy — 3 tầng lập kế hoạch
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
});

// Phase 10 — Character Voice DNA: speech_pattern field
//
// Thêm trường speech_pattern (non-indexed) vào characters.
// Mô tả giọng nói, khẩu ngữ, cách nói đặc trưng của nhân vật.
// Không thay đổi schema string vì không cần index.
db.version(10).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
}).upgrade(tx => {
  return tx.table('characters').toCollection().modify(char => {
    if (char.speech_pattern === undefined) char.speech_pattern = '';
  });
});

// ─── v11: ENI Priming Persistence ────────────────────────────────────────────
// Add eni_primed and eni_session_history to chapterMeta so ENI state survives page refresh.
db.version(11).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
}).upgrade(tx => {
  return tx.table('chapterMeta').toCollection().modify(meta => {
    if (meta.eni_primed === undefined) meta.eni_primed = false;
    if (meta.eni_session_history === undefined) meta.eni_session_history = null;
  });
});

// ─── Phase 4 — Analysis Viewer: Annotation, Export, Search, Usage Tracking ─────────────────────────
// Phase 4 Viewer needs persistent storage for:
// - event_annotations: User notes on analysis events
// - saved_searches: Named search queries for reuse
// - export_history: Record of exports
// - event_usage_tracking: How many times each event was used/exported
// - linked_events: Events linked to story projects
db.version(12).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',

  // New in v12: Phase 4 Analysis Viewer
  // Compound indexes use [field1+field2] syntax in Dexie v4
  event_annotations: '++id, corpus_id, event_id, [corpus_id+event_id]',
  saved_searches: '++id, corpus_id, name, created_at',
  export_history: '++id, corpus_id, format, created_at',
  event_usage: '++id, corpus_id, event_id, [corpus_id+event_id]',
  linked_events: '++id, event_id, corpus_id, project_id, [event_id+project_id]',
});

// Phase 4.1 - Persist full L1-L6 analysis snapshots at project scope
db.version(13).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
  event_annotations: '++id, corpus_id, event_id, [corpus_id+event_id]',
  saved_searches: '++id, corpus_id, name, created_at',
  export_history: '++id, corpus_id, format, created_at',
  event_usage: '++id, corpus_id, event_id, [corpus_id+event_id]',
  linked_events: '++id, event_id, corpus_id, project_id, [event_id+project_id]',

  // New in v13
  project_analysis_snapshots: '++id, project_id, corpus_id, analysis_id, [project_id+analysis_id], updated_at, created_at',
});

// Phase 10 - Canon Engine v1
db.version(14).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
  event_annotations: '++id, corpus_id, event_id, [corpus_id+event_id]',
  saved_searches: '++id, corpus_id, name, created_at',
  export_history: '++id, corpus_id, format, created_at',
  event_usage: '++id, corpus_id, event_id, [corpus_id+event_id]',
  linked_events: '++id, event_id, corpus_id, project_id, [event_id+project_id]',
  project_analysis_snapshots: '++id, project_id, corpus_id, analysis_id, [project_id+analysis_id], updated_at, created_at',

  story_events: '++id, project_id, chapter_id, revision_id, scene_id, op_type, subject_id, target_id, thread_id, status, created_at, [project_id+chapter_id], [project_id+revision_id]',
  entity_state_current: '++id, project_id, entity_id, entity_type, updated_at, [project_id+entity_id]',
  plot_thread_state: '++id, project_id, thread_id, updated_at, [project_id+thread_id]',
  validator_reports: '++id, project_id, chapter_id, revision_id, scene_id, severity, status, created_at, [project_id+chapter_id], [project_id+revision_id]',
  memory_evidence: '++id, project_id, chapter_id, revision_id, scene_id, target_type, target_id, created_at, [project_id+revision_id]',
  chapter_revisions: '++id, project_id, chapter_id, revision_number, status, created_at, [project_id+chapter_id], [chapter_id+revision_number]',
  chapter_commits: '++id, project_id, chapter_id, status, updated_at, [project_id+chapter_id]',
  chapter_snapshots: '++id, project_id, chapter_id, revision_id, created_at, [project_id+chapter_id], [project_id+revision_id]',
});

// Phase 11 - Canon Near-Memory: item and relationship projections
db.version(15).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
  event_annotations: '++id, corpus_id, event_id, [corpus_id+event_id]',
  saved_searches: '++id, corpus_id, name, created_at',
  export_history: '++id, corpus_id, format, created_at',
  event_usage: '++id, corpus_id, event_id, [corpus_id+event_id]',
  linked_events: '++id, event_id, corpus_id, project_id, [event_id+project_id]',
  project_analysis_snapshots: '++id, project_id, corpus_id, analysis_id, [project_id+analysis_id], updated_at, created_at',
  story_events: '++id, project_id, chapter_id, revision_id, scene_id, op_type, subject_id, target_id, thread_id, status, created_at, [project_id+chapter_id], [project_id+revision_id]',
  entity_state_current: '++id, project_id, entity_id, entity_type, updated_at, [project_id+entity_id]',
  plot_thread_state: '++id, project_id, thread_id, updated_at, [project_id+thread_id]',
  validator_reports: '++id, project_id, chapter_id, revision_id, scene_id, severity, status, created_at, [project_id+chapter_id], [project_id+revision_id]',
  memory_evidence: '++id, project_id, chapter_id, revision_id, scene_id, target_type, target_id, created_at, [project_id+revision_id]',
  chapter_revisions: '++id, project_id, chapter_id, revision_number, status, created_at, [project_id+chapter_id], [chapter_id+revision_number]',
  chapter_commits: '++id, project_id, chapter_id, status, updated_at, [project_id+chapter_id]',
  chapter_snapshots: '++id, project_id, chapter_id, revision_id, created_at, [project_id+chapter_id], [project_id+revision_id]',
  item_state_current: '++id, project_id, object_id, updated_at, [project_id+object_id]',
  relationship_state_current: '++id, project_id, pair_key, updated_at, [project_id+pair_key]',
});

// Phase 12 - Project AI Chat
db.version(16).stores({
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
  factions: '++id, project_id, name, faction_type',
  macro_arcs: '++id, project_id, order_index',
  arcs: '++id, project_id, macro_arc_id, order_index',
  event_annotations: '++id, corpus_id, event_id, [corpus_id+event_id]',
  saved_searches: '++id, corpus_id, name, created_at',
  export_history: '++id, corpus_id, format, created_at',
  event_usage: '++id, corpus_id, event_id, [corpus_id+event_id]',
  linked_events: '++id, event_id, corpus_id, project_id, [event_id+project_id]',
  project_analysis_snapshots: '++id, project_id, corpus_id, analysis_id, [project_id+analysis_id], updated_at, created_at',
  story_events: '++id, project_id, chapter_id, revision_id, scene_id, op_type, subject_id, target_id, thread_id, status, created_at, [project_id+chapter_id], [project_id+revision_id]',
  entity_state_current: '++id, project_id, entity_id, entity_type, updated_at, [project_id+entity_id]',
  plot_thread_state: '++id, project_id, thread_id, updated_at, [project_id+thread_id]',
  validator_reports: '++id, project_id, chapter_id, revision_id, scene_id, severity, status, created_at, [project_id+chapter_id], [project_id+revision_id]',
  memory_evidence: '++id, project_id, chapter_id, revision_id, scene_id, target_type, target_id, created_at, [project_id+revision_id]',
  chapter_revisions: '++id, project_id, chapter_id, revision_number, status, created_at, [project_id+chapter_id], [chapter_id+revision_number]',
  chapter_commits: '++id, project_id, chapter_id, status, updated_at, [project_id+chapter_id]',
  chapter_snapshots: '++id, project_id, chapter_id, revision_id, created_at, [project_id+chapter_id], [project_id+revision_id]',
  item_state_current: '++id, project_id, object_id, updated_at, [project_id+object_id]',
  relationship_state_current: '++id, project_id, pair_key, updated_at, [project_id+pair_key]',

  ai_chat_threads: '++id, project_id, updated_at, created_at',
  ai_chat_messages: '++id, project_id, thread_id, created_at, [thread_id+created_at]',
}).upgrade((tx) => {
  return tx.table('ai_chat_threads').toCollection().modify((thread) => {
    if (thread.system_prompt === undefined) thread.system_prompt = '';
    if (thread.model_override === undefined) thread.model_override = '';
    if (thread.last_provider === undefined) thread.last_provider = '';
    if (thread.last_model === undefined) thread.last_model = '';
  });
});

// ─── Plot Suggestions helpers ────────────────────────────────────────────────

db.getPlotSuggestions = (chapterId) =>
  db.suggestions
    .where('source_chapter_id').equals(chapterId)
    .filter(s => s.source_type === 'plot_suggestion' && s.status === 'pending')
    .toArray();

db.savePlotSuggestions = async (chapterId, projectId, suggestions) => {
  // Delete existing pending suggestions for this chapter
  const existing = await db.suggestions
    .where('source_chapter_id').equals(chapterId)
    .filter(s => s.source_type === 'plot_suggestion')
    .toArray();
  if (existing.length > 0) {
    await db.suggestions.bulkDelete(existing.map(s => s.id));
  }
  if (suggestions.length === 0) return;
  await db.suggestions.bulkAdd(suggestions.map(s => ({
    project_id: projectId,
    source_chapter_id: chapterId,
    source_type: 'plot_suggestion',
    type: 'plot_suggestion',
    status: 'pending',
    target_id: null,
    target_name: '',
    current_value: s.direction || '',
    suggested_value: s.title || '',
    fact_type: s.type || 'main',
    reasoning: s.summary || s.description || '',
    created_at: Date.now(),
  })));
};

export default db;
