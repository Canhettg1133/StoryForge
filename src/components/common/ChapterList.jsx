import React, { useEffect, useRef, useState } from 'react';
import useProjectStore from '../../stores/projectStore';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Trash2,
  Edit3,
  CheckCircle2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react';
import './ChapterList.css';

const CONTEXT_MENU_WIDTH = 220;
const CONTEXT_MENU_PADDING = 12;

function formatStoryLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/^Canh(?=(\s|:|-))/i, 'Cảnh')
    .replace(/^Chuong(?=(\s|:|-))/i, 'Chương');
}

export default function ChapterList({
  allowCollapse = true,
  onItemSelect,
  isMobileLayout = false,
  aiWritingChapterId = null,
  aiWritingSceneId = null,
}) {
  const {
    chapters,
    scenes,
    activeChapterId,
    activeSceneId,
    createChapter,
    createScene,
    deleteChapter,
    deleteScene,
    updateChapter,
    updateScene,
    setActiveChapter,
    setActiveScene,
    refreshChapterWordCount,
    completingChapterId,
    chapterCompletionById,
    runChapterCompletion,
  } = useProjectStore();

  const [expandedChapters, setExpandedChapters] = useState(() => new Set());
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [mobileActionMenu, setMobileActionMenu] = useState(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const contextMenuRef = useRef(null);
  const mobileActionMenuRef = useRef(null);

  useEffect(() => {
    if (!allowCollapse) {
      setPanelCollapsed(false);
    }
  }, [allowCollapse]);

  useEffect(() => {
    setExpandedChapters(new Set(chapters.map((chapter) => chapter.id)));
  }, [chapters]);

  useEffect(() => {
    if (!activeSceneId || !activeChapterId) return;
    const scene = scenes.find((item) => item.id === activeSceneId);
    if (!scene) return;
    refreshChapterWordCount(activeChapterId);
  }, [activeSceneId, activeChapterId, scenes, refreshChapterWordCount]);

  useEffect(() => {
    if (!contextMenu && !(mobileActionMenu && !isMobileLayout)) return undefined;

    const handleDismiss = (event) => {
      if (contextMenuRef.current?.contains(event.target)) return;
      if (mobileActionMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
      setMobileActionMenu(null);
    };

    const handleViewportChange = () => {
      setContextMenu(null);
      setMobileActionMenu(null);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
        setMobileActionMenu(null);
      }
    };

    document.addEventListener('pointerdown', handleDismiss, true);
    document.addEventListener('contextmenu', handleDismiss, true);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', handleDismiss, true);
      document.removeEventListener('contextmenu', handleDismiss, true);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [contextMenu, mobileActionMenu, isMobileLayout]);

  const toggleChapter = (id) => {
    setExpandedChapters((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectScene = (chapterId, sceneId) => {
    setActiveChapter(chapterId);
    setActiveScene(sceneId);
    onItemSelect?.();
  };

  const handleSelectChapter = (chapterId) => {
    setActiveChapter(chapterId);
    const chapterScenes = scenes.filter((scene) => scene.chapter_id === chapterId);
    if (chapterScenes.length > 0) {
      setActiveScene(chapterScenes[0].id);
    }
    setExpandedChapters((previous) => new Set(previous).add(chapterId));
    onItemSelect?.();
  };

  const openForEditing = (type, id, currentName) => {
    if (panelCollapsed) {
      setPanelCollapsed(false);
      if (type === 'chapter') {
        setActiveChapter(id);
        setExpandedChapters((previous) => new Set(previous).add(id));
      } else {
        const targetScene = scenes.find((scene) => scene.id === id);
        if (targetScene) {
          setActiveChapter(targetScene.chapter_id);
          setActiveScene(id);
          setExpandedChapters((previous) => new Set(previous).add(targetScene.chapter_id));
        }
      }
    }
    setEditingId(`${type}-${id}`);
    setEditValue(currentName);
    setContextMenu(null);
    setMobileActionMenu(null);
  };

  const startRename = (type, id, currentName, event) => {
    event.stopPropagation();
    openForEditing(type, id, currentName);
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

  const handleKeyDown = (event, type, id) => {
    if (event.key === 'Enter') commitRename(type, id);
    if (event.key === 'Escape') setEditingId(null);
  };

  const getContextMenuPosition = (type, id, clientX, clientY) => {
    const chapter = type === 'chapter' ? chapters.find((item) => item.id === id) : null;
    const hasCompleteAction = chapter && chapter.status !== 'done';
    const menuHeight = hasCompleteAction ? 150 : 108;

    return {
      x: Math.max(CONTEXT_MENU_PADDING, Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_PADDING)),
      y: Math.max(CONTEXT_MENU_PADDING, Math.min(clientY, window.innerHeight - menuHeight - CONTEXT_MENU_PADDING)),
    };
  };

  const handleContextMenu = (event, type, id) => {
    event.preventDefault();
    event.stopPropagation();
    if (isMobileLayout) return;
    const position = getContextMenuPosition(type, id, event.clientX, event.clientY);
    setContextMenu({ type, id, ...position });
  };

  const openMobileActionMenu = (event, type, id) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setMobileActionMenu({ type, id });
  };

  const handleDelete = async (type, id) => {
    setContextMenu(null);
    setMobileActionMenu(null);
    const message = type === 'chapter'
      ? 'Xóa chương này và tất cả cảnh bên trong?'
      : 'Xóa cảnh này?';

    if (!window.confirm(message)) return;
    if (type === 'chapter') await deleteChapter(id);
    else await deleteScene(id);
  };

  const handleCompleteChapter = async (chapterId) => {
    setContextMenu(null);
    setMobileActionMenu(null);
    try {
      const result = await runChapterCompletion(chapterId, { mode: 'manual' });
      if (!result) return;
      if (result.kind === 'empty') {
        alert('Chuong chua co noi dung de hoan thanh.');
        return;
      }
      if (!result.ok) {
        alert(result.message || 'Khong the hoan thanh chuong.');
      }
      return;
    } catch (error) {
      console.error('[ChapterList] Chapter completion failed:', error);
      alert(error?.message || 'Khong the hoan thanh chuong.');
      return;
    }
  };

  /*

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
      const summary = await summarizeChapter(context);
      if (summary) {
        await saveChapterSummary(chapterId, currentProject.id, summary, chapterText);
      }

      try {
        const extracted = await extractFromChapter(context);
        if (extracted) {
          const projectId = currentProject.id;
          const {
            characters: existingCharacters,
            locations: existingLocations,
            worldTerms: existingTerms,
            objects: existingObjects,
          } = useCodexStore.getState();

          const existsByName = (existingItems, name) =>
            existingItems.some((item) => item.name?.toLowerCase().trim() === name?.toLowerCase().trim());

          if (extracted.characters?.length > 0) {
            for (const character of extracted.characters) {
              if (character.name && !existsByName(existingCharacters, character.name)) {
                await createCharacter({
                  project_id: projectId,
                  name: character.name,
                  role: character.role || 'minor',
                  appearance: character.appearance || '',
                  personality: character.personality || '',
                  flaws: character.flaws || '',
                  personality_tags: character.personality_tags || '',
                });
              }
            }
          }

          if (extracted.locations?.length > 0) {
            for (const location of extracted.locations) {
              if (location.name && !existsByName(existingLocations, location.name)) {
                await createLocation({
                  project_id: projectId,
                  name: location.name,
                  description: location.description || '',
                });
              }
            }
          }

          if (extracted.terms?.length > 0) {
            for (const term of extracted.terms) {
              if (term.name && !existsByName(existingTerms, term.name)) {
                await createWorldTerm({
                  project_id: projectId,
                  name: term.name,
                  definition: term.definition || '',
                  category: term.category || 'other',
                });
              }
            }
          }

          if (extracted.objects?.length > 0) {
            for (const objectItem of extracted.objects) {
              if (objectItem.name && !existsByName(existingObjects, objectItem.name)) {
                await createObject({
                  project_id: projectId,
                  name: objectItem.name,
                  description: objectItem.description || '',
                });
              }
            }
          }

          await loadCodex(projectId);
        }
      } catch (error) {
        console.warn('[ChapterList] Extraction failed (non-fatal):', error);
      }

      await updateChapter(chapterId, { status: 'done' });
    } catch (error) {
      console.error('[ChapterList] Chapter completion failed:', error);
      alert('Không thể hoàn thành chương. Kiểm tra kết nối AI.');
    }

    setCompletingChapterId(null);
  };

  */

  const isCompleting = completingChapterId !== null;
  const getCompletionState = (chapterId) => chapterCompletionById[chapterId] || {};

  const renderDesktopTree = () => (
    <>
      {panelCollapsed && (
        <div className="chapter-list-collapsed-body">
          <div className="chapter-list-collapsed-count" title={`${chapters.length} chương`}>
            {chapters.length}
          </div>

          <div className="chapter-list-collapsed-tree">
            {chapters.map((chapter, index) => {
              const chapterScenes = scenes.filter((scene) => scene.chapter_id === chapter.id);
              const isActiveChapter = activeChapterId === chapter.id;
              const isDone = chapter.status === 'done';
              const isAiWritingChapter = aiWritingChapterId === chapter.id;

              return (
                <div key={chapter.id} className="chapter-list-collapsed-group">
                  <button
                    className={`chapter-list-collapsed-item ${isActiveChapter ? 'chapter-list-collapsed-item--active' : ''} ${isDone ? 'chapter-list-collapsed-item--done' : ''} ${isAiWritingChapter ? 'chapter-list-collapsed-item--ai-writing' : ''}`}
                    onClick={() => handleSelectChapter(chapter.id)}
                    onContextMenu={(event) => handleContextMenu(event, 'chapter', chapter.id)}
                    title={isAiWritingChapter ? `${formatStoryLabel(chapter.title)} - AI dang viet` : formatStoryLabel(chapter.title)}
                  >
                    {isAiWritingChapter ? <Sparkles size={11} /> : `Ch${index + 1}`}
                  </button>

                  {isActiveChapter && (
                    <div className="chapter-list-collapsed-scenes">
                      {chapterScenes.map((scene, sceneIndex) => (
                        <button
                          key={scene.id}
                          className={`chapter-list-collapsed-scene ${activeSceneId === scene.id ? 'chapter-list-collapsed-scene--active' : ''}`}
                          onClick={() => handleSelectScene(chapter.id, scene.id)}
                          onContextMenu={(event) => handleContextMenu(event, 'scene', scene.id)}
                          title={formatStoryLabel(scene.title)}
                        >
                          {`C${sceneIndex + 1}`}
                        </button>
                      ))}

                      <button
                        className="chapter-list-collapsed-add-scene"
                        onClick={(event) => {
                          event.stopPropagation();
                          createScene(chapter.id);
                        }}
                        title="Thêm cảnh"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!panelCollapsed && (
        <div className="chapter-list-tree">
          {chapters.map((chapter) => {
            const chapterScenes = scenes.filter((scene) => scene.chapter_id === chapter.id);
            const isExpanded = expandedChapters.has(chapter.id);
            const isEditingChapter = editingId === `chapter-${chapter.id}`;
            const isDone = chapter.status === 'done';
            const completionState = getCompletionState(chapter.id);
            const isThisCompleting = completionState.running || completingChapterId === chapter.id;
            const isAiWritingChapter = aiWritingChapterId === chapter.id;

            return (
              <div key={chapter.id} className="chapter-node">
                <div
                  className={`chapter-item ${activeChapterId === chapter.id ? 'chapter-item--active' : ''} ${isDone ? 'chapter-item--done' : ''} ${isAiWritingChapter ? 'chapter-item--ai-writing' : ''}`}
                  onContextMenu={(event) => handleContextMenu(event, 'chapter', chapter.id)}
                >
                  <span
                    className="chapter-expand-icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleChapter(chapter.id);
                    }}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>

                  {isEditingChapter ? (
                    <input
                      className="chapter-rename-input"
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      onBlur={() => commitRename('chapter', chapter.id)}
                      onKeyDown={(event) => handleKeyDown(event, 'chapter', chapter.id)}
                      onClick={(event) => event.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="chapter-item-title truncate" onClick={() => handleSelectChapter(chapter.id)}>
                      {isDone && <CheckCircle2 size={12} className="chapter-done-icon" />}
                      {formatStoryLabel(chapter.title)}
                    </span>
                  )}

                  {isThisCompleting && <Loader2 size={14} className="chapter-loading-icon" />}
                  {isAiWritingChapter && (
                    <span className="chapter-ai-writing-badge">
                      <Sparkles size={11} /> AI dang viet
                    </span>
                  )}
                  <span className="chapter-scene-count">{chapterScenes.length}</span>
                  {chapter.actual_word_count > 0 && (
                    <span className="chapter-word-count">{chapter.actual_word_count.toLocaleString()} từ</span>
                  )}
                </div>

                {isExpanded && (
                  <div className="scene-list">
                    {chapterScenes.map((scene) => {
                      const isEditingScene = editingId === `scene-${scene.id}`;
                      const isAiWritingScene = aiWritingSceneId === scene.id;
                      return (
                        <div
                          key={scene.id}
                          className={`scene-item ${activeSceneId === scene.id ? 'scene-item--active' : ''} ${isAiWritingScene ? 'scene-item--ai-writing' : ''}`}
                          onClick={() => handleSelectScene(chapter.id, scene.id)}
                          onContextMenu={(event) => handleContextMenu(event, 'scene', scene.id)}
                        >
                          <FileText size={13} className="scene-item-icon" />
                          {isEditingScene ? (
                            <input
                              className="chapter-rename-input"
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              onBlur={() => commitRename('scene', scene.id)}
                              onKeyDown={(event) => handleKeyDown(event, 'scene', scene.id)}
                              onClick={(event) => event.stopPropagation()}
                              autoFocus
                            />
                          ) : (
                            <span className="scene-item-title truncate">{formatStoryLabel(scene.title)}</span>
                          )}
                          {isAiWritingScene && <Sparkles size={12} className="scene-ai-writing-icon" />}
                        </div>
                      );
                    })}

                    <button
                      className="scene-add-btn"
                      onClick={(event) => {
                        event.stopPropagation();
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
      )}
    </>
  );

  const renderMobileTree = () => (
    <div className="chapter-list-mobile-tree">
      {chapters.map((chapter) => {
        const chapterScenes = scenes.filter((scene) => scene.chapter_id === chapter.id);
        const isExpanded = expandedChapters.has(chapter.id);
        const isEditingChapter = editingId === `chapter-${chapter.id}`;
        const isDone = chapter.status === 'done';
        const completionState = getCompletionState(chapter.id);
        const isThisCompleting = completionState.running || completingChapterId === chapter.id;
        const isAiWritingChapter = aiWritingChapterId === chapter.id;

        return (
          <div key={chapter.id} className="chapter-mobile-group">
            <div className={`chapter-mobile-item ${activeChapterId === chapter.id ? 'chapter-mobile-item--active' : ''} ${isDone ? 'chapter-mobile-item--done' : ''} ${isAiWritingChapter ? 'chapter-mobile-item--ai-writing' : ''}`}>
              <button
                className="chapter-mobile-expand"
                onClick={() => toggleChapter(chapter.id)}
                title={isExpanded ? 'Thu gọn chương' : 'Mở chương'}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              <div className="chapter-mobile-main" onClick={() => handleSelectChapter(chapter.id)}>
                {isEditingChapter ? (
                  <input
                    className="chapter-rename-input"
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                    onBlur={() => commitRename('chapter', chapter.id)}
                    onKeyDown={(event) => handleKeyDown(event, 'chapter', chapter.id)}
                    autoFocus
                  />
                ) : (
                  <>
                    <div className="chapter-mobile-title-row">
                      <span className="chapter-mobile-title">{formatStoryLabel(chapter.title)}</span>
                      {isThisCompleting && <Loader2 size={14} className="chapter-loading-icon" />}
                      {isAiWritingChapter && <Sparkles size={14} className="chapter-ai-writing-icon" />}
                    </div>
                    <div className="chapter-mobile-meta">
                      <span>{chapterScenes.length} cảnh</span>
                      {chapter.actual_word_count > 0 && <span>{chapter.actual_word_count.toLocaleString()} từ</span>}
                      {isAiWritingChapter && <span className="chapter-mobile-ai-writing">AI dang viet</span>}
                    </div>
                  </>
                )}
              </div>

              <button
                className="chapter-mobile-actions"
                onClick={(event) => openMobileActionMenu(event, 'chapter', chapter.id)}
                title="Tác vụ chương"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>

            {isExpanded && (
              <div className="chapter-mobile-scenes">
                {chapterScenes.map((scene, sceneIndex) => {
                  const isEditingScene = editingId === `scene-${scene.id}`;
                  const isAiWritingScene = aiWritingSceneId === scene.id;
                  return (
                    <div
                      key={scene.id}
                      className={`chapter-mobile-scene ${activeSceneId === scene.id ? 'chapter-mobile-scene--active' : ''} ${isAiWritingScene ? 'chapter-mobile-scene--ai-writing' : ''}`}
                      onClick={() => handleSelectScene(chapter.id, scene.id)}
                    >
                      <div className="chapter-mobile-scene-icon">
                        <FileText size={14} />
                      </div>
                      <div className="chapter-mobile-scene-main">
                        {isEditingScene ? (
                          <input
                            className="chapter-rename-input"
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            onBlur={() => commitRename('scene', scene.id)}
                            onKeyDown={(event) => handleKeyDown(event, 'scene', scene.id)}
                            autoFocus
                          />
                        ) : (
                          <>
                            <span className="chapter-mobile-scene-title">{formatStoryLabel(scene.title)}</span>
                            <span className="chapter-mobile-scene-label">
                              Cảnh {sceneIndex + 1}{isAiWritingScene ? ' - AI dang viet' : ''}
                            </span>
                          </>
                        )}
                      </div>
                      <button
                        className="chapter-mobile-actions"
                        onClick={(event) => openMobileActionMenu(event, 'scene', scene.id)}
                        title="Tác vụ cảnh"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  );
                })}

                <button
                  className="chapter-mobile-add-scene"
                  onClick={() => createScene(chapter.id)}
                >
                  <Plus size={14} /> Thêm cảnh
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const mobileActionItem = mobileActionMenu
    ? mobileActionMenu.type === 'chapter'
      ? chapters.find((chapter) => chapter.id === mobileActionMenu.id)
      : scenes.find((scene) => scene.id === mobileActionMenu.id)
    : null;

  return (
    <div className={`chapter-list ${panelCollapsed ? 'chapter-list--collapsed' : ''} ${isMobileLayout ? 'chapter-list--mobile' : ''}`} onClick={() => {
      setContextMenu(null);
      if (!isMobileLayout) setMobileActionMenu(null);
    }}>
      <div className="chapter-list-header">
        {!panelCollapsed && <span className="chapter-list-title">Chương & Cảnh</span>}
        <div className="chapter-list-header-actions">
          {!panelCollapsed && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => createChapter()} title="Thêm chương">
              <Plus size={16} />
            </button>
          )}
          {allowCollapse && (
            <button
              className="btn btn-ghost btn-icon btn-sm chapter-list-panel-toggle"
              onClick={() => {
                setContextMenu(null);
                setMobileActionMenu(null);
                setPanelCollapsed((previous) => !previous);
              }}
              title={panelCollapsed ? 'Mở danh sách chương' : 'Thu gọn danh sách chương'}
            >
              {panelCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          )}
        </div>
      </div>

      {isMobileLayout ? renderMobileTree() : renderDesktopTree()}

      {contextMenu && !isMobileLayout && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={(event) => {
              const item = contextMenu.type === 'chapter'
                ? chapters.find((chapter) => chapter.id === contextMenu.id)
                : scenes.find((scene) => scene.id === contextMenu.id);
              startRename(contextMenu.type, contextMenu.id, item?.title || '', event);
            }}
          >
            <Edit3 size={14} /> Đổi tên
          </button>

          {contextMenu.type === 'chapter' && (() => {
            const chapter = chapters.find((item) => item.id === contextMenu.id);
            return chapter && chapter.status !== 'done' && (
              <button
                className="context-menu-item context-menu-item--success"
                onClick={() => handleCompleteChapter(contextMenu.id)}
                disabled={Boolean(getCompletionState(contextMenu.id).running)}
              >
                {getCompletionState(contextMenu.id).running ? <Loader2 size={14} className="chapter-loading-icon" /> : <CheckCircle2 size={14} />}
                Hoàn thành chương
              </button>
            );
          })()}

          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => handleDelete(contextMenu.type, contextMenu.id)}>
            <Trash2 size={14} /> Xóa
          </button>
        </div>
      )}

      {mobileActionMenu && isMobileLayout && mobileActionItem && (
        <div className="chapter-mobile-sheet-backdrop" onClick={() => setMobileActionMenu(null)} aria-hidden="true">
          <div ref={mobileActionMenuRef} className="chapter-mobile-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="chapter-mobile-sheet-handle" />
            <div className="chapter-mobile-sheet-title">{formatStoryLabel(mobileActionItem.title)}</div>
            <div className="chapter-mobile-sheet-actions">
              <button
                className="chapter-mobile-sheet-btn"
                onClick={(event) => startRename(mobileActionMenu.type, mobileActionMenu.id, mobileActionItem.title || '', event)}
              >
                <Edit3 size={16} /> Đổi tên
              </button>

              {mobileActionMenu.type === 'chapter' && mobileActionItem.status !== 'done' && (
                <button
                  className="chapter-mobile-sheet-btn chapter-mobile-sheet-btn--success"
                  onClick={() => handleCompleteChapter(mobileActionMenu.id)}
                  disabled={Boolean(getCompletionState(mobileActionMenu.id).running)}
                >
                  {getCompletionState(mobileActionMenu.id).running ? <Loader2 size={16} className="chapter-loading-icon" /> : <CheckCircle2 size={16} />}
                  Hoàn thành chương
                </button>
              )}

              <button
                className="chapter-mobile-sheet-btn chapter-mobile-sheet-btn--danger"
                onClick={() => handleDelete(mobileActionMenu.type, mobileActionMenu.id)}
              >
                <Trash2 size={16} /> Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
