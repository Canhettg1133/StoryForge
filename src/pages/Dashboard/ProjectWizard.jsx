/**
 * StoryForge — AI Project Wizard
 * 3-step wizard: Input → AI Generate → Review & Approve
 *
 * Thay đổi so với bản cũ:
 *  - System prompt: thêm mảng `factions`, làm rõ ranh giới
 *    locations (địa điểm vật lý) / terms (khái niệm/phép thuật) / factions (thế lực/tổ chức)
 *    → Khắc phục "Bệnh 1": AI không còn nhét tông môn vào Thuật ngữ
 *  - Import createFaction từ codexStore
 *  - Review step: thêm section "Thế lực" với edit + exclude
 *  - handleApprove: tạo factions vào DB
 *
 * Phase 9:
 *  - Thêm section "Đại Cục" trong Step 0 — tác giả nhập 5-8 cột mốc lớn
 *  - handleApprove: lưu macro arcs vào bảng macro_arcs
 */

import React, { useState } from 'react';
import {
  GENRES, TONES, POV_MODES, STORY_STRUCTURES,
  PRONOUN_STYLE_PRESETS, GENRE_TO_PRONOUN_STYLE,
} from '../../utils/constants';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import usePlotStore from '../../stores/plotStore';
import db from '../../services/db/database';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import {
  Sparkles, ArrowRight, ArrowLeft, X, Loader2, Check,
  RotateCcw, Users, MapPin, BookOpen, List, AlertCircle,
  Trash2, Globe, Eye, MessageSquare, Plus, GitPullRequest,
  Pencil, Landmark, Flag, TrendingUp,
} from 'lucide-react';
import './ProjectWizard.css';

const STEPS = ['Ý tưởng', 'AI đang tạo...', 'Xem & Duyệt'];

const VALID_THREAD_TYPES = ['main', 'subplot', 'character_arc', 'mystery', 'romance'];
const TYPE_LABELS = {
  main: 'Tuyến chính', subplot: 'Tuyến phụ', character_arc: 'Nhân vật',
  mystery: 'Bí ẩn', romance: 'Tình cảm',
};
const CHAR_ROLES = ['protagonist', 'antagonist', 'supporting', 'mentor', 'minor'];
const CHAR_ROLE_LABELS = {
  protagonist: 'Nhân vật chính',
  antagonist: 'Phản diện',
  supporting: 'Phụ trợ',
  mentor: 'Sư phụ / Cố vấn',
  minor: 'Quần chúng',
};
const TERM_CATEGORIES = ['magic', 'race', 'technology', 'other'];
const FACTION_TYPES = ['sect', 'kingdom', 'organization', 'other'];
const FACTION_TYPE_LABELS = {
  sect: 'Tông môn', kingdom: 'Vương quốc', organization: 'Tổ chức', other: 'Thế lực',
};

