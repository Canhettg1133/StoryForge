/**
 * LinkToProjectModal - Link analysis events to story projects
 * Allows selecting a project, chapter, and scene for reference
 */

import { useEffect, useState } from 'react';
import useProjectStore from '../../../../stores/projectStore.js';

const SEVERITY_LABELS = {
  crucial: 'Cốt lõi',
  major: 'Quan trọng',
  moderate: 'Trung bình',
  minor: 'Nhẹ',
};

export default function LinkToProjectModal({ event, corpusId, onLink, onUnlink, onClose }) {
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedChapterId, setSelectedChapterId] = useState(null);
  const [selectedSceneId, setSelectedSceneId] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const canonLabel = event.canonOrFanon?.type === 'fanon' ? 'Phi chính sử' : 'Chính sử';

  // Load projects
  const projects = useProjectStore((state) => state.projects);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadProject = useProjectStore((state) => state.loadProject);
  const chapters = useProjectStore((state) => state.chapters);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load project details when selected
  useEffect(() => {
    if (selectedProjectId) {
      loadProject(selectedProjectId, { skipReload: false });
    }
  }, [selectedProjectId, loadProject]);

  const handleLink = async () => {
    setSaving(true);
    try {
      await onLink({
        eventId: event.id,
        projectId: selectedProjectId,
        chapterId: selectedChapterId,
        sceneId: selectedSceneId,
        notes,
        eventPayload: event,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="link-modal-backdrop" onClick={onClose}>
      <div className="link-modal" onClick={(e) => e.stopPropagation()}>
        <div className="link-modal-header">
          <h3>Liên kết vào dự án</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Event preview */}
        <div className="link-event-preview">
          <p className="link-event-title">{event.description}</p>
          <span className="link-event-meta">
            Ch.{formatChapter(event.chapter)} · {SEVERITY_LABELS[event.severity] || event.severity} · {canonLabel}
          </span>
        </div>

        {/* Project selection */}
        <div className="link-section">
          <label>1. Chọn dự án</label>
          {projects.length === 0 ? (
            <p className="link-empty">Chưa có dự án. Hãy tạo dự án trước.</p>
          ) : (
            <select
              value={selectedProjectId || ''}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedProjectId(value ? Number(value) : null);
                setSelectedChapterId(null);
                setSelectedSceneId(null);
              }}
            >
              <option value="">Chọn một dự án...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Chapter selection */}
        {selectedProjectId && (
          <div className="link-section">
            <label>2. Chọn chương (tùy chọn)</label>
            <select
              value={selectedChapterId || ''}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedChapterId(value ? Number(value) : null);
                setSelectedSceneId(null);
              }}
            >
              <option value="">Không chỉ định chương</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  Ch.{c.order_index + 1}: {c.title || 'Chưa đặt tên'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Scene selection */}
        {selectedChapterId && (
          <div className="link-section">
            <label>3. Chọn cảnh (tùy chọn)</label>
            <select
              value={selectedSceneId || ''}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedSceneId(value ? Number(value) : null);
              }}
            >
              <option value="">Không chỉ định cảnh</option>
              {/* Scenes would be loaded from project store */}
            </select>
          </div>
        )}

        {/* Notes */}
        <div className="link-section">
          <label>Ghi chú (tùy chọn)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Sự kiện này liên quan thế nào tới câu chuyện của bạn?"
            rows={3}
          />
        </div>

        {/* Actions */}
        <div className="link-modal-actions">
          <button className="btn-cancel" onClick={onClose}>Hủy</button>
          <button
            className="btn-link"
            onClick={handleLink}
            disabled={!selectedProjectId || saving}
          >
            {saving ? 'Đang liên kết...' : 'Liên kết sự kiện'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatChapter(chapter) {
  const value = Number(chapter);
  return Number.isFinite(value) && value > 0 ? value : '?';
}
