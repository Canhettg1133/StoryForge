import React, { useEffect, useState, useMemo } from 'react';
import useProjectStore from '../../stores/projectStore';
import {
  GENRES, TONES, POV_MODES, STORY_STRUCTURES,
  PRONOUN_STYLE_PRESETS, GENRE_TO_PRONOUN_STYLE,
} from '../../utils/constants';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';
import { X, Sparkles, PenTool, Eye, BookOpen, MessageSquare, BookKey } from 'lucide-react';
import ProjectWizard from './ProjectWizard';
import { listAvailableCanonPacks } from '../../services/labLite/canonPackRepository.js';
import {
  createProjectFromBibleTemplate,
  getBibleTemplateSourceSummary,
} from '../../services/projects/projectTemplateService.js';
import {
  CANON_ADHERENCE_LEVELS,
  FANFIC_TYPES,
  PROJECT_MODES,
  generateFanficProjectSeed,
} from '../../services/labLite/fanficProjectSetup.js';

function clampInitialChapterCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 10;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

const TEMPLATE_INCLUDE_DEFAULTS = {
  settings: true,
  worldProfile: true,
  characters: true,
  locations: true,
  objects: true,
  worldTerms: true,
  factions: true,
  relationships: true,
  taboos: true,
  canonFacts: false,
};

const TEMPLATE_INCLUDE_OPTIONS = [
  { key: 'settings', label: 'Cài đặt & prompt', description: 'Genre, tone, POV, xưng hô, guideline và prompt templates.' },
  { key: 'worldProfile', label: 'Hồ sơ thế giới', description: 'Tên thế giới, loại thế giới, quy mô, thời đại và luật nền.' },
  { key: 'characters', label: 'Nhân vật', description: 'Hồ sơ nhân vật, alias, vai trò, giọng và trạng thái hiện tại.' },
  { key: 'locations', label: 'Địa điểm', description: 'Địa danh và quan hệ địa điểm cha/con.' },
  { key: 'objects', label: 'Vật phẩm', description: 'Vật phẩm, chủ sở hữu và vị trí hiện tại nếu có thể remap.' },
  { key: 'worldTerms', label: 'Thuật ngữ', description: 'Khái niệm, thuật ngữ và định nghĩa world-builder.' },
  { key: 'factions', label: 'Thế lực', description: 'Tông môn, tổ chức, phe phái hoặc vương triều.' },
  { key: 'relationships', label: 'Quan hệ', description: 'Chỉ copy khi cả hai nhân vật đều được mang sang.' },
  { key: 'taboos', label: 'Cấm kỵ', description: 'Cấm kỵ chung hoặc cấm kỵ gắn với nhân vật được remap.' },
  { key: 'canonFacts', label: 'Canon facts nền', description: 'Tùy chọn rủi ro cao, mặc định tắt để tránh kéo ký ức truyện cũ.' },
];

function getTemplateCount(summary, key) {
  return Number(summary?.counts?.[key] || 0);
}

function buildTemplateIncludeFromCounts(counts = {}) {
  const next = { ...TEMPLATE_INCLUDE_DEFAULTS };
  for (const item of TEMPLATE_INCLUDE_OPTIONS) {
    if (item.key !== 'settings' && Number(counts[item.key] || 0) <= 0) {
      next[item.key] = false;
    }
  }
  if (!next.characters) {
    next.relationships = false;
    next.taboos = false;
  }
  return next;
}

