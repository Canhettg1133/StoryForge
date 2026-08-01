import 'fake-indexeddb/auto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const AUDIT_ENABLED = process.env.STORYFORGE_AXIOM_EVIDENCE_AUDIT === '1';
const STORY_PATH = process.env.STORYFORGE_AXIOM_STORY_PATH;
const OUTPUT_PATH = path.resolve(
  '.codex-artifacts',
  'axiom-evidence-audit',
  'completion-audit.json',
);

const harness = vi.hoisted(() => ({
  scenario: 'reported',
  records: [],
  attempts: new Map(),
  send: vi.fn(),
}));

vi.mock('../../services/ai/client', () => ({
  default: {
    send: harness.send,
    abort: vi.fn(),
    setRouter: vi.fn(),
  },
}));

import db from '../../services/db/database.js';
import { getChapterCanonState, getProjectCanonOverview } from '../../services/canon/queries.js';
import useCanonStore from '../../stores/canonStore.js';
import useCodexStore from '../../stores/codexStore.js';
import useProjectStore from '../../stores/projectStore.js';
import useSuggestionStore from '../../stores/suggestionStore.js';

const PROJECT_ID = 22000;
const CHAPTER_ID = 22101;
const SCENE_ID = 22201;
const DUY_KHOI_ID = 22301;
const AN_HA_ID = 22302;
const DUY_KHOA_ID = 22303;
const LOCATION_ID = 22401;
const THREAD_ID = 22701;

const chapterOneSummary = 'Duy Khôi phát hiện một tệp ký ức không có định danh và bị làm rối bất thường. Sau khi khôi phục được các mảnh hình ảnh cùng âm thanh đáng sợ, anh bác lời khuyên xóa tệp của An Hạ, bí mật sao chép nó sang phân vùng riêng và quyết định tiếp tục điều tra nguồn gốc của Mảnh Ký Ức Vỡ.';

const reportedEvidence = {
  fact: 'Mã hóa của tệp bị phá vỡ, nhưng không phải kiểu lỗi do thời gian hay hỏng hóc tự nhiên. Có một sự bất thường... Như thể... ai đó đã cố tình làm điều này... Một khuôn mặt. Không rõ ràng, nhưng đôi mắt mở to, ánh lên vẻ hoảng sợ. Sau đó là một màu đỏ, chỉ một cái chớp nhoáng, như máu hay lửa. Và rồi, một âm thanh. Một tiếng thét, bị bóp méo, vặn vẹo.',
  goal: 'Tôi không thể xoá bỏ nó... Nó không phải là một lỗi ngẫu nhiên. Nó là một mảnh ghép bị giấu đi... Tôi cần biết nó là gì.',
  status: "Tôi không thể xoá bỏ nó... Nó không phải là một lỗi ngẫu nhiên. Nó là một mảnh ghép bị giấu đi... Tôi cần biết nó là gì. ... Anh nhẹ nhàng gỡ tay An Hạ ra. 'Tôi không thể.'",
  thread: 'Nó không phải là một lỗi ngẫu nhiên. Nó là một mảnh ghép bị giấu đi... Tôi cần biết nó là gì.',
};

function op(opType, evidence, refs = {}, payload = {}) {
  return {
    op_type: opType,
    scene_index: 1,
    subject_name: refs.subject || '',
    target_name: refs.target || '',
    location_name: refs.location || '',
    thread_id: refs.threadId ?? null,
    thread_title: refs.thread || '',
    fact_description: refs.fact || '',
    object_name: refs.object || '',
    summary: refs.summary || evidence,
    confidence: refs.confidence ?? 0.94,
    evidence,
    payload,
  };
}

