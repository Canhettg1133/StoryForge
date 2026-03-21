# 06 – Data Models

18 data models ở mức sản phẩm.

---

## Core Entities

### Project
```
id, title, description, genre_primary, genre_secondary, tone,
audience, status, writing_mode, default_style_pack_id,
created_at, updated_at
```

### Chapter
```
id, project_id, arc_id, order_index, title, summary, purpose,
status, word_count_target, actual_word_count
```

### Scene
```
id, project_id, chapter_id, order_index, title, summary,
pov_character_id, location_id, time_marker, goal, conflict,
emotional_start, emotional_end, status, draft_text, final_text
```

---

## Characters & Relationships

### Character
```
id, project_id, name, role, description, backstory, goal, fear,
secret, arc_summary, voice_pack_id
```

### CharacterState
```
id, project_id, character_id, scene_id, health_state,
emotional_state, trust_map, knowledge_state,
inventory_state, location_state
```

### Relationship
```
id, project_id, character_a_id, character_b_id, relation_type,
intensity, hidden_from_reader, hidden_from_characters,
start_scene_id, end_scene_id
```

---

## World Building

### Location
```
id, project_id, name, description, rules, tags
```

### Object / Item
```
id, project_id, name, description, owner_character_id,
current_location_id, significance, current_status
```

---

## Canon & Plot

### CanonFact
```
id, project_id, fact_type, subject_type, subject_id, content,
scope, source_scene_id, valid_from_scene_id, valid_to_scene_id,
secrecy_level, known_by_entities, confidence_score, status
```

### PlotThread
```
id, project_id, title, description, type, state,
start_scene_id, planned_payoff_scene_id, actual_payoff_scene_id
```

### ThreadBeat
```
id, plot_thread_id, scene_id, beat_type, notes
```

### TimelineEvent
```
id, project_id, scene_id, date_marker, duration,
location_id, participants, description
```

---

## Style & Voice

### StylePack
```
id, project_id, name, type, source_kind,
description,
sentence_profile, dialogue_profile, pacing_profile,
narrative_profile,
narrative_distance, emotional_intensity,
dominant_traits, banned_traits, exemplar_snippets
```

- `source_kind`: `current_project` | `reference_upload` | `author_sample`
- `narrative_profile`: cách mở chương, cách build tension, cách chuyển cảnh, cách kết chương, cách nhả thông tin, cách gài twist

### VoicePack
```
id, project_id, character_id, speaking_style,
speech_traits, favorite_patterns, taboo_patterns,
rhythm_profile, emotional_expression_style
```

- `speaking_style`: mô tả tổng quát ("nói ngắn, lạnh, cộc" / "nói vòng, mềm, ẩn ý")
- `favorite_patterns`: pattern nói hay dùng

### StyleJob
```
id, project_id, style_pack_id,
file_upload_path, parsing_status, analyzed_status,
quality_score, usable_scenes_extracted,
created_at, completed_at
```

### GenrePack
```
id, name, default_world_fields, prompt_rules, qa_rules, trope_library
```

---

## AI & Revision

### AIJob
```
id, project_id, scene_id, chapter_id, job_type, mode,
selected_model, input_summary, output_summary,
token_usage, status, created_at
```

### Revision
```
id, scene_id, source_text, revised_text, objective,
intensity, created_by, created_at
```

### QAReport
```
id, project_id, chapter_id, scene_id, report_type,
severity, findings, suggestions, created_at
```
