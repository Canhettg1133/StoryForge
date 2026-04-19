import React from 'react';
import { FileText } from 'lucide-react';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';

const StoryBibleSummariesSection = React.memo(function StoryBibleSummariesSection({
  chapterMetas,
  chapters,
  isOpen,
  onToggle,
}) {
  if (chapterMetas.length === 0) return null;

  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={FileText}
        title="Tóm tắt chương"
        sectionKey="summaries"
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen && (
        <div className="bible-summaries">
          {chapters.map((chapter, index) => {
            const meta = chapterMetas.find((item) => item.chapter_id === chapter.id);
            if (!meta?.summary) return null;
            return (
              <div key={chapter.id} className="bible-summary-item">
                <strong>{chapter.title || `Chương ${index + 1}`}</strong>
                <p>{meta.summary}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default StoryBibleSummariesSection;