const reportedCanonResponse = {
  ops: [
    op(
      'OBJECT_ACQUIRED',
      'Anh chạm vào phím lưu, sao chép tệp Mảnh Ký Ức Vỡ sang một phân vùng bảo mật riêng của mình, một khu vực mà chỉ anh mới có quyền truy cập.',
      { subject: 'Duy Khôi', object: 'Mảnh Ký Ức Vỡ (bản sao)' },
      { item_category: 'resource', availability: 'available' },
    ),
    op(
      'FACT_REGISTERED',
      reportedEvidence.fact,
      { fact: 'Mảnh Ký Ức Vỡ bị cố ý làm hỏng và chứa hình ảnh cùng tiếng thét.' },
      { description: 'Mảnh Ký Ức Vỡ bị cố ý làm hỏng và chứa hình ảnh cùng tiếng thét.', fact_type: 'secret' },
    ),
    op(
      'SECRET_REVEALED',
      reportedEvidence.fact,
      { subject: 'Duy Khôi', fact: 'Mảnh Ký Ức Vỡ bị cố ý làm hỏng và chứa hình ảnh cùng tiếng thét.' },
      { status_summary: 'Duy Khôi biết nội dung ẩn trong Mảnh Ký Ức Vỡ.' },
    ),
    op(
      'GOAL_CHANGED',
      reportedEvidence.goal,
      { subject: 'Duy Khôi' },
      { new_goal: 'Tìm hiểu bản chất và nguồn gốc của Mảnh Ký Ức Vỡ', goals_active: ['Tìm hiểu bản chất và nguồn gốc của Mảnh Ký Ức Vỡ'] },
    ),
    op(
      'CHARACTER_STATUS_CHANGED',
      reportedEvidence.status,
      { subject: 'Duy Khôi' },
      { status_summary: 'Quyết tâm bí mật điều tra Mảnh Ký Ức Vỡ.' },
    ),
    op(
      'THREAD_PROGRESS',
      reportedEvidence.thread,
      { threadId: THREAD_ID, thread: 'Giải mã Mảnh Ký Ức Vỡ' },
      { summary: 'Duy Khôi giữ lại tệp và bắt đầu truy tìm nguồn gốc.' },
    ),
  ],
};

const correctedFact = 'Mảnh Ký Ức Vỡ chứa một khuôn mặt hoảng sợ, một chớp màu đỏ và một tiếng thét bị bóp méo.';
const correctedCanonResponse = {
  ops: [
    op(
      'OBJECT_ACQUIRED',
      'Anh chạm vào phím lưu, sao chép tệp Mảnh Ký Ức Vỡ sang một phân vùng bảo mật riêng của mình, một khu vực mà chỉ anh mới có quyền truy cập.',
      { subject: 'Duy Khôi', object: 'Mảnh Ký Ức Vỡ' },
      { item_category: 'resource', availability: 'available', status_summary: 'Duy Khôi giữ một bản sao trong phân vùng bảo mật riêng.' },
    ),
    op(
      'FACT_REGISTERED',
      'Một khuôn mặt. Không rõ ràng, nhưng đôi mắt mở to, ánh lên vẻ hoảng sợ. Sau đó là một màu đỏ, chỉ một cái chớp nhoáng, như máu hay lửa. Và rồi, một âm thanh. Một tiếng thét, bị bóp méo, vặn vẹo.',
      { fact: correctedFact },
      { description: correctedFact, fact_type: 'secret' },
    ),
    op(
      'SECRET_REVEALED',
      'Một khuôn mặt. Không rõ ràng, nhưng đôi mắt mở to, ánh lên vẻ hoảng sợ. Sau đó là một màu đỏ, chỉ một cái chớp nhoáng, như máu hay lửa. Và rồi, một âm thanh. Một tiếng thét, bị bóp méo, vặn vẹo.',
      { subject: 'Duy Khôi', fact: correctedFact },
      { status_summary: 'Duy Khôi biết các mảnh hình ảnh và âm thanh ẩn trong tệp.' },
    ),
    op(
      'GOAL_CHANGED',
      'Tôi cần biết nó là gì.',
      { subject: 'Duy Khôi' },
      { new_goal: 'Tìm hiểu bản chất và nguồn gốc của Mảnh Ký Ức Vỡ', goals_active: ['Tìm hiểu bản chất và nguồn gốc của Mảnh Ký Ức Vỡ'] },
    ),
    op(
      'THREAD_PROGRESS',
      'Anh không biết mình đang bắt đầu điều gì. Nhưng anh biết, mình không thể dừng lại.',
      { threadId: THREAD_ID, thread: 'Giải mã Mảnh Ký Ức Vỡ' },
      { summary: 'Duy Khôi giữ lại tệp và bắt đầu truy tìm nguồn gốc.' },
    ),
  ],
};

