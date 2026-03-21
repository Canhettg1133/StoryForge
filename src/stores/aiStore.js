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
}));

export default useAIStore;
