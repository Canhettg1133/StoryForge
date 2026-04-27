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
      <input className="input input-inline" value={draft.specific_role || ''} placeholder="Vai trò cụ thể" onChange={(event) => onChange(character.id, 'specific_role', event.target.value)} />
      <label className="bible-inline-check" title="Khi khóa, AI sẽ không tự tạo nhân vật khác thay thế hoặc trùng vai trò này.">
        <input
          type="checkbox"
          checked={Boolean(draft.specific_role_locked && String(draft.specific_role || '').trim())}
          disabled={!String(draft.specific_role || '').trim()}
          onChange={(event) => onChange(character.id, 'specific_role_locked', event.target.checked)}
        />
        <span>Khóa vai trò này như canon</span>
      </label>
      <input className="input input-inline" value={draft.age || ''} placeholder="Tuổi / độ tuổi" onChange={(event) => onChange(character.id, 'age', event.target.value)} />
      <input className="input input-inline" value={draft.appearance || ''} placeholder="Ngoại hình" onChange={(event) => onChange(character.id, 'appearance', event.target.value)} />
      <input className="input input-inline" value={draft.personality || ''} placeholder="Tính cách" onChange={(event) => onChange(character.id, 'personality', event.target.value)} />
      <input className="input input-inline" value={draft.personality_tags || ''} placeholder="Tags (VD: #Kiên_nhẫn, #Quyết_đoán)" onChange={(event) => onChange(character.id, 'personality_tags', event.target.value)} />
      <input className="input input-inline" value={draft.current_status || ''} placeholder="Trạng thái hiện tại / ràng buộc canon đang hiệu lực" onChange={(event) => onChange(character.id, 'current_status', event.target.value)} />
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
