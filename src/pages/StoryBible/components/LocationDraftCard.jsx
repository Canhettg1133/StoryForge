import React from 'react';

const LocationDraftCard = React.memo(function LocationDraftCard({ location, draft, onChange }) {
  return (
    <div className="bible-card bible-card--editable">
      <input className="input input-inline input-bold" value={draft.name} placeholder="Tên" onChange={(event) => onChange(location.id, 'name', event.target.value)} />
      <input className="input input-inline" value={draft.description || ''} placeholder="Mô tả" onChange={(event) => onChange(location.id, 'description', event.target.value)} />
      <input className="input input-inline" value={draft.details || ''} placeholder="Chi tiết" onChange={(event) => onChange(location.id, 'details', event.target.value)} />
    </div>
  );
});

export default LocationDraftCard;
