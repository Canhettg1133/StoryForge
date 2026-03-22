/**
 * StoryForge — Arc Generation Store (Phase 5)
 * 
 * Manages the entire auto-generation workflow:
 * Setup → Generate Outline → Batch Draft → Feedback Loop
 */
import { create } from 'zustand';
import aiService from '../services/ai/client';
import { buildPrompt } from '../services/ai/promptBuilder';
import modelRouter, { TASK_TYPES } from '../services/ai/router';
import { gatherContext } from '../services/ai/contextEngine';
import db from '../services/db/database';
import useProjectStore from './projectStore';
import { parseAIJsonValue, isPlainObject } from '../utils/aiJson';

// Ensure router is injected (same pattern as aiStore.js)
aiService.setRouter(modelRouter);

function getNextOrderIndex(items) {
    return items.reduce((max, item) => {
        const order = Number.isFinite(item?.order_index) ? item.order_index : -1;
        return Math.max(max, order);
    }, -1) + 1;
}

function normalizeOutlineResult(parsed) {
    if (Array.isArray(parsed)) {
        return {
            arc_title: '',
            chapters: parsed.filter(isPlainObject),
        };
    }
    return isPlainObject(parsed) ? parsed : null;
}

const useArcGenStore = create((set, get) => ({
    // --- State ---
    // Bước 1: Thiết lập
    arcGoal: '',              // Mục tiêu của Arc (VD: "Main đi vào Bí cảnh X")
    arcChapterCount: 10,      // Số chương muốn tạo
    arcPacing: 'medium',      // slow | medium | fast
    arcMode: 'guided',        // guided (bán tự động) | auto (đột phá)

    // Bước 2: Dàn ý đã sinh
    generatedOutline: null,   // { arc_title, chapters: [{title, summary, key_events, pacing}] }
    outlineStatus: 'idle',    // idle | generating | ready | error

    // Bước 3: Đắp thịt
    draftStatus: 'idle',      // idle | drafting | done | error
    draftProgress: { current: 0, total: 0 },
    draftResults: [],         // [{chapterIndex, title, content, wordCount, status}]

    // --- Actions ---

    setArcConfig: (config) => set(config),

    resetArc: () => set({
        arcGoal: '', arcChapterCount: 10, arcPacing: 'medium', arcMode: 'guided',
        generatedOutline: null, outlineStatus: 'idle',
        draftStatus: 'idle', draftProgress: { current: 0, total: 0 }, draftResults: [],
    }),

    // ═══════════════════════════════════════════
    // BƯỚC 2: Sinh Dàn Ý (Outline)
    // ═══════════════════════════════════════════
    generateOutline: async ({ projectId, chapterId, chapterIndex, genre }) => {
        set({ outlineStatus: 'generating' });
        try {
            const { arcGoal, arcChapterCount, arcPacing, arcMode } = get();

            // Thu thập ngữ cảnh
            const ctx = await gatherContext({
                projectId, chapterId, chapterIndex, sceneId: null, sceneText: '', genre,
            });

            // Nếu mode "auto" (đột phá), tự động chọn Plot Thread + Canon Fact
            let finalGoal = arcGoal;
            if (arcMode === 'auto') {
                const plotThreads = await db.plotThreads.where('project_id').equals(projectId).toArray();
                const activeThreads = plotThreads.filter(pt => pt.state === 'active');
                const canonFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();
                const activeFacts = canonFacts.filter(f => f.status === 'active');

                // Weighted random: ưu tiên thread lâu chưa có beat
                let chosenThread = null;
                if (activeThreads.length > 0) {
                    const threadBeats = await db.threadBeats
                        .where('plot_thread_id').anyOf(activeThreads.map(t => t.id)).toArray();
                    const threadWeights = activeThreads.map(thread => {
                        const beats = threadBeats.filter(b => b.plot_thread_id === thread.id);
                        const lastBeatSceneId = beats.length > 0 ? Math.max(...beats.map(b => b.scene_id)) : 0;
                        return { thread, weight: Math.max(1, 100 - lastBeatSceneId) };
                    });

                    const totalWeight = threadWeights.reduce((sum, item) => sum + item.weight, 0);
                    let random = Math.random() * totalWeight;
                    for (const item of threadWeights) {
                        random -= item.weight;
                        if (random <= 0) { chosenThread = item.thread; break; }
                    }
                    if (!chosenThread) chosenThread = threadWeights[threadWeights.length - 1]?.thread;
                }

                // Chọn Canon Fact: ưu tiên character-related
                let chosenFact = null;
                if (activeFacts.length > 0) {
                    const relevantFacts = activeFacts.filter(f => f.subject_type === 'character');
                    chosenFact = relevantFacts.length > 0
                        ? relevantFacts[Math.floor(Math.random() * relevantFacts.length)]
                        : activeFacts[Math.floor(Math.random() * activeFacts.length)];
                }

                finalGoal = 'Tao 3 huong di bat ngo (plot twist) cho chuong tiep theo.';
                if (chosenThread) finalGoal += ' Tuyen truyen can phat trien: "' + chosenThread.title + '"';
                if (chosenThread?.description) finalGoal += ' (' + chosenThread.description + ')';
                if (chosenFact) finalGoal += '. Su that lien quan: "' + chosenFact.description + '"';
            }

            // Build prompt
            const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
                ...ctx,
                userPrompt: finalGoal,
                chapterCount: arcChapterCount,
                arcPacing: arcPacing,
            });

            // Gọi AI qua aiService.send() (đúng API)
            await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.ARC_OUTLINE,
                    messages,
                    stream: true,
                    onToken: () => { },
                    onComplete: (text) => {
                        try {
                            const parsed = parseAIJsonValue(text);
                            const outline = normalizeOutlineResult(parsed);
                            if (!outline) throw new Error('Unexpected outline format');
                            set({ generatedOutline: outline, outlineStatus: 'ready' });
                        } catch (e) {
                            console.error('Failed to parse outline JSON:', e, text);
                            set({ outlineStatus: 'error' });
                        }
                        resolve();
                    },
                    onError: (err) => {
                        console.error('Outline generation error:', err);
                        set({ outlineStatus: 'error' });
                        resolve();
                    },
                });
            });
        } catch (err) {
            console.error('generateOutline failed:', err);
            set({ outlineStatus: 'error' });
        }
    },

    // Tác giả chỉnh sửa dàn ý
    updateOutlineChapter: (index, updates) => {
        const { generatedOutline } = get();
        if (!generatedOutline) return;
        const newChapters = [...generatedOutline.chapters];
        newChapters[index] = { ...newChapters[index], ...updates };
        set({ generatedOutline: { ...generatedOutline, chapters: newChapters } });
    },

    removeOutlineChapter: (index) => {
        const { generatedOutline } = get();
        if (!generatedOutline) return;
        const newChapters = generatedOutline.chapters.filter((_, i) => i !== index);
        set({ generatedOutline: { ...generatedOutline, chapters: newChapters } });
    },

    // ═══════════════════════════════════════════
    // BƯỚC 4: Đắp thịt (Batch Generation)
    // ═══════════════════════════════════════════
    startBatchDraft: async ({ projectId, genre, startingChapterIndex }) => {
        const { generatedOutline } = get();
        if (!generatedOutline || !generatedOutline.chapters) return;

        const chapters = generatedOutline.chapters;
        set({
            draftStatus: 'drafting',
            draftProgress: { current: 0, total: chapters.length },
            draftResults: chapters.map((ch, i) => ({
                chapterIndex: startingChapterIndex + i,
                title: ch.title,
                content: '',
                wordCount: 0,
                status: 'pending',
            })),
        });

        for (let i = 0; i < chapters.length; i++) {
            const { draftStatus } = get();
            if (draftStatus === 'idle') break; // Cancelled

            const ch = chapters[i];
            const chapterIdx = startingChapterIndex + i;

            try {
                const ctx = await gatherContext({
                    projectId, chapterId: null, chapterIndex: chapterIdx,
                    sceneId: null, sceneText: '', genre,
                });

                const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
                    ...ctx,
                    chapterOutlineTitle: ch.title,
                    chapterOutlineSummary: ch.summary,
                    chapterOutlineEvents: ch.key_events || [],
                });

                // Dùng aiService.send() — await bằng Promise wrapper
                await new Promise((resolve) => {
                    aiService.send({
                        taskType: TASK_TYPES.ARC_CHAPTER_DRAFT,
                        messages,
                        stream: true,
                        onToken: (chunk, fullText) => {
                            // Optionally update live preview in future
                        },
                        onComplete: (text) => {
                            const wordCount = text.split(/\s+/).filter(Boolean).length;
                            set(state => ({
                                draftProgress: { ...state.draftProgress, current: i + 1 },
                                draftResults: state.draftResults.map((r, idx) =>
                                    idx === i ? { ...r, content: text, wordCount, status: 'done' } : r
                                ),
                            }));
                            resolve();
                        },
                        onError: (err) => {
                            console.error(`Draft chapter ${i} error:`, err);
                            set(state => ({
                                draftProgress: { ...state.draftProgress, current: i + 1 },
                                draftResults: state.draftResults.map((r, idx) =>
                                    idx === i ? { ...r, status: 'error' } : r
                                ),
                            }));
                            resolve(); // Continue to next chapter
                        },
                    });
                });
            } catch (err) {
                console.error(`Draft chapter ${i} exception:`, err);
                set(state => ({
                    draftProgress: { ...state.draftProgress, current: i + 1 },
                    draftResults: state.draftResults.map((r, idx) =>
                        idx === i ? { ...r, status: 'error' } : r
                    ),
                }));
            }
        }

        set(s => {
            if (s.draftStatus === 'drafting') return { draftStatus: 'done' };
            return {};
        });
    },

    cancelDraft: () => set({ draftStatus: 'idle' }),

    // ═══════════════════════════════════════════
    // Lưu Dàn Ý Only (không đắp thịt)
    // ═══════════════════════════════════════════
    commitOutlineOnly: async (projectId) => {
        const { generatedOutline } = get();
        if (!generatedOutline?.chapters) return;
        const { chapters } = useProjectStore.getState();
        const baseIndex = getNextOrderIndex(chapters);

        for (let i = 0; i < generatedOutline.chapters.length; i++) {
            const ch = generatedOutline.chapters[i];
            const chapterId = await db.chapters.add({
                project_id: projectId,
                arc_id: null,
                order_index: baseIndex + i,
                title: ch.title,
                summary: ch.summary || '',
                purpose: JSON.stringify(ch.key_events || []),
                status: 'outline',
                word_count_target: 7000,
                actual_word_count: 0,
            });

            await db.scenes.add({
                project_id: projectId,
                chapter_id: chapterId,
                order_index: 0,
                title: 'Cảnh 1',
                summary: '',
                pov_character_id: null,
                location_id: null,
                time_marker: '',
                goal: '',
                conflict: '',
                emotional_start: '',
                emotional_end: '',
                status: 'outline',
                draft_text: '',
                final_text: '',
            });
        }

        await useProjectStore.getState().loadProject(projectId);
    },

    // ═══════════════════════════════════════════
    // Lưu kết quả vào Database
    // ═══════════════════════════════════════════
    commitDraftsToProject: async (projectId) => {
        const { draftResults, generatedOutline } = get();
        const { chapters } = useProjectStore.getState();
        const baseIndex = getNextOrderIndex(chapters);
        let createdCount = 0;

        for (let di = 0; di < draftResults.length; di++) {
            const draft = draftResults[di];
            if (draft.status !== 'done' || !draft.content) continue;

            const chapterId = await db.chapters.add({
                project_id: projectId,
                arc_id: null,
                order_index: baseIndex + createdCount,
                title: draft.title,
                summary: generatedOutline.chapters[di]?.summary || '',
                purpose: '',
                status: 'draft',
                word_count_target: 7000,
                actual_word_count: draft.wordCount,
            });
            createdCount++;

            await db.scenes.add({
                project_id: projectId,
                chapter_id: chapterId,
                order_index: 0,
                title: 'Cảnh 1',
                summary: '',
                pov_character_id: null,
                location_id: null,
                time_marker: '',
                goal: '',
                conflict: '',
                emotional_start: '',
                emotional_end: '',
                status: 'draft',
                draft_text: draft.content,
                final_text: '',
            });
        }

        await useProjectStore.getState().loadProject(projectId);
    },

    // ═══════════════════════════════════════════
    // PHASE 3: Feedback Loop
    // ═══════════════════════════════════════════
    flagChapter: (index, note) => {
        set(state => ({
            draftResults: state.draftResults.map((r, i) => {
                if (i !== index) return r;
                // If note is empty/falsy, unflag (revert to done)
                if (!note) return { ...r, status: 'done', flagNote: '' };
                return { ...r, status: 'flagged', flagNote: note };
            }),
        }));
    },

    regenerateFromIndex: async ({ projectId, genre, fromIndex, startingChapterIndex }) => {
        const { generatedOutline, draftResults } = get();
        if (!generatedOutline) return;

        const chapters = generatedOutline.chapters;

        set(state => ({
            draftStatus: 'drafting',
            draftProgress: { current: fromIndex, total: chapters.length },
            draftResults: state.draftResults.map((r, i) =>
                i >= fromIndex ? { ...r, content: '', wordCount: 0, status: 'pending' } : r
            ),
        }));

        for (let i = fromIndex; i < chapters.length; i++) {
            const { draftStatus } = get();
            if (draftStatus === 'idle') break;

            const ch = chapters[i];
            const chapterIdx = startingChapterIndex + i;

            // Lấy nội dung các chương trước đã OK làm context
            const currentResults = get().draftResults;
            const previousContent = currentResults
                .filter((r, idx) => idx < i && r.status === 'done')
                .map(r => r.content)
                .join('\n\n');

            try {
                const ctx = await gatherContext({
                    projectId, chapterId: null, chapterIndex: chapterIdx,
                    sceneId: null, sceneText: previousContent.slice(-3000), genre,
                });

                const flagNote = currentResults[i]?.flagNote || '';
                const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
                    ...ctx,
                    chapterOutlineTitle: ch.title,
                    chapterOutlineSummary: ch.summary + (flagNote ? '. GHI CHU SUA DOI: ' + flagNote : ''),
                    chapterOutlineEvents: ch.key_events || [],
                });

                await new Promise((resolve) => {
                    aiService.send({
                        taskType: TASK_TYPES.ARC_CHAPTER_DRAFT,
                        messages,
                        stream: true,
                        onToken: () => { },
                        onComplete: (text) => {
                            const wordCount = text.split(/\s+/).filter(Boolean).length;
                            set(state => ({
                                draftProgress: { ...state.draftProgress, current: i + 1 },
                                draftResults: state.draftResults.map((r, idx) =>
                                    idx === i ? { ...r, content: text, wordCount, status: 'done', flagNote: '' } : r
                                ),
                            }));
                            resolve();
                        },
                        onError: (err) => {
                            console.error(`Regen chapter ${i} error:`, err);
                            set(state => ({
                                draftProgress: { ...state.draftProgress, current: i + 1 },
                                draftResults: state.draftResults.map((r, idx) =>
                                    idx === i ? { ...r, status: 'error' } : r
                                ),
                            }));
                            resolve();
                        },
                    });
                });
            } catch (err) {
                console.error(`Regen chapter ${i} exception:`, err);
                set(state => ({
                    draftProgress: { ...state.draftProgress, current: i + 1 },
                    draftResults: state.draftResults.map((r, idx) =>
                        idx === i ? { ...r, status: 'error' } : r
                    ),
                }));
            }
        }

        set(s => {
            if (s.draftStatus === 'drafting') return { draftStatus: 'done' };
            return {};
        });
    },
}));

export default useArcGenStore;
