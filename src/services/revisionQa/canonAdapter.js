import { validateGeneratedProseDiscipline } from '../canon/validation.js';
import { loadPreChapterTruth } from '../canon/core.js';
import { buildFindingAnchor, computeTextSignature } from './sourceSnapshot.js';

const CANON_RULES = new Set([
  'OUT_OF_SCENE_CHARACTER_DIALOGUE',
  'OUT_OF_SCENE_CHARACTER_ACTION',
  'DEAD_CHARACTER_ACTIVE',
  'LIVE_CANON_ACTION_CONSTRAINT',
  'LIVE_CANON_KNOWLEDGE_CONSTRAINT',
  'POSSIBLE_FABRICATED_BACKSTORY',
]);

function parseSceneCast(scene) {
  try {
    const ids = JSON.parse(scene?.characters_present || '[]');
    return [...new Set([scene?.pov_character_id, ...(Array.isArray(ids) ? ids : [])].filter(Boolean))];
  } catch {
    return [scene?.pov_character_id].filter(Boolean);
  }
}

export async function analyzeCanonForSources({ projectId, chapterId, sources, scenes, runId, configSignature }) {
  if (!projectId || !chapterId || !sources?.length) return [];
  const truth = await loadPreChapterTruth(projectId, chapterId);
  const sceneById = new Map((scenes || []).map((scene) => [scene.id, scene]));
  const findings = [];

  for (const source of sources) {
    const scene = sceneById.get(source.sceneId);
    const sourceText = String(source.sourceText ?? source.text ?? '');
    const sourceSignature = await computeTextSignature(sourceText);
    const reports = validateGeneratedProseDiscipline({
      projectId,
      chapterId: source.chapterId,
      sceneId: source.sceneId,
      sceneText: source.text,
      characters: truth.characters,
      entityStates: truth.entityStates,
      factStates: truth.factStates,
      sceneCast: parseSceneCast(scene),
    }).filter((report) => CANON_RULES.has(report.rule_code));

    reports.forEach((report, index) => {
      const evidence = String(report.evidence || '').trim();
      const localStart = evidence ? source.text.indexOf(evidence) : -1;
      if (localStart < 0) return;
      const from = (source.offsetBase || 0) + localStart;
      const to = from + evidence.length;
      findings.push({
        id: `canon:${runId}:${source.sceneId}:${report.rule_code}:${from}:${index}`,
        analysis_run_id: runId,
        engine: 'local',
        rule_id: report.rule_code,
        category: 'canon',
        severity: report.severity === 'error' ? 'high' : report.severity === 'warning' ? 'medium' : 'low',
        confidence: 0.65,
        confidence_basis: 'heuristic',
        project_id: projectId,
        chapter_id: source.chapterId,
        scene_id: source.sceneId,
        evidence,
        explanation: report.message,
        replacement: null,
        anchor: buildFindingAnchor(sourceText, from, to),
        source_signature: sourceSignature,
        config_signature: configSignature,
        status: 'open',
      });
    });
  }
  return findings;
}
