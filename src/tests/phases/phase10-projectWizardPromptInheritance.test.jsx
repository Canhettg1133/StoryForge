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

function seedResponse() {
  return {
    title: 'Truyen Moi',
    premise: 'Mot premise moi.',
    world_profile: {
      world_name: 'The gioi moi',
      world_type: 'fantasy',
      world_rules: [],
    },
    characters: [{
      name: 'Lan',
      role: 'protagonist',
      appearance: '',
      personality: 'Diem tinh',
      flaws: '',
      goals: 'Tim su that',
      current_status: 'Dang bat dau hanh trinh',
      story_function: 'neo mo dau',
    }],
    locations: [{ name: 'Ben song', description: 'Noi mo dau', story_function: 'xuat hien chuong 1' }],
    objects: [],
    factions: [],
    terms: [],
    plot_threads: [{
      title: 'Bi mat',
      type: 'mystery',
      description: 'Bi mat mo dau.',
      state: 'active',
      opening_window: 'Chuong 1',
      anchor_chapters: ['Chuong 1'],
    }],
  };
}

function outlineResponse() {
  return {
    chapters: [{
      title: 'Chuong 1',
      purpose: 'Mo dau hanh trinh.',
      summary: 'Lan gap dau moi dau tien.',
      opening_state: 'Lan o ben song.',
      handoff_from_previous: '',
      ending_state: 'Lan quyet dinh di tiep.',
      featured_characters: ['Lan'],
      primary_location: 'Ben song',
      thread_titles: ['Bi mat'],
      key_events: ['Lan gap dau moi'],
      state_delta: 'Lan co muc tieu moi.',
    }],
    plot_threads: [{
      title: 'Bi mat',
      type: 'mystery',
      description: 'Bi mat mo dau.',
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
  };
}

describe('phase10 project wizard prompt inheritance', () => {
  let container;
  let root;

  beforeEach(() => {
    projectState = {
      projects: [{
        id: 11,
        title: 'Truyen Nguon',
        genre_primary: 'fantasy',
        prompt_profile_version: 'tag_first_v2',
        ai_guidelines: 'Giu cau van ngan, sac va it chat AI.',
        prompt_templates: JSON.stringify({
          constitution: ['Khong pha logic nhan qua'],
          style_dna: ['Van gon, co hinh anh ro'],
          anti_ai_blacklist: ['khong dung cau mo ho'],
          free_prompt: 'Luon doc style_dna truoc khi viet.',
        }),
        updated_at: 123,
      }],
      loadProjects: vi.fn(async () => undefined),
      createProject: vi.fn(async () => 7),
      createChapter: vi.fn(async () => ({ chapterId: 70 })),
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
    aiService.send.mockImplementation(({ taskType, messages, onComplete }) => {
      if (taskType === 'chapter_outline_pass') {
        expect(messages[0].content).toContain('[PROMPT TRUYỆN KẾ THỪA]');
        onComplete(JSON.stringify(outlineResponse()));
        return;
      }

      expect(messages[0].content).toContain('[PROMPT TRUYỆN KẾ THỪA]');
      expect(messages[0].content).toContain('Khong pha logic nhan qua');
      expect(messages[0].content).toContain('Giu cau van ngan');
      onComplete(JSON.stringify(seedResponse()));
    });
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

  it('inherits only prompt settings from an old story when creating through AI wizard', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });

    expect(container.textContent).toContain('Kế thừa Prompt truyện cũ');
    expect(container.textContent).toContain('Chỉ lấy prompt, không lấy Bible/canon');

    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa Prompt truyện cũ"]').click();
    });

    expect(container.textContent).toContain('Truyen Nguon');
    expect(container.textContent).toContain('1 luật');
    expect(container.textContent).toContain('1 style');
    expect(container.textContent).toContain('1 override');

    await act(async () => {
      const textareas = container.querySelectorAll('.wizard-body textarea.textarea');
      setTextareaValue(textareas[textareas.length - 2], 'Tao mot truyen moi.');
    });
    await act(async () => {
      container.querySelector('.modal-actions .btn-primary').click();
    });

    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    expect(projectState.createProject).toHaveBeenCalledWith(expect.objectContaining({
      prompt_profile_version: 'tag_first_v2',
      ai_guidelines: 'Giu cau van ngan, sac va it chat AI.',
      prompt_templates: expect.stringContaining('Khong pha logic nhan qua'),
    }));
  });

  it('sends the current seed and author instruction when revising the story foundation', async () => {
    let seedCallCount = 0;
    aiService.send.mockImplementation(({ taskType, messages, onComplete }) => {
      expect(taskType).toBe('story_bible_seed');
      seedCallCount += 1;
      if (seedCallCount === 1) {
        onComplete(JSON.stringify(seedResponse()));
        return;
      }

      expect(messages[1].content).toContain('[NỀN TRUYỆN HIỆN TẠI CẦN CHỈNH]');
      expect(messages[1].content).toContain('Tăng xung đột mở đầu');
      onComplete(JSON.stringify({
        ...seedResponse(),
        title: 'Truyen Da Chinh',
        premise: 'Premise da tang xung dot.',
      }));
    });

    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      const textareas = container.querySelectorAll('.wizard-body textarea.textarea');
      setTextareaValue(textareas[textareas.length - 2], 'Tao mot truyen moi.');
    });
    await act(async () => {
      container.querySelector('.modal-actions .btn-primary').click();
    });

    expect(container.textContent).toContain('AI chỉnh nền truyện theo ý tôi');

    await act(async () => {
      setTextareaValue(
        container.querySelector('.wizard-ai-revision-textarea'),
        'Tăng xung đột mở đầu.',
      );
    });
    await act(async () => {
      container.querySelector('.wizard-ai-revision-box .btn-secondary').click();
    });

    expect(container.querySelector('.wizard-title-input').value).toBe('Truyen Da Chinh');
  });

  it('sends the current outline and author instruction when revising chapter outlines', async () => {
    let seedCallCount = 0;
    let outlineCallCount = 0;
    aiService.send.mockImplementation(({ taskType, messages, onComplete }) => {
      if (taskType === 'story_bible_seed') {
        seedCallCount += 1;
        onComplete(JSON.stringify(seedResponse()));
        return;
      }

      expect(taskType).toBe('chapter_outline_pass');
      outlineCallCount += 1;
      if (outlineCallCount === 1) {
        onComplete(JSON.stringify(outlineResponse()));
        return;
      }

      expect(messages[1].content).toContain('[DÀN Ý HIỆN TẠI CẦN CHỈNH]');
      expect(messages[1].content).toContain('Làm chậm nhịp');
      onComplete(JSON.stringify({
        ...outlineResponse(),
        chapters: [{
          ...outlineResponse().chapters[0],
          title: 'Chuong 1: Sau khi chinh',
          summary: 'Lan gap dau moi cham hon va co he qua ro hon.',
        }],
      }));
    });

    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      const textareas = container.querySelectorAll('.wizard-body textarea.textarea');
      setTextareaValue(textareas[textareas.length - 2], 'Tao mot truyen moi.');
    });
    await act(async () => {
      container.querySelector('.modal-actions .btn-primary').click();
    });
    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    expect(container.textContent).toContain('AI chỉnh dàn ý theo ý tôi');

    await act(async () => {
      setTextareaValue(
        container.querySelector('.wizard-review-side .wizard-ai-revision-textarea'),
        'Làm chậm nhịp.',
      );
    });
    await act(async () => {
      container.querySelector('.wizard-review-side .wizard-ai-revision-box .btn-secondary').click();
    });

    expect(seedCallCount).toBe(1);
    expect(outlineCallCount).toBe(2);
    expect(container.textContent).toContain('Chuong 1: Sau khi chinh');
    expect(container.textContent).toContain('cham hon');
  });
});
