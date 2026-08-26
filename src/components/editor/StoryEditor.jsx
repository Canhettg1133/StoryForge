import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import AnalysisHighlightExtension from './AnalysisHighlightExtension.js';
import { useShallow } from 'zustand/react/shallow';
import useProjectStore from '../../stores/projectStore';
import useCanonStore from '../../stores/canonStore';
import useUIStore, {
  CONTENT_FONT_SIZE_MAX,
  CONTENT_FONT_SIZE_MIN,
  DEFAULT_CONTENT_FONT_SIZE,
} from '../../stores/uiStore';
import { THEMES } from '../../config/themes.js';
import { countWords } from '../../utils/constants';
import ContinuityBar from './ContinuityBar';
import SceneDetailPanel from './SceneDetailPanel';
import ChapterReader from './ChapterReader';
import ChapterSpeechControl from './ChapterSpeechControl';
import ChapterChangeHistory from './ChapterChangeHistory';
import db from '../../services/db/database';
import { getStoredSceneWordCount } from '../../services/projects/sceneWordCounts.js';
import { createSceneAutosaveController } from './storyEditorAutosave';
import { deriveChapterProgress } from './storyEditorMetrics.js';
import { ChevronDown, ChevronRight, BookOpen, FileText, History, ListChecks, Pencil, Check, X, Settings, Copy, Type, Minus, Plus, RotateCcw, PanelLeft, Palette } from 'lucide-react';
import './StoryEditor.css';

