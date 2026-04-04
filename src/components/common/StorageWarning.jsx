import React, { useEffect, useState } from 'react';
import { getStorageInfo, formatBytes, isStorageLow } from '../../services/db/storage';
import { AlertTriangle, HardDrive, X } from 'lucide-react';

export default function StorageWarning() {
  const [dismissed, setDismissed] = useState(false);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const [storageInfo, lowStatus] = await Promise.all([
        getStorageInfo(),
        isStorageLow(),
      ]);
      if (cancelled) return;

      setInfo({ ...storageInfo, ...lowStatus });
    }

    check();
    return () => { cancelled = true; };
  }, []);

  if (!info || dismissed) return null;

  const { usage, quota, persisted, low } = info;
  const usageMB = usage ? (usage / 1024 / 1024).toFixed(1) : null;
  const quotaMB = quota ? (quota / 1024 / 1024).toFixed(0) : null;
  const percentUsed = quota > 0 ? Math.round((usage / quota) * 100) : null;

  // Only show critical warning when storage is actually low
  if (!low && percentUsed !== null && percentUsed < 50) return null;

  const isCritical = !persisted || low;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        maxWidth: 360,
        background: isCritical ? 'var(--color-danger, #ef4444)' : 'var(--color-warning, #f59e0b)',
        color: '#fff',
        borderRadius: 10,
        padding: '12px 14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        fontFamily: 'var(--font-ui, inherit)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {!persisted
              ? 'Lưu trữ tạm — giới hạn ~50MB'
              : 'Dung lượng lưu trữ sắp đầy'}
          </div>

          {persisted && quota > 0 && (
            <>
              <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 4 }}>
                Đã dùng: {usageMB} MB / {quotaMB} MB ({percentUsed}%)
              </div>
              <div style={{
                height: 6,
                background: 'rgba(255,255,255,0.25)',
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 6,
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(percentUsed, 100)}%`,
                  background: '#fff',
                  borderRadius: 3,
                }} />
              </div>
            </>
          )}

          {!persisted && (
            <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
              Dung lượng hiện tại bị giới hạn ~50MB. Bạn cần cấp quyền lưu trữ vĩnh viễn để mở rộng lên 200MB+.
            </div>
          )}

          <div style={{ fontSize: 11, opacity: 0.8 }}>
            {!persisted
              ? 'Nhấn "Cho phép" khi trình duyệt yêu cầu để mở rộng lưu trữ.'
              : low
                ? 'Hãy xuất (export) dự án cũ ra file hoặc xóa dữ liệu không cần thiết.'
                : 'Bạn có thể yên tâm viết tiếp.'}
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.8)',
            cursor: 'pointer',
            padding: 2,
            flexShrink: 0,
            lineHeight: 1,
          }}
          title="Đóng"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
