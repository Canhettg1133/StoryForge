/**
 * StoryForge — Codex Panel (Phase 3 Enhancement)
 * 
 * Real-time entity detection panel in the Editor sidebar.
 * Detects characters, locations, objects, terms that appear in the current scene text.
 * Shows mini-cards so the writer can see context without leaving the editor.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import {
  BookOpen, Users, MapPin, Package, BookMarked, ChevronDown, ChevronUp,
  AlertTriangle, Eye, EyeOff, Star, Sword, Shield, UserCheck, Heart,
} from 'lucide-react';
import './CodexPanel.css';

const ROLE_ICONS = {
  protagonist: Star,
  antagonist: Sword,
  mentor: Shield,
  deuteragonist: UserCheck,
  love_interest: Heart,
};

export default function CodexPanel({ sceneText = '' }) {
  const { currentProject, chapters, activeChapterId } = useProjectStore();
  const {
    characters, locations, objects, worldTerms, taboos,
    chapterMetas, loading, loadCodex,
    findCharactersInText, findLocationsInText, findTermsInText,
  } = useCodexStore();

  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState({});

  // Load codex data
  useEffect(() => {
    if (currentProject) loadCodex(currentProject.id);
  }, [currentProject?.id]);

  // Clean text for detection
  const cleanText = useMemo(() => {
    return (sceneText || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  }, [sceneText]);

  // Detect entities in current scene (debounced via useMemo)
  const detected = useMemo(() => {
    if (!cleanText || cleanText.trim().length < 5) {
      return { characters: [], locations: [], objects: [], terms: [] };
    }
    const lowerText = cleanText.toLowerCase();
    return {
      characters: characters.filter(c => c.name && lowerText.includes(c.name.toLowerCase())),
      locations: locations.filter(l => l.name && lowerText.includes(l.name.toLowerCase())),
      objects: objects.filter(o => o.name && lowerText.includes(o.name.toLowerCase())),
      terms: worldTerms.filter(t => t.name && lowerText.includes(t.name.toLowerCase())),
    };
  }, [cleanText, characters, locations, objects, worldTerms]);

  // Get active taboos for current chapter
  const chapterIndex = useMemo(() => {
    const ch = chapters.find(c => c.id === activeChapterId);
    return ch ? chapters.indexOf(ch) : 0;
  }, [chapters, activeChapterId]);

  const activeTaboos = useMemo(() => {
    return taboos
      .filter(t => (chapterIndex + 1) < t.effective_before_chapter)
      .filter(t => {
        // Only show taboos relevant to detected characters
        if (!t.character_id) return true;
        return detected.characters.some(c => c.id === t.character_id);
      })
      .map(t => ({
        ...t,
        characterName: characters.find(c => c.id === t.character_id)?.name || 'Tất cả',
      }));
  }, [taboos, chapterIndex, detected.characters, characters]);

  const totalDetected = detected.characters.length + detected.locations.length + detected.objects.length + detected.terms.length;

  const toggleDetail = (id) => {
    setShowDetails(prev => ({ ...prev, [id]: !prev[id] }));
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
              {/* Characters */}
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
                      <div key={c.id} className="codex-entity-card" onClick={() => toggleDetail(`char-${c.id}`)}>
                        <div className="codex-entity-header">
                          <RoleIcon size={12} className="codex-entity-role-icon" />
                          <span className="codex-entity-name">{c.name}</span>
                          <span className="codex-entity-role">{c.role}</span>
                        </div>
                        {isOpen && (
                          <div className="codex-entity-details">
                            {c.pronouns_self && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Xưng:</span> "{c.pronouns_self}"
                                {c.pronouns_other && <> / "{c.pronouns_other}"</>}
                              </div>
                            )}
                            {c.appearance && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Ngoại hình:</span> {c.appearance.substring(0, 80)}{c.appearance.length > 80 ? '...' : ''}
                              </div>
                            )}
                            {c.personality && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Tính cách:</span> {c.personality.substring(0, 80)}{c.personality.length > 80 ? '...' : ''}
                              </div>
                            )}
                            {c.goals && (
                              <div className="codex-entity-detail">
                                <span className="codex-detail-label">Mục tiêu:</span> {c.goals.substring(0, 60)}{c.goals.length > 60 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Locations */}
              {detected.locations.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <MapPin size={12} />
                    <span>Địa điểm ({detected.locations.length})</span>
                  </div>
                  {detected.locations.map(l => (
                    <div key={l.id} className="codex-entity-card" onClick={() => toggleDetail(`loc-${l.id}`)}>
                      <div className="codex-entity-header">
                        <MapPin size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{l.name}</span>
                      </div>
                      {showDetails[`loc-${l.id}`] && l.description && (
                        <div className="codex-entity-details">
                          <div className="codex-entity-detail">{l.description.substring(0, 100)}{l.description.length > 100 ? '...' : ''}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Objects */}
              {detected.objects.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <Package size={12} />
                    <span>Vật phẩm ({detected.objects.length})</span>
                  </div>
                  {detected.objects.map(o => (
                    <div key={o.id} className="codex-entity-card" onClick={() => toggleDetail(`obj-${o.id}`)}>
                      <div className="codex-entity-header">
                        <Package size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{o.name}</span>
                      </div>
                      {showDetails[`obj-${o.id}`] && (
                        <div className="codex-entity-details">
                          {o.description && <div className="codex-entity-detail">{o.description.substring(0, 100)}{o.description.length > 100 ? '...' : ''}</div>}
                          {o.properties && <div className="codex-entity-detail"><span className="codex-detail-label">Thuộc tính:</span> {o.properties.substring(0, 80)}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Terms */}
              {detected.terms.length > 0 && (
                <div className="codex-panel-section">
                  <div className="codex-panel-section-title">
                    <BookOpen size={12} />
                    <span>Thuật ngữ ({detected.terms.length})</span>
                  </div>
                  {detected.terms.map(t => (
                    <div key={t.id} className="codex-entity-card" onClick={() => toggleDetail(`term-${t.id}`)}>
                      <div className="codex-entity-header">
                        <BookOpen size={12} className="codex-entity-role-icon" />
                        <span className="codex-entity-name">{t.name}</span>
                      </div>
                      {showDetails[`term-${t.id}`] && t.definition && (
                        <div className="codex-entity-details">
                          <div className="codex-entity-detail">{t.definition.substring(0, 120)}{t.definition.length > 120 ? '...' : ''}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Active Taboos */}
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
