/**
 * StoryForge — AI Project Wizard
 * 3-step wizard: Input → AI Generate → Review & Approve
 */

import React, { useState } from 'react';
import { GENRES, TONES } from '../../utils/constants';
import { GENRE_TEMPLATES } from '../../utils/genreTemplates';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { buildPrompt } from '../../services/ai/promptBuilder';
import {
  Sparkles, ArrowRight, ArrowLeft, X, Loader2, Check,
  RotateCcw, Users, MapPin, BookOpen, List, AlertCircle,
  Trash2, Globe,
} from 'lucide-react';
import './ProjectWizard.css';

const STEPS = ['Ý tưởng', 'AI đang tạo...', 'Xem & Duyệt'];

export default function ProjectWizard({ onClose, onCreated }) {
  const { createProject, createChapter } = useProjectStore();
  const { createCharacter, createLocation, createWorldTerm } = useCodexStore();

  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState('');
  const [genre, setGenre] = useState('fantasy');
  const [tone, setTone] = useState('');
  const [useTemplate, setUseTemplate] = useState(true);

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

  // Step 1 → Step 2: Generate
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
  "characters": [{"name": "...", "role": "protagonist|antagonist|supporting|mentor|minor", "appearance": "...", "personality": "...", "goals": "..."}],
  "locations": [{"name": "...", "description": "..."}],
  "terms": [{"name": "...", "definition": "...", "category": "magic|organization|race|technology|other"}],
  "chapters": [{"title": "Chương 1: ...", "summary": "Tóm tắt nội dung chương"}]
}
Tạo world_profile chi tiết, 3-5 nhân vật, 3-5 địa điểm, 3-5 thuật ngữ, và 8-12 chương.
Chỉ trả về JSON, không thêm gì khác.`,
      },
      {
        role: 'user',
        content: `Thể loại: ${genreLabel}\nTone: ${tone || 'mặc định'}\n\nÝ tưởng: ${idea}${templateHint}`,
      },
    ];

    aiService.send({
      taskType: TASK_TYPES.PROJECT_WIZARD,
      messages,
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          // Clean markdown code blocks
          let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

          // Extract JSON by balanced braces
          const startIdx = cleaned.indexOf('{');
          if (startIdx === -1) throw new Error('No JSON');
          let depth = 0, endIdx = -1;
          for (let i = startIdx; i < cleaned.length; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
          }
          if (endIdx === -1) throw new Error('Incomplete JSON');

          const parsed = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
          setResult(parsed);
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

  // Step 3: Create everything
  const handleApprove = async () => {
    if (!result) return;
    setIsGenerating(true);

    try {
      // 1. Create project with world profile
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
        skipFirstChapter: true, // AI Wizard creates chapters itself
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
              personality: c.personality || '',
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

      // 5. Create terms
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

      onCreated(projectId);
    } catch (err) {
      console.error('[Wizard] Create error:', err);
      setError('Lỗi khi tạo dự án: ' + err.message);
      setIsGenerating(false);
    }
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
            <div key={i} className={`wizard-step ${i === step ? 'wizard-step--active' : ''} ${i < step ? 'wizard-step--done' : ''}`}>
              <span className="wizard-step-number">{i < step ? '✓' : i + 1}</span>
              <span className="wizard-step-label">{s}</span>
            </div>
          ))}
        </div>

        {/* Step 0: Input */}
        {step === 0 && (
          <div className="wizard-body">
            {error && (
              <div className="wizard-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Thể loại</label>
              <select className="select" value={genre} onChange={(e) => setGenre(e.target.value)}>
                {GENRES.map(g => (
                  <option key={g.value} value={g.value}>{g.emoji} {g.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Tone</label>
              <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="">Mặc định</option>
                {TONES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Ý tưởng truyện *</label>
              <textarea
                className="textarea"
                placeholder="Ví dụ: Thiếu niên mồ côi phát hiện mình có huyết mạch cổ thần, gia nhập tông môn nhỏ nhưng nhanh chóng vượt qua các thiên tài..."
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={4}
                autoFocus
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
              <button className="btn btn-primary" onClick={handleGenerate} disabled={!idea.trim()}>
                <Sparkles size={16} /> Tạo bằng AI <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Generating */}
        {step === 1 && (
          <div className="wizard-body wizard-loading">
            <Loader2 size={48} className="spin" />
            <h3>AI đang xây dựng thế giới truyện...</h3>
            <p>Premise, nhân vật, thế giới, và outline chương</p>
          </div>
        )}

        {/* Step 2: Review */}
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
                <h4><Globe size={16} /> Thế giới: {result.world_profile.world_name || 'Chưa đặt tên'}</h4>
                <div className="wizard-item">
                  <div className="wizard-item-content">
                    {result.world_profile.world_type && <span className="badge badge-sm">{result.world_profile.world_type}</span>}
                    {result.world_profile.world_scale && <span className="badge badge-sm">{result.world_profile.world_scale}</span>}
                    {result.world_profile.world_era && <span className="badge badge-sm">{result.world_profile.world_era}</span>}
                    {result.world_profile.world_rules?.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        {result.world_profile.world_rules.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                    {result.world_profile.world_description && <p>{result.world_profile.world_description}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Characters */}
            {result.characters?.length > 0 && (
              <div className="wizard-section">
                <h4><Users size={16} /> Nhân vật ({result.characters.filter((_, i) => !excluded.has(`char-${i}`)).length})</h4>
                <div className="wizard-items">
                  {result.characters.map((c, i) => (
                    <div key={i} className={`wizard-item ${excluded.has(`char-${i}`) ? 'wizard-item--excluded' : ''}`}>
                      <div className="wizard-item-content">
                        <strong>{c.name}</strong> <span className="badge badge-sm">{c.role}</span>
                        {c.personality && <p>{c.personality}</p>}
                      </div>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleExclude(`char-${i}`)}>
                        {excluded.has(`char-${i}`) ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Locations */}
            {result.locations?.length > 0 && (
              <div className="wizard-section">
                <h4><MapPin size={16} /> Địa điểm ({result.locations.filter((_, i) => !excluded.has(`loc-${i}`)).length})</h4>
                <div className="wizard-items">
                  {result.locations.map((l, i) => (
                    <div key={i} className={`wizard-item ${excluded.has(`loc-${i}`) ? 'wizard-item--excluded' : ''}`}>
                      <div className="wizard-item-content">
                        <strong>{l.name}</strong>
                        {l.description && <p>{l.description}</p>}
                      </div>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleExclude(`loc-${i}`)}>
                        {excluded.has(`loc-${i}`) ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Terms */}
            {result.terms?.length > 0 && (
              <div className="wizard-section">
                <h4><BookOpen size={16} /> Thuật ngữ ({result.terms.filter((_, i) => !excluded.has(`term-${i}`)).length})</h4>
                <div className="wizard-items">
                  {result.terms.map((t, i) => (
                    <div key={i} className={`wizard-item ${excluded.has(`term-${i}`) ? 'wizard-item--excluded' : ''}`}>
                      <div className="wizard-item-content">
                        <strong>{t.name}</strong>
                        {t.definition && <p>{t.definition}</p>}
                      </div>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleExclude(`term-${i}`)}>
                        {excluded.has(`term-${i}`) ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chapters */}
            {result.chapters?.length > 0 && (
              <div className="wizard-section">
                <h4><List size={16} /> Chapters ({result.chapters.filter((_, i) => !excluded.has(`chapter-${i}`)).length})</h4>
                <div className="wizard-items wizard-items--compact">
                  {result.chapters.map((ch, i) => (
                    <div key={i} className={`wizard-item ${excluded.has(`chapter-${i}`) ? 'wizard-item--excluded' : ''}`}>
                      <div className="wizard-item-content">
                        <strong>{ch.title}</strong>
                        {ch.summary && <p>{ch.summary}</p>}
                      </div>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggleExclude(`chapter-${i}`)}>
                        {excluded.has(`chapter-${i}`) ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setStep(0); setResult(null); setExcluded(new Set()); }}>
                <ArrowLeft size={16} /> Quay lại
              </button>
              <button className="btn btn-ghost" onClick={() => { setResult(null); setStep(0); }}>
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
