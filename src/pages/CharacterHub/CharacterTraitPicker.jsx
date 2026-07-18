import React, { useMemo, useState } from 'react';
import { Plus, Search, Sparkles, X } from 'lucide-react';

import {
  CHARACTER_TRAIT_CATEGORIES,
  findCharacterTraitMatch,
  getCharacterTraitSuggestions,
  normalizeCharacterTraitSearch,
  parseCharacterTraits,
  serializeCharacterTraits,
} from '../../utils/characterTraitSuggestions';

const POPULAR_CATEGORY = {
  id: 'popular',
  label: 'Phổ biến',
  description: 'Các nét thường dùng để dựng nhanh một nhân vật có chiều sâu.',
};

export default function CharacterTraitPicker({ value = '', onChange }) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('popular');

  const selectedTags = useMemo(() => parseCharacterTraits(value), [value]);
  const categories = [POPULAR_CATEGORY, ...CHARACTER_TRAIT_CATEGORIES];
  const activeCategoryMeta = categories.find((category) => category.id === activeCategory) || POPULAR_CATEGORY;
  const suggestions = useMemo(() => getCharacterTraitSuggestions({
    query,
    selected: selectedTags,
    categoryId: activeCategory,
  }), [activeCategory, query, selectedTags]);

  const updateTags = (nextTags) => {
    onChange(serializeCharacterTraits(nextTags));
  };

  const addTag = (label) => {
    const [cleanLabel] = parseCharacterTraits([label]);
    if (!cleanLabel) return;
    const key = normalizeCharacterTraitSearch(cleanLabel);
    if (selectedTags.some((tag) => normalizeCharacterTraitSearch(tag) === key)) {
      setQuery('');
      return;
    }
    updateTags([...selectedTags, cleanLabel]);
    setQuery('');
  };

  const removeTag = (label) => {
    const key = normalizeCharacterTraitSearch(label);
    updateTags(selectedTags.filter((tag) => normalizeCharacterTraitSearch(tag) !== key));
  };

  const addFromQuery = () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const catalogMatch = findCharacterTraitMatch(trimmedQuery);
    addTag(suggestions[0]?.label || catalogMatch?.label || trimmedQuery);
  };

  const handleCategoryClick = (category) => {
    setActiveCategory(category.id);
    setQuery('');
  };

  return (
    <div className="character-trait-picker">
      <div className="character-trait-picker__header">
        <div>
          <strong>Tags tâm lý / Nét đặc trưng</strong>
          <p>Chọn nét cốt lõi để AI giữ tính cách nhất quán qua từng chương.</p>
        </div>
        <span>{selectedTags.length} đã chọn</span>
      </div>

      {selectedTags.length > 0 && (
        <div className="character-trait-selected" aria-label="Tags đã chọn">
          {selectedTags.map((tag) => (
            <button
              key={normalizeCharacterTraitSearch(tag)}
              type="button"
              className="character-trait-selected__chip"
              onClick={() => removeTag(tag)}
              title={`Bỏ tag ${tag}`}
            >
              <span>{tag}</span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div className="character-trait-search">
        <Search size={16} aria-hidden="true" />
        <input
          data-testid="character-trait-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addFromQuery();
            }
          }}
          placeholder="Tìm tiếng Việt, English hoặc gõ tag riêng..."
          aria-label="Tìm hoặc thêm nét tính cách"
        />
        <button
          type="button"
          onClick={addFromQuery}
          disabled={!query.trim()}
          title="Thêm tag"
          aria-label="Thêm tag đang nhập"
        >
          <Plus size={16} />
        </button>
      </div>
      <p className="character-trait-picker__hint">
        Gõ không dấu vẫn tìm được. Ví dụ: <code>tom</code> gợi ý <strong>Tomboy</strong>; nhấn Enter để chọn kết quả đầu tiên.
      </p>

      <div className="character-trait-categories" aria-label="Nhóm nét tính cách">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            data-category={category.id}
            className={`character-trait-category ${activeCategory === category.id ? 'is-active' : ''}`}
            aria-pressed={activeCategory === category.id}
            onClick={() => handleCategoryClick(category)}
          >
            {category.label}
          </button>
        ))}
      </div>

      <div className="character-trait-results" aria-live="polite">
        <div className="character-trait-results__header">
          <div>
            <span><Sparkles size={14} aria-hidden="true" /> {query ? 'Gợi ý phù hợp' : activeCategoryMeta.label}</span>
            <p>{query ? `Kết quả cho “${query.trim()}”` : activeCategoryMeta.description}</p>
          </div>
          <small>{suggestions.length} gợi ý</small>
        </div>

        {suggestions.length > 0 ? (
          <div className="character-trait-suggestions">
            {suggestions.map((trait) => (
              <button
                key={trait.id}
                type="button"
                className={`character-trait-suggestion ${trait.adult ? 'character-trait-suggestion--adult' : ''}`}
                onClick={() => addTag(trait.label)}
                title={trait.aliases.length > 0 ? `Từ khóa: ${trait.aliases.join(', ')}` : undefined}
              >
                <Plus size={12} aria-hidden="true" />
                {trait.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="character-trait-results__empty">
            Chưa có gợi ý trùng khớp. Nhấn Enter để thêm “{query.trim()}” làm tag riêng.
          </p>
        )}
      </div>
    </div>
  );
}
