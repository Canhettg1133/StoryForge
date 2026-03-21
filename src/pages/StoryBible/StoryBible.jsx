/**
 * StoryForge - Story Bible (Editable Wiki + Settings)
 * Aggregates all project data: settings, codex, chapters.
 * All project fields are editable inline.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import {
  GENRES, TONES, CHARACTER_ROLES, WORLD_TERM_CATEGORIES,
  POV_MODES, STORY_STRUCTURES, PRONOUN_STYLE_PRESETS,
  GENRE_TO_PRONOUN_STYLE, AI_STRICTNESS_LEVELS,
} from '../../utils/constants';
import { TASK_TYPES } from '../../services/ai/router';
import { TASK_INSTRUCTIONS } from '../../services/ai/promptBuilder';
import {
  BookMarked, BookOpen, Users, MapPin, Package, Shield,
  Star, Sword, UserCheck, Heart, ChevronRight, ChevronDown,
  Eye, MessageSquare, Save, Edit3, Check, Settings, FileText,
  Terminal, BookKey, Plus, X, Trash2, RotateCcw,
} from 'lucide-react';
import './StoryBible.css';

const ROLE_ICONS = {
  protagonist: Star, deuteragonist: UserCheck, antagonist: Sword,
  supporting: Users, mentor: Shield, love_interest: Heart, minor: Users,
};

// Debounced auto-save hook
function useAutoSave(value, saveFn, delay = 800) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      if (value !== undefined) {
        saveFn(value);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [value]);
  return saved;
}

export default function StoryBible() {
  const navigate = useNavigate();
  const { currentProject, chapters, updateProjectSettings } = useProjectStore();
  const {
    characters, locations, objects, worldTerms, taboos, canonFacts,
    chapterMetas, loading, loadCodex,
    createCanonFact, updateCanonFact, deleteCanonFact,
    updateCharacter, updateLocation, updateObject, updateWorldTerm,
  } = useCodexStore();

  // Editable fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genrePrimary, setGenrePrimary] = useState('fantasy');
  const [tone, setTone] = useState('');
  const [povMode, setPovMode] = useState('third_limited');
  const [pronounStyle, setPronounStyle] = useState('hien_dai');
  const [synopsis, setSynopsis] = useState('');
  const [storyStructure, setStoryStructure] = useState('');
  const [aiGuidelines, setAiGuidelines] = useState('');
  const [aiStrictness, setAiStrictness] = useState('balanced');
  
  // Prompt Templates local state
  const [promptTemplates, setPromptTemplates] = useState({});

  // Collapsible sections
  const [openSections, setOpenSections] = useState({
    overview: true, ai: false, prompts: false, canon: true, characters: true,
    locations: true, objects: true, terms: true, summaries: true,
  });

  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Sync from project
  useEffect(() => {
    if (currentProject) {
      loadCodex(currentProject.id);
      setTitle(currentProject.title || '');
      setDescription(currentProject.description || '');
      setGenrePrimary(currentProject.genre_primary || 'fantasy');
      setTone(currentProject.tone || '');
      setPovMode(currentProject.pov_mode || 'third_limited');
      setPronounStyle(currentProject.pronoun_style || GENRE_TO_PRONOUN_STYLE[currentProject.genre_primary] || 'hien_dai');
      setSynopsis(currentProject.synopsis || '');
      setStoryStructure(currentProject.story_structure || '');
      setAiGuidelines(currentProject.ai_guidelines || '');
      setAiStrictness(currentProject.ai_strictness || 'balanced');
      try {
        setPromptTemplates(currentProject.prompt_templates ? JSON.parse(currentProject.prompt_templates) : {});
      } catch (e) {
        setPromptTemplates({});
      }
    }
  }, [currentProject?.id]);

  // Auto-save individual fields
  const save = useCallback((data) => updateProjectSettings(data), [updateProjectSettings]);

  const titleSaved = useAutoSave(title, (v) => save({ title: v }));
  const descSaved = useAutoSave(description, (v) => save({ description: v }));
  const synopsisSaved = useAutoSave(synopsis, (v) => save({ synopsis: v }));
  const guidelinesSaved = useAutoSave(aiGuidelines, (v) => save({ ai_guidelines: v }));
  const promptsSaved = useAutoSave(promptTemplates, (v) => save({ prompt_templates: JSON.stringify(v) }), 1500);

  // Immediate save for dropdowns
  const handleGenreChange = (v) => {
    setGenrePrimary(v);
    const newPronoun = GENRE_TO_PRONOUN_STYLE[v] || 'hien_dai';
    setPronounStyle(newPronoun);
    save({ genre_primary: v, pronoun_style: newPronoun });
  };
  const handleToneChange = (v) => { setTone(v); save({ tone: v }); };
  const handlePovChange = (v) => { setPovMode(v); save({ pov_mode: v }); };
  const handlePronounChange = (v) => { setPronounStyle(v); save({ pronoun_style: v }); };
  const handleStructureChange = (v) => { setStoryStructure(v); save({ story_structure: v }); };
  const handleStrictnessChange = (v) => { setAiStrictness(v); save({ ai_strictness: v }); };

  const currentPronoun = useMemo(() =>
    PRONOUN_STYLE_PRESETS.find(p => p.value === pronounStyle), [pronounStyle]);

  const activeCanonFacts = useMemo(() => canonFacts.filter(f => f.status === 'active'), [canonFacts]);
  const deprecatedCanonFacts = useMemo(() => canonFacts.filter(f => f.status === 'deprecated'), [canonFacts]);

  // Handle Prompt Templates
  const handlePromptChange = (taskType, value) => {
    setPromptTemplates(prev => ({ ...prev, [taskType]: value }));
  };

  // Handle Canon Facts
  const handleAddCanonFact = () => {
    createCanonFact({ project_id: currentProject.id, description: '', fact_type: 'fact', status: 'active' });
  };

  if (!currentProject) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Chon mot du an truoc</h3>
          <p>Quay ve Dashboard de chon hoac tao du an.</p>
        </div>
      </div>
    );
  }

  const totalItems = characters.length + locations.length + objects.length + worldTerms.length;

  const SectionHeader = ({ icon: Icon, title, count, sectionKey, navTo }) => (
    <div className="bible-section-header" onClick={() => toggleSection(sectionKey)} style={{ cursor: 'pointer' }}>
      <h3 className="bible-section-title">
        <ChevronDown size={14} style={{ transform: openSections[sectionKey] ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
        {Icon && <Icon size={18} />} {title} {count !== undefined && `(${count})`}
      </h3>
      {navTo && (
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(navTo); }}>
          Quan ly <ChevronRight size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="story-bible">
      {/* Header */}
      <div className="bible-header">
        <h2><BookMarked size={22} /> Story Bible</h2>
        <p className="bible-subtitle">Trung tam quan ly truyen - {totalItems} muc</p>
      </div>

      {/* ═══ SECTION: Overview (editable) ═══ */}
      <div className="bible-section">
        <SectionHeader icon={Edit3} title="Tong quan" sectionKey="overview" />
        {openSections.overview && (
          <div className="bible-edit-card">
            {/* Title */}
            <div className="form-group">
              <label className="form-label">Ten truyen {titleSaved && <span className="save-indicator">Da luu</span>}</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            {/* Genre + Tone row */}
            <div className="bible-edit-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">The loai</label>
                <select className="select" value={genrePrimary} onChange={(e) => handleGenreChange(e.target.value)}>
                  {GENRES.map(g => <option key={g.value} value={g.value}>{g.emoji} {g.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Tone</label>
                <select className="select" value={tone} onChange={(e) => handleToneChange(e.target.value)}>
                  <option value="">Mac dinh</option>
                  {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {/* POV + Pronouns row */}
            <div className="bible-edit-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label"><Eye size={13} /> Goc nhin</label>
                <select className="select" value={povMode} onChange={(e) => handlePovChange(e.target.value)}>
                  {POV_MODES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <span className="form-hint">{POV_MODES.find(p => p.value === povMode)?.desc}</span>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label"><MessageSquare size={13} /> Xung ho</label>
                <select className="select" value={pronounStyle} onChange={(e) => handlePronounChange(e.target.value)}>
                  {PRONOUN_STYLE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {currentPronoun && currentPronoun.value !== 'custom' && (
                  <span className="form-hint">Xung: "{currentPronoun.default_self}" - Goi: "{currentPronoun.default_other}"</span>
                )}
              </div>
            </div>

            {/* Structure */}
            <div className="form-group">
              <label className="form-label"><BookOpen size={13} /> Cau truc truyen</label>
              <select className="select" value={storyStructure} onChange={(e) => handleStructureChange(e.target.value)}>
                {STORY_STRUCTURES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Synopsis */}
            <div className="form-group">
              <label className="form-label">Cot truyen chinh (Synopsis) {synopsisSaved && <span className="save-indicator">Da luu</span>}</label>
              <textarea className="textarea" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={3}
                placeholder="Tom tat mach truyen chinh... AI dung de duy tri mach truyen"
              />
            </div>

            {/* Description */}
            <div className="form-group">
              <label className="form-label">Mo ta {descSaved && <span className="save-indicator">Da luu</span>}</label>
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                placeholder="Mo ta ngan ve du an..."
              />
            </div>

            {/* Stats */}
            <div className="bible-stats">
              <span>{chapters.length} chuong</span>
              <span>{characters.length} nhan vat</span>
              <span>{locations.length} dia diem</span>
              <span>{objects.length} vat pham</span>
              <span>{worldTerms.length} thuat ngu</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SECTION: AI Settings ═══ */}
      <div className="bible-section">
        <SectionHeader icon={Settings} title="Cai dat AI" sectionKey="ai" />
        {openSections.ai && (
          <div className="bible-edit-card">
            {/* Strictness */}
            <div className="form-group">
              <label className="form-label">Muc do nghiem ngat</label>
              <div className="strictness-options">
                {AI_STRICTNESS_LEVELS.map(level => (
                  <button key={level.value}
                    className={`strictness-btn ${aiStrictness === level.value ? 'strictness-btn--active' : ''}`}
                    onClick={() => handleStrictnessChange(level.value)}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              <span className="form-hint">{AI_STRICTNESS_LEVELS.find(l => l.value === aiStrictness)?.desc}</span>
            </div>

            {/* Guidelines */}
            <div className="form-group">
              <label className="form-label">Chi dan cho AI {guidelinesSaved && <span className="save-indicator">Da luu</span>}</label>
              <textarea className="textarea" value={aiGuidelines} onChange={(e) => setAiGuidelines(e.target.value)} rows={4}
                placeholder="Nhap chi dan rieng cho AI khi viet truyen nay..."
              />
            </div>
          </div>
        )}
      </div>

      {/* ═══ SECTION: Prompt AI (Templates) ═══ */}
      <div className="bible-section">
        <SectionHeader icon={Terminal} title="Prompt AI" sectionKey="prompts" />
        {openSections.prompts && (
          <div className="bible-edit-card">
            <p className="bible-subtitle" style={{ marginBottom: 'var(--space-2)' }}>
              Tùy chỉnh prompt hệ thống cho từng tính năng. Sửa để ghi đè mặc định. {promptsSaved && <span className="save-indicator">Đã lưu</span>}
            </p>
            {Object.entries(TASK_TYPES).map(([key, taskType]) => {
              const defaultPrompt = TASK_INSTRUCTIONS[taskType] || '';
              const hasCustom = !!(promptTemplates[taskType]);
              return (
                <div key={key} className="form-group">
                  <label className="form-label">
                    {key} <span style={{ color: 'var(--color-text-muted)', fontWeight: 'normal', fontSize: '11px' }}>({taskType})</span>
                    {hasCustom && <span style={{ color: 'var(--color-warning, #f59e0b)', fontSize: '11px', marginLeft: 6 }}>✏️ Tùy chỉnh</span>}
                  </label>
                  {/* Show default prompt */}
                  {defaultPrompt && (
                    <div className="prompt-default-preview">
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Mặc định:</span> {defaultPrompt.substring(0, 200)}{defaultPrompt.length > 200 ? '...' : ''}
                    </div>
                  )}
                  <textarea 
                    className="textarea" 
                    value={promptTemplates[taskType] || ''} 
                    onChange={(e) => handlePromptChange(taskType, e.target.value)} 
                    rows={2}
                    placeholder="Để trống = dùng mặc định ở trên"
                  />
                  {hasCustom && (
                    <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', fontSize: '11px' }} onClick={() => handlePromptChange(taskType, '')}>
                      ↩ Xóa tùy chỉnh (dùng mặc định)
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ SECTION: Canon Facts ═══ */}
      <div className="bible-section">
        <div className="bible-section-header" onClick={() => toggleSection('canon')} style={{ cursor: 'pointer' }}>
          <h3 className="bible-section-title">
            <ChevronDown size={14} style={{ transform: openSections.canon ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
            <BookKey size={18} /> Sự thật Canon ({activeCanonFacts.length})
          </h3>
          <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleAddCanonFact(); }}>
            <Plus size={14} /> Thêm
          </button>
        </div>
        {openSections.canon && (
          <div className="bible-cards-list">
            {activeCanonFacts.map(fact => (
              <div key={fact.id} className="bible-edit-card" style={{ gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <select 
                    className="select" 
                    style={{ width: '120px' }} 
                    value={fact.fact_type} 
                    onChange={(e) => updateCanonFact(fact.id, { fact_type: e.target.value })}
                  >
                    <option value="fact">Sự thật</option>
                    <option value="secret">Bí mật</option>
                    <option value="rule">Quy tắc</option>
                  </select>
                  <input 
                    className="input" 
                    style={{ flex: 1 }} 
                    value={fact.description} 
                    onChange={(e) => updateCanonFact(fact.id, { description: e.target.value })} 
                    placeholder="Mô tả sự thật / bí mật / quy luật..."
                  />
                  <button className="btn btn-icon text-danger" onClick={() => updateCanonFact(fact.id, { status: 'deprecated' })} title="Lưu trữ">
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
            {activeCanonFacts.length === 0 && (
              <p className="text-muted" style={{ fontSize: '13px', fontStyle: 'italic' }}>Chưa có Canon Fact nào đang hoạt động. Canon Fact là những thông tin cốt lõi bắt buộc AI phải nhớ và tuân thủ tuyệt đối.</p>
            )}

            {deprecatedCanonFacts.length > 0 && (
              <details style={{ marginTop: 'var(--space-4)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                  Hiển thị {deprecatedCanonFacts.length} lưu trữ
                </summary>
                <div className="bible-cards-list" style={{ marginTop: 'var(--space-2)', opacity: 0.7 }}>
                  {deprecatedCanonFacts.map(fact => (
                    <div key={fact.id} className="bible-edit-card" style={{ padding: 'var(--space-2) var(--space-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px' }}>[{fact.fact_type}] {fact.description}</span>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => updateCanonFact(fact.id, { status: 'active' })}>
                            <RotateCcw size={14} /> Khôi phục
                          </button>
                          <button className="btn btn-ghost btn-danger btn-sm" onClick={() => deleteCanonFact(fact.id)}>
                            <Trash2 size={14} /> Xóa vĩnh viễn
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ═══ SECTION: Characters (editable) ═══ */}
      {characters.length > 0 && (
        <div className="bible-section">
          <SectionHeader icon={Users} title="Nhân vật" count={characters.length} sectionKey="characters" navTo="/characters" />
          {openSections.characters && (
            <div className="bible-grid">
              {characters.map(c => {
                const roleLabel = CHARACTER_ROLES.find(r => r.value === c.role)?.label || c.role;
                return (
                  <div key={c.id} className="bible-card bible-card--editable">
                    <div className="bible-card-header">
                      <select className="select select-mini" value={c.role} onChange={(e) => updateCharacter(c.id, { role: e.target.value })}>
                        {CHARACTER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <input className="input input-inline" value={c.name} placeholder="Tên" onChange={(e) => updateCharacter(c.id, { name: e.target.value })} />
                    <input className="input input-inline" value={c.appearance || ''} placeholder="Ngoại hình" onChange={(e) => updateCharacter(c.id, { appearance: e.target.value })} />
                    <input className="input input-inline" value={c.personality || ''} placeholder="Tính cách" onChange={(e) => updateCharacter(c.id, { personality: e.target.value })} />
                    <input className="input input-inline" value={c.personality_tags || ''} placeholder="Tags (VD: #Kiên_nhẫn, #Quyết_đoán)" onChange={(e) => updateCharacter(c.id, { personality_tags: e.target.value })} />
                    <input className="input input-inline" value={c.current_status || ''} placeholder="Trạng thái hiện tại" onChange={(e) => updateCharacter(c.id, { current_status: e.target.value })} />
                    <input className="input input-inline" value={c.goals || ''} placeholder="Mục tiêu" onChange={(e) => updateCharacter(c.id, { goals: e.target.value })} />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input className="input input-inline" style={{ flex: 1 }} value={c.pronouns_self || ''} placeholder="Xưng" onChange={(e) => updateCharacter(c.id, { pronouns_self: e.target.value })} />
                      <input className="input input-inline" style={{ flex: 1 }} value={c.pronouns_other || ''} placeholder="Gọi" onChange={(e) => updateCharacter(c.id, { pronouns_other: e.target.value })} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ SECTION: Locations (editable) ═══ */}
      {locations.length > 0 && (
        <div className="bible-section">
          <SectionHeader icon={MapPin} title="Địa điểm" count={locations.length} sectionKey="locations" navTo="/world" />
          {openSections.locations && (
            <div className="bible-grid">
              {locations.map(l => (
                <div key={l.id} className="bible-card bible-card--editable">
                  <input className="input input-inline input-bold" value={l.name} placeholder="Tên" onChange={(e) => updateLocation(l.id, { name: e.target.value })} />
                  <input className="input input-inline" value={l.description || ''} placeholder="Mô tả" onChange={(e) => updateLocation(l.id, { description: e.target.value })} />
                  <input className="input input-inline" value={l.details || ''} placeholder="Chi tiết" onChange={(e) => updateLocation(l.id, { details: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SECTION: Objects (editable) ═══ */}
      {objects.length > 0 && (
        <div className="bible-section">
          <SectionHeader icon={Package} title="Vật phẩm" count={objects.length} sectionKey="objects" navTo="/world" />
          {openSections.objects && (
            <div className="bible-grid">
              {objects.map(o => (
                <div key={o.id} className="bible-card bible-card--editable">
                  <input className="input input-inline input-bold" value={o.name} placeholder="Tên" onChange={(e) => updateObject(o.id, { name: e.target.value })} />
                  <input className="input input-inline" value={o.description || ''} placeholder="Mô tả" onChange={(e) => updateObject(o.id, { description: e.target.value })} />
                  <input className="input input-inline" value={o.properties || ''} placeholder="Thuộc tính" onChange={(e) => updateObject(o.id, { properties: e.target.value })} />
                  <select className="select select-mini" value={o.owner_character_id || ''} onChange={(e) => updateObject(o.id, { owner_character_id: e.target.value || null })}>
                    <option value="">Không có chủ</option>
                    {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SECTION: World Terms (editable) ═══ */}
      {worldTerms.length > 0 && (
        <div className="bible-section">
          <SectionHeader icon={BookOpen} title="Thuật ngữ" count={worldTerms.length} sectionKey="terms" navTo="/world" />
          {openSections.terms && (
            <div className="bible-grid bible-grid--terms">
              {worldTerms.map(t => (
                <div key={t.id} className="bible-card bible-card--editable">
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input className="input input-inline input-bold" style={{ flex: 1 }} value={t.name} placeholder="Tên" onChange={(e) => updateWorldTerm(t.id, { name: e.target.value })} />
                    <select className="select select-mini" value={t.category} onChange={(e) => updateWorldTerm(t.id, { category: e.target.value })}>
                      {WORLD_TERM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <input className="input input-inline" value={t.definition || ''} placeholder="Định nghĩa" onChange={(e) => updateWorldTerm(t.id, { definition: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SECTION: Chapter Summaries ═══ */}
      {chapterMetas.length > 0 && (
        <div className="bible-section">
          <SectionHeader icon={FileText} title="Tom tat chuong" sectionKey="summaries" />
          {openSections.summaries && (
            <div className="bible-summaries">
              {chapters.map((ch, idx) => {
                const meta = chapterMetas.find(m => m.chapter_id === ch.id);
                if (!meta?.summary) return null;
                return (
                  <div key={ch.id} className="bible-summary-item">
                    <strong>{ch.title || `Chuong ${idx + 1}`}</strong>
                    <p>{meta.summary}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {totalItems === 0 && (
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Story Bible trong</h3>
          <p>Them nhan vat, dia diem, thuat ngu qua trang Nhan vat & The gioi.</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-primary" onClick={() => navigate('/characters')}>
              <Users size={16} /> Nhan vat
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/world')}>
              <MapPin size={16} /> The gioi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
