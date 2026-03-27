/**
 * StoryForge — Project Settings Panel (Phase 4)
 * 
 * Per-project AI settings:
 *   - ai_guidelines (editable text, pre-filled from genre)
 *   - ai_strictness (relaxed / balanced / strict)
 *   - Genre display & reset
 */

import React, { useState, useEffect } from 'react';
import useProjectStore from '../../stores/projectStore';
import { GENRES, AI_STRICTNESS_LEVELS } from '../../utils/constants';
import { GENRE_CONSTRAINTS } from '../../services/ai/promptBuilder';
import {
  Settings, BookOpen, Shield, RefreshCw, Save, ChevronDown, ChevronRight,
} from 'lucide-react';

export default function ProjectSettingsPanel() {
  const { currentProject, updateProjectSettings } = useProjectStore();
  const [expanded, setExpanded] = useState(false);
  const [guidelines, setGuidelines] = useState('');
  const [strictness, setStrictness] = useState('balanced');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (currentProject) {
      setGuidelines(currentProject.ai_guidelines || '');
      setStrictness(currentProject.ai_strictness || 'balanced');
      setDirty(false);
    }
  }, [currentProject?.id]);

  if (!currentProject) return null;

  const genreInfo = GENRES.find(g => g.value === currentProject.genre_primary);

  const handleSave = async () => {
    setSaving(true);
    await updateProjectSettings({
      ai_guidelines: guidelines,
      ai_strictness: strictness,
    });
    setSaving(false);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetGuidelines = () => {
    const genreKey = currentProject.genre_primary;
    const defaultText = GENRE_CONSTRAINTS[genreKey] || '';
    setGuidelines(defaultText);
    setDirty(true);
  };

  const handleChange = (field, value) => {
    if (field === 'guidelines') setGuidelines(value);
    if (field === 'strictness') setStrictness(value);
    setDirty(true);
  };

  return (
    <div className="project-settings-panel">
      <button
        className="project-settings-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Settings size={14} />
        <span>Cài đặt AI cho dự án</span>
        {dirty && <span className="project-settings-dirty">●</span>}
        {saved && <span className="project-settings-saved">✓ Đã lưu</span>}
      </button>

      {expanded && (
        <div className="project-settings-body">
          {/* Genre info */}
          <div className="project-settings-genre">
            <BookOpen size={14} />
            <span>Thể loại: <strong>{genreInfo?.emoji} {genreInfo?.label || currentProject.genre_primary}</strong></span>
          </div>

          {/* AI Strictness */}
          <div className="form-group">
            <label><Shield size={12} /> Mức nghiêm ngặt AI</label>
            <div className="strictness-options">
              {AI_STRICTNESS_LEVELS.map(level => (
                <button
                  key={level.value}
                  className={`strictness-btn ${strictness === level.value ? 'strictness-btn--active' : ''}`}
                  onClick={() => handleChange('strictness', level.value)}
                  title={level.desc}
                >
                  {level.value === 'relaxed' && '🎨'}
                  {level.value === 'balanced' && '⚖️'}
                  {level.value === 'strict' && '🔒'}
                  {' '}{level.label}
                </button>
              ))}
            </div>
            <p className="settings-hint">{AI_STRICTNESS_LEVELS.find(l => l.value === strictness)?.desc}</p>
          </div>

          {/* AI Guidelines */}
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label>📝 Nguyên tắc sáng tác</label>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResetGuidelines}
                title="Reset về chỉ dẫn mặc định của thể loại"
              >
                <RefreshCw size={12} /> Reset
              </button>
            </div>
            <textarea
              className="textarea"
              value={guidelines}
              onChange={e => handleChange('guidelines', e.target.value)}
              placeholder={`Đặt nguyên tắc bất biến cho AI tuân thủ xuyên suốt dự án.\nVí dụ:\n1. Mọi nhân vật phải có động cơ rõ ràng — không hành động vì "cốt truyện cần"\n2. Phục bút phải được thu hồi trong vòng 10 chương\n3. Không dùng ngôn ngữ hiện đại trong bối cảnh cổ đại\n4. Mỗi chương phải có ít nhất 1 xung đột\n(để trống = chỉ dùng quy tắc thể loại)`}
              rows={4}
              style={{ fontSize: '13px' }}
            />
            <p className="settings-hint">
              {guidelines
                ? `AI sẽ coi đây là nguyên tắc ${strictness === 'strict' ? 'TUYỆT ĐỐI' : strictness === 'relaxed' ? 'gợi ý' : 'cần tuân thủ'} + quy tắc thể loại.`
                : 'Đang dùng quy tắc thể loại mặc định. Thêm nguyên tắc riêng để AI tuân thủ chặt hơn.'}
            </p>
          </div>

          {/* Save button */}
          {dirty && (
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              <Save size={14} />
              {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
