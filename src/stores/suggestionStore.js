import { create } from 'zustand';
import db from '../services/db/database';
import { CANON_OP_TYPES } from '../services/canon/constants';
import { canonicalizeCandidateOps } from '../services/canon/engine';

function cleanText(value) {
  return String(value || '').trim();
}

function buildSuggestionCandidateOp(suggestion) {
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

  return null;
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
    throw new Error('De xuat nay chua co canon op hop le de ap dung.');
  }

  const result = await canonicalizeCandidateOps({
    projectId,
    chapterId: sourceChapterId,
    candidateOps,
    sourceType: 'suggestion_inbox',
  });

  if (!result.ok) {
    const firstError = (result.reports || []).find((report) => report.severity === 'error');
    throw new Error(firstError?.message || 'Validator chan de xuat nay truoc khi canon hoa.');
  }

  return result;
}

const useSuggestionStore = create((set, get) => ({
  suggestions: [],
  loading: false,

  loadSuggestions: async (projectId) => {
    if (!projectId) return;
    set({ loading: true });
    const suggestions = await db.suggestions
      .where('project_id').equals(projectId)
      .reverse()
      .sortBy('created_at');
    set({ suggestions, loading: false });
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

  acceptSuggestion: async (id, projectId) => {
    const suggestion = await db.suggestions.get(id);
    if (!suggestion || suggestion.status !== 'pending') return null;

    const result = await commitSuggestionBatch(projectId, [suggestion]);

    await db.suggestions.update(id, {
      status: 'accepted',
      applied_revision_id: result.revisionId || null,
      applied_at: Date.now(),
      last_error: '',
    });
    await get().loadSuggestions(projectId);
    return result;
  },

  rejectSuggestion: async (id, projectId) => {
    await db.suggestions.update(id, { status: 'rejected', last_error: '' });
    await get().loadSuggestions(projectId);
  },

  acceptAll: async (projectId) => {
    const pending = get().suggestions.filter((suggestion) => suggestion.status === 'pending');
    const grouped = pending.reduce((map, suggestion) => {
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
  },

  rejectAll: async (projectId) => {
    const pending = get().suggestions.filter((suggestion) => suggestion.status === 'pending');
    for (const suggestion of pending) {
      await db.suggestions.update(suggestion.id, { status: 'rejected', last_error: '' });
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
