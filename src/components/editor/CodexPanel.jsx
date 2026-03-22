/**
 * StoryForge — Codex Panel (Phase 3 Enhancement + Factions & Aliases Patch)
 *
 * Real-time entity detection panel in the Editor sidebar.
 * Detects characters, locations, objects, terms, factions
 * that appear in the current scene text.
 *
 * Thay đổi so với bản cũ:
 *  - Dùng store helpers (findCharactersInText, findLocationsInText,
 *    findTermsInText, findFactionsInText) thay vì inline lowerText.includes()
 *    → Tự động hưởng lợi từ aliases + auto-split "A - B"
 *  - Thêm section "Thế lực" hiển thị factions được phát hiện
 *  - Import thêm factions từ store
 */

import React, { useState, useEffect, useMemo } from 'react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import {
  BookOpen, Users, MapPin, Package, BookMarked,
  ChevronDown, ChevronUp, AlertTriangle, Eye,
  Star, Sword, Shield, UserCheck, Heart, Landmark,
} from 'lucide-react';
import './CodexPanel.css';

const ROLE_ICONS = {
  protagonist: Star,
  antagonist: Sword,
  mentor: Shield,
  deuteragonist: UserCheck,
  love_interest: Heart,
};

const FACTION_TYPE_LABELS = {
  sect: 'Tông môn',
  kingdom: 'Vương quốc',
  organization: 'Tổ chức',
  other: 'Thế lực',
};

