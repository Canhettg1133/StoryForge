/**
 * StoryForge — Character Hub (Phase 3)
 * Full CRUD for characters with genre-aware pronoun presets.
 */

import React, { useState, useEffect } from 'react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import {
  Users, Plus, Edit3, Trash2, X, Save, Shield, Heart,
  Sword, Star, UserCheck, ChevronDown, AlertTriangle, Sparkles, Link2,
} from 'lucide-react';
import {
  CHARACTER_ROLES, PRONOUN_PRESETS, GENRE_PRONOUN_MAP,
} from '../../utils/constants';
import AIGenerateButton from '../../components/common/AIGenerateButton';
import BatchGenerate from '../../components/common/BatchGenerate';
import RelationshipMap from '../../components/common/RelationshipMap';
import './CharacterHub.css';

const EMPTY_CHARACTER = {
  name: '',
  role: 'supporting',
  appearance: '',
  personality: '',
  pronouns_self: '',
  pronouns_other: '',
  goals: '',
  secrets: '',
  notes: '',
  personality_tags: '',
  current_status: '',
};

const ROLE_ICONS = {
  protagonist: Star,
  deuteragonist: UserCheck,
  antagonist: Sword,
  supporting: Users,
  mentor: Shield,
  love_interest: Heart,
  minor: Users,
};

