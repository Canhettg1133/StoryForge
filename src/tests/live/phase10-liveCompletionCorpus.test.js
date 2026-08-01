import 'fake-indexeddb/auto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  canonicalResponsesByChapter,
  canonCompletionStory,
  entityResponsesByChapter,
} from '../fixtures/canonCompletionStory.js';
import { parseAIJsonValue } from '../../utils/aiJson.js';

const LIVE_ENABLED = process.env.STORYFORGE_LIVE_COMPLETION === '1';
const API_KEY = String(process.env.STORYFORGE_LIVE_API_KEY || '').trim();
const API_BASE_URL = String(
  process.env.STORYFORGE_LIVE_API_BASE_URL || 'https://catiecli.sukaka.top/v1',
).replace(/\/+$/u, '');
const LIVE_MODELS = String(process.env.STORYFORGE_LIVE_MODELS || '')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const RUNS_PER_MODEL = Math.max(1, Number(process.env.STORYFORGE_LIVE_RUNS || 2));
const CONFIGURED_LIVE_RPM = Number(process.env.STORYFORGE_LIVE_RPM || 8);
const LIVE_REQUESTS_PER_MINUTE = Number.isFinite(CONFIGURED_LIVE_RPM) && CONFIGURED_LIVE_RPM > 0
  ? Math.max(1, Math.min(10, CONFIGURED_LIVE_RPM))
  : 8;
const LIVE_REQUEST_INTERVAL_MS = Math.ceil(60000 / LIVE_REQUESTS_PER_MINUTE);
let nextLiveRequestAt = 0;
let liveRateQueue = Promise.resolve();

