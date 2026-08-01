import React, { useEffect, useMemo, useState } from 'react';
import {
  getChapterRevisionDetail,
  getChapterRevisionHistory,
} from '../../services/canon/queries';

const OP_TYPE_LABELS = {
  CHARACTER_STATUS_CHANGED: 'Đổi trạng thái nhân vật',
  CHARACTER_LOCATION_CHANGED: 'Đổi vị trí nhân vật',
  CHARACTER_RESCUED: 'Nhân vật được cứu',
  CHARACTER_DIED: 'Nhân vật tử vong',
  SECRET_REVEALED: 'Tiết lộ bí mật',
  GOAL_CHANGED: 'Đổi mục tiêu',
  ALLEGIANCE_CHANGED: 'Đổi phe',
  THREAD_OPENED: 'Mở tuyến truyện',
  THREAD_PROGRESS: 'Tiến triển tuyến truyện',
  THREAD_RESOLVED: 'Hoàn thành tuyến truyện',
  FACT_REGISTERED: 'Ghi nhận sự thật',
  OBJECT_ACQUIRED: 'Nhận vật phẩm',
  OBJECT_STATUS_CHANGED: 'Đổi trạng thái vật phẩm',
  OBJECT_TRANSFERRED: 'Chuyển vật phẩm',
  OBJECT_CONSUMED: 'Dùng hết vật phẩm',
  OBJECT_LOST: 'Mất vật phẩm',
  OBJECT_FOUND: 'Tìm thấy vật phẩm',
  OBJECT_RESTORED: 'Sửa hoặc khôi phục vật phẩm',
  OBJECT_PARTIALLY_CONSUMED: 'Tiêu hao một phần vật phẩm',
  OBJECT_SPENT: 'Tiêu hao vật phẩm',
  OBJECT_RETURNED: 'Trả lại vật phẩm',
  RELATIONSHIP_STATUS_CHANGED: 'Đổi trạng thái quan hệ',
  RELATIONSHIP_SECRET_CHANGED: 'Đổi mức bí mật quan hệ',
  INTIMACY_LEVEL_CHANGED: 'Đổi mức độ thân mật',
};

const REPORT_SEVERITY_LABELS = {
  error: 'Lỗi',
  warning: 'Cảnh báo',
  info: 'Thông tin',
};

function formatRevisionTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function revisionBadge(revision) {
  if (revision?.is_canonical) return 'Canon hiện tại';
  if (revision?.status === 'blocked') return 'Bị chặn';
  if (revision?.status === 'invalidated') return 'Đã mất hiệu lực';
  return 'Phiên bản cũ';
}

function eventFallbackSummary(event) {
  return [
    event.subject_name,
    event.target_name,
    event.object_name,
    event.location_name,
    event.thread_title,
    event.fact_description,
  ].filter(Boolean).join(' · ');
}

