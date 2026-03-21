/**
 * StoryForge — World Lore (Phase 3)
 * 3 tabs: Locations, Objects, World Terms. Full CRUD.
 */

import React, { useState, useEffect } from 'react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import {
  Globe, MapPin, Package, BookOpen, Plus, Edit3, Trash2,
  X, Save, Search, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react';
import { WORLD_TERM_CATEGORIES } from '../../utils/constants';
import AIGenerateButton from '../../components/common/AIGenerateButton';
import BatchGenerate from '../../components/common/BatchGenerate';
import EntityTimeline from '../../components/common/EntityTimeline';
import './WorldLore.css';

const TABS = [
  { id: 'locations', icon: MapPin, label: 'Địa điểm' },
  { id: 'objects', icon: Package, label: 'Vật phẩm' },
  { id: 'terms', icon: BookOpen, label: 'Thuật ngữ' },
];

export default function WorldLore() {
  const { currentProject } = useProjectStore();
  const {
    locations, objects, worldTerms, characters, loading, loadCodex,
    createLocation, updateLocation, deleteLocation,
    createObject, updateObject, deleteObject,
    createWorldTerm, updateWorldTerm, deleteWorldTerm,
  } = useCodexStore();

  const [activeTab, setActiveTab] = useState('locations');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showBatchGen, setShowBatchGen] = useState(false);
  const [modalTab, setModalTab] = useState('info'); // 'info' | 'timeline'

  // Form state
  const [form, setForm] = useState({});
  const [worldExpanded, setWorldExpanded] = useState(true);
  const [editingWorld, setEditingWorld] = useState(false);
  const [worldForm, setWorldForm] = useState({});
  const { updateWorldProfile } = useProjectStore();

  useEffect(() => {
    if (currentProject) loadCodex(currentProject.id);
  }, [currentProject?.id]);

  // Get current data based on active tab
  const getData = () => {
    switch (activeTab) {
      case 'locations': return locations;
      case 'objects': return objects;
      case 'terms': return worldTerms;
      default: return [];
    }
  };

  const filtered = getData().filter(item =>
    !searchQuery || item.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get counts per tab
  const counts = {
    locations: locations.length,
    objects: objects.length,
    terms: worldTerms.length,
  };

  // --- CRUD ---
  const getEmptyForm = () => {
    switch (activeTab) {
      case 'locations': return { name: '', description: '', details: '', parent_location_id: null };
      case 'objects': return { name: '', description: '', owner_character_id: null, properties: '' };
      case 'terms': return { name: '', definition: '', category: 'other' };
      default: return {};
    }
  };

  const openCreate = () => {
    setEditingItem(null);
    setForm(getEmptyForm());
    setModalTab('info');
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditingItem(item);
    if (activeTab === 'locations') {
      setForm({ name: item.name || '', description: item.description || '', details: item.details || '', parent_location_id: item.parent_location_id || null });
    } else if (activeTab === 'objects') {
      setForm({ name: item.name || '', description: item.description || '', owner_character_id: item.owner_character_id || null, properties: item.properties || '' });
    } else {
      setForm({ name: item.name || '', definition: item.definition || '', category: item.category || 'other' });
    }
    setModalTab('info');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    const pid = currentProject.id;

    if (activeTab === 'locations') {
      if (editingItem) await updateLocation(editingItem.id, form);
      else await createLocation({ ...form, project_id: pid });
    } else if (activeTab === 'objects') {
      if (editingItem) await updateObject(editingItem.id, form);
      else await createObject({ ...form, project_id: pid });
    } else {
      if (editingItem) await updateWorldTerm(editingItem.id, form);
      else await createWorldTerm({ ...form, project_id: pid });
    }
    setShowModal(false);
  };

  const handleDelete = async (id) => {
    const pid = currentProject.id;
    if (activeTab === 'locations') await deleteLocation(id, pid);
    else if (activeTab === 'objects') await deleteObject(id, pid);
    else await deleteWorldTerm(id, pid);
    setDeleteConfirm(null);
  };

  if (!currentProject) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="empty-state">
          <Globe size={48} />
          <h3>Chọn một dự án trước</h3>
          <p>Quay về Dashboard để chọn hoặc tạo dự án.</p>
        </div>
      </div>
    );
  }

  const tabLabel = TABS.find(t => t.id === activeTab)?.label || '';

  // World Profile helpers
  const worldRules = (() => {
    try { return JSON.parse(currentProject.world_rules || '[]'); }
    catch { return []; }
  })();
  const hasWorldProfile = currentProject.world_name || currentProject.world_description;

  const openWorldEdit = () => {
    setWorldForm({
      world_name: currentProject.world_name || '',
      world_type: currentProject.world_type || '',
      world_scale: currentProject.world_scale || '',
      world_era: currentProject.world_era || '',
      world_rules: worldRules.join('\n'),
      world_description: currentProject.world_description || '',
    });
    setEditingWorld(true);
  };

  const saveWorldProfile = async () => {
    await updateWorldProfile({
      ...worldForm,
      world_rules: JSON.stringify(worldForm.world_rules.split('\n').filter(r => r.trim())),
    });
    setEditingWorld(false);
  };

  return (
    <div className="world-lore">
      {/* World Profile */}
      <div className="world-profile-section">
        <div className="world-profile-header" onClick={() => setWorldExpanded(!worldExpanded)}>
          <h3><Globe size={18} /> Thế giới tổng quan</h3>
          {worldExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {worldExpanded && (
          editingWorld ? (
            <div className="world-profile-edit">
              <div className="world-profile-grid">
                <div className="form-group">
                  <label className="form-label">Tên thế giới</label>
                  <input className="input" placeholder="Ví dụ: Cửu Châu Đại Lục" value={worldForm.world_name} onChange={e => setWorldForm(p => ({ ...p, world_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Loại thế giới</label>
                  <input className="input" placeholder="Tu tiên / Hiện đại / Sci-fi..." value={worldForm.world_type} onChange={e => setWorldForm(p => ({ ...p, world_type: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Quy mô</label>
                  <input className="input" placeholder="1 lục địa / Nhiều giới / 1 thành phố" value={worldForm.world_scale} onChange={e => setWorldForm(p => ({ ...p, world_scale: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Thời đại</label>
                  <input className="input" placeholder="Thượng cổ / Trung cổ / Hiện đại" value={worldForm.world_era} onChange={e => setWorldForm(p => ({ ...p, world_era: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Quy tắc cốt lõi (mỗi dòng 1 quy tắc)</label>
                <textarea className="textarea" rows={3} placeholder="Thế giới có linh khí\n9 cấp bậc tu luyện\nPháp bảo có đẳng cấp" value={worldForm.world_rules} onChange={e => setWorldForm(p => ({ ...p, world_rules: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Mô tả tổng quan</label>
                <textarea className="textarea" rows={3} placeholder="Mô tả ngắn về thế giới truyện..." value={worldForm.world_description} onChange={e => setWorldForm(p => ({ ...p, world_description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingWorld(false)}><X size={14} /> Huỷ</button>
                <button className="btn btn-primary btn-sm" onClick={saveWorldProfile}><Save size={14} /> Lưu</button>
              </div>
            </div>
          ) : hasWorldProfile ? (
            <div className="world-profile-card">
              <div className="world-profile-info">
                {currentProject.world_name && <h4>{currentProject.world_name}</h4>}
                <div className="world-profile-tags">
                  {currentProject.world_type && <span className="world-tag">{currentProject.world_type}</span>}
                  {currentProject.world_scale && <span className="world-tag">{currentProject.world_scale}</span>}
                  {currentProject.world_era && <span className="world-tag">{currentProject.world_era}</span>}
                </div>
                {worldRules.length > 0 && (
                  <ul className="world-rules-list">
                    {worldRules.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
                {currentProject.world_description && <p className="world-desc">{currentProject.world_description}</p>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={openWorldEdit}><Edit3 size={14} /> Sửa</button>
            </div>
          ) : (
            <div className="world-profile-empty">
              <p>Chưa thiết lập thế giới tổng quan</p>
              <button className="btn btn-primary btn-sm" onClick={openWorldEdit}>
                <Sparkles size={14} /> Thiết lập ngay
              </button>
            </div>
          )
        )}
      </div>

      {/* Header */}
      <div className="codex-header">
        <div className="codex-header-left">
          <h2><Globe size={22} /> Thế giới & Lore</h2>
        </div>

        <div className="codex-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`codex-tab ${activeTab === tab.id ? 'codex-tab--active' : ''}`}
              onClick={() => { setActiveTab(tab.id); setSearchQuery(''); }}
            >
              <tab.icon size={15} /> {tab.label}
              <span className="codex-tab-count">{counts[tab.id]}</span>
            </button>
          ))}
        </div>

        <div className="codex-header-actions">
          <button className="btn btn-accent btn-sm" onClick={() => setShowBatchGen(true)}>
            <Sparkles size={14} /> Tạo hàng loạt
          </button>
          <AIGenerateButton
            entityType={activeTab === 'locations' ? 'location' : activeTab === 'objects' ? 'object' : 'term'}
            projectContext={{ projectTitle: currentProject?.title, genre: currentProject?.genre_primary }}
            onApprove={(data) => {
              setEditingItem(null);
              if (activeTab === 'locations') {
                setForm({ name: data.name || '', description: data.description || '', details: data.details || '', parent_location_id: null });
              } else if (activeTab === 'objects') {
                setForm({ name: data.name || '', description: data.description || '', owner_character_id: null, properties: data.properties || '' });
              } else {
                setForm({ name: data.name || '', definition: data.definition || '', category: data.category || 'other' });
              }
              setShowModal(true);
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={15} /> Thêm thủ công
          </button>
        </div>
      </div>

      {/* Search */}
      {getData().length > 0 && (
        <div className="world-search">
          <Search size={15} />
          <input
            type="text"
            placeholder={`Tìm ${tabLabel.toLowerCase()}...`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          {React.createElement(TABS.find(t => t.id === activeTab)?.icon || Globe, { size: 48 })}
          <h3>Chưa có {tabLabel.toLowerCase()}</h3>
          <p>
            {activeTab === 'locations' && 'Thêm địa danh, vùng đất, tòa thành cho thế giới truyện.'}
            {activeTab === 'objects' && 'Thêm vật phẩm, vũ khí, bảo vật quan trọng trong truyện.'}
            {activeTab === 'terms' && 'Thêm thuật ngữ, phép thuật, tổ chức, khái niệm riêng.'}
          </p>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> Thêm {tabLabel.toLowerCase()}
          </button>
        </div>
      ) : (
        <div className="world-list">
          {filtered.map(item => (
            <div key={item.id} className="world-card" onClick={() => openEdit(item)}>
              <div className="world-card-icon">
                {React.createElement(TABS.find(t => t.id === activeTab)?.icon || Globe, { size: 18 })}
              </div>
              <div className="world-card-content">
                <h4 className="world-card-name">{item.name}</h4>
                {activeTab === 'locations' && item.description && (
                  <p className="world-card-desc">{item.description.substring(0, 120)}{item.description.length > 120 ? '...' : ''}</p>
                )}
                {activeTab === 'objects' && (
                  <p className="world-card-desc">
                    {item.owner_character_id ? `Chủ: ${characters.find(c => c.id === item.owner_character_id)?.name || '—'}` : ''}
                    {item.description && (item.owner_character_id ? ' — ' : '') + item.description.substring(0, 80)}
                  </p>
                )}
                {activeTab === 'terms' && (
                  <>
                    <span className="world-card-category">
                      {WORLD_TERM_CATEGORIES.find(c => c.value === item.category)?.label || item.category}
                    </span>
                    {item.definition && <p className="world-card-desc">{item.definition.substring(0, 120)}{item.definition.length > 120 ? '...' : ''}</p>}
                  </>
                )}
              </div>
              <div className="world-card-actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(item)} title="Sửa"><Edit3 size={14} /></button>
                {deleteConfirm === item.id ? (
                  <>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)}>Xoá</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>Huỷ</button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteConfirm(item.id)} title="Xoá"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="codex-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="codex-modal codex-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="codex-modal-header">
              <h3>{editingItem ? `Sửa ${tabLabel}` : `Thêm ${tabLabel} mới`}</h3>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>

            {editingItem && (
              <div className="codex-tabs" style={{ padding: '0 24px', borderBottom: '1px solid var(--color-border)' }}>
                <button
                  className={`codex-tab ${modalTab === 'info' ? 'codex-tab--active' : ''}`}
                  onClick={() => setModalTab('info')}
                >
                  Thông tin
                </button>
                <button
                  className={`codex-tab ${modalTab === 'timeline' ? 'codex-tab--active' : ''}`}
                  onClick={() => setModalTab('timeline')}
                >
                  Dòng thời gian
                </button>
              </div>
            )}

            <div className="codex-modal-body">
              {modalTab === 'info' ? (
                <>
                  <div className="form-group">
                    <label>Tên *</label>
                    <input
                      type="text"
                      value={form.name || ''}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder={
                        activeTab === 'locations' ? 'Ví dụ: Nguyệt Kinh' :
                          activeTab === 'objects' ? 'Ví dụ: Thanh kiếm Nguyệt Hồn' :
                            'Ví dụ: Linh khí'
                      }
                      autoFocus
                    />
                  </div>

                  {/* Location-specific fields */}
                  {activeTab === 'locations' && (
                    <>
                      <div className="form-group">
                        <label>Mô tả</label>
                        <textarea
                          value={form.description || ''}
                          onChange={e => setForm({ ...form, description: e.target.value })}
                          placeholder="Tòa thành cổ nằm trên đỉnh núi, bao quanh bởi sương mù..."
                          rows={3}
                        />
                      </div>
                      <div className="form-group">
                        <label>Chi tiết bổ sung</label>
                        <textarea
                          value={form.details || ''}
                          onChange={e => setForm({ ...form, details: e.target.value })}
                          placeholder="4 tháp canh, cổng chính hướng đông, có mật đạo dưới hầm..."
                          rows={3}
                        />
                      </div>
                    </>
                  )}

                  {/* Object-specific fields */}
                  {activeTab === 'objects' && (
                    <>
                      <div className="form-group">
                        <label>Chủ sở hữu</label>
                        <select
                          value={form.owner_character_id || ''}
                          onChange={e => setForm({ ...form, owner_character_id: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">— Không có chủ —</option>
                          {characters.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Mô tả</label>
                        <textarea
                          value={form.description || ''}
                          onChange={e => setForm({ ...form, description: e.target.value })}
                          placeholder="Thanh kiếm có lưỡi màu bạc, phát sáng trong bóng tối..."
                          rows={3}
                        />
                      </div>
                      <div className="form-group">
                        <label>Thuộc tính</label>
                        <textarea
                          value={form.properties || ''}
                          onChange={e => setForm({ ...form, properties: e.target.value })}
                          placeholder="Tăng sức mạnh x2, nhưng tiêu hao sinh lực người dùng..."
                          rows={2}
                        />
                      </div>
                    </>
                  )}

                  {/* Term-specific fields */}
                  {activeTab === 'terms' && (
                    <>
                      <div className="form-group">
                        <label>Phân loại</label>
                        <select
                          value={form.category || 'other'}
                          onChange={e => setForm({ ...form, category: e.target.value })}
                        >
                          {WORLD_TERM_CATEGORIES.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Định nghĩa</label>
                        <textarea
                          value={form.definition || ''}
                          onChange={e => setForm({ ...form, definition: e.target.value })}
                          placeholder="Năng lượng tự nhiên thẩm thấu khắp nơi, tu sĩ hấp thụ để tăng cảnh giới..."
                          rows={4}
                        />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <EntityTimeline
                  entityId={editingItem.id}
                  entityType={activeTab === 'locations' ? 'location' : activeTab === 'objects' ? 'object' : 'worldTerm'}
                />
              )}
            </div>

            <div className="codex-modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Huỷ</button>
              {modalTab === 'info' && (
                <button className="btn btn-primary" onClick={handleSave} disabled={!form.name?.trim()}>
                  <Save size={15} /> {editingItem ? 'Lưu' : 'Tạo'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch Generate Modal */}
      {showBatchGen && (
        <div className="codex-modal-overlay" onClick={() => setShowBatchGen(false)}>
          <div className="codex-modal codex-modal--lg" onClick={e => e.stopPropagation()}>
            <BatchGenerate
              entityType={activeTab === 'locations' ? 'location' : activeTab === 'objects' ? 'object' : 'term'}
              projectContext={{
                projectTitle: currentProject?.title,
                genre: currentProject?.genre_primary,
                description: currentProject?.description,
                worldName: currentProject?.world_name,
                worldType: currentProject?.world_type,
              }}
              existingEntities={{
                characters,
                locations,
                objects,
                terms: worldTerms,
                chapters: [],
              }}
              onBatchCreated={async (items) => {
                const pid = currentProject.id;
                for (const item of items) {
                  if (activeTab === 'locations') {
                    await createLocation({ project_id: pid, name: item.name, description: item.description || '', details: item.details || '' });
                  } else if (activeTab === 'objects') {
                    await createObject({ project_id: pid, name: item.name, description: item.description || '', properties: item.properties || '' });
                  } else {
                    await createWorldTerm({ project_id: pid, name: item.name, definition: item.definition || '', category: item.category || 'other' });
                  }
                }
                setShowBatchGen(false);
              }}
              onClose={() => setShowBatchGen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
