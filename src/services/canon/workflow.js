import db from '../db/database';
import aiService from '../ai/client';
import { buildPrompt } from '../ai/promptBuilder';
import { TASK_TYPES } from '../ai/router';
import { parseAIJsonValue } from '../../utils/aiJson';
import {
  CANON_OP_TYPES,
  CANON_SEVERITY,
  CHAPTER_COMMIT_STATUS,
  CHAPTER_REVISION_STATUS,
} from './constants';
import {
  createReport,
  getChapterAndProject,
  getChapterScenes,
  getOrCreateChapterCommit,
  loadPreChapterTruth,
  loadRevisionOps,
  replaceValidatorReports,
  updateChapterCommitSummary,
} from './core';
import { dedupeCandidateOps, mapAiOpsToCandidateOps } from './opMapping';
import { invalidateFromChapter, rebuildCanonFromChapter } from './projection';
import {
  filterCommitReadyOps,
  reportsHaveErrors,
  validateCandidateOps,
  validateDraftTextAgainstTruth,
} from './validation';
import { resolveCanonFactRegistration } from '../entityIdentity/factIdentity.js';
import { cleanText } from './utils';

function normalizeAiOpsResponse(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.ops)) return parsed.ops;
  return [];
}

function chapterTextFromScenes(scenes) {
  return (scenes || [])
    .map((scene) => cleanText(scene.draft_text || scene.final_text || ''))
    .filter(Boolean)
    .join('\n\n');
}

function sendAiTask(taskType, messages, options = {}) {
  return new Promise((resolve, reject) => {
    aiService.send({
      taskType,
      messages,
      stream: false,
      routeOptions: options.routeOptions,
      nsfwMode: options.nsfwMode,
      superNsfwMode: options.superNsfwMode,
      onComplete: (text) => resolve(text),
      onError: reject,
    });
  });
}

function buildCanonExtractError(error, rawText = '') {
  const baseMessage = cleanText(error?.message || 'Canon extract failed');
  const rawSnippet = cleanText(rawText).slice(0, 240);
  if (rawSnippet) {
    return new Error(`${baseMessage} | Raw: ${rawSnippet}`);
  }
  return new Error(baseMessage);
}

export async function createChapterRevision({
  projectId,
  chapterId,
  chapterText,
  status = CHAPTER_REVISION_STATUS.DRAFT,
  metadata = {},
}) {
  const existing = await db.chapter_revisions
    .where('[project_id+chapter_id]')
    .equals([projectId, chapterId])
    .toArray();
  const revisionNumber = existing.reduce((maxValue, item) => Math.max(maxValue, item.revision_number || 0), 0) + 1;
  const now = Date.now();
  const revisionId = await db.chapter_revisions.add({
    project_id: projectId,
    chapter_id: chapterId,
    revision_number: revisionNumber,
    status,
    chapter_text: chapterText,
    candidate_ops: '[]',
    validator_summary: null,
    ...metadata,
    created_at: now,
    updated_at: now,
  });
  return db.chapter_revisions.get(revisionId);
}

