/**
 * SelectionPanel - Selected items panel for analysis viewer
 */

import { useEffect, useState } from 'react';

const QUICK_SELECT_BUTTONS = [
  {
    id: 'rare',
    label: '⭐ Hiếm',
    type: 'rarity',
    value: 'rare',
    title: 'Chọn tất cả sự kiện hiếm',
  },
  {
    id: 'crucial',
    label: '🎯 Cốt lõi',
    type: 'severity',
    value: 'crucial',
    title: 'Chọn tất cả sự kiện cốt lõi',
  },
  {
    id: 'angst',
    label: '💔 Angst',
    type: 'tag',
    value: 'angst',
    title: 'Chọn tất cả sự kiện có tag angst',
  },
  {
    id: 'canon',
    label: '🔵 Chính sử',
    type: 'canonFanon',
    value: 'canon',
    title: 'Chọn tất cả sự kiện chính sử',
  },
  {
    id: 'fanon',
    label: '🟣 Phi chính sử',
    type: 'canonFanon',
    value: 'fanon',
    title: 'Chọn tất cả sự kiện phi chính sử',
  },
  {
    id: 'highIntensity',
    label: '🔥 Cường độ 8+',
    type: 'intensity',
    value: 8,
    title: 'Chọn sự kiện cường độ cao (8+)',
  },
  {
    id: 'autoAccepted',
    label: '✅ Tự động nhận',
    type: 'reviewStatus',
    value: 'auto_accepted',
    title: 'Chọn các sự kiện đủ chất lượng để tự động chấp nhận',
  },
  {
    id: 'needsReview',
    label: '⚠️ Cần duyệt',
    type: 'reviewStatus',
    value: 'needs_review',
    title: 'Chọn các sự kiện cần duyệt thủ công',
  },
  {
    id: 'annotated',
    label: '📝 Có ghi chú',
    type: 'hasAnnotation',
    value: true,
    title: 'Chọn tất cả sự kiện có ghi chú',
  },
  {
    id: 'starred',
    label: '⭐ Đã sao',
    type: 'starred',
    value: true,
    title: 'Chọn tất cả sự kiện đã đánh sao',
  },
];

export default function SelectionPanel({
  selectedItems,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  onQuickSelect,
  quickSelectCounts = {},
  onExport,
  totalCount,
}) {
  const severityLabels = {
    crucial: 'Cốt lõi',
    major: 'Quan trọng',
    moderate: 'Trung bình',
    minor: 'Nhẹ',
  };

  const [quickToast, setQuickToast] = useState(null);

  useEffect(() => {
    if (!quickToast) return undefined;
    const timer = setTimeout(() => setQuickToast(null), 2200);
    return () => clearTimeout(timer);
  }, [quickToast]);

  const handleQuickSelect = (button) => {
    const result = onQuickSelect?.(button.type, button.value);
    if (!result) return;

    const { matchedCount = 0, addedCount = 0 } = result;

    if (matchedCount === 0) {
      setQuickToast({
        kind: 'warning',
        message: `Không có sự kiện phù hợp cho "${button.label}".`,
      });
      return;
    }

    if (addedCount === 0) {
      setQuickToast({
        kind: 'info',
        message: `Không thêm mới. Có ${matchedCount} sự kiện phù hợp đã được chọn.`,
      });
      return;
    }

    setQuickToast({
      kind: 'success',
      message: `Đã thêm ${addedCount} sự kiện (${matchedCount} phù hợp).`,
    });
  };

  if (selectedItems.length === 0) {
    return (
      <div className="selection-panel empty">
        <div className="selection-panel-header">
          <h4>Đã chọn</h4>
          <span className="selection-count">0</span>
        </div>
        <p className="selection-empty-hint">
          Chọn checkbox ở từng sự kiện để xuất hoặc thao tác hàng loạt.
        </p>
      </div>
    );
  }

  return (
    <div className="selection-panel">
      <div className="selection-panel-header">
        <h4>Đã chọn ({selectedItems.length})</h4>
        <div className="selection-actions-header">
          <button className="selection-action-link" onClick={onClear}>
            Bỏ chọn tất cả
          </button>
        </div>
      </div>

      {/* Quick select buttons */}
      <div className="quick-select-section">
        {quickToast && (
          <div className={`quick-select-toast ${quickToast.kind}`} role="status" aria-live="polite">
            {quickToast.message}
          </div>
        )}

        <div className="quick-select-grid">
          {QUICK_SELECT_BUTTONS.map((button) => {
            const count = quickSelectCounts[button.id] || 0;
            return (
              <button
                key={button.id}
                className="quick-select-btn"
                onClick={() => handleQuickSelect(button)}
                title={button.title}
              >
                <span className="quick-select-label">{button.label}</span>
                <span className={`quick-select-count ${count === 0 ? 'empty' : ''}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Batch operations */}
      <div className="batch-ops-section">
        <button
          className="batch-op-btn"
          onClick={() => onExport('project')}
        >
          ➕ Thêm vào dự án
        </button>
        <button
          className="batch-op-btn"
          onClick={() => onExport('library')}
        >
          📚 Lưu vào thư viện
        </button>
      </div>

      {/* Selected list */}
      <div className="selected-list">
        {selectedItems.slice(0, 20).map((item) => (
          <div key={item.id} className="selected-item">
            <input
              type="checkbox"
              checked={true}
              onChange={() => onToggle(item.id)}
              aria-label="Bỏ chọn"
            />
            <span className="selected-item-info">
              <span className="selected-item-name">
                {item.description?.substring(0, 40) || 'Chưa có tiêu đề'}
                {(item.description?.length || 0) > 40 ? '...' : ''}
              </span>
              <span className="selected-item-meta">
                {severityLabels[item.severity] || item.severity} · Ch.{formatChapter(item.chapter)}
              </span>
            </span>
          </div>
        ))}
        {selectedItems.length > 20 && (
          <div className="selected-overflow">
            +{selectedItems.length - 20} mục khác
          </div>
        )}
      </div>

      {/* Export options */}
      <div className="export-section">
        <h5>Xuất dữ liệu</h5>
        <div className="export-buttons">
          <button onClick={() => onExport('clipboard')}>
            📋 Sao chép
          </button>
          <button onClick={() => onExport('markdown')}>
            📝 Markdown
          </button>
          <button onClick={() => onExport('json')}>
            📄 JSON
          </button>
          <button onClick={() => onExport('csv')}>
            📊 CSV
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
