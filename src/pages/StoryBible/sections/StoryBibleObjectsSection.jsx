import React from 'react';
import { Package } from 'lucide-react';
import ObjectDraftCard from '../components/ObjectDraftCard';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';

const StoryBibleObjectsSection = React.memo(function StoryBibleObjectsSection({
  objects,
  objectDrafts,
  characters,
  isOpen,
  onToggle,
  onNavigate,
  onDraftChange,
}) {
  if (objects.length === 0) return null;

  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={Package}
        title="Vật phẩm"
        count={objects.length}
        sectionKey="objects"
        isOpen={isOpen}
        onToggle={onToggle}
        navTo="/world"
        onNavigate={onNavigate}
      />
      {isOpen && (
        <div className="bible-grid">
          {objects.map((objectItem) => (
            <ObjectDraftCard
              key={objectItem.id}
              objectItem={objectItem}
              draft={objectDrafts[objectItem.id] || objectItem}
              characters={characters}
              onChange={onDraftChange}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default StoryBibleObjectsSection;
