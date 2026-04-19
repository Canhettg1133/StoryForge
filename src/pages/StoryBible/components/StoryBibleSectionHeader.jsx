import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const StoryBibleSectionHeader = React.memo(function StoryBibleSectionHeader({
  icon: Icon,
  title,
  count,
  sectionKey,
  isOpen,
  onToggle,
  navTo,
  onNavigate,
  actions = null,
}) {
  return (
    <div className="bible-section-header" onClick={() => onToggle(sectionKey)} style={{ cursor: 'pointer' }}>
      <h3 className="bible-section-title">
        <ChevronDown
          size={14}
          style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }}
        />
        {Icon && <Icon size={18} />} {title} {count !== undefined && `(${count})`}
      </h3>
      {actions || (navTo ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(event) => {
            event.stopPropagation();
            onNavigate?.(navTo);
          }}
        >
          Quản lý <ChevronRight size={14} />
        </button>
      ) : null)}
    </div>
  );
});

export default StoryBibleSectionHeader;
