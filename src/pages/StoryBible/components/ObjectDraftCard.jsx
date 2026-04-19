import React from 'react';

const ObjectDraftCard = React.memo(function ObjectDraftCard({
  objectItem,
  draft,
  characters,
  onChange,
}) {
  return (
    <div className="bible-card bible-card--editable">
      <input className="input input-inline input-bold" value={draft.name} placeholder="Tên" onChange={(event) => onChange(objectItem.id, 'name', event.target.value)} />
      <input className="input input-inline" value={draft.description || ''} placeholder="Mô tả" onChange={(event) => onChange(objectItem.id, 'description', event.target.value)} />
      <input className="input input-inline" value={draft.properties || ''} placeholder="Thuộc tính" onChange={(event) => onChange(objectItem.id, 'properties', event.target.value)} />
      <select className="select select-mini" value={draft.owner_character_id || ''} onChange={(event) => onChange(objectItem.id, 'owner_character_id', event.target.value ? Number(event.target.value) : null)}>
        <option value="">Không có chủ</option>
        {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select>
    </div>
  );
});

export default ObjectDraftCard;
