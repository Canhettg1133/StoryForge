import 'fake-indexeddb/auto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adversarialCanonResponse,
  allCanonOpTypes,
  canonicalResponsesByChapter,
  canonCompletionStory,
  entityResponsesByChapter,
} from '../fixtures/canonCompletionStory.js';

const harness = vi.hoisted(() => ({
  canonResponses: [],
  canonRequests: [],
  aiSend: vi.fn(),
  summarizeChapter: vi.fn(),
  extractFromChapter: vi.fn(),
}));

vi.mock('../../services/ai/client', () => ({
  default: {
    send: harness.aiSend,
    abort: vi.fn(),
    setRouter: vi.fn(),
  },
}));

vi.mock('../../stores/aiStore', () => ({
  default: {
    getState: () => ({
      summarizeChapter: harness.summarizeChapter,
      extractFromChapter: harness.extractFromChapter,
    }),
  },
}));

import db from '../../services/db/database.js';
import { canonicalizeChapter } from '../../services/canon/workflow.js';
import {
  buildRetrievalPacket,
  getChapterCanonState,
  getProjectCanonOverview,
} from '../../services/canon/queries.js';
import useCodexStore from '../../stores/codexStore.js';
import useProjectStore from '../../stores/projectStore.js';
import useSuggestionStore from '../../stores/suggestionStore.js';

const PROJECT_ID = canonCompletionStory.project.id;
const MANUAL_AUDIT_ENABLED = process.env.STORYFORGE_MANUAL_COMPLETION_AUDIT === '1';
const MANUAL_AUDIT_PATH = path.resolve('.codex-artifacts/manual-completion-audit.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function enqueueCanonResponse(value) {
  harness.canonResponses.push(clone(value));
}

