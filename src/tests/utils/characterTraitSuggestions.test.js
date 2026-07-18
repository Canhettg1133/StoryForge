import { describe, expect, it } from 'vitest';

import {
  ALL_CHARACTER_TRAITS,
  CHARACTER_TRAIT_CATEGORIES,
  getCharacterTraitSuggestions,
  parseCharacterTraits,
  serializeCharacterTraits,
} from '../../utils/characterTraitSuggestions.js';

describe('character trait suggestions', () => {
  it('offers a broad, categorized fiction-writing catalog', () => {
    expect(ALL_CHARACTER_TRAITS.length).toBeGreaterThanOrEqual(140);
    expect(CHARACTER_TRAIT_CATEGORIES.map((category) => category.id)).toEqual(expect.arrayContaining([
      'temperament',
      'social',
      'mind',
      'emotion',
      'values',
      'relationship',
      'shadow',
      'archetype',
      'adult',
    ]));
  });

  it('ranks aliases and prefix matches so tom suggests Tomboy first', () => {
    const suggestions = getCharacterTraitSuggestions({ query: 'tom' });

    expect(suggestions[0]?.label).toBe('Tomboy');
    expect(getCharacterTraitSuggestions({ query: 'tsun' })[0]?.label).toBe('Tsundere');
  });

  it('matches Vietnamese text without requiring accents', () => {
    const suggestions = getCharacterTraitSuggestions({ query: 'quyet doan' });

    expect(suggestions.some((trait) => trait.label === 'Quyết đoán')).toBe(true);
  });

  it('keeps the adult catalog searchable without an age gate', () => {
    expect(getCharacterTraitSuggestions({ query: 'dominant' })[0]?.label)
      .toBe('Thống trị (Dominant)');
    expect(getCharacterTraitSuggestions({ categoryId: 'adult' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Thống trị (Dominant)' }),
        expect.objectContaining({ label: 'Phục tùng (Submissive)' }),
      ]));
  });

  it('parses legacy hashtags and serializes unique readable labels', () => {
    const parsed = parseCharacterTraits('#Kiên_nhẫn, tomboy; Kiên nhẫn\nLý_trí');

    expect(parsed).toEqual(['Kiên nhẫn', 'tomboy', 'Lý trí']);
    expect(serializeCharacterTraits(parsed)).toBe('Kiên nhẫn, tomboy, Lý trí');
  });
});