export async function extractCandidateOps({
  projectId,
  chapterId,
  revisionId = null,
  chapterText = '',
  scenes = [],
  routeOptions = null,
}) {
  const { project } = await getChapterAndProject(projectId, chapterId);
  const [characters, locations, plotThreads, canonFacts, objects, relationships] = await Promise.all([
    db.characters.where('project_id').equals(projectId).toArray(),
    db.locations.where('project_id').equals(projectId).toArray(),
    db.plotThreads.where('project_id').equals(projectId).toArray(),
    db.canonFacts.where('project_id').equals(projectId).toArray(),
    db.objects.where('project_id').equals(projectId).toArray(),
    db.relationships.where('project_id').equals(projectId).toArray(),
  ]);

  let promptTemplates = {};
  if (project?.prompt_templates) {
    try {
      promptTemplates = JSON.parse(project.prompt_templates);
    } catch {
      promptTemplates = {};
    }
  }

  const messages = buildPrompt(TASK_TYPES.CANON_EXTRACT_OPS, {
    projectId,
    chapterId,
    sceneText: chapterText,
    sceneList: scenes.map((scene, index) => ({
      index: index + 1,
      title: scene.title || `Canh ${index + 1}`,
      text: cleanText(scene.draft_text || scene.final_text || ''),
    })),
    characters,
    locations,
    plotThreads,
    canonFacts,
    objects,
    relationships,
    genre: project?.genre_primary || '',
    projectTitle: project?.title || '',
    promptTemplates,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });

  const rawText = await sendAiTask(TASK_TYPES.CANON_EXTRACT_OPS, messages, {
    routeOptions: routeOptions || undefined,
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  if (!cleanText(rawText)) {
    throw buildCanonExtractError(new Error('AI canon extract returned empty response'), rawText);
  }

  let parsed;
  try {
    parsed = parseAIJsonValue(rawText);
  } catch (error) {
    throw buildCanonExtractError(error, rawText);
  }

  const candidateOps = mapAiOpsToCandidateOps(normalizeAiOpsResponse(parsed), {
    chapterId,
    scenes,
    characters,
    locations,
    plotThreads,
    canonFacts,
    objects,
  });

  if (revisionId) {
    await db.chapter_revisions.update(revisionId, {
      candidate_ops: JSON.stringify(candidateOps),
      updated_at: Date.now(),
    });
  }

  return candidateOps;
}

export async function validateRevision(chapterRevisionId, mode = 'draft', options = {}) {
  const revision = await db.chapter_revisions.get(chapterRevisionId);
  if (!revision) {
    throw new Error('Khong tim thay chapter revision de validate.');
  }

  const scenes = await getChapterScenes(revision.chapter_id);
  const preTruth = await loadPreChapterTruth(revision.project_id, revision.chapter_id);
  let candidateOps = loadRevisionOps(revision);
  const extractionFallbackReports = [];
  const commitReadinessReports = [];
  const shouldFailClosed = mode === 'canonicalize';
  let extractionAttempted = false;

  if (!options.skipExtraction && candidateOps.length === 0 && cleanText(revision.chapter_text)) {
    extractionAttempted = true;
    try {
      candidateOps = await extractCandidateOps({
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        chapterText: revision.chapter_text,
        scenes,
        routeOptions: options.routeOptions || null,
      });
    } catch (error) {
      console.warn('[Canon] extractCandidateOps failed, falling back to heuristic-only validation:', error);
      candidateOps = [];
      extractionFallbackReports.push(createReport({
        severity: CANON_SEVERITY.INFO,
        ruleCode: 'CANON_EXTRACT_FALLBACK',
        message: 'AI khong trich xuat duoc canon ops, he thong da tiep tuc kiem tra heuristic va khong xem day la loi chan chuong.',
        projectId: revision.project_id,
        chapterId: revision.chapter_id,
        revisionId: revision.id,
        evidence: error?.message || '',
      }));
    }
  }

  if (shouldFailClosed) {
    const filtered = filterCommitReadyOps(candidateOps, {
      projectId: revision.project_id,
      chapterId: revision.chapter_id,
      revisionId: revision.id,
      requireConfidence: extractionAttempted,
    });
    candidateOps = filtered.ops;
    commitReadinessReports.push(...filtered.reports);
  }

  const schemaReports = validateCandidateOps({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    candidateOps,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    itemStates: preTruth.itemStates,
    relationshipStates: preTruth.relationshipStates,
  });

  const heuristicReports = validateDraftTextAgainstTruth({
    projectId: revision.project_id,
    chapterId: revision.chapter_id,
    revisionId: revision.id,
    sceneText: revision.chapter_text,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
  });

  const reports = [...schemaReports, ...heuristicReports, ...commitReadinessReports, ...extractionFallbackReports];
  await replaceValidatorReports(revision.project_id, revision.id, reports);

  const hasErrors = reportsHaveErrors(reports);
  const status = hasErrors
    ? CHAPTER_REVISION_STATUS.BLOCKED
    : (mode === 'canonicalize' ? CHAPTER_REVISION_STATUS.VALIDATED : CHAPTER_REVISION_STATUS.DRAFT);

  await db.chapter_revisions.update(revision.id, {
    status,
    candidate_ops: JSON.stringify(candidateOps),
    validator_summary: JSON.stringify({
      warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
      error_count: reports.filter((report) => report.severity === CANON_SEVERITY.ERROR).length,
    }),
    updated_at: Date.now(),
  });

  await updateChapterCommitSummary(
    revision.project_id,
    revision.chapter_id,
    hasErrors ? CHAPTER_COMMIT_STATUS.BLOCKED
      : (reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.DRAFT),
    reports,
    revision.id
  );

  return {
    revision: await db.chapter_revisions.get(revision.id),
    candidateOps,
    reports,
    hasErrors,
  };
}

function buildStoryEventsFromOps(projectId, revisionId, candidateOps) {
  return candidateOps.map((op) => ({
    project_id: projectId,
    chapter_id: op.chapter_id,
    revision_id: revisionId,
    scene_id: op.scene_id,
    op_type: op.op_type,
    subject_id: op.subject_id,
    target_id: op.target_id,
    thread_id: op.thread_id,
    location_id: op.location_id,
    fact_id: op.fact_id,
    object_id: op.object_id || null,
    status: 'committed',
    subject_name: op.subject_name,
    target_name: op.target_name,
    thread_title: op.thread_title,
    location_name: op.location_name,
    fact_description: op.fact_description,
    object_name: op.object_name,
    summary: op.summary,
    payload: op.payload,
    confidence: op.confidence,
    created_at: Date.now(),
  }));
}

function buildEvidenceFromOps(projectId, revisionId, candidateOps) {
  return candidateOps.map((op, index) => ({
    project_id: projectId,
    chapter_id: op.chapter_id,
    revision_id: revisionId,
    scene_id: op.scene_id,
    target_type: 'candidate_op',
    target_id: `${revisionId}:${index}:${op.op_type}`,
    source_type: 'chapter_text',
    evidence_text: op.evidence,
    summary: op.summary,
    created_at: Date.now(),
  }));
}

function resolveFactRegistrations(candidateOps, factStates) {
  return candidateOps.map((op) => {
    if (op.op_type !== CANON_OP_TYPES.FACT_REGISTERED) {
      return op;
    }
    const resolved = resolveCanonFactRegistration({
      fact_description: op.fact_description || op.payload?.description || op.summary || '',
      fact_type: op.payload?.fact_type || 'fact',
      subject_type: op.payload?.subject_type || '',
      subject_id: op.subject_id ?? op.payload?.subject_id ?? null,
      subject_name: op.subject_name || op.payload?.subject_name || '',
      subject_scope: op.payload?.subject_scope || '',
    }, factStates);
    return {
      ...op,
      fact_id: op.fact_id || resolved.existingFact?.id || null,
      fact_description: op.fact_description || op.payload?.description || op.summary || '',
      payload: {
        ...(op.payload || {}),
        normalized_description: resolved.normalized_description,
        subject_scope: resolved.subject_scope,
        fact_fingerprint: resolved.fact_fingerprint,
      },
    };
  });
}

export async function canonicalizeChapter(projectId, chapterId, options = {}) {
  const scenes = await getChapterScenes(chapterId);
  const chapterText = chapterTextFromScenes(scenes);
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const validation = await validateRevision(revision.id, 'canonicalize', {
    routeOptions: options.routeOptions || null,
  });
  if (validation.hasErrors) {
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, validation.reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports: validation.reports,
    };
  }

  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const candidateOps = resolveFactRegistrations(validation.candidateOps, preTruth.factStates);
  const storyEvents = buildStoryEventsFromOps(projectId, revision.id, candidateOps);
  const memoryEvidence = buildEvidenceFromOps(projectId, revision.id, candidateOps);

  if (commit.canonical_revision_id) {
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.SUPERSEDED,
      updated_at: Date.now(),
    });
    const previousEvents = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();
    await Promise.all(previousEvents.map((event) => db.story_events.update(event.id, { status: 'superseded' })));
  }

  const invalidatedChapterIds = await invalidateFromChapter(projectId, chapterId);

  await db.transaction('rw',
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    async () => {
      await db.chapter_revisions.update(revision.id, {
        status: CHAPTER_REVISION_STATUS.CANONICAL,
        candidate_ops: JSON.stringify(candidateOps),
        updated_at: Date.now(),
      });

      if (storyEvents.length > 0) {
        await db.story_events.bulkAdd(storyEvents);
      }
      if (memoryEvidence.length > 0) {
        await db.memory_evidence.bulkAdd(memoryEvidence);
      }

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: validation.reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: validation.reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  await rebuildCanonFromChapter(projectId, chapterId);
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports: validation.reports,
    invalidatedChapterIds,
  };
}

