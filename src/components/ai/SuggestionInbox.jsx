/**
 * StoryForge — SuggestionInbox Component (Phase A)
 * 
 * Displays AI-generated suggestions for:
 *   - Character status updates
 *   - New Canon Facts
 * 
 * Author can accept (✅) or reject (❌) each suggestion.
 */

import React, { useEffect, useState } from 'react';
import {
  Inbox, Sparkles, UserCheck, BookKey, Check, X,
  CheckCheck, XCircle, ChevronDown, Loader, Trash2,
} from 'lucide-react';
import useSuggestionStore from '../../stores/suggestionStore';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import './SuggestionInbox.css';

export default function SuggestionInbox({ projectId, onAccepted }) {
  const {
    suggestions, loading, loadSuggestions,
    acceptSuggestion, rejectSuggestion,
    acceptAll, rejectAll, clearResolved,
    getPendingCount,
  } = useSuggestionStore();

  const { generateSuggestions, isSuggesting } = useAIStore();
  const { currentProject, chapters } = useProjectStore();
  const { loadCodex } = useCodexStore();

  const [selectedChapter, setSelectedChapter] = useState('');
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (projectId) loadSuggestions(projectId);
  }, [projectId]);

  // Auto-select latest chapter
  useEffect(() => {
    if (chapters.length > 0 && !selectedChapter) {
      setSelectedChapter(chapters[chapters.length - 1].id);
    }
  }, [chapters]);

  const pending = suggestions.filter(s => s.status === 'pending');
  const resolved = suggestions.filter(s => s.status !== 'pending');
  const pendingCount = pending.length;

  const handleGenerate = async () => {
    if (!selectedChapter || !projectId) return;
    setError('');
    try {
      await generateSuggestions({
        projectId,
        chapterId: Number(selectedChapter),
        genre: currentProject?.genre_primary || '',
      });
    } catch (err) {
      setError(err.message || 'Lỗi khi tạo đề xuất');
    }
  };

  const handleAccept = async (id) => {
    await acceptSuggestion(id, projectId);
    // Reload codex to reflect changes
    if (projectId) loadCodex(projectId);
    onAccepted?.();
  };

  const handleReject = async (id) => {
    await rejectSuggestion(id, projectId);
  };

  const handleAcceptAll = async () => {
    await acceptAll(projectId);
    if (projectId) loadCodex(projectId);
    onAccepted?.();
  };

  const handleRejectAll = async () => {
    await rejectAll(projectId);
  };

  const typeIcon = (type) => {
    if (type === 'character_status') return <UserCheck size={14} />;
    return <BookKey size={14} />;
  };

  const typeLabel = (type) => {
    if (type === 'character_status') return 'Trạng thái';
    return 'Canon Fact';
  };

  const factTypeLabel = (ft) => {
    if (ft === 'secret') return '🔒 Bí mật';
    if (ft === 'rule') return '📏 Quy tắc';
    return '📌 Sự thật';
  };

  return (
    <div className="suggestion-inbox">
      {/* Header + Generate */}
      <div className="si-header">
        <div className="si-header-left">
          <Inbox size={18} />
          <span className="si-title">Suggestion Inbox</span>
          {pendingCount > 0 && (
            <span className="si-badge">{pendingCount}</span>
          )}
        </div>
      </div>

      {/* Generate controls */}
      <div className="si-generate">
        <select
          className="select"
          value={selectedChapter}
          onChange={(e) => setSelectedChapter(e.target.value)}
        >
          <option value="">Chọn chương...</option>
          {chapters.map((ch, idx) => (
            <option key={ch.id} value={ch.id}>
              {ch.title || `Chương ${idx + 1}`}
            </option>
          ))}
        </select>
        <button
          className="btn btn-accent btn-sm"
          onClick={handleGenerate}
          disabled={isSuggesting || !selectedChapter}
        >
          {isSuggesting ? (
            <><Loader size={14} className="spin" /> Đang phân tích...</>
          ) : (
            <><Sparkles size={14} /> Phân tích chương</>
          )}
        </button>
      </div>

      {error && <div className="si-error">{error}</div>}

      {/* Pending suggestions */}
      {pending.length > 0 && (
        <>
          <div className="si-actions-bar">
            <span className="si-count">{pending.length} đề xuất chờ duyệt</span>
            <div className="si-actions-btns">
              <button className="btn btn-ghost btn-sm" onClick={handleAcceptAll} title="Duyệt tất cả">
                <CheckCheck size={14} /> Duyệt tất cả
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleRejectAll} title="Bỏ tất cả">
                <XCircle size={14} /> Bỏ tất cả
              </button>
            </div>
          </div>

          <div className="si-list">
            {pending.map(s => (
              <div key={s.id} className={`si-card si-card--${s.type}`}>
                <div className="si-card-header">
                  <span className="si-card-type">
                    {typeIcon(s.type)} {typeLabel(s.type)}
                  </span>
                  {s.type === 'canon_fact' && s.fact_type && (
                    <span className="si-card-fact-type">{factTypeLabel(s.fact_type)}</span>
                  )}
                </div>

                {s.type === 'character_status' ? (
                  <div className="si-card-body">
                    <div className="si-char-name">{s.target_name}</div>
                    <div className="si-status-change">
                      <div className="si-old-status">
                        <span className="si-label">Hiện tại:</span>
                        <span>{s.current_value || '(chưa có)'}</span>
                      </div>
                      <div className="si-arrow">→</div>
                      <div className="si-new-status">
                        <span className="si-label">Đề xuất:</span>
                        <span>{s.suggested_value}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="si-card-body">
                    <div className="si-fact-content">{s.suggested_value}</div>
                  </div>
                )}

                {s.reasoning && (
                  <div className="si-reasoning">
                    <em>💡 {s.reasoning}</em>
                  </div>
                )}

                <div className="si-card-actions">
                  <button className="btn btn-sm si-btn-accept" onClick={() => handleAccept(s.id)}>
                    <Check size={14} /> Duyệt
                  </button>
                  <button className="btn btn-sm si-btn-reject" onClick={() => handleReject(s.id)}>
                    <X size={14} /> Bỏ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {pending.length === 0 && !isSuggesting && (
        <div className="si-empty">
          <Sparkles size={24} className="si-empty-icon" />
          <p>Chưa có đề xuất nào. Chọn chương và bấm <strong>Phân tích chương</strong> để AI đề xuất cập nhật.</p>
        </div>
      )}

      {/* Resolved (accepted/rejected) */}
      {resolved.length > 0 && (
        <div className="si-resolved-section">
          <div
            className="si-resolved-header"
            onClick={() => setShowResolved(!showResolved)}
          >
            <ChevronDown size={14} style={{ transform: showResolved ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
            <span>{resolved.length} đã xử lý</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); clearResolved(projectId); }}
              title="Xóa lịch sử"
            >
              <Trash2 size={12} />
            </button>
          </div>
          {showResolved && (
            <div className="si-resolved-list">
              {resolved.map(s => (
                <div key={s.id} className={`si-resolved-item si-resolved--${s.status}`}>
                  <span className="si-resolved-status">
                    {s.status === 'accepted' ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span className="si-resolved-type">{typeIcon(s.type)}</span>
                  <span className="si-resolved-text">
                    {s.type === 'character_status'
                      ? `${s.target_name}: ${s.suggested_value}`
                      : s.suggested_value
                    }
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
