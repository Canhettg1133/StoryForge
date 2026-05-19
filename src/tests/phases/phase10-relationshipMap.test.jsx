/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  aiState,
  codexState,
  dbRows,
  projectState,
  suggestionState,
  rebuildFlaggedCanonProjectsMock,
  scheduleBackgroundCanonRebuildMock,
} = vi.hoisted(() => ({
  aiState: {},
  codexState: {},
  dbRows: {
    chapterMetas: [],
    relationships: [],
    relationshipStates: [],
    storyEvents: [],
  },
  projectState: {},
  suggestionState: {},
  rebuildFlaggedCanonProjectsMock: vi.fn(async () => []),
  scheduleBackgroundCanonRebuildMock: vi.fn(),
}));

function makeProjectTable(getRows) {
  return {
    where: vi.fn(() => ({
      equals: vi.fn(() => ({
        toArray: vi.fn(async () => getRows()),
      })),
    })),
    add: vi.fn(async (record) => {
      const rows = getRows();
      const id = record?.id || rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
      rows.push({ id, ...record });
      return id;
    }),
    update: vi.fn(async (id, patch) => {
      const rows = getRows();
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...patch };
      return 1;
    }),
    delete: vi.fn(async (id) => {
      const rows = getRows();
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return 1;
    }),
  };
}

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../stores/suggestionStore', () => ({
  default: () => suggestionState,
}));

vi.mock('../../stores/aiStore', () => ({
  default: () => aiState,
}));

vi.mock('../../services/db/database', () => ({
  default: {
    chapterMeta: makeProjectTable(() => dbRows.chapterMetas),
    relationships: makeProjectTable(() => dbRows.relationships),
    relationship_state_current: makeProjectTable(() => dbRows.relationshipStates),
    story_events: makeProjectTable(() => dbRows.storyEvents),
    projects: {
      update: vi.fn(async () => 1),
    },
  },
  rebuildFlaggedCanonProjects: rebuildFlaggedCanonProjectsMock,
  scheduleBackgroundCanonRebuild: scheduleBackgroundCanonRebuildMock,
}));

import db from '../../services/db/database';
import RelationshipMap from '../../components/common/RelationshipMap.jsx';

