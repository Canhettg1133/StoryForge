/**
 * StoryForge — Lab Store (Standalone)
 * 
 * Manages the state for the Narrative Lab chat interface.
 * Uses lab-specific versions of the AI Client and Prompt Builder.
 */

import { create } from 'zustand';
import labAIService from '../services/labClient';
import { buildLabPrompt } from '../services/labPromptBuilder';
import { TASK_TYPES } from '../../../services/ai/router';
import modelRouter from '../../../services/ai/router';
import { NSFW_SUPER_PROMPT_1 } from '../../../utils/constants';
import { toVietnameseErrorMessage } from '../../../utils/errorMessages.js';

const useLabStore = create((set, get) => ({
    messages: [],
    isStreaming: false,
    streamingText: '',
    nsfwMode: false,
    superNsfwMode: false,
    isPrimed: false,
    // Stores the actual ENI priming messages so buildLabPrompt can inject them
    eniSessionHistory: [],
    qualityMode: 'balanced',
    genre: 'tien_hiep',
    writingStyle: '',

    setNsfwMode: (val) => set({ nsfwMode: val }),
    setSuperNsfwMode: (val) => set({ superNsfwMode: val, isPrimed: false, eniSessionHistory: [] }),
    setQualityMode: (val) => set({ qualityMode: val }),
    setGenre: (val) => set({ genre: val }),
    setWritingStyle: (val) => set({ writingStyle: val }),

    clearHistory: () => set({ messages: [], streamingText: '', isPrimed: false }),

    primeEni: async () => {
        const { isStreaming, qualityMode } = get();
        if (isStreaming) return;

        set({ isStreaming: true, streamingText: 'Đang khởi tạo persona ENI...' });

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
                    const history = [
                        { role: 'user', content: '[Prompt khởi tạo ENI ban đầu]' },
                        { role: 'assistant', content: text }
                    ];
                    set((state) => ({
                        isStreaming: false,
                        streamingText: '',
                        isPrimed: true,
                        eniSessionHistory: history,
                        messages: [
                            ...state.messages,
                            { role: 'user', content: '[Prompt khởi tạo ENI ban đầu]' },
                            { role: 'assistant', content: text }
                        ]
                    }));
                },
                onError: (err) => {
                    set({ isStreaming: false, streamingText: `Khởi tạo ENI thất bại: ${toVietnameseErrorMessage(err, 'Lỗi không xác định.')}` });
                }
            });
        } catch (err) {
            set({ isStreaming: false, streamingText: toVietnameseErrorMessage(err, 'Khởi tạo ENI thất bại.') });
        }
    },

    sendMessage: async (userPrompt, context = {}) => {
        const { messages, nsfwMode, superNsfwMode, qualityMode, genre, writingStyle, eniSessionHistory } = get();

        // Add user message to history
        const userMsg = { role: 'user', content: userPrompt };
        set({ messages: [...messages, userMsg], isStreaming: true, streamingText: '' });

        // Build the system prompt using the unified buildLabPrompt (wraps main promptBuilder)
        const labContext = {
            ...context,
            userPrompt,
            nsfwMode,
            superNsfwMode,
            genre,
            writingStyle,
            eniSessionHistory,
            // Pass existing messages so buildLabPrompt can inject conversation history
            labConversationHistory: messages,
        };

        const finalMessages = buildLabPrompt(TASK_TYPES.FREE_PROMPT, labContext);

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
                    // Find the system prompt in finalMessages for storage
                    const systemMsg = finalMessages.find(m => m.role === 'system');
                    set((state) => ({
                        isStreaming: false,
                        streamingText: '',
                        messages: [
                            ...state.messages,
                            {
                                role: 'assistant',
                                content: text,
                                systemPrompt: systemMsg?.content || '',
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
                        messages: [...state.messages, { role: 'error', content: toVietnameseErrorMessage(err, 'AI không trả lời được.') }]
                    }));
                }
            });
        } catch (err) {
            set({ isStreaming: false });
            set((state) => ({
                messages: [...state.messages, { role: 'error', content: toVietnameseErrorMessage(err, 'AI không trả lời được.') }]
            }));
        }
    }
}));

export default useLabStore;