function isContentEmpty(html = '') {
  return !String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function isEditorEmpty(editor, fallbackHtml = '') {
  if (!editor) return isContentEmpty(fallbackHtml);
  return !editor.getText().replace(/\s+/g, ' ').trim();
}

function textToHtml(text = '') {
  return String(text || '')
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
    .join('');
}

const StoryEditorFooter = React.memo(function StoryEditorFooter({
  editor,
  chapterWordCount,
  persistedSceneWordCount,
  targetWordCount,
  autosaveStatus,
  onRetryAutosave,
}) {
  const liveMetrics = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      wordCount: currentEditor?.storage.characterCount.words() || 0,
      charCount: currentEditor?.storage.characterCount.characters() || 0,
    }),
  }) || { wordCount: 0, charCount: 0 };
  const chapterProgress = deriveChapterProgress({
    chapterWordCount,
    persistedSceneWordCount,
    liveSceneWordCount: liveMetrics.wordCount,
    targetWordCount,
  });

  return (
    <div className="story-editor-footer">
      <div className="story-editor-stats">
        <span>{liveMetrics.wordCount.toLocaleString()} từ</span>
        <span className="story-editor-stats-divider">·</span>
        <span>{liveMetrics.charCount.toLocaleString()} ký tự</span>
        <span className="story-editor-stats-divider">·</span>
        <span className="story-editor-progress-label">
          Chương: {chapterProgress.current.toLocaleString()}/{chapterProgress.target.toLocaleString()}
        </span>
      </div>

      <div className="story-editor-progress">
        <div
          className="story-editor-progress-bar"
          style={{ width: `${chapterProgress.percent}%` }}
          data-complete={chapterProgress.percent >= 100 ? 'true' : 'false'}
        />
      </div>

      <div className="story-editor-status">
        <span className="story-editor-progress-pct">{chapterProgress.percent}%</span>
        <span className="story-editor-mobile-word-count">{liveMetrics.wordCount.toLocaleString()} từ</span>
        <span
          className={`story-editor-autosave is-${autosaveStatus.state}`}
          role={autosaveStatus.state === 'error' ? 'alert' : 'status'}
          aria-live={autosaveStatus.state === 'error' ? 'assertive' : 'polite'}
        >
          {autosaveStatus.state === 'idle' ? 'Đã lưu' : null}
          {autosaveStatus.state === 'dirty' ? 'Chưa lưu' : null}
          {autosaveStatus.state === 'saving' ? 'Đang lưu…' : null}
          {autosaveStatus.state === 'saved' ? 'Đã lưu' : null}
          {autosaveStatus.state === 'error' ? (
            <button
              type="button"
              className="story-editor-autosave__retry"
              onClick={onRetryAutosave}
            >
              Lưu thất bại – Thử lại
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
});

function StoryEditor({
  onEditorReady,
  isMobileLayout = false,
  hasMobileProjectShell = false,
  viewMode = 'scene',
  onViewModeChange,
  onOpenChapters,
  aiDraftPreview = null,
  onAiDraftSaved,
}) {
  const {
    activeSceneId, activeChapterId, scenes, chapters, currentProject,
    updateScene, updateChapter, activeChapterCompletion,
  } = useProjectStore(useShallow((state) => ({
    activeSceneId: state.activeSceneId,
    activeChapterId: state.activeChapterId,
    scenes: state.scenes,
    chapters: state.chapters,
    currentProject: state.currentProject,
    updateScene: state.updateScene,
    updateChapter: state.updateChapter,
    activeChapterCompletion: state.chapterCompletionById?.[state.activeChapterId] || null,
  })));

  const activeScene = scenes.find(s => s.id === activeSceneId) || null;
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId) || null;
  const persistedActiveSceneWordCount = useMemo(
    () => getStoredSceneWordCount(activeScene || {}),
    [
      activeScene?.id,
      activeScene?.word_count,
      activeScene?.word_count_version,
      activeScene?.draft_text,
      activeScene?.final_text,
    ],
  );
  const nextChapterId = useMemo(() => {
    const orderedChapters = chapters.slice().sort(
      (left, right) => Number(left?.order_index || 0) - Number(right?.order_index || 0),
    );
    const activeIndex = orderedChapters.findIndex((chapter) => chapter.id === activeChapterId);
    return activeIndex >= 0 ? (orderedChapters[activeIndex + 1]?.id ?? null) : null;
  }, [activeChapterId, chapters]);
  const activeCanonRevisionId = useCanonStore((state) => (
    state.chapterCanon?.revision?.id
    || state.chapterCanon?.commit?.current_revision_id
    || ''
  ));
  const isReaderMode = viewMode === 'reader';
  const activeChapterSceneCount = useMemo(
    () => scenes.reduce(
      (count, scene) => count + (scene.chapter_id === activeChapterId ? 1 : 0),
      0,
    ),
    [activeChapterId, scenes],
  );
  const contentFontSize = useUIStore((state) => state.contentFontSize);
  const setContentFontSize = useUIStore((state) => state.setContentFontSize);
  const resetContentFontSize = useUIStore((state) => state.resetContentFontSize);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const autosaveControllerRef = useRef(null);
  const lastSavedBySceneRef = useRef(new Map());
  const previousSceneIdRef = useRef(null);
  const editorWrapperRef = useRef(null);
  const fontControlRef = useRef(null);
  const [outlinePanelOpen, setOutlinePanelOpen] = useState(() => !isMobileLayout);
  const [liveEditorIsEmpty, setLiveEditorIsEmpty] = useState(() => (
    isContentEmpty(activeScene?.draft_text || '')
  ));
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [sceneDetailOpen, setSceneDetailOpen] = useState(false);
  const [fontPopoverOpen, setFontPopoverOpen] = useState(false);
  const [allCharacters, setAllCharacters] = useState([]);
  const [autosaveStatus, setAutosaveStatus] = useState({
    state: 'idle',
    sceneId: null,
    error: null,
  });

  // [MỚI] Outline edit state
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [editPurpose, setEditPurpose] = useState('');
  const [aiDraft, setAiDraft] = useState(null);
  const [dismissedDraftKey, setDismissedDraftKey] = useState('');
  const [copiedOutlineField, setCopiedOutlineField] = useState('');

  // Parse chapter outline data (summary + key_events from purpose)
  const chapterOutline = useMemo(() => {
    if (!activeChapter) return null;
    const summary = activeChapter.summary || '';
    let keyEvents = [];
    if (activeChapter.purpose) {
      try {
        const parsed = JSON.parse(activeChapter.purpose);
        if (Array.isArray(parsed)) keyEvents = parsed;
      } catch { /* purpose is plain text, not JSON */ }
    }
    // Hiện panel ngay cả khi chưa có nội dung để tác giả có thể thêm
    return { summary, keyEvents, purposeRaw: activeChapter.purpose || '' };
  }, [activeChapter]);

  // [MỚI] Mở form chỉnh sửa — prefill từ data hiện tại
  const handleStartEdit = () => {
    if (!chapterOutline) return;
    setEditSummary(chapterOutline.summary);
    // Nếu purpose là JSON array thì join thành multiline text để dễ edit
    if (chapterOutline.keyEvents.length > 0) {
      setEditPurpose(chapterOutline.keyEvents.join('\n'));
    } else {
      setEditPurpose(chapterOutline.purposeRaw);
    }
    setIsEditingOutline(true);
  };

  // [MỚI] Lưu chỉnh sửa
  const handleSaveOutline = async () => {
    if (!activeChapterId) return;
    // Nếu purpose được nhập dạng multiline → lưu dạng JSON array (mỗi dòng = 1 event)
    // Nếu chỉ 1 dòng hoặc không có newline → lưu plain text
    const lines = editPurpose.split('\n').map(l => l.trim()).filter(Boolean);
    const purposeToSave = lines.length > 1 ? JSON.stringify(lines) : (lines[0] || '');

    await updateChapter(activeChapterId, {
      summary: editSummary.trim(),
      purpose: purposeToSave,
    });
    setIsEditingOutline(false);
  };

  // [MỚI] Huỷ chỉnh sửa
  const handleCancelEdit = () => {
    setIsEditingOutline(false);
    setEditSummary('');
    setEditPurpose('');
  };

  const getOutlineCopyText = (field) => {
    if (!chapterOutline) return '';
    if (field === 'summary') return chapterOutline.summary || '';
    if (field === 'purpose') {
      return chapterOutline.keyEvents.length > 0
        ? chapterOutline.keyEvents.join('\n')
        : chapterOutline.purposeRaw || '';
    }
    if (field === 'all') {
      const sections = [];
      const summary = chapterOutline.summary || '';
      const purpose = chapterOutline.keyEvents.length > 0
        ? chapterOutline.keyEvents.join('\n')
        : chapterOutline.purposeRaw || '';

      if (summary.trim()) {
        sections.push(`Tóm tắt\n${summary.trim()}`);
      }

      if (purpose.trim()) {
        sections.push(`Mục tiêu\n${purpose.trim()}`);
      }

      return sections.join('\n\n');
    }
    return '';
  };

  const handleCopyOutline = async (field) => {
    const text = getOutlineCopyText(field).trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedOutlineField(field);
    setTimeout(() => {
      setCopiedOutlineField((current) => (current === field ? '' : current));
    }, 1600);
  };

  // [MỚI] Reset edit state khi đổi chương
  useEffect(() => {
    setIsEditingOutline(false);
    setCopiedOutlineField('');
    setHistoryPanelOpen(false);
    const contentIsEmpty = isContentEmpty(activeScene?.draft_text || '');
    setLiveEditorIsEmpty(contentIsEmpty);
    setOutlinePanelOpen(contentIsEmpty);
  }, [activeChapterId, activeSceneId, isMobileLayout]);

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: 'Bắt đầu viết câu chuyện của bạn...',
      }),
      CharacterCount,
      AnalysisHighlightExtension,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'story-editor-content',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      if (!activeSceneId) return;
      const contentIsEmpty = !editor.getText().replace(/\s+/g, ' ').trim();
      setLiveEditorIsEmpty((current) => (
        current === contentIsEmpty ? current : contentIsEmpty
      ));
      autosaveControllerRef.current?.schedule({
        sceneId: activeSceneId,
        html: editor.getHTML(),
      });
    },
  });

  useEffect(() => {
    if (isEditingOutline) return;
    setOutlinePanelOpen(!aiDraft && liveEditorIsEmpty);
  }, [activeScene?.draft_text, aiDraft, isEditingOutline, liveEditorIsEmpty]);

  // Load characters when project changes
  useEffect(() => {
    if (!currentProject?.id) { setAllCharacters([]); return; }
    db.characters.where('project_id').equals(currentProject.id).toArray()
      .then(setAllCharacters)
      .catch(() => setAllCharacters([]));
  }, [currentProject?.id]);

  useEffect(() => {
    if (!autosaveControllerRef.current) {
      autosaveControllerRef.current = createSceneAutosaveController({
        delayMs: 2000,
        onSave: async (sceneId, html) => {
          const lastSaved = lastSavedBySceneRef.current.get(sceneId) || '';
          if (html === lastSaved) return;
          await updateScene(sceneId, { draft_text: html });
          lastSavedBySceneRef.current.set(sceneId, html);
        },
        onStatusChange: setAutosaveStatus,
      });
    }
  }, [updateScene]);

  useEffect(() => {
    const previousSceneId = previousSceneIdRef.current;
    if (previousSceneId && previousSceneId !== activeSceneId) {
      void autosaveControllerRef.current?.flush();
    }
    previousSceneIdRef.current = activeSceneId;
  }, [activeSceneId]);

  useEffect(() => {
    if (editor && activeScene) {
      const content = activeScene.draft_text || '';
      setLiveEditorIsEmpty(isContentEmpty(content));
      if (autosaveControllerRef.current?.hasPendingForScene(activeScene.id)) return;
      const lastSaved = lastSavedBySceneRef.current.get(activeScene.id) || '';
      if (content !== lastSaved) {
        lastSavedBySceneRef.current.set(activeScene.id, content);
      }
      if (content !== editor.getHTML()) {
        editor.commands.setContent(content, false);
      }
    } else if (editor && !activeScene) {
      setLiveEditorIsEmpty(true);
      editor.commands.setContent('', false);
    }
  }, [activeSceneId, activeScene?.draft_text, editor]);

  useEffect(() => {
    setAiDraft(null);
    setDismissedDraftKey('');
  }, [activeSceneId, activeChapterId]);

  useEffect(() => {
    if (!activeScene || isEditorEmpty(editor, activeScene.draft_text || '')) return;
    setAiDraft(null);
  }, [editor, activeScene?.draft_text, activeScene?.id, activeScene]);

  useEffect(() => {
    if (
      !aiDraftPreview
      || !activeScene
      || aiDraftPreview.sceneId !== activeScene.id
      || aiDraftPreview.chapterId !== activeChapterId
    ) {
      setAiDraft(null);
      return;
    }

    if (!isEditorEmpty(editor, activeScene.draft_text || '')) {
      setAiDraft(null);
      return;
    }

    const text = String(aiDraftPreview.text || '').trim();
    if (!text) {
      setAiDraft(null);
      return;
    }

    const draftKey = `${aiDraftPreview.sceneId}:${aiDraftPreview.taskId || 'ai'}`;
    if (dismissedDraftKey === draftKey) return;

    setAiDraft({
      sceneId: aiDraftPreview.sceneId,
      chapterId: aiDraftPreview.chapterId || null,
      taskId: aiDraftPreview.taskId || 'ai',
      text,
      html: textToHtml(text),
      wordCount: countWords(text),
      isStreaming: !!aiDraftPreview.isStreaming,
    });
  }, [aiDraftPreview, dismissedDraftKey, editor, activeScene?.id, activeScene?.draft_text, activeScene, activeChapterId]);

  // [MỚI] Reset thanh cuộn khi đổi cảnh/chương
  useEffect(() => {
    if (editorWrapperRef.current) {
      editorWrapperRef.current.scrollTop = 0;
    }
  }, [activeSceneId]);

  useEffect(() => {
    if (aiDraft && editorWrapperRef.current) {
      editorWrapperRef.current.scrollTop = 0;
    }
  }, [aiDraft?.sceneId, aiDraft?.taskId]);

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  const isEmptySceneForAiDraft = !activeScene?.draft_text || isContentEmpty(activeScene.draft_text || '');
  const useAiDraftFocus = !!aiDraft && isEmptySceneForAiDraft;
  const activeContentFontSize = contentFontSize ?? DEFAULT_CONTENT_FONT_SIZE;
  const activeTheme = THEMES.find((option) => option.id === theme) || THEMES[0];
  const contentDisplayStyle = contentFontSize
    ? { '--sf-content-font-size': `${contentFontSize}px` }
    : undefined;
  const aiDraftTitle = aiDraft?.isStreaming ? 'AI đang viết cảnh trống này' : 'AI đã viết cảnh trống này';

  const handleSave = useCallback(async (sceneId, html) => {
    if (!sceneId) return;
    const lastSaved = lastSavedBySceneRef.current.get(sceneId) || '';
    if (html === lastSaved) return;
    await updateScene(sceneId, { draft_text: html });
    lastSavedBySceneRef.current.set(sceneId, html);
  }, [updateScene]);

  const handleSaveAiDraft = async () => {
    if (!aiDraft || !editor || !activeSceneId) return;
    if (aiDraft.isStreaming) return;
    if (aiDraft.sceneId !== activeSceneId || aiDraft.chapterId !== activeChapterId) {
      setAiDraft(null);
      return;
    }
    if (!isEditorEmpty(editor, activeScene?.draft_text || '')) {
      setAiDraft(null);
      return;
    }

    editor.commands.setContent(aiDraft.html, false);
    await handleSave(activeSceneId, aiDraft.html);
    onAiDraftSaved?.(aiDraft);
    setAiDraft(null);
  };

  const adjustContentFontSize = (delta) => {
    setContentFontSize(activeContentFontSize + delta);
  };

  useEffect(() => {
    if (!fontPopoverOpen) return undefined;

    const handlePointerDown = (event) => {
      if (fontControlRef.current?.contains(event.target)) return;
      setFontPopoverOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setFontPopoverOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [fontPopoverOpen]);

  useEffect(() => {
    return () => {
      void autosaveControllerRef.current?.dispose({ flushPending: true });
    };
  }, []);

  useEffect(() => {
    if (isReaderMode) {
      void autosaveControllerRef.current?.flush();
    }
  }, [isReaderMode]);

  useEffect(() => {
    const flushPendingChanges = () => {
      void autosaveControllerRef.current?.flush();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingChanges();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushPendingChanges);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushPendingChanges);
    };
  }, []);

  useEffect(() => {
    const hasDirtyData = ['dirty', 'saving', 'error'].includes(autosaveStatus.state);
    if (!hasDirtyData) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autosaveStatus.state]);

  if (!activeScene && !isReaderMode) {
    return (
      <div className="story-editor-empty">
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <h3>Chọn một cảnh để bắt đầu viết</h3>
          <p>Chọn cảnh từ danh sách bên trái hoặc tạo cảnh mới</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`story-editor ${isMobileLayout ? 'story-editor--mobile' : ''} ${hasMobileProjectShell ? 'story-editor--mobile-shell' : ''} ${isReaderMode ? 'story-editor--reader' : ''}`}
      style={contentDisplayStyle}
    >
      <div className={`story-editor-header ${isReaderMode ? 'story-editor-header--reader' : ''}`}>
        <div className={`story-editor-header-main ${!isMobileLayout ? 'story-editor-header-main--desktop' : ''}`}>
          {isReaderMode && !hasMobileProjectShell && (
            <div className="story-editor-heading">
              <div className="story-editor-scene-meta">
                Đọc liền · {activeChapterSceneCount.toLocaleString('vi-VN')} cảnh
              </div>
              <div className="story-editor-reader-title">
                {activeChapter?.title || 'Chương chưa có tiêu đề'}
              </div>
            </div>
          )}
          {!isReaderMode && !isMobileLayout && (
            <div className="story-editor-heading">
              <h1 className="story-editor-chapter-title">
                {activeChapter?.title || 'Chương chưa có tiêu đề'}
              </h1>
            </div>
          )}
          <div className="story-editor-header-actions" ref={fontControlRef}>
          {!isMobileLayout && (
            <div className="story-editor-view-switch" aria-label="Chế độ hiển thị nội dung">
              <button
                type="button"
                className={`story-editor-view-switch__btn ${!isReaderMode ? 'is-active' : ''}`}
                onClick={() => onViewModeChange?.('scene')}
                aria-pressed={!isReaderMode}
              >
                <FileText size={14} />
                <span>Từng cảnh</span>
              </button>
              <button
                type="button"
                className={`story-editor-view-switch__btn ${isReaderMode ? 'is-active' : ''}`}
                onClick={() => onViewModeChange?.('reader')}
                aria-pressed={isReaderMode}
              >
                <BookOpen size={14} />
                <span>Đọc liền</span>
              </button>
            </div>
          )}
          {isReaderMode && isMobileLayout && !hasMobileProjectShell && (
            <button
              type="button"
              className="story-editor-reader-action"
              onClick={onOpenChapters}
            >
              <PanelLeft size={14} />
              <span>Chương</span>
            </button>
          )}
          {isReaderMode && isMobileLayout && (
            <button
              type="button"
              className="story-editor-reader-action story-editor-reader-action--active"
              onClick={() => onViewModeChange?.('scene')}
              title="Trở về chế độ từng cảnh"
            >
              <FileText size={14} />
              <span>Từng cảnh</span>
            </button>
          )}
          {!isReaderMode && (
            <button
              className="story-editor-detail-trigger"
              onClick={() => setSceneDetailOpen(true)}
              title="Mở chi tiết cảnh"
            >
              <Settings size={14} />
              <span>Chi tiết cảnh</span>
            </button>
          )}
          <button
            type="button"
            className={`story-editor-font-trigger ${fontPopoverOpen ? 'story-editor-font-trigger--active' : ''}`}
            onClick={() => setFontPopoverOpen((value) => !value)}
            title="Chỉnh cỡ chữ và giao diện StoryForge"
            aria-expanded={fontPopoverOpen}
          >
            <Type size={14} />
            <span>{isReaderMode && isMobileLayout ? 'Cỡ chữ' : 'Chỉnh cỡ chữ'}</span>
          </button>
          <div className={`story-editor-font-control ${fontPopoverOpen ? 'story-editor-font-control--open' : ''}`} aria-label="Cỡ chữ và giao diện StoryForge">
            <div className="story-editor-display-section">
              <div className="story-editor-display-label">
                <Type size={14} />
                <span>Cỡ chữ</span>
              </div>
              <div className="story-editor-font-control__row">
                <button
                  type="button"
                  className="story-editor-font-control__btn"
                  onClick={() => adjustContentFontSize(-1)}
                  disabled={activeContentFontSize <= CONTENT_FONT_SIZE_MIN}
                  title="Giảm cỡ chữ nội dung"
                >
                  <Minus size={13} />
                </button>
                <span className="story-editor-font-control__value">
                  {contentFontSize ? `${contentFontSize}px` : 'Mặc định'}
                </span>
                <button
                  type="button"
                  className="story-editor-font-control__btn"
                  onClick={() => adjustContentFontSize(1)}
                  disabled={activeContentFontSize >= CONTENT_FONT_SIZE_MAX}
                  title="Tăng cỡ chữ nội dung"
                >
                  <Plus size={13} />
                </button>
                {contentFontSize && (
                  <button
                    type="button"
                    className="story-editor-font-control__btn"
                    onClick={resetContentFontSize}
                    title="Trở về cỡ chữ mặc định"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="story-editor-display-section story-editor-display-section--background">
              <div className="story-editor-display-label">
                <Palette size={14} />
                <span>Giao diện</span>
                <span className="story-editor-display-current">{activeTheme.shortLabel}</span>
              </div>
              <div className="story-editor-background-options" role="radiogroup" aria-label="Giao diện StoryForge">
                {THEMES.map((option) => {
                  const isActive = option.id === activeTheme.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={option.label}
                      className={`story-editor-background-option ${isActive ? 'story-editor-background-option--active' : ''}`}
                      style={{ '--story-editor-background-swatch': option.swatches[1] }}
                      onClick={() => setTheme(option.id)}
                      title={option.label}
                    >
                      <span className="story-editor-background-swatch" aria-hidden="true" />
                      {isActive && <Check className="story-editor-background-check" size={12} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      <ChapterSpeechControl
        chapterId={activeChapterId}
        nextChapterId={nextChapterId}
        placement={isReaderMode ? 'reader' : 'writing'}
        scenes={scenes}
      />

      {/* Scene Detail Drawer */}
      {!isReaderMode && sceneDetailOpen && (
        <SceneDetailPanel
          scene={activeScene}
          characters={allCharacters}
          onSave={async (data) => {
            await updateScene(activeSceneId, data);
            setSceneDetailOpen(false);
          }}
          onClose={() => setSceneDetailOpen(false)}
        />
      )}

      {/* Chapter Outline Panel — Dàn Ý Chương */}
      {!isReaderMode && chapterOutline !== null && (
        <div className={`chapter-outline-panel ${outlinePanelOpen || historyPanelOpen ? 'chapter-outline-panel--open' : ''}`}>
          <div className="chapter-outline-toggle-row">
            <button
              className="chapter-outline-toggle"
              aria-expanded={outlinePanelOpen}
              onClick={() => {
                setOutlinePanelOpen(!outlinePanelOpen);
                setHistoryPanelOpen(false);
              }}
            >
              {outlinePanelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <BookOpen size={14} />
              <span>Dàn ý chương</span>
            </button>

            <button
              type="button"
              className={`chapter-history-toggle ${historyPanelOpen ? 'chapter-history-toggle--active' : ''}`}
              aria-expanded={historyPanelOpen}
              onClick={() => {
                setHistoryPanelOpen(!historyPanelOpen);
                setOutlinePanelOpen(false);
              }}
              disabled={isEditingOutline}
              title={isEditingOutline ? 'Lưu hoặc huỷ chỉnh sửa dàn ý trước khi xem lịch sử' : 'Xem thay đổi sau mỗi lần hoàn thành chương'}
            >
              <History size={14} />
              <span>Lịch sử thay đổi</span>
            </button>

            {/* [MỚI] Nút bút chì — chỉ hiện khi panel mở */}
            {outlinePanelOpen && !isEditingOutline && (
              <button
                className="chapter-outline-edit-btn"
                onClick={handleStartEdit}
                title="Chỉnh sửa dàn ý"
              >
                <Pencil size={13} />
              </button>
            )}

            {/* [MỚI] Nút Lưu / Huỷ khi đang edit */}
            {outlinePanelOpen && isEditingOutline && (
              <div className="chapter-outline-edit-actions">
                <button
                  className="btn btn-xs btn-accent"
                  onClick={handleSaveOutline}
                  title="Lưu"
                >
                  <Check size={12} /> Lưu
                </button>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={handleCancelEdit}
                  title="Huỷ"
                >
                  <X size={12} /> Huỷ
                </button>
              </div>
            )}
          </div>

          {outlinePanelOpen && (
            <div className="chapter-outline-body">
              {/* ── Chế độ xem ── */}
              {!isEditingOutline && (
                <>
                  {(chapterOutline.summary || chapterOutline.purposeRaw || chapterOutline.keyEvents.length > 0) && (
                    <div className="chapter-outline-copy-row">
                      <button
                        type="button"
                        className="chapter-outline-copy-btn chapter-outline-copy-btn--all"
                        onClick={() => handleCopyOutline('all')}
                        title="Copy toàn bộ dàn ý chương"
                      >
                        <Copy size={12} />
                        {copiedOutlineField === 'all' ? 'Đã copy' : 'Copy tất cả'}
                      </button>
                    </div>
                  )}

                  {chapterOutline.summary ? (
                    <div className="chapter-outline-section">
                      <div className="chapter-outline-label">Tóm tắt</div>
                      <button
                        type="button"
                        className="chapter-outline-copy-btn"
                        onClick={() => handleCopyOutline('summary')}
                        title="Copy tóm tắt chương"
                      >
                        <Copy size={12} />
                        {copiedOutlineField === 'summary' ? 'Đã copy' : 'Copy tóm tắt'}
                      </button>
                      <p className="chapter-outline-text">{chapterOutline.summary}</p>
                    </div>
                  ) : (
                    <div className="chapter-outline-section">
                      <p className="chapter-outline-empty">
                        Chưa có tóm tắt. <button className="chapter-outline-add-link" onClick={handleStartEdit}>Thêm ngay</button>
                      </p>
                    </div>
                  )}

                  {chapterOutline.keyEvents.length > 0 && (
                    <div className="chapter-outline-section">
                      <div className="chapter-outline-label">
                        <ListChecks size={13} /> Sự kiện chính
                      </div>
                      <button
                        type="button"
                        className="chapter-outline-copy-btn"
                        onClick={() => handleCopyOutline('purpose')}
                        title="Copy mục tiêu chương"
                      >
                        <Copy size={12} />
                        {copiedOutlineField === 'purpose' ? 'Đã copy' : 'Copy mục tiêu'}
                      </button>
                      <ul className="chapter-outline-events">
                        {chapterOutline.keyEvents.map((evt, i) => (
                          <li key={i}>{evt}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {chapterOutline.purposeRaw && chapterOutline.keyEvents.length === 0 && (
                    <div className="chapter-outline-section">
                      <div className="chapter-outline-label">Mục tiêu chương</div>
                      <button
                        type="button"
                        className="chapter-outline-copy-btn"
                        onClick={() => handleCopyOutline('purpose')}
                        title="Copy mục tiêu chương"
                      >
                        <Copy size={12} />
                        {copiedOutlineField === 'purpose' ? 'Đã copy' : 'Copy mục tiêu'}
                      </button>
                      <p className="chapter-outline-text">{chapterOutline.purposeRaw}</p>
                    </div>
                  )}
                </>
              )}

              {/* ── Chế độ chỉnh sửa ── */}
              {isEditingOutline && (
                <div className="chapter-outline-edit-form">
                  <div className="chapter-outline-edit-field">
                    <label className="chapter-outline-edit-label">Tóm tắt chương</label>
                    <textarea
                      className="chapter-outline-edit-textarea"
                      rows={3}
                      value={editSummary}
                      onChange={e => setEditSummary(e.target.value)}
                      placeholder="Tóm tắt nội dung chương 2-3 câu..."
                      autoFocus
                    />
                  </div>
                  <div className="chapter-outline-edit-field">
                    <label className="chapter-outline-edit-label">
                      <ListChecks size={12} /> Sự kiện chính
                      <span className="chapter-outline-edit-hint">(mỗi dòng = 1 sự kiện)</span>
                    </label>
                    <textarea
                      className="chapter-outline-edit-textarea"
                      rows={4}
                      value={editPurpose}
                      onChange={e => setEditPurpose(e.target.value)}
                      placeholder="Sự kiện 1\nSự kiện 2\nSự kiện 3..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {historyPanelOpen && (
            <div className="chapter-history-body">
              <ChapterChangeHistory
                projectId={currentProject?.id}
                chapterId={activeChapterId}
                refreshKey={`${activeChapterCompletion?.result?.canonResult?.revisionId || ''}:${activeCanonRevisionId}`}
              />
            </div>
          )}
        </div>
      )}

      {/* Continuity Bar */}
      {!isReaderMode && <ContinuityBar isMobileLayout={isMobileLayout} />}

      {isReaderMode ? (
        <ChapterReader chapterId={activeChapterId} scenes={scenes} />
      ) : (
        <>
        <div
          className={`story-editor-wrapper ${useAiDraftFocus ? 'story-editor-wrapper--ai-draft-focus' : ''}`}
          ref={editorWrapperRef}
        >
        {aiDraft && (
          <div
            className={`story-editor-ai-draft ${aiDraft.isStreaming ? 'story-editor-ai-draft--streaming' : ''}`}
            aria-live="polite"
          >
            <div className="story-editor-ai-draft__header">
              <div>
                <div className="story-editor-ai-draft__kicker">Bản nháp AI</div>
                <strong>{aiDraftTitle}</strong>
                <span>{aiDraft.wordCount.toLocaleString()} từ</span>
              </div>
              <div className="story-editor-ai-draft__actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveAiDraft}
                  disabled={aiDraft.isStreaming}
                  title={aiDraft.isStreaming ? 'Đợi AI viết xong rồi hãy lưu vào cảnh' : 'Lưu bản nháp vào cảnh'}
                >
                  <Check size={13} /> {aiDraft.isStreaming ? 'Đợi xong' : 'Lưu'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setDismissedDraftKey(`${aiDraft.sceneId}:${aiDraft.taskId || 'ai'}`);
                    setAiDraft(null);
                  }}
                >
                  <X size={13} /> Bỏ
                </button>
              </div>
            </div>
            <div className="story-editor-ai-draft__body">
              {aiDraft.text}
            </div>
          </div>
        )}
        <EditorContent editor={editor} />
        </div>

        <StoryEditorFooter
          editor={editor}
          chapterWordCount={activeChapter?.actual_word_count || 0}
          persistedSceneWordCount={persistedActiveSceneWordCount}
          targetWordCount={activeChapter?.word_count_target || 7_000}
          autosaveStatus={autosaveStatus}
          onRetryAutosave={() => {
            void autosaveControllerRef.current?.retry();
          }}
        />
        </>
      )}
    </div>
  );
}

export default React.memo(StoryEditor);
