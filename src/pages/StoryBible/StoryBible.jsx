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
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import db from '../../services/db/database';
import {
  GENRES, TONES, CHARACTER_ROLES, WORLD_TERM_CATEGORIES,
  POV_MODES, STORY_STRUCTURES, PRONOUN_STYLE_PRESETS,
  GENRE_TO_PRONOUN_STYLE, AI_STRICTNESS_LEVELS,
} from '../../utils/constants';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';
import { TASK_TYPES } from '../../services/ai/router';
import { DEFAULT_NSFW_RULES, DEFAULT_NSFW_INTIMATE_PROMPT, TASK_INSTRUCTIONS } from '../../services/ai/promptBuilder';
import {
  BookMarked, BookOpen, Users, MapPin, Package, Shield,
  Star, Sword, UserCheck, Heart, ChevronRight, ChevronDown,
  Eye, MessageSquare, Save, Edit3, Check, Settings, FileText,
  Terminal, BookKey, Plus, X, Trash2, RotateCcw, Sparkles,
  Flag, TrendingUp, Loader2, Wand2, ChevronUp,
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

const TASK_TYPE_META = {
  [TASK_TYPES.BRAINSTORM]: { label: 'Động não ý tưởng', description: 'Gợi ý nhiều hướng phát triển cho tình huống hiện tại.' },
  [TASK_TYPES.OUTLINE]: { label: 'Lập dàn ý', description: 'Tạo dàn ý chi tiết cho chương hoặc phần tiếp theo.' },
  [TASK_TYPES.SCENE_DRAFT]: { label: 'Viết nháp cảnh', description: 'Sinh bản nháp cho một cảnh mới.' },
  [TASK_TYPES.CONTINUE]: { label: 'Viết tiếp', description: 'Nối tiếp đoạn văn hoặc cảnh đang viết.' },
  [TASK_TYPES.EXPAND]: { label: 'Mở rộng đoạn', description: 'Kéo dài đoạn hiện có và bổ sung chi tiết.' },
  [TASK_TYPES.REWRITE]: { label: 'Viết lại', description: 'Sửa lại câu chữ và nhịp văn nhưng giữ ý nghĩa gốc.' },
  [TASK_TYPES.SUMMARIZE]: { label: 'Tóm tắt', description: 'Rút gọn nội dung thành bản tóm tắt ngắn.' },
  [TASK_TYPES.CONTINUITY_CHECK]: { label: 'Kiểm tra nhất quán', description: 'Đối chiếu logic với canon và tình trạng hiện có.' },
  [TASK_TYPES.EXTRACT_TERMS]: { label: 'Trích xuất thực thể', description: 'Rút ra nhân vật, địa danh, vật phẩm và thuật ngữ mới.' },
  [TASK_TYPES.PLOT_SUGGEST]: { label: 'Gợi ý hướng plot', description: 'Đề xuất các hướng diễn biến tiếp theo.' },
  [TASK_TYPES.STYLE_ANALYZE]: { label: 'Phân tích văn phong', description: 'Phân tích đặc điểm giọng văn hiện có.' },
  [TASK_TYPES.STYLE_WRITE]: { label: 'Viết theo văn phong', description: 'Sinh nội dung theo văn phong đã chọn.' },
  [TASK_TYPES.QA_CHECK]: { label: 'Kiểm tra QA', description: 'Rà soát lỗi logic, lỗi diễn đạt và vấn đề cần sửa.' },
  [TASK_TYPES.CHECK_CONFLICT]: { label: 'Kiểm tra mâu thuẫn', description: 'Tìm mâu thuẫn với canon, timeline và nhân vật.' },
  [TASK_TYPES.FREE_PROMPT]: { label: 'Lệnh tự do', description: 'Gửi yêu cầu tự do cho AI.' },
  [TASK_TYPES.CHAPTER_SUMMARY]: { label: 'Tóm tắt chương', description: 'Tóm tắt một chương để dùng cho bộ nhớ và điều hướng.' },
  [TASK_TYPES.FEEDBACK_EXTRACT]: { label: 'Rút trích thông tin mới', description: 'Lấy thông tin mới từ văn bản để cập nhật dữ liệu.' },
  [TASK_TYPES.AI_GENERATE_ENTITY]: { label: 'Tạo thực thể bằng AI', description: 'Sinh nhanh nhân vật, địa điểm hoặc mục dữ liệu từ AI.' },
  [TASK_TYPES.PROJECT_WIZARD]: { label: 'Khởi tạo dự án', description: 'Lập bộ khung ban đầu cho một dự án mới.' },
  [TASK_TYPES.SUGGEST_UPDATES]: { label: 'Đề xuất cập nhật Sổ tay truyện', description: 'Gợi ý cập nhật trạng thái nhân vật và dữ liệu canon.' },
  [TASK_TYPES.ARC_OUTLINE]: { label: 'Dàn ý cho arc', description: 'Lập dàn ý cho một đợt chương mới.' },
  [TASK_TYPES.ARC_CHAPTER_DRAFT]: { label: 'Nháp chương theo arc', description: 'Viết bản nháp cho một chương trong arc.' },
  [TASK_TYPES.GENERATE_MACRO_MILESTONES]: { label: 'Gợi ý cột mốc đại cục', description: 'Đề xuất các cột mốc lớn cho toàn bộ truyện.' },
  [TASK_TYPES.AUDIT_ARC_ALIGNMENT]: { label: 'Kiểm tra độ lệch arc', description: 'Đánh giá arc hiện tại có còn đúng hướng đại cục hay không.' },
};

const PROMPT_DISPLAY_KEYS = {
  ARC_OUTLINE: 'DÀN_Ý_ARC',
  ARC_CHAPTER_DRAFT: 'NHÁP_CHƯƠNG_ARC',
  GENERATE_MACRO_MILESTONES: 'CỘT_MỐC_ĐẠI_CỤC',
  AUDIT_ARC_ALIGNMENT: 'KIỂM_TRA_LỆCH_ARC',
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
  const [aiGuidelines, setAiGuidelines] = useState('');
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
  const [showAiSuggest, setShowAiSuggest] = useState(false);
  const [selectedMilestoneIdxs, setSelectedMilestoneIdxs] = useState(new Set());
  const {
    isSuggestingMilestones,
    macroMilestoneSuggestions,
    generateMacroMilestones,
    saveMacroMilestones,
  } = useArcGenStore();

  // Prompt Templates local state
  const [promptTemplates, setPromptTemplates] = useState({});

  // DNA section — expand/collapse preview
  const [showDNADetail, setShowDNADetail] = useState(false);
  // Trạng thái flash sau khi reload DNA thành công
  const [dnaReloaded, setDnaReloaded] = useState(false);
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
    overview: true, ai: false, grandStrategy: false, prompts: false,
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
      setAiGuidelines(currentProject.ai_guidelines || '');
      setAiStrictness(currentProject.ai_strictness || 'balanced');
      setNsfwMode(currentProject.nsfw_mode || false);
      setSuperNsfwMode(currentProject.super_nsfw_mode || false);
      setTargetLength(currentProject.target_length || 0);
      setTargetLengthType(currentProject.target_length_type || 'unset');
      setUltimateGoal(currentProject.ultimate_goal || '');
      try {
        setMilestonesInfo(JSON.parse(currentProject.milestones || '[]'));
      } catch (e) {
        setMilestonesInfo([]);
      }
      try {
        setPromptTemplates(currentProject.prompt_templates ? JSON.parse(currentProject.prompt_templates) : {});
      } catch (e) {
        setPromptTemplates({});
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
  const guidelinesSaved = useAutoSave(aiGuidelines, (v) => save({ ai_guidelines: v }));
  const promptsSaved = useAutoSave(promptTemplates, (v) => save({ prompt_templates: JSON.stringify(v) }), 1500);

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

  // Handle Prompt Templates (task-type overrides)
  const handlePromptChange = (taskType, value) => {
    setPromptTemplates(prev => ({ ...prev, [taskType]: value }));
  };

  // ─── [NEW] Reload DNA Văn phong từ template thể loại hiện tại ───
  // Chỉ overwrite 3 key DNA, giữ nguyên tất cả task-type overrides
  const handleReloadGenreDNA = useCallback(() => {
    const template = GENRE_TEMPLATES[genrePrimary];
    if (!template) return;

    const freshDNA = {
      constitution: template.constitution || [],
      style_dna: template.style_dna || [],
      anti_ai_blacklist: template.anti_ai_blacklist || [],
    };

    // Merge: DNA keys bị reset, task-type overrides giữ nguyên
    setPromptTemplates(prev => ({ ...prev, ...freshDNA }));

    // Flash indicator
    setDnaReloaded(true);
    setTimeout(() => setDnaReloaded(false), 2000);
  }, [genrePrimary]);

  // DNA hiện tại từ promptTemplates (có thể đã được user chỉnh sửa)
  const currentDNA = useMemo(() => ({
    constitution: Array.isArray(promptTemplates.constitution) ? promptTemplates.constitution : [],
    style_dna: Array.isArray(promptTemplates.style_dna) ? promptTemplates.style_dna : [],
    anti_ai_blacklist: Array.isArray(promptTemplates.anti_ai_blacklist) ? promptTemplates.anti_ai_blacklist : [],
  }), [promptTemplates]);

  const customNsfwRules = typeof promptTemplates.nsfw_rules === 'string'
    ? promptTemplates.nsfw_rules
    : '';
  const customNsfwSystemPrompt = typeof promptTemplates.nsfw_system_prompt === 'string'
    ? promptTemplates.nsfw_system_prompt
    : '';
  const customNsfwIntimatePrompt = typeof promptTemplates.nsfw_intimate_prompt === 'string'
    ? promptTemplates.nsfw_intimate_prompt
    : '';
  const hasCustomNsfwRules = !!customNsfwRules.trim();
  const hasCustomNsfwSystemPrompt = !!customNsfwSystemPrompt.trim();
  const hasCustomNsfwIntimatePrompt = !!customNsfwIntimatePrompt.trim();
  const nsfwRulesActive = nsfwMode || superNsfwMode;

  const hasDNA = currentDNA.constitution.length > 0
    || currentDNA.style_dna.length > 0
    || currentDNA.anti_ai_blacklist.length > 0;

  // Kiểm tra DNA hiện tại có khớp với template mặc định không
  const templateDNA = GENRE_TEMPLATES[genrePrimary];
  const isDNAModified = useMemo(() => {
    if (!templateDNA) return false;
    return JSON.stringify(currentDNA.constitution) !== JSON.stringify(templateDNA.constitution || [])
      || JSON.stringify(currentDNA.style_dna) !== JSON.stringify(templateDNA.style_dna || [])
      || JSON.stringify(currentDNA.anti_ai_blacklist) !== JSON.stringify(templateDNA.anti_ai_blacklist || []);
  }, [currentDNA, templateDNA]);

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

  // Phase 9: AI generate milestones handler
  const handleGenerateMilestones = async () => {
    if (!currentProject) return;
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
    });
    setSelectedMilestoneIdxs(new Set());
  };

  useEffect(() => {
    if (macroMilestoneSuggestions?.milestones?.length > 0) {
      setSelectedMilestoneIdxs(new Set(macroMilestoneSuggestions.milestones.map((_, i) => i)));
    }
  }, [macroMilestoneSuggestions]);

  const handleSaveMilestones = async () => {
    if (!macroMilestoneSuggestions?.milestones) return;
    const selected = macroMilestoneSuggestions.milestones.filter((_, i) => selectedMilestoneIdxs.has(i));
    if (selected.length === 0) return;
    const ids = await saveMacroMilestones(currentProject.id, selected);
    const updated = await db.macro_arcs
      .where('project_id').equals(currentProject.id)
      .sortBy('order_index');
    setMacroArcs(updated);
    setShowAiSuggest(false);
    setAiIdeaInput('');
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

  const SectionHeader = ({ icon: Icon, title, count, sectionKey, navTo }) => (
    <div className="bible-section-header" onClick={() => toggleSection(sectionKey)} style={{ cursor: 'pointer' }}>
      <h3 className="bible-section-title">
        <ChevronDown size={14} style={{ transform: openSections[sectionKey] ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
        {Icon && <Icon size={18} />} {title} {count !== undefined && `(${count})`}
      </h3>
      {navTo && (
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(navTo); }}>
          Quản lý <ChevronRight size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className="story-bible">
      {/* Header */}
      <div className="bible-header">
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

            {/* Guidelines */}
            <div className="form-group">
              <label className="form-label">Chỉ dẫn cho AI {guidelinesSaved && <span className="save-indicator">Đã lưu</span>}</label>
              <textarea className="textarea" value={aiGuidelines} onChange={(e) => setAiGuidelines(e.target.value)} rows={4}
                placeholder="Nhập chỉ dẫn riêng cho AI khi viết truyện này..."
              />
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
              className="btn btn-ghost btn-sm"
              onClick={() => setShowAiSuggest(v => !v)}
              title="Gợi ý cột mốc bằng AI"
            >
              <Wand2 size={14} /> Gợi ý AI
            </button>
            <button
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
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
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
                    onClick={() => { setShowAiSuggest(false); setAiIdeaInput(''); }}
                  >
                    <X size={14} /> Hủy
                  </button>
                </div>

                {macroMilestoneSuggestions?.milestones?.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        AI gợi ý {macroMilestoneSuggestions.milestones.length} cột mốc — chọn những cái muốn lưu:
                      </span>
                      <button
                        className="btn btn-ghost btn-xs"
                        style={{ fontSize: '11px' }}
                        onClick={() => {
                          if (selectedMilestoneIdxs.size === macroMilestoneSuggestions.milestones.length) {
                            setSelectedMilestoneIdxs(new Set());
                          } else {
                            setSelectedMilestoneIdxs(new Set(macroMilestoneSuggestions.milestones.map((_, i) => i)));
                          }
                        }}
                      >
                        {selectedMilestoneIdxs.size === macroMilestoneSuggestions.milestones.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                      </button>
                    </div>
                    {macroMilestoneSuggestions.milestones.map((m, i) => (
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
                          <strong>{i + 1}. {m.title}</strong>
                          {(m.chapter_from || m.chapter_to) && (
                            <span style={{ color: 'var(--color-text-muted)', marginLeft: '6px' }}>
                              Ch.{m.chapter_from}–{m.chapter_to}
                            </span>
                          )}
                          {m.description && (
                            <div style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>{m.description}</div>
                          )}
                          {m.emotional_peak && (
                            <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: '2px' }}>
                              🎭 {m.emotional_peak}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveMilestones}
                        disabled={selectedMilestoneIdxs.size === 0}
                      >
                        <Check size={14} /> Lưu {selectedMilestoneIdxs.size > 0 ? `(${selectedMilestoneIdxs.size})` : ''}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={handleGenerateMilestones} disabled={isSuggestingMilestones}>
                        <RotateCcw size={14} /> Tạo lại
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => { setShowAiSuggest(false); setAiIdeaInput(''); }}
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

      {/* ═══ SECTION: Cấu hình prompt AI ═══ */}
      <div className="bible-section">
        <SectionHeader icon={Terminal} title="Cấu hình prompt AI" sectionKey="prompts" />
        {openSections.prompts && (
          <div className="bible-edit-card">
            <p className="bible-subtitle" style={{ marginBottom: 'var(--space-3)' }}>
              Tùy chỉnh prompt hệ thống cho từng tính năng. Mọi thay đổi ở đây tự động lưu sau khoảng 1-2 giây, không cần bấm nút lưu. {promptsSaved && <span className="save-indicator">Đã lưu</span>}
            </p>

            {/* ─── [NEW] DNA Văn phong subsection ─── */}
            <div style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-accent-muted, rgba(124,58,237,0.25))',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-4)',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>🧬</span>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>DNA Văn phong</span>
                  <span className="badge badge-sm" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                    {GENRE_TEMPLATES[genrePrimary]?.label || genrePrimary}
                  </span>
                  {isDNAModified && (
                    <span style={{ fontSize: '11px', color: 'var(--color-warning, #f59e0b)' }}>✏️ Đã chỉnh sửa</span>
                  )}
                  {dnaReloaded && (
                    <span style={{ fontSize: '11px', color: 'var(--color-success, #10b981)' }}>✓ Đã tải lại</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowDNADetail(v => !v)}
                    title={showDNADetail ? 'Ẩn chi tiết' : 'Xem chi tiết'}
                  >
                    {showDNADetail ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {showDNADetail ? 'Ẩn' : 'Xem'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleReloadGenreDNA}
                    title={`Tải lại DNA mặc định cho thể loại ${GENRE_TEMPLATES[genrePrimary]?.label || genrePrimary}`}
                    disabled={!GENRE_TEMPLATES[genrePrimary]}
                  >
                    <RotateCcw size={13} /> Tải lại DNA
                  </button>
                </div>
              </div>

              {/* Summary stats */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: showDNADetail ? 'var(--space-3)' : 0 }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '2px 8px', borderRadius: 'var(--radius-xs)' }}>
                  ⚖️ Luật cốt lõi: {currentDNA.constitution.length} luật
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '2px 8px', borderRadius: 'var(--radius-xs)' }}>
                  🎨 DNA văn phong: {currentDNA.style_dna.length} hướng dẫn
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '2px 8px', borderRadius: 'var(--radius-xs)' }}>
                  🚫 Từ cấm: {currentDNA.anti_ai_blacklist.length} từ cấm
                </span>
              </div>

              {/* Detail view (expandable) */}
              {showDNADetail && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                  {/* Luật cốt lõi */}
                  {currentDNA.constitution.length > 0 && (
                    <div>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
                        ⚖️ Luật cốt lõi — Những nguyên tắc không được phá vỡ
                      </p>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                        {currentDNA.constitution.map((rule, i) => <li key={i}>{rule}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* DNA văn phong */}
                  {currentDNA.style_dna.length > 0 && (
                    <div>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
                        🎨 DNA văn phong — Giọng văn và nhịp điệu
                      </p>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                        {currentDNA.style_dna.map((rule, i) => <li key={i}>{rule}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Từ cấm AI */}
                  {currentDNA.anti_ai_blacklist.length > 0 && (
                    <div>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
                        🚫 Từ cấm AI — Những cụm từ sáo rỗng cần tránh
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {currentDNA.anti_ai_blacklist.map((word, i) => (
                          <span key={i} style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: 'var(--color-danger, #ef4444)',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                          }}>
                            {word}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!hasDNA && (
                    <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      Chưa có DNA. Nhấn "Tải lại DNA" để nạp từ template thể loại hiện tại.
                    </p>
                  )}

                  {/* Hint */}
                  <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                    💡 DNA được AI đọc mỗi khi viết. Muốn thay đổi thể loại → đổi Thể loại ở Tổng quan rồi nhấn "Tải lại DNA".
                  </p>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">
                System prompt NSFW gốc
                {hasCustomNsfwSystemPrompt && <span style={{ color: 'var(--color-warning, #f59e0b)', fontSize: '11px', marginLeft: 6 }}>Tùy chỉnh</span>}
                {nsfwRulesActive && <span style={{ color: 'var(--color-success, #10b981)', fontSize: '11px', marginLeft: 6 }}>Đang áp dụng</span>}
              </label>
              <div className="form-hint" style={{ marginBottom: '4px' }}>
                Ô này thay thế toàn bộ block NSFW gốc khi bật NSFW. Để trống = dùng system prompt NSFW mặc định của app.
              </div>
              <div className="prompt-default-preview">
                <div className="prompt-default-preview__header">
                  <span>System prompt NSFW mặc định</span>
                  <code>nsfw_system_prompt</code>
                </div>
                <pre className="prompt-default-preview__body">{DEFAULT_NSFW_RULES}</pre>
              </div>
              <div className="prompt-editor-header">System prompt NSFW tùy chỉnh</div>
              <textarea
                className="textarea"
                value={customNsfwSystemPrompt}
                onChange={(e) => handlePromptChange('nsfw_system_prompt', e.target.value)}
                rows={12}
                placeholder="Để trống = dùng system prompt NSFW mặc định ở trên"
              />
              {hasCustomNsfwSystemPrompt && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'flex-start', fontSize: '11px' }}
                  onClick={() => handlePromptChange('nsfw_system_prompt', '')}
                >
                  Xóa system prompt NSFW tùy chỉnh
                </button>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">
                Luật khi bật NSFW
                {hasCustomNsfwRules && <span style={{ color: 'var(--color-warning, #f59e0b)', fontSize: '11px', marginLeft: 6 }}>Tùy chỉnh</span>}
                {nsfwRulesActive && <span style={{ color: 'var(--color-success, #10b981)', fontSize: '11px', marginLeft: 6 }}>Đang áp dụng</span>}
              </label>
              <div className="form-hint" style={{ marginBottom: '4px' }}>
                Ô này thêm luật bổ sung sau system prompt NSFW gốc. Nếu bạn cũng có nhập `System prompt NSFW tùy chỉnh` ở trên thì thứ tự sẽ là:
                system prompt tùy chỉnh trước, luật bổ sung sau.
              </div>
              <div className="prompt-default-preview">
                <div className="prompt-default-preview__header">
                  <span>Rule gốc mặc định khi bật NSFW</span>
                  <code>nsfw_rules</code>
                </div>
                <pre className="prompt-default-preview__body">{DEFAULT_NSFW_RULES}</pre>
              </div>
              <div className="prompt-editor-header">Luật bổ sung khi bật NSFW</div>
              <textarea
                className="textarea"
                value={customNsfwRules}
                onChange={(e) => handlePromptChange('nsfw_rules', e.target.value)}
                rows={8}
                placeholder="Để trống = chỉ dùng rule gốc mặc định ở trên"
              />
              {hasCustomNsfwRules && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'flex-start', fontSize: '11px' }}
                  onClick={() => handlePromptChange('nsfw_rules', '')}
                >
                  Xóa luật bổ sung
                </button>
              )}
            </div>

            {/* ─── Task-type overrides (unchanged) ─── */}
            <div className="form-group">
              <label className="form-label">
                Prompt tăng cường cho cảnh thân mật
                {hasCustomNsfwIntimatePrompt && <span style={{ color: 'var(--color-warning, #f59e0b)', fontSize: '11px', marginLeft: 6 }}>Tùy chỉnh</span>}
                {nsfwRulesActive && <span style={{ color: 'var(--color-success, #10b981)', fontSize: '11px', marginLeft: 6 }}>Đang áp dụng khi viết cảnh phù hợp</span>}
              </label>
              <div className="form-hint" style={{ marginBottom: '4px' }}>
                Ô này là lớp tăng cường riêng cho cảnh thân mật/18+. Để trống = dùng prompt tăng cường mặc định của app. App vẫn tự nối thêm continuity động về quan hệ, đồng thuận, bí mật và dư âm cảm xúc khi có dữ liệu.
              </div>
              <div className="prompt-default-preview">
                <div className="prompt-default-preview__header">
                  <span>Prompt tăng cường mặc định cho cảnh thân mật</span>
                  <code>nsfw_intimate_prompt</code>
                </div>
                <pre className="prompt-default-preview__body">{DEFAULT_NSFW_INTIMATE_PROMPT}</pre>
              </div>
              <div className="prompt-editor-header">Prompt tăng cường tùy chỉnh</div>
              <textarea
                className="textarea"
                value={customNsfwIntimatePrompt}
                onChange={(e) => handlePromptChange('nsfw_intimate_prompt', e.target.value)}
                rows={12}
                placeholder="Để trống = dùng prompt tăng cường mặc định ở trên"
              />
              {hasCustomNsfwIntimatePrompt && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'flex-start', fontSize: '11px' }}
                  onClick={() => handlePromptChange('nsfw_intimate_prompt', '')}
                >
                  Xóa prompt tăng cường tùy chỉnh
                </button>
              )}
            </div>

            {Object.entries(TASK_TYPES).map(([key, taskType]) => {
              const taskMeta = TASK_TYPE_META[taskType] || { label: key, description: '' };
              const defaultPrompt = TASK_INSTRUCTIONS[taskType] || '';
              const hasCustom = !!(promptTemplates[taskType]);
              const displayKey = PROMPT_DISPLAY_KEYS[key] || key;
              const displayTaskType = PROMPT_DISPLAY_KEYS[key] || taskType;
              return (
                <div key={key} className="form-group">
                  <label className="form-label">
                    {taskMeta.label} <span style={{ color: 'var(--color-text-muted)', fontWeight: 'normal', fontSize: '11px' }}>({displayTaskType})</span>
                    {hasCustom && <span style={{ color: 'var(--color-warning, #f59e0b)', fontSize: '11px', marginLeft: 6 }}>Tùy chỉnh</span>}
                  </label>
                  {taskMeta.description && (
                    <div className="form-hint" style={{ marginBottom: '4px' }}>
                      {taskMeta.description}
                    </div>
                  )}
                  {defaultPrompt && (
                    <div className="prompt-default-preview">
                      <div className="prompt-default-preview__header">
                        <span>Prompt gốc mặc định</span>
                        <code>{displayKey}</code>
                      </div>
                      <pre className="prompt-default-preview__body">{defaultPrompt}</pre>
                    </div>
                  )}
                  <div className="prompt-editor-header">Prompt tùy chỉnh</div>
                  <textarea
                    className="textarea"
                    value={promptTemplates[taskType] || ''}
                    onChange={(e) => handlePromptChange(taskType, e.target.value)}
                    rows={5}
                    placeholder="Để trống = dùng prompt gốc mặc định ở trên"
                  />
                  {hasCustom && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', fontSize: '11px' }} onClick={() => handlePromptChange(taskType, '')}>
                      Xóa tùy chỉnh và quay về prompt gốc
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ SECTION: Hộp đề xuất ═══ */}
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
            <button className="btn btn-primary" onClick={() => navigate(`/project/${currentProject?.id}/characters`)}>
              <Users size={16} /> Nhân vật
            </button>
            <button className="btn btn-ghost" onClick={() => navigate(`/project/${currentProject?.id}/world`)}>
              <MapPin size={16} /> Thế giới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
