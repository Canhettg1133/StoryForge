import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
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

function readSource(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function getWizardGenreSelect(container) {
  return container.querySelector('.wizard-body .wizard-form-grid select');
}

function getInheritanceSelect(container) {
  return container.querySelector('.wizard-inherit-content select');
}

function getInheritanceCheckbox(container, text) {
  return Array.from(container.querySelectorAll('.wizard-inherit-content input[type="checkbox"]'))
    .find((input) => input.getAttribute('aria-label')?.includes(text));
}

function getInheritanceActionButton(container, text) {
  return Array.from(container.querySelectorAll('.wizard-inherit-content button'))
    .find((button) => button.getAttribute('aria-label')?.includes(text));
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
      projects: [
        {
          id: 11,
          title: 'Truyen Nguon',
          genre_primary: 'tien_hiep',
          prompt_profile_version: 'tag_first_v2',
          ai_guidelines: 'Giu cau van ngan, sac va it chat AI.',
          prompt_templates: JSON.stringify({
            constitution: ['Khong pha logic nhan qua'],
            style_dna: [
              'Van gon, co hinh anh ro',
              'Han-Viet chiem 30-40% tu ngu lien quan tu luyen, canh gioi, phap bao, dan duoc',
              'Noi tam tiet che qua anh mat va nhip dap linh luc',
              'Nhan vat Thanh Co phai luon nho Tong Mon cu',
            ],
            anti_ai_blacklist: [
              'khong dung cau mo ho',
              'cam on su phu chi diem',
              'cam nhac Linh Thach va Tong Mon sai canon',
            ],
            free_prompt: 'Luon doc style_dna truoc khi viet.',
            qa_check: 'Kiem tra cau van va nhip canh truoc khi tra loi.',
            outline: 'Moi arc phai leo thang nhu truyen cu.',
            arc_outline: 'Giu cau truc tong mon tranh dau.',
            continuity_check: 'Bat loi neu nhan vat roi khoi Thanh Co.',
            nsfw_rules: 'Giu ap luc bi mat cua cap doi cu.',
          }),
          updated_at: 123,
        },
        {
          id: 12,
          title: 'Truyen Nguon Khac',
          genre_primary: 'fantasy',
          prompt_profile_version: 'legacy',
          prompt_templates: JSON.stringify({
            style_dna: [
              'Van tu nhien, uu tien hanh dong ro',
              'Giu mau ma phap va loi ke chuyen epic',
            ],
          }),
          updated_at: 122,
        },
      ],
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
      const combinedPrompt = messages.map((message) => message.content).join('\n\n');
      expect(combinedPrompt).not.toContain('[PROMPT TRUYỆN KẾ THỪA]');
      expect(combinedPrompt).not.toContain('Khong pha logic nhan qua');
      expect(combinedPrompt).not.toContain('Giu cau van ngan');
      expect(combinedPrompt).not.toContain('Van gon, co hinh anh ro');
      expect(combinedPrompt).not.toContain('Tong Mon');
      expect(combinedPrompt).not.toContain('Han-Viet chiem 30-40%');
      if (taskType === 'chapter_outline_pass') {
        onComplete(JSON.stringify(outlineResponse()));
        return;
      }

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

  it('copies only selected inherited prompt groups after creation without sending inherited prompt to seed or outline', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });

    expect(container.textContent).toContain('Kế thừa prompt có chọn lọc');
    expect(container.textContent).toContain('Chỉ copy sau khi tạo project. Không dùng khi tạo seed/dàn ý.');

    await act(async () => {
      setSelectValue(getWizardGenreSelect(container), 'fantasy');
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });

    const sourceSelect = getInheritanceSelect(container);
    expect(sourceSelect.value).toBe('');
    expect(container.textContent).toContain('Chọn truyện để xem các cụm prompt có thể kế thừa');

    await act(async () => {
      setSelectValue(sourceSelect, '11');
    });

    expect(container.textContent).toContain('Truyen Nguon');
    expect(container.textContent).toContain('Đã chọn: 0');
    expect(container.textContent).toContain('Có thể copy');
    expect(container.textContent).toContain('Nguy cơ cao');
    expect(container.textContent).toContain('Không dùng khi tạo seed/dàn ý');
    expect(container.textContent).toContain('DNA văn phong');
    expect(container.textContent).toContain('Luật cốt lõi');
    expect(container.textContent).toContain('Chỉ dẫn AI');
    expect(container.textContent).toContain('Ảnh hưởng cấu trúc/canon');
    expect(container.textContent).toContain('DNA này có dấu hiệu canon/tên riêng/cấu trúc truyện cũ');
    expect(container.textContent).toContain('Prompt mạnh khi viết');
    expect(container.textContent).not.toContain('Bị khóa');
    expect(container.textContent).not.toContain('Prompt kế thừa chỉ định hướng cách AI tạo nền truyện');

    const styleCheckbox = getInheritanceCheckbox(container, 'DNA văn phong');
    const constitutionCheckbox = getInheritanceCheckbox(container, 'Luật cốt lõi');
    const guidelinesCheckbox = getInheritanceCheckbox(container, 'Chỉ dẫn AI');
    expect(styleCheckbox.checked).toBe(false);
    expect(constitutionCheckbox.checked).toBe(false);
    expect(guidelinesCheckbox.checked).toBe(false);

    await act(async () => {
      styleCheckbox.click();
    });
    await act(async () => {
      constitutionCheckbox.click();
    });
    await act(async () => {
      guidelinesCheckbox.click();
    });
    expect(container.textContent).toContain('Đã chọn: 3');

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

    const payload = projectState.createProject.mock.calls[0][0];
    expect(payload.prompt_profile_version).toBe('tag_first_v2');
    expect(payload.ai_guidelines).toBe('Giu cau van ngan, sac va it chat AI.');
    const templates = JSON.parse(payload.prompt_templates);
    expect(templates.style_dna).toEqual([
      'Van gon, co hinh anh ro',
      'Han-Viet chiem 30-40% tu ngu lien quan tu luyen, canh gioi, phap bao, dan duoc',
      'Noi tam tiet che qua anh mat va nhip dap linh luc',
      'Nhan vat Thanh Co phai luon nho Tong Mon cu',
    ]);
    expect(templates.constitution).toEqual(['Khong pha logic nhan qua']);
    expect(templates.anti_ai_blacklist).toBeUndefined();
    expect(templates.ai_guidelines).toBeUndefined();
    expect(payload.prompt_templates).toContain('Khong pha logic nhan qua');
    expect(payload.prompt_templates).toContain('Thanh Co');
    expect(payload.prompt_templates).toContain('Tong Mon');
    expect(payload.prompt_templates).not.toContain('Moi arc phai leo thang');
    expect(payload.prompt_templates).not.toContain('Luon doc style_dna');
    expect(payload.prompt_templates).not.toContain('Kiem tra cau van');
    expect(payload.prompt_templates).not.toContain('nsfw');
  });

  it('lets users bỏ qua and restore high-risk prompt groups before copying', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });
    await act(async () => {
      setSelectValue(getInheritanceSelect(container), '11');
    });

    expect(getInheritanceCheckbox(container, 'Dàn ý chương')).toBeTruthy();
    await act(async () => {
      getInheritanceActionButton(container, 'Bỏ qua Dàn ý chương').click();
    });
    expect(container.textContent).toContain('Đã bỏ qua: 1');
    expect(getInheritanceCheckbox(container, 'Dàn ý chương')).toBeFalsy();

    await act(async () => {
      getInheritanceActionButton(container, 'Khôi phục Dàn ý chương').click();
    });
    const restoredOutlineCheckbox = getInheritanceCheckbox(container, 'Dàn ý chương');
    expect(restoredOutlineCheckbox).toBeTruthy();

    await act(async () => {
      restoredOutlineCheckbox.click();
    });
    expect(container.textContent).toContain('Đã chọn: 1');

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

    const payload = projectState.createProject.mock.calls[0][0];
    const templates = JSON.parse(payload.prompt_templates);
    expect(templates.outline).toBe('Moi arc phai leo thang nhu truyen cu.');
    expect(templates.style_dna).toBeUndefined();
  });

  it('clears selected and skipped prompt groups when changing source or turning inheritance off', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });
    await act(async () => {
      setSelectValue(getInheritanceSelect(container), '11');
    });

    await act(async () => {
      getInheritanceCheckbox(container, 'DNA văn phong').click();
    });
    await act(async () => {
      getInheritanceActionButton(container, 'Bỏ qua Dàn ý chương').click();
    });
    expect(container.textContent).toContain('Đã chọn: 1');
    expect(container.textContent).toContain('Đã bỏ qua: 1');

    await act(async () => {
      setSelectValue(getInheritanceSelect(container), '12');
    });
    expect(container.textContent).toContain('Đã chọn: 0');
    expect(container.textContent).toContain('Đã bỏ qua: 0');

    const secondSourceCheckbox = getInheritanceCheckbox(container, 'DNA văn phong');
    await act(async () => {
      secondSourceCheckbox.click();
    });
    expect(container.textContent).toContain('Đã chọn: 1');

    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });
    await act(async () => {
      setSelectValue(getInheritanceSelect(container), '12');
    });
    expect(container.textContent).toContain('Đã chọn: 0');
    expect(container.textContent).toContain('Đã bỏ qua: 0');
  });

  it('keeps inherited prompt out of auto outline generation', async () => {
    const sentCalls = [];
    aiService.send.mockImplementation(({ taskType, messages, onComplete }) => {
      sentCalls.push({
        taskType,
        content: messages.map((message) => message.content).join('\n\n'),
      });
      if (taskType === 'chapter_outline_pass') {
        onComplete(JSON.stringify(outlineResponse()));
        return;
      }
      onComplete(JSON.stringify(seedResponse()));
    });

    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });
    await act(async () => {
      setSelectValue(getInheritanceSelect(container), '11');
    });
    await act(async () => {
      getInheritanceCheckbox(container, 'DNA văn phong').click();
    });
    await act(async () => {
      getInheritanceCheckbox(container, 'Luật cốt lõi').click();
    });
    await act(async () => {
      container.querySelector('.wizard-auto-toggle--action input').click();
    });
    await act(async () => {
      const textareas = container.querySelectorAll('.wizard-body textarea.textarea');
      setTextareaValue(textareas[textareas.length - 2], 'Tao mot truyen moi.');
    });
    await act(async () => {
      container.querySelector('.modal-actions .btn-primary').click();
    });

    expect(sentCalls.map((call) => call.taskType)).toEqual(['story_bible_seed', 'chapter_outline_pass']);
    sentCalls.forEach((call) => {
      expect(call.content).not.toContain('[PROMPT TRUYỆN KẾ THỪA]');
      expect(call.content).not.toContain('Khong pha logic nhan qua');
      expect(call.content).not.toContain('Giu cau van ngan');
      expect(call.content).not.toContain('Van gon, co hinh anh ro');
      expect(call.content).not.toContain('Thanh Co');
      expect(call.content).not.toContain('Han-Viet chiem 30-40%');
    });
  });

  it('does not copy prompt payload when inheritance is enabled without selected prompt groups', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
    });
    await act(async () => {
      setSelectValue(getInheritanceSelect(container), '12');
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
    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    const payload = projectState.createProject.mock.calls[0][0];
    expect(payload.prompt_templates).toBeUndefined();
    expect(payload.ai_guidelines).toBeUndefined();
    expect(payload.prompt_profile_version).toBe('tag_first_v2');
  });

  it('does not copy prompt payload when inheritance is enabled without a selected source', async () => {
    await act(async () => {
      root.render(<ProjectWizard onClose={() => {}} onCreated={() => {}} />);
    });
    await act(async () => {
      container.querySelector('input[aria-label="Bật kế thừa prompt có chọn lọc"]').click();
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
    await act(async () => {
      container.querySelector('.wizard-review .modal-actions .btn-primary').click();
    });

    const payload = projectState.createProject.mock.calls[0][0];
    expect(payload.prompt_templates).toBeUndefined();
    expect(payload.ai_guidelines).toBeUndefined();
    expect(payload.prompt_profile_version).toBe('tag_first_v2');
  });

  it('keeps new wizard inheritance copy in accented Vietnamese without mojibake', () => {
    const wizardSource = readSource('src/pages/Dashboard/ProjectWizard.jsx');
    const wizardCss = readSource('src/pages/Dashboard/ProjectWizard.css');
    const combined = `${wizardSource}\n${wizardCss}`;
    const mojibakeMarkers = ['Káº', 'chá»', 'Ä‘', 'Ă', 'Â'];

    expect(wizardSource).toContain('Kế thừa prompt có chọn lọc');
    expect(wizardSource).toContain('Đã chọn');
    expect(wizardSource).toContain('Có thể copy');
    expect(wizardSource).toContain('Nguy cơ cao');
    expect(wizardSource).toContain('Đã bỏ qua');
    expect(wizardSource).toContain('Không dùng khi tạo seed/dàn ý');
    expect(wizardSource).not.toContain('Bị khóa');
    expect(wizardSource).not.toContain('dangerouslySetInnerHTML');
    expect(wizardSource).not.toContain('Prompt kế thừa chỉ định hướng cách AI tạo nền truyện');
    mojibakeMarkers.forEach((marker) => {
      expect(combined).not.toContain(marker);
    });
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
