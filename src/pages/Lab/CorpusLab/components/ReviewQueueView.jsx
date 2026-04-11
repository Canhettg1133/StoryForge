import { useMemo } from 'react';
import ReviewQueueCard from './ReviewQueueCard.jsx';

export default function ReviewQueueView({
  items = [],
  filter = 'all',
  onFilterChange,
  onResolve,
  onRerun,
}) {
  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'needs_review') return items.filter((item) => item.status === 'pending');
    return items.filter((item) => item.priority === filter);
  }, [filter, items]);

  const stats = useMemo(() => ({
    total: items.length,
    P0: items.filter((item) => item.priority === 'P0').length,
    P1: items.filter((item) => item.priority === 'P1').length,
    P2: items.filter((item) => item.priority === 'P2').length,
    pending: items.filter((item) => item.status === 'pending').length,
  }), [items]);

  return (
    <section className="review-queue-view">
      <header className="review-queue-toolbar">
        <button
          type="button"
          className={filter === 'all' ? 'active' : ''}
          onClick={() => onFilterChange?.('all')}
        >
          Tất cả ({stats.total})
        </button>
        <button
          type="button"
          className={`priority P0 ${filter === 'P0' ? 'active' : ''}`}
          onClick={() => onFilterChange?.('P0')}
        >
          P0 ({stats.P0})
        </button>
        <button
          type="button"
          className={`priority P1 ${filter === 'P1' ? 'active' : ''}`}
          onClick={() => onFilterChange?.('P1')}
        >
          P1 ({stats.P1})
        </button>
        <button
          type="button"
          className={`priority P2 ${filter === 'P2' ? 'active' : ''}`}
          onClick={() => onFilterChange?.('P2')}
        >
          P2 ({stats.P2})
        </button>
        <button
          type="button"
          className={filter === 'needs_review' ? 'active' : ''}
          onClick={() => onFilterChange?.('needs_review')}
        >
          Chờ duyệt ({stats.pending})
        </button>
      </header>

      <div className="review-queue-list">
        {filteredItems.length === 0 && (
          <div className="review-queue-empty">
            <h3>Không có mục review</h3>
            <p>Bộ lọc hiện tại không có kết quả.</p>
          </div>
        )}

        {filteredItems.map((item, index) => (
          <ReviewQueueCard
            key={item.id}
            item={item}
            rank={index + 1}
            onResolve={onResolve}
            onRerun={onRerun}
          />
        ))}
      </div>
    </section>
  );
}