export default function CharacterHub() {
  const { currentProject, chapters } = useProjectStore();
  const {
    characters, taboos, loading, loadCodex,
    createCharacter, updateCharacter, deleteCharacter,
    createTaboo, updateTaboo, deleteTaboo,
  } = useCodexStore();

  const [showModal, setShowModal] = useState(false);
  const [editingChar, setEditingChar] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_CHARACTER });
  const [activeTab, setActiveTab] = useState('characters'); // 'characters' | 'taboos'
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showBatchGen, setShowBatchGen] = useState(false);
  const [showRelMap, setShowRelMap] = useState(false);

  // Taboo form
  const [showTabooModal, setShowTabooModal] = useState(false);
  const [editingTaboo, setEditingTaboo] = useState(null);
  const [tabooForm, setTabooForm] = useState({
    character_id: '',
    description: '',
    effective_before_chapter: 10,
  });

  useEffect(() => {
    if (currentProject) loadCodex(currentProject.id);
  }, [currentProject?.id]);

  // Genre preset
  const genreKey = GENRE_PRONOUN_MAP[currentProject?.genre_primary] || 'modern';
  const preset = PRONOUN_PRESETS[genreKey] || PRONOUN_PRESETS.modern;

  // --- Character Handlers ---
  const openCreate = () => {
    setEditingChar(null);
    setForm({
      ...EMPTY_CHARACTER,
      pronouns_self: preset.default_self,
      pronouns_other: preset.default_other,
    });
    setShowModal(true);
  };

  const openEdit = (char) => {
    setEditingChar(char);
    setForm({
      name: char.name || '',
      role: char.role || 'supporting',
      appearance: char.appearance || '',
      personality: char.personality || '',
      pronouns_self: char.pronouns_self || '',
      pronouns_other: char.pronouns_other || '',
      goals: char.goals || '',
      secrets: char.secrets || '',
      notes: char.notes || '',
      personality_tags: char.personality_tags || '',
      current_status: char.current_status || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingChar) {
      await updateCharacter(editingChar.id, form);
    } else {
      await createCharacter({ ...form, project_id: currentProject.id });
    }
    setShowModal(false);
  };

  const handleDelete = async (id) => {
    await deleteCharacter(id, currentProject.id);
    setDeleteConfirm(null);
  };

  // --- Taboo Handlers ---
  const openCreateTaboo = () => {
    setEditingTaboo(null);
    setTabooForm({ character_id: characters[0]?.id || '', description: '', effective_before_chapter: 10 });
    setShowTabooModal(true);
  };

  const openEditTaboo = (taboo) => {
    setEditingTaboo(taboo);
    setTabooForm({
      character_id: taboo.character_id || '',
      description: taboo.description || '',
      effective_before_chapter: taboo.effective_before_chapter || 10,
    });
    setShowTabooModal(true);
  };

  const handleSaveTaboo = async () => {
    if (!tabooForm.description.trim()) return;
    if (editingTaboo) {
      await updateTaboo(editingTaboo.id, tabooForm);
    } else {
      await createTaboo({ ...tabooForm, project_id: currentProject.id });
    }
    setShowTabooModal(false);
  };

  const handleDeleteTaboo = async (id) => {
    await deleteTaboo(id, currentProject.id);
  };

  if (!currentProject) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="empty-state">
          <Users size={48} />
          <h3>Chọn một dự án trước</h3>
          <p>Quay về Dashboard để chọn hoặc tạo dự án.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="character-hub">
      {/* Header */}
      <div className="codex-header">
        <div className="codex-header-left">
          <h2><Users size={22} /> Nhân vật & Cấm kỵ</h2>
          <span className="codex-count">{characters.length} nhân vật</span>
        </div>

        <div className="codex-tabs">
          <button
            className={`codex-tab ${activeTab === 'characters' ? 'codex-tab--active' : ''}`}
            onClick={() => setActiveTab('characters')}
          >
            <Users size={15} /> Nhân vật
          </button>
          <button
            className={`codex-tab ${activeTab === 'taboos' ? 'codex-tab--active' : ''}`}
            onClick={() => setActiveTab('taboos')}
          >
            <AlertTriangle size={15} /> Cấm kỵ <span className="codex-tab-badge">{taboos.length}</span>
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowRelMap(true)}
            style={{ marginLeft: 'auto' }}
          >
            <Link2 size={15} /> Quan hệ
          </button>
        </div>

        <div className="codex-header-actions">
          {activeTab === 'characters' && (
            <>
              <button className="btn btn-accent btn-sm" onClick={() => setShowBatchGen(true)}>
                <Sparkles size={14} /> Tạo hàng loạt
              </button>
              <AIGenerateButton
                entityType="character"
                projectContext={{ projectTitle: currentProject?.title, genre: currentProject?.genre_primary }}
                onApprove={(data) => {
                  setEditingChar(null);
                  setForm({
                    name: data.name || '',
                    role: data.role || 'supporting',
                    appearance: data.appearance || '',
                    personality: data.personality || '',
                    pronouns_self: data.pronouns_self || preset.default_self,
                    pronouns_other: data.pronouns_other || preset.default_other,
                    goals: data.goals || '',
                    secrets: data.secrets || '',
                    notes: data.notes || '',
                    personality_tags: data.personality_tags || '',
                    current_status: data.current_status || '',
                  });
                  setShowModal(true);
                }}
              />
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={activeTab === 'characters' ? openCreate : openCreateTaboo}>
            <Plus size={15} /> {activeTab === 'characters' ? 'Thêm thủ công' : 'Thêm cấm kỵ'}
          </button>
        </div>
      </div>

      {/* Characters Tab */}
      {activeTab === 'characters' && (
        <>
          {characters.length === 0 ? (
            <div className="empty-state">
              <Users size={48} />
              <h3>Chưa có nhân vật</h3>
              <p>Thêm nhân vật đầu tiên cho truyện của bạn.</p>
              <button className="btn btn-primary" onClick={openCreate}>
                <Plus size={16} /> Thêm nhân vật
              </button>
            </div>
          ) : (
            <div className="character-grid">
              {characters.map(char => {
                const RoleIcon = ROLE_ICONS[char.role] || Users;
                const roleLabel = CHARACTER_ROLES.find(r => r.value === char.role)?.label || char.role;
                return (
                  <div key={char.id} className="character-card" onClick={() => openEdit(char)}>
                    <div className="character-card-header">
                      <div className="character-avatar">
                        <RoleIcon size={20} />
                      </div>
                      <div className="character-card-info">
                        <h4 className="character-name">{char.name}</h4>
                        <span className="character-role">{roleLabel}</span>
                      </div>
                      <div className="character-card-actions" onClick={e => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(char)} title="Sửa">
                          <Edit3 size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setDeleteConfirm(char.id)}
                          title="Xoá"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {char.pronouns_self && (
                      <div className="character-pronoun">
                        Xưng: <strong>{char.pronouns_self}</strong>
                        {char.pronouns_other && <> — Gọi người: <strong>{char.pronouns_other}</strong></>}
                      </div>
                    )}

                    {char.personality_tags && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '4px 0' }}>
                        {char.personality_tags.split(',').map(t => t.trim()).filter(Boolean).map((t, idx) => (
                          <span key={idx} style={{ background: 'var(--color-surface-2)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--color-accent)' }}>
                            {t.startsWith('#') ? t : `#${t}`}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {char.current_status && (
                      <p className="character-snippet" style={{ color: 'var(--color-warning)', fontWeight: 500 }}>
                        <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }}/>
                        Trạng thái: {char.current_status}
                      </p>
                    )}

                    {char.personality && (
                      <p className="character-snippet">{char.personality.substring(0, 100)}{char.personality.length > 100 ? '...' : ''}</p>
                    )}

                    {/* Delete confirm */}
                    {deleteConfirm === char.id && (
                      <div className="character-delete-confirm">
                        <span>Xoá nhân vật này?</span>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(char.id)}>Xoá</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>Huỷ</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Taboos Tab */}
      {activeTab === 'taboos' && (
        <>
          {taboos.length === 0 ? (
            <div className="empty-state">
              <AlertTriangle size={48} />
              <h3>Chưa có cấm kỵ</h3>
              <p>Đặt ràng buộc "nhân vật X không được biết Y trước chương Z".</p>
              <button className="btn btn-primary" onClick={openCreateTaboo}>
                <Plus size={16} /> Thêm cấm kỵ
              </button>
            </div>
          ) : (
            <div className="taboo-list">
              {taboos.map(taboo => {
                const charName = characters.find(c => c.id === taboo.character_id)?.name || '—';
                return (
                  <div key={taboo.id} className="taboo-card">
                    <div className="taboo-card-content">
                      <div className="taboo-char-badge">{charName}</div>
                      <p className="taboo-desc">{taboo.description}</p>
                      <span className="taboo-chapter">Trước chương {taboo.effective_before_chapter}</span>
                    </div>
                    <div className="taboo-card-actions">
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEditTaboo(taboo)}><Edit3 size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDeleteTaboo(taboo.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Character Modal */}
      {showModal && (
        <div className="codex-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="codex-modal" onClick={e => e.stopPropagation()}>
            <div className="codex-modal-header">
              <h3>{editingChar ? 'Sửa nhân vật' : 'Thêm nhân vật mới'}</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="codex-modal-body">
              <div className="form-row">
                <div className="form-group form-group--wide">
                  <label>Tên nhân vật *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Ví dụ: Lý Minh"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Vai trò</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                    {CHARACTER_ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pronouns */}
              <div className="form-row">
                <div className="form-group">
                  <label>Cách xưng hô (tự xưng)</label>
                  <div className="pronoun-input-group">
                    <input
                      type="text"
                      value={form.pronouns_self}
                      onChange={e => setForm({ ...form, pronouns_self: e.target.value })}
                      placeholder={preset.default_self}
                    />
                    <div className="pronoun-presets">
                      {preset.options.slice(0, 6).map(p => (
                        <button
                          key={p} type="button"
                          className={`pronoun-chip ${form.pronouns_self === p ? 'pronoun-chip--active' : ''}`}
                          onClick={() => setForm({ ...form, pronouns_self: p })}
                        >{p}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <label>Cách gọi người khác</label>
                  <div className="pronoun-input-group">
                    <input
                      type="text"
                      value={form.pronouns_other}
                      onChange={e => setForm({ ...form, pronouns_other: e.target.value })}
                      placeholder={preset.default_other}
                    />
                    <div className="pronoun-presets">
                      {preset.options.slice(0, 6).map(p => (
                        <button
                          key={p} type="button"
                          className={`pronoun-chip ${form.pronouns_other === p ? 'pronoun-chip--active' : ''}`}
                          onClick={() => setForm({ ...form, pronouns_other: p })}
                        >{p}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="pronoun-genre-hint">
                Preset: <strong>{preset.label}</strong> (theo thể loại truyện)
              </div>

              <div className="form-group">
                <label>Ngoại hình</label>
                <textarea
                  value={form.appearance}
                  onChange={e => setForm({ ...form, appearance: e.target.value })}
                  placeholder="Cao, tóc dài, mặc áo xanh đậm, vết sẹo trên mặt trái..."
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Tính cách</label>
                <textarea
                  value={form.personality}
                  onChange={e => setForm({ ...form, personality: e.target.value })}
                  placeholder="Trầm tĩnh, lạnh lùng bên ngoài nhưng bảo vệ người thân..."
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Tags Tâm lý / Nét đặc trưng</label>
                <input
                  type="text"
                  value={form.personality_tags}
                  onChange={e => setForm({ ...form, personality_tags: e.target.value })}
                  placeholder="Ví dụ: #Kiên_nhẫn, #Quyết_đoán, #Thâm_trầm"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mục tiêu</label>
                  <textarea
                    value={form.goals}
                    onChange={e => setForm({ ...form, goals: e.target.value })}
                    placeholder="Tìm lại sư phụ, khôi phục môn phái..."
                    rows={2}
                  />
                </div>
                <div className="form-group">
                  <label>Trạng thái hiện tại (bối cảnh cho AI)</label>
                  <textarea
                    value={form.current_status}
                    onChange={e => setForm({ ...form, current_status: e.target.value })}
                    placeholder="Ví dụ: Đang bị thương nặng ở tay trái, mất trí nhớ tạm thời..."
                    rows={2}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Bí mật</label>
                <textarea
                  value={form.secrets}
                  onChange={e => setForm({ ...form, secrets: e.target.value })}
                  placeholder="Thực ra là con trai bị thất lạc của..."
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Ghi chú</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Ghi chú riêng..."
                  rows={2}
                />
              </div>
            </div>

            <div className="codex-modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Huỷ</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim()}>
                <Save size={15} /> {editingChar ? 'Lưu' : 'Tạo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Taboo Modal */}
      {showTabooModal && (
        <div className="codex-modal-overlay" onClick={() => setShowTabooModal(false)}>
          <div className="codex-modal codex-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="codex-modal-header">
              <h3>{editingTaboo ? 'Sửa cấm kỵ' : 'Thêm cấm kỵ mới'}</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowTabooModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="codex-modal-body">
              <div className="form-group">
                <label>Nhân vật liên quan</label>
                <select
                  value={tabooForm.character_id}
                  onChange={e => setTabooForm({ ...tabooForm, character_id: Number(e.target.value) })}
                >
                  <option value="">— Chung (không gắn nhân vật) —</option>
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Mô tả cấm kỵ *</label>
                <textarea
                  value={tabooForm.description}
                  onChange={e => setTabooForm({ ...tabooForm, description: e.target.value })}
                  placeholder='Ví dụ: "Minh không được biết cha mình còn sống"'
                  rows={3}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Có hiệu lực trước chương số</label>
                <input
                  type="number"
                  min={1}
                  value={tabooForm.effective_before_chapter}
                  onChange={e => setTabooForm({ ...tabooForm, effective_before_chapter: Number(e.target.value) })}
                />
                <span className="form-hint">AI sẽ tuyệt đối tuân thủ cấm kỵ này khi viết các chương trước số này.</span>
              </div>
            </div>
            <div className="codex-modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowTabooModal(false)}>Huỷ</button>
              <button className="btn btn-primary" onClick={handleSaveTaboo} disabled={!tabooForm.description.trim()}>
                <Save size={15} /> {editingTaboo ? 'Lưu' : 'Tạo'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Batch Generate Modal */}
      {showBatchGen && (
        <div className="codex-modal-overlay" onClick={() => setShowBatchGen(false)}>
          <div className="codex-modal codex-modal--lg" onClick={e => e.stopPropagation()}>
            <BatchGenerate
              entityType="character"
              projectContext={{
                projectTitle: currentProject?.title,
                genre: currentProject?.genre_primary,
                description: currentProject?.description,
                worldName: currentProject?.world_name,
                worldType: currentProject?.world_type,
              }}
              existingEntities={{
                characters,
                locations: [],
                objects: [],
                terms: [],
                chapters,
              }}
              onBatchCreated={async (items) => {
                const pid = currentProject.id;
                for (const item of items) {
                  await createCharacter({
                    project_id: pid,
                    name: item.name,
                    role: item.role || 'supporting',
                    appearance: item.appearance || '',
                    personality: item.personality || '',
                    goals: item.goals || '',
                    notes: item.notes || '',
                  });
                }
                setShowBatchGen(false);
              }}
              onClose={() => setShowBatchGen(false)}
            />
          </div>
        </div>
      )}

      {/* Relationship Map Modal */}
      {showRelMap && (
        <RelationshipMap onClose={() => setShowRelMap(false)} />
      )}
    </div>
  );
}