export default function CodexPanel({ sceneText = '' }) {
  const { currentProject, chapters, activeChapterId } = useProjectStore();
  const {
    characters, locations, objects, worldTerms, factions, taboos,
    loading, loadCodex,
    findCharactersInText,
    findLocationsInText,
    findTermsInText,
    findFactionsInText,
  } = useCodexStore();

  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState({});

  // Load codex data khi project thay đổi
  useEffect(() => {
    if (currentProject) loadCodex(currentProject.id);
  }, [currentProject?.id]);

  // Detect entities — dùng store helpers để hưởng lợi từ aliases & auto-split
  const detected = useMemo(() => {
    if (!sceneText || sceneText.replace(/<[^>]*>/g, '').trim().length < 5) {
      return { characters: [], locations: [], objects: [], terms: [], factions: [] };
    }
    // objects vẫn dùng inline vì store chưa có findObjectsInText
    const cleanText = sceneText.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').toLowerCase();
    return {
      characters: findCharactersInText(sceneText),
      locations: findLocationsInText(sceneText),
      objects: objects.filter(o => o.name && cleanText.includes(o.name.toLowerCase())),
      terms: findTermsInText(sceneText),
      factions: findFactionsInText(sceneText),
    };
  }, [
    sceneText,
    // Phụ thuộc vào data thô để useMemo re-run khi store reload
    characters, locations, objects, worldTerms, factions,
  ]);

  // Chỉ số chương hiện tại để lọc taboos
  const chapterIndex = useMemo(() => {
    const ch = chapters.find(c => c.id === activeChapterId);
    return ch ? chapters.indexOf(ch) : 0;
  }, [chapters, activeChapterId]);

  const activeTaboos = useMemo(() => {
    return taboos
      .filter(t => (chapterIndex + 1) < t.effective_before_chapter)
      .filter(t => {
        if (!t.character_id) return true;
        return detected.characters.some(c => c.id === t.character_id);
      })
      .map(t => ({
        ...t,
        characterName: characters.find(c => c.id === t.character_id)?.name || 'Tất cả',
      }));
  }, [taboos, chapterIndex, detected.characters, characters]);

  const totalDetected =
    detected.characters.length +
    detected.locations.length +
    detected.objects.length +
    detected.terms.length +
    detected.factions.length;

  const toggleDetail = (key) => {
    setShowDetails(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!currentProject) return null;

  return (
    <div className="codex-panel">
      {/* Header */}
      <div className="codex-panel-header" onClick={() => setExpanded(!expanded)}>
        <div className="codex-panel-header-left">
          <BookMarked size={14} />
          <span className="codex-panel-title">Codex</span>
          {totalDetected > 0 && (
            <span className="codex-panel-badge">{totalDetected}</span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {expanded && (
        <div className="codex-panel-body">
          {totalDetected === 0 ? (
            <div className="codex-panel-empty">
              <Eye size={14} />
              <span>Viết text → entity tự hiện</span>
            </div>
          ) : (
            <>
              {/* ── Nhân vật ── */}
              {detected.characters.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <Users size={12} />
                    <span>Nhân vật ({detected.characters.length})</span>
                  </div>
                  {detected.characters.map(c => {
                    const RoleIcon = ROLE_ICONS[c.role] || Users;
                    const isOpen = showDetails[`char-${c.id}`];
                    return (
                      <div
                        key={c.id}
                        className="codex-entity-card"
                        onClick={() => toggleDetail(`char-${c.id}`)}
                      >
                        <div className="codex-entity-header">
                          <RoleIcon size={12} className="codex-entity-role-icon" />
                          <span className="codex-entity-name">{c.name}</span>
                          <span className="codex-entity-role">{c.role}</span>
                        </div>
                        {isOpen && (
                          <div className="codex-entity-details">
                            {c.pronouns_self && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Xưng:</span>{' '}
                                "{c.pronouns_self}"
                                {c.pronouns_other && <> / "{c.pronouns_other}"</>}
                              </div>
                            )}
                            {c.appearance && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Ngoại hình:</span>{' '}
                                {c.appearance.substring(0, 80)}{c.appearance.length > 80 ? '…' : ''}
                              </div>
                            )}
                            {c.personality && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Tính cách:</span>{' '}
                                {c.personality.substring(0, 80)}{c.personality.length > 80 ? '…' : ''}
                              </div>
                            )}
                            {c.goals && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Mục tiêu:</span>{' '}
                                {c.goals.substring(0, 60)}{c.goals.length > 60 ? '…' : ''}
                              </div>
                            )}
                            {c.aliases?.length > 0 && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Biệt danh:</span>{' '}
                                {c.aliases.join(', ')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Địa điểm ── */}
              {detected.locations.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <MapPin size={12} />
                    <span>Địa điểm ({detected.locations.length})</span>
                  </div>
                  {detected.locations.map(l => (
                    <div
                      key={l.id}
                      className="codex-entity-card"
                      onClick={() => toggleDetail(`loc-${l.id}`)}
                    >
                      <div className="codex-entity-header">
                        <MapPin size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{l.name}</span>
                      </div>
                      {showDetails[`loc-${l.id}`] && (
                        <div className="codex-entity-details">
                          {l.description && (
                            <div className="codex-entity-detail">
                              {l.description.substring(0, 100)}{l.description.length > 100 ? '…' : ''}
                            </div>
                          )}
                          {l.aliases?.length > 0 && (
                            <div className="codex-entity-detail">
                              <span className="codex-detail-label">Còn gọi:</span>{' '}
                              {l.aliases.join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Vật phẩm ── */}
              {detected.objects.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <Package size={12} />
                    <span>Vật phẩm ({detected.objects.length})</span>
                  </div>
                  {detected.objects.map(o => (
                    <div
                      key={o.id}
                      className="codex-entity-card"
                      onClick={() => toggleDetail(`obj-${o.id}`)}
                    >
                      <div className="codex-entity-header">
                        <Package size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{o.name}</span>
                      </div>
                      {showDetails[`obj-${o.id}`] && (
                        <div className="codex-entity-details">
                          {o.description && (
                            <div className="codex-entity-detail">
                              {o.description.substring(0, 100)}{o.description.length > 100 ? '…' : ''}
                            </div>
                          )}
                          {o.properties && (
                            <div className="codex-entity-detail">
                              <span className="codex-detail-label">Thuộc tính:</span>{' '}
                              {o.properties.substring(0, 80)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Thuật ngữ ── */}
              {detected.terms.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <BookOpen size={12} />
                    <span>Thuật ngữ ({detected.terms.length})</span>
                  </div>
                  {detected.terms.map(t => (
                    <div
                      key={`term-${t.id}`}
                      className="codex-entity-card"
                      onClick={() => toggleDetail(`term-${t.id}`)}
                    >
                      <div className="codex-entity-header">
                        <BookOpen size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{t.name}</span>
                        {t.category && (
                          <span className="codex-entity-role">{t.category}</span>
                        )}
                      </div>
                      {showDetails[`term-${t.id}`] && t.definition && (
                        <div className="codex-entity-details">
                          <div className="codex-entity-detail">
                            {t.definition.substring(0, 120)}{t.definition.length > 120 ? '…' : ''}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Thế lực [MỚI] ── */}
              {detected.factions.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <Landmark size={12} />
                    <span>Thế lực ({detected.factions.length})</span>
                  </div>
                  {detected.factions.map(f => (
                    <div
                      key={`faction-${f.id}`}
                      className="codex-entity-card"
                      onClick={() => toggleDetail(`faction-${f.id}`)}
                    >
                      <div className="codex-entity-header">
                        <Landmark size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{f.name}</span>
                        {f.faction_type && (
                          <span className="codex-entity-role">
                            {FACTION_TYPE_LABELS[f.faction_type] || f.faction_type}
                          </span>
                        )}
                      </div>
                      {showDetails[`faction-${f.id}`] && (
                        <div className="codex-entity-details">
                          {f.description && (
                            <div className="codex-entity-detail">
                              {f.description.substring(0, 120)}{f.description.length > 120 ? '…' : ''}
                            </div>
                          )}
                          {f.aliases?.length > 0 && (
                            <div className="codex-entity-detail">
                              <span className="codex-detail-label">Còn gọi:</span>{' '}
                              {f.aliases.join(', ')}
                            </div>
                          )}
                          {f.notes && (
                            <div className="codex-entity-detail">
                              <span className="codex-detail-label">Ghi chú:</span>{' '}
                              {f.notes.substring(0, 80)}{f.notes.length > 80 ? '…' : ''}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Cấm kỵ ── */}
              {activeTaboos.length > 0 && (
                <div className="codex-panel-section codex-panel-taboos">
                  <div className="codex-panel-section-title codex-panel-taboo-title">
                    <AlertTriangle size={12} />
                    <span>Cấm kỵ ({activeTaboos.length})</span>
                  </div>
                  {activeTaboos.map(t => (
                    <div key={t.id} className="codex-taboo-card">
                      <span className="codex-taboo-icon">⛔</span>
                      <div>
                        <span className="codex-taboo-who">{t.characterName}</span>
                        <span className="codex-taboo-desc">{t.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}