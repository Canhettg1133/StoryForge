import React from 'react';
import { BookOpen } from 'lucide-react';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';
import WorldTermDraftCard from '../components/WorldTermDraftCard';

const StoryBibleTermsSection = React.memo(function StoryBibleTermsSection({
  worldTerms,
  worldTermDrafts,
  isOpen,
  onToggle,
  onNavigate,
  onDraftChange,
}) {
  if (worldTerms.length === 0) return null;

  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={BookOpen}
        title="Thuật ngữ"
        count={worldTerms.length}
        sectionKey="terms"
        isOpen={isOpen}
        onToggle={onToggle}
        navTo="/world"
        onNavigate={onNavigate}
      />
      {isOpen && (
        <div className="bible-grid bible-grid--terms">
          {worldTerms.map((term) => (
            <WorldTermDraftCard
              key={term.id}
              term={term}
              draft={worldTermDrafts[term.id] || term}
              onChange={onDraftChange}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default StoryBibleTermsSection;
