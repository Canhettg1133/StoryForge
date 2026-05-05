import { create } from 'zustand';
import { readLabLiteFile } from '../services/labLite/fileReader.js';
import { estimateTokensDetailed } from '../services/labLite/tokenEstimator.js';
import {
  detectMojibakeWarnings,
  inspectStyleImporterFile,
} from '../services/styleImporter/fileSafety.js';
import { planStyleImporterChunks } from '../services/styleImporter/chunkPlanner.js';
import {
  analyzeStyleChunks,
  generatePromptPatches,
  mergeStylePack,
} from '../services/styleImporter/styleImporterRunner.js';
import { STYLE_IMPORTER_ALLOWED_TARGETS } from '../services/styleImporter/projectPromptInterop.js';

const STEP_IDS = ['read', 'chapters', 'chunks', 'analyze', 'patch'];

function makeInitialProgress() {
  return Object.fromEntries(STEP_IDS.map((step) => [step, 'idle']));
}

function getPatchId(patch, index) {
  return `${patch.target_prompt}:${index}`;
}

function fileMetaFrom(file) {
  return {
    name: file?.name || '',
    size: Number(file?.size || 0),
    type: file?.type || '',
  };
}

const initialState = {
  fileState: null,
  userInstruction: '',
  progress: makeInitialProgress(),
  runError: '',
  stylePack: null,
  patches: [],
  selectedPatchIds: new Set(),
  isRunning: false,
  isSaving: false,
  saveMessage: null,
  backupSnapshot: null,
};

const useStyleImporterStore = create((set, get) => ({
  ...initialState,

  setUserInstruction: (value) => set({ userInstruction: String(value || '') }),

  setStep: (stepId, status) => {
    set((state) => ({
      progress: { ...state.progress, [stepId]: status },
    }));
  },

  resetAnalysisOutput: () => set({
    stylePack: null,
    patches: [],
    selectedPatchIds: new Set(),
    saveMessage: null,
    runError: '',
  }),

  resetSession: () => set({
    ...initialState,
    progress: makeInitialProgress(),
    selectedPatchIds: new Set(),
  }),

  setSaveMessage: (saveMessage) => set({ saveMessage }),
  setIsSaving: (isSaving) => set({ isSaving: Boolean(isSaving) }),
  setBackupSnapshot: (backupSnapshot) => set({ backupSnapshot }),

  togglePatch: (id) => {
    set((state) => {
      const next = new Set(state.selectedPatchIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedPatchIds: next };
    });
  },

  importFile: async (file) => {
    if (!file || get().isRunning) return;
    get().resetAnalysisOutput();
    set({
      progress: makeInitialProgress(),
      fileState: null,
    });
    get().setStep('read', 'running');

    const safety = await inspectStyleImporterFile(file);
    if (!safety.ok) {
      get().setStep('read', 'error');
      set({ fileState: { file: fileMetaFrom(file), safety, error: safety.message } });
      return;
    }

    try {
      const readResult = await readLabLiteFile(file, { fallbackTitlePrefix: 'Chương' });
      get().setStep('read', 'done');
      get().setStep('chapters', 'running');

      const rawText = String(readResult.rawText || '');
      const chapters = Array.isArray(readResult.chapters) ? readResult.chapters : [];
      const tokenDetail = estimateTokensDetailed(rawText);
      get().setStep('chapters', 'done');
      get().setStep('chunks', 'running');

      const chunkPlan = planStyleImporterChunks({
        rawText,
        chapters,
        fileSizeBytes: file.size,
        totalEstimatedTokens: tokenDetail.estimatedTokens,
      });
      get().setStep('chunks', 'done');

      set({
        fileState: {
          file: fileMetaFrom(file),
          safety,
          chapters,
          tokenDetail,
          chunkPlan,
          warnings: [
            ...detectMojibakeWarnings(rawText),
            ...(chunkPlan.warnings || []),
          ],
        },
      });
    } catch (error) {
      get().setStep('read', 'error');
      set({
        fileState: {
          file: fileMetaFrom(file),
          safety,
          error: error?.message || 'Không đọc được file.',
        },
      });
    }
  },

  runAnalysis: async ({ promptBases, allowedTargets = STYLE_IMPORTER_ALLOWED_TARGETS } = {}) => {
    const state = get();
    if (!state.fileState?.chunkPlan || state.isRunning) return;

    get().resetAnalysisOutput();
    set((current) => ({
      progress: {
        ...current.progress,
        analyze: 'running',
        patch: 'idle',
      },
      isRunning: true,
    }));
    let currentPhase = 'analyze';

    try {
      const fileMeta = {
        sourceFileName: state.fileState.file?.name || '',
        chapterCount: state.fileState.chapters?.length || 0,
      };
      const analyses = await analyzeStyleChunks({
        chunks: state.fileState.chunkPlan.chunks,
        userInstruction: state.userInstruction,
        fileMeta,
      });
      const merged = await mergeStylePack({
        analyses,
        userInstruction: state.userInstruction,
      });
      set({ stylePack: merged });
      get().setStep('analyze', 'done');
      get().setStep('patch', 'running');
      currentPhase = 'patch';

      const nextPatches = await generatePromptPatches({
        stylePack: merged,
        currentPrompts: promptBases?.currentPromptsForAI || {},
        userInstruction: state.userInstruction,
        allowedTargets,
      });
      if (!Array.isArray(nextPatches) || nextPatches.length === 0) {
        throw new Error('AI không trả về patch prompt hợp lệ. Hãy chạy lại hoặc thêm yêu cầu cụ thể hơn cho Style Importer.');
      }
      set({
        patches: nextPatches,
        selectedPatchIds: new Set(nextPatches.map(getPatchId)),
      });
      get().setStep('patch', 'done');
    } catch (error) {
      set({ runError: error?.message || 'Không thể phân tích tác phẩm mẫu.' });
      get().setStep(currentPhase, 'error');
    } finally {
      set({ isRunning: false });
    }
  },
}));

export default useStyleImporterStore;
