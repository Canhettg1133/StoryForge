export const PROJECT_SNAPSHOT_VERSION = 8;

export const PROJECT_SNAPSHOT_TABLES = Object.freeze([
  { key: 'chapters', table: 'chapters' },
  { key: 'scenes', table: 'scenes' },
  { key: 'characters', table: 'characters' },
  { key: 'characterStates', table: 'characterStates' },
  { key: 'relationships', table: 'relationships' },
  { key: 'locations', table: 'locations' },
  { key: 'objects', table: 'objects' },
  { key: 'canonFacts', table: 'canonFacts' },
  { key: 'plotThreads', table: 'plotThreads' },
  { key: 'timelineEvents', table: 'timelineEvents' },
  { key: 'stylePacks', table: 'stylePacks' },
  { key: 'voicePacks', table: 'voicePacks' },
  { key: 'qaReports', table: 'qaReports' },
  { key: 'worldTerms', table: 'worldTerms' },
  { key: 'taboos', table: 'taboos' },
  { key: 'chapterMeta', table: 'chapterMeta' },
  { key: 'suggestions', table: 'suggestions' },
  { key: 'entityTimeline', table: 'entityTimeline' },
  { key: 'factions', table: 'factions' },
  { key: 'macro_arcs', table: 'macro_arcs' },
  { key: 'arcs', table: 'arcs' },
  { key: 'linked_events', table: 'linked_events' },
  { key: 'project_analysis_snapshots', table: 'project_analysis_snapshots' },
  { key: 'story_events', table: 'story_events' },
  { key: 'entity_state_current', table: 'entity_state_current' },
  { key: 'plot_thread_state', table: 'plot_thread_state' },
  { key: 'validator_reports', table: 'validator_reports' },
  { key: 'memory_evidence', table: 'memory_evidence' },
  { key: 'chapter_revisions', table: 'chapter_revisions' },
  { key: 'chapter_commits', table: 'chapter_commits' },
  { key: 'chapter_snapshots', table: 'chapter_snapshots' },
  { key: 'item_state_current', table: 'item_state_current' },
  { key: 'relationship_state_current', table: 'relationship_state_current' },
  { key: 'canon_purge_archives', table: 'canon_purge_archives' },
  { key: 'entity_resolution_candidates', table: 'entity_resolution_candidates' },
  { key: 'project_assets', table: 'project_assets' },
]);

export const PROJECT_INDIRECT_SNAPSHOT_TABLES = Object.freeze([
  { key: 'threadBeats', table: 'threadBeats', owner: 'plot_thread_id' },
  { key: 'revisions', table: 'revisions', owner: 'scene_id' },
]);

export const PROJECT_CHAT_TABLES = Object.freeze([
  'ai_chat_threads',
  'ai_chat_messages',
  'ai_chat_attachments',
  'ai_chat_attachment_chunks',
  'ai_chat_message_attachments',
]);

export const PROJECT_RUNTIME_TABLES = Object.freeze([
  'styleJobs',
  'aiJobs',
  'storyMirrorOutbox',
  'storyMirrorStatus',
]);

export function getExistingTables(database, names) {
  return names.map((name) => database?.[name]).filter(Boolean);
}

export function getProjectSnapshotTransactionTables(database, { includeChats = false } = {}) {
  const names = new Set([
    'projects',
    ...PROJECT_SNAPSHOT_TABLES.map((item) => item.table),
    ...PROJECT_INDIRECT_SNAPSHOT_TABLES.map((item) => item.table),
    ...(includeChats ? PROJECT_CHAT_TABLES : []),
  ]);
  return getExistingTables(database, [...names]);
}

export function getProjectCascadeTransactionTables(database) {
  const names = new Set([
    ...getProjectSnapshotTransactionTables(database, { includeChats: true }).map((table) => table.name),
    ...PROJECT_RUNTIME_TABLES,
  ]);
  return getExistingTables(database, [...names]);
}
