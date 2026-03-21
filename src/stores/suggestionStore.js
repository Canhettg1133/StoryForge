/**
 * StoryForge — Suggestion Store (Phase A: Suggestion Inbox)
 * 
 * Manages AI-generated suggestions for:
 *   - Character current_status updates
 *   - New Canon Facts
 * 
 * Suggestions go through: pending → accepted/rejected
 */

import { create } from 'zustand';
import db from '../services/db/database';

const useSuggestionStore = create((set, get) => ({
  // --- State ---
  suggestions: [],
  loading: false,

  // =============================================
  // LOAD suggestions for a project
  // =============================================
  loadSuggestions: async (projectId) => {
    if (!projectId) return;
    set({ loading: true });
    const suggestions = await db.suggestions
      .where('project_id').equals(projectId)
      .reverse()
      .sortBy('created_at');
    set({ suggestions, loading: false });
  },

  // =============================================
  // CREATE suggestions (batch from AI response)
  // =============================================
  createSuggestions: async (projectId, items) => {
    const now = Date.now();
    const records = items.map(item => ({
      project_id: projectId,
      type: item.type,               // 'character_status' | 'canon_fact'
      status: 'pending',
      source_chapter_id: item.source_chapter_id || null,
      target_id: item.target_id || null,       // character_id for status updates
      target_name: item.target_name || '',      // character name or fact subject
      current_value: item.current_value || '',  // old status
      suggested_value: item.suggested_value || '', // new status or fact description
      fact_type: item.fact_type || null,         // 'fact' | 'secret' | 'rule' (for canon facts)
      reasoning: item.reasoning || '',
      created_at: now,
    }));

    await db.suggestions.bulkAdd(records);
    await get().loadSuggestions(projectId);
  },

  // =============================================
  // ACCEPT a suggestion → apply the change
  // =============================================
  acceptSuggestion: async (id, projectId) => {
    const suggestion = await db.suggestions.get(id);
    if (!suggestion || suggestion.status !== 'pending') return;

    if (suggestion.type === 'character_status' && suggestion.target_id) {
      // Update character's current_status
      await db.characters.update(suggestion.target_id, {
        current_status: suggestion.suggested_value,
      });

      // Phase 4.5: Auto-record Timeline Event
      await db.entityTimeline.add({
        project_id: projectId,
        entity_id: suggestion.target_id,
        entity_type: 'character',
        chapter_id: suggestion.source_chapter_id,
        type: 'STATUS_CHANGE',
        description: suggestion.reasoning || `Trạng thái đổi từ "${suggestion.current_value}" thành "${suggestion.suggested_value}"`,
        oldValue: suggestion.current_value,
        newValue: suggestion.suggested_value,
        timestamp: Date.now(),
      });
    } else if (suggestion.type === 'canon_fact') {
      // Create new Canon Fact
      await db.canonFacts.add({
        project_id: projectId,
        description: suggestion.suggested_value,
        fact_type: suggestion.fact_type || 'fact',
        status: 'active',
        source_chapter_id: suggestion.source_chapter_id || null,
        created_at: Date.now(),
      });
    }

    // Mark as accepted
    await db.suggestions.update(id, { status: 'accepted' });
    await get().loadSuggestions(projectId);
  },

  // =============================================
  // REJECT a suggestion
  // =============================================
  rejectSuggestion: async (id, projectId) => {
    await db.suggestions.update(id, { status: 'rejected' });
    await get().loadSuggestions(projectId);
  },

  // =============================================
  // ACCEPT ALL pending suggestions
  // =============================================
  acceptAll: async (projectId) => {
    const pending = get().suggestions.filter(s => s.status === 'pending');
    for (const s of pending) {
      await get().acceptSuggestion(s.id, projectId);
    }
  },

  // =============================================
  // REJECT ALL pending suggestions
  // =============================================
  rejectAll: async (projectId) => {
    const pending = get().suggestions.filter(s => s.status === 'pending');
    for (const s of pending) {
      await db.suggestions.update(s.id, { status: 'rejected' });
    }
    await get().loadSuggestions(projectId);
  },

  // =============================================
  // DELETE old suggestions (cleanup)
  // =============================================
  clearResolved: async (projectId) => {
    await db.suggestions
      .where('project_id').equals(projectId)
      .filter(s => s.status !== 'pending')
      .delete();
    await get().loadSuggestions(projectId);
  },

  // =============================================
  // HELPERS
  // =============================================
  getPending: () => get().suggestions.filter(s => s.status === 'pending'),
  getAccepted: () => get().suggestions.filter(s => s.status === 'accepted'),
  getRejected: () => get().suggestions.filter(s => s.status === 'rejected'),
  getPendingCount: () => get().suggestions.filter(s => s.status === 'pending').length,
}));

export default useSuggestionStore;