function normalizedText(node) {
  return (node.textContent || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function setSelectValue(select, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(select, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(select, value);
  } else {
    select.value = value;
  }
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('phase10 relationship cockpit V1', () => {
  let container;
  let root;

  beforeEach(() => {
    Object.assign(projectState, {
      currentProject: { id: 1, title: 'Dự án thử' },
      chapters: [
        { id: 7, project_id: 1, order_index: 0, title: 'Chương 7' },
        { id: 8, project_id: 1, order_index: 1, title: 'Chương 8' },
        { id: 9, project_id: 1, order_index: 2, title: 'Chương trống' },
      ],
      scenes: [
        { id: 70, project_id: 1, chapter_id: 7, order_index: 0, title: 'Cảnh 1', draft_text: '<p>Lan trao thư cho Kha.</p>' },
        { id: 80, project_id: 1, chapter_id: 8, order_index: 0, title: 'Cảnh 1', draft_text: '<p>Kha im lặng.</p>' },
        { id: 90, project_id: 1, chapter_id: 9, order_index: 0, title: 'Cảnh 1', draft_text: '' },
      ],
    });
    Object.assign(codexState, {
      characters: [
        { id: 1, project_id: 1, name: 'Lan', role: 'chính' },
        { id: 2, project_id: 1, name: 'Kha', role: 'chính' },
        { id: 3, project_id: 1, name: 'Mai', role: 'phụ' },
        { id: 4, project_id: 1, name: 'Nam', role: 'phụ' },
      ],
    });
    Object.assign(suggestionState, {
      suggestions: [],
      loadSuggestions: vi.fn(async () => {}),
      acceptSuggestion: vi.fn(async () => {}),
      rejectSuggestion: vi.fn(async () => {}),
    });
    Object.assign(aiState, {
      isAnalyzingRelationships: false,
      relationshipAnalysisProgress: null,
      analyzeRelationshipChapters: vi.fn(async () => ({ status: 'completed', analyzedChapterCount: 1, requestCount: 1, createdCount: 0, skippedDuplicateCount: 0, failedChapterIds: [] })),
      analyzeNeededRelationshipChapters: vi.fn(async () => ({ status: 'completed', analyzedChapterCount: 1, requestCount: 1, createdCount: 0, skippedDuplicateCount: 0, failedChapterIds: [] })),
    });
    dbRows.relationships = [
      { id: 10, project_id: 1, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Bạn cũ còn tin nhau.' },
      { id: 11, project_id: 1, character_a_id: 3, character_b_id: 4, relation_type: 'rival', description: 'Đối thủ âm thầm.' },
    ];
    dbRows.relationshipStates = [
      {
        id: 20,
        project_id: 1,
        pair_key: '1:2',
        character_a_id: 1,
        character_b_id: 2,
        relationship_type: 'ally',
        intimacy_level: 'medium',
        secrecy_state: 'secret',
        consent_state: 'mutual',
        emotional_aftermath: 'Còn nợ nhau một lời hứa.',
        summary: 'Đồng minh kín.',
      },
      {
        id: 21,
        project_id: 1,
        pair_key: '3:4',
        character_a_id: 3,
        character_b_id: 4,
        relationship_type: 'other',
        intimacy_level: 'none',
        secrecy_state: 'public',
        consent_state: 'unknown',
        emotional_aftermath: 'Sự phẫn nộ và tủi nhục khiến Mai cảnh giác hơn.',
        summary: 'Quan hệ chưa rõ.',
      },
    ];
    dbRows.storyEvents = [
      { id: 30, project_id: 1, op_type: 'RELATIONSHIP_STATUS_CHANGED', subject_id: 1, target_id: 2 },
    ];
    dbRows.chapterMetas = [
      {
        id: 40,
        project_id: 1,
        chapter_id: 8,
        relationship_analysis_signature: 'stale-signature',
        relationship_analysis_status: 'analyzed',
      },
    ];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function renderMap() {
    await act(async () => {
      root.render(<RelationshipMap onClose={vi.fn()} />);
    });
    await flushEffects();
    await flushEffects();
  }

  function findButton(label) {
    return Array.from(container.querySelectorAll('button'))
      .find((button) => normalizedText(button).includes(label));
  }

  it('renders the compact Vietnamese V1 tabs without a history shell', async () => {
    await renderMap();

    const text = normalizedText(container);
    expect(text).toContain('Tap trung');
    expect(text).toContain('So do');
    expect(text).toContain('Can duyet');
    expect(text).not.toContain('Lich su');
  });

  it('opens the selected pair in focus when clicking a static graph edge', async () => {
    await renderMap();

    await act(async () => {
      findButton('So do').click();
    });

    const maiNamEdge = Array.from(container.querySelectorAll('.rel-edge'))
      .find((button) => {
        const text = normalizedText(button);
        return text.includes('Mai') && text.includes('Nam');
      });
    expect(maiNamEdge).toBeTruthy();

    await act(async () => {
      maiNamEdge.click();
    });

    const text = normalizedText(container);
    expect(text).toContain('Tap trung');
    expect(text).toContain('Mai');
    expect(text).toContain('Nam');
    expect(text).toContain('Doi thu am tham');
    expect(text).toContain('Cong khai');
    expect(text).toContain('Chua than mat');
    expect(text).toContain('Chua ro');
    expect(text).not.toContain('public');
    expect(text).not.toContain('none');
    expect(text).not.toContain('unknown');
  });

  it('merges an edited baseline into an existing reversed pair instead of leaving duplicates', async () => {
    await renderMap();

    await act(async () => {
      findButton('Sua nen').click();
    });

    const selects = Array.from(container.querySelectorAll('.rel-form select'));
    expect(selects).toHaveLength(3);

    db.relationships.update.mockClear();
    db.relationships.delete.mockClear();

    await act(async () => {
      setSelectValue(selects[0], '4');
      setSelectValue(selects[1], '3');
    });
    await act(async () => {
      findButton('Cap nhat').click();
    });

    expect(db.relationships.update).toHaveBeenCalledWith(11, expect.objectContaining({
      character_a_id: 4,
      character_b_id: 3,
    }));
    expect(db.relationships.delete).toHaveBeenCalledWith(10);
  });

  it('warns about duplicate baseline relationships and merges them on explicit cleanup', async () => {
    dbRows.relationships = [
      { id: 10, project_id: 1, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Bạn cũ còn tin nhau.', created_at: 100 },
      { id: 12, project_id: 1, character_a_id: 2, character_b_id: 1, relation_type: 'enemy', description: 'Vừa có thù mới.', updated_at: 300 },
      { id: 13, project_id: 1, character_a_id: 1, character_b_id: 2, relation_type: 'friend', description: 'Bạn cũ còn tin nhau.', updated_at: 200 },
    ];

    await renderMap();

    expect(normalizedText(container)).toContain('Co du lieu quan he bi trung');
    expect(normalizedText(container)).toContain('1 cap nen');

    db.relationships.update.mockClear();
    db.relationships.delete.mockClear();
    db.projects.update.mockClear();
    scheduleBackgroundCanonRebuildMock.mockClear();
    rebuildFlaggedCanonProjectsMock.mockClear();

    await act(async () => {
      findButton('Don quan he trung').click();
    });
    await flushEffects();

    expect(dbRows.relationships).toHaveLength(1);
    expect(dbRows.relationships[0]).toMatchObject({
      id: 12,
      relation_type: 'enemy',
    });
    expect(dbRows.relationships[0].description).toContain('Vừa có thù mới.');
    expect(dbRows.relationships[0].description).toContain('Bạn cũ còn tin nhau.');
    expect(dbRows.relationships[0].description).toContain('Đã gộp loại nền cũ: Bạn bè.');
    expect(db.relationships.update).toHaveBeenCalledWith(12, expect.objectContaining({
      description: expect.stringContaining('Đã gộp loại nền cũ: Bạn bè.'),
    }));
    expect(db.relationships.delete).toHaveBeenCalledWith(10);
    expect(db.relationships.delete).toHaveBeenCalledWith(13);
    expect(db.projects.update).toHaveBeenCalledWith(1, expect.objectContaining({
      canon_rebuild_required: true,
    }));
    expect(rebuildFlaggedCanonProjectsMock).toHaveBeenCalled();
    expect(normalizedText(container)).toContain('Da don quan he trung');
  });

  it('marks projection rebuild for duplicate current relationship cache without writing to the cache by hand', async () => {
    dbRows.relationshipStates = [
      ...dbRows.relationshipStates,
      {
        id: 22,
        project_id: 1,
        pair_key: '1:2',
        character_a_id: 2,
        character_b_id: 1,
        relationship_type: 'enemy',
      },
    ];

    await renderMap();

    expect(normalizedText(container)).toContain('Co du lieu quan he bi trung');
    expect(normalizedText(container)).toContain('1 cap trang thai hien hanh');

    db.relationships.update.mockClear();
    db.relationships.delete.mockClear();
    db.relationship_state_current.update.mockClear();
    db.relationship_state_current.delete.mockClear();
    scheduleBackgroundCanonRebuildMock.mockClear();
    rebuildFlaggedCanonProjectsMock.mockClear();

    await act(async () => {
      findButton('Don quan he trung').click();
    });

    expect(db.relationships.update).not.toHaveBeenCalled();
    expect(db.relationships.delete).not.toHaveBeenCalled();
    expect(db.relationship_state_current.update).not.toHaveBeenCalled();
    expect(db.relationship_state_current.delete).not.toHaveBeenCalled();
    expect(rebuildFlaggedCanonProjectsMock).toHaveBeenCalled();
  });

  it('reloads relationship states when returning to the focus tab', async () => {
    await renderMap();
    await act(async () => {
      findButton('Can duyet').click();
    });

    dbRows.relationshipStates = [...dbRows.relationshipStates, {
      id: 90,
      project_id: 1,
      pair_key: '1:3',
      character_a_id: 1,
      character_b_id: 3,
      relationship_type: 'rival',
      summary: 'Lan và Mai vừa chuyển sang nghi ngờ nhau.',
    }];

    await act(async () => {
      findButton('Tap trung').click();
    });
    await flushEffects();

    const lanMaiPair = Array.from(container.querySelectorAll('.rel-pair-button'))
      .find((button) => {
        const text = normalizedText(button);
        return text.includes('Lan') && text.includes('Mai');
      });
    expect(lanMaiPair).toBeTruthy();
  });

  it('can remove a canon current relationship by superseding its relationship events and rebuilding projection', async () => {
    dbRows.relationships = [];
    dbRows.relationshipStates = [{
      id: 90,
      project_id: 1,
      pair_key: '1:3',
      character_a_id: 1,
      character_b_id: 3,
      relationship_type: 'rival',
      summary: 'Lan và Mai nghi ngờ nhau.',
    }];
    dbRows.storyEvents = [
      { id: 301, project_id: 1, op_type: 'RELATIONSHIP_STATUS_CHANGED', subject_id: 1, target_id: 3, status: 'committed' },
      { id: 302, project_id: 1, op_type: 'RELATIONSHIP_SECRET_CHANGED', subject_id: 3, target_id: 1, status: 'committed' },
      { id: 303, project_id: 1, op_type: 'CHARACTER_STATUS_CHANGED', subject_id: 1, target_id: 3, status: 'committed' },
    ];
    rebuildFlaggedCanonProjectsMock.mockImplementationOnce(async () => {
      dbRows.relationshipStates = [];
      return [1];
    });

    await renderMap();

    expect(normalizedText(container)).toContain('Lan');
    expect(normalizedText(container)).toContain('Mai');

    await act(async () => {
      findButton('Xoa hien tai').click();
    });
    await flushEffects();

    expect(dbRows.storyEvents.find((event) => event.id === 301).status).toBe('superseded');
    expect(dbRows.storyEvents.find((event) => event.id === 302).status).toBe('superseded');
    expect(dbRows.storyEvents.find((event) => event.id === 303).status).toBe('committed');
    expect(rebuildFlaggedCanonProjectsMock).toHaveBeenCalled();
    expect(normalizedText(container)).toContain('Chua co quan he');
  });

  it('labels current-only relationships as canon state instead of pretending they are pinned baseline rows', async () => {
    dbRows.relationships = [];
    dbRows.relationshipStates = [{
      id: 90,
      project_id: 1,
      pair_key: '1:3',
      character_a_id: 1,
      character_b_id: 3,
      relationship_type: 'mentor',
      summary: 'Lan xác lập quan hệ sư đồ thực chất với Mai.',
      secrecy_state: 'public',
    }];
    dbRows.storyEvents = Array.from({ length: 24 }, (_, index) => ({
      id: 400 + index,
      project_id: 1,
      op_type: index % 2 === 0 ? 'RELATIONSHIP_STATUS_CHANGED' : 'RELATIONSHIP_SECRET_CHANGED',
      subject_id: 1,
      target_id: 3,
      status: 'committed',
    }));

    await renderMap();

    const text = normalizedText(container);
    expect(text).toContain('1 cap dang theo doi');
    expect(text).toContain('Hien hanh');
    expect(text).toContain('Tu chuan truyen');
    expect(text).toContain('Chua co nen');
    expect(text).toContain('Cap nay co 24 thay doi chuan truyen dang tao trang thai hien hanh');
    expect(text).not.toContain('Nen tac giaKhac');
    expect(text).not.toContain('Sua quan he nen la chinh nguoc');
  });

  it('groups pending relationship suggestions by chapter and pair', async () => {
    suggestionState.suggestions = [
      {
        id: 101,
        status: 'pending',
        type: 'relationship_update',
        source_chapter_id: 7,
        target_name: 'Lan / Kha',
        suggested_value: 'Lan nghi ngờ Kha.',
        reasoning: 'Lan thấy Kha giấu thư.',
      },
      {
        id: 102,
        status: 'pending',
        type: 'relationship_update',
        source_chapter_id: 7,
        target_name: 'Lan / Kha',
        suggested_value: 'Bí mật giữa hai người bị đẩy cao.',
        reasoning: 'Cả hai né tránh câu hỏi.',
      },
    ];

    await renderMap();
    await act(async () => {
      findButton('Can duyet').click();
    });

    expect(container.querySelectorAll('.rel-suggestion-group')).toHaveLength(1);
    const suggestionCopy = container.querySelector('.rel-suggestion-copy');
    expect(suggestionCopy).toBeTruthy();
    expect(normalizedText(suggestionCopy)).toContain('Lan nghi ngo Kha');
    expect(normalizedText(suggestionCopy)).toContain('Lan thay Kha giau thu');
    expect(normalizedText(container)).toContain('2 de xuat');
  });

  it('renders the relationship analysis controls and Vietnamese chapter statuses', async () => {
    suggestionState.suggestions = [
      {
        id: 101,
        status: 'pending',
        type: 'relationship_update',
        source_chapter_id: 7,
        target_name: 'Lan / Kha',
        suggested_value: 'Lan nghi ngờ Kha.',
      },
    ];

    await renderMap();
    await act(async () => {
      findButton('Can duyet').click();
    });

    const text = normalizedText(container);
    expect(text).toContain('Phan tich quan he');
    expect(text).toContain('Phan tich chuong nay');
    expect(text).toContain('Phan tich cac chuong can phan tich');
    expect(text).toContain('Chua phan tich');
    expect(text).toContain('Can phan tich lai');
    expect(text).toContain('Da phan tich');
    expect(text).toContain('Chua co noi dung');
    expect(text).toContain('Co de xuat');
  });

  it('runs single-chapter and needed-chapter relationship analysis from the review tab', async () => {
    await renderMap();
    await act(async () => {
      findButton('Can duyet').click();
    });

    const chapterSelect = container.querySelector('.rel-analysis-panel select');
    expect(chapterSelect).toBeTruthy();

    await act(async () => {
      setSelectValue(chapterSelect, '8');
    });
    await act(async () => {
      findButton('Phan tich chuong nay').click();
    });

    expect(aiState.analyzeRelationshipChapters).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 1,
      chapterIds: [8],
      force: true,
    }));

    await act(async () => {
      findButton('Phan tich cac chuong can phan tich').click();
    });

    expect(aiState.analyzeNeededRelationshipChapters).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 1,
    }));
  });

  it('lets the author select chapters and force relationship reanalysis', async () => {
    await renderMap();
    await act(async () => {
      findButton('Can duyet').click();
    });

    await act(async () => {
      findButton('Chon chuong').click();
    });

    expect(normalizedText(container)).toContain('Phan tich cac chuong da chon');

    await act(async () => {
      findButton('Chon chuong can phan tich').click();
    });

    expect(normalizedText(container)).toContain('Da chon 2 chuong');

    await act(async () => {
      findButton('Phan tich cac chuong da chon').click();
    });

    expect(aiState.analyzeRelationshipChapters).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 1,
      chapterIds: [7, 8],
      force: true,
    }));

    await act(async () => {
      findButton('Chon tat ca chuong co noi dung').click();
    });
    expect(normalizedText(container)).toContain('Da chon 2 chuong');

    await act(async () => {
      findButton('Bo chon').click();
    });
    expect(normalizedText(container)).toContain('Da chon 0 chuong');
  });

  it('shows an approved relationship suggestion in the focus pair list after projection reloads', async () => {
    suggestionState.suggestions = [
      {
        id: 201,
        status: 'pending',
        type: 'relationship_update',
        source_chapter_id: 7,
        target_name: 'Lan / Mai',
        suggested_value: 'Lan và Mai chuyển sang nghi ngờ nhau.',
      },
    ];
    suggestionState.acceptSuggestion = vi.fn(async () => {
      dbRows.relationshipStates = [...dbRows.relationshipStates, {
        id: 88,
        project_id: 1,
        pair_key: '1:3',
        character_a_id: 1,
        character_b_id: 3,
        relationship_type: 'rival',
        intimacy_level: 'low',
        secrecy_state: 'secret',
        consent_state: 'contested',
        emotional_aftermath: 'Cả hai còn đề phòng nhau.',
        summary: 'Lan và Mai chuyển sang nghi ngờ nhau.',
      }];
    });

    await renderMap();
    await act(async () => {
      findButton('Can duyet').click();
    });
    await act(async () => {
      findButton('Duyet').click();
    });
    await flushEffects();
    await act(async () => {
      findButton('Tap trung').click();
    });

    const lanMaiPair = Array.from(container.querySelectorAll('.rel-pair-button'))
      .find((button) => {
        const text = normalizedText(button);
        return text.includes('Lan') && text.includes('Mai');
      });
    expect(lanMaiPair).toBeTruthy();
  });
});