export default function ChapterChangeHistory({ projectId, chapterId, refreshKey = '' }) {
  const [history, setHistory] = useState(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    setLoadingHistory(true);
    setHistory(null);
    setDetail(null);
    setSelectedRevisionId(null);
    setError('');

    getChapterRevisionHistory(projectId, chapterId)
      .then((result) => {
        if (cancelled) return;
        const revisions = result?.revisions || [];
        const preferredRevisionId = result?.commit?.current_revision_id;
        const selected = revisions.find((revision) => revision.id === preferredRevisionId)
          || revisions[0]
          || null;
        setHistory(result || { revisions: [] });
        setSelectedRevisionId(selected?.id ?? null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('[ChapterChangeHistory] Failed to load revision history:', loadError);
        setError('Không thể đọc lịch sử thay đổi của chương này.');
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, chapterId, refreshKey]);

  useEffect(() => {
    if (selectedRevisionId == null) return undefined;
    let cancelled = false;

    setLoadingDetail(true);
    setDetail(null);
    setError('');
    getChapterRevisionDetail(projectId, selectedRevisionId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError('Phiên bản thay đổi này không còn tồn tại.');
          return;
        }
        setDetail(result);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('[ChapterChangeHistory] Failed to load revision detail:', loadError);
        setError('Không thể đọc chi tiết phiên bản thay đổi này.');
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedRevisionId]);

  const revisions = history?.revisions || [];
  const revision = detail?.revision || revisions.find((item) => item.id === selectedRevisionId) || null;
  const isCurrentCanon = Boolean(revision?.is_canonical);
  const committedCount = Number(revision?.committed_count ?? detail?.events?.length ?? 0);
  const extractedCount = Number(revision?.extracted_count || 0);
  const filteredCount = Number(revision?.filtered_count || 0);
  const extractionAttemptCount = Number(revision?.extraction_attempt_count || 0);
  const extractionSucceeded = revision?.extraction_status === 'succeeded';
  const events = detail?.events || [];
  const evidence = detail?.evidence || [];
  const reports = detail?.reports || [];

  const completionSummary = useMemo(() => {
    if (!revision) return '';
    if (!isCurrentCanon) {
      if (revision.status === 'blocked') {
        return 'Phiên bản này bị chặn và không có thay đổi nào được áp dụng vào canon.';
      }
      return `${events.length} thay đổi thuộc phiên bản cũ; chúng không được trình bày như canon hiện tại.`;
    }
    if (extractionSucceeded && extractedCount === 0) {
      return 'Đã phân tích và không có thay đổi canon mới.';
    }
    if (committedCount === 0) {
      return 'Đã phân tích; không có thay đổi canon mới được áp dụng.';
    }
    return `${committedCount} thay đổi đã áp dụng`;
  }, [committedCount, events.length, extractedCount, extractionSucceeded, isCurrentCanon, revision]);

  if (loadingHistory) {
    return <div className="chapter-change-history-state" role="status">Đang tải lịch sử thay đổi...</div>;
  }

  if (error && !history) {
    return <div className="chapter-change-history-state chapter-change-history-state--error" role="alert">{error}</div>;
  }

  if (revisions.length === 0) {
    return (
      <div className="chapter-change-history-state">
        Chương này chưa có lịch sử hoàn thành.
      </div>
    );
  }

  return (
    <section className="chapter-change-history" aria-label="Lịch sử thay đổi canon của chương">
      <div className="chapter-change-history-toolbar">
        <label className="chapter-change-history-select-label">
          Phiên bản
          <select
            aria-label="Chọn phiên bản thay đổi"
            value={selectedRevisionId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              const numericValue = Number(value);
              setSelectedRevisionId(Number.isNaN(numericValue) ? value : numericValue);
            }}
          >
            {revisions.map((item) => (
              <option key={item.id} value={item.id}>
                Lần {item.revision_number || item.id}
                {item.is_current ? ' · mới nhất' : ''}
                {item.created_at ? ` · ${formatRevisionTime(item.created_at)}` : ''}
              </option>
            ))}
          </select>
        </label>
        {revision && (
          <span className={`chapter-change-history-badge chapter-change-history-badge--${isCurrentCanon ? 'current' : 'old'}`}>
            {revisionBadge(revision)}
          </span>
        )}
        {revision?.extraction_retried && (
          <span className="chapter-change-history-badge chapter-change-history-badge--retry">
            {revision.extraction_status === 'succeeded'
              ? 'Đã tự sửa phản hồi AI'
              : 'Đã thử sửa phản hồi AI'}
          </span>
        )}
      </div>

      {loadingDetail ? (
        <div className="chapter-change-history-state" role="status">Đang tải chi tiết phiên bản...</div>
      ) : error ? (
        <div className="chapter-change-history-state chapter-change-history-state--error" role="alert">{error}</div>
      ) : detail && (
        <div className="chapter-change-history-content">
          <p className="chapter-change-history-summary">{completionSummary}</p>
          <div className="chapter-change-history-metrics" aria-label="Số liệu phân tích canon">
            <span>{extractedCount} trích xuất</span>
            <span>{filteredCount} bị lọc</span>
            {extractionAttemptCount > 0 && <span>{extractionAttemptCount} lượt AI</span>}
          </div>

          {events.length > 0 && (
            <div className="chapter-change-history-section">
              <h4>{isCurrentCanon ? 'Thay đổi đã áp dụng' : 'Thay đổi của phiên bản này'}</h4>
              <div className="chapter-change-history-events">
                {events.map((event) => (
                  <article className="chapter-change-history-event" key={event.id}>
                    <div className="chapter-change-history-event-type">
                      {OP_TYPE_LABELS[event.op_type] || event.op_type || 'Thay đổi canon'}
                    </div>
                    <p>{event.summary || eventFallbackSummary(event) || 'Không có mô tả bổ sung.'}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {evidence.length > 0 && (
            <div className="chapter-change-history-section">
              <h4>Bằng chứng trong cảnh</h4>
              <ul className="chapter-change-history-evidence">
                {evidence.map((item) => (
                  <li key={item.id}>{item.evidence_text || item.summary || 'Không có trích dẫn bằng chứng.'}</li>
                ))}
              </ul>
            </div>
          )}

          {reports.length > 0 && (
            <div className="chapter-change-history-section chapter-change-history-section--reports">
              <h4>Bị lọc và cảnh báo</h4>
              <div className="chapter-change-history-reports">
                {reports.map((report) => (
                  <article
                    className={`chapter-change-history-report chapter-change-history-report--${report.severity || 'info'}`}
                    key={report.id}
                  >
                    <strong>{REPORT_SEVERITY_LABELS[report.severity] || 'Thông tin'}</strong>
                    <p>{report.message}</p>
                    {(report.evidence || report.evidence_text) && (
                      <blockquote>{report.evidence || report.evidence_text}</blockquote>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
