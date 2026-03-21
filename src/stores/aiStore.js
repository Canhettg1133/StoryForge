/**
 * StoryForge — AI Store (Phase 3)
 * 
 * Zustand store for AI interactions.
 * Phase 3: Context Engine integration, chapter summary, feedback loop.
 */

import { create } from 'zustand';
import aiService from '../services/ai/client';
import { buildPrompt } from '../services/ai/promptBuilder';
import { TASK_TYPES, QUALITY_MODES, PROVIDERS } from '../services/ai/router';
import modelRouter from '../services/ai/router';
import keyManager from '../services/ai/keyManager';
import { gatherContext } from '../services/ai/contextEngine';
import db from '../services/db/database';

// Inject router into aiService (avoid circular import)
aiService.setRouter(modelRouter);

const useAIStore = create((set, get) => ({
  // --- State ---
  isStreaming: false,
  streamingText: '',
  completedText: '',
  error: null,
  lastRouteInfo: null,
  lastElapsed: null,

  // Phase 3 — Feedback loop state
  isSummarizing: false,
  isExtracting: false,
  isCheckingConflict: false,
  lastExtractResult: null,

  // Settings
  qualityMode: modelRouter.getQualityMode(),
  preferredProvider: modelRouter.getPreferredProvider(),

  // Key counts
  keyCount: keyManager.getTotalKeys(),

  // --- Actions ---

  /**
   * Run an AI task with streaming.
   * Phase 3: Automatically gathers context before building prompt.
   */
  runTask: async ({ taskType, context = {}, routeOptions = {} }) => {
    set({ isStreaming: true, streamingText: '', completedText: '', error: null, lastRouteInfo: null });

    // Phase 3: Auto-gather context if project info is available
    let enrichedContext = { ...context };
    if (context.projectId) {
      try {
        const memoryContext = await gatherContext({
          projectId: context.projectId,
          chapterId: context.chapterId,
          chapterIndex: context.chapterIndex || 0,
          sceneText: context.sceneText || '',
          genre: context.genre || '',
        });
        // Merge memory context into the user context
        enrichedContext = {
          ...context,
          characters: memoryContext.characters,
          locations: memoryContext.locations,
          objects: memoryContext.objects,
          worldTerms: memoryContext.worldTerms,
          taboos: memoryContext.taboos,
          previousSummary: memoryContext.previousSummary || context.previousSummary,
        };
      } catch (err) {
        console.warn('[AI] Context Engine error (non-fatal):', err);
      }
    }

    const messages = buildPrompt(taskType, enrichedContext);

    const { abort, routeInfo } = aiService.send({
      taskType,
      messages,
      stream: true,
      routeOptions,
      onToken: (chunk, fullText) => {
        set({ streamingText: fullText });
      },
      onComplete: (text, meta) => {
        set({
          isStreaming: false,
          streamingText: '',
          completedText: text,
          lastRouteInfo: meta || routeInfo,
          lastElapsed: meta?.elapsed || null,
        });
        set({ keyCount: keyManager.getTotalKeys() });
      },
      onError: (err) => {
        set({
          isStreaming: false,
          error: err.message || 'Lỗi không xác định',
        });
        set({ keyCount: keyManager.getTotalKeys() });
      },
    });

    set({ lastRouteInfo: routeInfo });

    return abort;
  },

  /**
   * Quick task shortcuts
   */
  continueWriting: (context) => get().runTask({ taskType: TASK_TYPES.CONTINUE, context }),
  rewriteText: (context) => get().runTask({ taskType: TASK_TYPES.REWRITE, context }),
  expandText: (context) => get().runTask({ taskType: TASK_TYPES.EXPAND, context }),
  brainstorm: (context) => get().runTask({ taskType: TASK_TYPES.BRAINSTORM, context }),
  outlineChapter: (context) => get().runTask({ taskType: TASK_TYPES.OUTLINE, context }),
  suggestPlot: (context) => get().runTask({ taskType: TASK_TYPES.PLOT_SUGGEST, context }),
  extractTerms: (context) => get().runTask({ taskType: TASK_TYPES.EXTRACT_TERMS, context }),
  freePrompt: (context) => get().runTask({ taskType: TASK_TYPES.FREE_PROMPT, context }),

  // ═══════════════════════════════════════════
  // Phase 3: Chapter Summary & Feedback Loop
  // ═══════════════════════════════════════════

  /**
   * Summarize a chapter using Flash model.
   * Returns the summary text.
   */
  summarizeChapter: (context) => {
    return new Promise((resolve, reject) => {
      set({ isSummarizing: true });

      const messages = buildPrompt(TASK_TYPES.CHAPTER_SUMMARY, context);

      aiService.send({
        taskType: TASK_TYPES.CHAPTER_SUMMARY,
        messages,
        stream: false,
        onComplete: (text) => {
          set({ isSummarizing: false, keyCount: keyManager.getTotalKeys() });
          resolve(text);
        },
        onError: (err) => {
          set({ isSummarizing: false, keyCount: keyManager.getTotalKeys() });
          reject(err);
        },
      });
    });
  },

  /**
   * Extract new codex entries from chapter text using Flash model.
   * Returns parsed JSON with characters, locations, terms, objects.
   */
  extractFromChapter: (context) => {
    return new Promise((resolve, reject) => {
      set({ isExtracting: true, lastExtractResult: null });

      const messages = buildPrompt(TASK_TYPES.FEEDBACK_EXTRACT, context);

      aiService.send({
        taskType: TASK_TYPES.FEEDBACK_EXTRACT,
        messages,
        stream: false,
        onComplete: (text) => {
          set({ isExtracting: false, keyCount: keyManager.getTotalKeys() });
          try {
            // Parse JSON using balanced brace counting (same as AIGenerateButton fix)
            let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const startIdx = cleaned.indexOf('{');
            if (startIdx !== -1) {
              let depth = 0, endIdx = -1;
              for (let i = startIdx; i < cleaned.length; i++) {
                if (cleaned[i] === '{') depth++;
                else if (cleaned[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
              }
              if (endIdx !== -1) {
                const result = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
                set({ lastExtractResult: result });
                resolve(result);
              } else {
                set({ lastExtractResult: null });
                resolve(null);
              }
            } else {
              set({ lastExtractResult: null });
              resolve(null);
            }
          } catch (e) {
            console.warn('[AI] Failed to parse extraction result:', e);
            set({ lastExtractResult: null });
            resolve(null);
          }
        },
        onError: (err) => {
          set({ isExtracting: false, keyCount: keyManager.getTotalKeys() });
          reject(err);
        },
      });
    });
  },

  /**
   * Check for conflicts in a scene or chapter.
   * Phase 4.5: Continuity & Intelligence
   */
  checkConflict: (params) => {
    return new Promise(async (resolve, reject) => {
      set({ isCheckingConflict: true });

      const { projectId, sceneText, genre } = params;

      try {
        // Gather characters and canon facts for context
        const allCharacters = await db.characters.where('project_id').equals(projectId).toArray();
        const allCanonFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();

        const messages = buildPrompt(TASK_TYPES.CHECK_CONFLICT, {
          projectId,
          genre,
          sceneText,
          characters: allCharacters,
          canonFacts: allCanonFacts,
        });

        aiService.send({
          taskType: TASK_TYPES.CHECK_CONFLICT,
          messages,
          stream: false,
          onComplete: (text) => {
            set({ isCheckingConflict: false, keyCount: keyManager.getTotalKeys() });
            try {
              let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
              const startIdx = cleaned.indexOf('{');
              if (startIdx !== -1) {
                let depth = 0, endIdx = -1;
                for (let i = startIdx; i < cleaned.length; i++) {
                  if (cleaned[i] === '{') depth++;
                  else if (cleaned[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
                }
                if (endIdx !== -1) {
                  const result = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
                  resolve(result);
                } else {
                  resolve({ conflicts: [] });
                }
              } else {
                resolve({ conflicts: [] });
              }
            } catch (e) {
              console.warn('[AI] Failed to parse conflict result:', e);
              resolve({ conflicts: [] });
            }
          },
          onError: (err) => {
            set({ isCheckingConflict: false, keyCount: keyManager.getTotalKeys() });
            reject(err);
          },
        });
      } catch (err) {
        set({ isCheckingConflict: false });
        reject(err);
      }
    });
  },

  /** Cancel active request */
  abort: () => {
    aiService.abort();
    set({ isStreaming: false });
  },

  /** Clear output */
  clearOutput: () => {
    set({ streamingText: '', completedText: '', error: null, lastRouteInfo: null, lastElapsed: null, lastExtractResult: null });
  },

  /** Quality mode */
  setQualityMode: (mode) => {
    modelRouter.setQualityMode(mode);
    set({ qualityMode: mode });
  },

  /** Provider preference */
  setPreferredProvider: (provider) => {
    modelRouter.setPreferredProvider(provider);
    set({ preferredProvider: provider });
  },

  /** Refresh key status */
  refreshKeyStatus: () => {
    set({ keyCount: keyManager.getTotalKeys() });
  },

  // ═══════════════════════════════════════════
  // Phase A: Suggestion Inbox
  // ═══════════════════════════════════════════
  isSuggesting: false,

  /**
   * Generate AI suggestions for character status updates & new canon facts.
   * Called after completing a chapter or manually by the author.
   * 
   * @param {object} params
   * @param {number} params.projectId
   * @param {number} params.chapterId - the chapter to analyze
   * @param {string} params.genre
   * @returns {Promise<object|null>} parsed result or null
   */
  generateSuggestions: (params) => {
    const { projectId, chapterId, genre } = params;

    return new Promise(async (resolve, reject) => {
      set({ isSuggesting: true });

      try {
        // 1. Gather all scene text from this chapter
        const scenes = await db.scenes
          .where('chapter_id').equals(chapterId)
          .sortBy('order_index');
        const fullChapterText = scenes
          .map(s => (s.draft_text || s.final_text || '').replace(/<[^>]*>/g, ' '))
          .join('\n\n');

        if (!fullChapterText.trim()) {
          set({ isSuggesting: false });
          resolve(null);
          return;
        }

        // 2. Load characters and canon facts for context
        const allCharacters = await db.characters
          .where('project_id').equals(projectId).toArray();
        const allCanonFacts = await db.canonFacts
          .where('project_id').equals(projectId).toArray();

        // 3. Build prompt with full context
        const messages = buildPrompt(TASK_TYPES.SUGGEST_UPDATES, {
          projectId,
          genre,
          sceneText: fullChapterText,
          characters: allCharacters,
          canonFacts: allCanonFacts,
        });

        // 4. Call AI (non-streaming)
        aiService.send({
          taskType: TASK_TYPES.SUGGEST_UPDATES,
          messages,
          stream: false,
          onComplete: async (text) => {
            set({ isSuggesting: false, keyCount: keyManager.getTotalKeys() });
            try {
              // Parse JSON with balanced brace counting
              let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
              const startIdx = cleaned.indexOf('{');
              if (startIdx === -1) { resolve(null); return; }

              let depth = 0, endIdx = -1;
              for (let i = startIdx; i < cleaned.length; i++) {
                if (cleaned[i] === '{') depth++;
                else if (cleaned[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
              }
              if (endIdx === -1) { resolve(null); return; }

              const result = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
              const suggestionItems = [];

              // Process character_updates
              if (result.character_updates && Array.isArray(result.character_updates)) {
                for (const update of result.character_updates) {
                  // Match character name to ID
                  const char = allCharacters.find(c =>
                    c.name && c.name.toLowerCase() === (update.character_name || '').toLowerCase()
                  );
                  suggestionItems.push({
                    type: 'character_status',
                    source_chapter_id: chapterId,
                    target_id: char?.id || null,
                    target_name: update.character_name || '',
                    current_value: update.old_status || char?.current_status || '',
                    suggested_value: update.new_status || '',
                    reasoning: update.reasoning || '',
                  });
                }
              }

              // Process new_canon_facts
              if (result.new_canon_facts && Array.isArray(result.new_canon_facts)) {
                for (const fact of result.new_canon_facts) {
                  suggestionItems.push({
                    type: 'canon_fact',
                    source_chapter_id: chapterId,
                    target_id: null,
                    target_name: '',
                    current_value: '',
                    suggested_value: fact.description || '',
                    fact_type: (fact.fact_type || 'fact').trim(),
                    reasoning: fact.reasoning || '',
                  });
                }
              }

              // 5. Save to DB via suggestionStore
              if (suggestionItems.length > 0) {
                const { default: useSuggestionStore } = await import('./suggestionStore');
                await useSuggestionStore.getState().createSuggestions(projectId, suggestionItems);
              }

              resolve(result);
            } catch (e) {
              console.warn('[AI] Failed to parse suggestion result:', e);
              resolve(null);
            }
          },
          onError: (err) => {
            set({ isSuggesting: false, keyCount: keyManager.getTotalKeys() });
            reject(err);
          },
        });
      } catch (err) {
        set({ isSuggesting: false });
        reject(err);
      }
    });
  },
}));

export default useAIStore;
