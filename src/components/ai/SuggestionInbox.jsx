import React, { useEffect, useState } from 'react';
import {
  Inbox,
  Sparkles,
  UserCheck,
  BookKey,
  ShieldAlert,
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
import { toVietnameseErrorMessage } from '../../utils/errorMessages';
import { previewStoryBibleEntityMerge } from '../../services/codex/storyBibleMergeService.js';
import './SuggestionInbox.css';

function parseCandidateOp(value) {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

const CANON_OP_LABELS = {
  CHARACTER_DIED: 'Nhân vật tử vong',
  CHARACTER_RESCUED: 'Nhân vật được cứu',
  SECRET_REVEALED: 'Bí mật bị lộ',
  OBJECT_LOST: 'Vật phẩm bị mất',
  OBJECT_CONSUMED: 'Vật phẩm bị tiêu hao',
  OBJECT_STATUS_CHANGED: 'Đổi trạng thái vật phẩm',
};

function getCanonOpLabel(opType) {
  return CANON_OP_LABELS[opType] || opType || 'Thay đổi canon';
}

function getCanonReviewTarget(item, op) {
  return (
    op?.object_name
    || op?.subject_name
    || op?.target_name
    || op?.fact_description
    || item.target_name
    || ''
  );
}

function getCanonReviewSummary(item, op) {
  return (
    item.suggested_value
    || op?.summary
    || op?.payload?.status_summary
    || op?.payload?.availability
    || getCanonOpLabel(op?.op_type)
  );
}

function getCanonReviewEvidence(item, op) {
  return item.reasoning || op?.evidence || '';
}

export default function SuggestionInbox({ projectId, onAccepted }) {
  const {
    suggestions,
    loading,
    loadSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    quickApproveSafe,
    rejectAll,
    clearResolved,
    runDuplicateAudit,
    duplicateAuditing,
  } = useSuggestionStore();

  const { generateSuggestions, isSuggesting } = useAIStore();
  const { currentProject, chapters } = useProjectStore();
  const { loadCodex } = useCodexStore();

  const [selectedChapter, setSelectedChapter] = useState('');
  const [notice, setNotice] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [entityResolutionChoices, setEntityResolutionChoices] = useState({});
  const [entityRoleConfirmations, setEntityRoleConfirmations] = useState({});
  const [duplicatePreviews, setDuplicatePreviews] = useState({});
  const [duplicatePreviewLoading, setDuplicatePreviewLoading] = useState({});

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
      setInfo(toVietnameseErrorMessage(err, 'Lỗi khi tạo đề xuất.'), 'error');
    }
  };

  const handleDuplicateAudit = async () => {
    if (!projectId || duplicateAuditing) return;
    setNotice(null);
    try {
      const job = await runDuplicateAudit(projectId);
      if (['awaiting_review', 'completed'].includes(job?.status)) {
        const continuation = job.shortlist_truncated
          ? ` Còn ${job.remaining_count || 'một số'} cặp chưa phân tích; chạy lại sau khi xử lý đợt này.`
          : '';
        setInfo(
          `Đã phân tích ${job.analyzed_count || 0} cặp trong lượt này; có ${job.suggestion_count || 0} mục cần duyệt.${continuation}`,
          'success',
        );
      } else if (job?.status === 'retryable_error') {
        setInfo('Rà soát trùng dữ liệu chưa hoàn tất. Kiểm tra model tool-call rồi chạy lại.', 'error');
      }
    } catch (error) {
      setInfo(toVietnameseErrorMessage(error, 'Không thể rà soát dữ liệu cũ.'), 'error');
    }
  };

  const loadDuplicatePreview = async (item, resolution) => {
    const entityOptions = Array.isArray(resolution?.entity_options) ? resolution.entity_options : [];
    const survivorId = Number(
      entityResolutionChoices[item.id]
      || resolution?.recommended_survivor_id
      || entityOptions[0]?.id,
    );
    const duplicateId = Number(entityOptions.find((option) => Number(option.id) !== survivorId)?.id);
    if (!survivorId || !duplicateId) throw new Error('Cặp thực thể rà soát không còn hợp lệ.');

    setDuplicatePreviewLoading((current) => ({ ...current, [item.id]: true }));
    try {
      const preview = await previewStoryBibleEntityMerge({
        projectId,
        entityKind: resolution?.entity_kind,
        survivorId,
        duplicateId,
      });
      setDuplicatePreviews((current) => ({ ...current, [item.id]: preview }));
      return { preview, survivorId, duplicateId };
    } finally {
      setDuplicatePreviewLoading((current) => ({ ...current, [item.id]: false }));
    }
  };

  const handleAccept = async (id) => {
    const suggestion = suggestions.find((item) => item.id === id) || null;
    const parsed = parseCandidateOp(suggestion?.candidate_op);
    const resolutionValue = entityResolutionChoices[id]
      || (parsed?.recommended_target_id ? String(parsed.recommended_target_id) : '__create_new__');
    try {
      let options;
      if (suggestion?.type === 'entity_resolution') {
        const centralRole = ['protagonist', 'deuteragonist'].includes(parsed?.role_hint)
          ? parsed.role_hint
          : null;
        options = {
          resolutionAction: resolutionValue === '__create_new__' ? 'create_new' : 'match_existing',
          targetEntityId: resolutionValue === '__create_new__' ? null : Number(resolutionValue),
          confirmedRole: resolutionValue === '__create_new__' && centralRole && entityRoleConfirmations[id]
            ? centralRole
            : null,
        };
      } else if (suggestion?.type === 'entity_duplicate_review') {
        const { preview, survivorId, duplicateId } = await loadDuplicatePreview(suggestion, parsed);
        const protectedWarning = preview.protected_conflicts.length > 0
          ? `\nTrường được bảo vệ: ${preview.protected_conflicts.join(', ')}.`
          : '';
        const confirmed = window.confirm(
          `Giữ "${preview.survivor.name}" và gộp "${preview.duplicate.name}"?\n`
          + `${preview.reference_count} tham chiếu sẽ được viết lại.${protectedWarning}`,
        );
        if (!confirmed) return;
        options = { survivorId, duplicateId, confirmed: true };
      }
      await acceptSuggestion(id, projectId, options);
      if (projectId) {
        loadCodex(projectId);
      }
      onAccepted?.();
      setInfo('Đã duyệt đề xuất qua canon engine và cập nhật dữ liệu dự án.', 'success');
    } catch (err) {
      setInfo(toVietnameseErrorMessage(err, 'Không thể canon hóa đề xuất này.'), 'error');
    }
  };

  const handleReject = async (id) => {
    await rejectSuggestion(id, projectId);
    setInfo('Đã bỏ đề xuất này.');
  };

  const handleAcceptAll = async () => {
    try {
      const result = await quickApproveSafe(projectId);
      if (projectId) {
        loadCodex(projectId);
      }
      onAccepted?.();
      setInfo(
        result?.heldCount > 0
          ? `Đã duyệt nhanh ${result.acceptedCount || 0} mục an toàn; giữ lại ${result.heldCount} mục cần xem kỹ.`
          : `Đã duyệt nhanh ${result?.acceptedCount || 0} mục an toàn.`,
        'success',
      );
    } catch (err) {
      setInfo(toVietnameseErrorMessage(err, 'Không thể canon hóa toàn bộ đề xuất.'), 'error');
    }
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
    if (type === 'entity_resolution') return <UserCheck size={14} />;
    if (type === 'entity_duplicate_review') return <ShieldAlert size={14} />;
    if (type === 'canon_op_review') return <ShieldAlert size={14} />;
    return <BookKey size={14} />;
  };

  const typeLabel = (type) => {
    if (type === 'character_status') return 'Trạng thái';
    if (type === 'entity_resolution') return 'Gộp thực thể';
    if (type === 'entity_duplicate_review') return 'Nghi trùng dữ liệu cũ';
    if (type === 'canon_op_review') return 'Canon cần duyệt';
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
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleDuplicateAudit}
          disabled={duplicateAuditing || !projectId}
        >
          {duplicateAuditing ? <Loader size={14} className="spin" /> : <ShieldAlert size={14} />}
          Rà soát trùng dữ liệu
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleAcceptAll} title="Chỉ duyệt các mục an toàn">
                <CheckCheck size={14} /> Duyệt nhanh an toàn
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
                ) : item.type === 'entity_resolution' ? (() => {
                  const resolution = parseCandidateOp(item.candidate_op);
                  const options = Array.isArray(resolution?.resolution_options) ? resolution.resolution_options : [];
                  const evidence = Array.isArray(resolution?.evidence) ? resolution.evidence : [];
                  const riskFlags = [
                    ...(Array.isArray(resolution?.risk_flags) ? resolution.risk_flags : []),
                    ...(Array.isArray(resolution?.protected_field_changes) ? resolution.protected_field_changes : []),
                  ];
                  const selectedValue = entityResolutionChoices[item.id]
                    || (resolution?.recommended_target_id ? String(resolution.recommended_target_id) : '__create_new__');
                  return (
                    <div className="si-card-body">
                      <div className="si-char-name">{item.target_name || resolution?.raw_name || '(Không rõ tên)'}</div>
                      <div className="si-fact-content">
                        {item.reasoning || 'Thực thể này mơ hồ, cần chọn gộp vào thực thể có sẵn hoặc tạo mới.'}
                      </div>
                      {(resolution?.canonical_name || resolution?.aliases?.length > 0 || resolution?.role_hint || resolution?.proposed_changes?.length > 0) && (
                        <div className="si-entity-details">
                          {resolution.canonical_name && <span>{`Tên chuẩn đề xuất: ${resolution.canonical_name}`}</span>}
                          {resolution.aliases?.length > 0 && <span>{`Bí danh: ${resolution.aliases.join(', ')}`}</span>}
                          {resolution.role_hint && <span>{`Vai trò gợi ý: ${resolution.role_hint}`}</span>}
                          {(resolution.proposed_changes || []).map((change) => (
                            <span key={`${item.id}:change:${change.field}`}>
                              {`${change.field}: ${change.value == null ? '(trống)' : String(change.value)}`}
                            </span>
                          ))}
                        </div>
                      )}
                      {evidence.length > 0 && (
                        <div className="si-evidence-list">
                          <span className="si-label">Bằng chứng</span>
                          {evidence.map((entry, index) => (
                            <blockquote key={`${item.id}:evidence:${entry.paragraph_id || index}`}>
                              {entry.quote}
                            </blockquote>
                          ))}
                        </div>
                      )}
                      {resolution?.critic && (
                        <div className={`si-critic si-critic--${resolution.critic.decision || 'review'}`}>
                          <span className="si-label">Phản biện AI</span>
                          <strong>{resolution.critic.decision === 'agree' ? 'Đồng ý' : resolution.critic.decision === 'disagree' ? 'Phản đối' : 'Cần xem lại'}</strong>
                          {resolution.critic.reasoning && <span>{resolution.critic.reasoning}</span>}
                        </div>
                      )}
                      {riskFlags.length > 0 && (
                        <div className="si-risk-flags">
                          {riskFlags.map((flag) => <span key={`${item.id}:risk:${flag}`}>{flag}</span>)}
                        </div>
                      )}
                      <select
                        className="select"
                        value={selectedValue}
                        onChange={(event) => setEntityResolutionChoices((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))}
                      >
                        {options.map((option) => (
                          <option key={`${item.id}:${option.entity_id}`} value={String(option.entity_id)}>
                            {`Gộp vào ${option.name} (${(option.score || 0).toFixed(2)})`}
                          </option>
                        ))}
                        <option value="__create_new__">Tạo thực thể mới</option>
                      </select>
                      {['protagonist', 'deuteragonist'].includes(resolution?.role_hint) && (
                        <label className="si-role-confirmation">
                          <input
                            type="checkbox"
                            checked={Boolean(entityRoleConfirmations[item.id])}
                            onChange={(event) => setEntityRoleConfirmations((current) => ({
                              ...current,
                              [item.id]: event.target.checked,
                            }))}
                          />
                          <span>{`Nếu tạo mới, xác nhận riêng vai trò ${resolution.role_hint}`}</span>
                        </label>
                      )}
                    </div>
                  );
                })() : item.type === 'entity_duplicate_review' ? (() => {
                  const resolution = parseCandidateOp(item.candidate_op) || {};
                  const options = Array.isArray(resolution.entity_options) ? resolution.entity_options : [];
                  const evidence = Array.isArray(resolution.evidence) ? resolution.evidence : [];
                  const preview = duplicatePreviews[item.id] || null;
                  const selectedValue = entityResolutionChoices[item.id]
                    || String(resolution.recommended_survivor_id || options[0]?.id || '');
                  return (
                    <div className="si-card-body">
                      <div className="si-char-name">{item.target_name}</div>
                      <div className="si-fact-content">{item.reasoning}</div>
                      {evidence.length > 0 && (
                        <div className="si-evidence-list">
                          <span className="si-label">Bằng chứng</span>
                          {evidence.map((entry, index) => (
                            <blockquote key={`${item.id}:duplicate-evidence:${entry.paragraph_id || index}`}>
                              {entry.quote}
                            </blockquote>
                          ))}
                        </div>
                      )}
                      <label className="si-label" htmlFor={`duplicate-survivor-${item.id}`}>Bản ghi giữ lại</label>
                      <select
                        id={`duplicate-survivor-${item.id}`}
                        className="select"
                        value={selectedValue}
                        onChange={(event) => {
                          setEntityResolutionChoices((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }));
                          setDuplicatePreviews((current) => ({ ...current, [item.id]: null }));
                        }}
                      >
                        {options.map((option) => (
                          <option key={`${item.id}:survivor:${option.id}`} value={String(option.id)}>{option.name}</option>
                        ))}
                      </select>
                      {resolution.critic && (
                        <div className={`si-critic si-critic--${resolution.critic.decision || 'review'}`}>
                          <span className="si-label">Phản biện AI</span>
                          <strong>{resolution.critic.decision === 'agree' ? 'Đồng ý' : resolution.critic.decision === 'disagree' ? 'Phản đối' : 'Cần xem lại'}</strong>
                          {resolution.critic.reasoning && <span>{resolution.critic.reasoning}</span>}
                        </div>
                      )}
                      <div className="si-risk-flags">
                        {(resolution.risk_flags || []).map((flag) => <span key={`${item.id}:${flag}`}>{flag}</span>)}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={duplicatePreviewLoading[item.id]}
                        onClick={() => loadDuplicatePreview(item, resolution).catch((error) => {
                          setInfo(toVietnameseErrorMessage(error, 'Không thể tạo bản xem trước gộp.'), 'error');
                        })}
                      >
                        {duplicatePreviewLoading[item.id] ? <Loader size={14} className="spin" /> : <ShieldAlert size={14} />}
                        Xem trước gộp
                      </button>
                      {preview && (
                        <div className="si-merge-preview">
                          <strong>{`Giữ ${preview.survivor.name}, gộp ${preview.duplicate.name}`}</strong>
                          <span>{`${preview.reference_count} tham chiếu sẽ được viết lại`}</span>
                          {Object.entries(preview.reference_counts || {}).map(([table, count]) => (
                            <span key={`${item.id}:preview-ref:${table}`}>{`${table}: ${count}`}</span>
                          ))}
                          {(preview.field_changes || []).map((change) => (
                            <span key={`${item.id}:preview-field:${change.field}`}>{change.field}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })() : item.type === 'canon_op_review' ? (() => {
                  const op = parseCandidateOp(item.candidate_op) || {};
                  const target = getCanonReviewTarget(item, op);
                  const summary = getCanonReviewSummary(item, op);
                  const evidence = getCanonReviewEvidence(item, op);
                  return (
                    <div className="si-card-body si-canon-review">
                      <div className="si-review-topline">
                        <span className="si-canon-op-chip">{getCanonOpLabel(op.op_type)}</span>
                        {op.op_type && <span className="si-canon-op-code">{op.op_type}</span>}
                      </div>
                      <div className="si-review-target">
                        <span className="si-label">Đối tượng</span>
                        <span>{target || '(chưa rõ)'}</span>
                      </div>
                      <div className="si-review-summary">{summary}</div>
                      {evidence && (
                        <div className="si-evidence">
                          <span className="si-label">Bằng chứng</span>
                          <span>{evidence}</span>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div className="si-card-body">
                    <div className="si-fact-content">{item.suggested_value}</div>
                  </div>
                )}

                {item.reasoning && item.type !== 'canon_op_review' && (
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
                      : item.type === 'entity_resolution'
                        ? `${item.target_name || 'Thực thể'}: ${item.suggested_value || item.reasoning}`
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
