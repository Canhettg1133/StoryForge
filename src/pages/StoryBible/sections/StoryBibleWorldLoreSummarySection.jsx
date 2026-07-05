import React from 'react';
import { BookOpen, ChevronRight, Globe, MapPin, Package } from 'lucide-react';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';

const WORLD_LORE_ITEMS = [
  { key: 'locations', label: 'Địa điểm', icon: MapPin },
  { key: 'objects', label: 'Vật phẩm', icon: Package },
  { key: 'terms', label: 'Thuật ngữ', icon: BookOpen },
];

const StoryBibleWorldLoreSummarySection = React.memo(function StoryBibleWorldLoreSummarySection({
  counts = {},
  isOpen,
  onToggle,
  onNavigate,
}) {
  const normalizedCounts = {
    locations: Number(counts.locations || 0),
    objects: Number(counts.objects || 0),
    terms: Number(counts.terms || 0),
  };
  const totalCount = normalizedCounts.locations + normalizedCounts.objects + normalizedCounts.terms;

  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={Globe}
        title="Thế giới & Lore"
        count={totalCount}
        sectionKey="worldLore"
        isOpen={isOpen}
        onToggle={onToggle}
        actions={(
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate?.('/world');
            }}
          >
            Mở Thế giới <ChevronRight size={14} />
          </button>
        )}
      />
      {isOpen && (
        <div className="bible-world-summary">
          <div className="bible-world-summary__grid">
            {WORLD_LORE_ITEMS.map(({ key, label, icon: Icon }) => (
              <div key={key} className="bible-world-summary__item">
                <span className="bible-world-summary__icon">
                  <Icon size={16} />
                </span>
                <span className="bible-world-summary__label">{label}</span>
                <strong>{normalizedCounts[key]}</strong>
              </div>
            ))}
          </div>
          <p className="bible-world-summary__hint">
            Quản lý địa điểm, vật phẩm và thuật ngữ ở trang Thế giới để Story Bible luôn gọn và nhẹ.
          </p>
        </div>
      )}
    </div>
  );
});

export default StoryBibleWorldLoreSummarySection;
