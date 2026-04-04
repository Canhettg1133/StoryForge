import React from 'react';
import CorpusCard from './CorpusCard';

export default function CorpusList({
  corpuses = [],
  total = 0,
  selectedId,
  loading,
  filters,
  onFilterChange,
  onSelect,
  onDelete,
}) {
  return (
    <div className="corpus-card corpus-list">
      <div className="corpus-list-header">
        <h3>Danh sách corpus</h3>
        <span>{Number(total || 0).toLocaleString('vi-VN')} mục</span>
      </div>

      <div className="corpus-filters">
        <input
          type="text"
          placeholder="Tìm theo tiêu đề/tác giả/tên file..."
          value={filters.search || ''}
          onChange={(event) => onFilterChange?.({ search: event.target.value })}
        />

        <select
          value={filters.status || ''}
          onChange={(event) => onFilterChange?.({ status: event.target.value })}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="uploaded">Đã tải lên</option>
          <option value="parsed">Đã tách chương</option>
          <option value="analyzing">Đang phân tích</option>
          <option value="analyzed">Đã phân tích xong</option>
        </select>

        <input
          type="text"
          placeholder="Lọc theo fandom"
          value={filters.fandom || ''}
          onChange={(event) => onFilterChange?.({ fandom: event.target.value })}
        />
      </div>

      {loading && <p className="muted">Đang tải danh sách corpus...</p>}

      {!loading && corpuses.length === 0 && <p className="muted">Chưa có corpus nào.</p>}

      <div className="corpus-list-items">
        {corpuses.map((corpus) => (
          <CorpusCard
            key={corpus.id}
            corpus={corpus}
            active={selectedId === corpus.id}
            onOpen={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
