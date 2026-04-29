import { beforeEach, describe, expect, it, vi } from 'vitest';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareByField(field) {
  return (left, right) => {
    const leftValue = left?.[field];
    const rightValue = right?.[field];
    if (leftValue === rightValue) return 0;
    if (leftValue == null) return -1;
    if (rightValue == null) return 1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  };
}

class MemoryQuery {
  constructor(table, field = null, rows = null) {
    this.table = table;
    this.field = field;
    this.rows = rows;
  }

  _baseRows() {
    return clone(this.rows || this.table.rows);
  }

  equals(expected) {
    return new MemoryQuery(
      this.table,
      this.field,
      this._baseRows().filter((row) => row?.[this.field] === expected),
    );
  }

  filter(predicate) {
    return new MemoryQuery(this.table, this.field, this._baseRows().filter(predicate));
  }

  async toArray() {
    return this._baseRows();
  }

  async first() {
    return this._baseRows()[0];
  }

  async sortBy(field) {
    return this._baseRows().sort(compareByField(field));
  }
}

class MemoryTable {
  constructor(rows = []) {
    this.rows = clone(rows);
    this.nextId = this.rows.reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0) + 1;
  }

  where(field) {
    return new MemoryQuery(this, field);
  }

  async toArray() {
    return clone(this.rows);
  }

  async get(id) {
    const row = this.rows.find((item) => item.id === id);
    return row ? clone(row) : undefined;
  }

  async add(record) {
    const next = clone(record);
    if (next.id == null) {
      next.id = this.nextId++;
    } else {
      this.nextId = Math.max(this.nextId, Number(next.id) + 1);
    }
    this.rows.push(next);
    return next.id;
  }

  async update(id, patch) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return 0;
    this.rows[index] = { ...this.rows[index], ...clone(patch) };
    return 1;
  }
}

function createMockDb(seed = {}) {
  const tableNames = [
    'projects',
    'chapters',
    'scenes',
    'characters',
    'locations',
    'objects',
    'worldTerms',
    'factions',
    'relationships',
    'taboos',
    'canonFacts',
  ];
  const db = {};
  for (const tableName of tableNames) {
    db[tableName] = new MemoryTable(seed[tableName] || []);
  }
  db.transaction = async (_mode, ...args) => {
    const fn = args[args.length - 1];
    return fn();
  };
  return db;
}

async function loadService(seed) {
  vi.resetModules();
  const db = createMockDb(seed);
  vi.doMock('../../services/db/database.js', () => ({ default: db }));
  const module = await import('../../services/projects/projectTemplateService.js');
  return { db, ...module };
}