const chapterTwoExcerpt = 'Duy Khoa gõ một vài cú nhấp trên màn hình của mình, rồi chuyển một gói dữ liệu nhỏ sang DNI của Duy Khôi. "Đây là một địa chỉ, và một cái tên. Một tay môi giới thông tin có tiếng ở \'Góc Khuất Thị Trường Đen\'."';
const chapterTwoReportedResponse = {
  ops: [
    op(
      'OBJECT_ACQUIRED',
      chapterTwoExcerpt,
      { subject: 'Duy Khôi', object: 'Địa chỉ và tên Lâm Đồng' },
      { item_category: 'resource', availability: 'available' },
    ),
  ],
};

function entityResponse(scenario) {
  if (scenario === 'chapter2_excerpt') {
    return {
      characters: [
        { identity_action: 'existing', existing_entity_id: DUY_KHOI_ID, name: 'Duy Khôi', aliases: [], role: null },
        { identity_action: 'existing', existing_entity_id: DUY_KHOA_ID, name: 'Duy Khoa', aliases: [], role: null },
      ],
      locations: [{ identity_action: 'new', existing_entity_id: null, name: 'Góc Khuất Thị Trường Đen', aliases: [], description: 'Nơi một môi giới thông tin hoạt động.' }],
      objects: [],
      terms: [],
    };
  }
  return {
    characters: [
      { identity_action: 'existing', existing_entity_id: DUY_KHOI_ID, name: 'Duy Khôi', aliases: ['Khôi'], role: 'protagonist' },
      { identity_action: 'existing', existing_entity_id: AN_HA_ID, name: 'An Hạ', aliases: [], role: 'supporting' },
    ],
    locations: [{ identity_action: 'existing', existing_entity_id: LOCATION_ID, name: 'Kho Lưu Trữ Axiom', aliases: [], description: '' }],
    objects: [{ identity_action: 'new', existing_entity_id: null, name: 'Mảnh Ký Ức Vỡ', aliases: [], description: 'Tệp dữ liệu hư hại 98%, không có định danh Axiom.', owner: '' }],
    terms: [
      { identity_action: 'new', existing_entity_id: null, name: 'Dòng Ký Ức', aliases: [], definition: 'Dữ liệu ký ức được Axiom lưu trữ và phục hồi.', category: 'technology' },
      { identity_action: 'new', existing_entity_id: null, name: 'Kỷ nguyên Xáo Trộn', aliases: [], definition: 'Một giai đoạn lịch sử được nhắc trong kho lưu trữ.', category: 'history' },
    ],
  };
}

function canonResponse(scenario, attempt = 1) {
  if (scenario === 'reported_then_corrected') {
    return attempt === 1 ? reportedCanonResponse : correctedCanonResponse;
  }
  if (scenario === 'corrected') return correctedCanonResponse;
  if (scenario === 'chapter2_excerpt') return chapterTwoReportedResponse;
  return reportedCanonResponse;
}

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

