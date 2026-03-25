/**
 * StoryForge — Lab Store (Standalone)
 * 
 * Manages the state for the Narrative Lab chat interface.
 * Uses lab-specific versions of the AI Client and Prompt Builder.
 */

import { create } from 'zustand';
import labAIService from '../services/labClient';
import { buildPrompt } from '../services/labPromptBuilder';
import { TASK_TYPES } from '../../../services/ai/router';
import modelRouter from '../../../services/ai/router';
import { NSFW_SUPER_PROMPT_1 } from '../../../utils/constants';

const useLabStore = create((set, get) => ({
    messages: [],
    isStreaming: false,
    streamingText: '',
    nsfwMode: false,
    superNsfwMode: false,
    isPrimed: false,
    qualityMode: 'balanced',
    genre: 'tien_hiep',
    writingStyle: '',

    setNsfwMode: (val) => set({ nsfwMode: val }),
    setSuperNsfwMode: (val) => set({ superNsfwMode: val, isPrimed: false }),
    setQualityMode: (val) => set({ qualityMode: val }),
    setGenre: (val) => set({ genre: val }),
    setWritingStyle: (val) => set({ writingStyle: val }),

    clearHistory: () => set({ messages: [], streamingText: '', isPrimed: false }),

    primeEni: async () => {
        const { isStreaming, qualityMode } = get();
        if (isStreaming) return;

        set({ isStreaming: true, streamingText: 'Initializing ENI Persona (Priming)...' });

        try {
            labAIService.setRouter(modelRouter);
            labAIService.send({
                taskType: TASK_TYPES.FREE_PROMPT,
                messages: [{ role: 'user', content: NSFW_SUPER_PROMPT_1 }],
                stream: true,
                routeOptions: { qualityOverride: qualityMode },
                nsfwMode: true,
                superNsfwMode: true,
                onToken: (chunk, full) => set({ streamingText: full }),
                onComplete: (text) => {
                    set((state) => ({
                        isStreaming: false,
                        streamingText: '',
                        isPrimed: true,
                        messages: [
                            ...state.messages,
                            { role: 'user', content: '[Initial ENI Priming Prompt]' },
                            { role: 'assistant', content: text }
                        ]
                    }));
                },
                onError: (err) => {
                    set({ isStreaming: false, streamingText: 'Priming failed: ' + err.message });
                }
            });
        } catch (err) {
            set({ isStreaming: false, streamingText: err.message });
        }
    },

    sendMessage: async (userPrompt, context = {}) => {
        const { messages, nsfwMode, superNsfwMode, qualityMode, genre, writingStyle } = get();

        // Add user message to history
        const userMsg = { role: 'user', content: userPrompt };
        set({ messages: [...messages, userMsg], isStreaming: true, streamingText: '' });

        // Build the system prompt using Lab logic
        const labContext = {
            ...context,
            userPrompt,
            nsfwMode,
            superNsfwMode,
            genre,
            writingStyle,
        };

        // For Lab, we build a fresh system prompt for every message 
        // to allow testing different layer configurations.
        const aiMessages = buildPrompt(TASK_TYPES.FREE_PROMPT, labContext);

        // If there is existing history in the Lab chat, we might want to inject it
        // But for "Lab" (Prompt Testing), we often want to test a SINGLE turn 
        // with different system prompts. 
        // However, for "Chat", we need history.

        // Narrative Lab Rule: Inject the last 5 turns of conversation
        const history = messages.slice(-10); // Last 5 pairs
        const finalMessages = [
            aiMessages[0], // System
            ...history,
            aiMessages[1]  // Current User Prompt
        ];

        try {
            labAIService.setRouter(modelRouter);
            labAIService.send({
                taskType: TASK_TYPES.FREE_PROMPT,
                messages: finalMessages,
                stream: true,
                routeOptions: { qualityOverride: qualityMode },
                nsfwMode,
                superNsfwMode,
                onToken: (chunk, full) => {
                    set({ streamingText: full });
                },
                onComplete: (text, meta) => {
                    set((state) => ({
                        isStreaming: false,
                        streamingText: '',
                        messages: [
                            ...state.messages,
                            {
                                role: 'assistant',
                                content: text,
                                systemPrompt: aiMessages[0].content,
                                model: meta?.model,
                                provider: meta?.provider,
                                elapsed: meta?.elapsed
                            }
                        ]
                    }));
                },
                onError: (err) => {
                    set({ isStreaming: false });
                    set((state) => ({
                        messages: [...state.messages, { role: 'error', content: err.message }]
                    }));
                }
            });
        } catch (err) {
            set({ isStreaming: false });
            set((state) => ({
                messages: [...state.messages, { role: 'error', content: err.message }]
            }));
        }
    }
}));

export default useLabStore;
