import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import db from '../../services/db/database';
import CodexPanel from '../editor/CodexPanel';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import { normalizeChapterListField } from '../../services/ai/blueprintGuardrails';
import {
  PenTool,
  RefreshCw,
  Maximize2,
  Lightbulb,
  Map as MapIcon,
  Sparkles,
  Send,
  Square,
  Copy,
  Check,
  Trash2,
  ArrowDownToLine,
  BookKey,
  X,
  ShieldAlert,
  Loader2,
  Replace,
  Bookmark,
} from 'lucide-react';
import ProjectContentModeControl from '../../features/projectContentMode/ProjectContentModeControl.jsx';
import useProjectContentMode from '../../features/projectContentMode/useProjectContentMode.js';
import { loadCanonPack } from '../../services/labLite/canonPackRepository.js';
import { runCanonReview, abortCanonReview } from '../../services/labLite/canonReview.js';
import {
  listCanonReviewItems,
  saveCanonReviewItem,
  updateCanonReviewItem,
} from '../../services/labLite/labLiteDb.js';
import {
  CONTENT_MODE_QUICK_ACTION_ID,
  getWriterQuickActionOrder,
} from './quickActionLayout.js';
import './AISidebar.css';

const PROSE_INSERT_TASKS = ['continue', 'free_prompt'];
const PROSE_REPLACE_TASKS = ['rewrite', 'expand'];
const PROSE_OUTPUT_TASKS = new Set([...PROSE_INSERT_TASKS, ...PROSE_REPLACE_TASKS]);
const NON_DRAFT_PREVIEW_TASKS = new Set(['plot', 'outline', 'extract', 'conflict']);
const CHAPTER_SCOPED_OUTPUT_TASKS = new Set(['plot', 'outline']);
const MOBILE_AI_TABS = [
  { id: 'ai', label: 'AI' },
  { id: 'codex', label: 'Codex' },
  { id: 'results', label: 'Kết quả' },
];

const QUICK_ACTIONS = [
  { id: 'continue', icon: PenTool, label: 'Viết tiếp', taskFn: 'continueWriting', needsText: true, needsGuidance: true, placeholder: 'VD: "Nhân vật gặp phục kích", "Chuyển cảnh sang nhân vật phụ"...' },
  { id: 'rewrite', icon: RefreshCw, label: 'Viết lại', taskFn: 'rewriteText', needsSelection: true, needsGuidance: true, placeholder: 'VD: "Thêm drama hơn", "Giọng văn trang trọng hơn"...' },
  { id: 'expand', icon: Maximize2, label: 'Mở rộng', taskFn: 'expandText', needsSelection: true, needsGuidance: true, placeholder: 'VD: "Mở rộng phần chiến đấu", "Thêm nội tâm nhân vật"...' },
  { id: 'plot', icon: Lightbulb, label: 'Gợi ý tình tiết', taskFn: 'suggestPlot', needsText: true },
  { id: 'outline', icon: MapIcon, label: 'Dan y chuong', taskFn: 'outlineChapter', needsText: false },
  { id: 'extract', icon: Sparkles, label: 'Trích xuất', taskFn: 'extractTerms', needsText: true },
  { id: 'conflict', icon: ShieldAlert, label: 'Check Mâu Thuẫn', taskFn: 'checkConflict', needsText: true, isCustom: true },
];
const QUICK_ACTIONS_BY_ID = Object.fromEntries(QUICK_ACTIONS.map((action) => [action.id, action]));

function buildPlotSuggestionTitle(text, fallbackIndex = 0) {
  const cleaned = String(text || '')
    .replace(/^\*{0,2}\d+[\.\):\-]*\*{0,2}\s*/, '')
    .replace(/^[-*]\s*/, '')
    .trim();

  if (!cleaned) return `Huong ${fallbackIndex + 1}`;

  const firstLine = cleaned.split('\n').find((line) => line.trim()) || cleaned;
  const shortTitle = firstLine
    .replace(/^([A-Z\s]+:)\s*/i, '')
    .split(/[.!?]/)[0]
    .trim();

  return shortTitle || `Huong ${fallbackIndex + 1}`;
}

function normalizePlotSuggestion(rawSuggestion, index = 0) {
  if (!rawSuggestion) return null;

  if (typeof rawSuggestion === 'string') {
    const summary = rawSuggestion.trim();
    if (!summary) return null;
    const title = buildPlotSuggestionTitle(summary, index);
    return {
      id: `plot-${index}-${title}`,
      title,
      summary,
      guidance: summary,
      fullText: summary,
      type: 'main',
    };
  }

  if (typeof rawSuggestion !== 'object') return null;

  const title = String(
    rawSuggestion.title
    || rawSuggestion.suggested_value
    || rawSuggestion.label
    || ''
  ).trim();
  const summary = String(
    rawSuggestion.summary
    || rawSuggestion.reasoning
    || rawSuggestion.description
    || rawSuggestion.current_value
    || ''
  ).trim();
  const guidance = String(
    rawSuggestion.guidance
    || rawSuggestion.direction
    || summary
    || title
  ).trim();
  const resolvedTitle = title || buildPlotSuggestionTitle(summary || guidance, index);
  const resolvedSummary = summary || guidance || resolvedTitle;

  return {
    id: rawSuggestion.id || `plot-${index}-${resolvedTitle}`,
    title: resolvedTitle,
    summary: resolvedSummary,
    guidance: guidance || resolvedSummary,
    fullText: [resolvedTitle, resolvedSummary].filter(Boolean).join(': '),
    type: rawSuggestion.type || rawSuggestion.fact_type || 'main',
  };
}

function splitPlotSuggestionBlocks(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return [];

  const headingRegex = /(?:^|\n)(?:#{1,6}\s*)?(?:\*{0,2})Hướng\s*\d+[^\n]*/gim;
  const matches = [...text.matchAll(headingRegex)];
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const end = index + 1 < matches.length
      ? matches[index + 1].index
      : text.length;
    return text.slice(start, end).trim();
  }).filter(Boolean);
}

