import { describe, expect, it, vi } from 'vitest';
import {
  findCharacterIdentityMatch,
  mergeCharacterPatch,
  normalizeCharacterIdentityKey,
} from '../../utils/characterIdentity.js';

describe('character identity helpers', () => {
  it('normalizes labels, punctuation, and Vietnamese diacritics', () => {
    expect(normalizeCharacterIdentityKey('Nhân vật chính: Nguyễn Ánh')).toBe('nguyen anh');
  });

  it('matches an incoming nickname when it is already an alias', () => {
    const match = findCharacterIdentityMatch(
      [{ id: 1, name: 'Ngoc Anh', aliases: ['Anh'] }],
      { name: 'Anh' },
    );

    expect(match?.character.id).toBe(1);
  });

  it('matches safe full-name variants without creating a second character', () => {
    const match = findCharacterIdentityMatch(
      [{ id: 1, name: 'Nguyen Linh Dao', aliases: [] }],
      { name: 'Linh Dao' },
    );

    expect(match?.character.id).toBe(1);
  });

  it('uses a unique single-token match only when there is one clear candidate', () => {
    const match = findCharacterIdentityMatch(
      [{ id: 1, name: 'Tran Kha Minh', aliases: [] }],
      { name: 'Kha' },
    );

    expect(match?.character.id).toBe(1);
  });

  it('does not merge ambiguous single-token names into the wrong person', () => {
    expect(findCharacterIdentityMatch(
      [{ id: 1, name: 'Ngoc Anh', aliases: [] }],
      { name: 'Anh' },
    )).toBeNull();

    expect(findCharacterIdentityMatch(
      [
        { id: 1, name: 'Ngoc Linh', aliases: [] },
        { id: 2, name: 'Thanh Linh', aliases: [] },
      ],
      { name: 'Linh' },
    )).toBeNull();
  });

  it('does not merge numbered character variants into the first matching prefix', () => {
    const existingCharacters = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      name: `Hac Y Ve ${index + 1}`,
      aliases: [],
    }));

    expect(findCharacterIdentityMatch(
      existingCharacters,
      { name: 'Hac Y Ve 19' },
    )).toBeNull();
  });

  it('merges new information without overwriting existing character canon', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    const patch = mergeCharacterPatch(
      {
        name: 'Nguyen Linh Dao',
        aliases: ['Dao'],
        role: 'supporting',
        appearance: 'Ao xam',
        personality: '',
      },
      {
        name: 'Linh Dao',
        aliases: ['Tieu Dao'],
        role: 'protagonist',
        appearance: 'Ao den',
        personality: 'Can trong',
      },
    );

    expect(patch.aliases).toEqual(['Dao', 'Linh Dao', 'Tieu Dao']);
    expect(patch.role).toBe('protagonist');
    expect(patch.appearance).toBeUndefined();
    expect(patch.personality).toBe('Can trong');
    expect(patch.updated_at).toBe(1700000000000);
    vi.useRealTimers();
  });
});