export default function NewProjectModal({ onClose, onCreated }) {
  const { createProject, createChapter, projects, loadProjects } = useProjectStore();
  const [mode, setMode] = useState(null); // null = choose, 'manual' = form, 'ai' = wizard, 'template' = Bible transfer
  const [canonPacks, setCanonPacks] = useState([]);
  const [fanficForm, setFanficForm] = useState({
    title: '',
    canonPackId: '',
    fanficType: 'continue_after_ending',
    adherenceLevel: 'balanced',
    divergencePoint: '',
  });
  const [form, setForm] = useState({
    title: '',
    genre_primary: 'fantasy',
    tone: '',
    audience: '',
    description: '',
    // New fields
    pov_mode: 'third_limited',
    pronoun_style: '',
    synopsis: '',
    story_structure: '',
    target_length_type: 'unset',
    target_length: 0,
    initial_chapter_count: 10,
    ultimate_goal: '',
  });
  const [templateForm, setTemplateForm] = useState({
    sourceProjectId: '',
    title: '',
    description: '',
    synopsis: '',
    initial_chapter_count: 1,
  });
  const [templateInclude, setTemplateInclude] = useState(TEMPLATE_INCLUDE_DEFAULTS);
  const [templateSummary, setTemplateSummary] = useState(null);
  const [templateSummaryLoading, setTemplateSummaryLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listAvailableCanonPacks()
      .then((packs) => {
        setCanonPacks(packs);
        if (packs[0]?.id) {
          setFanficForm((prev) => ({ ...prev, canonPackId: prev.canonPackId || packs[0].id }));
        }
      })
      .catch(() => setCanonPacks([]));
  }, []);

  const sourceProjects = useMemo(
    () => (projects || []).filter((project) => project?.id),
    [projects],
  );

  useEffect(() => {
    if (mode !== 'template') return;
    loadProjects().catch((error) => {
      console.error('Failed to load source projects:', error);
      setTemplateError('Không tải được danh sách dự án nguồn.');
    });
  }, [mode, loadProjects]);

  useEffect(() => {
    if (mode !== 'template' || templateForm.sourceProjectId || sourceProjects.length === 0) return;
    setTemplateForm((prev) => ({
      ...prev,
      sourceProjectId: String(sourceProjects[0].id),
    }));
  }, [mode, sourceProjects, templateForm.sourceProjectId]);

  useEffect(() => {
    if (mode !== 'template') return undefined;
    const sourceProjectId = Number(templateForm.sourceProjectId);
    if (!Number.isFinite(sourceProjectId) || sourceProjectId <= 0) {
      setTemplateSummary(null);
      return undefined;
    }

    let cancelled = false;
    setTemplateSummaryLoading(true);
    setTemplateError('');
    getBibleTemplateSourceSummary(sourceProjectId)
      .then((summary) => {
        if (cancelled) return;
        setTemplateSummary(summary);
        setTemplateInclude(buildTemplateIncludeFromCounts(summary?.counts || {}));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to summarize source project:', error);
        setTemplateSummary(null);
        setTemplateError('Không đọc được Bible của dự án nguồn.');
      })
      .finally(() => {
        if (!cancelled) setTemplateSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, templateForm.sourceProjectId]);

  const handleChange = (field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Auto-update pronoun style when genre changes
      if (field === 'genre_primary') {
        next.pronoun_style = GENRE_TO_PRONOUN_STYLE[value] || 'hien_dai';
      }
      return next;
    });
  };

  // Get pronoun preset info for display
  const pronounPreset = useMemo(() =>
    PRONOUN_STYLE_PRESETS.find(p => p.value === (form.pronoun_style || GENRE_TO_PRONOUN_STYLE[form.genre_primary] || 'hien_dai'))
    , [form.pronoun_style, form.genre_primary]);

  // Lấy thông tin DNA của thể loại đang chọn để hiển thị hint
  const selectedTemplate = GENRE_TEMPLATES[form.genre_primary];
  const dnaHint = useMemo(() => {
    if (!selectedTemplate) return null;
    const parts = [];
    if (selectedTemplate.constitution?.length) parts.push(`${selectedTemplate.constitution.length} luật Constitution`);
    if (selectedTemplate.style_dna?.length) parts.push(`${selectedTemplate.style_dna.length} Style DNA`);
    if (selectedTemplate.anti_ai_blacklist?.length) parts.push(`${selectedTemplate.anti_ai_blacklist.length} từ Blacklist`);
    return parts.length ? parts.join(' · ') : null;
  }, [selectedTemplate]);

  const handleTargetLengthTypeChange = (value) => {
    let nextLength = Number(form.target_length) || 0;
    if (value === 'short') nextLength = 50;
    else if (value === 'medium') nextLength = 150;
    else if (value === 'long') nextLength = 400;
    else if (value === 'epic') nextLength = 800;
    else if (value === 'unset') nextLength = 0;

    setForm((prev) => ({
      ...prev,
      target_length_type: value,
      target_length: nextLength,
    }));
  };

  const handleTemplateFormChange = (field, value) => {
    setTemplateForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleTemplateSourceChange = (value) => {
    setTemplateForm((prev) => ({ ...prev, sourceProjectId: value }));
    setTemplateSummary(null);
    setTemplateError('');
  };

  const handleTemplateIncludeChange = (key, checked) => {
    setTemplateInclude((prev) => {
      const next = { ...prev, [key]: checked };
      if (key === 'characters') {
        if (!checked) {
          next.relationships = false;
          next.taboos = false;
        } else {
          next.relationships = getTemplateCount(templateSummary, 'relationships') > 0;
          next.taboos = getTemplateCount(templateSummary, 'taboos') > 0;
        }
      }
      return next;
    });
  };

  const isTemplateIncludeDisabled = (key) => {
    if (!templateSummary || templateSummaryLoading) return true;
    if (key !== 'settings' && getTemplateCount(templateSummary, key) <= 0) return true;
    if ((key === 'relationships' || key === 'taboos') && !templateInclude.characters) return true;
    return false;
  };

  const handleTemplateSubmit = async (event) => {
    event.preventDefault();
    if (!templateForm.sourceProjectId || !templateForm.title.trim() || templateSummaryLoading || !templateSummary) return;
    setCreating(true);
    setTemplateError('');
    try {
      const result = await createProjectFromBibleTemplate({
        sourceProjectId: Number(templateForm.sourceProjectId),
        projectData: {
          title: templateForm.title.trim(),
          description: templateForm.description,
          synopsis: templateForm.synopsis,
        },
        include: templateInclude,
        initialChapterCount: clampInitialChapterCount(templateForm.initial_chapter_count),
      });
      await loadProjects();
      onCreated(result.projectId, { path: `/project/${result.projectId}/story-bible` });
    } catch (err) {
      console.error('Failed to create project from Bible template:', err);
      setTemplateError(err?.message || 'Không tạo được truyện mới từ Bible.');
      setCreating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      // DNA Văn phong tự động được bơm bởi buildInitialPromptTemplates() trong projectStore
      const id = await createProject({
        ...form,
        pronoun_style: form.pronoun_style || GENRE_TO_PRONOUN_STYLE[form.genre_primary] || 'hien_dai',
        target_length: Number(form.target_length) || 0,
        initial_chapter_count: clampInitialChapterCount(form.initial_chapter_count),
        skipFirstChapter: true,
      });
      const initialChapterCount = clampInitialChapterCount(form.initial_chapter_count);
      for (let index = 0; index < initialChapterCount; index += 1) {
        await createChapter(id, `Chương ${index + 1}`);
      }
      onCreated(id);
    } catch (err) {
      console.error('Failed to create project:', err);
      setCreating(false);
    }
  };

  const handleFanficSubmit = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
      const selectedPack = canonPacks.find((pack) => pack.id === fanficForm.canonPackId) || null;
      if (!selectedPack) {
        const id = await createProject({
          title: fanficForm.title.trim() || 'Dự án đồng nhân mới',
          description: 'Dự án đồng nhân / viết lại theo canon. Hãy tạo Canon Pack trong Lab Lite trước khi viết.',
          genre_primary: 'fantasy',
          project_mode: PROJECT_MODES.FANFIC,
          canon_adherence_level: fanficForm.adherenceLevel,
          divergence_point: fanficForm.divergencePoint,
          fanfic_setup: JSON.stringify({
            fanficType: fanficForm.fanficType,
            adherenceLevel: fanficForm.adherenceLevel,
            divergencePoint: fanficForm.divergencePoint,
          }),
          skipFirstChapter: true,
        });
        onCreated(id, { path: `/project/${id}/lab-lite` });
        return;
      }

      const seed = await generateFanficProjectSeed({
        canonPack: selectedPack,
        setup: {
          fanficType: fanficForm.fanficType,
          adherenceLevel: fanficForm.adherenceLevel,
          divergencePoint: fanficForm.divergencePoint,
        },
        title: fanficForm.title.trim(),
      });
      const id = await createProject({
        title: seed.title,
        description: seed.description,
        synopsis: seed.synopsis,
        genre_primary: 'fantasy',
        project_mode: PROJECT_MODES.FANFIC,
        source_canon_pack_id: selectedPack.id,
        canon_adherence_level: fanficForm.adherenceLevel,
        divergence_point: fanficForm.divergencePoint,
        fanfic_setup: JSON.stringify(seed.fanfic_setup),
        skipFirstChapter: true,
      });
      for (const chapter of seed.chapters) {
        await createChapter(id, chapter.title, chapter);
      }
      onCreated(id);
    } catch (err) {
      console.error('Failed to create fanfic project:', err);
      setCreating(false);
    }
  };

  // AI Wizard mode
  if (mode === 'ai') {
    return <ProjectWizard onClose={onClose} onCreated={onCreated} />;
  }

  // Choose mode
  if (mode === null) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal animate-scale-up" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title">
              <Sparkles size={20} style={{ color: 'var(--color-accent)' }} />
              {' '}Tạo truyện mới
            </h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>Chọn cách tạo dự án:</p>

            <button
              className="wizard-choice-btn wizard-choice-btn--ai"
              onClick={() => setMode('ai')}
            >
              <div className="wizard-choice-icon"><Sparkles size={24} /></div>
              <div className="wizard-choice-text">
                <strong>✨ Tạo bằng AI</strong>
                <span>Nhập ý tưởng → AI sinh nhân vật, thế giới, outline chương</span>
              </div>
            </button>

            <button
              className="wizard-choice-btn"
              onClick={() => setMode('manual')}
            >
              <div className="wizard-choice-icon"><PenTool size={24} /></div>
              <div className="wizard-choice-text">
                <strong>📝 Tạo thủ công</strong>
                <span>Thiết lập chi tiết và bắt đầu viết ngay</span>
              </div>
            </button>

            <button
              className="wizard-choice-btn"
              onClick={() => setMode('template')}
            >
              <div className="wizard-choice-icon"><BookOpen size={24} /></div>
              <div className="wizard-choice-text">
                <strong>Dùng thế giới & nhân vật có sẵn</strong>
                <span>Tạo truyện mới sạch từ Bible/World của một dự án khác</span>
              </div>
            </button>

            <button
              className="wizard-choice-btn"
              onClick={() => setMode('fanfic')}
            >
              <div className="wizard-choice-icon"><BookKey size={24} /></div>
              <div className="wizard-choice-text">
                <strong>Đồng nhân / viết lại theo canon</strong>
                <span>Chọn Canon Pack hoặc vào Lab Lite để nạp liệu trước.</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'template') {
    return (
      <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(3px)', backgroundColor: 'rgba(0, 0, 0, 0.4)' }}>
        <div className="modal animate-scale-up" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh', maxWidth: '760px', padding: 0, borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--color-border)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
          <div className="modal-header" style={{ flexShrink: 0, padding: '24px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-elevated)' }}>
            <h2 className="modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ padding: '8px', background: 'var(--color-accent)', color: '#fff', borderRadius: '10px', display: 'flex', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
                <BookOpen size={20} />
              </div>
              Tạo truyện từ Bible có sẵn
            </h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} style={{ borderRadius: '50%', border: '1px solid var(--color-border)' }}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleTemplateSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Dự án nguồn *</label>
                  <select
                    className="select"
                    value={templateForm.sourceProjectId}
                    onChange={(event) => handleTemplateSourceChange(event.target.value)}
                    disabled={creating || sourceProjects.length === 0}
                  >
                    <option value="">Chọn dự án nguồn...</option>
                    {sourceProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.title || `Dự án #${project.id}`}</option>
                    ))}
                  </select>
                  <span className="form-hint" style={{ marginTop: '8px', fontSize: '13px' }}>
                    {sourceProjects.length === 0
                      ? 'Chưa có dự án nào để lấy Bible/World.'
                      : 'Chỉ lấy dữ liệu tái sử dụng được, không copy chương/cảnh cũ.'}
                  </span>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Tên truyện mới *</label>
                  <input
                    className="input"
                    placeholder="VD: Huyết Nguyệt Tân Biên"
                    value={templateForm.title}
                    onChange={(event) => handleTemplateFormChange('title', event.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Synopsis mới</label>
                <textarea
                  className="textarea"
                  placeholder="Tóm tắt hướng truyện mới, mục tiêu mới hoặc biến thể mới của thế giới này..."
                  value={templateForm.synopsis}
                  onChange={(event) => handleTemplateFormChange('synopsis', event.target.value)}
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Mô tả ngắn</label>
                  <textarea
                    className="textarea"
                    placeholder="Premise hoặc ghi chú ngắn cho dự án mới..."
                    value={templateForm.description}
                    onChange={(event) => handleTemplateFormChange('description', event.target.value)}
                    rows={2}
                    style={{ resize: 'none' }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>Chương trống</label>
                  <input
                    type="number"
                    className="input"
                    value={templateForm.initial_chapter_count}
                    min={1}
                    max={100}
                    onChange={(event) => handleTemplateFormChange('initial_chapter_count', clampInitialChapterCount(event.target.value))}
                  />
                  <span className="form-hint" style={{ marginTop: '8px', fontSize: '13px' }}>Mặc định 1 chương mới.</span>
                </div>
              </div>

              <div className="form-group" style={{ margin: 0, paddingTop: '16px', borderTop: '1px dashed var(--color-border)' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '15px', marginBottom: '16px' }}>
                  Dữ liệu mang sang
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                  {TEMPLATE_INCLUDE_OPTIONS.map((item) => {
                    const disabled = isTemplateIncludeDisabled(item.key);
                    const count = getTemplateCount(templateSummary, item.key);
                    const isChecked = Boolean(templateInclude[item.key]) && !disabled;

                    return (
                      <label
                        key={item.key}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          padding: '14px',
                          border: isChecked ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                          borderRadius: '10px',
                          backgroundColor: 'var(--color-bg-elevated)',
                          opacity: disabled ? 0.5 : 1,
                          cursor: disabled || creating ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: isChecked ? '0 2px 8px rgba(0, 0, 0, 0.05)' : 'none'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={disabled || creating}
                          onChange={(event) => handleTemplateIncludeChange(item.key, event.target.checked)}
                          style={{ marginTop: '4px', accentColor: 'var(--color-accent)', width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '14px', fontWeight: 600, color: isChecked ? 'var(--color-accent)' : 'inherit', transition: 'color 0.2s' }}>{item.label}</span>
                          <span className="form-hint" style={{ margin: 0, lineHeight: 1.4, fontSize: '12px' }}>{item.description}</span>
                        </span>
                        <span
                          className="badge"
                          style={{
                            flexShrink: 0,
                            backgroundColor: isChecked ? 'var(--color-accent)' : 'transparent',
                            border: isChecked ? 'none' : '1px solid var(--color-border)',
                            color: isChecked ? '#fff' : 'var(--color-text-secondary)',
                            fontWeight: 600,
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '11px'
                          }}
                        >
                          {item.key === 'settings' ? 'có' : count}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <span className="form-hint" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', borderLeft: '3px solid var(--color-accent)' }}>
                  {templateSummaryLoading
                    ? '⏳ Đang đọc Bible của dự án nguồn...'
                    : '💡 Nếu tắt Nhân vật, phần Quan hệ và Cấm kỵ sẽ tự động được tắt theo. Chủ sở hữu của vật phẩm cũng sẽ bị xóa bỏ để tránh lỗi.'}
                </span>
              </div>

              {templateError && (
                <div style={{ color: 'var(--color-danger)', backgroundColor: 'var(--color-bg-elevated)', borderLeft: '3px solid var(--color-danger)', borderTop: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', padding: '12px 16px', borderRadius: '0 8px 8px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
                  {templateError}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ flexShrink: 0, margin: 0, padding: '16px 24px', borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-elevated)', display: 'flex', justifyItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setMode(null)} style={{ padding: '10px 20px', borderRadius: '8px', fontWeight: 600 }}>← Quay lại</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!templateForm.sourceProjectId || !templateForm.title.trim() || templateSummaryLoading || !templateSummary || creating}
                style={{ padding: '10px 24px', borderRadius: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transition: 'all 0.2s' }}
              >
                <BookOpen size={18} />
                {creating ? 'Đang khởi tạo...' : 'Tạo truyện mới'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (mode === 'fanfic') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal--lg animate-scale-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
          <div className="modal-header">
            <h2 className="modal-title">
              <BookKey size={20} style={{ color: 'var(--color-accent)' }} />
              {' '}Đồng nhân / viết lại theo canon
            </h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleFanficSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: '0 var(--space-5) var(--space-5)' }}>
            <div className="form-group">
              <label className="form-label">Tên dự án</label>
              <input
                className="input"
                placeholder="VD: Sau hồi kết của Thanh Vân"
                value={fanficForm.title}
                onChange={(event) => setFanficForm((prev) => ({ ...prev, title: event.target.value }))}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Canon Pack</label>
              <select
                className="select"
                value={fanficForm.canonPackId}
                onChange={(event) => setFanficForm((prev) => ({ ...prev, canonPackId: event.target.value }))}
              >
                {canonPacks.length === 0 ? <option value="">Chưa có Canon Pack - tạo project shell và mở Lab Lite</option> : null}
                {canonPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.title}</option>)}
              </select>
              <span className="form-hint">Nếu chưa có Canon Pack, StoryForge sẽ đưa bạn sang Lab Lite để nạp liệu.</span>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Kiểu đồng nhân</label>
                <select
                  className="select"
                  value={fanficForm.fanficType}
                  onChange={(event) => setFanficForm((prev) => ({ ...prev, fanficType: event.target.value }))}
                >
                  {FANFIC_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Mức bám canon</label>
                <select
                  className="select"
                  value={fanficForm.adherenceLevel}
                  onChange={(event) => setFanficForm((prev) => ({ ...prev, adherenceLevel: event.target.value }))}
                >
                  {CANON_ADHERENCE_LEVELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Điểm rẽ nhánh</label>
              <textarea
                className="textarea"
                placeholder="VD: Sau chương 120, nhân vật phụ biết bí mật sớm hơn bản gốc."
                value={fanficForm.divergencePoint}
                onChange={(event) => setFanficForm((prev) => ({ ...prev, divergencePoint: event.target.value }))}
                rows={3}
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>← Quay lại</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                <BookKey size={16} />
                {creating ? 'Đang tạo...' : 'Tạo dự án đồng nhân'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Manual mode (expanded form)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg animate-scale-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
        <div className="modal-header">
          <h2 className="modal-title">
            <PenTool size={20} style={{ color: 'var(--color-accent)' }} />
            {' '}Tạo truyện thủ công
          </h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: '0 var(--space-5) var(--space-5)', maxHeight: '70vh', overflowY: 'auto' }}>

          {/* Row 1: Title */}
          <div className="form-group">
            <label className="form-label">Tên truyện *</label>
            <input
              className="input"
              placeholder="Ví dụ: Nguyệt Kinh Truyền Kỳ"
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              autoFocus
            />
          </div>

          {/* Row 2: Genre + Tone */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Thể loại chính</label>
              <select
                className="select"
                value={form.genre_primary}
                onChange={(e) => handleChange('genre_primary', e.target.value)}
              >
                {GENRES.map(g => (
                  <option key={g.value} value={g.value}>{g.emoji} {g.label}</option>
                ))}
              </select>

              {/* DNA auto-load hint — hiển thị ngay dưới genre select */}
              {dnaHint && (
                <span className="form-hint" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: 'var(--color-accent)',
                  opacity: 0.8,
                }}>
                  🧬 DNA tự nạp: {dnaHint}
                </span>
              )}
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Tone / Phong cách</label>
              <select
                className="select"
                value={form.tone}
                onChange={(e) => handleChange('tone', e.target.value)}
              >
                <option value="">Chọn tone...</option>
                {TONES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: POV + Xưng hô */}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label"><Eye size={13} /> Góc nhìn</label>
              <select
                className="select"
                value={form.pov_mode}
                onChange={(e) => handleChange('pov_mode', e.target.value)}
              >
                {POV_MODES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <span className="form-hint">{POV_MODES.find(p => p.value === form.pov_mode)?.desc}</span>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label"><MessageSquare size={13} /> Hệ thống Xưng hô</label>
              <select
                className="select"
                value={form.pronoun_style || GENRE_TO_PRONOUN_STYLE[form.genre_primary] || 'hien_dai'}
                onChange={(e) => handleChange('pronoun_style', e.target.value)}
              >
                {PRONOUN_STYLE_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              {pronounPreset && pronounPreset.value !== 'custom' && (
                <span className="form-hint">
                  Xưng: "{pronounPreset.default_self}" — Gọi: "{pronounPreset.default_other}"
                </span>
              )}
            </div>
          </div>

          {/* Row 4: Story Structure */}
          <div className="form-group">
            <label className="form-label"><BookOpen size={13} /> Cấu trúc truyện</label>
            <select
              className="select"
              value={form.story_structure}
              onChange={(e) => handleChange('story_structure', e.target.value)}
            >
              {STORY_STRUCTURES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {form.story_structure && (
              <span className="form-hint">
                {STORY_STRUCTURES.find(s => s.value === form.story_structure)?.desc}
              </span>
            )}
          </div>

          {/* Row 5: Synopsis */}
          <div className="form-group">
            <label className="form-label">📖 Cốt truyện chính (Synopsis)</label>
            <textarea
              className="textarea"
              placeholder="Tóm tắt mạch truyện chính... (không bắt buộc — AI dùng để duy trì mạch truyện)"
              value={form.synopsis}
              onChange={(e) => handleChange('synopsis', e.target.value)}
              rows={3}
            />
            <span className="form-hint">AI cần nội dung này để duy trì mạch truyện nhất quán</span>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Độ dài dự kiến</label>
              <select
                className="select"
                value={form.target_length_type}
                onChange={(e) => handleTargetLengthTypeChange(e.target.value)}
              >
                <option value="unset">Chưa xác định</option>
                <option value="short">Truyện ngắn (30-50 chương)</option>
                <option value="medium">Truyện vừa (100-200 chương)</option>
                <option value="long">Trường thiên (300-500 chương)</option>
                <option value="epic">Sử thi (500+ chương)</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Số chương mục tiêu</label>
              <input
                type="number"
                className="input"
                value={form.target_length}
                onChange={(e) => handleChange('target_length', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Số chương khởi đầu</label>
              <input
                type="number"
                className="input"
                value={form.initial_chapter_count}
                min={1}
                max={100}
                onChange={(e) => handleChange('initial_chapter_count', clampInitialChapterCount(e.target.value))}
              />
              <span className="form-hint">Tạo sẵn chapter trống ban đầu, từ 1 đến 100.</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Đích đến tối thượng (Long-term Goal)</label>
            <textarea
              className="textarea"
              placeholder="VD: Main đạt cảnh giới cao nhất và báo thù diệt tộc."
              value={form.ultimate_goal}
              onChange={(e) => handleChange('ultimate_goal', e.target.value)}
              rows={2}
            />
          </div>

          {/* Row 6: Description */}
          <div className="form-group">
            <label className="form-label">Mô tả ngắn</label>
            <textarea
              className="textarea"
              placeholder="Premise, ý tưởng, hoặc tóm tắt ngắn..."
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={2}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>← Quay lại</button>
            <button type="submit" className="btn btn-primary" disabled={!form.title.trim() || creating}>
              <PenTool size={16} />
              {creating ? 'Đang tạo...' : 'Tạo dự án'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
