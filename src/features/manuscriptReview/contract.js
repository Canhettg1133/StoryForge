import { getProjectStyleRuntimeState } from '../../services/ai/projectStyleRuntime.js';
import { REVIEW_VERSION } from './constants.js';

function parseTemplates(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

function lines(value) {
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) value = parsed; } catch { /* Plain author text remains text. */ }
  }
  return (Array.isArray(value) ? value : String(value || '').split(/\r?\n/u))
    .filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

export function buildReviewContract({ project = {}, scene = {}, chapter = {}, authorRequest = '' } = {}) {
  const templates = parseTemplates(project.prompt_templates);
  const requirements = [];
  const add = (source, value) => lines(value).forEach((text, index) => requirements.push({ id: `${source}:${index + 1}`, source, text }));
  add('author_request', authorRequest);
  add('ai_guidelines', project.ai_guidelines);
  add('style_dna', templates.style_dna);
  add('constitution', templates.constitution);
  add('pov', project.pov_mode);
  add('scene_must_happen', scene.must_happen);
  add('scene_must_not_happen', scene.must_not_happen);
  add('scene_goal', scene.goal);
  add('scene_pacing', ({ slow: 'Chậm, mô tả', medium: 'Nhịp cân bằng', fast: 'Nhanh, đầy hành động' })[scene.pacing] || scene.pacing);
  add('scene_emotional_start', scene.emotional_start && `Tâm trạng đầu cảnh: ${scene.emotional_start}`);
  add('scene_emotional_end', scene.emotional_end && `Tâm trạng cuối cảnh: ${scene.emotional_end}`);
  const blacklist = lines(templates.anti_ai_blacklist);
  if (blacklist.length) requirements.push({ id: 'anti_ai_blacklist:1', source: 'anti_ai_blacklist', text: 'Tránh các cụm từ trong danh sách dự án.', phrases: blacklist });
  const runtime = getProjectStyleRuntimeState({
    taskType: 'qa_check', aiGuidelines: project.ai_guidelines || '', promptTemplates: templates,
    genre: project.genre_primary || '', writingStyle: project.writing_style || '',
    projectStyleRuntimeBlock: project.project_style_runtime_block || '',
    projectStyleRuntimeEnabled: project.project_style_runtime_enabled,
    projectStyleRuntimeMeta: project.project_style_runtime_meta,
  });
  return {
    rubric_version: REVIEW_VERSION,
    requirements,
    evaluator_notes: typeof templates.qa_check === 'string' ? templates.qa_check : '',
    runtime_support: runtime.active ? runtime.block : '',
    runtime_stale: runtime.stale,
    context: { genre: project.genre_primary || '', tone: project.tone || '', scene, chapter },
  };
}
