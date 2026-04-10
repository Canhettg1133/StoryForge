import React, { useState, useEffect, useRef } from 'react';
import useProjectStore from '../../stores/projectStore';
import useAIStore from '../../stores/aiStore';
import useCodexStore from '../../stores/codexStore';
import {
  Plus, ChevronDown, ChevronRight, FileText, MoreVertical,
  Trash2, Edit3, GripVertical, CheckCircle2, Loader2,
} from 'lucide-react';
import './ChapterList.css';

export default function ChapterList() {
  const {
    chapters, scenes, activeChapterId, activeSceneId,
    currentProject,
    createChapter, createScene, deleteChapter, deleteScene,
    updateChapter, updateScene,
    setActiveChapter, setActiveScene,
    refreshChapterWordCount,
    completingChapterId, setCompletingChapterId,
  } = useProjectStore();

  const { summarizeChapter, extractFromChapter, isSummarizing, isExtracting } = useAIStore();
  const { saveChapterSummary, createCharacter, createLocation, createWorldTerm, createObject, loadCodex } = useCodexStore();

  const [expandedChapters, setExpandedChapters] = useState(new Set(chapters.map(c => c.id)));
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [completeBanner, setCompleteBanner] = useState(null); // { chapterId, title }

  // Sync word counts whenever the active scene changes (real-time update)
  useEffect(() => {
    if (!activeSceneId || !activeChapterId) return;
    const scene = scenes.find(s => s.id === activeSceneId);
    if (!scene) return;
    // If draft_text changed, trigger word count refresh for the chapter
    refreshChapterWordCount(activeChapterId);
  }, [activeSceneId]);

  // Track completion: when completingChapterId goes null → show success banner
  useEffect(() => {
    if (completingChapterId !== null) return;
    const prevRef = prevCompletingRef.current;
    prevCompletingRef.current = null;
    if (!prevRef) return;
    const ch = chapters.find(c => c.id === prevRef);
    setCompleteBanner({ chapterId: prevRef, title: ch?.title || `Chương` });
    const timer = setTimeout(() => setCompleteBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [completingChapterId]);

  const prevCompletingRef = useRef(null);
  useEffect(() => {
    if (completingChapterId !== null) {
      prevCompletingRef.current = completingChapterId;
    }
  }, [completingChapterId]);

  const toggleChapter = (id) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectScene = (chapterId, sceneId) => {
    setActiveChapter(chapterId);
    setActiveScene(sceneId);
  };

  const handleSelectChapter = (chapterId) => {
    setActiveChapter(chapterId);
    // Tự động chọn cảnh đầu tiên nếu có
    const chapterScenes = scenes.filter(s => s.chapter_id === chapterId);
    if (chapterScenes.length > 0) {
      setActiveScene(chapterScenes[0].id);
    }
    // Luôn mở rộng khi chọn chương
    setExpandedChapters(prev => new Set(prev).add(chapterId));
  };

  const startRename = (type, id, currentName, e) => {
    e.stopPropagation();
    setEditingId(`${type}-${id}`);
    setEditValue(currentName);
    setContextMenu(null);
  };

  const commitRename = async (type, id) => {
    if (editValue.trim()) {
      if (type === 'chapter') {
        await updateChapter(id, { title: editValue.trim() });
      } else {
        await updateScene(id, { title: editValue.trim() });
      }
    }
    setEditingId(null);
  };

  const handleKeyDown = (e, type, id) => {
    if (e.key === 'Enter') commitRename(type, id);
    if (e.key === 'Escape') setEditingId(null);
  };

  const handleContextMenu = (e, type, id) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async (type, id) => {
    setContextMenu(null);
    const msg = type === 'chapter'
      ? 'Xoá chương này và tất cả cảnh bên trong?'
      : 'Xoá cảnh này?';
    if (window.confirm(msg)) {
      if (type === 'chapter') await deleteChapter(id);
      else await deleteScene(id);
    }
  };

  // â”€â”€ Phase 3: Chapter Complete â”€â”€
  const handleCompleteChapter = async (chapterId) => {
    setContextMenu(null);
    setCompletingChapterId(chapterId);

    const chapter = chapters.find(c => c.id === chapterId);
    const chapterScenes = scenes.filter(s => s.chapter_id === chapterId);
    const chapterText = chapterScenes
      .map(s => s.draft_text || '')
      .join('\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();

    if (!chapterText) {
      alert('Chương chưa có nội dung để tóm tắt.');
      setCompletingChapterId(null);
      return;
    }

    const context = {
      sceneText: chapterText,
      chapterTitle: chapter?.title || '',
      projectTitle: currentProject?.title || '',
      genre: currentProject?.genre_primary || '',
      projectId: currentProject?.id,
    };

    try {
      // Step 1: Summarize chapter
      const summary = await summarizeChapter(context);
      if (summary) {
        await saveChapterSummary(chapterId, currentProject.id, summary, chapterText);
      }

      // Step 2: Extract new codex entries (with duplicate detection)
      try {
        const extracted = await extractFromChapter(context);
        if (extracted) {
          const pid = currentProject.id;
          // Load current codex for duplicate check
          const { characters: existChars, locations: existLocs, worldTerms: existTerms, objects: existObjs } = useCodexStore.getState();
          const nameMatch = (existing, newName) => existing.some(e => e.name?.toLowerCase().trim() === newName?.toLowerCase().trim());

          // Auto-add new characters (skip duplicates)
          if (extracted.characters?.length > 0) {
            for (const c of extracted.characters) {
              if (c.name && !nameMatch(existChars, c.name)) {
                await createCharacter({
                  project_id: pid,
                  name: c.name,
                  role: c.role || 'minor',
                  appearance: c.appearance || '',
                  personality: c.personality || '',
                  flaws: c.flaws || '',
                  personality_tags: c.personality_tags || '',
                });
              }
            }
          }
          // Auto-add new locations (skip duplicates)
          if (extracted.locations?.length > 0) {
            for (const l of extracted.locations) {
              if (l.name && !nameMatch(existLocs, l.name)) {
                await createLocation({ project_id: pid, name: l.name, description: l.description || '' });
              }
            }
          }
          // Auto-add new terms (skip duplicates)
          if (extracted.terms?.length > 0) {
            for (const t of extracted.terms) {
              if (t.name && !nameMatch(existTerms, t.name)) {
                await createWorldTerm({ project_id: pid, name: t.name, definition: t.definition || '', category: t.category || 'other' });
              }
            }
          }
          // Auto-add new objects (skip duplicates)
          if (extracted.objects?.length > 0) {
            for (const o of extracted.objects) {
              if (o.name && !nameMatch(existObjs, o.name)) {
                await createObject({ project_id: pid, name: o.name, description: o.description || '' });
              }
            }
          }
          await loadCodex(pid);
        }
      } catch (err) {
        console.warn('[ChapterList] Extraction failed (non-fatal):', err);
      }

      // Step 3: Update chapter status
      await updateChapter(chapterId, { status: 'done' });

    } catch (err) {
      console.error('[ChapterList] Chapter completion failed:', err);
      alert('Không thể hoàn thành chương. Kiểm tra kết nối AI.');
    }

    setCompletingChapterId(null);
  };

  const isCompleting = completingChapterId !== null;

  return (
    <div className="chapter-list" onClick={() => setContextMenu(null)}>
      <div className="chapter-list-header">
        <span className="chapter-list-title">Chương & Cảnh</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => createChapter()} title="Thêm chương">
          <Plus size={16} />
        </button>
      </div>

      <div className="chapter-list-tree">
        {chapters.map(chapter => {
          const chapterScenes = scenes.filter(s => s.chapter_id === chapter.id);
          const isExpanded = expandedChapters.has(chapter.id);
          const isEditingChapter = editingId === `chapter-${chapter.id}`;
          const isDone = chapter.status === 'done';
          const isThisCompleting = completingChapterId === chapter.id;

          return (
            <div key={chapter.id} className="chapter-node">
              {/* Chapter header */}
              <div
                className={`chapter-item ${activeChapterId === chapter.id ? 'chapter-item--active' : ''} ${isDone ? 'chapter-item--done' : ''}`}
                onContextMenu={(e) => handleContextMenu(e, 'chapter', chapter.id)}
              >
                <span
                  className="chapter-expand-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleChapter(chapter.id);
                  }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>

                {isEditingChapter ? (
                  <input
                    className="chapter-rename-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename('chapter', chapter.id)}
                    onKeyDown={(e) => handleKeyDown(e, 'chapter', chapter.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className="chapter-item-title truncate"
                    onClick={() => handleSelectChapter(chapter.id)}
                  >
                    {isDone && <CheckCircle2 size={12} className="chapter-done-icon" />}
                    {chapter.title}
                  </span>
                )}

                {isThisCompleting && <Loader2 size={14} className="chapter-loading-icon" />}
                <span className="chapter-scene-count">{chapterScenes.length}</span>
                {chapter.actual_word_count > 0 && (
                  <span className="chapter-word-count">{chapter.actual_word_count.toLocaleString()} từ</span>
                )}
              </div>

              {/* Scenes */}
              {isExpanded && (
                <div className="scene-list">
                  {chapterScenes.map(scene => {
                    const isEditingScene = editingId === `scene-${scene.id}`;
                    return (
                      <div
                        key={scene.id}
                        className={`scene-item ${activeSceneId === scene.id ? 'scene-item--active' : ''}`}
                        onClick={() => handleSelectScene(chapter.id, scene.id)}
                        onContextMenu={(e) => handleContextMenu(e, 'scene', scene.id)}
                      >
                        <FileText size={13} className="scene-item-icon" />
                        {isEditingScene ? (
                          <input
                            className="chapter-rename-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitRename('scene', scene.id)}
                            onKeyDown={(e) => handleKeyDown(e, 'scene', scene.id)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                        ) : (
                          <span className="scene-item-title truncate">{scene.title}</span>
                        )}
                      </div>
                    );
                  })}

                  <button
                    className="scene-add-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      createScene(chapter.id);
                    }}
                  >
                    <Plus size={12} /> Thêm cảnh
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={(e) => {
              const item = contextMenu.type === 'chapter'
                ? chapters.find(c => c.id === contextMenu.id)
                : scenes.find(s => s.id === contextMenu.id);
              startRename(contextMenu.type, contextMenu.id, item?.title || '', e);
            }}
          >
            <Edit3 size={14} /> Đổi tên
          </button>

          {/* Chapter Complete button — only for chapters not already done */}
          {contextMenu.type === 'chapter' && (() => {
            const chapter = chapters.find(c => c.id === contextMenu.id);
            return chapter && chapter.status !== 'done' && (
              <button
                className="context-menu-item context-menu-item--success"
                onClick={() => handleCompleteChapter(contextMenu.id)}
                disabled={isCompleting}
              >
                {isCompleting ? <Loader2 size={14} className="chapter-loading-icon" /> : <CheckCircle2 size={14} />}
                Hoàn thành chương
              </button>
            );
          })()}

          <div className="context-menu-divider" />
          <button
            className="context-menu-item danger"
            onClick={() => handleDelete(contextMenu.type, contextMenu.id)}
          >
            <Trash2 size={14} /> Xoá
          </button>
        </div>
      )}
    </div>
  );
}
