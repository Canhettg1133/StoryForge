import React, { useEffect, useState } from 'react';
import {
  Inbox,
  Sparkles,
  UserCheck,
  BookKey,
  Check,
  X,
  CheckCheck,
  XCircle,
  ChevronDown,
  Loader,
  Trash2,
} from 'lucide-react';
import useSuggestionStore from '../../stores/suggestionStore';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import './SuggestionInbox.css';

export default function SuggestionInbox({ projectId, onAccepted }) {
  const {
    suggestions,
    loading,
    loadSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    acceptAll,
    rejectAll,
    clearResolved,
  } = useSuggestionStore();

  const { generateSuggestions, isSuggesting } = useAIStore();
  const { currentProject, chapters } = useProjectStore();
  const { loadCodex } = useCodexStore();

  const [selectedChapter, setSelectedChapter] = useState('');
  const [notice, setNotice] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (projectId) {
      loadSuggestions(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    if (chapters.length > 0 && !selectedChapter) {
      setSelectedChapter(String(chapters[chapters.length - 1].id));
    }
  }, [chapters, selectedChapter]);

  const pending = suggestions.filter((item) => item.status === 'pending');
  const resolved = suggestions.filter((item) => item.status !== 'pending');

  const setInfo = (text, type = 'info') => setNotice({ text, type });

  const handleGenerate = async () => {
    if (!selectedChapter || !projectId) return;

    setNotice(null);

    try {
      const outcome = await generateSuggestions({
        projectId,
        chapterId: Number(selectedChapter),
        genre: currentProject?.genre_primary || '',
      });

      if (outcome?.status === 'created') {
        setInfo(`Đã tạo ${outcome.createdCount} đề xuất mới.`, 'success');
        return;
      }

      if (outcome?.status === 'empty_chapter') {
        setInfo('Chương này chưa có nội dung để phân tích.');
        return;
      }

      if (outcome?.status === 'invalid_response') {
        setInfo('AI trả về kết quả sai định dạng nên chưa lưu được đề xuất.', 'error');
        return;
      }

      setInfo('Không tìm thấy thay đổi nào đủ rõ để tạo đề xuất mới.');
    } catch (err) {
      setInfo(err.message || 'Lỗi khi tạo đề xuất.', 'error');
    }
  };

  const handleAccept = async (id) => {
    await acceptSuggestion(id, projectId);
    if (projectId) {
      loadCodex(projectId);
    }
    onAccepted?.();
    setInfo('Đã duyệt đề xuất và cập nhật dữ liệu dự án.', 'success');
  };

  const handleReject = async (id) => {
    await rejectSuggestion(id, projectId);
    setInfo('Đã bỏ đề xuất này.');
  };

  const handleAcceptAll = async () => {
    await acceptAll(projectId);
    if (projectId) {
      loadCodex(projectId);
    }
    onAccepted?.();
    setInfo('Đã duyệt toàn bộ đề xuất đang chờ.', 'success');
  };

  const handleRejectAll = async () => {
    await rejectAll(projectId);
    setInfo('Đã bỏ toàn bộ đề xuất đang chờ.');
  };

  const handleClearResolved = async (event) => {
    event.stopPropagation();
    await clearResolved(projectId);
    setInfo('Đã xóa lịch sử đề xuất đã xử lý.');
  };

  const typeIcon = (type) => {
    if (type === 'character_status') return <UserCheck size={14} />;
    return <BookKey size={14} />;
  };

  const typeLabel = (type) => {
    if (type === 'character_status') return 'Trạng thái';
    return 'Sự thật canon';
  };

  const factTypeLabel = (factType) => {
    if (factType === 'secret') return 'Bí mật';
    if (factType === 'rule') return 'Quy tắc';
    return 'Sự thật';
  };

  return (
    <div className="suggestion-inbox">
      <div className="si-header">
        <div className="si-header-left">
          <Inbox size={18} />
          <span className="si-title">Hộp đề xuất</span>
          {pending.length > 0 && <span className="si-badge">{pending.length}</span>}
        </div>
      </div>

      <div className="si-generate">
        <select
          className="select"
          value={selectedChapter}
          onChange={(event) => setSelectedChapter(event.target.value)}
        >
          <option value="">Chọn chương...</option>
          {chapters.map((chapter, index) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title || `Chương ${index + 1}`}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={handleGenerate}
          disabled={isSuggesting || !selectedChapter}
        >
          {isSuggesting ? (
            <>
              <Loader size={14} className="spin" /> Đang phân tích...
            </>
          ) : (
            <>
              <Sparkles size={14} /> Phân tích chương
            </>
          )}
        </button>
      </div>

      {notice && (
        <div className={`si-notice si-notice--${notice.type}`}>
          {notice.text}
        </div>
      )}

      {loading && <div className="si-hint">Đang tải đề xuất...</div>}

      {pending.length > 0 && (
        <>
          <div className="si-actions-bar">
            <span className="si-count">{pending.length} đề xuất chờ duyệt</span>
            <div className="si-actions-btns">
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleAcceptAll} title="Duyệt tất cả">
                <CheckCheck size={14} /> Duyệt tất cả
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleRejectAll} title="Bỏ tất cả">
                <XCircle size={14} /> Bỏ tất cả
              </button>
            </div>
          </div>

          <div className="si-list">
            {pending.map((item) => (
              <div key={item.id} className={`si-card si-card--${item.type}`}>
                <div className="si-card-header">
                  <span className="si-card-type">
                    {typeIcon(item.type)} {typeLabel(item.type)}
                  </span>
                  {item.type === 'canon_fact' && item.fact_type && (
                    <span className="si-card-fact-type">{factTypeLabel(item.fact_type)}</span>
                  )}
                </div>

                {item.type === 'character_status' ? (
                  <div className="si-card-body">
                    <div className="si-char-name">{item.target_name}</div>
                    <div className="si-status-change">
                      <div className="si-old-status">
                        <span className="si-label">Hiện tại:</span>
                        <span>{item.current_value || '(chưa có)'}</span>
                      </div>
                      <div className="si-arrow">-&gt;</div>
                      <div className="si-new-status">
                        <span className="si-label">Đề xuất:</span>
                        <span>{item.suggested_value}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="si-card-body">
                    <div className="si-fact-content">{item.suggested_value}</div>
                  </div>
                )}

                {item.reasoning && (
                  <div className="si-reasoning">
                    <em>{item.reasoning}</em>
                  </div>
                )}

                <div className="si-card-actions">
                  <button type="button" className="btn btn-sm si-btn-accept" onClick={() => handleAccept(item.id)}>
                    <Check size={14} /> Duyệt
                  </button>
                  <button type="button" className="btn btn-sm si-btn-reject" onClick={() => handleReject(item.id)}>
                    <X size={14} /> Bỏ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {pending.length === 0 && !isSuggesting && !loading && (
        <div className="si-empty">
          <Sparkles size={24} className="si-empty-icon" />
          <p>
            Chưa có đề xuất nào. Chọn chương và bấm <strong>Phân tích chương</strong> để AI đề xuất cập
            nhật.
          </p>
        </div>
      )}

      {resolved.length > 0 && (
        <div className="si-resolved-section">
          <div
            className="si-resolved-header"
            onClick={() => setShowResolved(!showResolved)}
          >
            <ChevronDown
              size={14}
              style={{ transform: showResolved ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }}
            />
            <span>{resolved.length} đã xử lý</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleClearResolved}
              title="Xóa lịch sử"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {showResolved && (
            <div className="si-resolved-list">
              {resolved.map((item) => (
                <div key={item.id} className={`si-resolved-item si-resolved--${item.status}`}>
                  <span className="si-resolved-status">
                    {item.status === 'accepted' ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span className="si-resolved-type">{typeIcon(item.type)}</span>
                  <span className="si-resolved-text">
                    {item.type === 'character_status'
                      ? `${item.target_name}: ${item.suggested_value}`
                      : item.suggested_value}
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
