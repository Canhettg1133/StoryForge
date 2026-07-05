import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import StoryBibleSummariesSection from '../../pages/StoryBible/sections/StoryBibleSummariesSection.jsx';
import StoryBibleWorldLoreSummarySection from '../../pages/StoryBible/sections/StoryBibleWorldLoreSummarySection.jsx';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class StoryBibleQuery {
  constructor(table, field = null, rows = null) {
    this.table = table;
    this.field = field;
    this.rows = rows;
  }

  _rows() {
    return this.rows ? clone(this.rows) : clone(this.table.rows);
  }

  equals(expected) {
    return new StoryBibleQuery(
      this.table,
      this.field,
      this._rows().filter((row) => row?.[this.field] === expected),
    );
  }

  async toArray() {
    this.table.toArrayCalls += 1;
    if (this.table.blockToArray) {
      throw new Error(`Unexpected full load for ${this.table.name}`);
    }
    return this._rows();
  }

  async count() {
    this.table.countCalls += 1;
    return this._rows().length;
  }
}

class StoryBibleTable {
  constructor(name, rows = [], options = {}) {
    this.name = name;
    this.rows = clone(rows);
    this.blockToArray = Boolean(options.blockToArray);
    this.toArrayCalls = 0;
    this.countCalls = 0;
  }

  where(field) {
    return new StoryBibleQuery(this, field);
  }
}

async function loadCodexStoreWithDb(db) {
  vi.resetModules();
  vi.doMock('../../services/db/database', () => ({ default: db }));
  vi.doMock('../../services/canon/state', () => ({
    buildCharacterStateSummary: vi.fn(() => 'summary'),
  }));
  vi.doMock('../../services/entityIdentity/index.js', () => ({
    normalizeEntityIdentity: vi.fn((_kind, input = {}) => ({
      normalized_name: String(input?.name || '').toLowerCase(),
      alias_keys: [],
      identity_key: String(input?.name || '').toLowerCase(),
    })),
  }));
  vi.doMock('../../services/entityIdentity/factIdentity.js', () => ({
    normalizeCanonFactRecord: vi.fn((input = {}) => ({
      fact_fingerprint: input.fact_fingerprint || String(input.description || ''),
    })),
  }));
  vi.doMock('../../utils/proseBuffer', () => ({
    buildProseBuffer: vi.fn(() => ''),
  }));
  vi.doMock('../../utils/characterIdentity', () => ({
    findCharacterIdentityMatch: vi.fn(() => null),
    mergeCharacterPatch: vi.fn(() => ({})),
  }));

  const module = await import('../../stores/codexStore.js');
  return module.default;
}

describe('phase20 StoryBible world lore summary', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.doUnmock('../../services/db/database');
    vi.doUnmock('../../services/canon/state');
    vi.doUnmock('../../services/entityIdentity/index.js');
    vi.doUnmock('../../services/entityIdentity/factIdentity.js');
    vi.doUnmock('../../utils/proseBuffer');
    vi.doUnmock('../../utils/characterIdentity');
  });

  it('renders a compact shortcut with accented Vietnamese labels and count badges', async () => {
    const onNavigate = vi.fn();
    const onToggle = vi.fn();

    await act(async () => {
      root.render(
        <StoryBibleWorldLoreSummarySection
          counts={{ locations: 12, objects: 7, terms: 4 }}
          isOpen
          onNavigate={onNavigate}
          onToggle={onToggle}
        />,
      );
    });

    const text = container.textContent;
    expect(text).toContain('Thế giới & Lore');
    expect(text).toContain('Địa điểm');
    expect(text).toContain('Vật phẩm');
    expect(text).toContain('Thuật ngữ');
    expect(text).toContain('Mở Thế giới');
    expect(text).toContain('12');
    expect(text).toContain('7');
    expect(text).toContain('4');
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0);

    const openWorldButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Mở Thế giới'));
    expect(openWorldButton).toBeTruthy();

    await act(async () => {
      openWorldButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledWith('/world');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not wire the full editable world lore sections into StoryBible', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/StoryBible/StoryBible.jsx'), 'utf8');

    expect(source).toContain('StoryBibleWorldLoreSummarySection');
    expect(source).not.toContain('StoryBibleLocationsSection');
    expect(source).not.toContain('StoryBibleObjectsSection');
    expect(source).not.toContain('StoryBibleTermsSection');
  });

  it('renders summaries by chapter id even when metadata arrives out of order', async () => {
    await act(async () => {
      root.render(
        <StoryBibleSummariesSection
          chapterMetas={[
            { id: 20, chapter_id: 2, summary: 'Tóm tắt chương hai.' },
            { id: 10, chapter_id: 1, summary: 'Tóm tắt chương một.' },
          ]}
          chapters={[
            { id: 1, title: 'Chương 1' },
            { id: 2, title: 'Chương 2' },
          ]}
          isOpen
          onToggle={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Tóm tắt chương một.');
    expect(container.textContent).toContain('Tóm tắt chương hai.');
  });

  it('uses a chapter meta map instead of repeated chapterMetas.find lookups', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/StoryBible/sections/StoryBibleSummariesSection.jsx'),
      'utf8',
    );

    expect(source).toContain('new Map');
    expect(source).not.toContain('chapterMetas.find');
  });

  it('loads Story Bible world lore counts without loading full world lore lists', async () => {
    const db = {
      characters: new StoryBibleTable('characters', [{ id: 1, project_id: 1, name: 'Lan' }]),
      locations: new StoryBibleTable(
        'locations',
        [
          { id: 10, project_id: 1, name: 'Kinh thành' },
          { id: 11, project_id: 1, name: 'Hải cảng' },
          { id: 12, project_id: 2, name: 'Ngoài dự án' },
        ],
        { blockToArray: true },
      ),
      objects: new StoryBibleTable(
        'objects',
        [{ id: 20, project_id: 1, name: 'Ấn đồng' }],
        { blockToArray: true },
      ),
      worldTerms: new StoryBibleTable(
        'worldTerms',
        [
          { id: 30, project_id: 1, name: 'Linh lực' },
          { id: 31, project_id: 1, name: 'Khế ước' },
        ],
        { blockToArray: true },
      ),
      factions: new StoryBibleTable('factions', []),
      taboos: new StoryBibleTable('taboos', []),
      canonFacts: new StoryBibleTable('canonFacts', []),
      chapterMeta: new StoryBibleTable('chapterMeta', []),
      entity_state_current: new StoryBibleTable('entity_state_current', []),
    };

    const store = await loadCodexStoreWithDb(db);
    await store.getState().loadStoryBibleCodex(1);

    expect(db.locations.toArrayCalls).toBe(0);
    expect(db.objects.toArrayCalls).toBe(0);
    expect(db.worldTerms.toArrayCalls).toBe(0);
    expect(db.locations.countCalls).toBe(1);
    expect(db.objects.countCalls).toBe(1);
    expect(db.worldTerms.countCalls).toBe(1);
    expect(store.getState().storyBibleWorldCounts).toEqual({
      locations: 2,
      objects: 1,
      terms: 2,
    });
    expect(store.getState().locations).toEqual([]);
    expect(store.getState().objects).toEqual([]);
    expect(store.getState().worldTerms).toEqual([]);
  });
});