const harness = vi.hoisted(() => ({
  currentChapterId: null,
  currentModel: '',
  currentRun: 0,
  liveSummary: false,
  records: [],
  send: vi.fn(),
}));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForLiveRateSlot() {
  const turn = liveRateQueue.then(async () => {
    const waitMs = Math.max(0, nextLiveRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    nextLiveRequestAt = Date.now() + LIVE_REQUEST_INTERVAL_MS;
  });
  liveRateQueue = turn.catch(() => undefined);
  return turn;
}

async function requestLiveCompletion({ model, messages, taskType }) {
  const startedAt = Date.now();
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitForLiveRateSlot();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('live-eval-timeout'), 120000);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: (messages || []).map((message) => ({
            role: message.role === 'model' ? 'assistant' : message.role,
            content: String(message.content || ''),
          })),
          stream: false,
          max_tokens: 65536,
        }),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        const retryable = response.status === 429 || response.status === 499 || response.status >= 500;
        const error = new Error(`Live AI HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
        error.status = response.status;
        if (retryable && attempt < 3) {
          lastError = error;
          await sleep(1000 * attempt);
          continue;
        }
        throw error;
      }
      const payload = JSON.parse(bodyText);
      const content = String(payload?.choices?.[0]?.message?.content || '');
      if (!content.trim()) throw new Error('Live AI response has no message content.');
      return {
        content,
        responseModel: payload?.model || model,
        latencyMs: Date.now() - startedAt,
        attempt,
        taskType,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3 && (!error?.status || error.status === 429 || error.status === 499 || error.status >= 500)) {
        await sleep(1000 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new Error('Live AI request failed.');
}

vi.mock('../../services/ai/client', () => ({
  default: {
    send: harness.send,
    abort: vi.fn(),
    setRouter: vi.fn(),
  },
}));

import db from '../../services/db/database.js';
import useProjectStore from '../../stores/projectStore.js';

const PROJECT_ID = canonCompletionStory.project.id;
const LIVE_CHAPTER = {
  chapter: {
    id: 9119,
    project_id: PROJECT_ID,
    order_index: 8,
    title: 'Chương 9: Người thợ ở xưởng kính',
    status: 'draft',
  },
  scene: {
    id: 9291,
    project_id: PROJECT_ID,
    chapter_id: 9119,
    order_index: 0,
    title: 'Khế ước cuối cùng',
    draft_text: 'Tại Xưởng Kính Mù, người thợ máy Tạ Nghi trao Chìa Khóa Sương cho Mai An và tuyên bố nó tuân theo Khế Ước Mù. Một lưỡi kính rơi xuyên ngực Tạ Nghi; anh qua đời tại chỗ và Mai không còn bắt được mạch.',
  },
  expectedCanonTypes: [
    'CHARACTER_LOCATION_CHANGED',
    'OBJECT_ACQUIRED',
    'CHARACTER_DIED',
  ],
  expectedCanonOps: [
    {
      op_type: 'CHARACTER_LOCATION_CHANGED',
      subject_name: 'Mai An',
      location_name: 'Xưởng Kính Mù',
    },
    {
      op_type: 'OBJECT_ACQUIRED',
      subject_name: 'Mai An',
      object_name: 'Chìa Khóa Sương',
    },
    {
      op_type: 'CHARACTER_DIED',
      subject_name: 'Tạ Nghi',
    },
  ],
  requiredNewEntities: {
    characters: ['Tạ Nghi'],
    locations: ['Xưởng Kính Mù'],
    objects: ['Chìa Khóa Sương'],
    terms: ['Khế Ước Mù'],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .replace(/[^a-zA-Z0-9]+/gu, ' ')
    .trim()
    .toLowerCase();
}

function multisetDifference(left = [], right = []) {
  const remaining = [...right];
  return left.filter((item) => {
    const index = remaining.indexOf(item);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function safeParseJson(text) {
  try {
    return parseAIJsonValue(text);
  } catch {
    return null;
  }
}

function evaluateRawCanon(record, chapterText) {
  const parsed = safeParseJson(record?.content || '');
  const ops = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.ops) ? parsed.ops : []);
  const ungroundedEvidence = ops.filter((op) => {
    const evidence = normalizeText(op?.evidence);
    return !evidence || !normalizeText(chapterText).includes(evidence);
  }).map((op) => ({ op_type: op?.op_type, evidence: op?.evidence || '' }));
  return {
    parsed: Boolean(parsed),
    rawOpCount: ops.length,
    rawOpTypes: ops.map((op) => op?.op_type || ''),
    ungroundedEvidence,
  };
}

function evaluateEntityExtraction(extracted, chapterText, rosterBefore, requiredNew = null) {
  const groups = ['characters', 'locations', 'objects', 'terms'];
  const issues = [];
  const normalizedChapter = normalizeText(chapterText);
  const rosterByGroup = {
    characters: rosterBefore.characters,
    locations: rosterBefore.locations,
    objects: rosterBefore.objects,
    terms: rosterBefore.worldTerms,
  };
  groups.forEach((group) => {
    const items = Array.isArray(extracted?.[group]) ? extracted[group] : [];
    items.forEach((item) => {
      const action = String(item?.identity_action || '');
      const roster = rosterByGroup[group] || [];
      const matched = roster.find((entity) => entity.id === item?.existing_entity_id);
      const mentionedNames = [item?.name, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
        .map(normalizeText)
        .filter(Boolean);
      if (!['existing', 'new'].includes(action)) {
        issues.push(`${group}:${item?.name || '?'} thiếu identity_action hợp lệ`);
      } else if (action === 'existing') {
        if (!matched || normalizeText(matched.name) !== normalizeText(item?.name)) {
          issues.push(`${group}:${item?.name || '?'} map sai existing_entity_id`);
        }
      } else if (item?.existing_entity_id !== null) {
        issues.push(`${group}:${item?.name || '?'} new nhưng existing_entity_id không phải null`);
      }
      if (!mentionedNames.some((name) => normalizedChapter.includes(name))) {
        issues.push(`${group}:${item?.name || '?'} không có tên/alias trong chương`);
      }
    });
  });

  const missingRequiredNew = [];
  if (requiredNew) {
    groups.forEach((group) => {
      const actualNewNames = (extracted?.[group] || [])
        .filter((item) => item?.identity_action === 'new')
        .map((item) => normalizeText(item.name));
      (requiredNew[group] || []).forEach((name) => {
        if (!actualNewNames.includes(normalizeText(name))) {
          missingRequiredNew.push(`${group}:${name}`);
        }
      });
    });
  }
  return { issues, missingRequiredNew };
}

function entitySemanticKey(group, item = {}) {
  return [
    group,
    String(item.identity_action || ''),
    item.existing_entity_id == null ? '' : String(item.existing_entity_id),
    normalizeText(item.name),
  ].join('|');
}

function evaluateEntitySemanticDelta(chapterId, extracted) {
  const expected = chapterId === LIVE_CHAPTER.chapter.id
    ? Object.fromEntries(Object.entries(LIVE_CHAPTER.requiredNewEntities).map(([group, names]) => [
      group,
      names.map((name) => ({
        identity_action: 'new',
        existing_entity_id: null,
        name,
      })),
    ]))
    : (entityResponsesByChapter[chapterId] || {
      characters: [], locations: [], objects: [], terms: [],
    });
  const groups = ['characters', 'locations', 'objects', 'terms'];
  const expectedKeys = groups.flatMap((group) => (
    (expected[group] || []).map((item) => entitySemanticKey(group, item))
  ));
  const actualKeys = groups.flatMap((group) => (
    (extracted?.[group] || []).map((item) => entitySemanticKey(group, item))
  ));
  return {
    missingExpectedEntities: multisetDifference(expectedKeys, actualKeys),
    unexpectedEntities: multisetDifference(actualKeys, expectedKeys),
  };
}

function canonSemanticKey(op = {}) {
  return [
    String(op.op_type || ''),
    normalizeText(op.subject_name),
    normalizeText(op.target_name),
    normalizeText(op.location_name),
    normalizeText(op.thread_title),
    normalizeText(op.fact_description),
    normalizeText(op.object_name),
  ].join('|');
}

function expectedCanonOps(chapterId) {
  if (chapterId === LIVE_CHAPTER.chapter.id) return LIVE_CHAPTER.expectedCanonOps;
  return canonicalResponsesByChapter[chapterId]?.ops || [];
}

function evaluateCanonSemanticDelta(chapterId, committedEvents) {
  const expectedKeys = expectedCanonOps(chapterId).map(canonSemanticKey);
  const actualKeys = (committedEvents || []).map(canonSemanticKey);
  return {
    missingExpectedOps: multisetDifference(expectedKeys, actualKeys),
    unexpectedOps: multisetDifference(actualKeys, expectedKeys),
  };
}

function findEntityByName(items, name) {
  const key = normalizeText(name);
  return (items || []).find((item) => normalizeText(item.name) === key) || null;
}

function evaluateProjectionCheckpoint(chapterId, state) {
  const checks = [];
  const entityStateById = new Map((state.entityStates || []).map((item) => [item.entity_id, item]));
  const itemStateById = new Map((state.itemStates || []).map((item) => [item.object_id, item]));
  const threadStateById = new Map((state.threadStates || []).map((item) => [item.thread_id, item]));
  const characterState = (name) => {
    const character = findEntityByName(state.characters, name);
    return character ? entityStateById.get(character.id) || null : null;
  };
  const objectState = (name) => {
    const object = findEntityByName(state.objects, name);
    return object ? itemStateById.get(object.id) || null : null;
  };
  const addCheck = (label, actual, expected) => {
    checks.push({ label, pass: actual === expected, actual, expected });
  };

  if (chapterId >= 9113) {
    addCheck('Lê Minh đã chết', characterState('Lê Minh')?.alive_status || 'missing', 'dead');
    addCheck('Mai An biết đủ 3 bí mật', Object.keys(characterState('Mai An')?.knowledge || {}).length, 3);
    addCheck('Vũ Kha biết đủ 3 bí mật', Object.keys(characterState('Vũ Kha')?.knowledge || {}).length, 3);
  }
  if (chapterId >= 9115) {
    addCheck('Bạch Ly đã chết', characterState('Bạch Ly')?.alive_status || 'missing', 'dead');
    addCheck('Ấn Đồng Hộ Mệnh đã dùng hết', objectState('Ấn Đồng Hộ Mệnh')?.availability || 'missing', 'consumed');
    addCheck('Đèn Bão Lam đã bị phá hủy', objectState('Đèn Bão Lam')?.availability || 'missing', 'destroyed');
    addCheck('Tuyến Khóa Cổng Tro đã khép', threadStateById.get(9801)?.state || 'missing', 'resolved');
  }
  if (chapterId === 9118) {
    const goals = (characterState('Mai An')?.goals_active || []).map(normalizeText);
    checks.push({
      label: 'Mai An chuyển sang điều tra chuỗi mất tích',
      pass: goals.some((goal) => goal.includes(normalizeText('điều tra chuỗi mất tích quanh kho lưu trữ'))),
      actual: goals,
      expected: ['điều tra chuỗi mất tích quanh kho lưu trữ'],
    });
  }
  if (chapterId === LIVE_CHAPTER.chapter.id) {
    addCheck('Tạ Nghi đã chết', characterState('Tạ Nghi')?.alive_status || 'missing', 'dead');
  }
  return checks;
}

async function clearDatabase() {
  await Promise.all(db.tables.map((table) => table.clear()));
}

async function seedStory() {
  const chapters = [...canonCompletionStory.chapters, LIVE_CHAPTER.chapter];
  const scenes = [...canonCompletionStory.scenes, LIVE_CHAPTER.scene];
  await db.projects.add(clone(canonCompletionStory.project));
  await Promise.all([
    db.chapters.bulkAdd(clone(chapters)),
    db.scenes.bulkAdd(clone(scenes)),
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
    chapters: clone(chapters),
    scenes: clone(scenes),
    activeChapterId: chapters[0].id,
    chapterCompletionById: {},
  });
  return { chapters, scenes };
}

async function loadRoster() {
  const [characters, locations, objects, worldTerms] = await Promise.all([
    db.characters.where('project_id').equals(PROJECT_ID).toArray(),
    db.locations.where('project_id').equals(PROJECT_ID).toArray(),
    db.objects.where('project_id').equals(PROJECT_ID).toArray(),
    db.worldTerms.where('project_id').equals(PROJECT_ID).toArray(),
  ]);
  return { characters, locations, objects, worldTerms };
}

function expectedCanonTypes(chapterId) {
  if (chapterId === LIVE_CHAPTER.chapter.id) return LIVE_CHAPTER.expectedCanonTypes;
  return (canonicalResponsesByChapter[chapterId]?.ops || []).map((op) => op.op_type);
}

async function snapshotRunState() {
  const [
    characters,
    locations,
    objects,
    worldTerms,
    events,
    entityStates,
    itemStates,
    threadStates,
    relationshipStates,
  ] = await Promise.all([
    db.characters.where('project_id').equals(PROJECT_ID).toArray(),
    db.locations.where('project_id').equals(PROJECT_ID).toArray(),
    db.objects.where('project_id').equals(PROJECT_ID).toArray(),
    db.worldTerms.where('project_id').equals(PROJECT_ID).toArray(),
    db.story_events.where('project_id').equals(PROJECT_ID).toArray(),
    db.entity_state_current.where('project_id').equals(PROJECT_ID).toArray(),
    db.item_state_current.where('project_id').equals(PROJECT_ID).toArray(),
    db.plot_thread_state.where('project_id').equals(PROJECT_ID).toArray(),
    db.relationship_state_current.where('project_id').equals(PROJECT_ID).toArray(),
  ]);
  return {
    characters,
    locations,
    objects,
    worldTerms,
    events,
    entityStates,
    itemStates,
    threadStates,
    relationshipStates,
  };
}

describe.skipIf(!LIVE_ENABLED)('phase10 live completion semantic corpus', () => {
  beforeAll(async () => {
    if (!API_KEY) throw new Error('Missing STORYFORGE_LIVE_API_KEY.');
    if (LIVE_MODELS.length === 0) throw new Error('Missing STORYFORGE_LIVE_MODELS.');
    await db.open();
    harness.send.mockImplementation(({
      taskType,
      messages,
      onComplete,
      onError,
    }) => {
      if (taskType === 'chapter_summary' && !harness.liveSummary) {
        onComplete(`Tóm tắt cục bộ cho chương ${harness.currentChapterId}.`);
        return;
      }
      requestLiveCompletion({
        model: harness.currentModel,
        messages,
        taskType,
      }).then((response) => {
        harness.records.push({
          model: harness.currentModel,
          run: harness.currentRun,
          chapterId: harness.currentChapterId,
          taskType,
          ...response,
        });
        onComplete(response.content);
      }).catch((error) => {
        harness.records.push({
          model: harness.currentModel,
          run: harness.currentRun,
          chapterId: harness.currentChapterId,
          taskType,
          error: error?.message || String(error),
        });
        onError(error);
      });
    });
  });

  afterAll(async () => {
    await clearDatabase();
    db.close();
  });

  it('runs every chapter repeatedly through real models and records semantic deltas', async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      apiBaseUrl: API_BASE_URL,
      models: LIVE_MODELS,
      runsPerModel: RUNS_PER_MODEL,
      requestsPerMinute: LIVE_REQUESTS_PER_MINUTE,
      runs: [],
    };

    for (const model of LIVE_MODELS) {
      for (let run = 1; run <= RUNS_PER_MODEL; run += 1) {
        await clearDatabase();
        const { chapters, scenes } = await seedStory();
        harness.currentModel = model;
        harness.currentRun = run;
        harness.liveSummary = run === 1;
        const runReport = { model, run, chapters: [], stoppedAtChapterId: null };

        for (const chapter of chapters) {
          harness.currentChapterId = chapter.id;
          process.stdout.write(`LIVE_PROGRESS model=${model} run=${run} chapter=${chapter.id}\n`);
          const rosterBefore = await loadRoster();
          const recordStart = harness.records.length;
          const result = await useProjectStore.getState().runChapterCompletion(chapter.id, {
            mode: 'manual',
          });
          const chapterRecords = harness.records.slice(recordStart);
          const canonRecord = chapterRecords.find((record) => record.taskType === 'canon_extract_ops');
          const chapterText = scenes
            .filter((scene) => scene.chapter_id === chapter.id)
            .sort((left, right) => left.order_index - right.order_index)
            .map((scene) => scene.draft_text)
            .join('\n\n');
          const committedEvents = await db.story_events
            .where('chapter_id').equals(chapter.id)
            .filter((event) => event.status === 'committed')
            .toArray();
          const stateAfterChapter = await snapshotRunState();
          const actualTypes = committedEvents.map((event) => event.op_type);
          const expectedTypes = expectedCanonTypes(chapter.id);
          const entityEvaluation = evaluateEntityExtraction(
            result?.extracted,
            chapterText,
            rosterBefore,
            chapter.id === LIVE_CHAPTER.chapter.id ? LIVE_CHAPTER.requiredNewEntities : null,
          );
          runReport.chapters.push({
            chapterId: chapter.id,
            title: chapter.title,
            ok: Boolean(result?.ok),
            kind: result?.kind || '',
            message: result?.message || '',
            expectedCanonTypes: expectedTypes,
            actualCanonTypes: actualTypes,
            missingCanonTypes: multisetDifference(expectedTypes, actualTypes),
            extraCanonTypes: multisetDifference(actualTypes, expectedTypes),
            canonSemanticDelta: evaluateCanonSemanticDelta(chapter.id, committedEvents),
            canonRawEvaluation: evaluateRawCanon(canonRecord, chapterText),
            entityEvaluation: {
              ...entityEvaluation,
              ...evaluateEntitySemanticDelta(chapter.id, result?.extracted),
            },
            projectionChecks: evaluateProjectionCheckpoint(chapter.id, stateAfterChapter),
            extracted: result?.extracted || null,
            extractionStats: result?.extractionStats || null,
            canonResult: result?.canonResult || null,
            aiRecords: chapterRecords,
          });
          if (!result?.ok) {
            runReport.stoppedAtChapterId = chapter.id;
            break;
          }
        }
        runReport.finalState = await snapshotRunState();
        report.runs.push(runReport);
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const outputDir = path.resolve('tmp', 'canon-completion-evals', timestamp);
    await mkdir(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, 'report.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`LIVE_COMPLETION_REPORT=${reportPath}\n`);

    expect(report.runs).toHaveLength(LIVE_MODELS.length * RUNS_PER_MODEL);
  }, 30 * 60 * 1000);
});