function canonResponseVariant(response, variant) {
  if (variant === 'object') return response;
  if (variant === 'fenced_json') {
    return `\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``;
  }
  return `\n  ${JSON.stringify(response)}  \n`;
}

function entityResponseVariant(chapterId, variant) {
  const response = clone(entityResponsesByChapter[chapterId]);
  if (chapterId === 9111) {
    response.characters[0].aliases.push('Cô');
    response.characters[1].aliases.push('anh');
  }
  if (variant === 'empty_strings') {
    for (const character of response.characters || []) {
      for (const field of ['role', 'age', 'appearance', 'personality', 'personality_tags', 'flaws']) {
        if (character[field] == null) character[field] = '';
      }
    }
  }
  if (variant === 'duplicate_rows' && chapterId === 9111) {
    response.characters.push(clone(response.characters[0]));
    response.terms.push(clone(response.terms.find((term) => term.name === 'Cổng Tro')));
  }
  return response;
}

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

async function seedStory() {
  await db.projects.add(clone(canonCompletionStory.project));
  await Promise.all([
    db.chapters.bulkAdd(clone(canonCompletionStory.chapters)),
    db.scenes.bulkAdd(clone(canonCompletionStory.scenes)),
    db.characters.bulkAdd(clone(canonCompletionStory.characters)),
    db.locations.bulkAdd(clone(canonCompletionStory.locations)),
    db.objects.bulkAdd(clone(canonCompletionStory.objects)),
    db.relationships.bulkAdd(clone(canonCompletionStory.relationships)),
    db.canonFacts.bulkAdd(clone(canonCompletionStory.canonFacts)),
    db.plotThreads.bulkAdd(clone(canonCompletionStory.plotThreads)),
    db.suggestions.bulkAdd(clone(canonCompletionStory.legacySuggestions)),
  ]);

  useProjectStore.setState({
    currentProject: clone(canonCompletionStory.project),
    projects: [clone(canonCompletionStory.project)],
    chapters: clone(canonCompletionStory.chapters),
    scenes: clone(canonCompletionStory.scenes),
    activeChapterId: canonCompletionStory.chapters[0].id,
    chapterCompletionById: {},
  });
  useCodexStore.setState({
    characters: [],
    locations: [],
    objects: [],
    worldTerms: [],
    canonFacts: [],
  });
  useSuggestionStore.setState({ suggestions: [], loading: false });
}

async function completeChapter(chapterId, response) {
  enqueueCanonResponse(response);
  return useProjectStore.getState().runChapterCompletion(chapterId, { mode: 'manual' });
}

const nearNameChapter = {
  id: 9119,
  project_id: PROJECT_ID,
  order_index: 8,
  title: 'Chương 9: Những bản sao không đồng nhất',
  status: 'draft',
};

const nearNameScene = {
  id: 9291,
  project_id: PROJECT_ID,
  chapter_id: 9119,
  order_index: 0,
  title: 'Ba cái tên gần nhau',
  draft_text: 'Vũ Kha gặp người kiểm định mới Vũ Khang tại Thành Cổ Hạ. Vũ Khang đặt La Bàn Thời Vũ Bản Sao cạnh La Bàn Thời Vũ của Mai An và nói rõ đây là hai vật khác nhau. Anh công bố Khế Ước Mù Bản Nháp là quy tắc thử nghiệm khác với Khế Ước Mù. Vũ Khang chính thức gia nhập Hội Canh Cổng và nhận giữ La Bàn Thời Vũ Bản Sao.',
};

const nearNameEntityResponse = {
  characters: [
    {
      identity_action: 'existing',
      existing_entity_id: 9302,
      name: 'Vũ Kha',
      aliases: ['Kha', 'Anh'],
      role: null,
      age: null,
      appearance: null,
      personality: null,
      personality_tags: null,
      flaws: null,
    },
    {
      identity_action: 'new',
      existing_entity_id: null,
      name: 'Vũ Khang',
      aliases: ['Khang'],
      role: 'supporting',
      age: null,
      appearance: null,
      personality: null,
      personality_tags: null,
      flaws: null,
    },
  ],
  locations: [{
    identity_action: 'new',
    existing_entity_id: null,
    name: 'Thành Cổ Hạ',
    aliases: [],
    description: 'Khu thành thấp, là một địa điểm riêng với Thành Cổ.',
  }],
  objects: [
    {
      identity_action: 'existing',
      existing_entity_id: 9501,
      name: 'La Bàn Thời Vũ',
      aliases: ['la bàn'],
      description: 'Bản gốc thuộc về Mai An.',
      owner: 'Mai An',
    },
    {
      identity_action: 'new',
      existing_entity_id: null,
      name: 'La Bàn Thời Vũ Bản Sao',
      aliases: ['bản sao la bàn'],
      description: 'Một vật phẩm riêng, không phải La Bàn Thời Vũ bản gốc.',
      owner: 'Vũ Khang',
    },
  ],
  terms: [
    {
      identity_action: 'existing',
      existing_entity_id: 9750,
      name: 'Khế Ước Mù',
      aliases: ['khế ước'],
      definition: 'Quy tắc gốc.',
      category: 'magic',
    },
    {
      identity_action: 'new',
      existing_entity_id: null,
      name: 'Khế Ước Mù Bản Nháp',
      aliases: [],
      definition: 'Quy tắc thử nghiệm khác với Khế Ước Mù.',
      category: 'magic',
    },
  ],
};

const nearNameCanonResponse = {
  ops: [
    {
      op_type: 'ALLEGIANCE_CHANGED',
      scene_index: 1,
      subject_name: 'Vũ Khang',
      summary: 'Vũ Khang gia nhập Hội Canh Cổng.',
      confidence: 0.99,
      evidence: 'Vũ Khang chính thức gia nhập Hội Canh Cổng',
      payload: { allegiance: 'Hội Canh Cổng' },
    },
    {
      op_type: 'OBJECT_ACQUIRED',
      scene_index: 1,
      subject_name: 'Vũ Khang',
      object_name: 'La Bàn Thời Vũ Bản Sao',
      summary: 'Vũ Khang nhận giữ bản sao la bàn.',
      confidence: 0.99,
      evidence: 'Vũ Khang chính thức gia nhập Hội Canh Cổng và nhận giữ La Bàn Thời Vũ Bản Sao',
      payload: { availability: 'available' },
    },
  ],
};

async function runNearNameScenario() {
  await db.worldTerms.add({
    id: 9750,
    project_id: PROJECT_ID,
    name: 'Khế Ước Mù',
    aliases: ['khế ước'],
    definition: 'Quy tắc gốc chi phối Chìa Khóa Sương.',
    category: 'magic',
  });
  await db.chapters.add(clone(nearNameChapter));
  await db.scenes.add(clone(nearNameScene));
  useProjectStore.setState((state) => ({
    chapters: [...state.chapters, clone(nearNameChapter)],
    scenes: [...state.scenes, clone(nearNameScene)],
  }));
  harness.extractFromChapter.mockResolvedValueOnce(clone(nearNameEntityResponse));
  return completeChapter(nearNameChapter.id, nearNameCanonResponse);
}

async function readManualCompletionState(chapterId) {
  const [
    chapter,
    canonState,
    overview,
    revisions,
    commits,
    chapterEvents,
    allEvents,
    evidence,
    characters,
    locations,
    worldTerms,
    canonFacts,
    entityStates,
    objects,
    itemStates,
    threadStates,
    relationshipStates,
    suggestions,
    resolutionCandidates,
  ] = await Promise.all([
    db.chapters.get(chapterId),
    getChapterCanonState(PROJECT_ID, chapterId),
    getProjectCanonOverview(PROJECT_ID),
    db.chapter_revisions.where('project_id').equals(PROJECT_ID).toArray(),
    db.chapter_commits.where('project_id').equals(PROJECT_ID).toArray(),
    db.story_events.where('chapter_id').equals(chapterId).toArray(),
    db.story_events.where('project_id').equals(PROJECT_ID).toArray(),
    db.memory_evidence.where('project_id').equals(PROJECT_ID).toArray(),
    db.characters.where('project_id').equals(PROJECT_ID).toArray(),
    db.locations.where('project_id').equals(PROJECT_ID).toArray(),
    db.worldTerms.where('project_id').equals(PROJECT_ID).toArray(),
    db.canonFacts.where('project_id').equals(PROJECT_ID).toArray(),
    db.entity_state_current.where('project_id').equals(PROJECT_ID).toArray(),
    db.objects.where('project_id').equals(PROJECT_ID).toArray(),
    db.item_state_current.where('project_id').equals(PROJECT_ID).toArray(),
    db.plot_thread_state.where('project_id').equals(PROJECT_ID).toArray(),
    db.relationship_state_current.where('project_id').equals(PROJECT_ID).toArray(),
    db.suggestions.where('project_id').equals(PROJECT_ID).toArray(),
    db.entity_resolution_candidates.where('project_id').equals(PROJECT_ID).toArray(),
  ]);

  return clone({
    chapter,
    completionUiState: useProjectStore.getState().chapterCompletionById?.[chapterId] || null,
    canonState,
    overview,
    revisions: revisions.filter((row) => row.chapter_id === chapterId),
    commit: commits.find((row) => row.chapter_id === chapterId) || null,
    chapterEvents,
    committedEventCount: allEvents.filter((row) => row.status === 'committed').length,
    evidence: evidence.filter((row) => row.chapter_id === chapterId),
    baseProfiles: characters,
    locations,
    worldTerms,
    baseCanonFacts: canonFacts,
    entityStates,
    baseObjects: objects,
    itemStates,
    threadStates,
    relationshipStates,
    suggestions,
    resolutionCandidates,
  });
}

const reviewedOpTypesByChapter = {
  9111: [
    'CHARACTER_LOCATION_CHANGED',
    'GOAL_CHANGED',
    'ALLEGIANCE_CHANGED',
    'THREAD_OPENED',
    'OBJECT_ACQUIRED',
    'RELATIONSHIP_STATUS_CHANGED',
    'RELATIONSHIP_SECRET_CHANGED',
    'FACT_REGISTERED',
    'SECRET_REVEALED',
    'SECRET_REVEALED',
    'INTIMACY_LEVEL_CHANGED',
    'FACT_REGISTERED',
  ],
  9112: [
    'CHARACTER_STATUS_CHANGED',
    'THREAD_PROGRESS',
    'OBJECT_TRANSFERRED',
    'OBJECT_PARTIALLY_CONSUMED',
    'OBJECT_STATUS_CHANGED',
    'FACT_REGISTERED',
    'SECRET_REVEALED',
  ],
  9113: [
    'OBJECT_TRANSFERRED',
    'SECRET_REVEALED',
    'SECRET_REVEALED',
    'SECRET_REVEALED',
    'CHARACTER_DIED',
    'OBJECT_LOST',
    'THREAD_PROGRESS',
    'RELATIONSHIP_STATUS_CHANGED',
  ],
  9114: [
    'CHARACTER_RESCUED',
    'CHARACTER_LOCATION_CHANGED',
    'OBJECT_FOUND',
    'OBJECT_RESTORED',
    'OBJECT_RETURNED',
    'OBJECT_CONSUMED',
    'RELATIONSHIP_SECRET_CHANGED',
    'INTIMACY_LEVEL_CHANGED',
  ],
  9115: [
    'CHARACTER_LOCATION_CHANGED',
    'OBJECT_SPENT',
    'ALLEGIANCE_CHANGED',
    'GOAL_CHANGED',
    'FACT_REGISTERED',
    'THREAD_PROGRESS',
    'CHARACTER_DIED',
    'THREAD_RESOLVED',
    'OBJECT_STATUS_CHANGED',
    'FACT_REGISTERED',
  ],
  9116: [],
  9117: ['FACT_REGISTERED'],
  9118: ['GOAL_CHANGED'],
};

const reviewedSceneIndexesByChapter = {
  9111: [2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 2],
  9112: [1, 2, 1, 1, 1, 2, 2],
  9113: [1, 1, 1, 1, 1, 2, 1, 2],
  9114: [1, 1, 1, 2, 2, 2, 2, 2],
  9115: [1, 1, 1, 1, 1, 1, 2, 2, 2, 2],
  9116: [],
  9117: [1],
  9118: [1],
};

const reviewedEntityNamesByChapter = {
  9111: {
    characters: ['Mai An', 'Vũ Kha'],
    locations: ['Bến Đông Hải', 'Thành Cổ'],
    objects: ['La Bàn Thời Vũ', 'Đèn Bão Lam'],
    terms: ['Hội Canh Cổng', 'Cổng Tro'],
  },
  9112: {
    characters: [],
    locations: ['Phòng Lõi Cổng Tro'],
    objects: ['La Bàn Thời Vũ', 'Huyết Thanh Bạc', 'Ấn Đồng Hộ Mệnh'],
    terms: [],
  },
  9113: { characters: [], locations: [], objects: [], terms: [] },
  9114: {
    characters: [],
    locations: ['Trạm Y Tế Thành Cổ'],
    objects: [],
    terms: [],
  },
  9115: { characters: [], locations: [], objects: [], terms: [] },
  9116: { characters: [], locations: [], objects: [], terms: [] },
  9117: { characters: [], locations: [], objects: [], terms: [] },
  9118: {
    characters: [],
    locations: ['Kho lưu trữ'],
    objects: [],
    terms: [],
  },
};

describe('phase10 real-story chapter completion', () => {
  beforeAll(async () => {
    await db.open();
  });

  beforeEach(async () => {
    await clearDatabase();
    harness.canonResponses.length = 0;
    harness.canonRequests.length = 0;
    harness.aiSend.mockReset();
    harness.summarizeChapter.mockReset();
    harness.extractFromChapter.mockReset();

    harness.summarizeChapter.mockImplementation(async ({ chapterTitle }) => (
      `Tóm tắt kiểm thử của ${chapterTitle}`
    ));
    harness.extractFromChapter.mockResolvedValue({
      characters: [],
      locations: [],
      objects: [],
      terms: [],
    });
    harness.aiSend.mockImplementation(({ taskType, messages, onComplete, onError }) => {
      if (taskType === 'canon_adjudicate_warnings') {
        onComplete('{"decisions":[]}');
        return;
      }
      if (taskType !== 'canon_extract_ops') {
        onError(new Error(`Unexpected AI task in canon test: ${taskType}`));
        return;
      }
      harness.canonRequests.push(clone(messages));
      const nextResponse = harness.canonResponses.shift();
      if (nextResponse instanceof Error) {
        onError(nextResponse);
        return;
      }
      onComplete(typeof nextResponse === 'string'
        ? nextResponse
        : JSON.stringify(nextResponse));
    });

    await seedStory();
  });

  afterAll(async () => {
    await clearDatabase();
    db.close();
  });

  it('matches the human-reviewed canon reading and grounds every gold op in its actual scene', () => {
    for (const chapter of canonCompletionStory.chapters) {
      const response = canonicalResponsesByChapter[chapter.id];
      const scenes = canonCompletionStory.scenes
        .filter((scene) => scene.chapter_id === chapter.id)
        .sort((a, b) => a.order_index - b.order_index);
      expect(response.ops.map((item) => item.op_type))
        .toEqual(reviewedOpTypesByChapter[chapter.id]);
      expect(response.ops.map((item) => item.scene_index))
        .toEqual(reviewedSceneIndexesByChapter[chapter.id]);

      response.ops.forEach((item) => {
        expect(item.confidence).toBeGreaterThanOrEqual(0.55);
        expect(scenes[item.scene_index - 1].draft_text).toContain(item.evidence);
      });
    }

    const revealedSecrets = canonicalResponsesByChapter[9113].ops
      .filter((item) => item.op_type === 'SECRET_REVEALED');
    expect(revealedSecrets).toHaveLength(3);
    expect(revealedSecrets.map((item) => [item.subject_name, item.target_name])).toEqual([
      ['Mai An', 'Lê Minh'],
      ['Vũ Kha', 'Lê Minh'],
      ['Vũ Kha', 'Lê Minh'],
    ]);
    expect(revealedSecrets.map((item) => item.fact_description)).toEqual([
      'Bạch Ly là người điều khiển Cổng Tro',
      'Bạch Ly là người điều khiển Cổng Tro',
      'Ấn Đồng Hộ Mệnh chỉ chấp nhận máu của người giữ cổng tự nguyện',
    ]);
    const newlyRegisteredSecretReveal = canonicalResponsesByChapter[9112].ops
      .find((item) => item.op_type === 'SECRET_REVEALED');
    expect(newlyRegisteredSecretReveal).toMatchObject({
      subject_name: 'Mai An',
      target_name: 'Lê Minh',
      fact_description: 'Ấn Đồng Hộ Mệnh chỉ chấp nhận máu của người giữ cổng tự nguyện',
    });
    const sharedVoiceSecret = canonicalResponsesByChapter[9111].ops
      .filter((item) => item.fact_description === 'Mai An và Vũ Kha cùng nghe thấy tiếng gọi phát ra từ dưới Thành Cổ');
    expect(sharedVoiceSecret.map((item) => item.op_type)).toEqual([
      'FACT_REGISTERED',
      'SECRET_REVEALED',
      'SECRET_REVEALED',
    ]);
    expect(sharedVoiceSecret.slice(1).map((item) => item.subject_name)).toEqual(['Mai An', 'Vũ Kha']);
    expect(canonicalResponsesByChapter[9115].ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op_type: 'FACT_REGISTERED',
        fact_description: 'Người anh mất tích của Mai An không ở phía sau Cổng Tro',
      }),
      expect.objectContaining({
        op_type: 'THREAD_PROGRESS',
        thread_title: 'Người anh mất tích',
      }),
    ]));

    const rescue = canonicalResponsesByChapter[9114].ops
      .find((item) => item.op_type === 'CHARACTER_RESCUED');
    expect(rescue).toMatchObject({ subject_name: 'Mai An', target_name: 'Vũ Kha' });
    const passiveItemOps = [
      canonicalResponsesByChapter[9112].ops
        .find((item) => item.op_type === 'OBJECT_STATUS_CHANGED'),
      canonicalResponsesByChapter[9114].ops
        .find((item) => item.op_type === 'OBJECT_RESTORED'),
      canonicalResponsesByChapter[9114].ops
        .find((item) => item.op_type === 'OBJECT_CONSUMED'),
      canonicalResponsesByChapter[9115].ops
        .find((item) => item.op_type === 'OBJECT_STATUS_CHANGED'),
    ];
    passiveItemOps.forEach((item) => expect(item).not.toHaveProperty('subject_name'));
    expect(canonicalResponsesByChapter[9118].ops).toHaveLength(1);
    expect(canonicalResponsesByChapter[9118].ops[0]).toMatchObject({
      op_type: 'GOAL_CHANGED',
      payload: {
        new_goal: 'Điều tra chuỗi mất tích quanh kho lưu trữ',
      },
    });
  });

  it('matches the human-reviewed Codex reading and omits ambiguous or scene-only pseudo-entities', () => {
    const genericCharacterAliases = new Set(['anh', 'chị', 'cô', 'ông', 'bà', 'hắn', 'nàng']);
    for (const chapter of canonCompletionStory.chapters) {
      const response = entityResponsesByChapter[chapter.id];
      const chapterText = canonCompletionStory.scenes
        .filter((scene) => scene.chapter_id === chapter.id)
        .map((scene) => scene.draft_text)
        .join('\n')
        .toLocaleLowerCase('vi');

      for (const group of ['characters', 'locations', 'objects', 'terms']) {
        expect((response[group] || []).map((item) => item.name))
          .toEqual(reviewedEntityNamesByChapter[chapter.id][group]);
        for (const item of response[group] || []) {
          expect(['existing', 'new']).toContain(item.identity_action);
          if (item.identity_action === 'new') {
            expect(item.existing_entity_id).toBeNull();
          } else {
            expect(item.existing_entity_id).not.toBeNull();
          }
          const observedNames = [item.name, ...(item.aliases || [])]
            .map((value) => String(value).toLocaleLowerCase('vi'));
          expect(observedNames.some((value) => chapterText.includes(value))).toBe(true);
          if (group === 'characters') {
            expect((item.aliases || []).some((alias) => (
              genericCharacterAliases.has(alias.toLocaleLowerCase('vi'))
            ))).toBe(false);
          }
        }
      }
    }

    expect(entityResponsesByChapter[9111].objects.map((item) => item.name))
      .not.toEqual(expect.arrayContaining(['hòm sắt', 'bức phù điêu bị cháy']));
    expect(entityResponsesByChapter[9111].terms.map((item) => item.name))
      .not.toEqual(expect.arrayContaining([
        'tiếng gọi từ dưới thành',
        'Tuyến điều tra Khóa Cổng Tro',
      ]));
    expect(entityResponsesByChapter[9117].objects).toEqual([]);
    expect(entityResponsesByChapter[9118].characters).toEqual([]);
  });

  it.each([
    ['object', 'object'],
    ['fenced_json', 'empty_strings'],
    ['compact_json', 'duplicate_rows'],
  ])('runs the human semantic oracle end-to-end without Codex duplication (%s / %s)', async (
    canonVariant,
    entityVariant,
  ) => {
    harness.extractFromChapter.mockImplementation(async ({ chapterId }) => (
      entityResponseVariant(chapterId, entityVariant)
    ));

    const results = [];
    for (const chapter of canonCompletionStory.chapters) {
      results.push(await completeChapter(
        chapter.id,
        canonResponseVariant(canonicalResponsesByChapter[chapter.id], canonVariant),
      ));
    }

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.canonResult.committedCount))
      .toEqual([12, 7, 8, 8, 10, 0, 1, 1]);
    expect(results[5].message).toContain('không phát hiện thay đổi canon mới');

    const events = await db.story_events
      .where('project_id').equals(PROJECT_ID)
      .filter((event) => event.status === 'committed')
      .toArray();
    expect(events).toHaveLength(47);
    for (const chapter of canonCompletionStory.chapters) {
      expect(events
        .filter((event) => event.chapter_id === chapter.id)
        .map((event) => event.op_type))
        .toEqual(reviewedOpTypesByChapter[chapter.id]);
    }

    const characters = await db.characters.where('project_id').equals(PROJECT_ID).toArray();
    const locations = await db.locations.where('project_id').equals(PROJECT_ID).toArray();
    const objects = await db.objects.where('project_id').equals(PROJECT_ID).toArray();
    const terms = await db.worldTerms.where('project_id').equals(PROJECT_ID).toArray();
    expect(characters.map((item) => item.name).sort()).toEqual([
      'Bạch Ly', 'Lê Minh', 'Mai An', 'Vũ Kha',
    ].sort());
    expect(objects.map((item) => item.name).sort()).toEqual([
      'Huyết Thanh Bạc', 'La Bàn Thời Vũ', 'Đèn Bão Lam', 'Ấn Đồng Hộ Mệnh',
    ].sort());
    expect(locations.map((item) => item.name)).toEqual(expect.arrayContaining([
      'Bến Đông Hải',
      'Thành Cổ',
      'Trạm Y Tế Thành Cổ',
      'Phòng Lõi Cổng Tro',
      'Kho lưu trữ',
    ]));
    expect(locations).toHaveLength(5);
    expect(terms.map((item) => item.name).sort()).toEqual(['Cổng Tro', 'Hội Canh Cổng']);

    const forbiddenNoise = [
      'hòm sắt',
      'bức phù điêu bị cháy',
      'tiếng gọi từ dưới thành',
      'Tuyến điều tra Khóa Cổng Tro',
      'máy thu cũ',
      'người bán báo',
    ];
    const allEntityNames = [...characters, ...locations, ...objects, ...terms]
      .map((item) => item.name.toLocaleLowerCase('vi'));
    for (const name of forbiddenNoise) {
      expect(allEntityNames).not.toContain(name.toLocaleLowerCase('vi'));
    }
    expect((await db.characters.get(9301)).aliases).toEqual(['An']);
    expect((await db.characters.get(9302)).aliases).toEqual(['Kha']);

    const candidates = await db.entity_resolution_candidates
      .where('project_id').equals(PROJECT_ID)
      .toArray();
    expect(candidates).toHaveLength(14);
    expect(candidates.every((candidate) => (
      candidate.resolution_status === 'matched_existing'
        || candidate.resolution_status === 'created_new'
    ))).toBe(true);
    expect(new Set(candidates.map((candidate) => (
      `${candidate.chapter_id}:${candidate.entity_kind}:${candidate.normalized_name}`
    ))).size).toBe(candidates.length);

    const entityStates = await db.entity_state_current
      .where('project_id').equals(PROJECT_ID)
      .toArray();
    const stateById = new Map(entityStates.map((state) => [state.entity_id, state]));
    expect(stateById.get(9303).alive_status).toBe('dead');
    expect(stateById.get(9304).alive_status).toBe('dead');
    expect(stateById.get(9301).goals_active).toEqual([
      'Điều tra chuỗi mất tích quanh kho lưu trữ',
    ]);
    expect(stateById.get(9302).allegiance).toBe('Hội Canh Cổng');

    const chapterEightEvents = events.filter((event) => event.chapter_id === 9118);
    expect(chapterEightEvents).toHaveLength(1);
    expect(chapterEightEvents[0]).toMatchObject({
      op_type: 'GOAL_CHANGED',
      subject_id: 9301,
    });
  });

  it('runs the real completion pipeline across a large story and preserves every canon invariant', async () => {
    const completionResults = [];
    for (const chapter of canonCompletionStory.chapters.slice(0, 6)) {
      completionResults.push(await completeChapter(
        chapter.id,
        canonicalResponsesByChapter[chapter.id],
      ));
      if (chapter.id === 9113) {
        await db.canonFacts.add({
          id: 9703,
          project_id: PROJECT_ID,
          description: 'Chỉ người mang dấu tro mới đọc được bản đồ dưới giếng',
          fact_type: 'fact',
          status: 'active',
        });
      }
    }

    expect(completionResults.every((result) => result.ok)).toBe(true);
    expect(completionResults.map((result) => result.canonResult.committedCount))
      .toEqual([12, 7, 8, 8, 10, 0]);
    expect(completionResults[5].message).toContain('không phát hiện thay đổi canon mới');

    const completedChapters = await db.chapters
      .where('project_id').equals(PROJECT_ID)
      .sortBy('order_index');
    expect(completedChapters.slice(0, 6).map((chapter) => chapter.status))
      .toEqual(['done', 'done', 'done', 'done', 'done', 'done']);

    const committedEvents = await db.story_events
      .where('project_id').equals(PROJECT_ID)
      .filter((event) => event.status === 'committed')
      .toArray();
    expect(new Set(committedEvents.map((event) => event.op_type)))
      .toEqual(new Set(allCanonOpTypes));
    expect(committedEvents).toHaveLength(45);

    const entityStates = await db.entity_state_current
      .where('project_id').equals(PROJECT_ID)
      .toArray();
    const entityById = new Map(entityStates.map((state) => [state.entity_id, state]));
    expect(entityById.get(9301)).toMatchObject({
      alive_status: 'alive',
      rescued: true,
      current_location_id: 9404,
      current_location_name: 'Phòng Lõi Cổng Tro',
      allegiance: 'Hội Canh Cổng',
    });
    expect(entityById.get(9301).goals_active).toEqual(['Xây dựng mạng lưới canh gác']);
    expect(Object.keys(entityById.get(9301).knowledge)).toHaveLength(3);
    expect(entityById.get(9302)).toMatchObject({
      allegiance: 'Hội Canh Cổng',
      alive_status: 'unknown',
      rescued: false,
    });
    expect(Object.keys(entityById.get(9302).knowledge)).toHaveLength(3);
    expect(Object.keys(entityById.get(9303).knowledge)).toHaveLength(0);
    expect(entityById.get(9303)).toMatchObject({ alive_status: 'dead' });
    expect(entityById.get(9304)).toMatchObject({ alive_status: 'dead' });
    const sealFactEvent = committedEvents.find((event) => (
      event.op_type === 'FACT_REGISTERED'
      && event.fact_description.startsWith('Ấn Đồng Hộ Mệnh')
    ));
    const sealRevealEvents = committedEvents.filter((event) => (
      event.op_type === 'SECRET_REVEALED'
      && event.fact_description.startsWith('Ấn Đồng Hộ Mệnh')
    ));
    expect(sealFactEvent.fact_id).toBeTruthy();
    expect(sealRevealEvents.map((event) => event.subject_id)).toEqual([9301, 9302]);
    expect(sealRevealEvents.every((event) => event.fact_id === sealFactEvent.fact_id)).toBe(true);
    expect(entityById.get(9301).knowledge[sealFactEvent.fact_id]).toBe(true);
    expect(entityById.get(9302).knowledge[sealFactEvent.fact_id]).toBe(true);

    const itemStates = await db.item_state_current
      .where('project_id').equals(PROJECT_ID)
      .toArray();
    const itemById = new Map(itemStates.map((state) => [state.object_id, state]));
    expect(itemById.get(9501)).toMatchObject({
      availability: 'available',
      owner_character_id: 9301,
      holder_character_id: 9301,
      is_damaged: false,
    });
    expect(itemById.get(9502)).toMatchObject({
      availability: 'consumed',
      quantity_remaining: 0,
      is_consumed: true,
    });
    expect(itemById.get(9503)).toMatchObject({
      availability: 'consumed',
      quantity_remaining: 0,
      is_consumed: true,
      owner_character_id: 9301,
    });
    expect(itemById.get(9504)).toMatchObject({
      availability: 'destroyed',
      is_damaged: true,
      owner_character_id: 9301,
    });

    const relationshipState = await db.relationship_state_current
      .where('[project_id+pair_key]').equals([PROJECT_ID, '9301:9302'])
      .first();
    expect(relationshipState).toMatchObject({
      relationship_type: 'friend',
      secrecy_state: 'public',
      intimacy_level: 'high',
      consent_state: 'mutual',
    });

    const threadState = await db.plot_thread_state
      .where('[project_id+thread_id]').equals([PROJECT_ID, 9801])
      .first();
    expect(threadState).toMatchObject({ state: 'resolved' });

    const overview = await getProjectCanonOverview(PROJECT_ID);
    expect(overview.stats).toMatchObject({
      canonical_count: 6,
      event_count: 45,
      fact_count: 8,
    });
    const derivedFacts = overview.factStates.filter((fact) => fact.derived_from_chapter);
    expect(derivedFacts.map((fact) => fact.description)).toEqual(expect.arrayContaining([
      'Đèn Bão Lam phát sáng khi ở gần Cổng Tro',
      'Mai An và Vũ Kha cùng nghe thấy tiếng gọi phát ra từ dưới Thành Cổ',
      'Ấn Đồng Hộ Mệnh chỉ chấp nhận máu của người giữ cổng tự nguyện',
      'Người anh mất tích của Mai An không ở phía sau Cổng Tro',
      'Cổng Tro không thể tự mở nếu thiếu ấn đồng mới và nghi thức tự nguyện',
    ]));
    expect(derivedFacts.find((fact) => fact.description.startsWith('Ấn Đồng')))
      .toMatchObject({ fact_type: 'secret', revealed_at_chapter: 2 });

    const suggestions = await db.suggestions
      .where('project_id').equals(PROJECT_ID)
      .toArray();
    expect(suggestions.find((item) => item.id === 9901).status).toBe('superseded');
    expect(suggestions.find((item) => item.id === 9902).status).toBe('superseded');
    expect(suggestions.find((item) => item.id === 9903).status).toBe('pending');

    const baseCharacters = await db.characters
      .where('project_id').equals(PROJECT_ID)
      .sortBy('id');
    expect(baseCharacters.map(({ current_status, goals }) => ({ current_status, goals })))
      .toEqual(canonCompletionStory.characters.map(({ current_status, goals }) => ({ current_status, goals })));
    expect((await db.objects.get(9503)).owner_character_id).toBe(9303);
    expect((await db.relationships.get(9601)).relation_type).toBe('friend');

    const retrieval = await buildRetrievalPacket({
      projectId: PROJECT_ID,
      chapterId: 9116,
      mode: 'audit_long',
    });
    const retrievalText = JSON.stringify(retrieval);
    expect(retrievalText).toContain('Lê Minh');
    expect(retrievalText).toContain('dead');
    expect(retrievalText).toContain('Cổng Tro không thể tự mở');
    expect(retrievalText).toContain('consumed');

    const quietCanon = await getChapterCanonState(PROJECT_ID, 9116);
    expect(quietCanon).toMatchObject({
      status: 'canonical',
      extractionStatus: 'succeeded',
      extractedCount: 0,
      committedCount: 0,
      filteredCount: 0,
    });

    expect(harness.canonRequests).toHaveLength(6);
    const chapterFourPrompt = JSON.stringify(harness.canonRequests[3]);
    expect(chapterFourPrompt).toContain('Đã chết');
    expect(chapterFourPrompt).toContain('Ấn Đồng Hộ Mệnh chỉ chấp nhận máu');
    expect(chapterFourPrompt).toContain('Chỉ người mang dấu tro mới đọc được bản đồ dưới giếng');
    expect(chapterFourPrompt).toContain('lost');
    expect(chapterFourPrompt).toContain('Mai An <-> Vũ Kha');
    expect(chapterFourPrompt).not.toContain('undefined <-> undefined');
    expect(chapterFourPrompt).toContain('evidence phải là một trích dẫn nguyên văn');
    expect(chapterFourPrompt).toContain('CHARACTER_RESCUED: subject_name là người được cứu');
    expect(chapterFourPrompt).toContain('SECRET_REVEALED: subject_name nếu có là người vừa biết bí mật');
    expect(chapterFourPrompt).toContain('GOAL_CHANGED chỉ dùng cho mục tiêu/ưu tiên đủ bền');
  });

  it('materializes newly extracted Codex entities before canon maps their typed operations', async () => {
    await db.chapters.add({
      id: 9119,
      project_id: PROJECT_ID,
      order_index: 8,
      title: 'Chương 9: Người thợ ở xưởng kính',
      status: 'draft',
    });
    await db.scenes.add({
      id: 9291,
      project_id: PROJECT_ID,
      chapter_id: 9119,
      order_index: 0,
      title: 'Khế ước cuối cùng',
      draft_text: 'Tại Xưởng Kính Mù, người thợ máy Tạ Nghi trao Chìa Khóa Sương cho Mai An và tuyên bố nó tuân theo Khế Ước Mù. Một lưỡi kính rơi xuyên ngực Tạ Nghi; anh qua đời tại chỗ và Mai không còn bắt được mạch.',
    });
    harness.extractFromChapter.mockResolvedValueOnce({
      characters: [{
        identity_action: 'new',
        existing_entity_id: null,
        name: 'Tạ Nghi',
        aliases: ['Nghi'],
        role: 'minor',
        appearance: 'Người thợ máy làm việc trong xưởng kính.',
        personality: '',
        personality_tags: '',
        flaws: '',
        age: '',
      }],
      locations: [{
        identity_action: 'new',
        existing_entity_id: null,
        name: 'Xưởng Kính Mù',
        aliases: [],
        description: 'Xưởng kính nơi Tạ Nghi làm việc.',
      }],
      objects: [{
        identity_action: 'new',
        existing_entity_id: null,
        name: 'Chìa Khóa Sương',
        aliases: [],
        description: 'Chìa khóa được Tạ Nghi trao cho Mai An.',
        owner: 'Mai An',
      }],
      terms: [{
        identity_action: 'new',
        existing_entity_id: null,
        name: 'Khế Ước Mù',
        aliases: [],
        definition: 'Quy tắc chi phối Chìa Khóa Sương.',
        category: 'magic',
      }],
    });

    const result = await completeChapter(9119, {
      ops: [
        {
          op_type: 'CHARACTER_LOCATION_CHANGED',
          scene_index: 1,
          subject_name: 'Mai An',
          location_name: 'Xưởng Kính Mù',
          summary: 'Mai đến Xưởng Kính Mù.',
          confidence: 0.98,
          evidence: 'Tại Xưởng Kính Mù, người thợ máy Tạ Nghi trao Chìa Khóa Sương cho Mai An',
          payload: { location_name: 'Xưởng Kính Mù' },
        },
        {
          op_type: 'OBJECT_ACQUIRED',
          scene_index: 1,
          subject_name: 'Mai An',
          object_name: 'Chìa Khóa Sương',
          summary: 'Mai nhận Chìa Khóa Sương.',
          confidence: 0.99,
          evidence: 'Tạ Nghi trao Chìa Khóa Sương cho Mai An',
          payload: { owner_character_id: 9301, holder_character_id: 9301, availability: 'available' },
        },
        {
          op_type: 'CHARACTER_DIED',
          scene_index: 1,
          subject_name: 'Tạ Nghi',
          summary: 'Tạ Nghi chết tại xưởng kính.',
          confidence: 0.99,
          evidence: 'Một lưỡi kính rơi xuyên ngực Tạ Nghi; anh qua đời tại chỗ và Mai không còn bắt được mạch.',
          payload: { status_summary: 'Đã chết tại Xưởng Kính Mù.' },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      canonResult: { extractedCount: 3, committedCount: 3, filteredCount: 0 },
    });
    const newCharacter = await db.characters.where('name').equals('Tạ Nghi').first();
    const newLocation = await db.locations.where('name').equals('Xưởng Kính Mù').first();
    const newObject = await db.objects.where('name').equals('Chìa Khóa Sương').first();
    const newTerm = await db.worldTerms.where('name').equals('Khế Ước Mù').first();
    expect([newCharacter, newLocation, newObject, newTerm].every(Boolean)).toBe(true);
    expect(await db.entity_state_current
      .where('[project_id+entity_id]').equals([PROJECT_ID, newCharacter.id])
      .first()).toMatchObject({
      alive_status: 'dead',
    });
    expect(await db.entity_state_current
      .where('[project_id+entity_id]').equals([PROJECT_ID, 9301])
      .first()).toMatchObject({
      current_location_id: newLocation.id,
    });
    expect(await db.item_state_current
      .where('[project_id+object_id]').equals([PROJECT_ID, newObject.id])
      .first()).toMatchObject({
      availability: 'available',
      owner_character_id: 9301,
      holder_character_id: 9301,
    });
    const candidateStatuses = await db.entity_resolution_candidates
      .where('chapter_id').equals(9119)
      .toArray();
    expect(candidateStatuses).toHaveLength(4);
    expect(candidateStatuses.every((candidate) => candidate.resolution_status === 'created_new'))
      .toBe(true);
  });

  it('keeps explicitly distinct near-names separate while matching exact ids and aliases', async () => {
    const result = await runNearNameScenario();

    expect(result).toMatchObject({
      ok: true,
      canonResult: { extractedCount: 2, committedCount: 2, filteredCount: 0 },
    });
    expect(await db.characters.where('name').equals('Vũ Kha').count()).toBe(1);
    expect(await db.characters.where('name').equals('Vũ Khang').count()).toBe(1);
    expect(await db.locations.where('name').equals('Thành Cổ').count()).toBe(1);
    expect(await db.locations.where('name').equals('Thành Cổ Hạ').count()).toBe(1);
    expect(await db.objects.where('name').equals('La Bàn Thời Vũ').count()).toBe(1);
    expect(await db.objects.where('name').equals('La Bàn Thời Vũ Bản Sao').count()).toBe(1);
    expect(await db.worldTerms.where('name').equals('Khế Ước Mù').count()).toBe(1);
    expect(await db.worldTerms.where('name').equals('Khế Ước Mù Bản Nháp').count()).toBe(1);
    expect((await db.characters.get(9302)).aliases).toEqual(['Kha']);

    const newCharacter = await db.characters.where('name').equals('Vũ Khang').first();
    const newObject = await db.objects.where('name').equals('La Bàn Thời Vũ Bản Sao').first();
    expect(await db.entity_state_current
      .where('[project_id+entity_id]').equals([PROJECT_ID, newCharacter.id])
      .first()).toMatchObject({ allegiance: 'Hội Canh Cổng' });
    expect(await db.item_state_current
      .where('[project_id+object_id]').equals([PROJECT_ID, newObject.id])
      .first()).toMatchObject({
      availability: 'available',
      owner_character_id: newCharacter.id,
      holder_character_id: newCharacter.id,
    });
  });

  it('fails closed on malformed AI output, retries without stale cache, and reports filtered ops honestly', async () => {
    for (const chapter of canonCompletionStory.chapters.slice(0, 6)) {
      const completed = await completeChapter(chapter.id, canonicalResponsesByChapter[chapter.id]);
      expect(completed.ok).toBe(true);
    }

    const malformed = await completeChapter(9117, 'đây không phải JSON');

    expect(malformed).toMatchObject({ ok: false, kind: 'blocked' });
    expect((await db.chapters.get(9117)).status).toBe('draft');
    const failedState = await getChapterCanonState(PROJECT_ID, 9117);
    expect(failedState).toMatchObject({
      status: 'blocked',
      extractionStatus: 'failed',
      errorCount: 1,
    });
    expect(failedState.reports.some((report) => report.rule_code === 'CANON_EXTRACT_FALLBACK'))
      .toBe(true);
    expect(await db.story_events.where('chapter_id').equals(9117).count()).toBe(0);

    const retried = await completeChapter(9117, canonicalResponsesByChapter[9117]);
    expect(retried).toMatchObject({ ok: true });
    expect(retried.canonResult).toMatchObject({
      extractionStatus: 'succeeded',
      extractedCount: 1,
      committedCount: 1,
      filteredCount: 0,
    });
    expect((await db.chapters.get(9117)).status).toBe('done');
    expect(await db.chapter_revisions.where('chapter_id').equals(9117).count()).toBe(2);
    expect(await db.story_events.where('chapter_id').equals(9117).count()).toBe(1);

    const filtered = await completeChapter(9118, adversarialCanonResponse);
    expect(filtered).toMatchObject({ ok: true });
    expect(filtered.canonResult).toMatchObject({
      extractedCount: 5,
      committedCount: 1,
      filteredCount: 4,
    });
    expect(filtered.canonResult.reports.some((report) => (
      report.rule_code === 'CANON_EVIDENCE_NOT_GROUNDED'
    ))).toBe(true);
    expect(filtered.canonResult.reports.some((report) => (
      report.rule_code === 'CANON_EVIDENCE_EXPLICITLY_UNCERTAIN'
    ))).toBe(true);
    const chapterEightEvents = await db.story_events
      .where('chapter_id').equals(9118)
      .toArray();
    expect(chapterEightEvents).toHaveLength(1);
    expect(chapterEightEvents[0]).toMatchObject({
      op_type: 'GOAL_CHANGED',
      subject_id: 9301,
    });
    expect(filtered.message).toContain('4 thay đổi bị lọc');
  });

  it('reanalyzes an old chapter once and invalidates downstream canon without touching base profiles', async () => {
    for (const chapter of canonCompletionStory.chapters.slice(0, 5)) {
      const result = await completeChapter(chapter.id, canonicalResponsesByChapter[chapter.id]);
      expect(result.ok).toBe(true);
    }

    enqueueCanonResponse({ ops: [] });
    const reanalyzed = await canonicalizeChapter(PROJECT_ID, 9112);

    expect(reanalyzed).toMatchObject({
      ok: true,
      committedCount: 0,
      invalidatedChapterCount: 3,
    });
    const commits = await db.chapter_commits
      .where('project_id').equals(PROJECT_ID)
      .toArray();
    const commitByChapter = new Map(commits.map((commit) => [commit.chapter_id, commit]));
    expect(commitByChapter.get(9111).status).toBe('canonical');
    expect(commitByChapter.get(9112).status).toBe('canonical');
    expect([9113, 9114, 9115].map((id) => commitByChapter.get(id).status))
      .toEqual(['invalidated', 'invalidated', 'invalidated']);

    const projectedMentor = await db.entity_state_current
      .where('[project_id+entity_id]').equals([PROJECT_ID, 9303])
      .first();
    expect(projectedMentor.alive_status).toBe('unknown');
    expect((await db.characters.get(9303)).current_status)
      .toBe('Người giữ cổng cao tuổi còn sống.');
  });

  it.skipIf(!MANUAL_AUDIT_ENABLED)(
    'runs a manual evidence audit of the complete chapter-completion workflow',
    async () => {
      harness.extractFromChapter.mockImplementation(async ({ chapterId }) => (
        clone(entityResponsesByChapter[chapterId])
      ));

      const report = {
        generatedAt: new Date().toISOString(),
        purpose: 'Observed data from the real completion store, canon workflow and fake IndexedDB. No assertion result is used as the semantic verdict.',
        project: clone(canonCompletionStory.project),
        initialData: {
          characters: clone(canonCompletionStory.characters),
          locations: clone(canonCompletionStory.locations),
          objects: clone(canonCompletionStory.objects),
          relationships: clone(canonCompletionStory.relationships),
          canonFacts: clone(canonCompletionStory.canonFacts),
          plotThreads: clone(canonCompletionStory.plotThreads),
          legacySuggestions: clone(canonCompletionStory.legacySuggestions),
        },
        attempts: [],
      };

      for (const chapter of canonCompletionStory.chapters) {
        const scenes = canonCompletionStory.scenes
          .filter((scene) => scene.chapter_id === chapter.id)
          .sort((left, right) => left.order_index - right.order_index);

        if (chapter.id === 9117) {
          const failedRequestIndex = harness.canonRequests.length;
          const failedResult = await completeChapter(chapter.id, 'đây không phải JSON');
          report.attempts.push({
            kind: 'malformed_ai_failure',
            chapter: clone(chapter),
            inputScenes: clone(scenes),
            simulatedEntityResponse: clone(entityResponsesByChapter[chapter.id]),
            simulatedCanonResponse: 'đây không phải JSON',
            actualCanonPrompt: clone(harness.canonRequests[failedRequestIndex] || []),
            completionResult: clone(failedResult),
            observedState: await readManualCompletionState(chapter.id),
          });
        }

        const simulatedCanonResponse = chapter.id === 9118
          ? adversarialCanonResponse
          : canonicalResponsesByChapter[chapter.id];
        const requestIndex = harness.canonRequests.length;
        const completionResult = await completeChapter(chapter.id, simulatedCanonResponse);
        report.attempts.push({
          kind: chapter.id === 9117
            ? 'retry_after_malformed_ai'
            : chapter.id === 9118
              ? 'adversarial_ai_output'
              : 'normal_completion',
          chapter: clone(chapter),
          inputScenes: clone(scenes),
          simulatedEntityResponse: clone(entityResponsesByChapter[chapter.id]),
          simulatedCanonResponse: clone(simulatedCanonResponse),
          actualCanonPrompt: clone(harness.canonRequests[requestIndex] || []),
          completionResult: clone(completionResult),
          observedState: await readManualCompletionState(chapter.id),
        });
      }

      const requestCountBeforeCacheReuse = harness.canonRequests.length;
      const summarizeCountBeforeCacheReuse = harness.summarizeChapter.mock.calls.length;
      const entityExtractionCountBeforeCacheReuse = harness.extractFromChapter.mock.calls.length;
      const resolutionCandidateCountBeforeCacheReuse = await db.entity_resolution_candidates
        .where('project_id').equals(PROJECT_ID)
        .count();
      const cachedCompletionResult = await useProjectStore
        .getState()
        .runChapterCompletion(9118, { mode: 'manual' });
      report.cacheReuseCheck = {
        requestCountBefore: requestCountBeforeCacheReuse,
        requestCountAfter: harness.canonRequests.length,
        summarizeCountBefore: summarizeCountBeforeCacheReuse,
        summarizeCountAfter: harness.summarizeChapter.mock.calls.length,
        entityExtractionCountBefore: entityExtractionCountBeforeCacheReuse,
        entityExtractionCountAfter: harness.extractFromChapter.mock.calls.length,
        resolutionCandidateCountBefore: resolutionCandidateCountBeforeCacheReuse,
        resolutionCandidateCountAfter: await db.entity_resolution_candidates
          .where('project_id').equals(PROJECT_ID)
          .count(),
        completionResult: clone(cachedCompletionResult),
        observedState: await readManualCompletionState(9118),
      };

      report.finalState = await readManualCompletionState(9118);
      const nearNameRequestIndex = harness.canonRequests.length;
      const nearNameCompletionResult = await runNearNameScenario();
      report.nearNameIdentityScenario = {
        inputChapter: clone(nearNameChapter),
        inputScenes: [clone(nearNameScene)],
        simulatedEntityResponse: clone(nearNameEntityResponse),
        simulatedCanonResponse: clone(nearNameCanonResponse),
        actualCanonPrompt: clone(harness.canonRequests[nearNameRequestIndex] || []),
        completionResult: clone(nearNameCompletionResult),
        observedState: await readManualCompletionState(nearNameChapter.id),
      };

      const directCanonChapter = {
        id: 9120,
        project_id: PROJECT_ID,
        order_index: 9,
        title: 'Chương 10: Bản ghi không đổi',
        status: 'draft',
      };
      const directCanonScene = {
        id: 9292,
        project_id: PROJECT_ID,
        chapter_id: 9120,
        order_index: 0,
        title: 'Đối chiếu sổ trực',
        draft_text: 'Mai An đối chiếu sổ trực cũ rồi đặt nó trở lại giá. Không có biến cố hay thay đổi canon nào xảy ra.',
      };
      await db.chapters.add(clone(directCanonChapter));
      await db.scenes.add(clone(directCanonScene));
      useProjectStore.setState((state) => ({
        chapters: [...state.chapters, clone(directCanonChapter)],
        scenes: [...state.scenes, clone(directCanonScene)],
      }));
      enqueueCanonResponse({ ops: [] });
      const directCanonResult = await canonicalizeChapter(PROJECT_ID, directCanonChapter.id);
      harness.extractFromChapter.mockResolvedValueOnce({
        characters: [{
          identity_action: 'existing',
          existing_entity_id: 9301,
          name: 'Mai An',
          aliases: ['An'],
          role: null,
          age: null,
          appearance: null,
          personality: null,
          personality_tags: null,
          flaws: null,
        }],
        locations: [],
        objects: [],
        terms: [],
      });
      const callsBeforeDraftCompletion = {
        canon: harness.canonRequests.length,
        summarize: harness.summarizeChapter.mock.calls.length,
        entity: harness.extractFromChapter.mock.calls.length,
      };
      const draftCompletionResult = await useProjectStore
        .getState()
        .runChapterCompletion(directCanonChapter.id, { mode: 'manual' });
      report.directCanonThenCompletionScenario = {
        inputChapter: clone(directCanonChapter),
        inputScenes: [clone(directCanonScene)],
        directCanonResult: clone(directCanonResult),
        callsBeforeCompletion: callsBeforeDraftCompletion,
        callsAfterCompletion: {
          canon: harness.canonRequests.length,
          summarize: harness.summarizeChapter.mock.calls.length,
          entity: harness.extractFromChapter.mock.calls.length,
        },
        completionResult: clone(draftCompletionResult),
        observedState: await readManualCompletionState(directCanonChapter.id),
      };
      await mkdir(path.dirname(MANUAL_AUDIT_PATH), { recursive: true });
      await writeFile(MANUAL_AUDIT_PATH, JSON.stringify(report, null, 2), 'utf8');
      process.stdout.write(`MANUAL_COMPLETION_AUDIT=${MANUAL_AUDIT_PATH}\n`);
    },
  );
});
