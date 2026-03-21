/**
 * StoryForge — Chapter Detail Modal (Phase 4)
 * 
 * Edit chapter details: purpose, summary, act, status.
 * Edit scene details: goal, conflict, POV character, location.
 * Scene Contract: must_happen, must_not_happen, pacing, emotional arc, characters_present.
 */

import React, { useState } from 'react';
import useProjectStore from '../../stores/projectStore';
import {
  X, Save, PenTool, Target, Zap, Users, MapPin, FileText,
  ChevronDown, ChevronRight, Heart, Clock, Shield,
} from 'lucide-react';
import { SCENE_STATUSES } from '../../utils/constants';

const ACTS = [
  { value: null, label: 'Chưa gán' },
  { value: 1, label: 'Hồi 1 — Thiết lập' },
  { value: 2, label: 'Hồi 2 — Xung đột' },
  { value: 3, label: 'Hồi 3 — Giải quyết' },
];

export default function ChapterDetailModal({
  chapter,
  scenes = [],
  characters = [],
  locations = [],
  onClose,
  onGoEditor,
}) {
  const { updateChapter, updateScene } = useProjectStore();

  // Chapter form
  const [chForm, setChForm] = useState({
    title: chapter.title || '',
    purpose: chapter.purpose || '',
    summary: chapter.summary || '',
    arc_id: chapter.arc_id || null,
    status: chapter.status || 'draft',
  });

  // Scene forms (array)
  const [sceneForms, setSceneForms] = useState(
    scenes.map(s => {
      let mustHappen = [];
      let mustNotHappen = [];
      let charsPresent = [];
      try { mustHappen = JSON.parse(s.must_happen || '[]'); } catch {}
      try { mustNotHappen = JSON.parse(s.must_not_happen || '[]'); } catch {}
      try { charsPresent = JSON.parse(s.characters_present || '[]'); } catch {}
      return {
        id: s.id,
        title: s.title || '',
        goal: s.goal || '',
        conflict: s.conflict || '',
        pov_character_id: s.pov_character_id || '',
        location_id: s.location_id || '',
        status: s.status || 'draft',
        // Scene Contract (Phase 4)
        emotional_start: s.emotional_start || '',
        emotional_end: s.emotional_end || '',
        must_happen: mustHappen,
        must_not_happen: mustNotHappen,
        pacing: s.pacing || '',
        characters_present: charsPresent,
        // UI state
        showContract: false,
        must_happen_input: '',
        must_not_happen_input: '',
      };
    })
  );

  const [expandedScene, setExpandedScene] = useState(scenes[0]?.id || null);
  const [saving, setSaving] = useState(false);

  const updateSceneForm = (sceneId, field, value) => {
    setSceneForms(prev => prev.map(sf =>
      sf.id === sceneId ? { ...sf, [field]: value } : sf
    ));
  };

  const handleSave = async () => {
    setSaving(true);

    // Save chapter
    await updateChapter(chapter.id, {
      title: chForm.title.trim() || chapter.title,
      purpose: chForm.purpose,
      summary: chForm.summary,
      arc_id: chForm.arc_id,
      status: chForm.status,
    });

    // Save scenes
    for (const sf of sceneForms) {
      await updateScene(sf.id, {
        title: sf.title.trim() || undefined,
        goal: sf.goal,
        conflict: sf.conflict,
        pov_character_id: sf.pov_character_id || null,
        location_id: sf.location_id || null,
        status: sf.status,
        // Scene Contract (Phase 4)
        emotional_start: sf.emotional_start,
        emotional_end: sf.emotional_end,
        must_happen: JSON.stringify(sf.must_happen || []),
        must_not_happen: JSON.stringify(sf.must_not_happen || []),
        pacing: sf.pacing,
        characters_present: JSON.stringify(sf.characters_present || []),
      });
    }

    setSaving(false);
    onClose();
  };

  return (
    <div className="codex-modal-overlay" onClick={onClose}>
      <div className="codex-modal codex-modal--lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="codex-modal-header">
          <h3>📋 {chForm.title}</h3>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-ghost btn-sm" onClick={onGoEditor}>
              <PenTool size={14} /> Mở Editor
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="codex-modal-body">
          {/* Chapter Info */}
          <div className="chapter-detail-section">
            <div className="form-row">
              <div className="form-group form-group--wide">
                <label>Tên chương</label>
                <input
                  type="text"
                  value={chForm.title}
                  onChange={e => setChForm({ ...chForm, title: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Hồi (Act)</label>
                <select
                  value={chForm.arc_id || ''}
                  onChange={e => setChForm({ ...chForm, arc_id: e.target.value ? Number(e.target.value) : null })}
                >
                  {ACTS.map(a => (
                    <option key={a.label} value={a.value || ''}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label><Target size={13} /> Mục tiêu chương</label>
                <textarea
                  value={chForm.purpose}
                  onChange={e => setChForm({ ...chForm, purpose: e.target.value })}
                  placeholder="Chương này phục vụ cốt truyện bằng cách nào?"
                  rows={2}
                />
              </div>
              <div className="form-group">
                <label>Trạng thái</label>
                <select value={chForm.status} onChange={e => setChForm({ ...chForm, status: e.target.value })}>
                  {SCENE_STATUSES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Tóm tắt nội dung</label>
              <textarea
                value={chForm.summary}
                onChange={e => setChForm({ ...chForm, summary: e.target.value })}
                placeholder="Tóm tắt những gì xảy ra trong chương này..."
                rows={3}
              />
            </div>
          </div>

          {/* Scenes */}
          <div className="chapter-detail-scenes">
            <h4><FileText size={15} /> Cảnh ({sceneForms.length})</h4>

            {sceneForms.map((sf, idx) => (
              <div key={sf.id} className="scene-detail-card">
                <div
                  className="scene-detail-header"
                  onClick={() => setExpandedScene(expandedScene === sf.id ? null : sf.id)}
                >
                  {expandedScene === sf.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="scene-detail-title">{sf.title || `Cảnh ${idx + 1}`}</span>
                  {sf.goal && <span className="scene-detail-has-goal">🎯</span>}
                </div>

                {expandedScene === sf.id && (
                  <div className="scene-detail-body">
                    <div className="form-group">
                      <label>Tên cảnh</label>
                      <input
                        type="text"
                        value={sf.title}
                        onChange={e => updateSceneForm(sf.id, 'title', e.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label><Target size={12} /> Mục tiêu cảnh</label>
                        <textarea
                          value={sf.goal}
                          onChange={e => updateSceneForm(sf.id, 'goal', e.target.value)}
                          placeholder="Mục tiêu: đạt được gì trong cảnh này?"
                          rows={2}
                        />
                      </div>
                      <div className="form-group">
                        <label><Zap size={12} /> Xung đột</label>
                        <textarea
                          value={sf.conflict}
                          onChange={e => updateSceneForm(sf.id, 'conflict', e.target.value)}
                          placeholder="Xung đột chính trong cảnh"
                          rows={2}
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label><Users size={12} /> Nhân vật POV</label>
                        <select
                          value={sf.pov_character_id || ''}
                          onChange={e => updateSceneForm(sf.id, 'pov_character_id', e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">— Không chọn —</option>
                          {characters.map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label><MapPin size={12} /> Địa điểm</label>
                        <select
                          value={sf.location_id || ''}
                          onChange={e => updateSceneForm(sf.id, 'location_id', e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">— Không chọn —</option>
                          {locations.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Scene Contract (Phase 4) — Collapsible */}
                    <div className="scene-contract-section">
                      <button
                        type="button"
                        className="scene-contract-toggle"
                        onClick={() => updateSceneForm(sf.id, 'showContract', !sf.showContract)}
                      >
                        {sf.showContract ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Shield size={12} />
                        <span>📜 Hợp đồng cảnh</span>
                        {(sf.must_happen?.length > 0 || sf.must_not_happen?.length > 0 || sf.pacing) && (
                          <span className="scene-contract-badge">●</span>
                        )}
                      </button>

                      {sf.showContract && (
                        <div className="scene-contract-body">
                          {/* Emotional Arc */}
                          <div className="form-row">
                            <div className="form-group">
                              <label><Heart size={12} /> Cảm xúc đầu cảnh</label>
                              <input
                                type="text"
                                value={sf.emotional_start}
                                onChange={e => updateSceneForm(sf.id, 'emotional_start', e.target.value)}
                                placeholder="VD: Lo lắng, Tò mò..."
                              />
                            </div>
                            <div className="form-group">
                              <label><Heart size={12} /> Cảm xúc cuối cảnh</label>
                              <input
                                type="text"
                                value={sf.emotional_end}
                                onChange={e => updateSceneForm(sf.id, 'emotional_end', e.target.value)}
                                placeholder="VD: Sốc, Quyết tâm..."
                              />
                            </div>
                          </div>

                          {/* Pacing */}
                          <div className="form-group">
                            <label><Clock size={12} /> Nhịp cảnh</label>
                            <select
                              value={sf.pacing}
                              onChange={e => updateSceneForm(sf.id, 'pacing', e.target.value)}
                            >
                              <option value="">— Tự do —</option>
                              <option value="slow">🐢 Chậm — miêu tả chi tiết</option>
                              <option value="medium">⚖️ Trung bình</option>
                              <option value="fast">⚡ Nhanh — hành động liên tục</option>
                            </select>
                          </div>

                          {/* Must Happen */}
                          <div className="form-group">
                            <label>✅ Bắt buộc xảy ra</label>
                            <div className="tag-list">
                              {(sf.must_happen || []).map((item, i) => (
                                <span key={i} className="tag tag--success">
                                  {item}
                                  <button type="button" onClick={() => {
                                    const next = [...sf.must_happen];
                                    next.splice(i, 1);
                                    updateSceneForm(sf.id, 'must_happen', next);
                                  }}>×</button>
                                </span>
                              ))}
                            </div>
                            <div className="tag-input-row">
                              <input
                                type="text"
                                value={sf.must_happen_input || ''}
                                onChange={e => updateSceneForm(sf.id, 'must_happen_input', e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && sf.must_happen_input?.trim()) {
                                    e.preventDefault();
                                    updateSceneForm(sf.id, 'must_happen', [...(sf.must_happen || []), sf.must_happen_input.trim()]);
                                    updateSceneForm(sf.id, 'must_happen_input', '');
                                  }
                                }}
                                placeholder="Nhập rồi nhấn Enter..."
                              />
                            </div>
                          </div>

                          {/* Must NOT Happen */}
                          <div className="form-group">
                            <label>⛔ Cấm xảy ra</label>
                            <div className="tag-list">
                              {(sf.must_not_happen || []).map((item, i) => (
                                <span key={i} className="tag tag--danger">
                                  {item}
                                  <button type="button" onClick={() => {
                                    const next = [...sf.must_not_happen];
                                    next.splice(i, 1);
                                    updateSceneForm(sf.id, 'must_not_happen', next);
                                  }}>×</button>
                                </span>
                              ))}
                            </div>
                            <div className="tag-input-row">
                              <input
                                type="text"
                                value={sf.must_not_happen_input || ''}
                                onChange={e => updateSceneForm(sf.id, 'must_not_happen_input', e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && sf.must_not_happen_input?.trim()) {
                                    e.preventDefault();
                                    updateSceneForm(sf.id, 'must_not_happen', [...(sf.must_not_happen || []), sf.must_not_happen_input.trim()]);
                                    updateSceneForm(sf.id, 'must_not_happen_input', '');
                                  }
                                }}
                                placeholder="Nhập rồi nhấn Enter..."
                              />
                            </div>
                          </div>

                          {/* Characters Present */}
                          <div className="form-group">
                            <label><Users size={12} /> Nhân vật có mặt</label>
                            <div className="tag-list">
                              {(sf.characters_present || []).map((charId, i) => {
                                const ch = characters.find(c => c.id === charId);
                                return ch ? (
                                  <span key={i} className="tag tag--info">
                                    {ch.name}
                                    <button type="button" onClick={() => {
                                      const next = sf.characters_present.filter(id => id !== charId);
                                      updateSceneForm(sf.id, 'characters_present', next);
                                    }}>×</button>
                                  </span>
                                ) : null;
                              })}
                            </div>
                            <select
                              value=""
                              onChange={e => {
                                const id = Number(e.target.value);
                                if (id && !(sf.characters_present || []).includes(id)) {
                                  updateSceneForm(sf.id, 'characters_present', [...(sf.characters_present || []), id]);
                                }
                              }}
                            >
                              <option value="">+ Thêm nhân vật...</option>
                              {characters.filter(c => !(sf.characters_present || []).includes(c.id)).map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="codex-modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={15} /> {saving ? 'Đang lưu...' : 'Lưu tất cả'}
          </button>
        </div>
      </div>
    </div>
  );
}