export async function canonicalizeCandidateOps({
  projectId,
  chapterId,
  candidateOps = [],
  chapterText = '',
  sourceType = 'manual_review',
}) {
  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const currentCanonicalRevision = commit.canonical_revision_id
    ? await db.chapter_revisions.get(commit.canonical_revision_id)
    : null;
  const baseOps = loadRevisionOps(currentCanonicalRevision);
  const mergedOps = dedupeCandidateOps([...baseOps, ...candidateOps]);
  const fallbackText = chapterText || chapterTextFromScenes(await getChapterScenes(chapterId));
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: fallbackText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });

  const filtered = filterCommitReadyOps(mergedOps, {
    projectId,
    chapterId,
    revisionId: revision.id,
    requireConfidence: false,
  });
  const commitReadyOps = filtered.ops;
  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const resolvedCommitReadyOps = resolveFactRegistrations(commitReadyOps, preTruth.factStates);
  const reports = [
    ...validateCandidateOps({
      projectId,
      chapterId,
      revisionId: revision.id,
      candidateOps: resolvedCommitReadyOps,
      entityStates: preTruth.entityStates,
      threadStates: preTruth.threadStates,
      factStates: preTruth.factStates,
      itemStates: preTruth.itemStates,
      relationshipStates: preTruth.relationshipStates,
    }),
    ...filtered.reports,
  ];
  if (mergedOps.length > 0 && commitReadyOps.length === 0) {
    reports.push(createReport({
      severity: CANON_SEVERITY.ERROR,
      ruleCode: 'NO_COMMITTABLE_CANON_OPS',
      message: 'Tat ca canon ops de xuat deu bi loai, khong co op hop le de commit.',
      projectId,
      chapterId,
      revisionId: revision.id,
      evidence: cleanText(fallbackText).slice(0, 240),
    }));
  }

  await replaceValidatorReports(projectId, revision.id, reports);

  if (reportsHaveErrors(reports)) {
    await db.chapter_revisions.update(revision.id, {
      status: CHAPTER_REVISION_STATUS.BLOCKED,
      candidate_ops: JSON.stringify(resolvedCommitReadyOps),
      updated_at: Date.now(),
    });
    await updateChapterCommitSummary(projectId, chapterId, CHAPTER_COMMIT_STATUS.BLOCKED, reports, revision.id);
    return {
      ok: false,
      revisionId: revision.id,
      reports,
    };
  }

  const storyEvents = buildStoryEventsFromOps(projectId, revision.id, resolvedCommitReadyOps);
  const memoryEvidence = buildEvidenceFromOps(projectId, revision.id, resolvedCommitReadyOps).map((item) => ({
    ...item,
    source_type: sourceType,
  }));

  if (commit.canonical_revision_id) {
    await db.chapter_revisions.update(commit.canonical_revision_id, {
      status: CHAPTER_REVISION_STATUS.SUPERSEDED,
      updated_at: Date.now(),
    });
    const previousEvents = await db.story_events
      .where('[project_id+revision_id]')
      .equals([projectId, commit.canonical_revision_id])
      .toArray();
    await Promise.all(previousEvents.map((event) => db.story_events.update(event.id, { status: 'superseded' })));
  }

  const invalidatedChapterIds = await invalidateFromChapter(projectId, chapterId);

  await db.transaction('rw',
    db.chapter_revisions,
    db.chapter_commits,
    db.story_events,
    db.memory_evidence,
    async () => {
      await db.chapter_revisions.update(revision.id, {
        status: CHAPTER_REVISION_STATUS.CANONICAL,
        candidate_ops: JSON.stringify(resolvedCommitReadyOps),
        updated_at: Date.now(),
      });

      if (storyEvents.length > 0) {
        await db.story_events.bulkAdd(storyEvents);
      }
      if (memoryEvidence.length > 0) {
        await db.memory_evidence.bulkAdd(memoryEvidence);
      }

      await db.chapter_commits.update(commit.id, {
        current_revision_id: revision.id,
        canonical_revision_id: revision.id,
        status: reports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : CHAPTER_COMMIT_STATUS.CANONICAL,
        warning_count: reports.filter((report) => report.severity === CANON_SEVERITY.WARNING).length,
        error_count: 0,
        updated_at: Date.now(),
      });
    });

  await rebuildCanonFromChapter(projectId, chapterId);
  await db.chapter_commits.update(commit.id, {
    status: CHAPTER_COMMIT_STATUS.CANONICAL,
    updated_at: Date.now(),
  });

  return {
    ok: true,
    revisionId: revision.id,
    reports,
    invalidatedChapterIds,
  };
}

