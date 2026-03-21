import { create } from 'zustand';
import db from '../services/db/database';

const usePlotStore = create((set, get) => ({
    // --- State ---
    plotThreads: [],
    threadBeats: [],
    loading: false,

    // --- Actions: Plot Threads ---
    loadPlotThreads: async (projectId) => {
        set({ loading: true });
        try {
            const threads = await db.plotThreads.where('project_id').equals(projectId).toArray();
            set({ plotThreads: threads, loading: false });
        } catch (err) {
            console.error("Error loading plot threads:", err);
            set({ loading: false });
        }
    },

    createPlotThread: async (data) => {
        try {
            const id = await db.plotThreads.add({
                project_id: data.project_id,
                title: data.title || 'Tuyến truyện mới',
                type: data.type || 'main', // main, subplot, character_arc, mystery, romance
                state: data.state || 'active', // active, resolved, dropped
                description: data.description || '', // New dynamic field
                resolution: data.resolution || '',   // New dynamic field
            });
            await get().loadPlotThreads(data.project_id);
            return id;
        } catch (err) {
            console.error("Error creating plot thread:", err);
        }
    },

    updatePlotThread: async (id, data) => {
        try {
            await db.plotThreads.update(id, data);

            // Update local state without waiting for global reload if possible, but load is safer
            set(state => ({
                plotThreads: state.plotThreads.map(p => p.id === id ? { ...p, ...data } : p)
            }));
        } catch (err) {
            console.error("Error updating plot thread:", err);
        }
    },

    deletePlotThread: async (id, projectId) => {
        try {
            // Also delete associated beats
            const beats = await db.threadBeats.where('plot_thread_id').equals(id).toArray();
            const beatIds = beats.map(b => b.id);
            if (beatIds.length > 0) {
                await db.threadBeats.bulkDelete(beatIds);
            }

            await db.plotThreads.delete(id);
            await get().loadPlotThreads(projectId);
            await get().loadThreadBeatsForProject(projectId); // Reload to clear detached beats
        } catch (err) {
            console.error("Error deleting plot thread:", err);
        }
    },

    // --- Actions: Thread Beats (Scene associations) ---
    loadThreadBeatsForProject: async (projectId) => {
        // We only have index on plot_thread_id, but it's simpler to fetch all scenes or all threads, then get beats
        // For performance on a small DB, we can just load all beats that belong to our loaded threads.
        try {
            const threads = await db.plotThreads.where('project_id').equals(projectId).toArray();
            const threadIds = threads.map(t => t.id);

            if (threadIds.length > 0) {
                // anyOf is available in Dexie to query multiple keys
                const beats = await db.threadBeats.where('plot_thread_id').anyOf(threadIds).toArray();
                set({ threadBeats: beats });
            } else {
                set({ threadBeats: [] });
            }
        } catch (err) {
            console.error("Error loading thread beats:", err);
        }
    },

    createThreadBeat: async (data) => {
        try {
            const id = await db.threadBeats.add({
                plot_thread_id: data.plot_thread_id,
                scene_id: data.scene_id,
                beat_type: data.beat_type || 'develop', // introduce, develop, climax, resolve
                notes: data.notes || '', // optional detail
            });
            // Update local state
            const beat = await db.threadBeats.get(id);
            set(state => ({
                threadBeats: [...state.threadBeats, beat]
            }));
            return id;
        } catch (err) {
            console.error("Error creating thread beat:", err);
        }
    },

    updateThreadBeat: async (id, data) => {
        try {
            await db.threadBeats.update(id, data);
            set(state => ({
                threadBeats: state.threadBeats.map(b => b.id === id ? { ...b, ...data } : b)
            }));
        } catch (err) {
            console.error("Error updating thread beat:", err);
        }
    },

    deleteThreadBeat: async (id) => {
        try {
            await db.threadBeats.delete(id);
            set(state => ({
                threadBeats: state.threadBeats.filter(b => b.id !== id)
            }));
        } catch (err) {
            console.error("Error deleting thread beat:", err);
        }
    },

}));

export default usePlotStore;
