import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let projectState;
let codexState;
let plotState;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../stores/plotStore', () => ({
  default: () => plotState,
}));

vi.mock('../../services/labLite/canonPackRepository.js', () => ({
  listAvailableCanonPacks: vi.fn(async () => []),
}));

vi.mock('../../services/projects/projectTemplateService.js', () => ({
  createProjectFromBibleTemplate: vi.fn(),
  getBibleTemplateSourceSummary: vi.fn(),
}));

vi.mock('../../services/labLite/fanficProjectSetup.js', () => ({
  CANON_ADHERENCE_LEVELS: [{ value: 'balanced', label: 'Balanced' }],
  FANFIC_TYPES: [{ value: 'continue_after_ending', label: 'Continue' }],
  PROJECT_MODES: { FANFIC: 'fanfic' },
  generateFanficProjectSeed: vi.fn(),
}));

vi.mock('../../services/ai/client', () => ({
  default: {
    send: vi.fn(),
  },
}));

vi.mock('../../services/db/database', () => ({
  default: {
    projects: {
      update: vi.fn(),
    },
    macro_arcs: {
      add: vi.fn(),
    },
  },
}));

import NewProjectModal from '../../pages/Dashboard/NewProjectModal.jsx';
import ProjectWizard from '../../pages/Dashboard/ProjectWizard.jsx';
import EventEditModal from '../../pages/Lab/CorpusLab/components/EventEditModal.jsx';

function setInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findInitialChapterInput(container) {
  return container.querySelector('input[aria-label="Số chương khởi đầu"]')
    || Array.from(container.querySelectorAll('input[inputmode="numeric"], input[type="number"]')).at(-1);
}

describe('phase10 number input editing', () => {
  let container;
  let root;

  beforeEach(() => {
    projectState = {
      createProject: vi.fn(async () => 7),
      createChapter: vi.fn(async () => undefined),
      projects: [],
      loadProjects: vi.fn(async () => undefined),
    };
    codexState = {
      createCharacter: vi.fn(),
      createLocation: vi.fn(),
      createObject: vi.fn(),
      createWorldTerm: vi.fn(),
      createFaction: vi.fn(),
      saveChapterSummary: vi.fn(),
    };
    plotState = {
      createPlotThread: vi.fn(),
    };
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
  });

  it('lets manual project creation clear and retype the initial chapter count before submit', async () => {
    await act(async () => {
      root.render(<NewProjectModal onClose={() => {}} onCreated={() => {}} />);
    });

    const choices = container.querySelectorAll('.wizard-choice-btn');
    await act(async () => {
      choices[1].click();
    });

    const initialChapterInput = findInitialChapterInput(container);
    expect(initialChapterInput).toBeTruthy();

    await act(async () => {
      setInputValue(initialChapterInput, '');
    });
    expect(initialChapterInput.value).toBe('');

    await act(async () => {
      setInputValue(initialChapterInput, '5');
    });
    expect(initialChapterInput.value).toBe('5');
  });

  it('lets the AI wizard clear and retype the initial chapter count', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });

    const initialChapterInput = findInitialChapterInput(container);
    expect(initialChapterInput).toBeTruthy();

    await act(async () => {
      setInputValue(initialChapterInput, '');
    });
    expect(initialChapterInput.value).toBe('');

    await act(async () => {
      setInputValue(initialChapterInput, '5');
    });
    expect(initialChapterInput.value).toBe('5');
  });

  it('lets the corpus event chapter field be cleared before retyping', async () => {
    await act(async () => {
      root.render(
        <EventEditModal
          event={{ id: 'evt-1', description: 'Su kien', chapter: 3 }}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const chapterInput = container.querySelector('input[aria-label="Chương"]')
      || container.querySelector('input[type="number"]');
    expect(chapterInput).toBeTruthy();

    await act(async () => {
      setInputValue(chapterInput, '');
    });
    expect(chapterInput.value).toBe('');

    await act(async () => {
      setInputValue(chapterInput, '5');
    });
    expect(chapterInput.value).toBe('5');
  });
});
