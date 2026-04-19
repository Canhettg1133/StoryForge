import React, { useMemo } from 'react';
import { CHARACTER_ROLES } from '../../../utils/constants';
import { getSelectOptionsWithFallback } from '../utils/storyBibleHelpers';

const CharacterDraftCard = React.memo(function CharacterDraftCard({
  character,
  draft,
  onChange,
}) {
  const roleOptions = useMemo(
    () => getSelectOptionsWithFallback(CHARACTER_ROLES, draft.role, 'Vai trò khác'),
    [draft.role]
  );

  return (
    <div className="bible-card bible-card--editable">
      <div className="bible-card-header">
        <select className="select select-mini" value={draft.role} onChange={(event) => onChange(character.id, 'role', event.target.value)}>
          {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
      </div>
      <input className="input input-inline" value={draft.name} placeholder="Tên" onChange={(event) => onChange(character.id, 'name', event.target.value)} />
      <input className="input input-inline" value={draft.appearance || ''} placeholder="Ngoại hình" onChange={(event) => onChange(character.id, 'appearance', event.target.value)} />
      <input className="input input-inline" value={draft.personality || ''} placeholder="Tính cách" onChange={(event) => onChange(character.id, 'personality', event.target.value)} />
      <input className="input input-inline" value={draft.personality_tags || ''} placeholder="Tags (VD: #Kiên_nhẫn, #Quyết_đoán)" onChange={(event) => onChange(character.id, 'personality_tags', event.target.value)} />
      <input className="input input-inline" value={draft.current_status || ''} placeholder="Trạng thái hiện tại" onChange={(event) => onChange(character.id, 'current_status', event.target.value)} />
      <input className="input input-inline" value={draft.goals || ''} placeholder="Mục tiêu" onChange={(event) => onChange(character.id, 'goals', event.target.value)} />
      <input className="input input-inline" value={draft.flaws || ''} placeholder="Điểm yếu / khuyết điểm" onChange={(event) => onChange(character.id, 'flaws', event.target.value)} />
      <div style={{ display: 'flex', gap: '4px' }}>
        <input className="input input-inline" style={{ flex: 1 }} value={draft.pronouns_self || ''} placeholder="Xưng" onChange={(event) => onChange(character.id, 'pronouns_self', event.target.value)} />
        <input className="input input-inline" style={{ flex: 1 }} value={draft.pronouns_other || ''} placeholder="Gọi" onChange={(event) => onChange(character.id, 'pronouns_other', event.target.value)} />
      </div>
    </div>
  );
});

export default CharacterDraftCard;
