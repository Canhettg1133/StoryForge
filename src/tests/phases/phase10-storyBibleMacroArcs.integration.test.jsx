import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { aiServiceMock, dbMock } = vi.hoisted(() => {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDbMock() {
    let state = {
      projects: [],
      macro_arcs: [],
    };

    const operations = {
      add: 0,
      update: 0,
      delete: 0,
    };

    function getNextId(tableName) {
      return state[tableName].reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0) + 1;
    }

    return {
      projects: {
        async get(id) {
          return clone(state.projects.find((item) => item.id === id) || null);
        },
      },
      macro_arcs: {
        where(field) {
          return {
            equals(expected) {
              return {
                async sortBy(sortField) {
                  return clone(
                    state.macro_arcs
                      .filter((row) => row?.[field] === expected)
                      .sort((left, right) => (Number(left?.[sortField]) || 0) - (Number(right?.[sortField]) || 0))
                  );
                },
              };
            },
          };
        },
        async add(row) {
          operations.add += 1;
          const nextRow = { ...clone(row), id: row?.id || getNextId('macro_arcs') };
          state.macro_arcs.push(nextRow);
          return nextRow.id;
        },
        async update(id, payload) {
          operations.update += 1;
          const index = state.macro_arcs.findIndex((row) => row.id === id);
          if (index < 0) return 0;
          state.macro_arcs[index] = {
            ...state.macro_arcs[index],
            ...clone(payload),
          };
          return 1;
        },
        async delete(id) {
          operations.delete += 1;
          state.macro_arcs = state.macro_arcs.filter((row) => row.id !== id);
        },
      },
      __reset(seed = {}) {
        state = {
          projects: clone(seed.projects || []),
          macro_arcs: clone(seed.macro_arcs || []),
        };
        operations.add = 0;
        operations.update = 0;
        operations.delete = 0;
      },
      __rows(tableName) {
        return clone(state[tableName] || []);
      },
      __operations: operations,
    };
  }

  return {
    aiServiceMock: {
      setRouter: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
    },
    dbMock: createDbMock(),
  };
});

vi.mock('../../services/ai/client.js', () => ({
  default: aiServiceMock,
}));

vi.mock('../../services/db/database.js', () => ({
  default: dbMock,
}));

import db from '../../services/db/database.js';
import aiService from '../../services/ai/client.js';
import useArcGenStore from '../../stores/arcGenerationStore';
import useStoryBibleMacroArcs from '../../pages/StoryBible/hooks/useStoryBibleMacroArcs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialArcGenState = useArcGenStore.getState();

function HookHarness({ hookProps, onValue }) {
  const value = useStoryBibleMacroArcs(hookProps);

  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return null;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountStoryBibleMacroArcsHook(hookProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const latest = { current: null };

  await act(async () => {
    root.render(<HookHarness hookProps={hookProps} onValue={(value) => { latest.current = value; }} />);
  });
  await flushEffects();

  return {
    get current() {
      return latest.current;
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('phase10 StoryBible macro arc integration', () => {
  beforeEach(() => {
    db.__reset();
    aiService.send.mockReset();
    useArcGenStore.setState(initialArcGenState, true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('preserves saved chapter anchors when AI analysis returns an explicit empty anchor array', async () => {
    db.__reset({
      projects: [
        { id: 1, title: 'Project 1', prompt_templates: '{}' },
      ],
      macro_arcs: [
        {
          id: 101,
          project_id: 1,
          order_index: 0,
          title: 'Arc 1',
          description: 'Mo ta cot moc',
          chapter_from: 20,
          chapter_to: 30,
          emotional_peak: '',
          chapter_anchors: [
            {
              id: 'anchor_existing_1',
              targetChapter: 25,
              strictness: 'hard',
              requirementText: 'Main phai gap Nu A',
              objectiveRefs: [],
              focusCharacters: ['Main', 'Nu A'],
              successSignals: [],
              forbidBefore: true,
              notes: '',
            },
          ],
          contract_json: '',
        },
      ],
    });

    aiService.send.mockImplementationOnce(({ onComplete }) => {
      onComplete(JSON.stringify({
        contract: {
          title: 'Arc 1',
          chapter_from: 20,
          chapter_to: 30,
          emotional_peak: '',
          narrative_summary: 'Phan tich moi',
          objectives: [],
          target_states: [],
          focused_characters: [],
          max_relationship_stage: 0,
          forbidden_outcomes: [],
          chapter_anchors: [],
        },
      }));
    });

    const hookProps = {
      currentProject: { id: 1, target_length: 80 },
      title: 'Project 1',
      synopsis: 'Tom tat',
      ultimateGoal: 'Muc tieu',
      genrePrimary: 'fantasy',
      targetLength: 80,
      chaptersCount: 10,
    };

    const mounted = await mountStoryBibleMacroArcsHook(hookProps);
    expect(mounted.current?.macroArcs).toHaveLength(1);

    await act(async () => {
      await mounted.current.handleAnalyzeSavedMacroArc(mounted.current.macroArcs[0]);
    });
    await flushEffects();

    expect(mounted.current.macroArcs[0].chapter_anchors).toHaveLength(1);
    expect(mounted.current.macroArcs[0].chapter_anchors[0].id).toBe('anchor_existing_1');
    expect(db.__operations.update).toBe(1);
    expect(db.__rows('macro_arcs')[0].chapter_anchors).toHaveLength(1);
    expect(db.__rows('macro_arcs')[0].chapter_anchors[0].id).toBe('anchor_existing_1');

    await mounted.unmount();

    const remounted = await mountStoryBibleMacroArcsHook(hookProps);
    expect(remounted.current?.macroArcs).toHaveLength(1);
    expect(remounted.current.macroArcs[0].chapter_anchors).toHaveLength(1);
    expect(remounted.current.macroArcs[0].chapter_anchors[0].id).toBe('anchor_existing_1');

    await remounted.unmount();
  });

  it('blocks saving selected milestone suggestions when their raw anchors are invalid', async () => {
    db.__reset({
      projects: [
        { id: 1, title: 'Project 1', prompt_templates: '{}' },
      ],
      macro_arcs: [],
    });

    const mounted = await mountStoryBibleMacroArcsHook({
      currentProject: { id: 1, target_length: 80 },
      title: 'Project 1',
      synopsis: 'Tom tat',
      ultimateGoal: 'Muc tieu',
      genrePrimary: 'fantasy',
      targetLength: 80,
      chaptersCount: 10,
    });

    await act(async () => {
      useArcGenStore.setState({
        macroMilestoneSuggestions: {
          milestones: [
            {
              order: 1,
              title: 'Arc invalid',
              description: 'Mo ta',
              chapter_from: 20,
              chapter_to: 30,
              emotional_peak: '',
              contract_json: '',
              chapter_anchors: [
                {
                  id: 'ANCHOR1',
                  targetChapter: 0,
                  strictness: 'hard',
                  requirementText: '',
                },
              ],
            },
          ],
        },
      });
    });
    await flushEffects();

    expect(mounted.current.editableMilestoneSuggestions).toHaveLength(1);
    expect(mounted.current.hasBlockingSelectedEditableAnchorIssue).toBe(true);

    await act(async () => {
      await mounted.current.handleSaveMilestones();
    });
    await flushEffects();

    expect(db.__operations.add).toBe(0);
    expect(db.__rows('macro_arcs')).toEqual([]);
    expect(useArcGenStore.getState().macroMilestoneSuggestions).not.toBeNull();

    await mounted.unmount();
  });
});
