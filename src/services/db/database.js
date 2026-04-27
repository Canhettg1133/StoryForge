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

db.version(17).stores({
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
    if (thread.sticky_provider_override === undefined) thread.sticky_provider_override = '';
    if (thread.sticky_model_override === undefined) thread.sticky_model_override = '';
  });
});

// ─── Plot Suggestions helpers ────────────────────────────────────────────────

db.version(18).stores({
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
  canon_purge_archives: '++id, project_id, chapter_id, created_at',
  ai_chat_threads: '++id, project_id, updated_at, created_at',
  ai_chat_messages: '++id, project_id, thread_id, created_at, [thread_id+created_at]',
}).upgrade((tx) => {
  return tx.table('ai_chat_threads').toCollection().modify((thread) => {
    if (thread.system_prompt === undefined) thread.system_prompt = '';
    if (thread.model_override === undefined) thread.model_override = '';
    if (thread.last_provider === undefined) thread.last_provider = '';
    if (thread.last_model === undefined) thread.last_model = '';
    if (thread.sticky_provider_override === undefined) thread.sticky_provider_override = '';
    if (thread.sticky_model_override === undefined) thread.sticky_model_override = '';
  });
});

function dbNormalizeText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dbStripDiacritics(value = '') {
  return dbNormalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function dbNormalizeName(value = '') {
  return dbStripDiacritics(value)
    .replace(/[\u2018\u2019\u201c\u201d"'`()\[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dbMergeUniqueText(existing = [], incoming = []) {
  const seen = new Set();
  const result = [];
  for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const text = dbNormalizeText(value);
    const key = dbNormalizeName(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function dbBuildEntityIdentityKey(kind, name = '') {
  return `${kind}:${dbNormalizeName(name)}`;
}

function dbBuildFactSubjectScope(fact = {}) {
  const subjectType = dbNormalizeText(fact.subject_type || '');
  const subjectId = fact.subject_id ?? null;
  if (subjectType && subjectId != null) {
    return `${subjectType}:${subjectId}`;
  }
  const subjectText = dbNormalizeName(
    fact.subject_name
    || fact.subjectName
    || fact.subject_text
    || fact.subjectText
    || '',
  );
  return subjectText ? `text:${subjectText}` : 'global';
}

function dbBuildFactFingerprint(fact = {}) {
  const factType = dbNormalizeText(fact.fact_type || 'fact') || 'fact';
  const normalizedDescription = dbNormalizeName(
    fact.normalized_description
    || fact.description
    || fact.fact_description
    || '',
  );
  const subjectScope = dbNormalizeText(fact.subject_scope || dbBuildFactSubjectScope(fact)) || 'global';
  return `${factType}|${normalizedDescription}|${subjectScope}`;
}

function dbValueRichness(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return dbNormalizeText(value) ? 1 : 0;
}

function dbScoreRecord(record = {}, ignoredKeys = []) {
  const ignored = new Set(['id', 'project_id', 'created_at', 'updated_at', ...ignoredKeys]);
  return Object.entries(record).reduce((score, [key, value]) => {
    if (ignored.has(key)) return score;
    return score + dbValueRichness(value);
  }, 0);
}

function dbChooseSurvivor(records = [], ignoredKeys = []) {
  return [...records].sort((left, right) => {
    const scoreDiff = dbScoreRecord(right, ignoredKeys) - dbScoreRecord(left, ignoredKeys);
    if (scoreDiff !== 0) return scoreDiff;
    const createdDiff = Number(left.created_at || 0) - Number(right.created_at || 0);
    if (createdDiff !== 0) return createdDiff;
    return Number(left.id || 0) - Number(right.id || 0);
  })[0] || null;
}

async function dbRewriteCharacterRefs(tx, projectId, fromId, toId) {
  await tx.table('relationships').where('project_id').equals(projectId).modify((row) => {
    if (row.character_a_id === fromId) row.character_a_id = toId;
    if (row.character_b_id === fromId) row.character_b_id = toId;
  });
  await tx.table('objects').where('project_id').equals(projectId).modify((row) => {
    if (row.owner_character_id === fromId) row.owner_character_id = toId;
  });
  await tx.table('taboos').where('project_id').equals(projectId).modify((row) => {
    if (row.character_id === fromId) row.character_id = toId;
  });
  await tx.table('voicePacks').where('project_id').equals(projectId).modify((row) => {
    if (row.character_id === fromId) row.character_id = toId;
  });
  await tx.table('scenes').where('project_id').equals(projectId).modify((row) => {
    if (row.pov_character_id === fromId) row.pov_character_id = toId;
    try {
      const present = JSON.parse(row.characters_present || '[]');
      if (Array.isArray(present)) {
        row.characters_present = JSON.stringify(present.map((value) => (value === fromId ? toId : value)));
      }
    } catch {}
  });
  await tx.table('story_events').where('project_id').equals(projectId).modify((row) => {
    if (row.subject_id === fromId) row.subject_id = toId;
    if (row.target_id === fromId) row.target_id = toId;
  });
  await tx.table('entity_state_current').where('project_id').equals(projectId).modify((row) => {
    if (row.entity_type === 'character' && row.entity_id === fromId) row.entity_id = toId;
  });
}

async function dbRewriteFactRefs(tx, projectId, fromId, toId) {
  await tx.table('story_events').where('project_id').equals(projectId).modify((row) => {
    if (row.fact_id === fromId) row.fact_id = toId;
  });
}

export async function repairEntityTableDuplicates(tx, tableName, kind) {
  const rows = await tx.table(tableName).toArray();
  const grouped = rows.reduce((map, row) => {
    const key = `${row.project_id}:${row.normalized_name || dbNormalizeName(row.name || '')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
    return map;
  }, new Map());
  const affectedProjects = new Set();

  for (const duplicates of grouped.values()) {
    if (duplicates.length < 2) continue;
    const survivor = dbChooseSurvivor(duplicates, ['normalized_name', 'alias_keys', 'identity_key']);
    if (!survivor) continue;
    affectedProjects.add(Number(survivor.project_id));
    for (const duplicate of duplicates) {
      if (duplicate.id === survivor.id) continue;
      if (kind === 'character') {
        await dbRewriteCharacterRefs(tx, survivor.project_id, duplicate.id, survivor.id);
      }
      await tx.table(tableName).delete(duplicate.id);
    }
  }

  return [...affectedProjects];
}

export async function repairCanonFactDuplicates(tx) {
  const facts = await tx.table('canonFacts').toArray();
  const factGroups = facts.reduce((map, row) => {
    const key = `${row.project_id}:${row.fact_fingerprint || dbBuildFactFingerprint(row)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
    return map;
  }, new Map());
  const affectedProjects = new Set();

  for (const duplicates of factGroups.values()) {
    if (duplicates.length < 2) continue;
    const survivor = dbChooseSurvivor(duplicates, ['normalized_description', 'subject_scope', 'fact_fingerprint']);
    if (!survivor) continue;
    affectedProjects.add(Number(survivor.project_id));
    for (const duplicate of duplicates) {
      if (duplicate.id === survivor.id) continue;
      await dbRewriteFactRefs(tx, survivor.project_id, duplicate.id, survivor.id);
      await tx.table('canonFacts').delete(duplicate.id);
    }
  }

  return [...affectedProjects];
}

export async function flagProjectsForCanonRebuild(tx, projectIds = []) {
  const normalizedIds = [...new Set((projectIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  for (const projectId of normalizedIds) {
    await tx.table('projects').where('id').equals(projectId).modify((project) => {
      project.canon_rebuild_required = true;
    });
  }
  return normalizedIds;
}

export async function rebuildFlaggedCanonProjects(database = db) {
  const projects = await database.projects
    .filter((project) => Boolean(project?.canon_rebuild_required))
    .toArray();
  if (projects.length === 0) return [];

  const { rebuildCanonFromChapter } = await import('../canon/projection.js');
  const rebuiltIds = [];
  for (const project of projects) {
    await rebuildCanonFromChapter(project.id, null, { cleanLegacyProjection: true });
    await database.projects.update(project.id, {
      canon_rebuild_required: false,
      updated_at: Date.now(),
    });
    rebuiltIds.push(project.id);
  }
  return rebuiltIds;
}

let backgroundCanonRebuildPromise = null;
let backgroundCanonRebuildQueued = false;

async function runBackgroundCanonRebuild(database = db) {
  if (backgroundCanonRebuildPromise) {
    return backgroundCanonRebuildPromise;
  }

  backgroundCanonRebuildPromise = (async () => {
    try {
      const rebuiltIds = await rebuildFlaggedCanonProjects(database);
      if (rebuiltIds.length > 0) {
        console.info('[DB] Background canon rebuild completed for projects:', rebuiltIds);
      }
      return rebuiltIds;
    } catch (error) {
      console.error('[DB] Background canon rebuild failed:', error);
      return [];
    } finally {
      backgroundCanonRebuildPromise = null;
    }
  })();

  return backgroundCanonRebuildPromise;
}

export function scheduleBackgroundCanonRebuild(database = db, options = {}) {
  if (backgroundCanonRebuildQueued) {
    return;
  }

  backgroundCanonRebuildQueued = true;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 600;
  const idleTimeoutMs = Number.isFinite(options.idleTimeoutMs) ? options.idleTimeoutMs : 2000;

  const start = () => {
    backgroundCanonRebuildQueued = false;
    void runBackgroundCanonRebuild(database);
  };

  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(() => {
      globalThis.setTimeout(start, delayMs);
    }, { timeout: idleTimeoutMs });
    return;
  }

  globalThis.setTimeout(start, delayMs);
}

// Phase 19 was originally introduced with unique compound indexes for
// normalized entity names and canon fact fingerprints. That is unsafe for
// live IndexedDB upgrades because legacy duplicate rows can trigger
// ConstraintError during the same upgrade transaction, aborting DB open and
// making the app appear empty. Keep the normalized fields and compound
// indexes, but do not enforce uniqueness at the storage layer here.
db.version(19).stores({
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role, normalized_name, [project_id+normalized_name]',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name, normalized_name, [project_id+normalized_name]',
  objects: '++id, project_id, name, owner_character_id, normalized_name, [project_id+normalized_name]',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status, fact_fingerprint, [project_id+fact_fingerprint]',
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
  worldTerms: '++id, project_id, name, category, normalized_name, [project_id+normalized_name]',
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
  canon_purge_archives: '++id, project_id, chapter_id, created_at',
  ai_chat_threads: '++id, project_id, updated_at, created_at',
  ai_chat_messages: '++id, project_id, thread_id, created_at, [thread_id+created_at]',
  entity_resolution_candidates: '++id, project_id, chapter_id, revision_id, session_key, entity_kind, resolution_status, normalized_name, identity_key, matched_entity_id, created_at, updated_at',
}).upgrade(async (tx) => {
  await tx.table('characters').toCollection().modify((row) => {
    row.normalized_name = dbNormalizeName(row.name || '');
    row.alias_keys = dbMergeUniqueText([], row.aliases || []).map((alias) => dbNormalizeName(alias));
    row.identity_key = dbBuildEntityIdentityKey('character', row.name || '');
  });
  await tx.table('locations').toCollection().modify((row) => {
    row.normalized_name = dbNormalizeName(row.name || '');
    row.alias_keys = dbMergeUniqueText([], row.aliases || []).map((alias) => dbNormalizeName(alias));
    row.identity_key = dbBuildEntityIdentityKey('location', row.name || '');
  });
  await tx.table('objects').toCollection().modify((row) => {
    row.normalized_name = dbNormalizeName(row.name || '');
    row.alias_keys = [];
    row.identity_key = dbBuildEntityIdentityKey('object', row.name || '');
  });
  await tx.table('worldTerms').toCollection().modify((row) => {
    row.normalized_name = dbNormalizeName(row.name || '');
    row.alias_keys = dbMergeUniqueText([], row.aliases || []).map((alias) => dbNormalizeName(alias));
    row.identity_key = dbBuildEntityIdentityKey('world_term', row.name || '');
  });
  await tx.table('canonFacts').toCollection().modify((row) => {
    row.normalized_description = dbNormalizeName(row.description || row.fact_description || '');
    row.subject_scope = dbBuildFactSubjectScope(row);
    row.fact_fingerprint = dbBuildFactFingerprint(row);
  });

  const affectedProjects = new Set();
  const entityTables = [
    ['characters', 'character'],
    ['locations', 'location'],
    ['objects', 'object'],
    ['worldTerms', 'world_term'],
  ];

  for (const [tableName, kind] of entityTables) {
    const repaired = await repairEntityTableDuplicates(tx, tableName, kind);
    repaired.forEach((id) => affectedProjects.add(id));
  }
  const repairedFacts = await repairCanonFactDuplicates(tx);
  repairedFacts.forEach((id) => affectedProjects.add(id));
  await flagProjectsForCanonRebuild(tx, [...affectedProjects]);
});

// Force a schema reconciliation for installations that already reached the
// original v19 unique-index layout successfully. This downgrades those
// storage-level constraints back to non-unique compound indexes so old
// projects remain openable even with legacy duplicate data.
db.version(20).stores({
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role, normalized_name, [project_id+normalized_name]',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name, normalized_name, [project_id+normalized_name]',
  objects: '++id, project_id, name, owner_character_id, normalized_name, [project_id+normalized_name]',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status, fact_fingerprint, [project_id+fact_fingerprint]',
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
  worldTerms: '++id, project_id, name, category, normalized_name, [project_id+normalized_name]',
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
  canon_purge_archives: '++id, project_id, chapter_id, created_at',
  ai_chat_threads: '++id, project_id, updated_at, created_at',
  ai_chat_messages: '++id, project_id, thread_id, created_at, [thread_id+created_at]',
  entity_resolution_candidates: '++id, project_id, chapter_id, revision_id, session_key, entity_kind, resolution_status, normalized_name, identity_key, matched_entity_id, created_at, updated_at',
});

// Phase 21 - Canon Role Locks on characters.
//
// specific_role and specific_role_locked are non-indexed character fields.
// Keep the schema unchanged and backfill legacy rows so UI/context code can
// rely on stable defaults.
db.version(21).stores({
  projects: '++id, title, genre_primary, status, created_at, updated_at',
  chapters: '++id, project_id, arc_id, order_index, title, status',
  scenes: '++id, project_id, chapter_id, order_index, title, pov_character_id, status',
  characters: '++id, project_id, name, role, normalized_name, [project_id+normalized_name]',
  characterStates: '++id, project_id, character_id, scene_id',
  relationships: '++id, project_id, character_a_id, character_b_id, relation_type',
  locations: '++id, project_id, name, normalized_name, [project_id+normalized_name]',
  objects: '++id, project_id, name, owner_character_id, normalized_name, [project_id+normalized_name]',
  canonFacts: '++id, project_id, fact_type, subject_type, subject_id, status, fact_fingerprint, [project_id+fact_fingerprint]',
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
  worldTerms: '++id, project_id, name, category, normalized_name, [project_id+normalized_name]',
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
  canon_purge_archives: '++id, project_id, chapter_id, created_at',
  ai_chat_threads: '++id, project_id, updated_at, created_at',
  ai_chat_messages: '++id, project_id, thread_id, created_at, [thread_id+created_at]',
  entity_resolution_candidates: '++id, project_id, chapter_id, revision_id, session_key, entity_kind, resolution_status, normalized_name, identity_key, matched_entity_id, created_at, updated_at',
}).upgrade((tx) => {
  return tx.table('characters').toCollection().modify((character) => {
    if (character.specific_role === undefined) character.specific_role = '';
    if (character.specific_role_locked === undefined) character.specific_role_locked = false;
    if (!String(character.specific_role || '').trim()) character.specific_role_locked = false;
  });
});

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
  const normalizedSuggestions = suggestions
    .map((suggestion, index) => {
      if (typeof suggestion === 'string') {
        const summary = suggestion.trim();
        if (!summary) return null;
        const title = summary
          .replace(/^\*{0,2}\d+[\.\):\-]*\*{0,2}\s*/, '')
          .split(/[.!?\n]/)[0]
          .trim() || `Huong ${index + 1}`;
        return {
          title,
          summary,
          direction: summary,
          type: 'main',
        };
      }

      if (!suggestion || typeof suggestion !== 'object') return null;

      const title = String(
        suggestion.title
        || suggestion.suggested_value
        || ''
      ).trim();
      const summary = String(
        suggestion.summary
        || suggestion.reasoning
        || suggestion.description
        || suggestion.current_value
        || ''
      ).trim();
      const guidance = String(
        suggestion.guidance
        || suggestion.direction
        || summary
        || title
      ).trim();

      return {
        title: title || `Huong ${index + 1}`,
        summary: summary || guidance || title || `Huong ${index + 1}`,
        direction: guidance || summary || title || '',
        type: suggestion.type || suggestion.fact_type || 'main',
      };
    })
    .filter(Boolean);

  if (normalizedSuggestions.length === 0) return;

  await db.suggestions.bulkAdd(normalizedSuggestions.map(s => ({
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

db.on('ready', () => {
  // Do not block Dexie open on expensive canon rebuild work.
  // Schedule it after startup so project/dashboard loads remain responsive.
  scheduleBackgroundCanonRebuild(db);
});

export default db;
