import {
  ensurePostgresBootstrapped,
  queryPostgres,
} from './client.js';

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS corpuses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  source_file TEXT,
  file_type TEXT,
  front_matter JSONB,
  parse_diagnostics JSONB,
  fandom TEXT,
  fandom_confidence DOUBLE PRECISION,
  is_canon_fanfic TEXT,
  rating TEXT,
  language TEXT DEFAULT 'vi',
  chunk_size INTEGER DEFAULT 750,
  chunk_size_used INTEGER,
  chunk_count INTEGER DEFAULT 0,
  last_rechunked_at BIGINT,
  word_count INTEGER DEFAULT 0,
  chapter_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'uploaded',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

ALTER TABLE corpuses ADD COLUMN IF NOT EXISTS front_matter JSONB;
ALTER TABLE corpuses ADD COLUMN IF NOT EXISTS parse_diagnostics JSONB;

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  start_line INTEGER,
  end_line INTEGER,
  start_page INTEGER,
  end_page INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  start_position INTEGER,
  start_word TEXT,
  end_word TEXT
);

CREATE TABLE IF NOT EXISTS corpus_analyses (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  chunk_size INTEGER DEFAULT 750,
  chunk_overlap INTEGER DEFAULT 100,
  provider TEXT DEFAULT 'gemini_proxy',
  model TEXT,
  temperature DOUBLE PRECISION DEFAULT 0.2,
  status TEXT DEFAULT 'pending',
  level_0_status TEXT DEFAULT 'pending',
  level_1_status TEXT DEFAULT 'pending',
  level_2_status TEXT DEFAULT 'pending',
  result_l1 TEXT,
  result_l2 TEXT,
  result_l3 TEXT,
  result_l4 TEXT,
  result_l5 TEXT,
  result_l6 TEXT,
  final_result TEXT,
  analysis_run_manifest JSONB,
  pass_status JSONB,
  degraded_run_report JSONB,
  graph_summary JSONB,
  artifact_version TEXT DEFAULT 'legacy',
  total_chunks INTEGER DEFAULT 0,
  processed_chunks INTEGER DEFAULT 0,
  progress DOUBLE PRECISION DEFAULT 0,
  current_phase TEXT,
  parts_generated INTEGER DEFAULT 0,
  error_message TEXT,
  created_at BIGINT,
  started_at BIGINT,
  completed_at BIGINT
);