function parsePlotSuggestions(rawText = '') {
  const headingBlocks = splitPlotSuggestionBlocks(rawText);
  if (headingBlocks.length > 0) {
    return headingBlocks
      .map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        const firstLine = lines[0] || '';
        const title = firstLine
          .replace(/^(?:#{1,6}\s*)?(?:\*{0,2})?Hướng\s*\d+\s*:\s*/i, '')
          .replace(/^(?:#{1,6}\s*)?(?:\*{0,2})?Hướng\s*\d+\s*/i, '')
          .trim() || `Huong ${index + 1}`;
        const summary = lines.slice(1).join('\n').trim();
        return normalizePlotSuggestion({
          id: `plot-${index}-${title}`,
          title,
          summary: summary || title,
          guidance: [title, summary].filter(Boolean).join('\n'),
        }, index);
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  return rawText
    .split(/\n(?=(?:\*{0,2})?\d+[\)\.\:]|(?:^|\n)[-*]\s|(?:^|\n)\*{2}[^\*])/m)
    .map((entry, index) => normalizePlotSuggestion(entry, index))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeOutlineBeat(rawBeat, index = 0) {
  if (!rawBeat) return null;
  if (typeof rawBeat === 'string') {
    const text = rawBeat.trim();
    if (!text) return null;
    return {
      id: `outline-beat-${index}`,
      title: `Beat ${index + 1}`,
      beat: text,
      status: '',
      evidence: '',
      characterChange: '',
      thread: '',
      boundaryReason: '',
    };
  }
  if (!isPlainObject(rawBeat)) return null;

  const title = String(rawBeat.title || rawBeat.label || `Beat ${index + 1}`).trim();
  const beat = String(rawBeat.beat || rawBeat.description || rawBeat.summary || '').trim();

  return {
    id: rawBeat.id || `outline-beat-${index}-${title}`,
    title,
    beat,
    status: String(rawBeat.status || '').trim(),
    evidence: String(rawBeat.evidence || '').trim(),
    characterChange: String(rawBeat.character_change || rawBeat.characterChange || '').trim(),
    thread: String(rawBeat.thread || '').trim(),
    boundaryReason: String(rawBeat.boundary_reason || rawBeat.boundaryReason || '').trim(),
  };
}

function normalizeOutlineResult(rawText = '') {
  if (!rawText) return null;

  try {
    const parsed = parseAIJsonValue(rawText);
    if (!isPlainObject(parsed)) return null;

    const chapterPatchSource = isPlainObject(parsed.chapter_patch) ? parsed.chapter_patch : {};
    const chapterPatch = {
      purpose: String(chapterPatchSource.purpose || parsed.purpose || '').trim(),
      summary: String(chapterPatchSource.summary || parsed.summary || '').trim(),
      key_events: normalizeChapterListField(chapterPatchSource.key_events || chapterPatchSource.keyEvents || []),
      thread_titles: normalizeChapterListField(chapterPatchSource.thread_titles || chapterPatchSource.threadTitles || []),
      featured_characters: normalizeChapterListField(chapterPatchSource.featured_characters || chapterPatchSource.featuredCharacters || []),
      primary_location: String(chapterPatchSource.primary_location || chapterPatchSource.primaryLocation || '').trim(),
      required_factions: normalizeChapterListField(chapterPatchSource.required_factions || chapterPatchSource.requiredFactions || []),
      required_objects: normalizeChapterListField(chapterPatchSource.required_objects || chapterPatchSource.requiredObjects || []),
      required_terms: normalizeChapterListField(chapterPatchSource.required_terms || chapterPatchSource.requiredTerms || []),
    };

    return {
      mode: String(parsed.mode || '').trim(),
      purpose: String(parsed.purpose || chapterPatch.purpose || '').trim(),
      summary: String(parsed.summary || chapterPatch.summary || '').trim(),
      completedBeats: Array.isArray(parsed.completed_beats)
        ? parsed.completed_beats.map((item, index) => normalizeOutlineBeat(item, index)).filter(Boolean)
        : [],
      nextBeats: Array.isArray(parsed.next_beats)
        ? parsed.next_beats.map((item, index) => normalizeOutlineBeat(item, index)).filter(Boolean)
        : [],
      progressWarning: String(parsed.progress_warning || '').trim(),
      transitionNote: String(parsed.transition_note || '').trim(),
      chapterPatch,
      raw: parsed,
    };
  } catch {
    return null;
  }
}

function hasOutlinePatchData(chapterPatch = {}) {
  return Boolean(
    chapterPatch?.purpose
    || chapterPatch?.summary
    || chapterPatch?.primary_location
    || (Array.isArray(chapterPatch?.key_events) && chapterPatch.key_events.length > 0)
    || (Array.isArray(chapterPatch?.thread_titles) && chapterPatch.thread_titles.length > 0)
    || (Array.isArray(chapterPatch?.featured_characters) && chapterPatch.featured_characters.length > 0)
    || (Array.isArray(chapterPatch?.required_factions) && chapterPatch.required_factions.length > 0)
    || (Array.isArray(chapterPatch?.required_objects) && chapterPatch.required_objects.length > 0)
    || (Array.isArray(chapterPatch?.required_terms) && chapterPatch.required_terms.length > 0)
  );
}

function autosizeTextarea(textarea) {
  if (!textarea) return;

  textarea.style.height = 'auto';
  const computed = window.getComputedStyle(textarea);
  const maxHeight = Number.parseInt(computed.maxHeight, 10) || 160;
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function buildOutputScope(context = {}, taskId = null) {
  return {
    projectId: context.projectId || null,
    chapterId: context.chapterId || null,
    sceneId: context.sceneId || null,
    taskId,
    scopeLevel: CHAPTER_SCOPED_OUTPUT_TASKS.has(taskId) ? 'chapter' : 'scene',
    createdAt: Date.now(),
  };
}

export default function AISidebar({
  editor,
  isMobileLayout = false,
  mobileTab = 'ai',
  onMobileTabChange,
  onMobileInputFocusChange,
  onDraftPreviewChange,
  onAiActivityChange,
}) {
  const navigate = useNavigate();
  const {
    isStreaming,
    streamingText,
    completedText,
    error,
    outputScope,
    lastTaskId,
    lastRouteInfo,
    lastElapsed,
    abort,
    clearOutput,
    setOutputTracking,
    continueWriting,
    rewriteText,
    expandText,
    suggestPlot,
    outlineChapter,
    extractTerms,
    freePrompt,
    checkConflict,
    isCheckingConflict,
  } = useAIStore();

  const {
    currentProject,
    scenes,
    activeSceneId,
    chapters,
    activeChapterId,
    updateChapter,
  } = useProjectStore();
  const { contentMode, setContentMode } = useProjectContentMode();

  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionGuidance, setActionGuidance] = useState('');
  const [plotSuggestions, setPlotSuggestions] = useState([]);
  const [showPlotManager, setShowPlotManager] = useState(false);
  const [showPlotAssistPicker, setShowPlotAssistPicker] = useState(false);
  const [mobileOverlayTop, setMobileOverlayTop] = useState(0);
  const [outlineApplyState, setOutlineApplyState] = useState('idle');
  const [linkedCanonPack, setLinkedCanonPack] = useState(null);
  const [canonReviewMode, setCanonReviewMode] = useState('standard');
  const [canonReviewState, setCanonReviewState] = useState({ status: 'idle', error: null });
  const [canonReviewItems, setCanonReviewItems] = useState([]);
  const outputRef = useRef(null);
  const guidanceRef = useRef(null);
  const customPromptRef = useRef(null);
  const mobileAiRef = useRef(null);
  const quickActionsRef = useRef(null);
  const actionButtonRefs = useRef(new Map());

  useEffect(() => {
    if (activeChapterId) {
      db.getPlotSuggestions(activeChapterId)
        .then((suggestions) => {
          setPlotSuggestions(
            suggestions
              .map((item, index) => normalizePlotSuggestion(item, index))
              .filter(Boolean)
              .slice(0, 3),
          );
        })
        .catch(() => setPlotSuggestions([]));
    } else {
      setPlotSuggestions([]);
    }
  }, [activeChapterId]);

  useEffect(() => {
    const packId = currentProject?.source_canon_pack_id;
    if (!packId || !['fanfic', 'rewrite', 'translation_context'].includes(currentProject?.project_mode)) {
      setLinkedCanonPack(null);
      return;
    }
    let canceled = false;
    loadCanonPack(packId)
      .then((pack) => {
        if (!canceled) setLinkedCanonPack(pack || null);
      })
      .catch(() => {
        if (!canceled) setLinkedCanonPack(null);
      });
    return () => {
      canceled = true;
    };
  }, [currentProject?.source_canon_pack_id, currentProject?.project_mode]);

  useEffect(() => {
    if (!currentProject?.id || !linkedCanonPack?.id) {
      setCanonReviewItems([]);
      return;
    }
    let canceled = false;
    listCanonReviewItems({
      projectId: currentProject.id,
      canonPackId: linkedCanonPack.id,
    })
      .then((items) => {
        if (!canceled) setCanonReviewItems(items.slice(0, 8));
      })
      .catch(() => {
        if (!canceled) setCanonReviewItems([]);
      });
    return () => {
      canceled = true;
    };
  }, [currentProject?.id, linkedCanonPack?.id, activeChapterId, activeSceneId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingText, completedText]);

  useEffect(() => {
    if (!isStreaming && !isCheckingConflict && activeAction) {
      setActiveAction(null);
    }
  }, [isStreaming, isCheckingConflict, activeAction]);

  const displayText = streamingText || completedText;
  const hasOutput = !!displayText || !!error || isStreaming || isCheckingConflict;
  const isOutputForActiveScope = (() => {
    if (!hasOutput) return true;
    if (!outputScope) return false;
    if (outputScope.projectId && currentProject?.id && outputScope.projectId !== currentProject.id) return false;
    if (outputScope.chapterId && activeChapterId && outputScope.chapterId !== activeChapterId) return false;
    if (outputScope.scopeLevel === 'scene' && outputScope.sceneId && activeSceneId && outputScope.sceneId !== activeSceneId) return false;
    return true;
  })();
  const scopedDisplayText = isOutputForActiveScope ? displayText : '';
  const scopedError = isOutputForActiveScope ? error : null;
  const scopedIsStreaming = isOutputForActiveScope && isStreaming;
  const scopedIsCheckingConflict = isOutputForActiveScope && isCheckingConflict;
  const scopedHasOutput = !!scopedDisplayText || !!scopedError || scopedIsStreaming || scopedIsCheckingConflict;
  const scopedTaskId = outputScope?.taskId || lastTaskId;
  const canApplyOutputToActiveEditor = !!editor && isOutputForActiveScope && outputScope?.scopeLevel === 'scene';
  const parsedOutlineResult = scopedTaskId === 'outline' && !scopedIsStreaming && !scopedError
    ? normalizeOutlineResult(scopedDisplayText)
    : null;

  useEffect(() => {
    setOutlineApplyState('idle');
  }, [scopedTaskId, scopedDisplayText, activeChapterId]);

  useEffect(() => {
    if (!onAiActivityChange) return;

    const isProseTask = outputScope?.taskId && PROSE_OUTPUT_TASKS.has(outputScope.taskId);
    if (isStreaming && isProseTask && outputScope?.chapterId) {
      onAiActivityChange({
        running: true,
        projectId: outputScope.projectId || null,
        chapterId: outputScope.chapterId,
        sceneId: outputScope.sceneId || null,
        taskId: outputScope.taskId,
        scopeLevel: outputScope.scopeLevel,
      });
      return;
    }

    onAiActivityChange(null);
  }, [
    onAiActivityChange,
    isStreaming,
    outputScope?.projectId,
    outputScope?.chapterId,
    outputScope?.sceneId,
    outputScope?.taskId,
    outputScope?.scopeLevel,
  ]);

  useEffect(() => {
    if (!isMobileLayout || !scopedHasOutput || !onMobileTabChange) return;
    onMobileTabChange('results');
  }, [isMobileLayout, scopedHasOutput, onMobileTabChange]);

  useEffect(() => {
    autosizeTextarea(customPromptRef.current);
  }, [customPrompt, isMobileLayout]);

  useEffect(() => {
    autosizeTextarea(guidanceRef.current);
  }, [actionGuidance, pendingAction]);

  useEffect(() => {
    setShowPlotAssistPicker(false);
  }, [pendingAction?.id, activeChapterId]);

  const currentPinnedActionId = pendingAction?.id || (showPlotManager ? 'plot' : null);

  useLayoutEffect(() => {
    if (!isMobileLayout || mobileTab !== 'ai' || !currentPinnedActionId) {
      setMobileOverlayTop(0);
      return;
    }

    const measure = () => {
      const container = mobileAiRef.current;
      const grid = quickActionsRef.current;
      const actionButton = actionButtonRefs.current.get(currentPinnedActionId);
      if (!container || !grid || !actionButton) return;

      const containerRect = container.getBoundingClientRect();
      const buttonRect = actionButton.getBoundingClientRect();
      const overlayTop = Math.max(0, Math.round((buttonRect.bottom - containerRect.top) + 12));
      setMobileOverlayTop(overlayTop);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isMobileLayout, mobileTab, currentPinnedActionId]);

  useEffect(() => {
    if (!onDraftPreviewChange) return;

    if (!scopedDisplayText || !outputScope?.sceneId || scopedIsCheckingConflict || scopedError || !isOutputForActiveScope) {
      onDraftPreviewChange(null);
      return;
    }

    if (scopedTaskId && NON_DRAFT_PREVIEW_TASKS.has(scopedTaskId)) {
      onDraftPreviewChange(null);
      return;
    }

    onDraftPreviewChange({
      sceneId: outputScope.sceneId,
      chapterId: outputScope.chapterId || null,
      taskId: scopedTaskId,
      text: scopedDisplayText,
      isStreaming: scopedIsStreaming,
    });
  }, [
    onDraftPreviewChange,
    scopedDisplayText,
    scopedIsStreaming,
    scopedIsCheckingConflict,
    scopedError,
    scopedTaskId,
    outputScope,
    isOutputForActiveScope,
  ]);

  const getContext = () => {
    const scene = scenes.find((item) => item.id === activeSceneId);
    const chapter = chapters.find((item) => item.id === activeChapterId);
    const chapterScenes = scenes
      .filter((item) => item.chapter_id === activeChapterId)
      .slice()
      .sort((left, right) => (left.order_index || 0) - (right.order_index || 0));
    const chapterText = chapterScenes
      .map((item) => item?.draft_text || item?.final_text || '')
      .join('\n\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();
    const selectedText = editor?.state?.selection?.empty
      ? ''
      : editor?.state?.doc?.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        ' ',
      ) || '';

    return {
      selectedText,
      sceneText: scene?.draft_text?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim() || '',
      sceneTitle: scene?.title || '',
      chapterTitle: chapter?.title || '',
      projectTitle: currentProject?.title || '',
      genre: currentProject?.genre_primary || '',
      projectId: currentProject?.id || null,
      chapterId: activeChapterId || null,
      sceneId: activeSceneId || null,
      chapterIndex: chapter ? chapters.indexOf(chapter) : 0,
      chapterText,
      chapterSceneCount: chapterScenes.length,
    };
  };

  const executeAction = (action, guidance) => {
    const context = getContext();

    if (action.needsSelection && !context.selectedText) {
      context.selectedText = context.sceneText;
    }
    if (action.needsText && !context.sceneText && !context.selectedText) {
      return;
    }

    if (guidance.trim()) {
      context.userPrompt = guidance.trim();
    }

    setPendingAction(null);
    setActionGuidance('');
    setActiveAction(action.id);
    const nextOutputScope = buildOutputScope(context, action.id);
    setOutputTracking({
      taskId: action.id,
      outputScope: nextOutputScope,
    });
    context.outputScope = nextOutputScope;

    if (action.isCustom && action.id === 'conflict') {
      handleCheckConflict(context);
      return;
    }

    const taskFns = { continueWriting, rewriteText, expandText, suggestPlot, outlineChapter, extractTerms };
    const fn = taskFns[action.taskFn];
    if (fn) fn(context);
  };

  const handleQuickAction = (action) => {
    if (action.id !== 'plot' && showPlotManager) {
      setShowPlotManager(false);
    }

    if (action.id === 'plot' && plotSuggestions.length > 0 && !isStreaming) {
      setPendingAction(null);
      setShowPlotManager(true);
      return;
    }

    if (action.needsGuidance && !isStreaming) {
      setShowPlotManager(false);
      setPendingAction(action);
      setActionGuidance('');
      setTimeout(() => guidanceRef.current?.focus(), 50);
      return;
    }

    executeAction(action, '');
  };

  const handleCheckConflict = async (context) => {
    try {
      clearOutput();
      setOutputTracking({
        taskId: 'conflict',
        outputScope: context.outputScope || buildOutputScope(context, 'conflict'),
      });
      useAIStore.setState({ streamingText: 'Đang kiểm tra mâu thuẫn cốt truyện...' });

      const result = await checkConflict(context);
      let outputText = '';
      if (result?.conflicts?.length > 0) {
        outputText = '⚠️ PHÁT HIỆN MÂU THUẪN:\n\n';
        result.conflicts.forEach((conflict, index) => {
          outputText += `${index + 1}. [${(conflict.severity || 'medium').toUpperCase()}] ${conflict.description}\n`;
          if (conflict.suggestion) outputText += `   Gợi ý: ${conflict.suggestion}\n`;
          outputText += '\n';
        });
      } else {
        outputText = '✅ Không phát hiện mâu thuẫn logic nào trong nội dung này.';
      }
      useAIStore.setState({ streamingText: '', completedText: outputText });
    } catch (err) {
      useAIStore.setState({ streamingText: '', error: `Lỗi kiểm tra mâu thuẫn: ${err.message}` });
    }
  };

  const handleFreePrompt = (event) => {
    event.preventDefault();
    if (!customPrompt.trim()) return;
    const context = getContext();
    context.userPrompt = customPrompt.trim();
    const nextOutputScope = buildOutputScope(context, 'free_prompt');
    setOutputTracking({
      taskId: 'free_prompt',
      outputScope: nextOutputScope,
    });
    context.outputScope = nextOutputScope;
    freePrompt(context);
    setCustomPrompt('');
  };

  const handleCopy = () => {
    const text = scopedDisplayText;
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const textToHtml = (text) => (
    text
      .split(/\n\n+/)
      .filter((paragraph) => paragraph.trim())
      .map((paragraph) => {
        const escaped = paragraph
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        return `<p>${escaped}</p>`;
      })
      .join('')
  );

  const handleInsertToEditor = () => {
    const text = scopedDisplayText;
    if (text && canApplyOutputToActiveEditor && editor) {
      editor.chain().focus().insertContent(textToHtml(text)).run();
      clearOutput();
    }
  };

  const handleReplaceEditor = () => {
    const text = scopedDisplayText;
    if (text && canApplyOutputToActiveEditor && editor) {
      editor.chain().focus().selectAll().deleteSelection().insertContent(textToHtml(text)).run();
      clearOutput();
    }
  };

  const refreshCanonReviewItems = async () => {
    if (!currentProject?.id || !linkedCanonPack?.id) return [];
    const items = await listCanonReviewItems({
      projectId: currentProject.id,
      canonPackId: linkedCanonPack.id,
    });
    setCanonReviewItems(items.slice(0, 8));
    return items;
  };

  const handleRunCanonReview = async () => {
    if (!linkedCanonPack || canonReviewState.status === 'running') return;
    const context = getContext();
    const textForReview = context.selectedText || context.sceneText || context.chapterText;
    if (!textForReview) {
      setCanonReviewState({ status: 'error', error: 'Chưa có nội dung để kiểm tra.' });
      return;
    }

    setCanonReviewState({ status: 'running', error: null });
    try {
      const result = await runCanonReview({
        mode: canonReviewMode,
        canonPack: linkedCanonPack,
        project: currentProject,
        newText: textForReview,
        currentChapterText: canonReviewMode === 'quick' ? '' : context.chapterText,
        currentChapterOutline: {
          title: context.chapterTitle,
          chapterIndex: context.chapterIndex + 1,
        },
      });
      const saved = await saveCanonReviewItem({
        projectId: currentProject?.id || null,
        chapterId: activeChapterId || null,
        sceneId: activeSceneId || null,
        canonPackId: linkedCanonPack.id,
        mode: canonReviewMode,
        status: 'complete',
        verdict: result.verdict,
        result,
      });
      setCanonReviewItems((items) => [saved, ...items.filter((item) => item.id !== saved.id)].slice(0, 8));
      setCanonReviewState({ status: 'complete', error: null });
    } catch (err) {
      setCanonReviewState({ status: 'error', error: err?.message || 'Không chạy được AI Canon Review.' });
    }
  };

  const handleCancelCanonReview = () => {
    abortCanonReview();
    setCanonReviewState({ status: 'canceled', error: null });
  };

  const handleCanonReviewStatus = async (item, status, extra = {}) => {
    const saved = await updateCanonReviewItem(item.id, { status, ...extra });
    setCanonReviewItems((items) => items.map((entry) => (entry.id === item.id ? saved : entry)));
  };

  const handleApplyCanonReviewFix = async (item, issue) => {
    const fix = String(issue?.suggestedFix || '').trim();
    if (!fix || !editor) return;
    editor.chain().focus().insertContent(textToHtml(fix)).run();
    await handleCanonReviewStatus(item, 'fix_applied');
  };

  const handleApplyOutlineToChapter = async () => {
    if (!activeChapterId || !parsedOutlineResult || !hasOutlinePatchData(parsedOutlineResult.chapterPatch)) return;

    setOutlineApplyState('saving');
    try {
      await updateChapter(activeChapterId, {
        purpose: parsedOutlineResult.chapterPatch.purpose,
        summary: parsedOutlineResult.chapterPatch.summary,
        key_events: parsedOutlineResult.chapterPatch.key_events,
        thread_titles: parsedOutlineResult.chapterPatch.thread_titles,
        featured_characters: parsedOutlineResult.chapterPatch.featured_characters,
        primary_location: parsedOutlineResult.chapterPatch.primary_location,
        required_factions: parsedOutlineResult.chapterPatch.required_factions,
        required_objects: parsedOutlineResult.chapterPatch.required_objects,
        required_terms: parsedOutlineResult.chapterPatch.required_terms,
      });
      setOutlineApplyState('saved');
    } catch (err) {
      console.error('[Outline] Failed to apply chapter patch:', err);
      setOutlineApplyState('error');
    }
  };

  const handleClearOutput = () => {
    clearOutput();
  };

  useEffect(() => {
    if (!isStreaming && completedText && lastTaskId === 'plot' && activeChapterId) {
      const parsed = parsePlotSuggestions(completedText);
      if (parsed.length > 0) {
        setPlotSuggestions(parsed);
        setShowPlotManager(false);
        persistPlotSuggestions(parsed).catch((err) => {
          console.warn('[PlotSuggestions] Save failed:', err);
        });
      }
    }
  }, [isStreaming, completedText, lastTaskId, activeChapterId, currentProject?.id]);

  const handleRegeneratePlot = () => {
    setShowPlotManager(false);
    const plotAction = QUICK_ACTIONS.find((action) => action.id === 'plot');
    if (plotAction) executeAction(plotAction, '');
  };

  const currentSceneText = (() => {
    const scene = scenes.find((item) => item.id === activeSceneId);
    return scene?.draft_text || '';
  })();
  const hasPinnedTaskPanel = showPlotManager || !!pendingAction;

  const persistPlotSuggestions = (nextSuggestions) => {
    if (!activeChapterId) return Promise.resolve();
    return db.savePlotSuggestions(activeChapterId, currentProject?.id, nextSuggestions.slice(0, 3));
  };

  const selectGuidanceText = (text) => {
    setActionGuidance(text);
    requestAnimationFrame(() => {
      if (!guidanceRef.current) return;
      autosizeTextarea(guidanceRef.current);
      guidanceRef.current.focus();
    });
  };

  const clearPersistedPlotSuggestions = () => {
    if (!activeChapterId) return Promise.resolve();
    return db.suggestions
      .where('source_chapter_id').equals(activeChapterId)
      .filter((item) => item.source_type === 'plot_suggestion')
      .delete();
  };

  const renderQuickActions = () => (
    <div className="ai-quick-actions" ref={quickActionsRef}>
      {getWriterQuickActionOrder(isMobileLayout).map((actionId) => {
        if (actionId === CONTENT_MODE_QUICK_ACTION_ID) {
          return (
            <ProjectContentModeControl
              key={CONTENT_MODE_QUICK_ACTION_ID}
              surface="writer"
              mode={contentMode}
              onChange={setContentMode}
            />
          );
        }

        const action = QUICK_ACTIONS_BY_ID[actionId];
        if (!action) return null;
        const isActive = activeAction === action.id && (isStreaming || isCheckingConflict);
        return (
          <button
            key={action.id}
            ref={(node) => {
              if (node) {
                actionButtonRefs.current.set(action.id, node);
              } else {
                actionButtonRefs.current.delete(action.id);
              }
            }}
            className={`ai-action-btn ${action.id === 'conflict' ? 'ai-action-btn--warn' : ''} ${isActive ? 'ai-action-btn--active' : ''}`}
            onClick={() => handleQuickAction(action)}
            disabled={isStreaming || isCheckingConflict}
            title={action.label}
          >
            {isActive ? <Loader2 size={15} className="spin" /> : <action.icon size={15} />}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderFanficCanonPanel = () => {
    const isFanficProject = ['fanfic', 'rewrite', 'translation_context'].includes(currentProject?.project_mode);
    if (!linkedCanonPack && !isFanficProject) return null;
    if (!linkedCanonPack) {
      return (
        <div className="ai-fanfic-canon-panel ai-fanfic-canon-panel--missing">
          <div className="ai-fanfic-canon-panel__header">
            <BookKey size={14} />
            <span>Chưa liên kết Canon Pack</span>
          </div>
          <p>Dự án này đang ở chế độ đồng nhân / viết lại, nhưng chưa có Canon Pack để AI bám canon.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (currentProject?.id) navigate(`/project/${currentProject.id}/lab-lite`);
            }}
          >
            <BookKey size={12} /> Mở Lab Lite để nạp liệu
          </button>
        </div>
      );
    }
    const setup = (() => {
      try {
        return typeof currentProject?.fanfic_setup === 'string'
          ? JSON.parse(currentProject.fanfic_setup)
          : currentProject?.fanfic_setup || {};
      } catch {
        return {};
      }
    })();
    return (
      <div className="ai-fanfic-canon-panel">
        <div className="ai-fanfic-canon-panel__header">
          <BookKey size={14} />
          <span>Canon Pack đang dùng</span>
        </div>
        <div className="ai-fanfic-canon-panel__title">{linkedCanonPack.title}</div>
        <div className="ai-fanfic-canon-panel__meta">
          <span>{currentProject?.project_mode || 'fanfic'}</span>
          <span>{currentProject?.canon_adherence_level || setup.adherenceLevel || 'balanced'}</span>
        </div>
        {currentProject?.divergence_point ? (
          <p>Điểm rẽ nhánh: {currentProject.divergence_point}</p>
        ) : null}
        {linkedCanonPack.canonRestrictions?.length > 0 ? (
          <p>Điều cấm phá canon: {linkedCanonPack.canonRestrictions.slice(0, 3).join('; ')}</p>
        ) : null}
        {linkedCanonPack.creativeGaps?.length > 0 ? (
          <p>Khoảng trống sáng tạo: {linkedCanonPack.creativeGaps.slice(0, 3).join('; ')}</p>
        ) : null}
      </div>
    );
  };

  const renderCanonReviewPanel = () => {
    if (!linkedCanonPack) return null;
    const isRunning = canonReviewState.status === 'running';
    const latestItems = canonReviewItems.slice(0, 4);
    return (
      <div className="ai-canon-review-panel" data-testid="ai-canon-review-panel">
        <div className="ai-canon-review-panel__header">
          <ShieldAlert size={14} />
          <span>AI gợi ý phát hiện lệch canon</span>
        </div>
        <div className="ai-canon-review-panel__controls">
          <select
            value={canonReviewMode}
            onChange={(event) => setCanonReviewMode(event.target.value)}
            disabled={isRunning}
            aria-label="Canon Review mode"
          >
            <option value="quick">Nhanh</option>
            <option value="standard">Chuẩn</option>
            <option value="deep">Sâu</option>
          </select>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleRunCanonReview}
            disabled={isRunning}
          >
            {isRunning ? <Loader2 size={12} className="spin" /> : <ShieldAlert size={12} />}
            Kiểm tra lệch canon
          </button>
          {isRunning ? (
            <button className="btn btn-ghost btn-icon btn-sm" type="button" onClick={handleCancelCanonReview} title="Hủy Canon Review">
              <Square size={12} />
            </button>
          ) : null}
        </div>
        {canonReviewState.error ? (
          <div className="ai-canon-review-panel__error">{canonReviewState.error}</div>
        ) : null}
        {latestItems.length > 0 ? (
          <div className="ai-canon-review-panel__list">
            {latestItems.map((item) => {
              const issues = item.result?.issues || [];
              const firstIssue = issues[0] || null;
              return (
                <div key={item.id} className="ai-canon-review-card">
                  <div className="ai-canon-review-card__meta">
                    <span>{item.mode || 'standard'}</span>
                    <span>{item.verdict || item.result?.verdict || 'no_obvious_issue'}</span>
                    <span>{item.status || 'complete'}</span>
                  </div>
                  {firstIssue ? (
                    <>
                      <div className="ai-canon-review-card__issue">
                        <strong>{firstIssue.type}</strong>
                        <span>{firstIssue.severity}</span>
                      </div>
                      {firstIssue.explanation ? <p>{firstIssue.explanation}</p> : null}
                      {firstIssue.canonReference ? <p className="ai-canon-review-card__ref">{firstIssue.canonReference}</p> : null}
                    </>
                  ) : (
                    <p>Không thấy vấn đề rõ ràng trong phạm vi Canon Pack đã nạp.</p>
                  )}
                  <div className="ai-canon-review-card__actions">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => handleCanonReviewStatus(item, 'ignored')}>
                      Bỏ qua
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => handleCanonReviewStatus(item, 'needs_review')}>
                      Cần xem lại
                    </button>
                    {firstIssue?.suggestedFix ? (
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleApplyCanonReviewFix(item, firstIssue)}>
                        <Replace size={12} /> Dùng gợi ý
                      </button>
                    ) : null}
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => handleCanonReviewStatus(item, 'intentional_divergence', { userNote: 'Accepted intentional divergence.' })}
                    >
                      Đánh dấu rẽ nhánh
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ai-canon-review-panel__empty">Chưa có mục review cho Canon Pack này.</p>
        )}
      </div>
    );
  };

  const renderPlotManager = () => showPlotManager && (
    <div className="ai-guidance-panel">
      <div className="ai-guidance-header">
        <Lightbulb size={14} />
        <span>Gợi ý tình tiết</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowPlotManager(false)}>
          <X size={14} />
        </button>
      </div>
      <div className="ai-plot-manager">
        {plotSuggestions.map((suggestion, index) => {
          return (
            <div key={suggestion.id || index} className="ai-plot-manager-item">
              <div className="ai-plot-manager-title">{suggestion.title}</div>
              <p className="ai-plot-manager-text">{suggestion.summary}</p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const updated = plotSuggestions.filter((item) => item.id !== suggestion.id);
                  setPlotSuggestions(updated);
                  if (updated.length > 0) {
                    persistPlotSuggestions(updated).catch((err) => {
                      console.warn('[PlotSuggestions] Delete item failed:', err);
                    });
                  } else {
                    clearPersistedPlotSuggestions().then(() => setShowPlotManager(false));
                  }
                }}
              >
                <Trash2 size={12} /> Xóa ý này
              </button>
            </div>
          );
        })}
      </div>
      <div className="ai-guidance-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setPlotSuggestions([]);
            clearPersistedPlotSuggestions().then(() => setShowPlotManager(false));
          }}
        >
          <Trash2 size={12} /> Xóa tất cả
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleRegeneratePlot}>
          <RefreshCw size={12} /> Sinh mới
        </button>
      </div>
    </div>
  );

  const renderGuidanceInput = () => {
    if (!pendingAction) return null;

    const showPlotAssist = pendingAction.id === 'continue' && plotSuggestions.length > 0;
    const isPlotAssistExpanded = showPlotAssist && showPlotAssistPicker;
    const plotAssistLabel = `Có ${plotSuggestions.length} gợi ý tình tiết đã lưu cho chương này`;
    const guidancePanelClassName = [
      'ai-guidance-panel',
      !scopedHasOutput ? 'ai-guidance-panel--expanded' : '',
      isPlotAssistExpanded ? 'ai-guidance-panel--plot-assist-open' : '',
      isMobileLayout ? 'ai-guidance-panel--mobile' : '',
    ].filter(Boolean).join(' ');

    return (
      <div className={guidancePanelClassName}>
      <div className="ai-guidance-header">
        <pendingAction.icon size={14} />
        <span>{pendingAction.label}</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPendingAction(null)}>
          <X size={14} />
        </button>
      </div>

      {showPlotAssist && (
        <div className="ai-plot-assist">
          <div className="ai-plot-assist-summary">
            <div className="ai-plot-assist-title">
              <Bookmark size={12} />
              <span>{plotAssistLabel}</span>
            </div>
            <div className="ai-plot-assist-summary-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowPlotAssistPicker((value) => !value)}
                type="button"
              >
                {showPlotAssistPicker ? 'Ẩn chi tiết' : 'Xem chi tiết'}
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => {
                  setPlotSuggestions([]);
                  clearPersistedPlotSuggestions();
                }}
                title="Xóa gợi ý tình tiết"
                type="button"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
          {showPlotAssistPicker && (
          <div className="ai-plot-assist-list">
            {plotSuggestions.map((suggestion, index) => {
              const isActive = actionGuidance === suggestion.guidance;
              return (
                <button
                  key={suggestion.id || index}
                  className={`ai-plot-assist-card ${isActive ? 'ai-plot-assist-card--active' : ''}`}
                  onClick={() => selectGuidanceText(suggestion.guidance)}
                  title={suggestion.summary}
                  type="button"
                >
                  <span className="ai-plot-assist-card-index">{index + 1}</span>
                  <span className="ai-plot-assist-card-body">
                    <span className="ai-plot-assist-card-title">{suggestion.title}</span>
                    <span className="ai-plot-assist-card-text">{suggestion.summary}</span>
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </div>
      )}

      <textarea
        ref={guidanceRef}
        className="ai-guidance-input"
        placeholder={pendingAction.placeholder || 'Hướng dẫn thêm cho AI...'}
        value={actionGuidance}
        onFocus={() => onMobileInputFocusChange?.(true)}
        onBlur={() => onMobileInputFocusChange?.(false)}
        onChange={(event) => {
          setActionGuidance(event.target.value);
          autosizeTextarea(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            executeAction(pendingAction, actionGuidance);
          }
        }}
        rows={1}
      />
      <div className="ai-guidance-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => executeAction(pendingAction, '')}>
          Bỏ qua
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => executeAction(pendingAction, actionGuidance)}>
          <Send size={12} /> Gửi
        </button>
      </div>
      </div>
    );
  };

  const renderOutlineResult = () => {
    if (!parsedOutlineResult) return null;

    const modeLabels = {
      create_current_chapter: 'Tao dan y cho chuong hien tai',
      fill_current_chapter: 'Lap beat con thieu trong chuong hien tai',
      ready_for_next_chapter: 'Chuong nay gan hoan tat',
    };
    const canApplyPatch = hasOutlinePatchData(parsedOutlineResult.chapterPatch);

    const patchMeta = [
      parsedOutlineResult.chapterPatch.primary_location
        ? `Dia diem: ${parsedOutlineResult.chapterPatch.primary_location}`
        : '',
      parsedOutlineResult.chapterPatch.featured_characters.length > 0
        ? `Nhan vat: ${parsedOutlineResult.chapterPatch.featured_characters.join(', ')}`
        : '',
      parsedOutlineResult.chapterPatch.thread_titles.length > 0
        ? `Threads: ${parsedOutlineResult.chapterPatch.thread_titles.join(', ')}`
        : '',
    ].filter(Boolean);

    return (
      <div className="ai-outline-result">
        <div className="ai-outline-result__header">
          <div className="ai-outline-result__eyebrow">Dan y chuong</div>
          <div className="ai-outline-result__mode">{modeLabels[parsedOutlineResult.mode] || 'Phan tich dan y chuong hien tai'}</div>
        </div>

        {(parsedOutlineResult.purpose || parsedOutlineResult.summary) && (
          <div className="ai-outline-result__section">
            {parsedOutlineResult.purpose && (
              <div className="ai-outline-result__lead">
                <strong>Purpose:</strong> {parsedOutlineResult.purpose}
              </div>
            )}
            {parsedOutlineResult.summary && (
              <div className="ai-outline-result__lead">
                <strong>Summary:</strong> {parsedOutlineResult.summary}
              </div>
            )}
            {patchMeta.length > 0 && (
              <div className="ai-outline-result__chips">
                {patchMeta.map((item) => (
                  <span key={item} className="ai-outline-chip">{item}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {parsedOutlineResult.completedBeats.length > 0 && (
          <div className="ai-outline-result__section">
            <div className="ai-outline-result__title">Beat da hoan thanh / da co dau hieu</div>
            <div className="ai-outline-beat-list">
              {parsedOutlineResult.completedBeats.map((beat) => (
                <div key={beat.id} className="ai-outline-beat-card ai-outline-beat-card--done">
                  <div className="ai-outline-beat-card__title">{beat.title}</div>
                  {beat.status && <div className="ai-outline-beat-card__meta">Trang thai: {beat.status}</div>}
                  {beat.evidence && <div className="ai-outline-beat-card__text">{beat.evidence}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {parsedOutlineResult.nextBeats.length > 0 && (
          <div className="ai-outline-result__section">
            <div className="ai-outline-result__title">Beat con thieu / beat tiep theo</div>
            <div className="ai-outline-beat-list">
              {parsedOutlineResult.nextBeats.map((beat) => (
                <div key={beat.id} className="ai-outline-beat-card">
                  <div className="ai-outline-beat-card__title">{beat.title}</div>
                  {beat.beat && <div className="ai-outline-beat-card__text">{beat.beat}</div>}
                  {beat.characterChange && <div className="ai-outline-beat-card__meta">Nhan vat: {beat.characterChange}</div>}
                  {beat.thread && <div className="ai-outline-beat-card__meta">Thread: {beat.thread}</div>}
                  {beat.boundaryReason && <div className="ai-outline-beat-card__meta">Ly do giu trong chuong nay: {beat.boundaryReason}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {parsedOutlineResult.progressWarning && (
          <div className="ai-outline-result__warning">
            <strong>Canh bao tien do:</strong> {parsedOutlineResult.progressWarning}
          </div>
        )}

        {parsedOutlineResult.transitionNote && (
          <div className="ai-outline-result__transition">
            <strong>Goi y chuyen chuong:</strong> {parsedOutlineResult.transitionNote}
          </div>
        )}

        {canApplyPatch && (
          <div className="ai-outline-result__footer">
            <div className="ai-outline-result__note">Ap vao chapter hien tai se cap nhat purpose, summary va cac truong outline cot loi. Khong tu dong doi ten chuong.</div>
            <button
              className="btn btn-accent btn-sm"
              onClick={handleApplyOutlineToChapter}
              disabled={outlineApplyState === 'saving'}
            >
              {outlineApplyState === 'saving' ? <Loader2 size={12} className="spin" /> : <ArrowDownToLine size={12} />}
              {outlineApplyState === 'saved' ? 'Da ap vao chuong' : outlineApplyState === 'error' ? 'Thu ap lai' : 'Ap vao chuong hien tai'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderOutputArea = (showEmptyState = false) => {
    if (!scopedHasOutput && !showEmptyState) return null;

    const showOutputMeta = !!(
      lastRouteInfo
      && !scopedIsStreaming
      && !scopedError
      && scopedHasOutput
      && PROSE_OUTPUT_TASKS.has(scopedTaskId)
    );

    return (
      <div className="ai-output-area">
        <div className="ai-output-header">
          <span className="ai-output-label">
            {scopedIsStreaming || scopedIsCheckingConflict ? (
              <><span className="ai-streaming-dot" /> {scopedIsCheckingConflict ? 'Đang kiểm tra...' : 'Đang viết...'}</>
            ) : scopedError ? 'Lỗi' : 'Kết quả'}
          </span>
          <div className="ai-output-actions">
            {!scopedIsStreaming && scopedDisplayText && (
              <>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCopy} title="Copy">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                {PROSE_INSERT_TASKS.includes(scopedTaskId) && canApplyOutputToActiveEditor && (
                  <button className="btn btn-ghost btn-sm" onClick={handleInsertToEditor} title="Lưu kết quả vào cảnh đang mở">
                    <ArrowDownToLine size={12} /> Lưu vào
                  </button>
                )}
                {PROSE_REPLACE_TASKS.includes(scopedTaskId) && canApplyOutputToActiveEditor && (
                  <button className="btn btn-accent btn-sm" onClick={handleReplaceEditor} title="Thay thế đoạn gốc">
                    <Replace size={12} /> Thay thế
                  </button>
                )}
              </>
            )}
            {scopedIsStreaming ? (
              <button className="btn btn-danger btn-sm" onClick={abort}>
                <Square size={12} /> Dừng
              </button>
            ) : (
              <button className="btn btn-ghost btn-icon btn-sm" onClick={handleClearOutput} title="Xóa">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="ai-output-content" ref={outputRef}>
          {scopedError ? (
            <div className="ai-output-error">{scopedError}</div>
          ) : parsedOutlineResult ? (
            renderOutlineResult()
          ) : scopedDisplayText ? (
            <div className="ai-output-text">{scopedDisplayText}{scopedIsStreaming && <span className="ai-cursor">|</span>}</div>
          ) : (
            <div className="ai-output-empty">Chưa có kết quả cho cảnh/chương đang mở. Chạy một tác vụ AI tại đây để xem nội dung.</div>
          )}
        </div>

        {showOutputMeta && (
          <div className="ai-output-meta">
            <span>{lastRouteInfo.provider === 'ollama' ? 'Local' : 'Cloud'} · {lastRouteInfo.model}</span>
            {lastElapsed && <span>· {(lastElapsed / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
    );
  };

  const renderPromptComposer = () => (
    <form className="ai-free-prompt" onSubmit={handleFreePrompt}>
      <textarea
        ref={customPromptRef}
        className="ai-prompt-input"
        placeholder="Nhập yêu cầu tự do..."
        value={customPrompt}
        onFocus={() => onMobileInputFocusChange?.(true)}
        onBlur={() => onMobileInputFocusChange?.(false)}
        onChange={(event) => {
          setCustomPrompt(event.target.value);
          autosizeTextarea(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleFreePrompt(event);
          }
        }}
        rows={1}
        disabled={isStreaming}
      />
      <button
        type="submit"
        className="btn btn-primary btn-sm ai-send-btn"
        disabled={isStreaming || isCheckingConflict || !customPrompt.trim()}
      >
        {isStreaming ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
      </button>
    </form>
  );

  const renderBottomDock = () => (
    <div
      className={[
        'ai-bottom-dock',
        hasPinnedTaskPanel ? 'ai-bottom-dock--task-open' : '',
        hasPinnedTaskPanel && (!scopedHasOutput || (pendingAction?.id === 'continue' && plotSuggestions.length > 0 && showPlotAssistPicker))
          ? 'ai-bottom-dock--expanded'
          : '',
        isMobileLayout && hasPinnedTaskPanel ? 'ai-bottom-dock--mobile-sheet' : '',
      ].filter(Boolean).join(' ')}
    >
      {renderPlotManager()}
      {renderGuidanceInput()}
    </div>
  );

  const renderDesktopBody = () => (
    <div className="ai-sidebar-body">
      {!hasPinnedTaskPanel && renderPromptComposer()}
      {scopedHasOutput ? (
        <div className="ai-main-stack">
          {renderOutputArea(false)}
        </div>
      ) : null}
      {hasPinnedTaskPanel ? renderBottomDock() : null}
    </div>
  );

  const renderMobileBody = () => (
    <div className="ai-mobile-layout">
      <div className="ai-mobile-tabs">
        {MOBILE_AI_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`ai-mobile-tab ${mobileTab === tab.id ? 'ai-mobile-tab--active' : ''}`}
            onClick={() => onMobileTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ai-mobile-panel">
        {mobileTab === 'ai' && (
          <div className="ai-mobile-ai" ref={mobileAiRef}>
            {renderQuickActions()}
            {hasPinnedTaskPanel ? (
              <div
                className="ai-mobile-task-overlay"
                style={{ top: `${mobileOverlayTop}px` }}
              >
                {renderBottomDock()}
              </div>
            ) : (
              renderPromptComposer()
            )}
          </div>
        )}

        {mobileTab === 'codex' && (
          <div className="ai-mobile-codex">
            <CodexPanel sceneText={currentSceneText} />
          </div>
        )}

        {mobileTab === 'results' && renderOutputArea(true)}
      </div>
    </div>
  );

  if (isMobileLayout) {
    return (
      <div className="ai-sidebar ai-sidebar--mobile">
        {renderMobileBody()}
      </div>
    );
  }

  return (
    <div className="ai-sidebar">
      {renderFanficCanonPanel()}
      {renderCanonReviewPanel()}
      <CodexPanel sceneText={currentSceneText} />
      {renderQuickActions()}
      {renderDesktopBody()}
    </div>
  );
}
