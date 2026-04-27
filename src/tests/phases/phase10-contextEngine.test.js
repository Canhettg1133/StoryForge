import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TASK_TYPES } from '../../services/ai/router';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareByField(field) {
  return (a, b) => {
    const left = a?.[field];
    const right = b?.[field];
    if (left === right) return 0;
    if (left == null) return -1;
    if (right == null) return 1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right));
  };
}

class MemoryQuery {
  constructor(table, field = null, rows = null) {
    this.table = table;
    this.field = field;
    this.rows = rows;
  }

  _rows() {
    return this.rows ? clone(this.rows) : clone(this.table.rows);
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected)
    );
  }

  async toArray() {
    return this._rows();
  }

  async sortBy(field) {
    return this._rows().sort(compareByField(field));
  }

  async first() {
    return this._rows()[0];
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? clone(row) : undefined;
  }
}

function createMockDb(seed = {}) {
  const tableNames = [
    'projects',
    'characters',
    'locations',
    'objects',
    'worldTerms',
    'factions',
    'taboos',
    'chapterMeta',
    'chapters',
    'relationships',
    'canonFacts',
    'plotThreads',
    'scenes',
    'arcs',
    'macro_arcs',
    'threadBeats',
  ];
  const db = {};
  tableNames.forEach((name) => {
    db[name] = new MemoryTable(seed[name] || []);
  });
  return db;
}

async function loadContextEngine(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  const buildRetrievalPacketMock = vi.fn(async () => null);
  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/canon/queries', () => ({
    buildRetrievalPacket: buildRetrievalPacketMock,
  }));
  vi.doMock('../../services/canon/state', () => ({
    buildCharacterStateSummary: vi.fn((_state, fallback) => fallback || ''),
  }));
  return {
    db,
    buildRetrievalPacketMock,
    contextEngine: await import('../../services/ai/contextEngine'),
  };
}