export async function validateSceneDraft({
  projectId,
  chapterId,
  sceneId = null,
  sceneText = '',
}) {
  const preTruth = await loadPreChapterTruth(projectId, chapterId);
  const reports = validateDraftTextAgainstTruth({
    projectId,
    chapterId,
    sceneText,
    entityStates: preTruth.entityStates,
    threadStates: preTruth.threadStates,
    factStates: preTruth.factStates,
    characters: preTruth.characters,
    objects: preTruth.objects,
    itemStates: preTruth.itemStates,
  });

  const commit = await getOrCreateChapterCommit(projectId, chapterId);
  const revision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: sceneText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
  });
  const scopedReports = reports.map((report) => ({ ...report, scene_id: sceneId || report.scene_id }));
  await replaceValidatorReports(projectId, revision.id, scopedReports);
  await updateChapterCommitSummary(
    projectId,
    chapterId,
    scopedReports.length > 0 ? CHAPTER_COMMIT_STATUS.HAS_WARNINGS : commit.status,
    scopedReports,
    revision.id
  );

  return {
    revisionId: revision.id,
    reports: scopedReports,
  };
}

export async function repairChapterRevision({ projectId, chapterId, revisionId, reportId = null }) {
  const revision = await db.chapter_revisions.get(revisionId);
  if (!revision) {
    throw new Error('Khong tim thay revision can repair.');
  }
  const reports = await db.validator_reports
    .where('[project_id+revision_id]')
    .equals([projectId, revisionId])
    .toArray();
  const scopedReports = reportId
    ? reports.filter((report) => String(report.id) === String(reportId))
    : reports;
  if (reportId && scopedReports.length === 0) {
    throw new Error('Khong tim thay report can sua.');
  }
  const { project, chapter } = await getChapterAndProject(projectId, chapterId);
  const messages = buildPrompt(TASK_TYPES.CANON_REPAIR, {
    projectId,
    chapterTitle: chapter?.title || '',
    projectTitle: project?.title || '',
    sceneText: revision.chapter_text || '',
    validatorReports: scopedReports,
    genre: project?.genre_primary || '',
  });
  const text = await sendAiTask(TASK_TYPES.CANON_REPAIR, messages, {
    nsfwMode: !!project?.nsfw_mode,
    superNsfwMode: !!project?.super_nsfw_mode,
  });
  return {
    text,
    report: scopedReports[0] || null,
    reports: scopedReports,
    revision,
  };
}

export async function saveRepairDraftRevision({
  projectId,
  chapterId,
  revisionId,
  reportId = null,
  chapterText,
}) {
  const trimmedText = String(chapterText || '').trim();
  if (!trimmedText) {
    throw new Error('Khong co noi dung de luu thanh draft.');
  }

  const draftRevision = await createChapterRevision({
    projectId,
    chapterId,
    chapterText: trimmedText,
    status: CHAPTER_REVISION_STATUS.DRAFT,
    metadata: {
      source_revision_id: revisionId || null,
      source_report_id: reportId || null,
      repair_source: 'validator_report',
    },
  });

  const validation = await validateRevision(draftRevision.id, 'draft', {
    skipExtraction: true,
  });

  return {
    ...draftRevision,
    validation,
  };
}
