import { create } from 'zustand';
import db from '../services/db/database';
import { CANON_OP_TYPES } from '../services/canon/constants';
import { canonicalizeCandidateOps } from '../services/canon/workflow';
import { applyEntityResolutionSuggestion } from '../services/entityIdentity/index.js';
import { runExistingDuplicateAudit } from '../services/codex/duplicateAuditService.js';
import { mergeStoryBibleEntities } from '../services/codex/storyBibleMergeService.js';

function cleanText(value) {
  return String(value || '').trim();
}

export function buildSuggestionCandidateOp(suggestion) {
  if (!suggestion) return null;

  if (suggestion.candidate_op) {
    try {
      const parsed = typeof suggestion.candidate_op === 'string'
        ? JSON.parse(suggestion.candidate_op)
        : suggestion.candidate_op;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }

  if (suggestion.type === 'character_status') {
    return {
      op_type: CANON_OP_TYPES.CHARACTER_STATUS_CHANGED,
      chapter_id: suggestion.source_chapter_id || null,
      scene_id: suggestion.source_scene_id || null,
      subject_id: suggestion.target_id || null,
      subject_name: cleanText(suggestion.target_name),
      summary: cleanText(suggestion.suggested_value),
      evidence: cleanText(suggestion.reasoning || suggestion.suggested_value),
      confidence: 0.6,
      payload: {
        status_summary: cleanText(suggestion.suggested_value),
      },
    };
  }

  if (suggestion.type === 'canon_fact') {
    return {
      op_type: CANON_OP_TYPES.FACT_REGISTERED,
      chapter_id: suggestion.source_chapter_id || null,
      scene_id: suggestion.source_scene_id || null,
      fact_description: cleanText(suggestion.suggested_value),
      summary: cleanText(suggestion.suggested_value),
      evidence: cleanText(suggestion.reasoning || suggestion.suggested_value),
      confidence: 0.6,
      payload: {
        description: cleanText(suggestion.suggested_value),
        fact_type: cleanText(suggestion.fact_type || 'fact') || 'fact',
      },
    };
  }

  if (suggestion.type === 'entity_resolution') {
    return null;
  }

  return null;
}

export function isQuickApproveSafeEntitySuggestion(suggestion) {
  if (suggestion?.type !== 'entity_resolution' || suggestion?.status !== 'pending') return false;
  let payload;
  try {
    payload = typeof suggestion.candidate_op === 'string'
      ? JSON.parse(suggestion.candidate_op)
      : suggestion.candidate_op;
  } catch {
    return false;
  }
  return suggestion.quick_approve === true
    && payload?.quick_approve === true
    && payload?.review_safety === 'quick_approve'
    && payload?.critic?.decision === 'agree'
    && Array.isArray(payload?.risk_flags)
    && payload.risk_flags.length === 0
    && Array.isArray(payload?.protected_field_changes)
    && payload.protected_field_changes.length === 0;
}

async function commitSuggestionBatch(projectId, suggestions) {
  const sourceChapterId = suggestions[0]?.source_chapter_id;
  const candidateOps = suggestions
    .map(buildSuggestionCandidateOp)
    .filter(Boolean)
    .map((op) => ({
      ...op,
      chapter_id: op.chapter_id || sourceChapterId || null,
    }));

  if (!sourceChapterId || candidateOps.length === 0) {
      throw new Error('Đề xuất này chưa có thao tác canon hợp lệ để áp dụng.');
  }

  const result = await canonicalizeCandidateOps({
    projectId,
    chapterId: sourceChapterId,
    candidateOps,
    sourceType: 'suggestion_inbox',
  });

  if (!result.ok) {
    const firstError = (result.reports || []).find((report) => report.severity === 'error');
      throw new Error(firstError?.message || 'Bộ kiểm tra đã chặn đề xuất này trước khi canon hóa.');
  }

  return result;
}

async function completeSuggestionJobIfResolved(suggestion) {
  if (!suggestion?.job_id || !db.aiJobs) return;
  const pendingForJob = await db.suggestions.where('project_id').equals(suggestion.project_id)
    .filter((item) => item.job_id === suggestion.job_id && item.status === 'pending')
    .toArray();
  if (pendingForJob.length === 0) {
    await db.aiJobs.update(suggestion.job_id, { status: 'completed', updated_at: Date.now() });
  }
}

async function approveSafeEntitySuggestions(suggestions) {
  let acceptedCount = 0;
  for (const suggestion of suggestions.filter(isQuickApproveSafeEntitySuggestion)) {
    try {
      const result = await applyEntityResolutionSuggestion({
        suggestionId: suggestion.id,
        resolutionAction: 'auto',
      });
      if (!result.suggestionUpdated) {
        await db.suggestions.update(suggestion.id, {
          status: 'accepted',
          applied_revision_id: null,
          applied_at: Date.now(),
          last_error: '',
        });
      }
      acceptedCount += 1;
    } catch (error) {
      await db.suggestions.update(suggestion.id, {
        last_error: String(error?.code || 'ENTITY_QUICK_APPROVE_FAILED').slice(0, 120),
      });
    }
  }
  return acceptedCount;
}

let latestSuggestionLoadRequest = 0;

const useSuggestionStore = create((set, get) => ({
  suggestions: [],
  loading: false,
  errorCode: '',
  duplicateAuditing: false,

  loadSuggestions: async (projectId) => {
    if (!projectId) return [];
    const requestId = ++latestSuggestionLoadRequest;
    set({ loading: true, errorCode: '' });
    try {
      const suggestions = await db.suggestions
        .where('project_id').equals(projectId)
        .reverse()
        .sortBy('created_at');
      if (requestId === latestSuggestionLoadRequest) {
        set({ suggestions, loading: false, errorCode: '' });
      }
      return suggestions;
    } catch {
      if (requestId === latestSuggestionLoadRequest) {
        set({
          suggestions: [],
          loading: false,
          errorCode: 'SUGGESTION_STORE_UNAVAILABLE',
        });
      }
      return [];
    }
  },

  createSuggestions: async (projectId, items) => {
    const now = Date.now();
    const records = items.map((item) => ({
      project_id: projectId,
      type: item.type,
      status: 'pending',
      source_chapter_id: item.source_chapter_id || null,
      source_scene_id: item.source_scene_id || null,
      target_id: item.target_id || null,
      target_name: item.target_name || '',
      current_value: item.current_value || '',
      suggested_value: item.suggested_value || '',
      fact_type: item.fact_type || null,
      reasoning: item.reasoning || '',
      candidate_op: item.candidate_op ? JSON.stringify(item.candidate_op) : null,
      created_at: now,
    }));

    await db.suggestions.bulkAdd(records);
    await get().loadSuggestions(projectId);
  },

  acceptSuggestion: async (id, projectId, options = {}) => {
    const suggestion = await db.suggestions.get(id);
    if (!suggestion || suggestion.status !== 'pending') return null;

    let result;
    if (suggestion.type === 'entity_resolution') {
      result = await applyEntityResolutionSuggestion({
        suggestionId: id,
        resolutionAction: options.resolutionAction || 'auto',
        targetEntityId: options.targetEntityId || null,
        confirmedRole: options.confirmedRole || null,
      });
    } else if (suggestion.type === 'entity_duplicate_review') {
      const payload = buildSuggestionCandidateOp(suggestion) || {};
      result = await mergeStoryBibleEntities({
        projectId,
        entityKind: payload.entity_kind,
        survivorId: options.survivorId,
        duplicateId: options.duplicateId,
        suggestionId: id,
        confirmed: options.confirmed === true,
      });
    } else {
      result = await commitSuggestionBatch(projectId, [suggestion]);
    }

    if (!result.suggestionUpdated) {
      await db.suggestions.update(id, {
        status: 'accepted',
        applied_revision_id: result.revisionId || null,
        applied_at: Date.now(),
        last_error: '',
      });
    }
    await completeSuggestionJobIfResolved(suggestion);
    await get().loadSuggestions(projectId);
    return result;
  },

  rejectSuggestion: async (id, projectId) => {
    const suggestion = await db.suggestions.get(id);
    if (suggestion?.type === 'entity_resolution' && suggestion.candidate_op) {
      try {
        const payload = JSON.parse(suggestion.candidate_op);
        const candidateIds = Array.isArray(payload.candidate_ids) ? payload.candidate_ids : [];
        const candidates = await db.entity_resolution_candidates.where('id').anyOf(candidateIds).toArray();
        await Promise.all(candidates.map((candidate) => (
          db.entity_resolution_candidates.update(candidate.id, {
            resolution_status: 'rejected',
            updated_at: Date.now(),
          })
        )));
      } catch {}
    }
    await db.suggestions.update(id, { status: 'rejected', last_error: '' });
    await completeSuggestionJobIfResolved(suggestion);
    await get().loadSuggestions(projectId);
  },

  acceptAll: async (projectId) => {
    const pending = get().suggestions.filter((suggestion) => suggestion.status === 'pending');
    const acceptedEntityCount = await approveSafeEntitySuggestions(pending);

    const canonPending = pending.filter((suggestion) => (
      ['canon_op_review', 'character_status', 'canon_fact'].includes(suggestion.type)
    ));
    const grouped = canonPending.reduce((map, suggestion) => {
      const key = suggestion.source_chapter_id || `no-chapter:${suggestion.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(suggestion);
      return map;
    }, new Map());

    for (const suggestions of grouped.values()) {
      const result = await commitSuggestionBatch(projectId, suggestions);
      await Promise.all(suggestions.map((suggestion) => db.suggestions.update(suggestion.id, {
        status: 'accepted',
        applied_revision_id: result.revisionId || null,
        applied_at: Date.now(),
        last_error: '',
      })));
    }

    await get().loadSuggestions(projectId);
    return {
      acceptedCount: acceptedEntityCount + canonPending.length,
      heldCount: pending.length - acceptedEntityCount - canonPending.length,
    };
  },

  quickApproveSafe: async (projectId) => {
    const pending = get().suggestions.filter((suggestion) => suggestion.status === 'pending');
    const acceptedCount = await approveSafeEntitySuggestions(pending);
    await get().loadSuggestions(projectId);
    return {
      acceptedCount,
      heldCount: pending.length - acceptedCount,
    };
  },

  runDuplicateAudit: async (projectId) => {
    if (!projectId || get().duplicateAuditing) return null;
    set({ duplicateAuditing: true });
    try {
      const job = await runExistingDuplicateAudit({ projectId });
      await get().loadSuggestions(projectId);
      return job;
    } finally {
      set({ duplicateAuditing: false });
    }
  },

  rejectAll: async (projectId) => {
    const pending = get().suggestions.filter((suggestion) => suggestion.status === 'pending');
    for (const suggestion of pending) {
      await get().rejectSuggestion(suggestion.id, projectId);
    }
    await get().loadSuggestions(projectId);
  },

  clearResolved: async (projectId) => {
    await db.suggestions
      .where('project_id').equals(projectId)
      .filter((suggestion) => suggestion.status !== 'pending')
      .delete();
    await get().loadSuggestions(projectId);
  },

  getPending: () => get().suggestions.filter((suggestion) => suggestion.status === 'pending'),
  getAccepted: () => get().suggestions.filter((suggestion) => suggestion.status === 'accepted'),
  getRejected: () => get().suggestions.filter((suggestion) => suggestion.status === 'rejected'),
  getPendingCount: () => get().suggestions.filter((suggestion) => suggestion.status === 'pending').length,
}));

export default useSuggestionStore;
