import React from 'react';
import { BookOpen, Edit3, Eye, MessageSquare, Plus, X } from 'lucide-react';
import {
  GENRES,
  POV_MODES,
  STORY_STRUCTURES,
  TONES,
} from '../../../utils/constants';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';

const StoryBibleOverviewSection = React.memo(function StoryBibleOverviewSection({
  isOpen,
  onToggle,
  chaptersCount,
  charactersCount,
  locationsCount,
  objectsCount,
  worldTermsCount,
  title,
  setTitle,
  titleSaved,
  genrePrimary,
  tone,
  povMode,
  pronounStyle,
  currentPronoun,
  synopsis,
  setSynopsis,
  synopsisSaved,
  storyStructure,
  targetLengthType,
  targetLength,
  setTargetLength,
  targetLengthSaved,
  targetLengthWarning,
  ultimateGoal,
  setUltimateGoal,
  ultimateGoalSaved,
  milestonesInfo,
  milestonesSaved,
  addMilestone,
  updateMilestone,
  removeMilestone,
  description,
  setDescription,
  descSaved,
  save,
  handleGenreChange,
  handleToneChange,
  handlePovChange,
  handlePronounChange,
  handleStructureChange,
  handleTargetLengthTypeChange,
  pronounStylePresets,
}) {
  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={Edit3}
        title="Tổng quan"
        sectionKey="overview"
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen && (
        <div className="bible-edit-card">
          <div className="form-group">
            <label className="form-label">Tên truyện {titleSaved && <span className="save-indicator">Đã lưu</span>}</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={(event) => save({ title: event.target.value })} />
          </div>

          <div className="bible-edit-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Thể loại</label>
              <select className="select" value={genrePrimary} onChange={(event) => handleGenreChange(event.target.value)}>
                {GENRES.map((genre) => <option key={genre.value} value={genre.value}>{genre.emoji} {genre.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Tone</label>
              <select className="select" value={tone} onChange={(event) => handleToneChange(event.target.value)}>
                <option value="">Mặc định</option>
                {TONES.map((toneOption) => <option key={toneOption.value} value={toneOption.value}>{toneOption.label}</option>)}
              </select>
            </div>
          </div>

          <div className="bible-edit-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label"><Eye size={13} /> Góc nhìn</label>
              <select className="select" value={povMode} onChange={(event) => handlePovChange(event.target.value)}>
                {POV_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <span className="form-hint">{POV_MODES.find((item) => item.value === povMode)?.desc}</span>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label"><MessageSquare size={13} /> Xưng hô</label>
              <select className="select" value={pronounStyle} onChange={(event) => handlePronounChange(event.target.value)}>
                {pronounStylePresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
              </select>
              {currentPronoun && currentPronoun.value !== 'custom' && (
                <span className="form-hint">Xưng: "{currentPronoun.default_self}" - Gọi: "{currentPronoun.default_other}"</span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label"><BookOpen size={13} /> Cấu trúc truyện</label>
            <select className="select" value={storyStructure} onChange={(event) => handleStructureChange(event.target.value)}>
              {STORY_STRUCTURES.map((structure) => <option key={structure.value} value={structure.value}>{structure.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Cốt truyện chính {synopsisSaved && <span className="save-indicator">Đã lưu</span>}</label>
            <textarea
              className="textarea"
              value={synopsis}
              onChange={(event) => setSynopsis(event.target.value)}
              rows={3}
              placeholder="Tóm tắt mạch truyện chính... AI dùng để duy trì mạch truyện"
            />
          </div>

          <div className="bible-edit-row" style={{ marginTop: '16px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Độ dài dự kiến</label>
              <select className="select" value={targetLengthType} onChange={(event) => handleTargetLengthTypeChange(event.target.value)}>
                <option value="unset">Chưa xác định</option>
                <option value="short">Truyện ngắn (30-50 chương)</option>
                <option value="medium">Truyện vừa (100-200 chương)</option>
                <option value="long">Trường thiên (300-500 chương)</option>
                <option value="epic">Sử thi (500+ chương)</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Số chương mục tiêu {targetLengthSaved && <span className="save-indicator">Đã lưu</span>}</label>
              <input type="number" className="input" value={targetLength} onChange={(event) => setTargetLength(event.target.value)} />
              {targetLengthWarning && (
                <span className="form-hint" style={{ color: 'var(--color-warning)', marginTop: '6px' }}>
                  {targetLengthWarning}
                </span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Đích đến tối thượng {ultimateGoalSaved && <span className="save-indicator">Đã lưu</span>}</label>
            <textarea
              className="textarea"
              value={ultimateGoal}
              onChange={(event) => setUltimateGoal(event.target.value)}
              rows={2}
              placeholder="VD: Main đạt cảnh giới Thần Tôn và báo thù diệt tộc. AI lấy để tránh end sớm."
            />
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Cột mốc % (Milestones) {milestonesSaved && <span className="save-indicator">Đã lưu</span>}
              <button type="button" className="btn btn-ghost btn-xs ml-2" onClick={addMilestone}>
                <Plus size={12} /> Thêm
              </button>
            </label>
            {milestonesInfo.map((milestone, index) => (
              <div key={`${milestone.percent}-${index}`} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input type="number" className="input" style={{ width: '80px' }} value={milestone.percent} onChange={(event) => updateMilestone(index, 'percent', Number(event.target.value))} placeholder="%" />
                <span style={{ alignSelf: 'center', fontSize: '12px' }}>%</span>
                <input className="input" style={{ flex: 1 }} value={milestone.description} onChange={(event) => updateMilestone(index, 'description', event.target.value)} placeholder="Mô tả cột mốc..." />
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeMilestone(index)}><X size={14} /></button>
              </div>
            ))}
            {milestonesInfo.length === 0 && (
              <span className="form-hint" style={{ marginTop: 0 }}>
                Chia cốt truyện thành các phần trăm để AI dẫn dắt tốt hơn.
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Mô tả {descSaved && <span className="save-indicator">Đã lưu</span>}</label>
            <textarea
              className="textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              placeholder="Mô tả ngắn về dự án..."
            />
          </div>

          <div className="bible-stats">
            <span>{chaptersCount} chương</span>
            <span>{charactersCount} nhân vật</span>
            <span>{locationsCount} địa điểm</span>
            <span>{objectsCount} vật phẩm</span>
            <span>{worldTermsCount} thuật ngữ</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default StoryBibleOverviewSection;
