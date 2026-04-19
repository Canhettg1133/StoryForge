import React, { useMemo } from 'react';
import { WORLD_TERM_CATEGORIES } from '../../../utils/constants';
import { getSelectOptionsWithFallback } from '../utils/storyBibleHelpers';

const WorldTermDraftCard = React.memo(function WorldTermDraftCard({
  term,
  draft,
  onChange,
}) {
  const categoryOptions = useMemo(
    () => getSelectOptionsWithFallback(WORLD_TERM_CATEGORIES, draft.category, 'Loại khác'),
    [draft.category]
  );

  return (
    <div className="bible-card bible-card--editable">
      <div style={{ display: 'flex', gap: '4px' }}>
        <input className="input input-inline input-bold" style={{ flex: 1 }} value={draft.name} placeholder="Tên" onChange={(event) => onChange(term.id, 'name', event.target.value)} />
        <select className="select select-mini" value={draft.category} onChange={(event) => onChange(term.id, 'category', event.target.value)}>
          {categoryOptions.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </div>
      <input className="input input-inline" value={draft.definition || ''} placeholder="Định nghĩa" onChange={(event) => onChange(term.id, 'definition', event.target.value)} />
    </div>
  );
});

export default WorldTermDraftCard;
