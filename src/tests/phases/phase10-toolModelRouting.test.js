import { afterEach, describe, expect, it, vi } from 'vitest';

const CLIENT_MODULE_IDS = [
  '../../services/ai/client.js',
  '../../services/ai/client',
];

const RUNTIME_BLOCK = [
  '1. luat cot loi',
  '- Giu luat project.',
  '2. giong ke pov',
  '- Giu POV da chon.',
  '3. nhip chuong',
  '- Can bang nhanh cham.',
  '4. scene grammar',
  '- Giu canh ro muc tieu.',
  '5. can tranh',
  '- Tranh van phong generic.',
  '6. qa tu kiem ngam',
  '- Tu kiem canon va pacing.',
].join('\n');

const UNIVERSAL_AI_RESPONSE = JSON.stringify({
  narrative_voice: 'Giong ke mau.',
  patches: [
    {
      target_prompt: 'free_prompt',
      operation: 'append',
      after: 'Doc Style DNA truoc khi viet.',
    },
  ],
  project_style_runtime_block: RUNTIME_BLOCK,
  results: [
    {
      chapterIndex: 1,
      priority: 'high',
      recommendation: 'deep_load',
      detectedSignals: ['reveal'],
      reason: 'Co reveal quan trong.',
      confidence: 0.8,
    },
    {
      chapterIndex: 2,
      priority: 'low',
      recommendation: 'skip',
      detectedSignals: [],
      reason: 'Chua can nap sau.',
      confidence: 0.4,
    },
  ],
  arcs: [
    {
      id: 'arc_1',
      title: 'Arc 1',
      chapterStart: 1,
      chapterEnd: 2,
      summary: 'Opening arc.',
      importance: 'high',
      whyLoad: 'Main reveal.',
      recommendedDeepChapters: [1],
    },
  ],
  chapterCanon: [
    {
      chapterIndex: 1,
      summary: 'Lan finds a clue.',
      mainEvents: ['Lan finds a clue.'],
    },
  ],
  characterUpdates: [],
  relationshipUpdates: [],
  worldUpdates: [],
  timelineEvents: [],
  styleObservations: [],
  canonRestrictions: [],
  title: 'AI Seed',
  premise: 'AI premise.',
  synopsis: 'AI synopsis.',
  chapters: [
    {
      title: 'Chuong 1',
      summary: 'Opening branch.',
      purpose: 'Anchor the branch.',
      key_events: ['Branch starts.'],
      featured_characters: ['Lan'],
    },
  ],
});

function installAiClientMock(responseText = UNIVERSAL_AI_RESPONSE) {
  const client = {
    setRouter: vi.fn(),
    abort: vi.fn(),
    send: vi.fn((options = {}) => {
      options.onComplete?.(responseText);
      return {
        abort: vi.fn(),
        routeInfo: { provider: 'openai_proxy', model: 'selected-model' },
      };
    }),
  };

  CLIENT_MODULE_IDS.forEach((moduleId) => {
    vi.doMock(moduleId, () => ({ default: client }));
  });

  return client;
}

function expectCallsRespectSelectedProxyModel(send) {
  expect(send).toHaveBeenCalled();
  send.mock.calls.forEach(([options]) => {
    expect(options.routeOptions?.qualityOverride).toBeTruthy();
    expect(options.routeOptions?.useProxyQualityRouting).not.toBe(true);
  });
}

