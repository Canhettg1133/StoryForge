import React from 'react';
import { Users } from 'lucide-react';
import CharacterDraftCard from '../components/CharacterDraftCard';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';

const StoryBibleCharactersSection = React.memo(function StoryBibleCharactersSection({
  characters,
  characterDrafts,
  isOpen,
  onToggle,
  onNavigate,
  onDraftChange,
}) {
  if (characters.length === 0) return null;

  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={Users}
        title="Nhân vật"
        count={characters.length}
        sectionKey="characters"
        isOpen={isOpen}
        onToggle={onToggle}
        navTo="/characters"
        onNavigate={onNavigate}
      />
      {isOpen && (
        <div className="bible-grid">
          {characters.map((character) => (
            <CharacterDraftCard
              key={character.id}
              character={character}
              draft={characterDrafts[character.id] || character}
              onChange={onDraftChange}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default StoryBibleCharactersSection;
