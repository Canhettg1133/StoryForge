import { describe, expect, it } from 'vitest';
import { selectCanonPackContext } from '../../services/labLite/canonPackContext.js';
import { buildFanficProjectSeed } from '../../services/labLite/fanficProjectSetup.js';
import { buildPrompt } from '../../services/ai/promptBuilder.js';
import { TASK_TYPES } from '../../services/ai/router.js';

describe('Lab Lite Phase 7 - fanfic project setup', () => {
  it('creates fanfic seed data from a Canon Pack without materializing Story Bible', () => {
    const seed = buildFanficProjectSeed({
      canonPack: {
        id: 'pack_1',
        title: 'Original Canon Pack',
        metadata: { sourceTitle: 'Original Story' },
        globalCanon: { mainCharacters: ['Lan', 'Kha'] },
        canonRestrictions: ['Lan cannot know the royal secret before chapter 20.'],
        creativeGaps: ['Kha childhood is mostly untold.'],
      },
      setup: {
        fanficType: 'branch_from_event',
        adherenceLevel: 'strict',
        divergencePoint: 'Kha reveals the warning earlier.',
      },
    });

    expect(seed.title).toContain('Original Story');
    expect(seed.description).toContain('Kha reveals the warning earlier');
    expect(seed.fanfic_setup.adherenceLevel).toBe('strict');
    expect(seed.chapters).toHaveLength(3);
    expect(seed).not.toHaveProperty('characters');
    expect(seed).not.toHaveProperty('canonFacts');
  });
});

describe('Lab Lite Phase 8 - Canon Pack writer context', () => {
  it('selects relevant Canon Pack slices without returning the full pack', () => {
    const context = selectCanonPackContext({
      charCap: 2400,
      project: {
        project_mode: 'fanfic',
        canon_adherence_level: 'strict',
        divergence_point: 'After ending.',
      },
      sceneText: 'Lan enters the old shrine.',
      characters: [{ name: 'Lan' }],
      canonPack: {
        id: 'pack_1',
        title: 'Pack',
        globalCanon: { summary: 'Original canon summary.' },
        characterCanon: [
          { name: 'Lan', status: 'alive', voice: 'calm' },
          { name: 'Unrelated', status: 'unknown' },
        ],
        relationshipCanon: [{ characterA: 'Lan', characterB: 'Kha', change: 'trust is fragile' }],
        chapterCanon: [{ chapterIndex: 1, summary: 'Lan enters shrine.' }],
        styleCanon: { observations: ['Short sentences.'] },
        canonRestrictions: ['Do not revive dead mentor.'],
        creativeGaps: ['Shrine history is open.'],
        hugeUnusedLayer: 'x'.repeat(10000),
      },
    });

    expect(context.packTitle).toBe('Pack');
    expect(context.characterCanon.map((item) => item.name)).toContain('Lan');
    expect(context).not.toHaveProperty('hugeUnusedLayer');
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(2400);
  });

  it('injects Canon Pack context into writing prompts', () => {
    const messages = buildPrompt(TASK_TYPES.CONTINUE, {
      projectId: 1,
      projectTitle: 'Fanfic Project',
      sceneText: 'Lan waits.',
      fanficCanonContext: {
        packTitle: 'Pack',
        projectMode: 'fanfic',
        adherenceLevel: 'strict',
        divergencePoint: 'After ending.',
        globalCanon: 'Original canon summary.',
        characterCanon: [{ name: 'Lan', status: 'alive', voice: 'calm' }],
        relationshipCanon: [],
        styleCanon: 'Short sentences.',
        canonRestrictions: ['Do not revive dead mentor.'],
        creativeGaps: ['Shrine history is open.'],
      },
    });

    expect(messages[0].content).toContain('[CANON PACK CHO DONG NHAN / VIET LAI]');
    expect(messages[0].content).toContain('Do not revive dead mentor.');
    expect(messages[0].content).toContain('Shrine history is open.');
  });
});