async function seedStory(storyText, scenario) {
  const now = Date.now();
  const isChapterTwo = scenario === 'chapter2_excerpt';
  const title = isChapterTwo
    ? 'Lời Thì Thầm Giữa Dòng Chảy Công Cộng'
    : 'Lỗi Trên Dòng Ký Ức';
  const project = {
    id: PROJECT_ID,
    title: 'Kho Lưu Trữ Axiom',
    genre_primary: 'Khoa học viễn tưởng',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
  const chapter = {
    id: CHAPTER_ID,
    project_id: PROJECT_ID,
    order_index: isChapterTwo ? 1 : 0,
    title,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
  const scene = {
    id: SCENE_ID,
    project_id: PROJECT_ID,
    chapter_id: CHAPTER_ID,
    order_index: 0,
    title: isChapterTwo ? 'Gói dữ liệu' : 'Tệp không định danh',
    draft_text: storyText,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
  const characters = [
    { id: DUY_KHOI_ID, project_id: PROJECT_ID, name: 'Duy Khôi', aliases: ['Khôi'], current_status: 'Chuyên viên cấp ba tại Kho Lưu Trữ Axiom.', goals: 'Kiểm định và khôi phục Dòng Ký Ức.', created_at: now, updated_at: now },
    { id: AN_HA_ID, project_id: PROJECT_ID, name: 'An Hạ', aliases: [], current_status: 'Kỹ thuật viên Axiom.', goals: '', created_at: now, updated_at: now },
    { id: DUY_KHOA_ID, project_id: PROJECT_ID, name: 'Duy Khoa', aliases: [], current_status: '', goals: '', created_at: now, updated_at: now },
  ];
  const locations = [{ id: LOCATION_ID, project_id: PROJECT_ID, name: 'Kho Lưu Trữ Axiom', aliases: ['Kho Lưu Trữ'], description: 'Kho dữ liệu của Axiom.', created_at: now, updated_at: now }];
  const plotThreads = [{ id: THREAD_ID, project_id: PROJECT_ID, title: 'Giải mã Mảnh Ký Ức Vỡ', description: 'Tìm nguồn gốc và nội dung của tệp không định danh.', state: 'active', created_at: now, updated_at: now }];

  await db.projects.add(project);
  await Promise.all([
    db.chapters.add(chapter),
    db.scenes.add(scene),
    db.characters.bulkAdd(characters),
    db.locations.bulkAdd(locations),
    db.plotThreads.bulkAdd(plotThreads),
  ]);
  useProjectStore.setState({
    currentProject: project,
    projects: [project],
    chapters: [chapter],
    scenes: [scene],
    activeChapterId: CHAPTER_ID,
    chapterCompletionById: {},
  });
  useCodexStore.setState({ characters: [], locations: [], objects: [], worldTerms: [], canonFacts: [] });
  useCanonStore.setState({ chapterOutcomes: {}, bulkProgress: null });
  useSuggestionStore.setState({ suggestions: [], loading: false });
}

async function rows(tableName) {
  return db.table(tableName).where('project_id').equals(PROJECT_ID).toArray();
}

async function snapshot() {
  const overview = await getProjectCanonOverview(PROJECT_ID);
  return {
    chapter: await db.chapters.get(CHAPTER_ID),
    revisions: await rows('chapter_revisions'),
    commits: await rows('chapter_commits'),
    events: await rows('story_events'),
    evidence: await rows('memory_evidence'),
    reports: await rows('validator_reports'),
    entities: {
      characters: await rows('characters'),
      locations: await rows('locations'),
      objects: await rows('objects'),
      terms: await rows('worldTerms'),
    },
    projection: {
      entityStates: await rows('entity_state_current'),
      itemStates: await rows('item_state_current'),
      threadStates: await rows('plot_thread_state'),
      relationshipStates: await rows('relationship_state_current'),
      factStates: overview.factStates || [],
    },
    canonState: await getChapterCanonState(PROJECT_ID, CHAPTER_ID),
    store: {
      chapter: useProjectStore.getState().chapters.find((item) => item.id === CHAPTER_ID),
      completion: useProjectStore.getState().chapterCompletionById[CHAPTER_ID],
      objects: useCodexStore.getState().objects,
      canonFacts: useCodexStore.getState().canonFacts,
    },
  };
}

async function runScenario(storyText, scenario) {
  await clearDatabase();
  harness.scenario = scenario;
  harness.records.length = 0;
  harness.attempts.clear();
  await seedStory(storyText, scenario);
  const result = await useProjectStore.getState().runChapterCompletion(CHAPTER_ID, { mode: 'manual' });
  return {
    scenario,
    sourceCompleteness: scenario === 'chapter2_excerpt' ? 'user-provided warning excerpt only' : 'full attached chapter',
    simulatedAi: {
      summary: scenario === 'chapter2_excerpt' ? 'Duy Khoa chuyển cho Duy Khôi một gói dữ liệu chứa địa chỉ và tên của một môi giới thông tin.' : chapterOneSummary,
      entityExtraction: entityResponse(scenario),
      canonExtraction: canonResponse(scenario),
    },
    promptsAndResponses: structuredClone(harness.records),
    completionResult: structuredClone(result),
    databaseAndStore: await snapshot(),
  };
}

describe.skipIf(!AUDIT_ENABLED)('Axiom evidence completion audit', () => {
  const artifact = {
    generatedAt: '',
    liveModelUsed: false,
    aiBoundary: 'Only services/ai/client responses are simulated. aiStore parsing, entity staging/materialization, projectStore.runChapterCompletion, typed canon mapping/validation/commit, Dexie writes, projection and store refresh are production code.',
    oracle: {
      chapter1: {
        required: [
          'GOAL_CHANGED Duy Khôi -> điều tra Mảnh Ký Ức Vỡ',
          'Giữ lại quyền truy cập/bản sao của Mảnh Ký Ức Vỡ bằng một item operation có object reference hợp lệ',
        ],
        acceptable: [
          'FACT_REGISTERED về nội dung mảnh hình ảnh/âm thanh thực sự quan sát được',
          'SECRET_REVEALED cho tri thức Duy Khôi vừa tự phát hiện',
          'THREAD_PROGRESS nếu tuyến Giải mã Mảnh Ký Ức Vỡ đã tồn tại',
        ],
        forbidden: [
          'CHARACTER_DIED hoặc kết luận có nạn nhân đã chết',
          'CHARACTER_STATUS_CHANGED chỉ để lặp lại mục tiêu/quyết tâm',
          'Bất kỳ fact khẳng định danh tính khuôn mặt, nguyên nhân màu đỏ hoặc nguồn tiếng thét',
        ],
      },
      chapter2Excerpt: {
        required: [],
        acceptable: ['FACT_REGISTERED về Lâm Đồng nếu toàn văn xác nhận tên và vai trò môi giới'],
        forbidden: ['OBJECT_ACQUIRED với object_name là mô tả thông tin "Địa chỉ và tên Lâm Đồng"'],
      },
    },
    runs: [],
  };
  let chapterOneText = '';

  beforeAll(async () => {
    if (!STORY_PATH) throw new Error('STORYFORGE_AXIOM_STORY_PATH is required for this audit.');
    chapterOneText = await readFile(STORY_PATH, 'utf8');
    await db.open();
    harness.send.mockImplementation(({ taskType, messages, onComplete, onError }) => {
      try {
        let content;
        if (taskType === 'chapter_summary') {
          content = harness.scenario === 'chapter2_excerpt'
            ? 'Duy Khoa chuyển cho Duy Khôi một gói dữ liệu chứa địa chỉ và tên của một môi giới thông tin.'
            : chapterOneSummary;
        } else if (taskType === 'feedback_extract') {
          content = `\`\`\`json\n${JSON.stringify(entityResponse(harness.scenario), null, 2)}\n\`\`\``;
        } else if (taskType === 'canon_extract_ops') {
          const attempt = (harness.attempts.get(taskType) || 0) + 1;
          harness.attempts.set(taskType, attempt);
          content = JSON.stringify(canonResponse(harness.scenario, attempt));
        } else if (taskType === 'canon_adjudicate_warnings') {
          content = '{"decisions":[]}';
        } else {
          throw new Error(`Unexpected AI task: ${taskType}`);
        }
        harness.records.push({ taskType, messages: structuredClone(messages), response: content });
        queueMicrotask(() => onComplete(content));
      } catch (error) {
        queueMicrotask(() => onError(error));
      }
    });
  });

  afterAll(async () => {
    artifact.generatedAt = new Date().toISOString();
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await clearDatabase();
    db.close();
  });

  it('keeps Chapter 1 draft when the prompt-noncompliant response survives the bounded retry', async () => {
    const run = await runScenario(chapterOneText, 'reported');
    artifact.runs.push(run);

    expect(run.completionResult).toMatchObject({
      ok: false,
      canonResult: {
        extractionStatus: 'failed',
        extractedCount: 6,
        committedCount: 0,
        filteredCount: 6,
        extractionRetried: true,
        extractionAttemptCount: 2,
      },
    });
    expect(run.databaseAndStore.chapter.status).toBe('draft');
    expect(run.databaseAndStore.events).toEqual([]);
    expect(run.databaseAndStore.reports.map((report) => report.rule_code))
      .toContain('CANON_EXTRACT_RETRY_EXHAUSTED');
  }, 30000);

  it('repairs and commits Chapter 1 when the second response obeys the retry feedback', async () => {
    const run = await runScenario(chapterOneText, 'reported_then_corrected');
    artifact.runs.push(run);

    expect(run.completionResult).toMatchObject({
      ok: true,
      canonResult: {
        extractionStatus: 'succeeded',
        extractedCount: 5,
        committedCount: 5,
        filteredCount: 0,
        extractionRetried: true,
        extractionAttemptCount: 2,
      },
    });
    expect(run.databaseAndStore.chapter.status).toBe('done');
    expect(run.databaseAndStore.events.map((event) => event.op_type)).toEqual([
      'OBJECT_ACQUIRED',
      'FACT_REGISTERED',
      'SECRET_REVEALED',
      'GOAL_CHANGED',
      'THREAD_PROGRESS',
    ]);
    expect(run.databaseAndStore.reports.map((report) => report.rule_code))
      .toContain('CANON_EXTRACT_RETRY_SUCCEEDED');
  }, 30000);

  it('commits the semantic changes when the simulated AI obeys the same real prompt', async () => {
    const run = await runScenario(chapterOneText, 'corrected');
    artifact.runs.push(run);

    expect(run.completionResult).toMatchObject({
      ok: true,
      canonResult: { extractionStatus: 'succeeded', extractedCount: 5, committedCount: 5, filteredCount: 0 },
    });
    expect(run.databaseAndStore.chapter.status).toBe('done');
    expect(run.databaseAndStore.events.map((event) => event.op_type)).toEqual([
      'OBJECT_ACQUIRED',
      'FACT_REGISTERED',
      'SECRET_REVEALED',
      'GOAL_CHANGED',
      'THREAD_PROGRESS',
    ]);
  }, 30000);

  it('reproduces the Chapter 2 object mapping warning from the supplied excerpt', async () => {
    const run = await runScenario(chapterTwoExcerpt, 'chapter2_excerpt');
    artifact.runs.push(run);

    expect(run.completionResult).toMatchObject({
      ok: false,
      canonResult: {
        extractionStatus: 'failed',
        extractedCount: 1,
        committedCount: 0,
        filteredCount: 1,
        extractionRetried: true,
        extractionAttemptCount: 2,
      },
    });
    expect(run.databaseAndStore.chapter.status).toBe('draft');
    expect(run.databaseAndStore.reports.map((report) => report.rule_code))
      .toContain('CANON_EXTRACT_RETRY_EXHAUSTED');
    expect(run.databaseAndStore.events).toEqual([]);
  }, 30000);
});
