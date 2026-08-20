/**
 * StoryForge — Outline Board (Phase 3→4 Bridge)
 * 
 * Visual chapter/scene planning board with 3-act structure.
 * Uses existing DB fields: summary, purpose, arc_id (as act), goal, conflict, pov, location.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import usePlotStore from '../../stores/plotStore';
import ChapterDetailModal from './ChapterDetailModal';
import PlotThreadModal from './PlotThreadModal';
import ArcGenerationModal from './ArcGenerationModal';
import { toVietnameseErrorMessage } from '../../utils/errorMessages';
import {
  Map, Plus, Sparkles, Loader2, FileText,
  Users, MapPin, Target, Zap, PenTool, LayoutGrid, List,
  CheckCircle2, GitPullRequest, Combine, X, ArrowRight,
  AlertTriangle, Trash2, CheckSquare, Square
} from 'lucide-react';
import { SCENE_STATUSES } from '../../utils/constants';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import {
  OUTLINE_METADATA_LIST_FIELDS,
  OUTLINE_METADATA_TEXT_FIELDS,
  buildClearOutlinePatch,
} from './outlineMetadata';
import {
  composeStoryCreationSystemPrompt,
  getStoryCreationSettings,
  renderStoryCreationTemplate,
} from '../../services/ai/storyCreationSettings';
import useMobileLayout from '../../hooks/useMobileLayout';
import { useConfirmDialog } from '../../components/common/ConfirmDialogProvider.jsx';
import { buildOutlineRuntimeIndex } from './outlineRuntimeIndex.js';
import { VirtualOutlineGrid, VirtualOutlineStack } from './VirtualOutlineCollection.jsx';
import './OutlineBoard.css';

const ACTS = [
  { id: 1, label: 'Hồi 1 — Thiết lập', desc: 'Giới thiệu, sự kiện khởi đầu', percent: '25%', color: 'var(--color-info)' },
  { id: 2, label: 'Hồi 2 — Xung đột', desc: 'Leo thang, bước ngoặt, khủng hoảng', percent: '50%', color: 'var(--color-warning)' },
  { id: 3, label: 'Hồi 3 — Giải quyết', desc: 'Cao trào, kết thúc', percent: '25%', color: 'var(--color-success)' },
];

const VALID_THREAD_TYPES = ['main', 'subplot', 'character_arc', 'mystery', 'romance'];

function normalizeOutlineListField(value) {
  const normalizeItem = (item) => {
    if (isPlainObject(item)) {
      return String(item.name || item.title || item.label || item.value || '').trim();
    }
    return String(item || '').trim();
  };

  if (Array.isArray(value)) {
    return value.map(normalizeItem).filter(Boolean);
  }

  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = parseAIJsonValue(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeItem).filter(Boolean);
    }
  } catch {
    // Fall through to loose splitting for model outputs like "A, B, C".
  }

  return trimmed
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOutlineTextField(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function buildChapterAnchorPatch(chapter = {}, { preserveMissing = false } = {}) {
  const hasField = (key) => Object.prototype.hasOwnProperty.call(chapter, key);
  const patch = {};
  const setList = (key) => {
    if (!preserveMissing || hasField(key)) patch[key] = normalizeOutlineListField(chapter[key]);
  };
  const setText = (key) => {
    if (!preserveMissing || hasField(key)) patch[key] = normalizeOutlineTextField(chapter[key]);
  };

  setList('featured_characters');
  setText('primary_location');
  setList('thread_titles');
  setList('key_events');
  setList('required_factions');
  setList('required_objects');
  setList('required_terms');
  setText('opening_state');
  setText('handoff_from_previous');
  setText('ending_state');
  return patch;
}

function normalizeActValue(value) {
  const numeric = Number(value);
  return [1, 2, 3].includes(numeric) ? numeric : null;
}

function buildChapterAnalysisPatch(chapter = {}) {
  const patch = {};

  for (const key of OUTLINE_METADATA_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(chapter, key)) continue;
    const value = normalizeOutlineTextField(chapter[key]);
    if (value) patch[key] = value;
  }

  const anchorPatch = buildChapterAnchorPatch(chapter, { preserveMissing: true });
  for (const key of OUTLINE_METADATA_LIST_FIELDS) {
    if (Array.isArray(anchorPatch[key]) && anchorPatch[key].length > 0) {
      patch[key] = anchorPatch[key];
    }
  }
  if (anchorPatch.primary_location) patch.primary_location = anchorPatch.primary_location;
  if (anchorPatch.opening_state) patch.opening_state = anchorPatch.opening_state;
  if (anchorPatch.handoff_from_previous) patch.handoff_from_previous = anchorPatch.handoff_from_previous;
  if (anchorPatch.ending_state) patch.ending_state = anchorPatch.ending_state;

  const act = normalizeActValue(chapter.act ?? chapter.arc_id);
  if (act) patch.arc_id = act;

  return patch;
}

function stripSceneText(text = '') {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(text = '', maxLength = 220) {
  const clean = stripSceneText(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trim()}...`;
}

function buildChapterSceneExcerpt(chapterId, scenes = []) {
  const chapterScenes = scenes
    .filter((scene) => scene.chapter_id === chapterId)
    .sort((left, right) => Number(left.order_index || 0) - Number(right.order_index || 0));

  const excerpts = [];
  for (let index = 0; index < chapterScenes.length; index++) {
    const scene = chapterScenes[index];
    const text = stripSceneText(scene.draft_text || scene.final_text || '');
    if (!text) continue;
    excerpts.push(`- Cảnh ${index + 1}${scene.title ? ` (${scene.title})` : ''}: ${truncateText(text, 420)}`);
    if (excerpts.join('\n').length > 1200) break;
  }

  return excerpts.join('\n');
}

function buildExistingOutlineContext(chapters = [], scenes = []) {
  if (chapters.length === 0) return 'Chưa có outline';

  return chapters.map((ch, i) => {
    const sceneExcerpt = buildChapterSceneExcerpt(ch.id, scenes);
    const lines = [
      `${i + 1}. ${ch.title}`,
      `Purpose hiện có: ${ch.purpose || 'Chưa có'}`,
      `Summary dàn ý hiện có: ${ch.summary || 'Chưa có'}`,
      `Hồi hiện có: ${ch.arc_id || 'Chưa gán'}`,
      sceneExcerpt
        ? `Nội dung đã viết / trích đoạn scene:\n${sceneExcerpt}`
        : 'Nội dung đã viết / trích đoạn scene: Chưa có nội dung scene.',
    ];
    return lines.join('\n');
  }).join('\n\n');
}

function shallowValueEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftList = Array.isArray(left) ? left : [];
    const rightList = Array.isArray(right) ? right : [];
    return leftList.join('\n') === rightList.join('\n');
  }
  return String(left ?? '') === String(right ?? '');
}

function getPatchStatus(chapter, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return 'same';
  const hasRealChange = keys.some((key) => !shallowValueEqual(chapter[key], patch[key]));
  if (!hasRealChange) return 'same';
  const hadOutline = keys.some((key) => {
    const current = chapter[key];
    return Array.isArray(current) ? current.length > 0 : !!current;
  });
  return hadOutline ? 'edit' : 'new';
}

function formatActLabel(value) {
  const act = normalizeActValue(value);
  return act ? `Hồi ${act}` : 'Chưa gán';
}

function formatCharacterForOutlinePrompt(character = {}) {
  const name = character.name || 'Nhân vật';
  const parts = [name + ' (' + (character.role || 'nhân vật') + ')'];
  const aliases = normalizeOutlineListField(character.aliases);
  if (aliases.length > 0) parts.push('aliases: ' + aliases.join(', '));
  if (character.specific_role) parts.push('specific_role: ' + character.specific_role);
  if (character.canon_status_summary) parts.push('Canon hiện tại: ' + character.canon_status_summary);
  if (character.current_status) parts.push('Trạng thái hồ sơ ban đầu: ' + character.current_status);
  return '- ' + parts.join(' | ');
}

export default function OutlineBoard() {
  const confirmAction = useConfirmDialog();
  const navigate = useNavigate();
  const {
    currentProject, chapters, scenes,
    createChapter, updateChapter, deleteChapter,
    setActiveChapter, setActiveScene,
  } = useProjectStore(useShallow((state) => ({
    currentProject: state.currentProject,
    chapters: state.chapters,
    scenes: state.scenes,
    createChapter: state.createChapter,
    updateChapter: state.updateChapter,
    deleteChapter: state.deleteChapter,
    setActiveChapter: state.setActiveChapter,
    setActiveScene: state.setActiveScene,
  })));
  const { characters, locations, loadCodex } = useCodexStore(useShallow((state) => ({
    characters: state.characters,
    locations: state.locations,
    loadCodex: state.loadCodex,
  })));
  const {
    plotThreads,
    loadPlotThreads,
    loadThreadBeatsForProject,
    createPlotThread,
    deletePlotThread,
  } = usePlotStore(useShallow((state) => ({
    plotThreads: state.plotThreads,
    loadPlotThreads: state.loadPlotThreads,
    loadThreadBeatsForProject: state.loadThreadBeatsForProject,
    createPlotThread: state.createPlotThread,
    deletePlotThread: state.deletePlotThread,
  })));

  const [selectedChapter, setSelectedChapter] = useState(null);
  const [viewMode, setViewMode] = useState('board');
  const isMobileLayout = useMobileLayout(900);
  const [mobileTab, setMobileTab] = useState('chapters');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingAnalysis, setIsApplyingAnalysis] = useState(false);
  const [genError, setGenError] = useState(null);
  const [outlineAnalysisPreview, setOutlineAnalysisPreview] = useState(null);
  const [chapterNotice, setChapterNotice] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState(() => new Set());
  const [isDeletingChapters, setIsDeletingChapters] = useState(false);

  // Plot Threads modal state
  const [showPlotModal, setShowPlotModal] = useState(false);
  const [editingThread, setEditingThread] = useState(null);

  // Arc Gen Modal state
  const [showArcGen, setShowArcGen] = useState(false);

  // AI Suggest Threads state
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestedThreads, setSuggestedThreads] = useState([]);

  // [MỚI] Suggest input expand state
  const [showSuggestInput, setShowSuggestInput] = useState(false);
  const [suggestHint, setSuggestHint] = useState('');
  const suggestTextareaRef = useRef(null);

  useEffect(() => {
    if (currentProject) {
      loadCodex(currentProject.id, { preferCache: true });
      loadPlotThreads(currentProject.id);
      loadThreadBeatsForProject(currentProject.id);
    }
  }, [currentProject?.id]);

  // [MỚI] Auto-focus textarea khi expand
  useEffect(() => {
    if (showSuggestInput && suggestTextareaRef.current) {
      suggestTextareaRef.current.focus();
    }
  }, [showSuggestInput]);

  useEffect(() => {
    if (isMobileLayout) {
      setViewMode('list');
    }
  }, [isMobileLayout]);

  useEffect(() => {
    if (!chapterNotice) return undefined;
    const timer = window.setTimeout(() => setChapterNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [chapterNotice]);

  // Group chapters by act (arc_id)
  const chaptersByAct = useMemo(() => {
    const groups = { 1: [], 2: [], 3: [], unassigned: [] };
    chapters.forEach(ch => {
      const act = ch.arc_id;
      if (act >= 1 && act <= 3) {
        groups[act].push(ch);
      } else {
        groups.unassigned.push(ch);
      }
    });
    return groups;
  }, [chapters]);

  const outlineRuntimeIndex = useMemo(() => buildOutlineRuntimeIndex({
    chapters,
    scenes,
    characters,
    locations,
  }), [chapters, scenes, characters, locations]);

  const goToEditor = (chapterId) => {
    const scene = outlineRuntimeIndex.firstSceneByChapterId.get(chapterId);
    setActiveChapter(chapterId);
    if (scene) setActiveScene(scene.id);
    navigate(`/project/${currentProject.id}/editor`);
  };

  const handleCreateManualChapter = async (chapterData) => {
    const result = await createChapter(undefined, undefined, chapterData);
    if (result) setChapterNotice('Đã thêm chương mới và Cảnh 1.');
    return result;
  };

  const addChapterToAct = async (act) => {
    await handleCreateManualChapter({ arc_id: act });
  };

  // AI Generate Outline
  const handleAIOutline = async () => {
    if (!currentProject) return;
    setIsGenerating(true);
    setGenError(null);
    setOutlineAnalysisPreview(null);

    const charList = characters.map(formatCharacterForOutlinePrompt).join('\n');
    const locList = locations.map((l) => l.name).join(', ');
    const existingOutline = buildExistingOutlineContext(chapters, scenes);

    const storyCreationSettings = getStoryCreationSettings();
    const outlinePrompts = storyCreationSettings.outlineGeneration;
    const outlineTaskInstruction = chapters.length > 0
      ? 'Phân tích dàn ý hiện tại DỰA TRÊN "Nội dung đã viết / trích đoạn scene" của từng chương. Chỉ được đề xuất purpose, summary, state_delta, act và anchor phản ánh nội dung đã có; không được viết lại diễn biến mới, không được bịa entity ngoài Codex, không đổi giới tính/vai trò/thân phận nếu Codex hoặc nội dung đã viết không cho phép. Ưu tiên Canon hiện tại; chỉ dùng trạng thái hồ sơ ban đầu khi chưa có projection canon.'
      : 'Tạo outline 10 chương theo cấu trúc 3 hồi. Mỗi chương phải có mục tiêu rõ ràng và tôn trọng Canon hiện tại của nhân vật; chỉ dùng trạng thái hồ sơ ban đầu khi chưa có projection canon.';
    const outlineUserRequest = chapters.length > 0
      ? 'Phân tích metadata dàn ý cho các chương hiện có. Đây là bước đề xuất, không tự viết tiếp hoặc sáng tác lại nội dung.'
      : `Tạo outline 10 chương cho truyện "${currentProject.title}".`;
    const outlineTemplateVariables = {
      genre: currentProject.genre_primary || 'fantasy',
      project_title: currentProject.title,
      project_description: currentProject.description || 'Chưa có',
      character_list: charList || 'Chưa có',
      location_list: locList || 'Chưa có',
      existing_outline: existingOutline,
      outline_task_instruction: outlineTaskInstruction,
      outline_user_request: outlineUserRequest,
    };

    const messages = [
      { role: 'system', content: '' },
      { role: 'user', content: '' },
    ];

    messages[0].content = renderStoryCreationTemplate(
      composeStoryCreationSystemPrompt('outlineGeneration', outlinePrompts.systemPrompt),
      outlineTemplateVariables,
    );
    messages[1].content = renderStoryCreationTemplate(outlinePrompts.userPromptTemplate, outlineTemplateVariables);

    aiService.send({
      taskType: TASK_TYPES.PROJECT_WIZARD,
      messages,
      stream: false,
      onComplete: async (text) => {
        setIsGenerating(false);
        try {
          const parsedValue = parseAIJsonValue(text);
          const normalized = Array.isArray(parsedValue)
            ? { chapters: parsedValue.filter(isPlainObject) }
            : (isPlainObject(parsedValue) ? parsedValue : null);
    if (!normalized) throw new Error('Phản hồi JSON không đúng định dạng.');

          const nextChapters = Array.isArray(normalized.chapters) ? normalized.chapters : [];

          if (chapters.length > 0) {
            const rows = nextChapters
              .slice(0, chapters.length)
              .map((proposal, index) => {
                const chapter = chapters[index];
                const patch = buildChapterAnalysisPatch(proposal);
                return {
                  chapterId: chapter.id,
                  title: chapter.title,
                  index,
                  original: chapter,
                  patch,
                  status: getPatchStatus(chapter, patch),
                };
              });

            if (rows.length === 0) {
              setGenError('AI không trả về đề xuất chương hợp lệ. Dữ liệu dự án chưa thay đổi.');
              return;
            }

            setOutlineAnalysisPreview({
              rows,
              plotThreads: Array.isArray(normalized.plot_threads)
                ? normalized.plot_threads.filter(isPlainObject)
                : [],
            });
            return;
          } else {
            for (const ac of nextChapters) {
              await createChapter(currentProject.id, ac.title, {
                purpose: ac.purpose || '',
                summary: ac.summary || '',
                state_delta: ac.state_delta || '',
                arc_id: ac.act || null,
                ...buildChapterAnchorPatch(ac),
              });
            }

            const nextPlotThreads = Array.isArray(normalized.plot_threads)
              ? normalized.plot_threads.filter(isPlainObject)
              : [];

            for (const pt of nextPlotThreads) {
              if (!pt.title?.trim()) continue;
              await createPlotThread({
                project_id: currentProject.id,
                title: pt.title.trim(),
                type: VALID_THREAD_TYPES.includes(pt.type) ? pt.type : 'subplot',
                description: pt.description || '',
                state: pt.state === 'resolved' ? 'resolved' : 'active',
              });
            }

            await loadPlotThreads(currentProject.id);
          }

          return;
        } catch (e) {
          console.error('[OutlineBoard] AI parse error:', e);
          setGenError('Không parse được phản hồi AI. Dữ liệu dự án chưa thay đổi, hãy thử lại.');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setGenError(toVietnameseErrorMessage(err, 'Lỗi AI'));
      },
    });
  };

  const handleApplyOutlineAnalysis = async () => {
    if (!outlineAnalysisPreview?.rows?.length || isApplyingAnalysis) return;
    setIsApplyingAnalysis(true);
    setGenError(null);

    try {
      for (const row of outlineAnalysisPreview.rows) {
        if (!row.chapterId || Object.keys(row.patch || {}).length === 0) continue;
        await updateChapter(row.chapterId, row.patch);
      }
      setOutlineAnalysisPreview(null);
    } catch (err) {
      console.error('[OutlineBoard] Apply outline analysis failed:', err);
      setGenError(toVietnameseErrorMessage(err, 'Không áp dụng được đề xuất dàn ý.'));
    } finally {
      setIsApplyingAnalysis(false);
    }
  };

  const handleDismissOutlineAnalysis = () => {
    setOutlineAnalysisPreview(null);
  };

  const handleClearAllOutlineMetadata = async () => {
    if (!chapters.length) return;
    const ok = await confirmAction({
      title: 'Xóa toàn bộ dàn ý AI?',
      message: 'Nội dung đã viết, cảnh, tiêu đề và trạng thái chương sẽ được giữ nguyên.',
      confirmLabel: 'Xóa dàn ý',
      danger: true,
    });
    if (!ok) return;

    setOutlineAnalysisPreview(null);
    setGenError(null);
    const patch = buildClearOutlinePatch();
    try {
      for (const chapter of chapters) {
        await updateChapter(chapter.id, patch);
      }
    } catch (err) {
      console.error('[OutlineBoard] Clear outline metadata failed:', err);
      setGenError(toVietnameseErrorMessage(err, 'Không xóa được dàn ý AI.'));
    }
  };

  const handleClearChapterOutlineMetadata = async (chapter) => {
    if (!chapter?.id) return;
    const ok = await confirmAction({
      title: 'Xóa dàn ý AI của chương?',
      message: `"${chapter.title}": nội dung đã viết, cảnh, tiêu đề và trạng thái chương sẽ được giữ nguyên.`,
      confirmLabel: 'Xóa dàn ý',
      danger: true,
    });
    if (!ok) return;

    setOutlineAnalysisPreview(null);
    setGenError(null);
    const patch = buildClearOutlinePatch();
    try {
      await updateChapter(chapter.id, patch);
      setSelectedChapter((current) => (
        current?.id === chapter.id ? { ...current, ...patch } : current
      ));
    } catch (err) {
      console.error('[OutlineBoard] Clear chapter outline metadata failed:', err);
      setGenError(toVietnameseErrorMessage(err, 'Không xóa được dàn ý AI của chương này.'));
    }
  };

  const clearChapterSelection = () => {
    setSelectedChapterIds(new Set());
  };

  const toggleChapterSelectionMode = () => {
    if (selectionMode) {
      clearChapterSelection();
      setSelectionMode(false);
      return;
    }
    if (isMobileLayout) setMobileTab('chapters');
    setSelectionMode(true);
  };

  const toggleChapterSelection = (chapterId) => {
    setSelectedChapterIds((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const handleDeleteChapters = async (chapterIds) => {
    const ids = [...new Set(chapterIds)].filter((id) => chapters.some((chapter) => chapter.id === id));
    if (ids.length === 0 || isDeletingChapters) return false;

    const confirmed = await confirmAction({
      title: ids.length === 1 ? 'Xóa chương?' : `Xóa ${ids.length} chương?`,
      message: ids.length === 1
        ? 'Chương này, tất cả cảnh và nội dung bên trong sẽ bị xóa vĩnh viễn.'
        : `${ids.length} chương, tất cả cảnh và nội dung bên trong sẽ bị xóa vĩnh viễn.`,
      confirmLabel: ids.length === 1 ? 'Xóa chương' : `Xóa ${ids.length} chương`,
      danger: true,
    });
    if (!confirmed) return false;

    setIsDeletingChapters(true);
    setGenError(null);
    try {
      for (const id of ids) {
        await deleteChapter(id);
      }
      setSelectedChapter((current) => (current && ids.includes(current.id) ? null : current));
      setSelectedChapterIds(new Set());
      setSelectionMode(false);
      setChapterNotice(ids.length === 1 ? 'Đã xóa chương.' : `Đã xóa ${ids.length} chương.`);
      return true;
    } catch (err) {
      console.error('[OutlineBoard] Delete chapters failed:', err);
      setGenError(toVietnameseErrorMessage(err, 'Không xóa được chương.'));
      return false;
    } finally {
      setIsDeletingChapters(false);
    }
  };

  // AI Suggest Threads - nhan hint tuy chon tu tac gia
  const handleSuggestThreads = async () => {
    if (!currentProject || isSuggesting) return;
    setIsSuggesting(true);
    setShowSuggestInput(false);

    const synopsisText = currentProject.synopsis || currentProject.description || 'Chưa có';
    const charList = characters.map(formatCharacterForOutlinePrompt).join('\n') || 'Chưa có';
    const chapterList = chapters.length > 0
      ? chapters.map((ch, i) =>
        `${i + 1}. ${ch.title}${ch.purpose ? ' - ' + ch.purpose : ''}${ch.summary ? ': ' + ch.summary : ''}`
      ).join('\n')
      : 'Chưa có';
    const existingThreads = plotThreads.length > 0
      ? plotThreads.map((pt) => `- [${pt.type}] ${pt.title}: ${pt.description || ''}`).join('\n')
      : 'Chưa có';

    const hintSection = suggestHint.trim()
      ? `
Huong di tac gia muon khai thac: ${suggestHint.trim()}
Ưu tiên gợi ý theo hướng này nếu phù hợp với câu chuyện.
`
      : '';

    const storyCreationSettings = getStoryCreationSettings();
    const threadPrompts = storyCreationSettings.threadSuggestion;
    const threadUserRequest = 'Hãy phân tích và gợi ý tuyến truyện mới cho tôi.';
    const threadTemplateVariables = {
      project_title: currentProject.title,
      genre: currentProject.genre_primary || 'Chưa có',
      synopsis: synopsisText,
      character_list: charList,
      chapter_list: chapterList,
      existing_threads: existingThreads,
      hint_section: hintSection,
      thread_user_request: threadUserRequest,
    };

    const messages = [
      { role: 'system', content: '' },
      { role: 'user', content: '' },
    ];

    messages[0].content = renderStoryCreationTemplate(
      composeStoryCreationSystemPrompt('threadSuggestion', threadPrompts.systemPrompt),
      threadTemplateVariables,
    );
    messages[1].content = renderStoryCreationTemplate(threadPrompts.userPromptTemplate, threadTemplateVariables);

    aiService.send({
      taskType: TASK_TYPES.PROJECT_WIZARD,
      messages,
      stream: false,
      onComplete: (text) => {
        setIsSuggesting(false);
        setSuggestHint('');
        try {
          const parsedValue = parseAIJsonValue(text);
          const normalized = isPlainObject(parsedValue) ? parsedValue : null;
    if (!normalized) throw new Error('Phản hồi JSON không đúng định dạng.');

          const suggestions = Array.isArray(normalized.plot_threads)
            ? normalized.plot_threads.filter((pt) => isPlainObject(pt) && pt.title?.trim())
            : [];

          setSuggestedThreads(suggestions);
        } catch (e) {
          console.error('[OutlineBoard] Suggest threads parse error:', e);
        }
      },
      onError: (err) => {
        setIsSuggesting(false);
        console.error('[OutlineBoard] Suggest threads error:', err);
      },
    });
  };

  const handleToggleSuggestInput = () => {
    if (isSuggesting) return;
    setShowSuggestInput(prev => !prev);
  };

  // [MỚI] Gửi bằng Enter (Shift+Enter = xuống dòng)
  const handleSuggestKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSuggestThreads();
    }
    if (e.key === 'Escape') {
      setShowSuggestInput(false);
    }
  };

  // Duyệt một gợi ý
  const handleApproveThread = async (pt, index) => {
    await createPlotThread({
      project_id: currentProject.id,
      title: pt.title.trim(),
      type: VALID_THREAD_TYPES.includes(pt.type) ? pt.type : 'subplot',
      description: pt.description || '',
      state: 'active',
    });
    await loadPlotThreads(currentProject.id);
    setSuggestedThreads(prev => prev.filter((_, i) => i !== index));
  };

  // Bỏ qua một gợi ý
  const handleDismissThread = (index) => {
    setSuggestedThreads(prev => prev.filter((_, i) => i !== index));
  };

  // Xóa tuyến truyện đã chốt
  const handleDeleteThread = async (pt) => {
    const confirmed = await confirmAction({
      title: 'Xóa tuyến truyện?',
      message: `"${pt.title}" và các beat liên quan sẽ bị xóa.`,
      confirmLabel: 'Xóa tuyến truyện',
      danger: true,
    });
    if (!confirmed) return;
    await deletePlotThread(pt.id, currentProject.id);
  };

  // ── Render ──

  if (!currentProject) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="empty-state">
          <Map size={48} />
          <h3>Chọn một dự án trước</h3>
          <p>Quay về Dashboard để chọn hoặc tạo dự án.</p>
        </div>
      </div>
    );
  }

  const renderPreviewValue = (value, fallback = 'Trống') => {
    if (Array.isArray(value)) return value.length ? value.join(', ') : fallback;
    const text = String(value ?? '').trim();
    return text || fallback;
  };

  const renderPreviewBadge = (status) => {
    const labels = {
      new: 'Mới',
      edit: 'Sửa',
      same: 'Không đổi',
    };
    return (
      <span className={`outline-analysis-badge outline-analysis-badge--${status}`}>
        {labels[status] || labels.same}
      </span>
    );
  };

  const renderPreviewField = (row, key, label, formatter = renderPreviewValue) => {
    const hasPatch = Object.prototype.hasOwnProperty.call(row.patch || {}, key);
    const before = key === 'arc_id' ? formatActLabel(row.original?.arc_id) : formatter(row.original?.[key]);
    const after = hasPatch
      ? (key === 'arc_id' ? formatActLabel(row.patch.arc_id) : formatter(row.patch[key]))
      : before;
    const changed = before !== after;

    return (
      <div className="outline-analysis-field">
        <span className="outline-analysis-field__label">{label}</span>
        <span className="outline-analysis-field__before">{truncateText(before, 110)}</span>
        <ArrowRight size={12} />
        <span className={changed ? 'outline-analysis-field__after' : 'outline-analysis-field__same'}>
          {truncateText(after, 130)}
        </span>
      </div>
    );
  };

  const renderOutlineAnalysisPreview = () => {
    if (!outlineAnalysisPreview?.rows?.length) return null;

    const changedCount = outlineAnalysisPreview.rows.filter((row) => Object.keys(row.patch || {}).length > 0).length;
    const suggestedThreadCount = outlineAnalysisPreview.plotThreads?.filter((pt) => pt.title?.trim()).length || 0;

    return (
      <section className="outline-analysis-preview" aria-label="Đề xuất phân tích dàn ý">
        <div className="outline-analysis-preview__head">
          <div>
            <h3><Sparkles size={16} /> Đề xuất phân tích dàn ý</h3>
            <p>
              {changedCount} chương có đề xuất metadata. <strong>Chưa áp dụng</strong> nên dữ liệu dự án chưa đổi.
            </p>
          </div>
          <div className="outline-analysis-preview__actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleApplyOutlineAnalysis}
              disabled={isApplyingAnalysis || changedCount === 0}
            >
              {isApplyingAnalysis ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
              Áp dụng tất cả
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleDismissOutlineAnalysis} disabled={isApplyingAnalysis}>
              <X size={14} /> Bỏ qua
            </button>
          </div>
        </div>

        <div className="outline-analysis-warning">
          <AlertTriangle size={14} />
          AI chỉ đang đề xuất. Plot thread AI trả về không được tự lưu; nếu cần, hãy tạo thủ công ở cột Tuyến truyện.
          {suggestedThreadCount > 0 && <span> Có {suggestedThreadCount} tuyến truyện được AI gợi ý trong phản hồi.</span>}
        </div>

        <div className="outline-analysis-rows">
          {outlineAnalysisPreview.rows.map((row) => (
            <div key={row.chapterId} className="outline-analysis-row">
              <div className="outline-analysis-row__title">
                <span>{row.index + 1}. {row.title}</span>
                {renderPreviewBadge(row.status)}
              </div>
              <div className="outline-analysis-row__fields">
                {renderPreviewField(row, 'purpose', 'Mục tiêu')}
                {renderPreviewField(row, 'summary', 'Tóm tắt')}
                {renderPreviewField(row, 'arc_id', 'Hồi')}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const renderChapterCard = (chapter) => {
    const statusObj = SCENE_STATUSES.find(s => s.value === chapter.status) || SCENE_STATUSES[0];
    const povName = outlineRuntimeIndex.povNameByChapterId.get(chapter.id);
    const locName = outlineRuntimeIndex.locationNameByChapterId.get(chapter.id);
    const sceneCount = outlineRuntimeIndex.sceneCountByChapterId.get(chapter.id) || 0;
    const wordCount = outlineRuntimeIndex.wordCountByChapterId.get(chapter.id) || 0;
    const isDone = chapter.status === 'done';
    const isSelected = selectedChapterIds.has(chapter.id);

    return (
      <div
        key={chapter.id}
        className={`outline-card ${isDone ? 'outline-card--done' : ''} ${selectionMode ? 'outline-card--selecting' : ''} ${isSelected ? 'outline-card--selected' : ''}`}
        onClick={() => {
          if (selectionMode) {
            toggleChapterSelection(chapter.id);
            return;
          }
          setSelectedChapter(chapter);
        }}
      >
        <div className="outline-card-header">
          {selectionMode && (
            <label className="outline-card-select" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleChapterSelection(chapter.id)}
                aria-label={`Chọn ${chapter.title}`}
              />
            </label>
          )}
          <span className="outline-card-title">
            {isDone && <CheckCircle2 size={13} className="outline-card-done-icon" />}
            {chapter.title}
          </span>
          <span className="outline-card-status" style={{ color: statusObj.color }}>
            {statusObj.label}
          </span>
        </div>

        {chapter.purpose && (
          <p className="outline-card-purpose">
            <Target size={11} /> {chapter.purpose}
          </p>
        )}

        {chapter.summary && (
          <p className="outline-card-summary">
            {chapter.summary.substring(0, 80)}{chapter.summary.length > 80 ? '...' : ''}
          </p>
        )}

        <div className="outline-card-meta">
          {povName && (
            <span className="outline-card-tag"><Users size={10} /> {povName}</span>
          )}
          {locName && (
            <span className="outline-card-tag"><MapPin size={10} /> {locName}</span>
          )}
          <span className="outline-card-tag"><FileText size={10} /> {sceneCount} cảnh</span>
          {wordCount > 0 && (
            <span className="outline-card-tag">{wordCount.toLocaleString()} từ</span>
          )}
        </div>

        {!selectionMode && <div className="outline-card-actions" onClick={e => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => goToEditor(chapter.id)} title="Mở editor">
            <PenTool size={12} /> Viết
          </button>
          <button
            className="btn btn-ghost btn-sm outline-card-clear"
            aria-label={`Xóa dàn ý AI của ${chapter.title}`}
            title="Xóa dàn ý AI của riêng chương này"
            onClick={() => handleClearChapterOutlineMetadata(chapter)}
          >
            <Trash2 size={12} /> Xóa dàn ý
          </button>
        </div>}
      </div>
    );
  };

  const renderChapterListItem = (chapter, idx) => {
    const act = ACTS.find((item) => item.id === chapter.arc_id);
    return (
      <div
        className={`outline-list-item ${selectionMode ? 'outline-list-item--selecting' : ''} ${selectedChapterIds.has(chapter.id) ? 'outline-list-item--selected' : ''}`}
        onClick={() => {
          if (selectionMode) {
            toggleChapterSelection(chapter.id);
            return;
          }
          setSelectedChapter(chapter);
        }}
      >
        {selectionMode && (
          <label className="outline-list-select" onClick={event => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={selectedChapterIds.has(chapter.id)}
              onChange={() => toggleChapterSelection(chapter.id)}
              aria-label={`Chọn ${chapter.title}`}
            />
          </label>
        )}
        <span className="outline-list-index">{idx + 1}</span>
        {act ? (
          <span className="outline-list-act" style={{ color: act.color }}>H{act.id}</span>
        ) : (
          <span className="outline-list-act outline-list-act--empty">Chưa</span>
        )}
        <div className="outline-list-content">
          <strong>{chapter.title}</strong>
          {chapter.purpose && <span className="outline-list-purpose"> — {chapter.purpose}</span>}
        </div>
        <span className="outline-list-scenes">{outlineRuntimeIndex.sceneCountByChapterId.get(chapter.id) || 0} cảnh</span>
        {!selectionMode && <button className="btn btn-ghost btn-sm" onClick={event => { event.stopPropagation(); goToEditor(chapter.id); }}>
          <PenTool size={12} />
        </button>}
        {!selectionMode && <button
          className="btn btn-ghost btn-sm outline-list-clear"
          aria-label={`Xóa dàn ý AI của ${chapter.title}`}
          title="Xóa dàn ý AI của riêng chương này"
          onClick={event => {
            event.stopPropagation();
            handleClearChapterOutlineMetadata(chapter);
          }}
        >
          <Trash2 size={12} />
        </button>}
      </div>
    );
  };

  const openThreadModal = (thread) => {
    setEditingThread(thread);
    setShowPlotModal(true);
  };

  const TYPE_LABELS = {
    main: 'Tuyến chính', subplot: 'Tuyến phụ', character_arc: 'Nhân vật',
    mystery: 'Bí ẩn', romance: 'Tình cảm'
  };

  return (
    <div className={`outline-board ${isMobileLayout ? 'outline-board--mobile' : ''}`}>
      {/* Header */}
      <div className="outline-header">
        <div className="outline-header-left">
          <h2><Map size={22} /> Bảng dàn ý</h2>
          <span className="codex-count">{chapters.length} chương</span>
        </div>

        <div className="outline-header-actions">
          <div className="outline-action-group outline-action-group--view">
            <div className="outline-view-toggle">
              <button
                className={`btn btn-ghost btn-sm ${viewMode === 'board' ? 'btn--active' : ''}`}
                onClick={() => setViewMode('board')}
              >
                <LayoutGrid size={14} /> Dạng bảng
              </button>
              <button
                className={`btn btn-ghost btn-sm ${viewMode === 'list' ? 'btn--active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <List size={14} /> Dạng danh sách
              </button>
            </div>
          </div>

          <div className="outline-action-group">
            <button
              className="btn btn-accent btn-sm outline-header-button"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--color-accent-hover), var(--color-accent))', color: '#fff' }}
              onClick={() => setShowArcGen(true)}
              title="Tạo chương tự động"
              aria-label="Tạo chương tự động"
            >
              <Sparkles size={14} /> <span className="outline-action-label">Tạo chương tự động</span>
            </button>

            <button
              className="btn btn-accent btn-sm outline-header-button"
              onClick={handleAIOutline}
              disabled={isGenerating}
              title={chapters.length > 0 ? 'AI Phân tích' : 'AI Outline'}
              aria-label={chapters.length > 0 ? 'AI Phân tích' : 'AI Outline'}
            >
              {isGenerating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              <span className="outline-action-label">
                {chapters.length > 0 ? 'AI Phân tích' : 'AI Outline'}
              </span>
            </button>

            {chapters.length > 0 && (
              <button
                className="btn btn-ghost btn-sm outline-clear-btn outline-clear-all-btn outline-header-button"
                onClick={handleClearAllOutlineMetadata}
                disabled={isGenerating || isApplyingAnalysis}
                title="Xóa metadata dàn ý AI của tất cả chương, không xóa nội dung đã viết"
              >
                <Trash2 size={14} /> <span className="outline-action-label">Xóa toàn bộ dàn ý AI</span>
              </button>
            )}
          </div>

          {chapters.length > 0 && (
            <button
              className={`btn btn-ghost btn-sm outline-header-button ${selectionMode ? 'outline-select-mode-active' : ''}`}
              onClick={toggleChapterSelectionMode}
              title={selectionMode ? 'Đóng chế độ chọn' : 'Chọn nhiều chương'}
              aria-label={selectionMode ? 'Đóng chế độ chọn' : 'Chọn nhiều chương'}
            >
              <CheckSquare size={14} />
              <span className="outline-action-label">
                {selectionMode ? 'Đóng chọn' : 'Chọn nhiều'}
              </span>
            </button>
          )}

          <button className="btn btn-primary btn-sm" onClick={() => handleCreateManualChapter()}>
            <Plus size={15} /> Thêm chương
          </button>
        </div>
      </div>

      {chapterNotice && (
        <div className="outline-action-notice" role="status" aria-live="polite">
          <CheckCircle2 size={14} />
          {chapterNotice}
        </div>
      )}

      {selectionMode && chapters.length > 0 && (
        <div className="outline-bulk-toolbar">
          <strong>{selectedChapterIds.size} chương đã chọn</strong>
          <button className="btn btn-ghost btn-sm bulk-selection-action" onClick={() => setSelectedChapterIds(new Set(chapters.map((chapter) => chapter.id)))}>
            <CheckSquare size={14} /> Chọn tất cả
          </button>
          <button
            className="btn btn-ghost btn-sm bulk-selection-action"
            onClick={clearChapterSelection}
            disabled={selectedChapterIds.size === 0}
          >
            <Square size={14} /> Bỏ chọn
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handleDeleteChapters([...selectedChapterIds])}
            disabled={selectedChapterIds.size === 0 || isDeletingChapters}
          >
            {isDeletingChapters ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            Xóa đã chọn
          </button>
        </div>
      )}

      {isMobileLayout && (
        <div className="outline-mobile-tabs">
          <button
            className={`outline-mobile-tab ${mobileTab === 'chapters' ? 'outline-mobile-tab--active' : ''}`}
            onClick={() => setMobileTab('chapters')}
          >
            Chương
          </button>
          <button
            className={`outline-mobile-tab ${mobileTab === 'threads' ? 'outline-mobile-tab--active' : ''}`}
            onClick={() => setMobileTab('threads')}
          >
            Tuyến truyện
          </button>
          <button
            className={`outline-mobile-tab ${mobileTab === 'auto' ? 'outline-mobile-tab--active' : ''}`}
            onClick={() => setMobileTab('auto')}
          >
            Tự động
          </button>
        </div>
      )}

      <div className={`outline-layout ${isMobileLayout ? `outline-layout--mobile-${mobileTab}` : ''}`}>
        {isMobileLayout && mobileTab === 'auto' && (
          <div className="outline-mobile-auto">
            <div className="outline-mobile-auto-card">
              <Sparkles size={22} />
              <div>
                <h3>Tạo chương tự động</h3>
                <p>Sinh dàn ý theo đợt, kiểm tra cảnh báo và tạo bản nháp mẫu khi cần.</p>
              </div>
              <button className="btn btn-accent" onClick={() => setShowArcGen(true)}>
                Mở công cụ
              </button>
            </div>
            <div className="outline-mobile-auto-card">
              <Map size={22} />
              <div>
                <h3>AI phân tích dàn ý</h3>
                <p>Tạo đề xuất từ nội dung đã viết. Bạn xem trước rồi mới áp dụng.</p>
              </div>
              <button className="btn btn-secondary" onClick={handleAIOutline} disabled={isGenerating}>
                {isGenerating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                Chạy AI
              </button>
            </div>
            {chapters.length > 0 && (
              <div className="outline-mobile-auto-card">
                <Trash2 size={22} />
                <div>
                  <h3>Xóa toàn bộ dàn ý AI</h3>
                  <p>Gỡ metadata dàn ý sai, giữ nguyên tiêu đề, cảnh, nội dung đã viết và trạng thái.</p>
                </div>
                <button className="btn btn-ghost" onClick={handleClearAllOutlineMetadata} disabled={isGenerating || isApplyingAnalysis}>
                  Xóa toàn bộ
                </button>
              </div>
            )}
            {renderOutlineAnalysisPreview()}
            <div className="outline-mobile-validator-note">
              Trình kiểm tra sẽ hiện cảnh báo ngắn. Nếu bản nháp bị chặn, bạn vẫn có thể lưu dàn ý để sửa tiếp.
            </div>
          </div>
        )}
        <div className="outline-main">
          {genError && (
            <div className="outline-error">{genError}</div>
          )}

          {!(isMobileLayout && mobileTab === 'auto') && renderOutlineAnalysisPreview()}

          {chapters.length === 0 ? (
            <div className="empty-state">
              <Map size={48} />
              <h3>Chưa có outline</h3>
              <p>Thêm chương thủ công hoặc dùng AI tạo outline 10 chương.</p>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button className="btn btn-accent" onClick={handleAIOutline} disabled={isGenerating}>
                  {isGenerating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                  AI tạo outline
                </button>
                <button className="btn btn-primary" onClick={() => handleCreateManualChapter()}>
                  <Plus size={16} /> Thêm chương
                </button>
              </div>
            </div>
          ) : viewMode === 'board' ? (
            <div className="outline-board-view">
              {chaptersByAct.unassigned.length > 0 && (
                <section className="outline-unassigned-strip" aria-label="Chương chưa gán hồi">
                  <div className="outline-unassigned-head">
                    <div>
                      <h3>Chưa gán hồi</h3>
                      <p>Bấm vào chương để chọn hồi hoặc chỉnh thông tin dàn ý.</p>
                    </div>
                    <span>{chaptersByAct.unassigned.length} chương</span>
                  </div>
                  <VirtualOutlineGrid
                    className="outline-unassigned-list"
                    items={chaptersByAct.unassigned}
                    minColumnWidth={260}
                    estimateSize={() => 190}
                    renderItem={renderChapterCard}
                    scrollElementMode={isMobileLayout ? 'ancestor' : 'self'}
                  />
                </section>
              )}

              <div className="outline-lanes">
                {ACTS.map(act => (
                  <div key={act.id} className="outline-lane">
                    <div className="outline-lane-header" style={{ borderColor: act.color }}>
                      <div>
                        <h3 className="outline-lane-title" style={{ color: act.color }}>{act.label}</h3>
                        <span className="outline-lane-desc">{act.desc}</span>
                      </div>
                      <span className="outline-lane-percent">{act.percent}</span>
                    </div>

                    <VirtualOutlineStack
                      className="outline-lane-body"
                      items={chaptersByAct[act.id]}
                      estimateSize={() => 190}
                      renderItem={renderChapterCard}
                      scrollElementMode={isMobileLayout ? 'ancestor' : 'self'}
                      footer={<button className="outline-add-card" onClick={() => addChapterToAct(act.id)}>
                        <Plus size={14} /> Thêm vào {act.label.split('—')[0].trim()}
                      </button>}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <VirtualOutlineStack
              className="outline-list"
              items={chapters}
              estimateSize={() => 64}
              renderItem={renderChapterListItem}
              scrollElementMode={isMobileLayout ? 'ancestor' : 'self'}
              rowGap={8}
            />
          )}
        </div>

        {/* ── Plot Threads Sidebar ── */}
        <div className="outline-plot-sidebar">
          <div className="plot-sidebar-header">
            <h3><Combine size={16} /> Tuyến truyện</h3>
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              {/* Nút Sparkles — toggle input */}
              <button
                className={`btn btn-ghost btn-icon btn-sm ${showSuggestInput ? 'btn--active' : ''}`}
                onClick={handleToggleSuggestInput}
                disabled={isSuggesting}
                title="AI gợi ý tuyến truyện mới"
              >
                {isSuggesting
                  ? <Loader2 size={15} className="spin" />
                  : <Sparkles size={15} />
                }
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => openThreadModal(null)}
                title="Thêm tuyến truyện"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* [MỚI] Suggest input — slide down khi showSuggestInput = true */}
          {showSuggestInput && (
            <div className="plot-suggest-input-bar">
              <textarea
                ref={suggestTextareaRef}
                className="plot-suggest-textarea"
                rows={2}
                value={suggestHint}
                onChange={e => setSuggestHint(e.target.value)}
                onKeyDown={handleSuggestKeyDown}
                placeholder="Hướng đi bạn muốn AI khai thác... (không bắt buộc)"
              />
              <button
                className="btn btn-accent btn-sm plot-suggest-send"
                onClick={handleSuggestThreads}
                disabled={isSuggesting}
                title="Gửi (Enter)"
              >
                <ArrowRight size={14} />
              </button>
              <p className="plot-suggest-hint">
                Để trống → AI tự phân tích khoảng trống.<br />
                Shift+Enter để xuống dòng · Esc để đóng.
              </p>
            </div>
          )}

          <div className="plot-sidebar-body">
            {/* Suggested threads — hiển thị phía trên danh sách đã chốt */}
            {suggestedThreads.length > 0 && (
              <div className="plot-suggestions-section">
                <div className="plot-suggestions-label">
                  <Sparkles size={11} /> Gợi ý từ AI — chờ duyệt
                </div>
                {suggestedThreads.map((pt, index) => (
                  <div
                    key={index}
                    className={`plot-thread-card plot-thread-card--suggested plot-thread-card--${pt.type || 'subplot'}`}
                  >
                    <div className="plot-thread-title" title={pt.title}>{pt.title}</div>
                    <div className="plot-thread-meta">
                      <span className="plot-thread-badge">{TYPE_LABELS[pt.type] || pt.type}</span>
                    </div>
                    {pt.description && (
                      <p className="plot-thread-desc">{pt.description}</p>
                    )}
                    <div className="plot-thread-suggestion-actions">
                      <button className="btn btn-xs btn-accent" onClick={() => handleApproveThread(pt, index)}>
                        <CheckCircle2 size={11} /> Duyệt
                      </button>
                      <button className="btn btn-xs btn-ghost" onClick={() => handleDismissThread(index)}>
                        <X size={11} /> Bỏ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Danh sách tuyến truyện đã chốt */}
            {plotThreads.length === 0 && suggestedThreads.length === 0 ? (
              <div className="text-muted" style={{ fontSize: '13px', textAlign: 'center', marginTop: 'var(--space-4)' }}>
                Chưa có Tuyến truyện.<br /><br /> Hãy tạo để AI nhớ các diễn biến mạch truyện vĩ mô.
              </div>
            ) : (
              plotThreads.map(pt => (
                <div
                  key={pt.id}
                  className={`plot-thread-card plot-thread-card--${pt.type} plot-thread-card--${pt.state}`}
                  onClick={() => openThreadModal(pt)}
                >
                  <div className="plot-thread-title" title={pt.title}>{pt.title}</div>
                  <div className="plot-thread-meta">
                    <span className="plot-thread-badge">{TYPE_LABELS[pt.type] || pt.type}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {pt.state === 'resolved' && <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} />}
                      {pt.state === 'active' && <GitPullRequest size={12} style={{ color: 'var(--color-accent)' }} />}
                      <button
                        className="btn btn-ghost btn-icon"
                        style={{ width: '18px', height: '18px', padding: 0, opacity: 0.4 }}
                        title="Xóa tuyến truyện"
                        onClick={e => { e.stopPropagation(); handleDeleteThread(pt); }}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedChapter && (
        <ChapterDetailModal
          chapter={selectedChapter}
          scenes={scenes.filter(s => s.chapter_id === selectedChapter.id)}
          characters={characters}
          locations={locations}
          onClose={() => setSelectedChapter(null)}
          onGoEditor={() => goToEditor(selectedChapter.id)}
          onDelete={() => handleDeleteChapters([selectedChapter.id])}
          deleting={isDeletingChapters}
        />
      )}

      {showPlotModal && (
        <PlotThreadModal
          projectId={currentProject.id}
          thread={editingThread}
          onClose={() => setShowPlotModal(false)}
        />
      )}

      {showArcGen && (
        <ArcGenerationModal
          projectId={currentProject.id}
          genre={currentProject.genre_primary}
          currentChapterCount={chapters.length}
          onClose={() => setShowArcGen(false)}
        />
      )}
    </div>
  );
}
