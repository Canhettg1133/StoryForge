import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import useProjectStore from '../../stores/projectStore';
import { countWords } from '../../utils/constants';
import ContinuityBar from './ContinuityBar';
import { ChevronDown, ChevronRight, BookOpen, ListChecks, Pencil, Check, X } from 'lucide-react';
import './StoryEditor.css';

export default function StoryEditor({ onEditorReady }) {
  const {
    activeSceneId, activeChapterId, scenes, chapters,
    updateScene, updateChapter, updateProjectTimestamp,
  } = useProjectStore();

  const activeScene = scenes.find(s => s.id === activeSceneId) || null;
  const saveTimerRef = useRef(null);
  const lastSavedRef = useRef('');
  const [outlinePanelOpen, setOutlinePanelOpen] = useState(true);

  // [MỚI] Outline edit state
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [editPurpose, setEditPurpose] = useState('');

  // Parse chapter outline data (summary + key_events from purpose)
  const chapterOutline = useMemo(() => {
    const chapter = chapters.find(c => c.id === activeChapterId);
    if (!chapter) return null;
    const summary = chapter.summary || '';
    let keyEvents = [];
    if (chapter.purpose) {
      try {
        const parsed = JSON.parse(chapter.purpose);
        if (Array.isArray(parsed)) keyEvents = parsed;
      } catch { /* purpose is plain text, not JSON */ }
    }
    // Hiện panel ngay cả khi chưa có nội dung để tác giả có thể thêm
    return { summary, keyEvents, purposeRaw: chapter.purpose || '' };
  }, [activeChapterId, chapters]);

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
    await updateProjectTimestamp();
    setIsEditingOutline(false);
  };

  // [MỚI] Huỷ chỉnh sửa
  const handleCancelEdit = () => {
    setIsEditingOutline(false);
    setEditSummary('');
    setEditPurpose('');
  };

  // [MỚI] Reset edit state khi đổi chương
  useEffect(() => {
    setIsEditingOutline(false);
  }, [activeChapterId]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: 'Bắt đầu viết câu chuyện của bạn...',
      }),
      CharacterCount,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'story-editor-content',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        handleSave(editor.getHTML());
      }, 2000);
    },
  });

  useEffect(() => {
    if (editor && activeScene) {
      const content = activeScene.draft_text || '';
      if (content !== lastSavedRef.current) {
        editor.commands.setContent(content, false);
        lastSavedRef.current = content;
      }
    } else if (editor && !activeScene) {
      editor.commands.setContent('', false);
      lastSavedRef.current = '';
    }
  }, [activeSceneId, activeScene?.draft_text, editor]);

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  const handleSave = useCallback(async (html) => {
    if (!activeSceneId) return;
    if (html === lastSavedRef.current) return;
    lastSavedRef.current = html;
    await updateScene(activeSceneId, { draft_text: html });
    await updateProjectTimestamp();
  }, [activeSceneId, updateScene, updateProjectTimestamp]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const wordCount = editor ? countWords(editor.getHTML()) : 0;
  const charCount = editor ? editor.storage.characterCount.characters() : 0;

  const chapterProgress = useMemo(() => {
    const chapter = chapters.find(c => c.id === activeChapterId);
    if (!chapter) return null;
    let target = chapter.word_count_target || 7000;
    if (target === 3000) target = 7000;
    const chapterScenes = scenes.filter(s => s.chapter_id === activeChapterId);
    const total = chapterScenes.reduce((sum, s) => {
      const text = (s.draft_text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
      return sum + (text.trim() ? text.trim().split(/\s+/).length : 0);
    }, 0);
    return { current: total, target, percent: Math.min(100, Math.round((total / target) * 100)) };
  }, [activeChapterId, scenes, chapters, wordCount]);

  if (!activeScene) {
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
    <div className="story-editor">
      {/* Scene title */}
      <div className="story-editor-header">
        <input
          className="story-editor-scene-title"
          value={activeScene.title}
          onChange={(e) => updateScene(activeSceneId, { title: e.target.value })}
          placeholder="Tên cảnh..."
        />
      </div>

      {/* Chapter Outline Panel — Dàn Ý Chương */}
      {chapterOutline !== null && (
        <div className={`chapter-outline-panel ${outlinePanelOpen ? 'chapter-outline-panel--open' : ''}`}>
          <div className="chapter-outline-toggle-row">
            <button
              className="chapter-outline-toggle"
              onClick={() => setOutlinePanelOpen(!outlinePanelOpen)}
            >
              {outlinePanelOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <BookOpen size={14} />
              <span>Dàn Ý Chương</span>
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
                  {chapterOutline.summary ? (
                    <div className="chapter-outline-section">
                      <div className="chapter-outline-label">Tóm tắt</div>
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
                      placeholder={"Sự kiện 1\nSự kiện 2\nSự kiện 3..."}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Continuity Bar */}
      <ContinuityBar />

      {/* Editor */}
      <div className="story-editor-wrapper">
        <EditorContent editor={editor} />
      </div>

      {/* Footer */}
      <div className="story-editor-footer">
        <div className="story-editor-stats">
          <span>{wordCount.toLocaleString()} từ</span>
          <span className="story-editor-stats-divider">·</span>
          <span>{charCount.toLocaleString()} ký tự</span>
          {chapterProgress && (
            <>
              <span className="story-editor-stats-divider">·</span>
              <span className="story-editor-progress-label">
                Chương: {chapterProgress.current.toLocaleString()}/{chapterProgress.target.toLocaleString()}
              </span>
            </>
          )}
        </div>

        {chapterProgress && (
          <div className="story-editor-progress">
            <div
              className="story-editor-progress-bar"
              style={{ width: `${chapterProgress.percent}%` }}
              data-complete={chapterProgress.percent >= 100 ? 'true' : 'false'}
            />
          </div>
        )}

        <div className="story-editor-status">
          {chapterProgress && (
            <span className="story-editor-progress-pct">{chapterProgress.percent}%</span>
          )}
          <span className="story-editor-autosave">Tự động lưu</span>
        </div>
      </div>
    </div>
  );
}