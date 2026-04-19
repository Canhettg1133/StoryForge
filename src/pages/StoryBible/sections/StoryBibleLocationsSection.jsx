import React from 'react';
import { MapPin } from 'lucide-react';
import LocationDraftCard from '../components/LocationDraftCard';
import StoryBibleSectionHeader from '../components/StoryBibleSectionHeader';

const StoryBibleLocationsSection = React.memo(function StoryBibleLocationsSection({
  locations,
  locationDrafts,
  isOpen,
  onToggle,
  onNavigate,
  onDraftChange,
}) {
  if (locations.length === 0) return null;

  return (
    <div className="bible-section">
      <StoryBibleSectionHeader
        icon={MapPin}
        title="Địa điểm"
        count={locations.length}
        sectionKey="locations"
        isOpen={isOpen}
        onToggle={onToggle}
        navTo="/world"
        onNavigate={onNavigate}
      />
      {isOpen && (
        <div className="bible-grid">
          {locations.map((location) => (
            <LocationDraftCard
              key={location.id}
              location={location}
              draft={locationDrafts[location.id] || location}
              onChange={onDraftChange}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default StoryBibleLocationsSection;
