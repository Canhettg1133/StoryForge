import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/db/database.js', () => ({
  default: {},
}));

const identity = await import('../../services/entityIdentity/index.js');

describe('phase10 entity identity', () => {
  it('normalizes Vietnamese D-stroke consistently with ASCII d', () => {
    const accented = identity.normalizeEntityIdentity('object', { name: 'Huyết Liên Đan' });
    const ascii = identity.normalizeEntityIdentity('object', { name: 'huyet lien dan' });

    expect(accented.normalized_name).toBe(ascii.normalized_name);
  });

  it('accepts a valid explicit existing identity without fuzzy matching', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Huyết Liên Đan',
        aliases: ['Viên Huyết Liên Đan'],
        identity_action: 'existing',
        existing_entity_id: 7,
      },
      [{ id: 7, name: 'Huyết Liên Đan', aliases: [] }],
      'object',
    );

    expect(resolution.status).toBe('matched_existing');
    expect(resolution.matchedEntityId).toBe(7);
    expect(resolution.matchTier).toBe('ai_existing_id');
  });

  it('rejects an explicit existing identity when its id and canonical name disagree', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Huyết Liên Đan',
        identity_action: 'existing',
        existing_entity_id: 8,
      },
      [
        { id: 7, name: 'Huyết Liên Đan', aliases: [] },
        { id: 8, name: 'Cửu Chuyển Đan', aliases: [] },
      ],
      'object',
    );

    expect(resolution.status).toBe('rejected');
    expect(resolution.matchTier).toBe('invalid_ai_identity');
  });

  it('rejects an explicit existing identity when an incoming alias belongs to another entity', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Lý Mặc',
        aliases: ['Trần Phong'],
        identity_action: 'existing',
        existing_entity_id: 7,
      },
      [
        { id: 7, name: 'Lý Mặc', aliases: [] },
        { id: 8, name: 'Trần Phong', aliases: [] },
      ],
      'character',
    );

    expect(resolution.status).toBe('rejected');
    expect(resolution.matchTier).toBe('invalid_ai_identity');
  });

  it('matches an AI-new candidate to one exact alias before creating a duplicate', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Viên Huyết Liên Đan',
        identity_action: 'new',
        existing_entity_id: null,
      },
      [{ id: 7, name: 'Huyết Liên Đan', aliases: ['Viên Huyết Liên Đan'] }],
      'object',
    );

    expect(resolution.status).toBe('matched_existing');
    expect(resolution.matchedEntityId).toBe(7);
    expect(resolution.matchTier).toBe('strict_exact_alias');
  });

  it('rejects an AI-new candidate when the exact alias belongs to multiple entities', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Thanh Vân',
        identity_action: 'new',
        existing_entity_id: null,
      },
      [
        { id: 1, name: 'Thanh Vân Sơn', aliases: ['Thanh Vân'] },
        { id: 2, name: 'Thanh Vân Thành', aliases: ['Thanh Vân'] },
      ],
      'location',
    );

    expect(resolution.status).toBe('rejected');
    expect(resolution.matchTier).toBe('invalid_ai_identity');
  });

  it('does not fuzzy-merge a genuinely different AI-new name', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Linh lực thiên địa',
        identity_action: 'new',
        existing_entity_id: null,
      },
      [{ id: 1, name: 'Linh lực', aliases: [] }],
      'world_term',
    );

    expect(resolution.status).toBe('created_new');
  });

  it('rejects an AI-new candidate that omits existing_entity_id instead of treating it as null', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Linh lực thiên địa',
        identity_action: 'new',
      },
      [],
      'world_term',
    );

    expect(resolution.status).toBe('rejected');
    expect(resolution.matchTier).toBe('invalid_ai_identity');
  });

  it('does not strip honorifics when validating an AI-new candidate', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Sư huynh Lý Mặc',
        identity_action: 'new',
        existing_entity_id: null,
      },
      [{ id: 1, name: 'Lý Mặc', aliases: [] }],
      'character',
    );

    expect(resolution.status).toBe('created_new');
  });

  it('does not match an AI-new character through an existing stripped honorific name', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      {
        name: 'Lý Mặc',
        identity_action: 'new',
        existing_entity_id: null,
      },
      [{ id: 1, name: 'Sư huynh Lý Mặc', aliases: [] }],
      'character',
    );

    expect(resolution.status).toBe('created_new');
    expect(resolution.matchedEntityId).toBeNull();
  });

  it('rejects chapter extraction candidates that omit the identity contract', () => {
    const resolution = identity.resolveChapterExtractCandidate(
      { name: 'Lý Mặc' },
      [],
      'character',
    );

    expect(resolution.status).toBe('rejected');
    expect(resolution.matchTier).toBe('invalid_ai_identity');
  });

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

  it('creates a new character when only the numbered suffix differs', () => {
    const resolution = identity.resolveEntityCandidate(
      { name: 'Hac Y Ve 19' },
      Array.from({ length: 18 }, (_, index) => ({
        id: index + 1,
        name: `Hac Y Ve ${index + 1}`,
        aliases: [],
      })),
      'character',
    );

    expect(resolution.status).toBe('created_new');
  });
});
