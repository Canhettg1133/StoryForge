/**
 * StoryForge — Outline Board (Phase 3→4 Bridge)
 * 
 * Visual chapter/scene planning board with 3-act structure.
 * Uses existing DB fields: summary, purpose, arc_id (as act), goal, conflict, pov, location.
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  CheckCircle2, GitPullRequest, Search, Combine
} from 'lucide-react';
import { SCENE_STATUSES } from '../../utils/constants';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import './OutlineBoard.css';

const ACTS = [
  { id: 1, label: 'Hồi 1 — Thiết lập', desc: 'Giới thiệu, sự kiện khởi đầu', percent: '25%', color: 'var(--color-info)' },
  { id: 2, label: 'Hồi 2 — Xung đột', desc: 'Leo thang, bước ngoặt, khủng hoảng', percent: '50%', color: 'var(--color-warning)' },
  { id: 3, label: 'Hồi 3 — Giải quyết', desc: 'Cao trào, kết thúc', percent: '25%', color: 'var(--color-success)' },
];

export default function OutlineBoard() {
  const navigate = useNavigate();
  const {
    currentProject, chapters, scenes,
    createChapter, updateChapter,
    setActiveChapter, setActiveScene,
  } = useProjectStore();
  const { characters, locations, loadCodex } = useCodexStore();
  const { plotThreads, loadPlotThreads, loadThreadBeatsForProject } = usePlotStore();

  const [selectedChapter, setSelectedChapter] = useState(null);
  const [viewMode, setViewMode] = useState('board'); // 'board' | 'list'
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState(null);

  // Plot Threads modal state
  const [showPlotModal, setShowPlotModal] = useState(false);
  const [editingThread, setEditingThread] = useState(null);

  // Arc Gen Modal state
  const [showArcGen, setShowArcGen] = useState(false);

  useEffect(() => {
    if (currentProject) {
      loadCodex(currentProject.id);
      loadPlotThreads(currentProject.id);
      loadThreadBeatsForProject(currentProject.id);
    }
  }, [currentProject?.id]);

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

  // Scene count per chapter
  const sceneCountMap = useMemo(() => {
    const map = {};
    chapters.forEach(ch => {
      map[ch.id] = scenes.filter(s => s.chapter_id === ch.id).length;
    });
    return map;
  }, [chapters, scenes]);

  // Word count per chapter
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

  // Get POV character name for a chapter (from first scene)
  const getChapterPOV = (chapterId) => {
    const firstScene = scenes.find(s => s.chapter_id === chapterId && s.pov_character_id);
    if (!firstScene?.pov_character_id) return null;
    return characters.find(c => c.id === firstScene.pov_character_id)?.name || null;
  };

  // Get location name for a chapter (from first scene)
  const getChapterLocation = (chapterId) => {
    const firstScene = scenes.find(s => s.chapter_id === chapterId && s.location_id);
    if (!firstScene?.location_id) return null;
    return locations.find(l => l.id === firstScene.location_id)?.name || null;
  };

  // Navigate to editor
  const goToEditor = (chapterId) => {
    const scene = scenes.find(s => s.chapter_id === chapterId);
    setActiveChapter(chapterId);
    if (scene) setActiveScene(scene.id);
    navigate('/editor');
  };

  // Add chapter to specific act
  const addChapterToAct = async (act) => {
    await createChapter();
    // Set the latest chapter's arc_id
    const latest = await useProjectStore.getState().chapters;
    const last = latest[latest.length - 1];
    if (last) await updateChapter(last.id, { arc_id: act });
  };

  // AI Generate Outline
  const handleAIOutline = async () => {
    if (!currentProject) return;
    setIsGenerating(true);
    setGenError(null);

    const charList = characters.map(c => `${c.name} (${c.role})`).join(', ');
    const locList = locations.map(l => l.name).join(', ');

    const existingOutline = chapters.length > 0
      ? chapters.map((ch, i) => `${i + 1}. ${ch.title}${ch.purpose ? ' — ' + ch.purpose : ''}`).join('\n')
      : 'Chưa có outline';

    const systemPrompt = `Bạn là trợ lý lập kế hoạch truyện cho thể loại ${currentProject.genre_primary || 'fantasy'}.

Thông tin truyện:
- Tên: ${currentProject.title}
- Mô tả: ${currentProject.description || 'Chưa có'}
- Nhân vật: ${charList || 'Chưa có'}
- Địa điểm: ${locList || 'Chưa có'}
- Outline hiện tại: ${existingOutline}

${chapters.length > 0
        ? 'Phân tích outline hiện tại và GỢI Ý purpose (mục tiêu) + summary (tóm tắt) cho từng chương. Gán mỗi chương vào act (1, 2, hoặc 3).'
        : 'Tạo outline 10 chương theo cấu trúc 3 hồi. Mỗi chương phải có mục tiêu rõ ràng.'}

Trả về CHÍNH XÁC JSON:
{ "chapters": [{"title":"...","purpose":"mục tiêu chương 1-2 câu","summary":"tóm tắt nội dung 2-3 câu","act":1}] }`;

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user', content: chapters.length > 0
          ? 'Phân tích và bổ sung outline cho các chương hiện có.'
          : `Tạo outline 10 chương cho truyện "${currentProject.title}".`
      },
    ];

    aiService.send({
      taskType: TASK_TYPES.PROJECT_WIZARD,
      messages,
      stream: false,
      onComplete: async (text) => {
        setIsGenerating(false);
        try {
          let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          const startIdx = cleaned.indexOf('{');
          if (startIdx === -1) throw new Error('No JSON');
          let depth = 0, endIdx = -1;
          for (let i = startIdx; i < cleaned.length; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
          }
          if (endIdx === -1) throw new Error('Incomplete JSON');
          const parsed = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
          const aiChapters = parsed.chapters || [];

          if (chapters.length > 0) {
            // Update existing chapters
            for (let i = 0; i < Math.min(aiChapters.length, chapters.length); i++) {
              await updateChapter(chapters[i].id, {
                purpose: aiChapters[i].purpose || '',
                summary: aiChapters[i].summary || '',
                arc_id: aiChapters[i].act || null,
              });
            }
          } else {
            // Create new chapters
            for (const ac of aiChapters) {
              await createChapter(currentProject.id, ac.title);
              const latest = useProjectStore.getState().chapters;
              const last = latest[latest.length - 1];
              if (last) {
                await updateChapter(last.id, {
                  purpose: ac.purpose || '',
                  summary: ac.summary || '',
                  arc_id: ac.act || null,
                });
              }
            }
          }
        } catch (e) {
          console.error('[OutlineBoard] AI parse error:', e);
          setGenError('Không parse được. Thử lại?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setGenError(err.message || 'Lỗi AI');
      },
    });
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
    <div className="outline-board">
      {/* Header */}
      <div className="outline-header">
        <div className="outline-header-left">
          <h2><Map size={22} /> Outline Board</h2>
          <span className="codex-count">{chapters.length} chương</span>
        </div>

        <div className="outline-header-actions">
          <div className="outline-view-toggle">
            <button
              className={`btn btn-ghost btn-sm ${viewMode === 'board' ? 'btn--active' : ''}`}
              onClick={() => setViewMode('board')}
            >
              <LayoutGrid size={14} /> Board
            </button>
            <button
              className={`btn btn-ghost btn-sm ${viewMode === 'list' ? 'btn--active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <List size={14} /> List
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

      <div className="outline-layout">
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
            /* ── Board View: 3-Act Lanes ── */
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

                    <button
                      className="outline-add-card"
                      onClick={() => addChapterToAct(act.id)}
                    >
                      <Plus size={14} /> Thêm vào {act.label.split('—')[0].trim()}
                    </button>
                  </div>
                </div>
              ))}

              {/* Unassigned */}
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
            /* ── List View ── */
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
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openThreadModal(null)} title="Thêm tuyến truyện">
              <Plus size={16} />
            </button>
          </div>
          <div className="plot-sidebar-body">
            {plotThreads.length === 0 ? (
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
                    {pt.state === 'resolved' && <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} />}
                    {pt.state === 'active' && <GitPullRequest size={12} style={{ color: 'var(--color-accent)' }} />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Chapter Detail Modal */}
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

      {/* Plot Thread Edit Modal */}
      {showPlotModal && (
        <PlotThreadModal
          projectId={currentProject.id}
          thread={editingThread}
          onClose={() => setShowPlotModal(false)}
        />
      )}

      {/* Arc Generation Modal */}
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