describe('projectTemplateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a clean project from reusable Bible data and remaps dependent ids', async () => {
    const { db, createProjectFromBibleTemplate } = await loadService({
      projects: [{
        id: 1,
        title: 'Nguồn',
        description: 'Cốt truyện cũ',
        genre_primary: 'tien_hiep',
        tone: 'dark',
        pov_mode: 'third_omni',
        pronoun_style: 'tien_hiep',
        ai_strictness: 'strict',
        nsfw_mode: true,
        super_nsfw_mode: false,
        prompt_templates: JSON.stringify({ constitution: ['Luật cũ'] }),
        ai_guidelines: 'Giữ giọng lạnh.',
        world_name: 'Cửu Châu',
        world_type: 'tu tiên',
        world_scale: 'nhiều giới',
        world_era: 'thượng cổ',
        world_rules: JSON.stringify(['Linh khí có tầng bậc']),
        world_description: 'Thế giới cũ có thể dùng lại.',
        cloud_project_slug: 'old-cloud',
        cloud_last_synced_at: 123,
        updated_at: 10,
      }],
      chapters: [{ id: 10, project_id: 1, title: 'Chương cũ', order_index: 0 }],
      scenes: [{ id: 20, project_id: 1, chapter_id: 10, draft_text: 'Nội dung cũ' }],
      characters: [
        { id: 101, project_id: 1, name: 'Lý Minh', aliases: ['Minh'], role: 'protagonist', current_status: 'Đang ở ngoại môn', source_chapter_id: 10, source_kind: 'chapter_extract' },
        { id: 102, project_id: 1, name: 'A Dao', role: 'supporting' },
      ],
      locations: [{ id: 201, project_id: 1, name: 'Thanh Vân Tông', description: 'Tông môn lớn', source_chapter_id: 10, source_kind: 'chapter_extract' }],
      objects: [{ id: 301, project_id: 1, name: 'Ngọc bội', owner_character_id: 101, current_location_id: 201, source_chapter_id: 10, source_kind: 'chapter_extract' }],
      worldTerms: [{ id: 401, project_id: 1, name: 'Linh khí', category: 'magic', definition: 'Năng lượng tu luyện', source_chapter_id: 10, source_kind: 'chapter_extract' }],
      factions: [{ id: 501, project_id: 1, name: 'Thanh Vân Minh', faction_type: 'organization', source_chapter_id: 10, source_kind: 'chapter_extract' }],
      relationships: [{ id: 601, project_id: 1, character_a_id: 101, character_b_id: 102, relation_type: 'sư huynh muội', start_scene_id: 20 }],
      taboos: [{ id: 701, project_id: 1, character_id: 101, description: 'Không biết thân thế', effective_before_chapter: 20 }],
      canonFacts: [{ id: 801, project_id: 1, subject_type: 'character', subject_id: 101, description: 'Lý Minh chưa biết thân thế', fact_type: 'fact', source_chapter_id: 10 }],
    });

    const result = await createProjectFromBibleTemplate({
      sourceProjectId: 1,
      projectData: {
        title: 'Truyện mới',
        description: 'Một hướng truyện mới.',
        synopsis: 'Nhân vật đi theo tuyến mới.',
      },
      initialChapterCount: 1,
    });

    const newProject = await db.projects.get(result.projectId);
    expect(newProject).toMatchObject({
      title: 'Truyện mới',
      description: 'Một hướng truyện mới.',
      synopsis: 'Nhân vật đi theo tuyến mới.',
      genre_primary: 'tien_hiep',
      tone: 'dark',
      pov_mode: 'third_omni',
      pronoun_style: 'tien_hiep',
      world_name: 'Cửu Châu',
      project_mode: 'original',
    });
    expect(newProject.cloud_project_slug).toBeUndefined();
    expect(newProject.cloud_last_synced_at).toBeUndefined();

    const newChapters = (await db.chapters.toArray()).filter((chapter) => chapter.project_id === result.projectId);
    const newScenes = (await db.scenes.toArray()).filter((scene) => scene.project_id === result.projectId);
    expect(newChapters).toHaveLength(1);
    expect(newChapters[0].title).toBe('Chương 1');
    expect(newScenes).toHaveLength(1);
    expect(newScenes[0].draft_text).toBe('');

    const newCharacters = (await db.characters.toArray()).filter((item) => item.project_id === result.projectId);
    const newLocations = (await db.locations.toArray()).filter((item) => item.project_id === result.projectId);
    const newObjects = (await db.objects.toArray()).filter((item) => item.project_id === result.projectId);
    const newRelationships = (await db.relationships.toArray()).filter((item) => item.project_id === result.projectId);
    const newTaboos = (await db.taboos.toArray()).filter((item) => item.project_id === result.projectId);
    const copiedOwner = newCharacters.find((item) => item.name === 'Lý Minh');
    const copiedPeer = newCharacters.find((item) => item.name === 'A Dao');
    const copiedLocation = newLocations.find((item) => item.name === 'Thanh Vân Tông');

    expect(copiedOwner.source_chapter_id).toBeNull();
    expect(copiedOwner.source_kind).toBe('bible_template_transfer');
    expect(copiedLocation.source_chapter_id).toBeNull();
    expect(copiedLocation.source_kind).toBe('bible_template_transfer');
    expect(newObjects[0].owner_character_id).toBe(copiedOwner.id);
    expect(newObjects[0].current_location_id).toBe(copiedLocation.id);
    expect(newObjects[0].source_chapter_id).toBeNull();
    expect(newObjects[0].source_kind).toBe('bible_template_transfer');
    expect(newLocations[0].source_kind).toBe('bible_template_transfer');
    expect(newRelationships[0].character_a_id).toBe(copiedOwner.id);
    expect(newRelationships[0].character_b_id).toBe(copiedPeer.id);
    expect(newRelationships[0].start_scene_id).toBeNull();
    expect(newTaboos[0].character_id).toBe(copiedOwner.id);
    expect((await db.canonFacts.toArray()).filter((item) => item.project_id === result.projectId)).toHaveLength(0);
  });

  it('copies canon facts only when requested and remaps their subjects', async () => {
    const { db, createProjectFromBibleTemplate } = await loadService({
      projects: [{ id: 1, title: 'Nguồn', genre_primary: 'fantasy', world_rules: '[]' }],
      characters: [{ id: 101, project_id: 1, name: 'Lý Minh' }],
      locations: [{ id: 201, project_id: 1, name: 'Động phủ' }],
      canonFacts: [
        { id: 801, project_id: 1, subject_type: 'character', subject_id: 101, description: 'Lý Minh là người giữ khóa', fact_type: 'fact', source_chapter_id: 10, source_scene_id: 20 },
        { id: 802, project_id: 1, subject_type: 'location', subject_id: 201, description: 'Động phủ nằm dưới núi', fact_type: 'rule', source_revision_id: 99 },
      ],
    });

    const result = await createProjectFromBibleTemplate({
      sourceProjectId: 1,
      projectData: { title: 'Truyện mới' },
      include: { canonFacts: true },
      initialChapterCount: 0,
    });

    const newCharacters = (await db.characters.toArray()).filter((item) => item.project_id === result.projectId);
    const newLocations = (await db.locations.toArray()).filter((item) => item.project_id === result.projectId);
    const newFacts = (await db.canonFacts.toArray()).filter((item) => item.project_id === result.projectId);

    expect(newFacts).toHaveLength(2);
    expect(newFacts.find((item) => item.subject_type === 'character').subject_id).toBe(newCharacters[0].id);
    expect(newFacts.find((item) => item.subject_type === 'location').subject_id).toBe(newLocations[0].id);
    expect(newFacts[0].source_chapter_id).toBeNull();
    expect(newFacts[0].source_scene_id).toBeNull();
    expect(newFacts[1].source_revision_id).toBeNull();
  });

  it('does not copy character-dependent data when characters are excluded', async () => {
    const { db, createProjectFromBibleTemplate } = await loadService({
      projects: [{ id: 1, title: 'Nguồn', genre_primary: 'fantasy', world_rules: '[]' }],
      characters: [{ id: 101, project_id: 1, name: 'Lý Minh' }, { id: 102, project_id: 1, name: 'A Dao' }],
      objects: [{ id: 301, project_id: 1, name: 'Ngọc bội', owner_character_id: 101 }],
      relationships: [{ id: 601, project_id: 1, character_a_id: 101, character_b_id: 102, relation_type: 'đồng hành' }],
      taboos: [
        { id: 701, project_id: 1, character_id: 101, description: 'Taboo riêng' },
        { id: 702, project_id: 1, character_id: null, description: 'Taboo chung' },
      ],
    });

    const result = await createProjectFromBibleTemplate({
      sourceProjectId: 1,
      projectData: { title: 'Truyện mới' },
      include: {
        characters: false,
        objects: true,
        relationships: true,
        taboos: true,
      },
      initialChapterCount: 0,
    });

    expect((await db.characters.toArray()).filter((item) => item.project_id === result.projectId)).toHaveLength(0);
    const newObjects = (await db.objects.toArray()).filter((item) => item.project_id === result.projectId);
    expect(newObjects).toHaveLength(1);
    expect(newObjects[0].owner_character_id).toBeNull();
    expect((await db.relationships.toArray()).filter((item) => item.project_id === result.projectId)).toHaveLength(0);
    expect((await db.taboos.toArray()).filter((item) => item.project_id === result.projectId)).toHaveLength(0);
  });

  it('summarizes reusable groups without treating empty world rules as a world profile', async () => {
    const { getBibleTemplateSourceSummary } = await loadService({
      projects: [
        { id: 1, title: 'Nguồn rỗng', genre_primary: 'fantasy', world_rules: '[]' },
        { id: 2, title: 'Nguồn có luật', genre_primary: 'fantasy', world_rules: JSON.stringify(['Linh khí có tầng bậc']) },
      ],
      characters: [{ id: 101, project_id: 2, name: 'Lý Minh' }],
      canonFacts: [{ id: 801, project_id: 2, subject_type: 'character', subject_id: 101, description: 'Fact nền' }],
    });

    const emptyWorld = await getBibleTemplateSourceSummary(1);
    const worldWithRules = await getBibleTemplateSourceSummary(2);

    expect(emptyWorld.counts.worldProfile).toBe(0);
    expect(worldWithRules.counts.worldProfile).toBe(1);
    expect(worldWithRules.counts.characters).toBe(1);
    expect(worldWithRules.counts.canonFacts).toBe(1);
  });
});
