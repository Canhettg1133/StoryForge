import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectWizard from '../../pages/Dashboard/ProjectWizard.jsx';
import aiService from '../../services/ai/client';

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

function setTextareaValue(textarea, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(textarea, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('phase10 project wizard role locks', () => {
  let container;
  let root;

  beforeEach(() => {
    projectState = {
      createProject: vi.fn(async () => 7),
      createChapter: vi.fn(async (_projectId, _title, _data) => ({ chapterId: 70 })),
    };
    codexState = {
      createCharacter: vi.fn(async () => 101),
      createLocation: vi.fn(async () => 201),
      createObject: vi.fn(async () => 301),
      createWorldTerm: vi.fn(async () => 401),
      createFaction: vi.fn(async () => 501),
      saveChapterSummary: vi.fn(async () => {}),
    };
    plotState = {
      createPlotThread: vi.fn(async () => 601),
    };
    aiService.send.mockImplementation(({ taskType, onComplete }) => {
      if (taskType === 'chapter_outline_pass') {
        onComplete(JSON.stringify({
          chapters: [{
            title: 'Chuong 1',
            purpose: 'Dat neo ban do co.',
            summary: 'Lan xuat hien tai Thanh Co va bao ve ban do.',
            opening_state: 'Lan dang giu ban do tai Thanh Co.',
            ending_state: 'Lan bao ve duoc ban do nhung bi theo doi.',
            featured_characters: ['Lan'],
            primary_location: 'Thanh Co',
            thread_titles: ['Bi mat ban do'],
            key_events: ['Lan bao ve ban do'],
            state_delta: 'Lan giu duoc ban do co.',
          }],
          plot_threads: [{
            title: 'Bi mat ban do',
            type: 'mystery',
            description: 'Truy tim nguon goc ban do.',
            state: 'active',
            opening_window: 'Chuong 1',
            anchor_chapters: ['Chuong 1'],
          }],
          proposed_entities: {
            characters: [],
            locations: [],
            objects: [],
            factions: [],
            terms: [],
            plot_threads: [],
          },
        }));
        return;
      }

      onComplete(JSON.stringify({
        title: 'Ban Do Co',
        premise: 'Lan giu ban do co dan toi mot bi mat.',
        world_profile: {
          world_name: 'Thanh Co',
          world_type: 'fantasy',
          world_rules: [],
        },
        characters: [{
          name: 'Lan',
          role: 'protagonist',
          specific_role: 'nguoi giu ban do co',
          specific_role_locked: true,
          age: '',
          appearance: 'Ao xanh',
          personality: 'Kien dinh',
          flaws: 'De tin nguoi quen',
          goals: 'Bao ve ban do',
          current_status: 'Dang giu ban do',
          story_function: 'neo mo dau',
        }],
        locations: [{ name: 'Thanh Co', description: 'Noi mo dau', story_function: 'xuat hien o chuong 1' }],
        objects: [],
        factions: [],
        terms: [],
        plot_threads: [{
          title: 'Bi mat ban do',
          type: 'mystery',
          description: 'Truy tim nguon goc ban do.',
          state: 'active',
          opening_window: 'Chuong 1',
          anchor_chapters: ['Chuong 1'],
        }],
      }));
    });
    container = document.createElement('div');
    document.body.appendChild(container);
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

  async function renderWizard() {
    root = createRoot(container);
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
  }

  function expectWizardActionsOutsideScroll() {
    const body = container.querySelector('.wizard-body');
    expect(body).toBeTruthy();
    const directChildren = Array.from(body.children);
    expect(directChildren.some((child) => child.classList.contains('wizard-scroll'))).toBe(true);
    expect(directChildren.some((child) => child.classList.contains('modal-actions'))).toBe(true);
    expect(body.querySelector('.wizard-scroll > .modal-actions')).toBeNull();
  }

  it('previews and saves specific role locks from wizard character output', async () => {
    await renderWizard();
    expectWizardActionsOutsideScroll();

    await act(async () => {
      const textareas = container.querySelectorAll('.wizard-body textarea.textarea');
      setTextareaValue(textareas[textareas.length - 2], 'Tao truyen ve ban do co.');
    });
    await act(async () => {
      container.querySelector('.modal-actions .btn-primary').click();
    });

    expect(container.textContent).toContain('nguoi giu ban do co');
    expectWizardActionsOutsideScroll();

    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    expect(container.textContent).toContain('Lan bao ve duoc ban do');
    expect(container.textContent).toContain('Mục đích:');
    expect(container.textContent).toContain('Sự kiện chính:');
    expect(container.textContent).toContain('Thay đổi trạng thái:');
    expect(container.textContent).not.toContain('Purpose:');
    expect(container.textContent).not.toContain('Key events:');
    expect(container.textContent).not.toContain('State delta:');
    expect(container.textContent).not.toContain('Story Bible Seed không nên chứa chapters');
    expectWizardActionsOutsideScroll();

    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    expect(codexState.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 7,
      name: 'Lan',
      specific_role: 'nguoi giu ban do co',
      specific_role_locked: true,
    }));
  });
});