CREATE TABLE IF NOT EXISTS analysis_run_artifacts (
  analysis_id TEXT PRIMARY KEY REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  artifact_version TEXT NOT NULL DEFAULT 'v3',
  canonical_corpus JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
  window_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  carry_packets JSONB NOT NULL DEFAULT '[]'::jsonb,
  incident_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  incidents JSONB NOT NULL DEFAULT '[]'::jsonb,
  incident_beats JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  canonical_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  graph_projections JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_queue JSONB NOT NULL DEFAULT '[]'::jsonb,
  pass_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  rerun_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  degraded_run_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

ALTER TABLE corpus_analyses ADD COLUMN IF NOT EXISTS artifact_revision INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS analysis_windows (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  window_id TEXT NOT NULL,
  window_order INTEGER NOT NULL,
  chapter_start INTEGER NOT NULL,
  chapter_end INTEGER NOT NULL,
  overlap_from_previous INTEGER DEFAULT 0,
  chapter_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  carry_in JSONB,
  carry_out JSONB,
  open_boundaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  incidents JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  retries INTEGER DEFAULT 0,
  degraded_reason TEXT,
  prompt_version TEXT,
  schema_version TEXT DEFAULT 'v3',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (analysis_id, window_id)
);

CREATE TABLE IF NOT EXISTS analysis_incidents (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  chapter_start INTEGER,
  chapter_end INTEGER,
  chapter_start_number INTEGER,
  chapter_end_number INTEGER,
  confidence DOUBLE PRECISION DEFAULT 0,
  summary TEXT,
  detailed_summary TEXT,
  climax TEXT,
  outcome TEXT,
  consequences JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT DEFAULT 'needs_review',
  degraded_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  lineage JSONB NOT NULL DEFAULT '{}'::jsonb,
  rerun_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_beats (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  incident_id TEXT REFERENCES analysis_incidents(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  chapter_number INTEGER,
  beat_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  causal_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_entities (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  description TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  review_status TEXT DEFAULT 'needs_review',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_entity_mentions (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES analysis_entities(id) ON DELETE SET NULL,
  beat_id TEXT REFERENCES analysis_beats(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  surface_form TEXT NOT NULL,
  canonical_entity_id TEXT,
  chapter_number INTEGER,
  evidence_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_review_queue (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  priority TEXT NOT NULL,
  priority_score DOUBLE PRECISION DEFAULT 0,
  source_phase TEXT,
  rerun_scope TEXT,
  related_window_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_incident_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_action TEXT,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'pending',
  resolution TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_results (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chapter_id TEXT,
  processing_time_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  result TEXT,
  error TEXT,
  started_at BIGINT,
  completed_at BIGINT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  start_chapter_id TEXT,
  start_chunk_id TEXT,
  end_chapter_id TEXT,
  end_chunk_id TEXT,
  chapter_start_index INTEGER,
  chapter_end_index INTEGER,
  chunk_start_index INTEGER,
  chunk_end_index INTEGER,
  chapter_start_number INTEGER,
  chapter_end_number INTEGER,
  start_anchor TEXT,
  active_span INTEGER,
  climax_anchor TEXT,
  end_anchor TEXT,
  boundary_note TEXT,
  uncertain_start BOOLEAN DEFAULT FALSE,
  uncertain_end BOOLEAN DEFAULT FALSE,
  confidence DOUBLE PRECISION DEFAULT 0,
  evidence TEXT,
  contained_events TEXT,
  sub_incident_ids TEXT,
  related_incidents TEXT,
  related_locations TEXT,
  causal_predecessors TEXT,
  causal_successors TEXT,
  major_score DOUBLE PRECISION DEFAULT 0,
  impact_score DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'pending',
  review_status TEXT DEFAULT 'needs_review',
  priority TEXT,
  provenance JSONB,
  created_at BIGINT,
  analyzed_at BIGINT,
  reviewed_at BIGINT
);

CREATE TABLE IF NOT EXISTS analysis_events (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  severity DOUBLE PRECISION DEFAULT 0,
  tags TEXT,
  chapter_id TEXT,
  chapter_index INTEGER,
  chapter_number INTEGER,
  chunk_id TEXT,
  chunk_index INTEGER,
  incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  link_role TEXT DEFAULT 'primary',
  secondary_incident_ids TEXT,
  location_link TEXT,
  causal_links TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  evidence TEXT,
  quality_proxy INTEGER DEFAULT 0,
  review_status TEXT DEFAULT 'needs_review',
  needs_review BOOLEAN DEFAULT TRUE,
  annotation TEXT,
  provenance JSONB,
  created_at BIGINT,
  grounded_at BIGINT,
  reviewed_at BIGINT
);

CREATE TABLE IF NOT EXISTS analysis_locations (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized TEXT,
  aliases TEXT,
  mention_count INTEGER DEFAULT 0,
  chapter_start INTEGER,
  chapter_end INTEGER,
  chapter_start_number INTEGER,
  chapter_end_number INTEGER,
  chapter_spread TEXT,
  importance DOUBLE PRECISION DEFAULT 0,
  is_major BOOLEAN DEFAULT FALSE,
  tokens TEXT,
  evidence TEXT,
  incident_ids TEXT,
  event_ids TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  evidence_strength DOUBLE PRECISION DEFAULT 0,
  review_status TEXT DEFAULT 'needs_review',
  provenance JSONB,
  created_at BIGINT,
  reviewed_at BIGINT
);

CREATE TABLE IF NOT EXISTS consistency_risks (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT,
  details TEXT,
  involved_incidents TEXT,
  involved_events TEXT,
  involved_locations TEXT,
  evidence TEXT,
  chapter_start INTEGER,
  chapter_end INTEGER,
  resolved BOOLEAN DEFAULT FALSE,
  resolution TEXT,
  resolved_at BIGINT,
  detected_at BIGINT
);

CREATE TABLE IF NOT EXISTS review_queue (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  priority TEXT NOT NULL,
  priority_score DOUBLE PRECISION DEFAULT 0,
  score_breakdown TEXT,
  reason TEXT,
  suggestions TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at BIGINT,
  resolution TEXT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS analysis_graph_nodes (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence DOUBLE PRECISION DEFAULT 0,
  chapter_number INTEGER,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

ALTER TABLE analysis_graph_nodes ADD COLUMN IF NOT EXISTS graph_kind TEXT DEFAULT 'incident';

CREATE TABLE IF NOT EXISTS analysis_graph_edges (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  confidence DOUBLE PRECISION DEFAULT 0,
  source_pass TEXT,
  review_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

ALTER TABLE analysis_graph_edges ADD COLUMN IF NOT EXISTS graph_kind TEXT DEFAULT 'incident';

CREATE TABLE IF NOT EXISTS analysis_pass_reports (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  pass_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_execution_sessions (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  lock_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  scope_phase TEXT NOT NULL,
  requested_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  planned_jobs JSONB NOT NULL DEFAULT '[]'::jsonb,
  baseline_artifact_revision INTEGER NOT NULL DEFAULT 0,
  target_artifact_revision INTEGER NOT NULL DEFAULT 1,
  current_stage_key TEXT,
  current_job_id TEXT,
  root_job_id TEXT,
  final_job_id TEXT,
  error_message TEXT,
  last_heartbeat_at BIGINT NOT NULL,
  lease_expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  released_at BIGINT
);

CREATE TABLE IF NOT EXISTS analysis_execution_stage_outputs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analysis_execution_sessions(id) ON DELETE CASCADE,
  corpus_id TEXT NOT NULL REFERENCES corpuses(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (session_id, stage_key)
);

CREATE TABLE IF NOT EXISTS project_analysis_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  corpus_id TEXT REFERENCES corpuses(id) ON DELETE SET NULL,
  analysis_id TEXT NOT NULL REFERENCES corpus_analyses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed',
  layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_json JSONB,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact_version TEXT NOT NULL DEFAULT 'v2',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (project_id, analysis_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  progress_message TEXT,
  input_data TEXT NOT NULL,
  output_data TEXT,
  error_message TEXT,
  error_stack TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT,
  priority INTEGER DEFAULT 0,
  worker_id TEXT
);

CREATE TABLE IF NOT EXISTS job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  message TEXT,
  UNIQUE (job_id, step_name)
);

CREATE TABLE IF NOT EXISTS job_dependencies (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  depends_on_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_corpuses_status_created ON corpuses(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chapters_corpus_order ON chapters(corpus_id, chapter_index ASC);
CREATE INDEX IF NOT EXISTS idx_chunks_chapter_order ON chunks(chapter_id, chunk_index ASC);
CREATE INDEX IF NOT EXISTS idx_chunks_corpus ON chunks(corpus_id);
CREATE INDEX IF NOT EXISTS idx_analyses_corpus ON corpus_analyses(corpus_id);
CREATE INDEX IF NOT EXISTS idx_incidents_analysis ON incidents(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_run_artifacts_analysis ON analysis_run_artifacts(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_windows_analysis_order ON analysis_windows(analysis_id, window_order ASC);
CREATE INDEX IF NOT EXISTS idx_analysis_incidents_analysis ON analysis_incidents(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_beats_analysis_incident ON analysis_beats(analysis_id, incident_id, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_analysis_entities_analysis_kind ON analysis_entities(analysis_id, entity_kind);
CREATE INDEX IF NOT EXISTS idx_analysis_entity_mentions_analysis_entity ON analysis_entity_mentions(analysis_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_analysis_review_queue_analysis ON analysis_review_queue(analysis_id, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_events_analysis ON analysis_events(analysis_id);
CREATE INDEX IF NOT EXISTS idx_locations_analysis ON analysis_locations(analysis_id);
CREATE INDEX IF NOT EXISTS idx_review_analysis ON review_queue(analysis_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_analysis_kind ON analysis_graph_nodes(analysis_id, graph_kind);
CREATE INDEX IF NOT EXISTS idx_graph_edges_analysis_kind ON analysis_graph_edges(analysis_id, graph_kind);
CREATE INDEX IF NOT EXISTS idx_project_analysis_snapshots_project ON project_analysis_snapshots(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_analysis_execution_sessions_analysis_status ON analysis_execution_sessions(analysis_id, status, lease_expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_execution_stage_outputs_session_stage ON analysis_execution_stage_outputs(session_id, stage_key);
`;

export async function bootstrapPostgres() {
  return ensurePostgresBootstrapped(async () => {
    await queryPostgres(BOOTSTRAP_SQL);
  });
}
