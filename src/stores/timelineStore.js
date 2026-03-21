/**
 * StoryForge — Timeline Store (Phase 4.5)
 * 
 * Zustand store for Entity Timeline (Changelog).
 * Tracks historical state changes for Characters, World Locations, Objects.
 */

import { create } from 'zustand';
import db from '../services/db/database';

const useTimelineStore = create((set, get) => ({
    // --- State ---
    timelineEvents: [],
    loading: false,

    // =============================================
    // LOAD ALL timeline events for a project
    // =============================================
    loadTimeline: async (projectId) => {
        if (!projectId) return;
        set({ loading: true });
        try {
            const events = await db.entityTimeline.where('project_id').equals(projectId).toArray();
            // Sort by timestamp descending
            events.sort((a, b) => b.timestamp - a.timestamp);
            set({ timelineEvents: events, loading: false });
        } catch (err) {
            console.error("Error loading timeline:", err);
            set({ loading: false });
        }
    },

    // =============================================
    // CREATE Timeline Event
    // =============================================
    /**
     * data: {
     *   project_id,
     *   entity_id,
     *   entity_type: 'character' | 'location' | 'object' | 'worldTerm',
     *   chapter_id,
     *   type: 'STATUS_CHANGE' | 'RELATION_CHANGE' | 'INFO_CHANGE' | 'APPEARANCE'
     *   description: string,
     *   oldValue: string (optional),
     *   newValue: string (optional),
     * }
     */
    createEvent: async (data) => {
        try {
            const id = await db.entityTimeline.add({
                project_id: data.project_id,
                entity_id: data.entity_id,
                entity_type: data.entity_type,
                chapter_id: data.chapter_id || null,
                type: data.type || 'INFO_CHANGE',
                description: data.description || '',
                oldValue: data.oldValue || null,
                newValue: data.newValue || null,
                timestamp: Date.now(),
            });
            await get().loadTimeline(data.project_id);
            return id;
        } catch (err) {
            console.error("Error creating timeline event:", err);
        }
    },

    // =============================================
    // DELETE Timeline Event
    // =============================================
    deleteEvent: async (id, projectId) => {
        try {
            await db.entityTimeline.delete(id);
            if (projectId) await get().loadTimeline(projectId);
        } catch (err) {
            console.error("Error deleting timeline event:", err);
        }
    },

    // =============================================
    // GETTERS
    // =============================================
    /**
     * Get historical events for a specific entity, sorted chronologically (oldest first)
     */
    getEventsForEntity: (entityId) => {
        const { timelineEvents } = get();
        return timelineEvents
            .filter(e => e.entity_id === entityId)
            .sort((a, b) => a.timestamp - b.timestamp); // Chronological order for UI stepper
    },

    /**
     * Get historical events that occurred within a specific chapter
     */
    getEventsForChapter: (chapterId) => {
        const { timelineEvents } = get();
        return timelineEvents
            .filter(e => e.chapter_id === chapterId);
    }
}));

export default useTimelineStore;
