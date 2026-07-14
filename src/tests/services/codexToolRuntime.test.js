import { describe, expect, it } from 'vitest';
import {
  CODEX_TOOL_NAMES,
  createCodexToolRuntime,
  getCodexResolverTools,
} from '../../services/codex/codexToolRuntime.js';

function collectNonPortableSchemaNodes(value, path = 'parameters', issues = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNonPortableSchemaNodes(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (!value || typeof value !== 'object') return issues;
  if (Array.isArray(value.type)) issues.push(`${path}.type`);
  if (Array.isArray(value.enum) && value.enum.includes(null)) issues.push(`${path}.enum`);
  Object.entries(value).forEach(([key, item]) => {
    collectNonPortableSchemaNodes(item, `${path}.${key}`, issues);
  });
  return issues;
}

function collectServingStateConstraints(value, path = 'parameters', issues = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectServingStateConstraints(item, `${path}[${index}]`, issues));
    return issues;
  }
  if (!value || typeof value !== 'object') return issues;
  for (const key of ['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) issues.push(`${path}.${key}`);
  }
  Object.entries(value).forEach(([key, item]) => {
    collectServingStateConstraints(item, `${path}.${key}`, issues);
  });
  return issues;
}

function createRuntime(overrides = {}) {
  return createCodexToolRuntime({
    projectId: 1,
    chapterId: 11,
    sourceHash: 'source-v1',
    catalogRevision: 'catalog-v1',
    paragraphPageSize: 1,
    catalogPageSize: 1,
    paragraphs: [
      { id: 'scene-21:p-1', text: 'Lan cam Ngoc An trong tay.' },
      { id: 'scene-21:p-2', text: 'A Lan roi khoi dai dien.' },
    ],
    entities: [
      { id: 1, project_id: 1, entity_kind: 'character', name: 'Lan', aliases: [], role: 'supporting' },
      { id: 2, project_id: 1, entity_kind: 'object', name: 'Ngoc An', aliases: ['An Ngoc'], owner_character_id: 1 },
    ],
    ...overrides,
  });
}

