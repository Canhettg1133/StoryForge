import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/db/database.js', () => ({
  default: {},
}));

const identity = await import('../../services/entityIdentity/index.js');

describe('phase10 entity identity', () => {
  it('does not auto-merge ambiguous single-token aliases', () => {
    const resolution = identity.resolveEntityCandidate(
      { name: 'Anh', aliases: [] },
      [
        { id: 1, name: 'Ngoc Anh', aliases: ['Anh'] },
        { id: 2, name: 'Lan Anh', aliases: ['Anh'] },
      ],
      'character',
    );

    expect(resolution.status).toBe('ambiguous_review');
    expect(resolution.matchTier).toBe('exact_alias');
  });

  it('matches a character by stripped honorific name', () => {
    const resolution = identity.resolveEntityCandidate(
      { name: 'su huynh Lam' },
      [
        { id: 7, name: 'Lam', aliases: [] },
      ],
      'character',
    );

    expect(resolution.status).toBe('matched_existing');
    expect(resolution.matchedEntityId).toBe(7);
  });

  it('creates a new entity when no safe deterministic match exists', () => {
    const resolution = identity.resolveEntityCandidate(
      { name: 'Tieu Ly' },
      [
        { id: 3, name: 'A Ly', aliases: [] },
      ],
      'character',
    );

    expect(resolution.status).toBe('created_new');
  });
});
