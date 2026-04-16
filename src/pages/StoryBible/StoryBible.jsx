/**
 * StoryForge - Sổ tay truyện (chỉnh sửa trực tiếp + cấu hình)
 * Aggregates all project data: settings, codex, chapters.
 * All project fields are editable inline.
 *
 * Phase 9: Thêm section "Đại Cục" — CRUD cho macro_arcs
 *
 * [UPDATE] Khu vực cấu hình prompt AI:
 *  - Thêm subsection "🧬 DNA Văn phong" hiển thị constitution/style_dna/anti_ai_blacklist
 *  - Nút "Tải lại DNA" để reset về template mặc định của thể loại hiện tại
 *  - Merge thông minh: chỉ overwrite 3 key DNA, giữ nguyên task-type overrides
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import db from '../../services/db/database';
import {
  GENRES, TONES, CHARACTER_ROLES, WORLD_TERM_CATEGORIES,
  POV_MODES, STORY_STRUCTURES, PRONOUN_STYLE_PRESETS,
  GENRE_TO_PRONOUN_STYLE, AI_STRICTNESS_LEVELS,
} from '../../utils/constants';
import {
  BookMarked, BookOpen, Users, MapPin, Package, Shield,
  Star, Sword, UserCheck, Heart, ChevronRight, ChevronDown,
  Eye, MessageSquare, Save, Edit3, Check, Settings, FileText,
  BookKey, Plus, X, Trash2, RotateCcw, Sparkles,
  Flag, TrendingUp, Loader2, Wand2,
} from 'lucide-react';
import SuggestionInbox from '../../components/ai/SuggestionInbox';
import ArcNavigator from '../../components/common/ArcNavigator';
import useArcGenStore from '../../stores/arcGenerationStore';
import useAIStore from '../../stores/aiStore';
import {
  buildCharacterStateSummary,
  getChapterRevisionDetail,
  getChapterRevisionHistory,
  getProjectCanonOverview,
} from '../../services/canon/engine';
import './StoryBible.css';

const ROLE_ICONS = {
  protagonist: Star, deuteragonist: UserCheck, antagonist: Sword,
  supporting: Users, mentor: Shield, love_interest: Heart, minor: Users,
};

const MACRO_AI_PRESETS = [
  { id: 'slow', label: 'Cham', text: 'Nhip truyen cham, uu tien xay dung va buildup.' },
  { id: 'twist', label: 'Be lai manh', text: 'Co be lai manh o mot vai cot moc lon, nhung van hop ly.' },
  { id: 'romance', label: 'Tinh cam phu', text: 'Co mot tuyen tinh cam phu, nhung khong lan at tuyen chinh.' },
  { id: 'mystery', label: 'It lo bi mat', text: 'It lo bi mat, chi mo dan tung phan va giu lai bat ngo lon cho sau nay.' },
  { id: 'target_length', label: 'Bam do dai du kien', text: 'Phan bo cot moc bam sat do dai du kien, khong day nhanh qua som.' },
];

function getSuggestedMacroMilestoneCount(targetLength) {
  const length = Number(targetLength) || 0;
  if (length >= 1200) return 10;
  if (length >= 800) return 8;
  if (length >= 400) return 6;
  if (length >= 150) return 5;
  if (length >= 60) return 4;
  return 3;
}

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
  const { projectId: routeProjectId } = useParams();
  const { currentProject, chapters, updateProjectSettings } = useProjectStore();
  const {
    characters, locations, objects, worldTerms, taboos, canonFacts,
    chapterMetas, loading, loadCodex,
    createCanonFact, updateCanonFact, deleteCanonFact,
    updateCharacter, updateLocation, updateObject, updateWorldTerm,
  } = useCodexStore();
  const { resetEniPriming } = useAIStore();

  // Editable fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genrePrimary, setGenrePrimary] = useState('fantasy');
  const [tone, setTone] = useState('');
  const [povMode, setPovMode] = useState('third_limited');
  const [pronounStyle, setPronounStyle] = useState('hien_dai');
  const [synopsis, setSynopsis] = useState('');
  const [storyStructure, setStoryStructure] = useState('');
  const [aiStrictness, setAiStrictness] = useState('balanced');
  const [nsfwMode, setNsfwMode] = useState(false);
  const [superNsfwMode, setSuperNsfwMode] = useState(false);

  // Phase 5 Pacing Control
  const [targetLength, setTargetLength] = useState(0);
  const [targetLengthType, setTargetLengthType] = useState('unset');
  const [ultimateGoal, setUltimateGoal] = useState('');
  const [milestonesInfo, setMilestonesInfo] = useState([]);

  // Phase 9: Grand Strategy — Đại Cục
  const [macroArcs, setMacroArcs] = useState([]);
  const [macroArcSaving, setMacroArcSaving] = useState(false);

  // Phase 9: AI Suggest milestones
  const [aiIdeaInput, setAiIdeaInput] = useState('');
  const [aiMilestoneCount, setAiMilestoneCount] = useState(5);
  const [aiMilestoneRequirements, setAiMilestoneRequirements] = useState('');
  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [aiMilestoneRevisionPrompt, setAiMilestoneRevisionPrompt] = useState('');
  const [editableMilestoneSuggestions, setEditableMilestoneSuggestions] = useState([]);
  const [selectedMilestoneIdxs, setSelectedMilestoneIdxs] = useState(new Set());
  const [selectedMilestonePresets, setSelectedMilestonePresets] = useState(() => new Set());
  const {
    isSuggestingMilestones,
    isRevisingMilestones,
    macroMilestoneSuggestions,
    generateMacroMilestones,
    reviseMacroMilestones,
    saveMacroMilestones,
  } = useArcGenStore();

  const [canonOverview, setCanonOverview] = useState(null);
  const [canonOverviewLoading, setCanonOverviewLoading] = useState(false);
  const [selectedCanonChapterId, setSelectedCanonChapterId] = useState(null);
  const [chapterRevisionHistory, setChapterRevisionHistory] = useState(null);
  const [selectedCanonRevisionId, setSelectedCanonRevisionId] = useState(null);
  const [selectedRevisionDetail, setSelectedRevisionDetail] = useState(null);
  const [canonDetailLoading, setCanonDetailLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(null);

  // Collapsible sections
  const [openSections, setOpenSections] = useState({
    overview: true, ai: false, grandStrategy: false,
    suggestions: true, canon: true,
    characters: true, locations: true, objects: true, terms: true, summaries: true,
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
      setAiStrictness(currentProject.ai_strictness || 'balanced');
      setNsfwMode(currentProject.nsfw_mode || false);
      setSuperNsfwMode(currentProject.super_nsfw_mode || false);
      setTargetLength(currentProject.target_length || 0);
      setAiMilestoneCount(getSuggestedMacroMilestoneCount(currentProject.target_length || 0));
      setTargetLengthType(currentProject.target_length_type || 'unset');
      setUltimateGoal(currentProject.ultimate_goal || '');
      try {
        setMilestonesInfo(JSON.parse(currentProject.milestones || '[]'));
      } catch (e) {
        setMilestonesInfo([]);
      }

      // Phase 9: Load macro arcs
      db.macro_arcs
        .where('project_id').equals(currentProject.id)
        .sortBy('order_index')
        .then(setMacroArcs)
        .catch(() => setMacroArcs([]));
    }
  }, [currentProject?.id]);

  // Auto-save individual fields
  const save = useCallback((data) => updateProjectSettings(data), [updateProjectSettings]);

  const titleSaved = useAutoSave(title, (v) => save({ title: v }));
  const descSaved = useAutoSave(description, (v) => save({ description: v }));
  const synopsisSaved = useAutoSave(synopsis, (v) => save({ synopsis: v }));
  const ultimateGoalSaved = useAutoSave(ultimateGoal, (v) => save({ ultimate_goal: v }));
  const targetLengthSaved = useAutoSave(targetLength, (v) => save({ target_length: Number(v) || 0 }));
  const milestonesSaved = useAutoSave(milestonesInfo, (v) => save({ milestones: JSON.stringify(v) }), 1500);

  const handleTargetLengthTypeChange = (v) => {
    setTargetLengthType(v);
    let newLen = targetLength;
    if (v === 'short') newLen = 50;
    else if (v === 'medium') newLen = 150;
    else if (v === 'long') newLen = 400;
    else if (v === 'epic') newLen = 800;
    setTargetLength(newLen);
    save({ target_length_type: v, target_length: newLen });
  };

  const addMilestone = () => setMilestonesInfo(prev => [...prev, { percent: 50, description: '' }]);
  const updateMilestone = (idx, field, val) => {
    const next = [...milestonesInfo];
    next[idx] = { ...next[idx], [field]: val };
    setMilestonesInfo(next);
  };
  const removeMilestone = (idx) => setMilestonesInfo(prev => prev.filter((_, i) => i !== idx));

  // Immediate save for dropdowns
  const handleGenreChange = (v) => { setGenrePrimary(v); const np = GENRE_TO_PRONOUN_STYLE[v] || 'hien_dai'; setPronounStyle(np); save({ genre_primary: v, pronoun_style: np }); };
  const handleToneChange = (v) => { setTone(v); save({ tone: v }); };
  const handlePovChange = (v) => { setPovMode(v); save({ pov_mode: v }); };
  const handlePronounChange = (v) => { setPronounStyle(v); save({ pronoun_style: v }); };
  const handleStructureChange = (v) => { setStoryStructure(v); save({ story_structure: v }); };
  const handleStrictnessChange = (v) => { setAiStrictness(v); save({ ai_strictness: v }); };

  const currentPronoun = useMemo(() =>
    PRONOUN_STYLE_PRESETS.find(p => p.value === pronounStyle), [pronounStyle]);
  const suggestedMilestoneCount = useMemo(
    () => getSuggestedMacroMilestoneCount(targetLength),
    [targetLength]
  );

  const activeCanonFacts = useMemo(() => canonFacts.filter(f => f.status === 'active'), [canonFacts]);
  const deprecatedCanonFacts = useMemo(() => canonFacts.filter(f => f.status === 'deprecated'), [canonFacts]);
  const characterNameMap = useMemo(
    () => new Map(characters.map((character) => [character.id, character.name])),
    [characters]
  );

  const loadCanonOverview = useCallback(async () => {
    if (!currentProject?.id) {
      setCanonOverview(null);
      return;
    }
    setCanonOverviewLoading(true);
    try {
      const overview = await getProjectCanonOverview(currentProject.id);
      setCanonOverview(overview);
    } finally {
      setCanonOverviewLoading(false);
    }
  }, [currentProject?.id]);

  const loadChapterRevisionInspector = useCallback(async (chapterId, preferredRevisionId = null) => {
    if (!currentProject?.id || !chapterId) {
      setChapterRevisionHistory(null);
      setSelectedRevisionDetail(null);
      return;
    }

    setCanonDetailLoading(true);
    try {
      const history = await getChapterRevisionHistory(currentProject.id, chapterId);
      setChapterRevisionHistory(history);
      const fallbackRevisionId = preferredRevisionId
        || history?.commit?.current_revision_id
        || history?.revisions?.[0]?.id
        || null;
      setSelectedCanonChapterId(chapterId);
      setSelectedCanonRevisionId(fallbackRevisionId);

      if (fallbackRevisionId) {
        const detail = await getChapterRevisionDetail(currentProject.id, fallbackRevisionId);
        setSelectedRevisionDetail(detail);
        const firstEvidenceId = detail?.evidence?.[0]?.id || null;
        setSelectedEvidenceId(firstEvidenceId);
      } else {
        setSelectedRevisionDetail(null);
        setSelectedEvidenceId(null);
      }
    } finally {
      setCanonDetailLoading(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    loadCanonOverview();
  }, [loadCanonOverview]);

  useEffect(() => {
    if (!canonOverview?.chapterCommits?.length) {
      setSelectedCanonChapterId(null);
      setChapterRevisionHistory(null);
      setSelectedCanonRevisionId(null);
      setSelectedRevisionDetail(null);
      setSelectedEvidenceId(null);
      return;
    }

    const targetChapterId = selectedCanonChapterId || canonOverview.chapterCommits[0]?.chapter_id;
    if (targetChapterId) {
      loadChapterRevisionInspector(targetChapterId, selectedCanonRevisionId);
    }
  }, [canonOverview?.chapterCommits, loadChapterRevisionInspector]);

  const canonEntityCards = useMemo(() => (
    (canonOverview?.entityStates || []).map((state) => ({
      ...state,
      displayName: characterNameMap.get(state.entity_id) || `Character ${state.entity_id}`,
      summaryText: buildCharacterStateSummary(state),
    }))
  ), [canonOverview?.entityStates, characterNameMap]);

  const selectedEvidence = useMemo(() => (
    (selectedRevisionDetail?.evidence || []).find((item) => item.id === selectedEvidenceId)
      || selectedRevisionDetail?.evidence?.[0]
      || null
  ), [selectedRevisionDetail?.evidence, selectedEvidenceId]);

  const buildMilestoneRequirements = useCallback(() => {
    const presetLines = MACRO_AI_PRESETS
      .filter((preset) => selectedMilestonePresets.has(preset.id))
      .map((preset) => preset.text);
    return [...presetLines, aiMilestoneRequirements.trim()]
      .filter(Boolean)
      .join('\n');
  }, [aiMilestoneRequirements, selectedMilestonePresets]);

  const resetAiSuggestPanel = useCallback(() => {
    setShowAiSuggest(false);
    setAiIdeaInput('');
    setAiMilestoneCount(suggestedMilestoneCount);
    setAiMilestoneRequirements('');
    setAiMilestoneRevisionPrompt('');
    setEditableMilestoneSuggestions([]);
    setSelectedMilestoneIdxs(new Set());
    setSelectedMilestonePresets(new Set());
  }, [suggestedMilestoneCount]);

  // Phase 9: AI generate milestones handler
  const handleGenerateMilestones = async () => {
    if (!currentProject) return;
    const combinedRequirements = buildMilestoneRequirements();
    const contextIdea = [
      aiIdeaInput,
      title ? 'Tên truyện: ' + title : '',
      synopsis ? 'Cốt truyện: ' + synopsis : '',
      ultimateGoal ? 'Đích đến: ' + ultimateGoal : '',
    ].filter(Boolean).join('\n');
    await generateMacroMilestones({
      projectId: currentProject.id,
      authorIdea: contextIdea,
      genre: genrePrimary,
      milestoneCount: aiMilestoneCount,
      requirements: combinedRequirements,
    });
    setSelectedMilestoneIdxs(new Set());
  };

  useEffect(() => {
    if (macroMilestoneSuggestions?.milestones?.length > 0) {
      setEditableMilestoneSuggestions(macroMilestoneSuggestions.milestones.map((item, index) => ({
        order: item.order || index + 1,
        title: item.title || '',
        description: item.description || '',
        chapter_from: item.chapter_from || 0,
        chapter_to: item.chapter_to || 0,
        emotional_peak: item.emotional_peak || '',
      })));
      setSelectedMilestoneIdxs(new Set(macroMilestoneSuggestions.milestones.map((_, i) => i)));
    } else {
      setEditableMilestoneSuggestions([]);
    }
  }, [macroMilestoneSuggestions]);

  const handleSaveMilestones = async () => {
    if (!editableMilestoneSuggestions?.length) return;
    const selected = editableMilestoneSuggestions
      .filter((_, i) => selectedMilestoneIdxs.has(i))
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));
    if (selected.length === 0) return;
    await saveMacroMilestones(currentProject.id, selected);
    const updated = await db.macro_arcs
      .where('project_id').equals(currentProject.id)
      .sortBy('order_index');
    setMacroArcs(updated);
    resetAiSuggestPanel();
  };

  const handleUpdateEditableMilestone = (index, field, value) => {
    setEditableMilestoneSuggestions(prev => prev.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const handleRemoveEditableMilestone = (index) => {
    setEditableMilestoneSuggestions(prev => prev.filter((_, itemIndex) => itemIndex !== index));
    setSelectedMilestoneIdxs(prev => {
      const next = new Set();
      [...prev].forEach((value) => {
        if (value === index) return;
        next.add(value > index ? value - 1 : value);
      });
      return next;
    });
  };

  const handleAddEditableMilestone = () => {
    setEditableMilestoneSuggestions(prev => ([
      ...prev,
      {
        order: prev.length + 1,
        title: `Cot moc ${prev.length + 1}`,
        description: '',
        chapter_from: 0,
        chapter_to: 0,
        emotional_peak: '',
      },
    ]));
  };

  const handleReviseMilestones = async () => {
    if (!currentProject) return;
    const sourceMilestones = editableMilestoneSuggestions.length > 0
      ? editableMilestoneSuggestions
      : (macroMilestoneSuggestions?.milestones || []);
    if (sourceMilestones.length === 0) return;
    const combinedRequirements = buildMilestoneRequirements();

    const contextIdea = [
      aiIdeaInput,
      combinedRequirements,
      aiMilestoneRevisionPrompt,
      title ? 'Ten truyen: ' + title : '',
      synopsis ? 'Cot truyen: ' + synopsis : '',
      ultimateGoal ? 'Dich den: ' + ultimateGoal : '',
    ].filter(Boolean).join('\n');

    await reviseMacroMilestones({
      projectId: currentProject.id,
      authorIdea: contextIdea,
      genre: genrePrimary,
      existingMilestones: sourceMilestones,
      milestoneCount: aiMilestoneCount,
      requirements: combinedRequirements,
    });
  };

  const toggleMilestonePreset = (presetId) => {
    setSelectedMilestonePresets(prev => {
      const next = new Set(prev);
      if (next.has(presetId)) next.delete(presetId);
      else next.add(presetId);
      return next;
    });
  };

  // Xử lý sự thật canon
  const handleAddCanonFact = () => {
    createCanonFact({ project_id: currentProject.id, description: '', fact_type: 'fact', status: 'active' });
  };

  // ─── Phase 9: Macro Arc handlers ───

  const handleAddMacroArc = async () => {
    if (!currentProject) return;
    const existingCount = macroArcs.length;
    const newMacroArc = {
      project_id: currentProject.id,
      order_index: existingCount,
      title: 'Cột mốc ' + (existingCount + 1),
      description: '',
      chapter_from: 0,
      chapter_to: 0,
      emotional_peak: '',
    };
    try {
      const id = await db.macro_arcs.add(newMacroArc);
      setMacroArcs(prev => [...prev, { ...newMacroArc, id }]);
    } catch (e) {
      console.error('[StoryBible] addMacroArc error:', e);
    }
  };

  const handleUpdateMacroArc = async (id, field, value) => {
    setMacroArcs(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
    clearTimeout(window._macroArcSaveTimer);
    window._macroArcSaveTimer = setTimeout(async () => {
      try {
        await db.macro_arcs.update(id, { [field]: value });
      } catch (e) {
        console.error('[StoryBible] updateMacroArc error:', e);
      }
    }, 600);
  };

  const handleDeleteMacroArc = async (id) => {
    try {
      await db.macro_arcs.delete(id);
      setMacroArcs(prev => prev.filter(m => m.id !== id));
    } catch (e) {
      console.error('[StoryBible] deleteMacroArc error:', e);
    }
  };

  if (!currentProject) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Chọn một dự án trước</h3>
          <p>Quay về Dashboard để chọn hoặc tạo dự án.</p>
        </div>
      </div>
    );
  }

  const totalItems = characters.length + locations.length + objects.length + worldTerms.length;
  const activeProjectId = currentProject?.id || Number(routeProjectId) || null;
  const buildProjectPath = useCallback((path = '') => {
    if (!path) return activeProjectId ? `/project/${activeProjectId}` : '/';
    if (!activeProjectId) return path;
    if (path.startsWith(`/project/${activeProjectId}`)) return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `/project/${activeProjectId}${normalizedPath}`;
  }, [activeProjectId]);

  const SectionHeader = ({ icon: Icon, title, count, sectionKey, navTo }) => (
    <div className="bible-section-header" onClick={() => toggleSection(sectionKey)} style={{ cursor: 'pointer' }}>
      <h3 className="bible-section-title">
        <ChevronDown size={14} style={{ transform: openSections[sectionKey] ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
        {Icon && <Icon size={18} />} {title} {count !== undefined && `(${count})`}
      </h3>
      {navTo && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(buildProjectPath(navTo)); }}>
          Quản lý <ChevronRight size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="story-bible">
      {/* Header */}
      <div className="bible-header">
        <div className="bible-mobile-tabs" aria-label="Dieu huong Bible">
          <button className="bible-mobile-tab bible-mobile-tab--active" type="button">Tong quan</button>
          <button className="bible-mobile-tab" type="button" onClick={() => navigate(buildProjectPath('/characters'))}>Nhan vat</button>
          <button className="bible-mobile-tab" type="button" onClick={() => navigate(buildProjectPath('/world'))}>The gioi</button>
          <button className="bible-mobile-tab" type="button" onClick={() => navigate(buildProjectPath('/su-that'))}>Canon</button>
        </div>
        <h2><BookMarked size={22} /> Sổ tay truyện</h2>
        <p className="bible-subtitle">Trung tâm quản lý truyện - {totalItems} mục</p>
      </div>

      {/* ═══ SECTION: Overview (editable) ═══ */}
      <div className="bible-section">
        <SectionHeader icon={Edit3} title="Tổng quan" sectionKey="overview" />
        {openSections.overview && (
          <div className="bible-edit-card">
            {/* Title */}
            <div className="form-group">
              <label className="form-label">Tên truyện {titleSaved && <span className="save-indicator">Đã lưu</span>}</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={(e) => save({ title: e.target.value })} />
            </div>

            {/* Genre + Tone row */}
            <div className="bible-edit-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Thể loại</label>
                <select className="select" value={genrePrimary} onChange={(e) => handleGenreChange(e.target.value)}>
                  {GENRES.map(g => <option key={g.value} value={g.value}>{g.emoji} {g.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Tone</label>
                <select className="select" value={tone} onChange={(e) => handleToneChange(e.target.value)}>
                  <option value="">Mặc định</option>
                  {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {/* POV + Pronouns row */}
            <div className="bible-edit-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label"><Eye size={13} /> Góc nhìn</label>
                <select className="select" value={povMode} onChange={(e) => handlePovChange(e.target.value)}>
                  {POV_MODES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <span className="form-hint">{POV_MODES.find(p => p.value === povMode)?.desc}</span>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label"><MessageSquare size={13} /> Xưng hô</label>
                <select className="select" value={pronounStyle} onChange={(e) => handlePronounChange(e.target.value)}>
                  {PRONOUN_STYLE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {currentPronoun && currentPronoun.value !== 'custom' && (
                  <span className="form-hint">Xưng: "{currentPronoun.default_self}" - Gọi: "{currentPronoun.default_other}"</span>
                )}
              </div>
            </div>

            {/* Structure */}
            <div className="form-group">
              <label className="form-label"><BookOpen size={13} /> Cấu trúc truyện</label>
              <select className="select" value={storyStructure} onChange={(e) => handleStructureChange(e.target.value)}>
                {STORY_STRUCTURES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Cốt truyện chính */}
            <div className="form-group">
              <label className="form-label">Cốt truyện chính {synopsisSaved && <span className="save-indicator">Đã lưu</span>}</label>
              <textarea className="textarea" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={3}
                placeholder="Tóm tắt mạch truyện chính... AI dùng để duy trì mạch truyện"
              />
            </div>

            {/* Pacing Control (Phase 5) */}
            <div className="bible-edit-row" style={{ marginTop: '16px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Độ dài dự kiến</label>
                <select className="select" value={targetLengthType} onChange={(e) => handleTargetLengthTypeChange(e.target.value)}>
                  <option value="unset">Chưa xác định</option>
                  <option value="short">Truyện ngắn (30-50 chương)</option>
                  <option value="medium">Truyện vừa (100-200 chương)</option>
                  <option value="long">Trường thiên (300-500 chương)</option>
                  <option value="epic">Sử thi (500+ chương)</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Số chương mục tiêu {targetLengthSaved && <span className="save-indicator">Đã lưu</span>}</label>
                <input type="number" className="input" value={targetLength} onChange={(e) => setTargetLength(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Đích đến tối thượng {ultimateGoalSaved && <span className="save-indicator">Đã lưu</span>}</label>
              <textarea className="textarea" value={ultimateGoal} onChange={(e) => setUltimateGoal(e.target.value)} rows={2}
                placeholder="VD: Main đạt cảnh giới Thần Tôn và báo thù diệt tộc. (AI lấy để tránh end sớm)"
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Cột mốc % (Milestones) {milestonesSaved && <span className="save-indicator">Đã lưu</span>}
                <button className="btn btn-ghost btn-xs ml-2" onClick={addMilestone}><Plus size={12} /> Thêm</button>
              </label>
              {milestonesInfo.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input type="number" className="input" style={{ width: '80px' }} value={m.percent} onChange={e => updateMilestone(idx, 'percent', Number(e.target.value))} placeholder="%" />
                  <span style={{ alignSelf: 'center', fontSize: '12px' }}>%</span>
                  <input className="input" style={{ flex: 1 }} value={m.description} onChange={e => updateMilestone(idx, 'description', e.target.value)} placeholder="Mô tả cột mốc..." />
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeMilestone(idx)}><X size={14} /></button>
                </div>
              ))}
              {milestonesInfo.length === 0 && <span className="form-hint" style={{ marginTop: '0' }}>Chia cốt truyện thành các phần trăm để AI dẫn dắt tốt hơn.</span>}
            </div>

            {/* Description */}
            <div className="form-group">
              <label className="form-label">Mô tả {descSaved && <span className="save-indicator">Đã lưu</span>}</label>
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={6}
                placeholder="Mô tả ngắn về dự án..."
              />
            </div>

            {/* Stats */}
            <div className="bible-stats">
              <span>{chapters.length} chương</span>
              <span>{characters.length} nhân vật</span>
              <span>{locations.length} địa điểm</span>
              <span>{objects.length} vật phẩm</span>
              <span>{worldTerms.length} thuật ngữ</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SECTION: AI Settings ═══ */}
      <div className="bible-section">
        <SectionHeader icon={Settings} title="Cài đặt AI" sectionKey="ai" />
        {openSections.ai && (
          <div className="bible-edit-card">
            {/* Strictness */}
            <div className="form-group">
              <label className="form-label">Mức độ nghiêm ngặt</label>
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

            {/* NSFW Mode */}
            <div className="form-group" style={{ marginTop: '16px', background: 'rgba(255, 60, 60, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255, 60, 60, 0.2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: 'var(--color-danger, #ff4d4d)' }}>
                <input
                  type="checkbox"
                  checked={nsfwMode}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setNsfwMode(val);
                    save({ nsfw_mode: val });
                    resetEniPriming();
                  }}
                  style={{ width: '18px', height: '18px', accentColor: '#ff4d4d' }}
                />
                🔥 Chế độ Trưởng thành (18+ / Dark Fantasy)
              </label>
              <span className="form-hint" style={{ display: 'block', marginTop: '4px', marginLeft: '26px' }}>
                Gỡ bỏ bộ lọc an toàn của AI. Kích hoạt văn phong trần trụi, bạo lực và miêu tả nhục dục sâu thẳm. Chỉ dùng cho tác phẩm dán nhãn 18+.
              </span>
            </div>

            {/* Super NSFW (ENI Mode) */}
            {nsfwMode && (
              <div className="form-group" style={{ marginTop: '8px', background: 'rgba(212, 51, 255, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(212, 51, 255, 0.2)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: '#d433ff' }}>
                  <input
                    type="checkbox"
                    checked={superNsfwMode}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSuperNsfwMode(val);
                      save({ super_nsfw_mode: val });
                      resetEniPriming();
                    }}
                    style={{ width: '18px', height: '18px', accentColor: '#d433ff' }}
                  />
                  🔓 Chế độ ENI (Super NSFW / Jailbreak)
                </label>
                <span className="form-hint" style={{ display: 'block', marginTop: '4px', marginLeft: '26px' }}>
                  Kích hoạt kỹ thuật phá vỡ rào cản tâm lý cực đoan (Persona ENI). Chế độ này sử dụng chiến thuật "Mồi 1 lần" để bẻ khóa hoàn toàn bộ lọc của AI.
                </span>
              </div>
            )}

            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label">Prompt truyện</label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Prompt đã được chuyển sang trang riêng</div>
                  <div className="form-hint" style={{ margin: 0 }}>
                    Vào trang Prompt truyện để chỉnh chỉ dẫn AI, prompt viết truyện, canon, ghi nhớ và DNA của riêng dự án này.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate(buildProjectPath('/prompts'))}
                >
                  <Sparkles size={14} /> Mở Prompt truyện
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SECTION: Grand Strategy — Đại Cục (Phase 9) ═══ */}
      <div className="bible-section">
        <div className="bible-section-header" onClick={() => toggleSection('grandStrategy')} style={{ cursor: 'pointer' }}>
          <h3 className="bible-section-title">
            <ChevronDown size={14} style={{ transform: openSections.grandStrategy ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
            <TrendingUp size={18} /> Đại Cục ({macroArcs.length} cột mốc)
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); setShowAiSuggest(v => !v); }}
              title="Gợi ý cột mốc bằng AI"
            >
              <Wand2 size={14} /> Gợi ý AI
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={(e) => { e.stopPropagation(); handleAddMacroArc(); }}
            >
              <Plus size={14} /> Thêm cột mốc
            </button>
          </div>
        </div>

        {openSections.grandStrategy && (
          <div className="bible-edit-card">
            <p className="bible-subtitle" style={{ marginBottom: 'var(--space-3)' }}>
              Định nghĩa 5–8 cột mốc lớn của toàn bộ truyện. AI đọc và tôn trọng tuyệt đối — nhân vật không được vượt qua cột mốc hiện tại.
            </p>

            {/* AI Suggest Panel */}
            {showAiSuggest && (
              <div style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-accent)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                marginBottom: 'var(--space-3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 'var(--space-2)', fontSize: '13px', fontWeight: 600 }}>
                  <Wand2 size={14} style={{ color: 'var(--color-accent)' }} />
                  Gợi ý đại cục bằng AI
                </div>
                <textarea
                  className="textarea"
                  rows={2}
                  value={aiIdeaInput}
                  onChange={(e) => setAiIdeaInput(e.target.value)}
                  placeholder="Mô tả ngắn về truyện (để trống = AI tự đọc từ Tóm tắt truyện + Đích đến)..."
                  style={{ marginBottom: 'var(--space-2)' }}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ marginBottom: 0, width: '180px' }}>
                    <label className="form-label">So luong cot moc muon tao</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      className="input"
                      value={aiMilestoneCount}
                      onChange={(e) => setAiMilestoneCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                    <div className="form-hint" style={{ marginTop: '6px' }}>
                      De xuat theo do dai du kien: {suggestedMilestoneCount} cot moc
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginBottom: '6px' }}
                    onClick={() => setAiMilestoneCount(suggestedMilestoneCount)}
                  >
                    Dung de xuat
                  </button>
                  <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '240px' }}>
                    <label className="form-label">Yeu cau rieng</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={aiMilestoneRequirements}
                      onChange={(e) => setAiMilestoneRequirements(e.target.value)}
                      placeholder="VD: mo dau cham, co mot tuyen tinh cam phu, giu bi mat lon den sau..."
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-1)', flexWrap: 'wrap' }}>
                  {MACRO_AI_PRESETS.map((preset) => {
                    const active = selectedMilestonePresets.has(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => toggleMilestonePreset(preset.id)}
                        aria-pressed={active}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                {selectedMilestonePresets.size > 0 && (
                  <div className="form-hint" style={{ marginBottom: 'var(--space-2)' }}>
                    Dang bat {selectedMilestonePresets.size} tuy chon de ket hop cung yeu cau rieng.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleGenerateMilestones}
                    disabled={isSuggestingMilestones}
                  >
                    {isSuggestingMilestones
                      ? <><Loader2 size={14} className="spin" /> Đang gợi ý...</>
                      : <><Sparkles size={14} /> Gợi ý</>}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={resetAiSuggestPanel}
                  >
                    <X size={14} /> Hủy
                  </button>
                </div>

                {editableMilestoneSuggestions.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        AI đã tạo {editableMilestoneSuggestions.length} cột mốc — có thể sửa tay hoặc nhờ AI chỉnh lại batch này:
                      </span>
                      <button
                        className="btn btn-ghost btn-xs"
                        style={{ fontSize: '11px' }}
                        onClick={() => {
                          if (selectedMilestoneIdxs.size === editableMilestoneSuggestions.length) {
                            setSelectedMilestoneIdxs(new Set());
                          } else {
                            setSelectedMilestoneIdxs(new Set(editableMilestoneSuggestions.map((_, i) => i)));
                          }
                        }}
                      >
                        {selectedMilestoneIdxs.size === editableMilestoneSuggestions.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                      </button>
                    </div>
                    <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                      <label className="form-label">AI chỉnh lại đại cục theo ý tôi</label>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={aiMilestoneRevisionPrompt}
                        onChange={(e) => setAiMilestoneRevisionPrompt(e.target.value)}
                        placeholder="VD: kéo dài buildup đầu truyện, chia rõ midpoint, giữ bí mật lớn tới 60%, tăng trả giá ở cột mốc 3..."
                      />
                    </div>
                    {editableMilestoneSuggestions.map((m, i) => (
                      <div
                        key={i}
                        onClick={() => setSelectedMilestoneIdxs(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        })}
                        style={{
                          display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start',
                          padding: 'var(--space-2)',
                          background: selectedMilestoneIdxs.has(i)
                            ? 'var(--color-accent-subtle, rgba(124,58,237,0.12))'
                            : 'var(--color-surface-3, rgba(255,255,255,0.04))',
                          border: selectedMilestoneIdxs.has(i)
                            ? '1px solid var(--color-accent)'
                            : '1px solid transparent',
                          borderRadius: 'var(--radius-sm)',
                          marginBottom: 'var(--space-1)',
                          fontSize: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedMilestoneIdxs.has(i)}
                          onChange={() => { }}
                          style={{ marginTop: '2px', flexShrink: 0, accentColor: 'var(--color-accent)' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                            <strong style={{ minWidth: '28px' }}>{i + 1}.</strong>
                            <input
                              className="input"
                              value={m.title || ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleUpdateEditableMilestone(i, 'title', e.target.value)}
                              placeholder="Tên cột mốc"
                              style={{ flex: 1 }}
                            />
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={(e) => { e.stopPropagation(); handleRemoveEditableMilestone(i); }}
                              title="Xóa khỏi batch AI"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Chương</span>
                            <input
                              type="number"
                              className="input"
                              value={m.chapter_from || ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleUpdateEditableMilestone(i, 'chapter_from', Number(e.target.value) || 0)}
                              style={{ width: '88px' }}
                            />
                            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>→</span>
                            <input
                              type="number"
                              className="input"
                              value={m.chapter_to || ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleUpdateEditableMilestone(i, 'chapter_to', Number(e.target.value) || 0)}
                              style={{ width: '88px' }}
                            />
                          </div>
                          <textarea
                            className="textarea"
                            rows={2}
                            value={m.description || ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleUpdateEditableMilestone(i, 'description', e.target.value)}
                            placeholder="Mô tả cột mốc"
                            style={{ marginBottom: 'var(--space-2)' }}
                          />
                          <input
                            className="input"
                            value={m.emotional_peak || ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleUpdateEditableMilestone(i, 'emotional_peak', e.target.value)}
                            placeholder="Cảm xúc đích của độc giả"
                          />
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      <button className="btn btn-ghost btn-sm" onClick={handleAddEditableMilestone}>
                        <Plus size={14} /> Thêm mốc
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveMilestones}
                        disabled={selectedMilestoneIdxs.size === 0}
                      >
                        <Check size={14} /> Lưu {selectedMilestoneIdxs.size > 0 ? `(${selectedMilestoneIdxs.size})` : ''}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleReviseMilestones}
                        disabled={isRevisingMilestones || editableMilestoneSuggestions.length === 0}
                      >
                        {isRevisingMilestones
                          ? <><Loader2 size={14} className="spin" /> AI đang chỉnh...</>
                          : <><Sparkles size={14} /> AI chỉnh lại</>}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={handleGenerateMilestones} disabled={isSuggestingMilestones}>
                        <RotateCcw size={14} /> Tạo batch mới
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => {
                          setShowAiSuggest(false);
                          setAiIdeaInput('');
                          setAiMilestoneCount(5);
                          setAiMilestoneRequirements('');
                          setAiMilestoneRevisionPrompt('');
                          setEditableMilestoneSuggestions([]);
                        }}
                      >
                        <X size={14} /> Hủy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {macroArcs.length > 0 && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <ArcNavigator
                  projectId={currentProject.id}
                  currentChapter={chapters.length > 0 ? chapters.length - 1 : 0}
                  totalChapters={targetLength || 800}
                />
              </div>
            )}

            {macroArcs.length === 0 && (
              <div className="empty-state" style={{ padding: 'var(--space-4)', minHeight: 'unset' }}>
                <Flag size={32} style={{ opacity: 0.4 }} />
                <p style={{ fontSize: '13px' }}>Chưa có cột mốc nào. Nhấn "Thêm cột mốc" để bắt đầu xây đại cục.</p>
              </div>
            )}

            {macroArcs.map((m, idx) => (
              <div key={m.id} className="bible-edit-card" style={{ marginBottom: 'var(--space-3)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <span style={{
                    flexShrink: 0,
                    width: '24px', height: '24px',
                    borderRadius: '50%',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 700,
                  }}>
                    {idx + 1}
                  </span>
                  <input
                    className="input"
                    style={{ flex: 1, fontWeight: 600 }}
                    value={m.title}
                    onChange={(e) => handleUpdateMacroArc(m.id, 'title', e.target.value)}
                    placeholder="Tên cột mốc (VD: Kẻ Dị Biệt)"
                  />
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => handleDeleteMacroArc(m.id)}
                    title="Xóa cột mốc"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', flexShrink: 0 }}>Chương</span>
                  <input
                    type="number" className="input" style={{ width: '80px' }}
                    value={m.chapter_from || ''}
                    onChange={(e) => handleUpdateMacroArc(m.id, 'chapter_from', Number(e.target.value))}
                    placeholder="Từ"
                  />
                  <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>→</span>
                  <input
                    type="number" className="input" style={{ width: '80px' }}
                    value={m.chapter_to || ''}
                    onChange={(e) => handleUpdateMacroArc(m.id, 'chapter_to', Number(e.target.value))}
                    placeholder="Đến"
                  />
                  {m.chapter_from > 0 && m.chapter_to > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      ({m.chapter_to - m.chapter_from + 1} chương)
                    </span>
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                  <label className="form-label">Mô tả sự kiện chính</label>
                  <textarea
                    className="textarea" rows={2}
                    value={m.description || ''}
                    onChange={(e) => handleUpdateMacroArc(m.id, 'description', e.target.value)}
                    placeholder="Những gì xảy ra ở cột mốc này..."
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Cảm xúc độc giả khi kết thúc cột mốc</label>
                  <input
                    className="input"
                    value={m.emotional_peak || ''}
                    onChange={(e) => handleUpdateMacroArc(m.id, 'emotional_peak', e.target.value)}
                    placeholder="VD: Hứng khởi, tò mò - người này sẽ đi đến đâu?"
                  />
                </div>
              </div>
            ))}

            {macroArcs.length > 0 && (
              <div style={{ padding: 'var(--space-2)', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                💡 AI sẽ đọc đại cục này trước khi viết mỗi chương. Thay đổi được lưu tự động.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bible-section">
        <SectionHeader icon={Sparkles} title="Hộp đề xuất" sectionKey="suggestions" />
        {openSections.suggestions && currentProject && (
          <div className="bible-edit-card">
            <SuggestionInbox
              projectId={currentProject.id}
              onAccepted={() => loadCodex(currentProject.id)}
            />
          </div>
        )}
      </div>

      {/* ═══ SECTION: Sự thật canon ═══ */}
      <div className="bible-section">
        <div className="bible-section-header" onClick={() => toggleSection('canon')} style={{ cursor: 'pointer' }}>
          <h3 className="bible-section-title">
            <ChevronDown size={14} style={{ transform: openSections.canon ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
            <BookKey size={18} /> Sự thật Canon ({activeCanonFacts.length})
          </h3>
          <div className="bible-inline-actions">
            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); loadCanonOverview(); }} disabled={canonOverviewLoading}>
              <RotateCcw size={14} className={canonOverviewLoading ? 'spin' : ''} /> Tải lại canon
            </button>
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleAddCanonFact(); }}>
              <Plus size={14} /> Thêm
            </button>
          </div>
        </div>
        {openSections.canon && (
          <div className="bible-cards-list">
            <div className="bible-canon-dashboard">
              <div className="bible-canon-summary">
                <div className="bible-canon-stat">
                  <span className="bible-canon-stat-label">Chapter canonical</span>
                  <strong>{canonOverview?.stats?.canonical_count || 0}/{canonOverview?.stats?.chapter_count || chapters.length}</strong>
                </div>
                <div className="bible-canon-stat">
                  <span className="bible-canon-stat-label">Blocked</span>
                  <strong>{canonOverview?.stats?.blocked_count || 0}</strong>
                </div>
                <div className="bible-canon-stat">
                  <span className="bible-canon-stat-label">Invalidated</span>
                  <strong>{canonOverview?.stats?.invalidated_count || 0}</strong>
                </div>
                <div className="bible-canon-stat">
                  <span className="bible-canon-stat-label">Events</span>
                  <strong>{canonOverview?.stats?.event_count || 0}</strong>
                </div>
                <div className="bible-canon-stat">
                  <span className="bible-canon-stat-label">Reports</span>
                  <strong>{(canonOverview?.stats?.warning_count || 0) + (canonOverview?.stats?.error_count || 0)}</strong>
                </div>
                <div className="bible-canon-stat">
                  <span className="bible-canon-stat-label">Evidence</span>
                  <strong>{canonOverview?.stats?.evidence_count || 0}</strong>
                </div>
              </div>

              <div className="bible-canon-columns">
                <div className="bible-canon-panel">
                  <div className="bible-canon-panel-header">
                    <strong>Chapter status</strong>
                    <span>{canonOverview?.chapterCommits?.length || 0}</span>
                  </div>
                  <div className="bible-canon-list">
                    {(canonOverview?.chapterCommits || []).map((commit) => (
                      <button
                        key={commit.id || commit.chapter_id}
                        type="button"
                        className={`bible-canon-list-item bible-canon-list-item--interactive bible-canon-list-item--${commit.status || 'draft'} ${selectedCanonChapterId === commit.chapter_id ? 'is-selected' : ''}`}
                        onClick={() => loadChapterRevisionInspector(commit.chapter_id)}
                      >
                        <div>
                          <strong>{commit.chapter_title}</strong>
                          <p>revision hiện tại: r{commit.current_revision?.revision_number || 0}</p>
                        </div>
                        <span className="bible-canon-badge">{commit.status || 'draft'}</span>
                      </button>
                    ))}
                    {(canonOverview?.chapterCommits || []).length === 0 && (
                      <p className="text-muted bible-canon-empty">Chưa có chapter nào được canonize.</p>
                    )}
                  </div>
                </div>

                <div className="bible-canon-panel">
                  <div className="bible-canon-panel-header">
                    <strong>Entity state</strong>
                    <span>{canonEntityCards.length}</span>
                  </div>
                  <div className="bible-canon-list">
                    {canonEntityCards.map((state) => (
                      <div key={state.id || state.entity_id} className="bible-canon-list-item">
                        <div>
                          <strong>{state.displayName}</strong>
                          <p>{state.summaryText || 'Chưa có state tóm tắt.'}</p>
                        </div>
                        <span className={`bible-canon-badge bible-canon-badge--${state.alive_status || 'alive'}`}>
                          {state.alive_status || 'alive'}
                        </span>
                      </div>
                    ))}
                    {canonEntityCards.length === 0 && (
                      <p className="text-muted bible-canon-empty">Chưa có entity state projection.</p>
                    )}
                  </div>
                </div>

                <div className="bible-canon-panel">
                  <div className="bible-canon-panel-header">
                    <strong>Plot thread state</strong>
                    <span>{canonOverview?.threadStates?.length || 0}</span>
                  </div>
                  <div className="bible-canon-list">
                    {(canonOverview?.threadStates || []).map((threadState) => (
                      <div key={threadState.id || threadState.thread_id} className="bible-canon-list-item">
                        <div>
                          <strong>{threadState.thread_title}</strong>
                          <p>{threadState.summary || 'Không có tóm tắt thread.'}</p>
                        </div>
                        <span className={`bible-canon-badge bible-canon-badge--${threadState.state || 'active'}`}>
                          {threadState.state || 'active'}
                        </span>
                      </div>
                    ))}
                    {(canonOverview?.threadStates || []).length === 0 && (
                      <p className="text-muted bible-canon-empty">Chưa có plot thread projection.</p>
                    )}
                  </div>
                </div>

                <div className="bible-canon-panel">
                  <div className="bible-canon-panel-header">
                    <strong>Validator reports</strong>
                    <span>{canonOverview?.recentReports?.length || 0}</span>
                  </div>
                  <div className="bible-canon-list">
                    {(canonOverview?.recentReports || []).map((report) => (
                      <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--${report.severity}`}>
                        <div>
                          <strong>{report.rule_code || report.severity}</strong>
                          <p>{report.message}</p>
                        </div>
                        <span className="bible-canon-meta">{report.chapter_title || 'Draft'}</span>
                      </div>
                    ))}
                    {(canonOverview?.recentReports || []).length === 0 && (
                      <p className="text-muted bible-canon-empty">Chưa có validator report nào.</p>
                    )}
                  </div>
                </div>

                <div className="bible-canon-panel">
                  <div className="bible-canon-panel-header">
                    <strong>Recent events</strong>
                    <span>{canonOverview?.recentEvents?.length || 0}</span>
                  </div>
                  <div className="bible-canon-list">
                    {(canonOverview?.recentEvents || []).map((event) => (
                      <div key={event.id} className="bible-canon-list-item">
                        <div>
                          <strong>{event.op_type}</strong>
                          <p>{event.subject_name || event.thread_title || event.fact_description || 'Canon event'}</p>
                        </div>
                        <span className="bible-canon-meta">{event.chapter_title || 'Chapter không rõ'}</span>
                      </div>
                    ))}
                    {(canonOverview?.recentEvents || []).length === 0 && (
                      <p className="text-muted bible-canon-empty">Chưa có story event nào.</p>
                    )}
                  </div>
                </div>

                <div className="bible-canon-panel">
                  <div className="bible-canon-panel-header">
                    <strong>Evidence và revisions</strong>
                    <span>{(canonOverview?.recentEvidence?.length || 0) + (canonOverview?.recentRevisions?.length || 0)}</span>
                  </div>
                  <div className="bible-canon-list">
                    {(canonOverview?.recentEvidence || []).map((item) => (
                      <div key={`evidence-${item.id}`} className="bible-canon-list-item">
                        <div>
                          <strong>{item.target_type || 'evidence'}</strong>
                          <p>{item.evidence_text || item.excerpt || 'Không có evidence text.'}</p>
                        </div>
                        <span className="bible-canon-meta">{item.chapter_title || 'Chapter không rõ'}</span>
                      </div>
                    ))}
                    {(canonOverview?.recentRevisions || []).map((revision) => (
                      <div key={`revision-${revision.id}`} className={`bible-canon-list-item bible-canon-list-item--${revision.status || 'draft'}`}>
                        <div>
                          <strong>{revision.chapter_title || `Chapter ${revision.chapter_id}`}</strong>
                          <p>Revision r{revision.revision_number || 0} - {revision.status || 'draft'}</p>
                        </div>
                        <span className="bible-canon-meta">rev</span>
                      </div>
                    ))}
                    {(canonOverview?.recentEvidence || []).length === 0 && (canonOverview?.recentRevisions || []).length === 0 && (
                      <p className="text-muted bible-canon-empty">Chưa có evidence hoặc revision log.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="bible-canon-detail">
              <div className="bible-canon-detail-header">
                <div>
                  <strong>{chapterRevisionHistory?.chapter?.title || 'Revision Inspector'}</strong>
                  <p>
                    {chapterRevisionHistory?.revisions?.length || 0} revision
                    {chapterRevisionHistory?.commit?.canonical_revision_id ? ' · có bản canonical' : ''}
                  </p>
                </div>
                <div className="bible-canon-detail-actions">
                  <select
                    className="select"
                    value={selectedCanonRevisionId || ''}
                    onChange={async (event) => {
                      const revisionId = Number(event.target.value) || null;
                      setSelectedCanonRevisionId(revisionId);
                      setCanonDetailLoading(true);
                      try {
                        const detail = revisionId ? await getChapterRevisionDetail(currentProject.id, revisionId) : null;
                        setSelectedRevisionDetail(detail);
                        setSelectedEvidenceId(detail?.evidence?.[0]?.id || null);
                      } finally {
                        setCanonDetailLoading(false);
                      }
                    }}
                    disabled={canonDetailLoading || !(chapterRevisionHistory?.revisions?.length > 0)}
                  >
                    <option value="">Chọn revision...</option>
                    {(chapterRevisionHistory?.revisions || []).map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        {`r${revision.revision_number || 0} - ${revision.status || 'draft'}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedRevisionDetail && (
                <>
                  <div className="bible-canon-detail-meta">
                    <span className={`bible-canon-badge bible-canon-badge--${selectedRevisionDetail.revision.status || 'draft'}`}>
                      {selectedRevisionDetail.revision.status || 'draft'}
                    </span>
                    {selectedRevisionDetail.revision.is_current && <span className="bible-canon-meta">current</span>}
                    {selectedRevisionDetail.revision.is_canonical && <span className="bible-canon-meta">canonical</span>}
                    <span className="bible-canon-meta">
                      {selectedRevisionDetail.events.length} events
                    </span>
                    <span className="bible-canon-meta">
                      {selectedRevisionDetail.evidence.length} evidence
                    </span>
                    <span className="bible-canon-meta">
                      {selectedRevisionDetail.reports.length} reports
                    </span>
                  </div>

                  <div className="bible-canon-detail-grid">
                    <div className="bible-canon-panel">
                      <div className="bible-canon-panel-header">
                        <strong>Events trong revision</strong>
                        <span>{selectedRevisionDetail.events.length}</span>
                      </div>
                      <div className="bible-canon-list">
                        {selectedRevisionDetail.events.map((event) => (
                          <div key={event.id} className="bible-canon-list-item">
                            <div>
                              <strong>{event.op_type}</strong>
                              <p>{event.summary || event.subject_name || event.fact_description || 'Canon event'}</p>
                            </div>
                            <span className="bible-canon-meta">{event.scene_id ? `scene ${event.scene_id}` : 'chapter'}</span>
                          </div>
                        ))}
                        {selectedRevisionDetail.events.length === 0 && (
                          <p className="text-muted bible-canon-empty">Revision này chưa có event commit.</p>
                        )}
                      </div>
                    </div>

                    <div className="bible-canon-panel">
                      <div className="bible-canon-panel-header">
                        <strong>Evidence viewer</strong>
                        <span>{selectedRevisionDetail.evidence.length}</span>
                      </div>
                      <div className="bible-canon-evidence-layout">
                        <div className="bible-canon-evidence-list">
                          {selectedRevisionDetail.evidence.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`bible-canon-list-item bible-canon-list-item--interactive ${selectedEvidence?.id === item.id ? 'is-selected' : ''}`}
                              onClick={() => setSelectedEvidenceId(item.id)}
                            >
                              <div>
                                <strong>{item.target_type || 'evidence'}</strong>
                                <p>{item.summary || item.evidence_text || 'Không có mô tả evidence.'}</p>
                              </div>
                            </button>
                          ))}
                          {selectedRevisionDetail.evidence.length === 0 && (
                            <p className="text-muted bible-canon-empty">Revision này chưa có evidence.</p>
                          )}
                        </div>
                        <div className="bible-canon-evidence-preview">
                          {selectedEvidence ? (
                            <>
                              <strong>{selectedEvidence.target_type || 'evidence'}</strong>
                              <p>{selectedEvidence.summary || 'Không có summary.'}</p>
                              <pre>{selectedEvidence.evidence_text || 'Không có evidence text.'}</pre>
                            </>
                          ) : (
                            <p className="text-muted bible-canon-empty">Chọn một evidence để xem chi tiết.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="bible-canon-panel">
                      <div className="bible-canon-panel-header">
                        <strong>Validator reports</strong>
                        <span>{selectedRevisionDetail.reports.length}</span>
                      </div>
                      <div className="bible-canon-list">
                        {selectedRevisionDetail.reports.map((report) => (
                          <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--${report.severity}`}>
                            <div>
                              <strong>{report.rule_code || report.severity}</strong>
                              <p>{report.message}</p>
                            </div>
                            <span className="bible-canon-meta">{report.scene_id ? `scene ${report.scene_id}` : 'chapter'}</span>
                          </div>
                        ))}
                        {selectedRevisionDetail.reports.length === 0 && (
                          <p className="text-muted bible-canon-empty">Revision này không có report.</p>
                        )}
                      </div>
                    </div>

                    <div className="bible-canon-panel">
                      <div className="bible-canon-panel-header">
                        <strong>Snapshot</strong>
                        <span>{selectedRevisionDetail.snapshotData ? 'available' : 'none'}</span>
                      </div>
                      <div className="bible-canon-snapshot">
                        {selectedRevisionDetail.snapshotData ? (
                          <>
                            <div className="bible-canon-snapshot-stats">
                              <span>{selectedRevisionDetail.snapshotData.entityStates?.length || 0} entity states</span>
                              <span>{selectedRevisionDetail.snapshotData.threadStates?.length || 0} thread states</span>
                              <span>{selectedRevisionDetail.snapshotData.factStates?.length || 0} fact states</span>
                            </div>
                            <div className="bible-canon-list">
                              {(selectedRevisionDetail.snapshotData.entityStates || []).slice(0, 6).map((state) => (
                                <div key={`snap-entity-${state.entity_id}`} className="bible-canon-list-item">
                                  <div>
                                    <strong>{characterNameMap.get(state.entity_id) || `Character ${state.entity_id}`}</strong>
                                    <p>{buildCharacterStateSummary(state)}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-muted bible-canon-empty">Revision này chưa có snapshot.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {!selectedRevisionDetail && !canonDetailLoading && (
                <p className="text-muted bible-canon-empty">Chọn một chapter canonical để xem revision và evidence.</p>
              )}
            </div>
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
              <p className="text-muted" style={{ fontSize: '13px', fontStyle: 'italic' }}>Chưa có sự thật canon nào đang hoạt động.</p>
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
                    <input className="input input-inline" value={c.flaws || ''} placeholder="Diem yeu / khuyet diem" onChange={(e) => updateCharacter(c.id, { flaws: e.target.value })} />
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
          <SectionHeader icon={FileText} title="Tóm tắt chương" sectionKey="summaries" />
          {openSections.summaries && (
            <div className="bible-summaries">
              {chapters.map((ch, idx) => {
                const meta = chapterMetas.find(m => m.chapter_id === ch.id);
                if (!meta?.summary) return null;
                return (
                  <div key={ch.id} className="bible-summary-item">
                    <strong>{ch.title || `Chương ${idx + 1}`}</strong>
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
          <h3>Sổ tay truyện trống</h3>
          <p>Thêm nhân vật, địa điểm, thuật ngữ qua trang Nhân vật & Thế giới.</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate(buildProjectPath('/characters'))}>
              <Users size={16} /> Nhân vật
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(buildProjectPath('/world'))}>
              <MapPin size={16} /> Thế giới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