describe('Codex local tool runtime', () => {
  it('advertises resolver schemas that Gemini-compatible proxies can accept on the second turn', () => {
    const tools = getCodexResolverTools({ firstTurn: false });
    const issues = tools.flatMap((item) => (
      collectNonPortableSchemaNodes(item.function.parameters, item.function.name)
    ));
    const servingStateConstraints = tools.flatMap((item) => (
      collectServingStateConstraints(item.function.parameters, item.function.name)
    ));

    expect(issues).toEqual([]);
    expect(servingStateConstraints).toEqual([]);
  });

  it('decodes portable Gemini sentinel fields before applying strict runtime validation', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    const search = runtime.execute(CODEX_TOOL_NAMES.SEARCH, {
      query: 'Ngoc An',
      entity_kind: 'any',
      owner_or_holder: '',
      limit: 10,
    });
    expect(search.items[0]).toEqual(expect.objectContaining({ name: 'Ngoc An' }));

    const plan = runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'object:ngoc-an',
        entity_kind: 'object',
        extracted_name: 'Ngoc An',
        decision: 'match_existing',
        target_entity_ids: [2],
        canonical_name: '',
        aliases: [],
        role_hint: 'none',
        proposed_changes: [{
          field: 'owner_character_id',
          value_kind: 'integer',
          text_value: '',
          integer_value: 1,
          boolean_value: false,
        }],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Ngoc An trong tay.' }],
        reasoning: 'Portable tool arguments.',
        risk_flags: [],
      }],
    });

    expect(plan.decisions[0]).toEqual(expect.objectContaining({
      canonical_name: null,
      role_hint: null,
      proposed_changes: [{ field: 'owner_character_id', value: 1 }],
    }));
  });

  it('rejects malformed portable value kinds instead of silently treating them as text', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    expect(() => runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'object:ngoc-an',
        entity_kind: 'object',
        extracted_name: 'Ngoc An',
        decision: 'match_existing',
        target_entity_ids: [2],
        canonical_name: '',
        aliases: [],
        role_hint: 'none',
        proposed_changes: [{
          field: 'description',
          value_kind: 'sql',
          text_value: 'unsafe fallback',
          integer_value: 0,
          boolean_value: false,
        }],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Ngoc An trong tay.' }],
        reasoning: 'Malformed portable arguments.',
        risk_flags: [],
      }],
    })).toThrow();
  });

  it('requires the load tool first and issues opaque cursors for pagination', () => {
    const runtime = createRuntime();

    expect(() => runtime.execute(CODEX_TOOL_NAMES.SEARCH, {
      query: 'Lan',
      entity_kind: 'character',
      owner_or_holder: null,
      limit: 10,
    })).toThrow(/load_codex_analysis_context/i);

    const loaded = runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});
    expect(loaded.chapter.items).toHaveLength(1);
    expect(loaded.catalog.items).toHaveLength(1);
    expect(loaded.chapter.next_cursor).toEqual(expect.any(String));
    expect(loaded.catalog.next_cursor).toEqual(expect.any(String));
    expect(loaded).not.toHaveProperty('project_id');

    expect(() => runtime.execute(CODEX_TOOL_NAMES.READ_PAGE, {
      cursor: 'fabricated-offset-1000',
    })).toThrow(/cursor/i);
  });

  it('treats search as navigation only and blocks cross-snapshot entity IDs', () => {
    const runtime = createRuntime();
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    const empty = runtime.execute(CODEX_TOOL_NAMES.SEARCH, {
      query: 'Khong ton tai',
      entity_kind: null,
      owner_or_holder: null,
      limit: 10,
    });
    expect(empty.items).toEqual([]);
    expect(empty.empty_result_is_not_absence_proof).toBe(true);

    expect(() => runtime.execute(CODEX_TOOL_NAMES.GET_ENTITY_CONTEXT, {
      entity_kind: 'character',
      entity_ids: [999],
    })).toThrow(/snapshot/i);
  });

  it('keeps table-local IDs separated by entity kind', () => {
    const runtime = createRuntime({
      entities: [
        { id: 1, project_id: 1, entity_kind: 'character', name: 'Lan', aliases: [] },
        { id: 1, project_id: 1, entity_kind: 'object', name: 'Ngoc An', aliases: [] },
      ],
    });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    const character = runtime.execute(CODEX_TOOL_NAMES.GET_ENTITY_CONTEXT, {
      entity_kind: 'character',
      entity_ids: [1],
    });
    const object = runtime.execute(CODEX_TOOL_NAMES.GET_ENTITY_CONTEXT, {
      entity_kind: 'object',
      entity_ids: [1],
    });

    expect(character.items[0].name).toBe('Lan');
    expect(object.items[0].name).toBe('Ngoc An');
  });

  it('rejects invented evidence and stale source hashes', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    const basePlan = {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:lan',
        entity_kind: 'character',
        extracted_name: 'Lan',
        decision: 'match_existing',
        target_entity_ids: [1],
        canonical_name: null,
        aliases: [],
        role_hint: null,
        proposed_changes: [],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan khong co trong doan nay.' }],
        reasoning: 'Exact name.',
        risk_flags: [],
      }],
    };

    expect(() => runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, basePlan)).toThrow(/evidence/i);
    expect(() => runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      ...basePlan,
      source_hash: 'source-cu',
      decisions: [{
        ...basePlan.decisions[0],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan cam Ngoc An' }],
      }],
    })).toThrow(/stale/i);
  });

  it('requires evidence quotes to be verbatim instead of accepting accent-stripped approximations', () => {
    const runtime = createRuntime({
      paragraphPageSize: 10,
      catalogPageSize: 10,
      paragraphs: [{ id: 'scene-21:p-1', text: 'Lan là nhân vật chính.' }],
    });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    expect(() => runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:lan',
        entity_kind: 'character',
        extracted_name: 'Lan',
        decision: 'match_existing',
        target_entity_ids: [1],
        canonical_name: null,
        aliases: [],
        role_hint: null,
        proposed_changes: [],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan la nhan vat chinh' }],
        reasoning: 'Approximate quote only.',
        risk_flags: [],
      }],
    })).toThrow(/evidence/i);
  });

  it('holds an exact name when the complete catalog contains another exact homonym', () => {
    const runtime = createRuntime({
      paragraphPageSize: 10,
      catalogPageSize: 10,
      entities: [
        { id: 1, project_id: 1, entity_kind: 'character', name: 'Lan', aliases: [], role: 'supporting' },
        { id: 3, project_id: 1, entity_kind: 'character', name: 'Lan', aliases: [], role: 'supporting' },
      ],
    });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});
    runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:lan',
        entity_kind: 'character',
        extracted_name: 'Lan',
        decision: 'match_existing',
        target_entity_ids: [1],
        canonical_name: null,
        aliases: [],
        role_hint: null,
        proposed_changes: [],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan cam Ngoc An trong tay.' }],
        reasoning: 'One of two homonyms.',
        risk_flags: [],
      }],
    });
    const critiqued = runtime.execute(CODEX_TOOL_NAMES.SUBMIT_CRITIQUE, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      critiques: [{
        candidate_key: 'character:lan',
        decision: 'agree',
        reasoning: 'The selected target looks exact.',
        risk_flags: [],
      }],
    });

    expect(critiqued.decisions[0]).toEqual(expect.objectContaining({
      quick_approve: false,
      review_safety: 'manual_review',
    }));
    expect(critiqued.decisions[0].risk_flags).toContain('exact_identity_collision');
  });

  it('uses accent-stripped Vietnamese only for navigation, never for an exact quick approval', () => {
    const runtime = createRuntime({
      paragraphPageSize: 10,
      catalogPageSize: 10,
      paragraphs: [{ id: 'scene-21:p-1', text: 'Hoa xuất hiện trước cổng.' }],
      entities: [
        { id: 1, project_id: 1, entity_kind: 'character', name: 'Hòa', aliases: [], role: 'supporting' },
      ],
    });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});
    runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:hoa',
        entity_kind: 'character',
        extracted_name: 'Hoa',
        decision: 'match_existing',
        target_entity_ids: [1],
        canonical_name: null,
        aliases: [],
        role_hint: null,
        proposed_changes: [],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Hoa xuất hiện' }],
        reasoning: 'The names differ only after removing Vietnamese diacritics.',
        risk_flags: [],
      }],
    });
    const critiqued = runtime.execute(CODEX_TOOL_NAMES.SUBMIT_CRITIQUE, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      critiques: [{
        candidate_key: 'character:hoa',
        decision: 'agree',
        reasoning: 'Still requires human review because the written names differ.',
        risk_flags: [],
      }],
    });

    expect(critiqued.decisions[0]).toEqual(expect.objectContaining({
      match_tier: 'semantic_candidate',
      quick_approve: false,
      review_safety: 'manual_review',
    }));
  });

  it('holds invented aliases even when the target name is an exact match', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});
    runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:lan',
        entity_kind: 'character',
        extracted_name: 'Lan',
        decision: 'match_existing',
        target_entity_ids: [1],
        canonical_name: null,
        aliases: ['Thanh Nữ'],
        role_hint: null,
        proposed_changes: [],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan cam Ngoc An trong tay.' }],
        reasoning: 'The alias is not present in evidence.',
        risk_flags: [],
      }],
    });
    const critiqued = runtime.execute(CODEX_TOOL_NAMES.SUBMIT_CRITIQUE, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      critiques: [{
        candidate_key: 'character:lan',
        decision: 'agree',
        reasoning: 'Exact target name.',
        risk_flags: [],
      }],
    });

    expect(critiqued.decisions[0].quick_approve).toBe(false);
    expect(critiqued.decisions[0].risk_flags).toContain('alias_not_grounded');
  });

  it('rejects proposed fields that are not part of the selected entity schema', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    expect(() => runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:lan',
        entity_kind: 'character',
        extracted_name: 'Lan',
        decision: 'match_existing',
        target_entity_ids: [1],
        canonical_name: null,
        aliases: [],
        role_hint: null,
        proposed_changes: [{ field: 'sql_table', value: 'characters' }],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Lan cam Ngoc An trong tay.' }],
        reasoning: 'Invalid field.',
        risk_flags: [],
      }],
    })).toThrow(/field/i);
  });

  it('rejects proposed owner and parent IDs that are outside the typed project snapshot', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    expect(() => runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'object:ngoc-an',
        entity_kind: 'object',
        extracted_name: 'Ngoc An',
        decision: 'match_existing',
        target_entity_ids: [2],
        canonical_name: null,
        aliases: [],
        role_hint: null,
        proposed_changes: [{ field: 'owner_character_id', value: 999 }],
        evidence: [{ paragraph_id: 'scene-21:p-1', quote: 'Ngoc An trong tay.' }],
        reasoning: 'Invalid owner reference.',
        risk_flags: [],
      }],
    })).toThrow(/snapshot|reference/i);
  });

  it('accepts an empty grounded plan when the complete chapter contains no entities to stage', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    const result = runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [],
    });

    expect(result.decisions).toEqual([]);
  });

  it('marks a grounded new protagonist as manual review instead of mutating canon', () => {
    const runtime = createRuntime({ paragraphPageSize: 10, catalogPageSize: 10 });
    runtime.execute(CODEX_TOOL_NAMES.LOAD_CONTEXT, {});

    const submitted = runtime.execute(CODEX_TOOL_NAMES.SUBMIT_PLAN, {
      source_hash: 'source-v1',
      catalog_revision: 'catalog-v1',
      decisions: [{
        candidate_key: 'character:a-lan',
        entity_kind: 'character',
        extracted_name: 'A Lan',
        decision: 'create_new',
        target_entity_ids: [],
        canonical_name: 'A Lan',
        aliases: [],
        role_hint: 'protagonist',
        proposed_changes: [],
        evidence: [{ paragraph_id: 'scene-21:p-2', quote: 'A Lan roi khoi dai dien.' }],
        reasoning: 'The text names A Lan.',
        risk_flags: ['possible_alias'],
      }],
    });

    expect(submitted.decisions[0]).toEqual(expect.objectContaining({
      quick_approve: false,
      review_safety: 'manual_review',
      protected_field_changes: expect.arrayContaining(['role:protagonist']),
    }));
  });
});