export default function ProjectWizard({ onClose, onCreated }) {
  const { createProject, createChapter, updateChapter } = useProjectStore();
  const {
    createCharacter, createLocation, createWorldTerm,
    createFaction,
    saveChapterSummary,
  } = useCodexStore();
  const { createPlotThread } = usePlotStore();

  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState('');
  const [genre, setGenre] = useState('tien_hiep');
  const [tone, setTone] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);
  const [povMode, setPovMode] = useState('third_omni');
  const [pronounStyle, setPronounStyle] = useState(GENRE_TO_PRONOUN_STYLE['tien_hiep'] || 'tien_hiep');
  const [synopsis, setSynopsis] = useState('');
  const [storyStructure, setStoryStructure] = useState('');

  // Phase 5: Pacing Fields
  const [targetLength, setTargetLength] = useState(0);
  const [targetLengthType, setTargetLengthType] = useState('unset');
  const [ultimateGoal, setUltimateGoal] = useState('');
  const [milestonesInfo, setMilestonesInfo] = useState([]);

  // Phase 9: Macro Arcs (Đại Cục) — optional, tác giả nhập thủ công
  const [macroArcsInput, setMacroArcsInput] = useState([]);
  const [showMacroArcs, setShowMacroArcs] = useState(false);

  const handleTargetLengthTypeChange = (v) => {
    setTargetLengthType(v);
    let newLen = targetLength;
    if (v === 'short') newLen = 50;
    else if (v === 'medium') newLen = 150;
    else if (v === 'long') newLen = 400;
    else if (v === 'epic') newLen = 800;
    setTargetLength(newLen);
  };
  const addMilestone = () => setMilestonesInfo(prev => [...prev, { percent: 50, description: '' }]);
  const updateMilestone = (idx, field, val) => {
    const next = [...milestonesInfo];
    next[idx] = { ...next[idx], [field]: val };
    setMilestonesInfo(next);
  };
  const removeMilestone = (idx) => setMilestonesInfo(prev => prev.filter((_, i) => i !== idx));

  // Phase 9: Macro Arc handlers
  const addMacroArc = () => {
    setMacroArcsInput(prev => [...prev, {
      title: 'Cột mốc ' + (prev.length + 1),
      description: '',
      chapter_from: '',
      chapter_to: '',
      emotional_peak: '',
    }]);
  };
  const updateMacroArc = (idx, field, val) => {
    const next = [...macroArcsInput];
    next[idx] = { ...next[idx], [field]: val };
    setMacroArcsInput(next);
  };
  const removeMacroArc = (idx) => setMacroArcsInput(prev => prev.filter((_, i) => i !== idx));

  const handleGenreChange = (val) => {
    setGenre(val);
    setPronounStyle(GENRE_TO_PRONOUN_STYLE[val] || 'hien_dai');
  };

  const currentPronoun = PRONOUN_STYLE_PRESETS.find(p => p.value === pronounStyle);

  // AI result
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Toggle items in result
  const [excluded, setExcluded] = useState(new Set());
  const toggleExclude = (key) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Inline edit state ──
  const [editingKey, setEditingKey] = useState(null);
  const toggleEdit = (key) => setEditingKey(prev => prev === key ? null : key);

  const updateResultItem = (section, index, field, value) => {
    setResult(prev => {
      const arr = [...(prev[section] || [])];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, [section]: arr };
    });
  };

  // ── Mini-form renderers ──

  const renderCharEdit = (c, i) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Tên</label>
          <input className="input input-sm" value={c.name || ''} onChange={e => updateResultItem('characters', i, 'name', e.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Vai trò</label>
          <select className="select select-sm" value={c.role || 'supporting'} onChange={e => updateResultItem('characters', i, 'role', e.target.value)}>
            {CHAR_ROLES.map(r => <option key={r} value={r}>{CHAR_ROLE_LABELS[r] || r}</option>)}
          </select>
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Tính cách</label>
        <textarea className="textarea textarea-sm" rows={2} value={c.personality || ''} onChange={e => updateResultItem('characters', i, 'personality', e.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Điểm yếu</label>
        <input className="input input-sm" value={c.flaws || ''} onChange={e => updateResultItem('characters', i, 'flaws', e.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Mục tiêu</label>
        <input className="input input-sm" value={c.goals || ''} onChange={e => updateResultItem('characters', i, 'goals', e.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Ngoại hình</label>
        <input className="input input-sm" value={c.appearance || ''} onChange={e => updateResultItem('characters', i, 'appearance', e.target.value)} />
      </div>
    </div>
  );

  const renderLocEdit = (l, i) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-field">
        <label>Tên địa điểm</label>
        <input className="input input-sm" value={l.name || ''} onChange={e => updateResultItem('locations', i, 'name', e.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Mô tả</label>
        <textarea className="textarea textarea-sm" rows={2} value={l.description || ''} onChange={e => updateResultItem('locations', i, 'description', e.target.value)} />
      </div>
    </div>
  );

  const renderTermEdit = (t, i) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Thuật ngữ</label>
          <input className="input input-sm" value={t.name || ''} onChange={e => updateResultItem('terms', i, 'name', e.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Danh mục</label>
          <select className="select select-sm" value={t.category || 'other'} onChange={e => updateResultItem('terms', i, 'category', e.target.value)}>
            {TERM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Định nghĩa</label>
        <textarea className="textarea textarea-sm" rows={2} value={t.definition || ''} onChange={e => updateResultItem('terms', i, 'definition', e.target.value)} />
      </div>
    </div>
  );

  const renderFactionEdit = (f, i) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Tên thế lực</label>
          <input className="input input-sm" value={f.name || ''} onChange={e => updateResultItem('factions', i, 'name', e.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Loại</label>
          <select className="select select-sm" value={f.faction_type || 'sect'} onChange={e => updateResultItem('factions', i, 'faction_type', e.target.value)}>
            {FACTION_TYPES.map(t => <option key={t} value={t}>{FACTION_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Mô tả</label>
        <textarea className="textarea textarea-sm" rows={2} value={f.description || ''} onChange={e => updateResultItem('factions', i, 'description', e.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Ghi chú</label>
        <input className="input input-sm" value={f.notes || ''} onChange={e => updateResultItem('factions', i, 'notes', e.target.value)} />
      </div>
    </div>
  );

  const renderChapterEdit = (ch, i) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-field">
        <label>Tiêu đề</label>
        <input className="input input-sm" value={ch.title || ''} onChange={e => updateResultItem('chapters', i, 'title', e.target.value)} />
      </div>
      <div className="wizard-edit-field">
        <label>Tóm tắt</label>
        <textarea className="textarea textarea-sm" rows={3} value={ch.summary || ''} onChange={e => updateResultItem('chapters', i, 'summary', e.target.value)} />
      </div>
    </div>
  );

  const renderThreadEdit = (pt, i) => (
    <div className="wizard-item-edit">
      <div className="wizard-edit-row">
        <div className="wizard-edit-field">
          <label>Tên tuyến truyện</label>
          <input className="input input-sm" value={pt.title || ''} onChange={e => updateResultItem('plot_threads', i, 'title', e.target.value)} />
        </div>
        <div className="wizard-edit-field">
          <label>Loại</label>
          <select className="select select-sm" value={pt.type || 'subplot'} onChange={e => updateResultItem('plot_threads', i, 'type', e.target.value)}>
            {VALID_THREAD_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      </div>
      <div className="wizard-edit-field">
        <label>Mô tả</label>
        <textarea className="textarea textarea-sm" rows={2} value={pt.description || ''} onChange={e => updateResultItem('plot_threads', i, 'description', e.target.value)} />
      </div>
    </div>
  );

  const renderItemActions = (key) => (
    <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
      <button
        className={`btn btn-ghost btn-icon btn-sm ${editingKey === key ? 'btn--active' : ''}`}
        onClick={() => toggleEdit(key)}
        title={editingKey === key ? 'Đóng chỉnh sửa' : 'Chỉnh sửa'}
      >
        <Pencil size={14} />
      </button>
      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleExclude(key)}>
        {excluded.has(key) ? <RotateCcw size={14} /> : <Trash2 size={14} />}
      </button>
    </div>
  );

  // ── Step 1 → Step 2: Generate ──
  const handleGenerate = async () => {
    setStep(1);
    setIsGenerating(true);
    setError(null);

    const template = GENRE_TEMPLATES[genre];
    const templateHint = template && useTemplate
      ? `\n\nTham khảo template thể loại "${template.label}":\n- Quy tắc thế giới: ${template.worldRules?.join(', ')}\n- Thuật ngữ gợi ý: ${template.terms?.map(t => t.name).join(', ')}`
      : '';

    const genreLabel = GENRES.find(g => g.value === genre)?.label || genre;

    const messages = [
      {
        role: 'system',
        content: `Bạn là trợ lý tạo dự án truyện chữ.

Trả về CHÍNH XÁC JSON format:
{
  "premise": "Tóm tắt premise 2-3 câu",
  "world_profile": {
    "world_name": "Tên thế giới",
    "world_type": "Loại: tu tiên / hiện đại / sci-fi...",
    "world_scale": "Quy mô: 1 lục địa / nhiều giới...",
    "world_era": "Thời đại: thượng cổ / trung cổ / hiện đại...",
    "world_rules": ["Quy tắc 1", "Quy tắc 2", "Quy tắc 3"],
    "world_description": "Mô tả tổng quan thế giới 2-3 câu"
  },
  "characters": [{"name": "...", "role": "protagonist|antagonist|supporting|mentor|minor", "appearance": "...", "personality": "...", "personality_tags": "tag1, tag2", "flaws": "điểm yếu / khuyết điểm lúc đầu", "goals": "..."}],
  "locations": [{"name": "...", "description": "..."}],
  "factions": [{"name": "...", "faction_type": "sect|kingdom|organization|other", "description": "...", "notes": "..."}],
  "terms": [{"name": "...", "definition": "...", "category": "magic|race|technology|other"}],
  "chapters": [{"title": "Chương 1: ...", "summary": "Tóm tắt nội dung chương"}],
  "plot_threads": [{"title": "...", "type": "main|subplot|character_arc|mystery|romance", "description": "mô tả tuyến truyện 1-2 câu", "state": "active"}]
}

PHÂN LOẠI RÕ RÀNG — RẤT QUAN TRỌNG:
- "locations": CHỈ địa điểm VẬT LÝ có thể đến được: núi, thành phố, tòa nhà, hang động, vùng đất. KHÔNG đặt tông môn hay tổ chức vào đây.
- "factions": Tông môn, bang phái, vương triều, tổ chức, thế lực chính trị.
- "terms": CHỈ khái niệm trừu tượng, hệ thống tu luyện, chủng tộc, công nghệ.

Tạo: world_profile chi tiết, 3-5 nhân vật, 3-5 địa điểm vật lý, 2-4 thế lực/tông môn (nếu phù hợp thể loại), 3-5 thuật ngữ, 8-12 chương, 2-4 tuyến truyện lớn.
LƯU Ý: Bất kỳ nhân vật nào ở điểm bắt đầu cũng phải có điểm yếu (flaws) rõ ràng. Cấm tạo nhân vật hoàn mỹ ngay từ đầu.
Chỉ trả về JSON, không thêm gì khác.`,
      },
      {
        role: 'user',
        content: `Thể loại: ${genreLabel}\nTone: ${tone || 'mặc định'}\nGóc nhìn: ${POV_MODES.find(p => p.value === povMode)?.label || 'Ngôi 3'}\nXưng hô: ${currentPronoun?.label || 'Mặc định'}\nĐộ dài dự kiến: ${targetLength > 0 ? targetLength + ' chương' : 'Chưa xác định'}\nĐích đến tối thượng: ${ultimateGoal || 'Chưa có'}\n${synopsis ? 'Cốt truyện: ' + synopsis + '\n' : ''}${storyStructure ? 'Cấu trúc: ' + STORY_STRUCTURES.find(s => s.value === storyStructure)?.label + '\n' : ''}\nÝ tưởng: ${idea}${templateHint}`,
      },
    ];

    aiService.send({
      taskType: TASK_TYPES.PROJECT_WIZARD,
      messages,
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          const parsedValue = parseAIJsonValue(text);
          const nextResult = Array.isArray(parsedValue)
            ? (parsedValue.length === 1 && isPlainObject(parsedValue[0])
              ? parsedValue[0]
              : (parsedValue.every(isPlainObject)
                ? { premise: '', characters: [], locations: [], factions: [], terms: [], chapters: parsedValue }
                : null))
            : (isPlainObject(parsedValue) ? parsedValue : null);

          if (!nextResult) throw new Error('Unexpected JSON format');
          if (!Array.isArray(nextResult.factions)) nextResult.factions = [];

          setResult(nextResult);
          setStep(2);
        } catch (e) {
          console.error('[Wizard] Parse error:', e, '\nRaw:', text);
          setError('Không parse được kết quả. Thử lại?');
          setStep(0);
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(err.message || 'Lỗi kết nối AI');
        setStep(0);
      },
    });
  };

  // ── Step 3: Create everything ──
  const handleApprove = async () => {
    if (!result) return;
    setIsGenerating(true);

    try {
      // 1. Create project
      const wp = result.world_profile || {};
      const projectId = await createProject({
        title: result.premise?.substring(0, 50) || idea.substring(0, 50) || 'Dự án mới',
        genre_primary: genre,
        tone: tone,
        description: result.premise || idea,
        world_name: wp.world_name || '',
        world_type: wp.world_type || '',
        world_scale: wp.world_scale || '',
        world_era: wp.world_era || '',
        world_rules: JSON.stringify(wp.world_rules || []),
        world_description: wp.world_description || '',
        pov_mode: povMode,
        pronoun_style: pronounStyle,
        synopsis: synopsis || result.premise || '',
        story_structure: storyStructure,
        target_length: Number(targetLength) || 0,
        target_length_type: targetLengthType,
        ultimate_goal: ultimateGoal,
        milestones: JSON.stringify(milestonesInfo),
        skipFirstChapter: true,
      });

      // 2. Create chapters
      if (result.chapters?.length > 0) {
        for (let i = 0; i < result.chapters.length; i++) {
          const ch = result.chapters[i];
          if (!excluded.has(`chapter-${i}`)) {
            await createChapter(projectId, ch.title || `Chương ${i + 1}`);
          }
        }
      }

      if (result.chapters?.length > 0) {
        const createdChapters = await db.chapters
          .where('project_id').equals(projectId)
          .sortBy('order_index');
        let createdIndex = 0;

        for (let i = 0; i < result.chapters.length; i++) {
          if (excluded.has(`chapter-${i}`)) continue;
          const createdChapter = createdChapters[createdIndex];
          if (createdChapter) {
            const summary = result.chapters[i]?.summary || '';
            if (summary) await saveChapterSummary(createdChapter.id, projectId, summary);
            await updateChapter(createdChapter.id, { summary });
          }
          createdIndex++;
        }
      }

      // 3. Create characters
      if (result.characters?.length > 0) {
        for (let i = 0; i < result.characters.length; i++) {
          const c = result.characters[i];
          if (!excluded.has(`char-${i}`)) {
            await createCharacter({
              project_id: projectId,
              name: c.name,
              role: c.role || 'supporting',
              appearance: c.appearance || '',
              personality: (c.personality || '') + (c.flaws ? `\nĐiểm yếu: ${c.flaws}` : ''),
              flaws: c.flaws || '',
              personality_tags: c.personality_tags || '',
              goals: c.goals || '',
            });
          }
        }
      }

      // 4. Create locations
      if (result.locations?.length > 0) {
        for (let i = 0; i < result.locations.length; i++) {
          const l = result.locations[i];
          if (!excluded.has(`loc-${i}`)) {
            await createLocation({
              project_id: projectId,
              name: l.name,
              description: l.description || '',
            });
          }
        }
      }

      // 5. Create factions
      if (result.factions?.length > 0) {
        for (let i = 0; i < result.factions.length; i++) {
          const f = result.factions[i];
          if (!excluded.has(`faction-${i}`) && f.name?.trim()) {
            await createFaction({
              project_id: projectId,
              name: f.name.trim(),
              faction_type: FACTION_TYPES.includes(f.faction_type) ? f.faction_type : 'other',
              description: f.description || '',
              notes: f.notes || '',
              aliases: [],
            });
          }
        }
      }

      // 6. Create terms
      if (result.terms?.length > 0) {
        for (let i = 0; i < result.terms.length; i++) {
          const t = result.terms[i];
          if (!excluded.has(`term-${i}`)) {
            await createWorldTerm({
              project_id: projectId,
              name: t.name,
              definition: t.definition || '',
              category: t.category || 'other',
            });
          }
        }
      }

      // 7. Create plot threads
      const nextPlotThreads = Array.isArray(result.plot_threads)
        ? result.plot_threads.filter(isPlainObject)
        : [];

      for (let i = 0; i < nextPlotThreads.length; i++) {
        const pt = nextPlotThreads[i];
        if (!pt.title?.trim() || excluded.has(`thread-${i}`)) continue;
        await createPlotThread({
          project_id: projectId,
          title: pt.title.trim(),
          type: VALID_THREAD_TYPES.includes(pt.type) ? pt.type : 'subplot',
          description: pt.description || '',
          state: pt.state === 'resolved' ? 'resolved' : 'active',
        });
      }

      // 8. Phase 9: Save macro arcs (Đại Cục) nếu tác giả đã nhập
      const validMacroArcs = macroArcsInput.filter(m => m.title?.trim());
      for (let i = 0; i < validMacroArcs.length; i++) {
        const m = validMacroArcs[i];
        await db.macro_arcs.add({
          project_id: projectId,
          order_index: i,
          title: m.title.trim(),
          description: m.description || '',
          chapter_from: Number(m.chapter_from) || 0,
          chapter_to: Number(m.chapter_to) || 0,
          emotional_peak: m.emotional_peak || '',
        });
      }

      onCreated(projectId);
    } catch (err) {
      console.error('[Wizard] Create error:', err);
      setError('Lỗi khi tạo dự án: ' + err.message);
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setStep(0);
    setResult(null);
    setExcluded(new Set());
    setEditingKey(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal wizard-modal animate-scale-up" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            <Sparkles size={20} style={{ color: 'var(--color-accent)' }} />
            {' '}AI Wizard — {STEPS[step]}
          </h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Progress */}
        <div className="wizard-progress">
          {STEPS.map((s, i) => (
            <div
              key={i}
              className={`wizard-step ${i === step ? 'wizard-step--active' : ''} ${i < step ? 'wizard-step--done' : ''}`}
            >
              <span className="wizard-step-number">{i < step ? '✓' : i + 1}</span>
              <span className="wizard-step-label">{s}</span>
            </div>
          ))}
        </div>

        {/* ─── Step 0: Input ─── */}
        {step === 0 && (
          <div className="wizard-body">
            {error && (
              <div className="wizard-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Thể loại</label>
                <select className="select" value={genre} onChange={(e) => handleGenreChange(e.target.value)}>
                  {GENRES.map(g => (
                    <option key={g.value} value={g.value}>{g.emoji} {g.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Tone</label>
                <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="">Mặc định</option>
                  {TONES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label"><Eye size={13} /> Góc nhìn</label>
                <select className="select" value={povMode} onChange={(e) => setPovMode(e.target.value)}>
                  {POV_MODES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <span className="form-hint">{POV_MODES.find(p => p.value === povMode)?.desc}</span>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label"><MessageSquare size={13} /> Xưng hô</label>
                <select className="select" value={pronounStyle} onChange={(e) => setPronounStyle(e.target.value)}>
                  {PRONOUN_STYLE_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {currentPronoun && currentPronoun.value !== 'custom' && (
                  <span className="form-hint">
                    Xưng: "{currentPronoun.default_self}" — Gọi: "{currentPronoun.default_other}"
                  </span>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label"><BookOpen size={13} /> Cấu trúc truyện</label>
              <select className="select" value={storyStructure} onChange={(e) => setStoryStructure(e.target.value)}>
                {STORY_STRUCTURES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
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
                <label className="form-label">Số chương mục tiêu</label>
                <input
                  type="number"
                  className="input"
                  value={targetLength}
                  onChange={(e) => setTargetLength(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Đích đến tối thượng (Long-term Goal)</label>
              <textarea
                className="textarea"
                value={ultimateGoal}
                onChange={(e) => setUltimateGoal(e.target.value)}
                rows={2}
                placeholder="VD: Main đạt cảnh giới Thần Tôn và báo thù diệt tộc."
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Cột mốc %
                <button className="btn btn-ghost btn-xs ml-2" onClick={addMilestone}>
                  <Plus size={12} /> Thêm
                </button>
              </label>
              {milestonesInfo.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    type="number" className="input" style={{ width: '80px' }}
                    value={m.percent}
                    onChange={e => updateMilestone(idx, 'percent', Number(e.target.value))}
                    placeholder="%"
                  />
                  <span style={{ alignSelf: 'center', fontSize: '12px' }}>%</span>
                  <input
                    className="input" style={{ flex: 1 }}
                    value={m.description}
                    onChange={e => updateMilestone(idx, 'description', e.target.value)}
                    placeholder="Mô tả cột mốc..."
                  />
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeMilestone(idx)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* ─── Phase 9: Đại Cục (optional, collapsible) ─── */}
            <div className="form-group">
              <label
                className="form-label"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={() => setShowMacroArcs(v => !v)}
              >
                <TrendingUp size={13} />
                Đại Cục — Cột mốc lớn
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>
                  (không bắt buộc — có thể thêm sau trong Story Bible)
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '11px' }}>
                  {showMacroArcs ? '▲ Ẩn' : '▼ Mở'}
                </span>
              </label>

              {showMacroArcs && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                    Định nghĩa 5–8 cột mốc lớn của toàn bộ truyện. AI sẽ không cho nhân vật vượt qua cột mốc hiện tại.
                  </p>

                  {macroArcsInput.map((m, idx) => (
                    <div key={idx} style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2) var(--space-3)',
                      marginBottom: 'var(--space-2)',
                    }}>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                        <span style={{
                          width: '20px', height: '20px', borderRadius: '50%',
                          background: 'var(--color-accent)', color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: 700, flexShrink: 0,
                        }}>{idx + 1}</span>
                        <input
                          className="input input-sm"
                          style={{ flex: 1 }}
                          value={m.title}
                          onChange={e => updateMacroArc(idx, 'title', e.target.value)}
                          placeholder="Tên cột mốc (VD: Kẻ Dị Biệt)"
                        />
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeMacroArc(idx)}>
                          <X size={13} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Ch.</span>
                        <input
                          type="number" className="input input-sm" style={{ width: '70px' }}
                          value={m.chapter_from}
                          onChange={e => updateMacroArc(idx, 'chapter_from', e.target.value)}
                          placeholder="Từ"
                        />
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>→</span>
                        <input
                          type="number" className="input input-sm" style={{ width: '70px' }}
                          value={m.chapter_to}
                          onChange={e => updateMacroArc(idx, 'chapter_to', e.target.value)}
                          placeholder="Đến"
                        />
                      </div>
                      <input
                        className="input input-sm"
                        style={{ marginBottom: 'var(--space-1)' }}
                        value={m.emotional_peak}
                        onChange={e => updateMacroArc(idx, 'emotional_peak', e.target.value)}
                        placeholder="Cảm xúc độc giả khi kết thúc cột mốc này..."
                      />
                    </div>
                  ))}

                  <button className="btn btn-ghost btn-sm" onClick={addMacroArc}>
                    <Plus size={13} /> Thêm cột mốc
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Ý tưởng truyện *</label>
              <textarea
                className="textarea"
                placeholder="Ví dụ: Thiếu niên mồ côi phát hiện mình có huyết mạch cổ thần, gia nhập tông môn nhỏ nhưng nhanh chóng vượt qua các thiên tài..."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">📖 Cốt truyện chính (Synopsis)</label>
              <textarea
                className="textarea"
                placeholder="Tóm tắt mạch truyện chính... (không bắt buộc)"
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                rows={2}
              />
            </div>

            {GENRE_TEMPLATES[genre] && (
              <label className="wizard-template-toggle">
                <input
                  type="checkbox"
                  checked={useTemplate}
                  onChange={(e) => setUseTemplate(e.target.checked)}
                />
                <span>Dùng template "{GENRE_TEMPLATES[genre].label}" làm cơ sở</span>
              </label>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
              <button
                className="btn btn-primary"
                onClick={handleGenerate}
                disabled={!idea.trim()}
              >
                <Sparkles size={16} /> Tạo bằng AI <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 1: Generating ─── */}
        {step === 1 && (
          <div className="wizard-body wizard-loading">
            <Loader2 size={48} className="spin" />
            <h3>AI đang xây dựng thế giới truyện...</h3>
            <p>Premise, nhân vật, thế giới, thế lực và outline chương</p>
          </div>
        )}

        {/* ─── Step 2: Review ─── */}
        {step === 2 && result && (
          <div className="wizard-body wizard-review">

            {/* Premise */}
            <div className="wizard-section">
              <h4>📖 Premise</h4>
              <p className="wizard-premise">{result.premise}</p>
            </div>

            {/* World Profile */}
            {result.world_profile && (
              <div className="wizard-section">
                <h4>
                  <Globe size={16} /> Thế giới: {result.world_profile.world_name || 'Chưa đặt tên'}
                </h4>
                <div className="wizard-item">
                  <div className="wizard-item-content">
                    {result.world_profile.world_type && (
                      <span className="badge badge-sm">{result.world_profile.world_type}</span>
                    )}
                    {result.world_profile.world_scale && (
                      <span className="badge badge-sm">{result.world_profile.world_scale}</span>
                    )}
                    {result.world_profile.world_era && (
                      <span className="badge badge-sm">{result.world_profile.world_era}</span>
                    )}
                    {result.world_profile.world_rules?.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {result.world_profile.world_rules.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                    {result.world_profile.world_description && (
                      <p>{result.world_profile.world_description}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Characters */}
            {result.characters?.length > 0 && (
              <div className="wizard-section">
                <h4>
                  <Users size={16} /> Nhân vật ({result.characters.filter((_, i) => !excluded.has(`char-${i}`)).length})
                </h4>
                <div className="wizard-items">
                  {result.characters.map((c, i) => {
                    const key = `char-${i}`;
                    return (
                      <div key={i} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                        <div className="wizard-item-content">
                          <strong>{c.name}</strong>{' '}
                          <span className="badge badge-sm">{c.role}</span>
                          {c.personality && <p>{c.personality}</p>}
                          {c.flaws && (
                            <p style={{ fontSize: '13px', marginTop: '4px', color: 'var(--color-warning, #f59e0b)' }}>
                              <strong>Điểm yếu:</strong> {c.flaws}
                            </p>
                          )}
                        </div>
                        {renderItemActions(key)}
                        {editingKey === key && renderCharEdit(c, i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Locations */}
            {result.locations?.length > 0 && (
              <div className="wizard-section">
                <h4>
                  <MapPin size={16} /> Địa điểm ({result.locations.filter((_, i) => !excluded.has(`loc-${i}`)).length})
                </h4>
                <div className="wizard-items">
                  {result.locations.map((l, i) => {
                    const key = `loc-${i}`;
                    return (
                      <div key={i} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                        <div className="wizard-item-content">
                          <strong>{l.name}</strong>
                          {l.description && <p>{l.description}</p>}
                        </div>
                        {renderItemActions(key)}
                        {editingKey === key && renderLocEdit(l, i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Factions */}
            {result.factions?.length > 0 && (
              <div className="wizard-section">
                <h4>
                  <Landmark size={16} /> Thế lực ({result.factions.filter((_, i) => !excluded.has(`faction-${i}`)).length})
                </h4>
                <div className="wizard-items">
                  {result.factions.map((f, i) => {
                    const key = `faction-${i}`;
                    return (
                      <div key={i} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                        <div className="wizard-item-content">
                          <strong>{f.name}</strong>{' '}
                          <span className="badge badge-sm">
                            {FACTION_TYPE_LABELS[f.faction_type] || f.faction_type || 'Thế lực'}
                          </span>
                          {f.description && <p>{f.description}</p>}
                        </div>
                        {renderItemActions(key)}
                        {editingKey === key && renderFactionEdit(f, i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Terms */}
            {result.terms?.length > 0 && (
              <div className="wizard-section">
                <h4>
                  <BookOpen size={16} /> Thuật ngữ ({result.terms.filter((_, i) => !excluded.has(`term-${i}`)).length})
                </h4>
                <div className="wizard-items">
                  {result.terms.map((t, i) => {
                    const key = `term-${i}`;
                    return (
                      <div key={i} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                        <div className="wizard-item-content">
                          <strong>{t.name}</strong>
                          {t.definition && <p>{t.definition}</p>}
                        </div>
                        {renderItemActions(key)}
                        {editingKey === key && renderTermEdit(t, i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chapters */}
            {result.chapters?.length > 0 && (
              <div className="wizard-section">
                <h4>
                  <List size={16} /> Chapters ({result.chapters.filter((_, i) => !excluded.has(`chapter-${i}`)).length})
                </h4>
                <div className="wizard-items wizard-items--compact">
                  {result.chapters.map((ch, i) => {
                    const key = `chapter-${i}`;
                    return (
                      <div key={i} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                        <div className="wizard-item-content">
                          <strong>{ch.title}</strong>
                          {ch.summary && <p>{ch.summary}</p>}
                        </div>
                        {renderItemActions(key)}
                        {editingKey === key && renderChapterEdit(ch, i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Plot Threads */}
            {result.plot_threads?.length > 0 && (
              <div className="wizard-section">
                <h4>
                  <GitPullRequest size={16} /> Tuyến truyện ({result.plot_threads.filter((_, i) => !excluded.has(`thread-${i}`)).length})
                </h4>
                <div className="wizard-items">
                  {result.plot_threads.map((pt, i) => {
                    const key = `thread-${i}`;
                    return (
                      <div key={i} className={`wizard-item ${excluded.has(key) ? 'wizard-item--excluded' : ''}`}>
                        <div className="wizard-item-content">
                          <strong>{pt.title}</strong>
                          <span className="badge badge-sm" style={{ marginLeft: '6px' }}>
                            {TYPE_LABELS[pt.type] || pt.type}
                          </span>
                          {pt.description && <p>{pt.description}</p>}
                        </div>
                        {renderItemActions(key)}
                        {editingKey === key && renderThreadEdit(pt, i)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Macro Arcs preview (nếu đã nhập) */}
            {macroArcsInput.filter(m => m.title?.trim()).length > 0 && (
              <div className="wizard-section">
                <h4>
                  <TrendingUp size={16} /> Đại Cục ({macroArcsInput.filter(m => m.title?.trim()).length} cột mốc)
                </h4>
                <div className="wizard-items">
                  {macroArcsInput.filter(m => m.title?.trim()).map((m, i) => (
                    <div key={i} className="wizard-item">
                      <div className="wizard-item-content">
                        <strong>{m.title}</strong>
                        {(m.chapter_from || m.chapter_to) && (
                          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '8px' }}>
                            Ch.{m.chapter_from}–{m.chapter_to}
                          </span>
                        )}
                        {m.emotional_peak && <p style={{ fontSize: '12px', fontStyle: 'italic' }}>{m.emotional_peak}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={handleReset}>
                <ArrowLeft size={16} /> Quay lại
              </button>
              <button className="btn btn-ghost" onClick={() => { setResult(null); setStep(0); setEditingKey(null); }}>
                <RotateCcw size={16} /> Tạo lại
              </button>
              <button className="btn btn-primary" onClick={handleApprove} disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 size={16} className="spin" /> Đang tạo...</>
                ) : (
                  <><Check size={16} /> Duyệt & Tạo dự án</>
                )}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}