describe('phase10 user-selected model routing for non-canon tools', () => {
  afterEach(() => {
    CLIENT_MODULE_IDS.forEach((moduleId) => vi.doUnmock(moduleId));
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps Prompt Doctor analysis, merge, and patch generation on the selected proxy model', async () => {
    vi.resetModules();
    const client = installAiClientMock();
    const {
      analyzeStyleChunks,
      generatePromptPatches,
      mergeStylePack,
    } = await import('../../services/styleImporter/styleImporterRunner.js');

    await analyzeStyleChunks({
      chunks: [
        {
          id: 'chunk_1',
          label: 'chunk 1',
          text: 'Sample story text.',
          estimatedTokens: 20,
        },
      ],
    });
    await mergeStylePack({
      analyses: [
        { narrative_voice: 'A' },
        { narrative_voice: 'B' },
      ],
    });
    await generatePromptPatches({
      stylePack: { narrative_voice: 'A' },
      currentPrompts: { free_prompt: { text: 'Current free prompt.' } },
      allowedTargets: ['free_prompt'],
    });

    expect(client.send).toHaveBeenCalledTimes(3);
    expectCallsRespectSelectedProxyModel(client.send);
  });

  it('keeps Project Style Runtime generation on the selected proxy model', async () => {
    vi.resetModules();
    const client = installAiClientMock();
    const {
      generateProjectStyleRuntimeBlock,
    } = await import('../../services/ai/projectStyleRuntimeGenerator.js');

    await generateProjectStyleRuntimeBlock({
      projectTitle: 'Demo',
      genre: 'fantasy',
      aiGuidelines: 'Keep project style.',
      promptTemplates: { free_prompt: 'Write freely.' },
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    expectCallsRespectSelectedProxyModel(client.send);
  });

  it('keeps Lab Lite scout, arc mapper, and deep analysis on the selected proxy model', async () => {
    vi.resetModules();
    const client = installAiClientMock();
    const { runChapterScout, runChapterScoutBatch } = await import('../../services/labLite/chapterScout.js');
    const { runArcMapper } = await import('../../services/labLite/arcMapper.js');
    const { runDeepAnalysisBatch } = await import('../../services/labLite/deepAnalyzer.js');

    await runChapterScout({
      chapter: {
        id: 'chapter_1',
        corpusId: 'corpus_1',
        index: 1,
        title: 'Chuong 1',
        content: 'Opening paragraph.\n\nMiddle reveal.\n\nEnding hook.',
        estimatedTokens: 40,
      },
      totalChapters: 2,
      goal: 'fanfic',
    });
    await runChapterScoutBatch({
      corpusId: 'corpus_1',
      totalChapters: 2,
      goal: 'fanfic',
      chapters: [
        { index: 1, title: 'Chuong 1', content: 'A.\n\nB.\n\nC.', estimatedTokens: 30 },
        { index: 2, title: 'Chuong 2', content: 'D.\n\nE.\n\nF.', estimatedTokens: 30 },
      ],
    });
    await runArcMapper({
      corpusId: 'corpus_1',
      chapterCount: 2,
      scoutResults: [
        {
          chapterIndex: 1,
          status: 'complete',
          priority: 'high',
          recommendation: 'deep_load',
          detectedSignals: ['reveal'],
          reason: 'Important reveal.',
          confidence: 0.8,
        },
      ],
    });
    await runDeepAnalysisBatch({
      corpusTitle: 'Demo',
      target: { targetType: 'chapter', targetId: '1', chapterIndexes: [1] },
      chapters: [
        { index: 1, title: 'Chuong 1', content: 'Full text.', estimatedTokens: 20 },
      ],
    });

    expect(client.send).toHaveBeenCalledTimes(4);
    expectCallsRespectSelectedProxyModel(client.send);
  });

  it('keeps fanfic project seed generation on the selected proxy model', async () => {
    vi.resetModules();
    const client = installAiClientMock();
    const { generateFanficProjectSeed } = await import('../../services/labLite/fanficProjectSetup.js');

    await generateFanficProjectSeed({
      canonPack: {
        title: 'Canon Pack',
        metadata: { sourceTitle: 'Source Story' },
        globalCanon: { mainCharacters: ['Lan'] },
        canonRestrictions: ['Do not revive the mentor.'],
        creativeGaps: ['After ending.'],
      },
      setup: {
        fanficType: 'continue_after_ending',
        adherenceLevel: 'balanced',
        divergencePoint: 'After ending.',
      },
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    expectCallsRespectSelectedProxyModel(client.send);
  });
});
