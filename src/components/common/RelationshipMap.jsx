/**
 * StoryForge — Relationship Map (Phase 4)
 * 
 * Visual relationship manager for characters.
 * Uses existing DB table: relationships (character_a_id, character_b_id, relation_type)
 */

import React, { useState, useEffect, useMemo } from 'react';
import useCodexStore from '../../stores/codexStore';
import useProjectStore from '../../stores/projectStore';
import db from '../../services/db/database';
import {
  Users, Plus, X, Save, Heart, Sword, Shield, UserCheck,
  Star, Link2, ArrowRight, Trash2, Edit2,
} from 'lucide-react';
import './RelationshipMap.css';

const RELATION_TYPES = [
  { value: 'ally', label: 'Đồng minh', icon: Shield, color: 'var(--color-info)' },
  { value: 'enemy', label: 'Kẻ thù', icon: Sword, color: 'var(--color-danger)' },
  { value: 'lover', label: 'Người yêu', icon: Heart, color: '#e91e63' },
  { value: 'family', label: 'Gia đình', icon: Users, color: 'var(--color-warning)' },
  { value: 'mentor', label: 'Sư phụ / Đồ đệ', icon: Star, color: 'var(--color-accent)' },
  { value: 'rival', label: 'Đối thủ', icon: Sword, color: '#ff9800' },
  { value: 'friend', label: 'Bạn bè', icon: UserCheck, color: 'var(--color-success)' },
  { value: 'subordinate', label: 'Cấp dưới / Cấp trên', icon: Users, color: 'var(--color-text-secondary)' },
  { value: 'other', label: 'Khác', icon: Link2, color: 'var(--color-text-muted)' },
];

export default function RelationshipMap({ onClose }) {
  const { currentProject } = useProjectStore();
  const { characters } = useCodexStore();
  const [relationships, setRelationships] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    character_a_id: '',
    character_b_id: '',
    relation_type: 'ally',
    description: '',
  });

  // Load relationships
  useEffect(() => {
    if (currentProject) loadRelationships();
  }, [currentProject?.id]);

  const loadRelationships = async () => {
    if (!currentProject) return;
    const rels = await db.relationships
      .where('project_id').equals(currentProject.id).toArray();
    setRelationships(rels);
  };

  const getCharName = (id) => characters.find(c => c.id === id)?.name || '???';
  const getRelType = (type) => RELATION_TYPES.find(r => r.value === type) || RELATION_TYPES[RELATION_TYPES.length - 1];

  const handleSave = async () => {
    if (!form.character_a_id || !form.character_b_id) return;
    if (form.character_a_id === form.character_b_id) return;

    if (editingId) {
      await db.relationships.update(editingId, {
        character_a_id: Number(form.character_a_id),
        character_b_id: Number(form.character_b_id),
        relation_type: form.relation_type,
        description: form.description,
      });
    } else {
      await db.relationships.add({
        project_id: currentProject.id,
        character_a_id: Number(form.character_a_id),
        character_b_id: Number(form.character_b_id),
        relation_type: form.relation_type,
        description: form.description,
      });
    }

    setForm({ character_a_id: '', character_b_id: '', relation_type: 'ally', description: '' });
    setShowForm(false);
    setEditingId(null);
    await loadRelationships();
  };

  const handleEdit = (rel) => {
    setForm({
      character_a_id: rel.character_a_id,
      character_b_id: rel.character_b_id,
      relation_type: rel.relation_type,
      description: rel.description || '',
    });
    setEditingId(rel.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    await db.relationships.delete(id);
    await loadRelationships();
  };

  // Group relationships by character
  const charRelMap = useMemo(() => {
    const map = {};
    characters.forEach(c => { map[c.id] = []; });
    relationships.forEach(r => {
      if (map[r.character_a_id]) map[r.character_a_id].push(r);
      if (map[r.character_b_id]) map[r.character_b_id].push(r);
    });
    return map;
  }, [characters, relationships]);

  return (
    <div className="codex-modal-overlay" onClick={onClose}>
      <div className="codex-modal codex-modal--lg" onClick={e => e.stopPropagation()}>
        <div className="codex-modal-header">
          <h3><Link2 size={18} /> Quan hệ nhân vật</h3>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className="btn btn-accent btn-sm"
              onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ character_a_id: '', character_b_id: '', relation_type: 'ally', description: '' }); }}
            >
              <Plus size={14} /> Thêm quan hệ
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="codex-modal-body">
          {/* Add/Edit Form */}
          {showForm && (
            <div className="rel-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Nhân vật A</label>
                  <select value={form.character_a_id} onChange={e => setForm({ ...form, character_a_id: e.target.value })}>
                    <option value="">— Chọn —</option>
                    {characters.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: '0', alignSelf: 'flex-end', padding: 'var(--space-2)' }}>
                  <ArrowRight size={16} />
                </div>
                <div className="form-group">
                  <label>Nhân vật B</label>
                  <select value={form.character_b_id} onChange={e => setForm({ ...form, character_b_id: e.target.value })}>
                    <option value="">— Chọn —</option>
                    {characters.filter(c => String(c.id) !== String(form.character_a_id)).map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Loại quan hệ</label>
                  <select value={form.relation_type} onChange={e => setForm({ ...form, relation_type: e.target.value })}>
                    {RELATION_TYPES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group form-group--wide">
                  <label>Mô tả (tuỳ chọn)</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Chi tiết về mối quan hệ..."
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setEditingId(null); }}>Huỷ</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>
                  <Save size={14} /> {editingId ? 'Cập nhật' : 'Thêm'}
                </button>
              </div>
            </div>
          )}

          {/* Relationship List */}
          {relationships.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <Link2 size={36} />
              <h3>Chưa có quan hệ</h3>
              <p>Bấm "Thêm quan hệ" để tạo mối liên kết giữa các nhân vật</p>
            </div>
          ) : (
            <div className="rel-list">
              {relationships.map(r => {
                const rt = getRelType(r.relation_type);
                const Icon = rt.icon;
                return (
                  <div key={r.id} className="rel-card">
                    <div className="rel-card-main">
                      <Icon size={16} style={{ color: rt.color, flexShrink: 0 }} />
                      <span className="rel-card-name">{getCharName(r.character_a_id)}</span>
                      <span className="rel-card-arrow" style={{ color: rt.color }}>⟷</span>
                      <span className="rel-card-name">{getCharName(r.character_b_id)}</span>
                      <span className="rel-card-type" style={{ color: rt.color }}>{rt.label}</span>
                    </div>
                    {r.description && (
                      <p className="rel-card-desc">{r.description}</p>
                    )}
                    <div className="rel-card-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(r)}>
                        <Edit2 size={12} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(r.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