describe('phase10 context engine blueprint injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses chapterId to resolve the active chapter and injects blueprint entities for empty scenes', async () => {
    const { contextEngine } = await loadContextEngine({
      projects: [{
        id: 1,
        title: 'Du an thu',
        genre_primary: 'fantasy',
        prompt_templates: '{}',
      }],
      chapters: [
        {
          id: 11,
          project_id: 1,
          order_index: 0,
          title: 'Chuong 1',
          summary: 'Mo dau khac.',
          purpose: 'Khac',
          featured_characters: ['Nguoi khac'],
          primary_location: 'Noi khac',
          thread_titles: ['Thread khac'],
          key_events: ['Beat khac'],
        },
        {
          id: 12,
          project_id: 1,
          order_index: 1,
          title: 'Chuong 2',
          summary: 'Lan den Thanh Co va gap Kha.',
          purpose: 'Dat neo mo dau cho conflict chinh',
          featured_characters: ['Lan', 'Kha'],
          primary_location: 'Thanh Co',
          thread_titles: ['Bi mat hoang toc'],
          key_events: ['Lan gap Kha'],
          required_factions: ['Thanh Van Tong'],
          required_objects: ['Ngoc boi'],
        },
      ],
      chapterMeta: [{
        id: 31,
        project_id: 1,
        chapter_id: 11,
        summary: 'Tom tat chuong 1',
        last_prose_buffer: 'Du am chuong 1',
      }],
      characters: [
        { id: 101, project_id: 1, name: 'Lan', role: 'protagonist' },
        { id: 102, project_id: 1, name: 'Kha', role: 'supporting' },
      ],
      locations: [{ id: 201, project_id: 1, name: 'Thanh Co', story_function: 'San khau mo dau' }],
      objects: [{ id: 301, project_id: 1, name: 'Ngoc boi', story_function: 'Vat pham khoi dong' }],
      factions: [{ id: 401, project_id: 1, name: 'Thanh Van Tong', story_function: 'The luc chu dao' }],
      worldTerms: [{ id: 501, project_id: 1, name: 'Linh can', story_function: 'He thong suc manh' }],
      plotThreads: [{ id: 601, project_id: 1, title: 'Bi mat hoang toc', state: 'active' }],
      relationships: [],
      canonFacts: [],
      taboos: [],
      scenes: [{
        id: 701,
        project_id: 1,
        chapter_id: 12,
        order_index: 0,
        title: 'Canh 1',
        pov_character_id: null,
        location_id: null,
        characters_present: '[]',
        draft_text: '',
        final_text: '',
      }],
      arcs: [],
      macro_arcs: [],
      threadBeats: [],
    });

    const ctx = await contextEngine.gatherContext({
      projectId: 1,
      chapterId: 12,
      chapterIndex: 0,
      sceneId: 701,
      sceneText: '',
      genre: 'fantasy',
      taskType: TASK_TYPES.CONTINUE,
    });

    expect(ctx.currentChapterIndex).toBe(1);
    expect(ctx.currentChapterOutline.title).toBe('Chuong 2');
    expect(ctx.chapterBlueprintContext.purpose).toBe('Dat neo mo dau cho conflict chinh');
    expect(ctx.chapterBlueprintContext.required_factions).toEqual(['Thanh Van Tong']);
    expect(ctx.chapterBlueprintContext.required_objects).toEqual(['Ngoc boi']);
    expect(ctx.characters.map((item) => item.name)).toEqual(expect.arrayContaining(['Lan', 'Kha']));
    expect(ctx.locations.map((item) => item.name)).toContain('Thanh Co');
    expect(ctx.factions.map((item) => item.name)).toContain('Thanh Van Tong');
    expect(ctx.objects.map((item) => item.name)).toContain('Ngoc boi');
    expect(ctx.preWriteValidation.warnings.some((item) => item.code === 'empty-scene-bootstrap-weak')).toBe(true);
  });

  it('always keeps manual scene cast when scene text detects another character', async () => {
    const { contextEngine, buildRetrievalPacketMock } = await loadContextEngine({
      projects: [{ id: 1, title: 'Du an thu', genre_primary: 'fantasy', prompt_templates: '{}' }],
      chapters: [{
        id: 12,
        project_id: 1,
        order_index: 0,
        title: 'Chuong 1',
        featured_characters: ['Mai'],
        key_events: ['Mai nghe tin ve Lan'],
      }],
      chapterMeta: [],
      characters: [
        { id: 101, project_id: 1, name: 'Lan', role: 'protagonist' },
        { id: 102, project_id: 1, name: 'Kha', role: 'supporting' },
        { id: 103, project_id: 1, name: 'Mai', role: 'supporting' },
      ],
      locations: [],
      objects: [],
      factions: [],
      worldTerms: [],
      plotThreads: [],
      relationships: [],
      canonFacts: [],
      taboos: [],
      scenes: [{
        id: 701,
        project_id: 1,
        chapter_id: 12,
        order_index: 0,
        title: 'Canh 1',
        pov_character_id: 101,
        characters_present: '[102]',
        draft_text: '',
        final_text: '',
      }],
      arcs: [],
      macro_arcs: [],
      threadBeats: [],
    });

    const ctx = await contextEngine.gatherContext({
      projectId: 1,
      chapterId: 12,
      sceneId: 701,
      sceneText: 'Mai dung ngoai cong.',
      taskType: TASK_TYPES.CONTINUE,
    });

    expect(ctx.characterContextGate.sceneCast.map((item) => item.character.name)).toEqual(['Lan', 'Kha']);
    expect(ctx.characterContextGate.chapterFocusCast.map((item) => item.character.name)).toEqual(['Mai']);
    expect(ctx.characters.map((item) => item.name)).toEqual(expect.arrayContaining(['Lan', 'Kha', 'Mai']));
    expect(buildRetrievalPacketMock).toHaveBeenCalledWith(expect.objectContaining({
      detectedCharacterIds: expect.arrayContaining([101, 102, 103]),
    }));
  });

  it('limits relationship injection to gated characters instead of expanding the whole network', async () => {
    const { contextEngine } = await loadContextEngine({
      projects: [{ id: 1, title: 'Du an thu', genre_primary: 'fantasy', prompt_templates: '{}' }],
      chapters: [{ id: 12, project_id: 1, order_index: 0, title: 'Chuong 1', featured_characters: ['Mai'] }],
      chapterMeta: [],
      characters: [
        { id: 101, project_id: 1, name: 'Lan', role: 'protagonist' },
        { id: 102, project_id: 1, name: 'Kha', role: 'supporting' },
        { id: 103, project_id: 1, name: 'Mai', role: 'supporting' },
        { id: 104, project_id: 1, name: 'Nam', role: 'supporting' },
      ],
      locations: [],
      objects: [],
      factions: [],
      worldTerms: [],
      plotThreads: [],
      relationships: [
        { id: 1, project_id: 1, character_a_id: 101, character_b_id: 102, relation_type: 'ally', description: 'Cung canh' },
        { id: 2, project_id: 1, character_a_id: 103, character_b_id: 104, relation_type: 'enemy', description: 'Ngoai canh' },
      ],
      canonFacts: [],
      taboos: [],
      scenes: [{
        id: 701,
        project_id: 1,
        chapter_id: 12,
        order_index: 0,
        title: 'Canh 1',
        pov_character_id: 101,
        characters_present: '[102]',
      }],
      arcs: [],
      macro_arcs: [],
      threadBeats: [],
    });

    const ctx = await contextEngine.gatherContext({
      projectId: 1,
      chapterId: 12,
      sceneId: 701,
      sceneText: '',
      taskType: TASK_TYPES.CONTINUE,
    });

    expect(ctx.relationships.map((item) => `${item.charA}/${item.charB}`)).toContain('Lan/Kha');
    expect(ctx.relationships.map((item) => `${item.charA}/${item.charB}`)).not.toContain('Mai/Nam');
  });

  it('collects canon role locks from the whole project even when locked characters are not in scene context', async () => {
    const { contextEngine } = await loadContextEngine({
      projects: [{ id: 1, title: 'Du an thu', genre_primary: 'fantasy', prompt_templates: '{}' }],
      chapters: [{ id: 12, project_id: 1, order_index: 0, title: 'Chuong 1', featured_characters: ['Lan'] }],
      chapterMeta: [],
      characters: [
        { id: 101, project_id: 1, name: 'Lan', role: 'protagonist' },
        {
          id: 102,
          project_id: 1,
          name: 'Minh',
          role: 'supporting',
          specific_role: 'nguoi tung phan boi hoi dong',
          specific_role_locked: true,
        },
        {
          id: 103,
          project_id: 1,
          name: 'Ha',
          role: 'supporting',
          specific_role: 'nguoi giu ban do co',
          specific_role_locked: false,
        },
      ],
      locations: [],
      objects: [],
      factions: [],
      worldTerms: [],
      plotThreads: [],
      relationships: [],
      canonFacts: [],
      taboos: [],
      scenes: [{
        id: 701,
        project_id: 1,
        chapter_id: 12,
        order_index: 0,
        title: 'Canh 1',
        pov_character_id: 101,
        characters_present: '[]',
      }],
      arcs: [],
      macro_arcs: [],
      threadBeats: [],
    });

    const ctx = await contextEngine.gatherContext({
      projectId: 1,
      chapterId: 12,
      sceneId: 701,
      sceneText: '',
      taskType: TASK_TYPES.CONTINUE,
    });

    expect(ctx.characters.map((item) => item.name)).toContain('Lan');
    expect(ctx.characters.map((item) => item.name)).not.toContain('Minh');
    expect(ctx.canonRoleLocks).toEqual([
      {
        characterId: 102,
        characterName: 'Minh',
        specificRole: 'nguoi tung phan boi hoi dong',
        locked: true,
      },
    ]);
  });
});
