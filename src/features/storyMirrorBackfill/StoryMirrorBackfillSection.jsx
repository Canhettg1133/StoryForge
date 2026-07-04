import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, CloudUpload, Database, RefreshCw } from 'lucide-react';
import {
  STORY_MIRROR_BACKFILL_EVENT,
  readStoryMirrorBackfillStatus,
  runStoryMirrorBackfill,
} from '../../services/storyMirror/backfill.js';
import { isStoryMirrorEnabled } from '../../services/storyMirror/config.js';
import { isCloudAuthConfigured } from '../../services/cloud/cloudAuthService.js';
import './StoryMirrorBackfillSection.css';

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function formatStatusText(status, reason) {
  if (!isStoryMirrorEnabled()) return 'Chưa bật trên bản build này';
  if (!isCloudAuthConfigured()) return 'Tạm dừng do Supabase Auth chưa được cấu hình';
  if (status === 'scanning') return 'Đang quét';
  if (status === 'completed') return 'Hoàn tất';
  if (status === 'paused') {
    if (reason === 'STORY_MIRROR_TEST_ONLY') return 'Tạm dừng do tài khoản chưa được bật';
    if (reason === 'STORY_MIRROR_QUOTA_EXCEEDED') return 'Tạm dừng do hết dung lượng';
    if (reason === 'STORY_MIRROR_AUTH_REQUIRED') return 'Tạm dừng do chưa đăng nhập';
    return 'Tạm dừng';
  }
  if (status === 'failed') return 'Có lỗi, có thể thử lại';
  return 'Chưa chạy';
}

function getStatusTone(status) {
  if (!isStoryMirrorEnabled() || !isCloudAuthConfigured()) return 'muted';
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'paused') return 'warning';
  if (status === 'scanning') return 'info';
  return 'muted';
}

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle size={18} />;
  if (status === 'failed' || status === 'paused') return <AlertTriangle size={18} />;
  if (status === 'scanning') return <RefreshCw size={18} className="animate-spin" />;
  return <Database size={18} />;
}

export default function StoryMirrorBackfillSection() {
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let mounted = true;
    readStoryMirrorBackfillStatus().then((nextStatus) => {
      if (mounted) setStatus(nextStatus);
    });

    const handleStatus = (event) => setStatus(event.detail);
    window.addEventListener(STORY_MIRROR_BACKFILL_EVENT, handleStatus);
    const timer = window.setInterval(() => {
      readStoryMirrorBackfillStatus().then((nextStatus) => {
        if (mounted) setStatus(nextStatus);
      });
    }, 3000);

    return () => {
      mounted = false;
      window.removeEventListener(STORY_MIRROR_BACKFILL_EVENT, handleStatus);
      window.clearInterval(timer);
    };
  }, []);

  const tone = getStatusTone(status?.status);
  const statusText = useMemo(
    () => formatStatusText(status?.status, status?.reason),
    [status?.status, status?.reason],
  );

  const handleRun = async () => {
    setRunning(true);
    try {
      const result = await runStoryMirrorBackfill({ force: true, reason: 'settings' });
      setStatus(result);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="settings-section card animate-slide-up story-mirror-backfill" id="story-mirror-backfill">
      <div className="settings-section-header story-mirror-backfill__header">
        <CloudUpload size={20} />
        <div>
          <h2>Đồng bộ truyện cũ</h2>
          <p>Quét truyện đang nằm trên máy này và xếp hàng gửi bản mới nhất lên Kho truyện. Editor vẫn lưu local trước như bình thường.</p>
        </div>
      </div>

      <div className="story-mirror-backfill__body">
        <div className={`story-mirror-backfill__status story-mirror-backfill__status--${tone}`}>
          <StatusIcon status={status?.status} />
          <div>
            <strong>{statusText}</strong>
            {status?.lastError ? <span>{status.lastError}</span> : <span>Chỉ gửi nội dung truyện, không gửi prompt, bản dịch hoặc chat.</span>}
          </div>
        </div>

        <div className="story-mirror-backfill__metrics" aria-label="Thống kê đồng bộ truyện cũ">
          <span>Đã quét: <strong>{formatNumber(status?.scannedCount)}</strong></span>
          <span>Đã xếp hàng: <strong>{formatNumber(status?.queuedCount)}</strong></span>
          <span>Bỏ qua: <strong>{formatNumber(status?.skippedCount)}</strong></span>
        </div>

        <div className="story-mirror-backfill__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRun}
            disabled={running || status?.status === 'scanning' || !isStoryMirrorEnabled() || !isCloudAuthConfigured()}
          >
            {running || status?.status === 'scanning' ? <RefreshCw size={14} className="animate-spin" /> : <CloudUpload size={14} />}
            {status?.status === 'completed' || status?.status === 'failed' || status?.status === 'paused'
              ? 'Thử lại'
              : 'Chạy đồng bộ truyện cũ'}
          </button>
        </div>
      </div>
    </section>
  );
}
