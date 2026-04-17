/**
 * StoryForge — Outline Board (Phase 3→4 Bridge)
 * 
 * Visual chapter/scene planning board with 3-act structure.
 * Uses existing DB fields: summary, purpose, arc_id (as act), goal, conflict, pov, location.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import usePlotStore from '../../stores/plotStore';
import ChapterDetailModal from './ChapterDetailModal';
import PlotThreadModal from './PlotThreadModal';
import ArcGenerationModal from './ArcGenerationModal';
import {
  Map, Plus, Sparkles, Loader2, ChevronDown, FileText,
  Users, MapPin, Target, Zap, PenTool, LayoutGrid, List,
  CheckCircle2, GitPullRequest, Search, Combine, X, ArrowRight
} from 'lucide-react';
import { SCENE_STATUSES } from '../../utils/constants';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import {
  getStoryCreationSettings,
  renderStoryCreationTemplate,
} from '../../services/ai/storyCreationSettings';
import useMobileLayout from '../../hooks/useMobileLayout';
import './OutlineBoard.css';

const ACTS = [
  { id: 1, label: 'Hồi 1 — Thiết lập', desc: 'Giới thiệu, sự kiện khởi đầu', percent: '25%', color: 'var(--color-info)' },
  { id: 2, label: 'Hồi 2 — Xung đột', desc: 'Leo thang, bước ngoặt, khủng hoảng', percent: '50%', color: 'var(--color-warning)' },
  { id: 3, label: 'Hồi 3 — Giải quyết', desc: 'Cao trào, kết thúc', percent: '25%', color: 'var(--color-success)' },
];

const VALID_THREAD_TYPES = ['main', 'subplot', 'character_arc', 'mystery', 'romance'];

export default function OutlineBoard() {
  const navigate = useNavigate();
  const {
    currentProject, chapters, scenes,
    createChapter, updateChapter,
    setActiveChapter, setActiveScene,
  } = useProjectStore();
  const { characters, locations, loadCodex } = useCodexStore();
  const { plotThreads, loadPlotThreads, loadThreadBeatsForProject, createPlotThread, deletePlotThread } = usePlotStore();

  const [selectedChapter, setSelectedChapter] = useState(null);
  const [viewMode, setViewMode] = useState('board');
  const isMobileLayout = useMobileLayout(900);
  const [mobileTab, setMobileTab] = useState('chapters');
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState(null);

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
      loadCodex(currentProject.id);
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

  const sceneCountMap = useMemo(() => {
    const map = {};
    chapters.forEach(ch => {
      map[ch.id] = scenes.filter(s => s.chapter_id === ch.id).length;
    });
    return map;
  }, [chapters, scenes]);

  const wordCountMap = useMemo(() => {
    const map = {};
    chapters.forEach(ch => {
      const chScenes = scenes.filter(s => s.chapter_id === ch.id);
      map[ch.id] = chScenes.reduce((sum, s) => {
        const text = (s.draft_text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
        return sum + (text.trim() ? text.trim().split(/\s+/).length : 0);
      }, 0);
    });
    return map;
  }, [chapters, scenes]);

  const getChapterPOV = (chapterId) => {
    const firstScene = scenes.find(s => s.chapter_id === chapterId && s.pov_character_id);
    if (!firstScene?.pov_character_id) return null;
    return characters.find(c => c.id === firstScene.pov_character_id)?.name || null;
  };

  const getChapterLocation = (chapterId) => {
    const firstScene = scenes.find(s => s.chapter_id === chapterId && s.location_id);
    if (!firstScene?.location_id) return null;
    return locations.find(l => l.id === firstScene.location_id)?.name || null;
  };

  const goToEditor = (chapterId) => {
    const scene = scenes.find(s => s.chapter_id === chapterId);
    setActiveChapter(chapterId);
    if (scene) setActiveScene(scene.id);
    navigate(`/project/${currentProject.id}/editor`);
  };

  const addChapterToAct = async (act) => {
    await createChapter(undefined, undefined, { arc_id: act });
  };

  // AI Generate Outline
  const handleAIOutline = async () => {
    if (!currentProject) return;
    setIsGenerating(true);
    setGenError(null);

    const charList = characters.map((c) => `${c.name} (${c.role})`).join(', ');
    const locList = locations.map((l) => l.name).join(', ');
    const existingOutline = chapters.length > 0
      ? chapters.map((ch, i) => `${i + 1}. ${ch.title}${ch.purpose ? ' - ' + ch.purpose : ''}`).join('\n')
      : 'Chua co outline';

    const storyCreationSettings = getStoryCreationSettings();
    const outlinePrompts = storyCreationSettings.outlineGeneration;
    const outlineTaskInstruction = chapters.length > 0
      ? 'Phan tich outline hien tai va GOI Y purpose (muc tieu) + summary (tom tat) cho tung chuong. Gan moi chuong vao act (1, 2, hoac 3).'
      : 'Tao outline 10 chuong theo cau truc 3 hoi. Moi chuong phai co muc tieu ro rang.';
    const outlineUserRequest = chapters.length > 0
      ? 'Phan tich va bo sung outline cho cac chuong hien co.'
      : `Tao outline 10 chuong cho truyen "${currentProject.title}".`;
    const outlineTemplateVariables = {
      genre: currentProject.genre_primary || 'fantasy',
      project_title: currentProject.title,
      project_description: currentProject.description || 'Chua co',
      character_list: charList || 'Chua co',
      location_list: locList || 'Chua co',
      existing_outline: existingOutline,
      outline_task_instruction: outlineTaskInstruction,
      outline_user_request: outlineUserRequest,
    };

    const messages = [
      { role: 'system', content: '' },
      { role: 'user', content: '' },
    ];

    messages[0].content = renderStoryCreationTemplate(outlinePrompts.systemPrompt, outlineTemplateVariables);
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
          if (!normalized) throw new Error('Unexpected JSON format');

          const nextChapters = Array.isArray(normalized.chapters) ? normalized.chapters : [];

          if (chapters.length > 0) {
            for (let i = 0; i < Math.min(nextChapters.length, chapters.length); i++) {
              await updateChapter(chapters[i].id, {
                purpose: nextChapters[i].purpose || '',
                summary: nextChapters[i].summary || '',
                arc_id: nextChapters[i].act || null,
              });
            }
          } else {
            for (const ac of nextChapters) {
              await createChapter(currentProject.id, ac.title, {
                purpose: ac.purpose || '',
                summary: ac.summary || '',
                arc_id: ac.act || null,
              });
            }
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
          return;
        } catch (e) {
          console.error('[OutlineBoard] AI parse error:', e);
          setGenError('Khong parse duoc. Thu lai?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setGenError(err.message || 'Loi AI');
      },
    });
  };

  // AI Suggest Threads - nhan hint tuy chon tu tac gia
  const handleSuggestThreads = async () => {
    if (!currentProject || isSuggesting) return;
    setIsSuggesting(true);
    setShowSuggestInput(false);

    const synopsisText = currentProject.synopsis || currentProject.description || 'Chua co';
    const charList = characters.map((c) => `${c.name} (${c.role})`).join(', ') || 'Chua co';
    const chapterList = chapters.length > 0
      ? chapters.map((ch, i) =>
        `${i + 1}. ${ch.title}${ch.purpose ? ' - ' + ch.purpose : ''}${ch.summary ? ': ' + ch.summary : ''}`
      ).join('\n')
      : 'Chua co';
    const existingThreads = plotThreads.length > 0
      ? plotThreads.map((pt) => `- [${pt.type}] ${pt.title}: ${pt.description || ''}`).join('\n')
      : 'Chua co';

    const hintSection = suggestHint.trim()
      ? `
Huong di tac gia muon khai thac: ${suggestHint.trim()}
Uu tien goi y theo huong nay neu phu hop voi cau chuyen.
`
      : '';

    const storyCreationSettings = getStoryCreationSettings();
    const threadPrompts = storyCreationSettings.threadSuggestion;
    const threadUserRequest = 'Hay phan tich va goi y tuyen truyen moi cho toi.';
    const threadTemplateVariables = {
      project_title: currentProject.title,
      genre: currentProject.genre_primary || 'Chua co',
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

    messages[0].content = renderStoryCreationTemplate(threadPrompts.systemPrompt, threadTemplateVariables);
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
          if (!normalized) throw new Error('Unexpected JSON format');

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
    if (!window.confirm(`Xóa tuyến truyện "${pt.title}"? Các beat liên quan cũng sẽ bị xóa.`)) return;
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

  const renderChapterCard = (chapter) => {
    const statusObj = SCENE_STATUSES.find(s => s.value === chapter.status) || SCENE_STATUSES[0];
    const povName = getChapterPOV(chapter.id);
    const locName = getChapterLocation(chapter.id);
    const sceneCount = sceneCountMap[chapter.id] || 0;
    const wordCount = wordCountMap[chapter.id] || 0;
    const isDone = chapter.status === 'done';

    return (
      <div
        key={chapter.id}
        className={`outline-card ${isDone ? 'outline-card--done' : ''}`}
        onClick={() => setSelectedChapter(chapter)}
      >
        <div className="outline-card-header">
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

        <div className="outline-card-actions" onClick={e => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => goToEditor(chapter.id)} title="Mở editor">
            <PenTool size={12} /> Viết
          </button>
        </div>
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

          <button
            className="btn btn-accent btn-sm"
            style={{ backgroundImage: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff' }}
            onClick={() => setShowArcGen(true)}
          >
            <Sparkles size={14} /> Tạo Chương Tự Động
          </button>

          <button
            className="btn btn-accent btn-sm"
            onClick={handleAIOutline}
            disabled={isGenerating}
          >
            {isGenerating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {chapters.length > 0 ? 'AI Phân tích' : 'AI Outline'}
          </button>

          <button className="btn btn-primary btn-sm" onClick={() => createChapter()}>
            <Plus size={15} /> Thêm chương
          </button>
        </div>
      </div>

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
                <p>Bổ sung mục tiêu, tóm tắt và hồi cho các chương hiện tại.</p>
              </div>
              <button className="btn btn-secondary" onClick={handleAIOutline} disabled={isGenerating}>
                {isGenerating ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                Chạy AI
              </button>
            </div>
            <div className="outline-mobile-validator-note">
              Trình kiểm tra sẽ hiện cảnh báo ngắn. Nếu bản nháp bị chặn, bạn vẫn có thể lưu dàn ý để sửa tiếp.
            </div>
          </div>
        )}
        <div className="outline-main">
          {genError && (
            <div className="outline-error">{genError}</div>
          )}

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
                <button className="btn btn-primary" onClick={() => createChapter()}>
                  <Plus size={16} /> Thêm chương
                </button>
              </div>
            </div>
          ) : viewMode === 'board' ? (
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

                  <div className="outline-lane-body">
                    {chaptersByAct[act.id].map(renderChapterCard)}
                    <button className="outline-add-card" onClick={() => addChapterToAct(act.id)}>
                      <Plus size={14} /> Thêm vào {act.label.split('—')[0].trim()}
                    </button>
                  </div>
                </div>
              ))}

              {chaptersByAct.unassigned.length > 0 && (
                <div className="outline-lane outline-lane--unassigned">
                  <div className="outline-lane-header">
                    <div>
                      <h3 className="outline-lane-title">Chưa gán hồi</h3>
                      <span className="outline-lane-desc">Click vào chương → chọn hồi</span>
                    </div>
                  </div>
                  <div className="outline-lane-body">
                    {chaptersByAct.unassigned.map(renderChapterCard)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="outline-list">
              {chapters.map((chapter, idx) => {
                const act = ACTS.find(a => a.id === chapter.arc_id);
                return (
                  <div key={chapter.id} className="outline-list-item" onClick={() => setSelectedChapter(chapter)}>
                    <span className="outline-list-index">{idx + 1}</span>
                    {act && <span className="outline-list-act" style={{ color: act.color }}>H{act.id}</span>}
                    <div className="outline-list-content">
                      <strong>{chapter.title}</strong>
                      {chapter.purpose && <span className="outline-list-purpose"> — {chapter.purpose}</span>}
                    </div>
                    <span className="outline-list-scenes">{sceneCountMap[chapter.id]} cảnh</span>
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); goToEditor(chapter.id); }}>
                      <PenTool size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
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
