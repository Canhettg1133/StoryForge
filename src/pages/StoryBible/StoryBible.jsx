/**
 * StoryForge — Story Bible (Auto Wiki)
 * Aggregates all codex data into a read-only wiki view.
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import ProjectSettingsPanel from '../../components/common/ProjectSettingsPanel';
import {
  BookOpen, Users, MapPin, Package, BookMarked, Shield,
  Star, Sword, UserCheck, Heart, ChevronRight,
} from 'lucide-react';
import { CHARACTER_ROLES, WORLD_TERM_CATEGORIES } from '../../utils/constants';
import './StoryBible.css';

const ROLE_ICONS = {
  protagonist: Star,
  deuteragonist: UserCheck,
  antagonist: Sword,
  supporting: Users,
  mentor: Shield,
  love_interest: Heart,
  minor: Users,
};

export default function StoryBible() {
  const navigate = useNavigate();
  const { currentProject, chapters } = useProjectStore();
  const {
    characters, locations, objects, worldTerms, taboos,
    chapterMetas, loading, loadCodex,
  } = useCodexStore();

  useEffect(() => {
    if (currentProject) loadCodex(currentProject.id);
  }, [currentProject?.id]);

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

  return (
    <div className="story-bible">
      {/* Header */}
      <div className="bible-header">
        <div>
          <h2><BookMarked size={22} /> Story Bible</h2>
          <p className="bible-subtitle">Tổng hợp toàn bộ thế giới truyện — {totalItems} mục</p>
        </div>
      </div>

      {/* Project overview */}
      <div className="bible-section">
        <h3 className="bible-section-title">📖 Tổng quan</h3>
        <div className="bible-overview-card">
          <h4>{currentProject.title}</h4>
          {currentProject.description && <p>{currentProject.description}</p>}
          <div className="bible-stats">
            <span>{chapters.length} chương</span>
            <span>{characters.length} nhân vật</span>
            <span>{locations.length} địa điểm</span>
            <span>{objects.length} vật phẩm</span>
            <span>{worldTerms.length} thuật ngữ</span>
          </div>
        </div>
      </div>

      {/* AI Settings (Phase 4) */}
      <ProjectSettingsPanel />

      {/* Characters */}
      {characters.length > 0 && (
        <div className="bible-section">
          <div className="bible-section-header">
            <h3 className="bible-section-title"><Users size={18} /> Nhân vật ({characters.length})</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/characters')}>
              Quản lý <ChevronRight size={14} />
            </button>
          </div>
          <div className="bible-grid">
            {characters.map(c => {
              const RoleIcon = ROLE_ICONS[c.role] || Users;
              const roleLabel = CHARACTER_ROLES.find(r => r.value === c.role)?.label || c.role;
              return (
                <div key={c.id} className="bible-card">
                  <div className="bible-card-header">
                    <RoleIcon size={16} className="bible-card-icon" />
                    <strong>{c.name}</strong>
                    <span className="badge badge-sm">{roleLabel}</span>
                  </div>
                  {c.appearance && <p><b>Ngoại hình:</b> {c.appearance}</p>}
                  {c.personality && <p><b>Tính cách:</b> {c.personality}</p>}
                  {c.goals && <p><b>Mục tiêu:</b> {c.goals}</p>}
                  {c.pronouns_self && (
                    <p className="bible-card-pronoun">Xưng: "{c.pronouns_self}"{c.pronouns_other ? ` / "${c.pronouns_other}"` : ''}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Locations */}
      {locations.length > 0 && (
        <div className="bible-section">
          <div className="bible-section-header">
            <h3 className="bible-section-title"><MapPin size={18} /> Địa điểm ({locations.length})</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/world')}>
              Quản lý <ChevronRight size={14} />
            </button>
          </div>
          <div className="bible-grid">
            {locations.map(l => (
              <div key={l.id} className="bible-card">
                <strong>{l.name}</strong>
                {l.description && <p>{l.description}</p>}
                {l.details && <p className="bible-card-details">{l.details}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Objects */}
      {objects.length > 0 && (
        <div className="bible-section">
          <div className="bible-section-header">
            <h3 className="bible-section-title"><Package size={18} /> Vật phẩm ({objects.length})</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/world')}>
              Quản lý <ChevronRight size={14} />
            </button>
          </div>
          <div className="bible-grid">
            {objects.map(o => {
              const owner = characters.find(c => c.id === o.owner_character_id);
              return (
                <div key={o.id} className="bible-card">
                  <strong>{o.name}</strong>
                  {owner && <span className="bible-card-owner">Chủ: {owner.name}</span>}
                  {o.description && <p>{o.description}</p>}
                  {o.properties && <p className="bible-card-details">{o.properties}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* World Terms */}
      {worldTerms.length > 0 && (
        <div className="bible-section">
          <div className="bible-section-header">
            <h3 className="bible-section-title"><BookOpen size={18} /> Thuật ngữ ({worldTerms.length})</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/world')}>
              Quản lý <ChevronRight size={14} />
            </button>
          </div>
          <div className="bible-grid bible-grid--terms">
            {worldTerms.map(t => {
              const catLabel = WORLD_TERM_CATEGORIES.find(c => c.value === t.category)?.label || t.category;
              return (
                <div key={t.id} className="bible-card">
                  <div className="bible-card-header">
                    <strong>{t.name}</strong>
                    <span className="bible-card-category">{catLabel}</span>
                  </div>
                  {t.definition && <p>{t.definition}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chapter summaries */}
      {chapterMetas.length > 0 && (
        <div className="bible-section">
          <h3 className="bible-section-title">📝 Tóm tắt chương</h3>
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
        </div>
      )}

      {/* Empty state */}
      {totalItems === 0 && (
        <div className="empty-state">
          <BookOpen size={48} />
          <h3>Story Bible trống</h3>
          <p>Thêm nhân vật, địa điểm, thuật ngữ qua trang Nhân vật & Thế giới.</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-primary" onClick={() => navigate('/characters')}>
              <Users size={16} /> Nhân vật
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/world')}>
              <MapPin size={16} /> Thế giới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
