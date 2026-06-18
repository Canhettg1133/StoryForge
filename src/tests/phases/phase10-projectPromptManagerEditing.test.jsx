import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectStoreMock = vi.hoisted(() => {
  const state = {
    currentProject: null,
  };

  return {
    state,
    loadProject: vi.fn(),
    updateProjectSettings: vi.fn(async (data) => {
      state.currentProject = {
        ...state.currentProject,
        ...data,
        updated_at: Date.now(),
      };
    }),
  };
});

vi.mock('../../stores/projectStore', () => ({
  default: () => ({
    currentProject: projectStoreMock.state.currentProject,
    loadProject: projectStoreMock.loadProject,
    updateProjectSettings: projectStoreMock.updateProjectSettings,
  }),
}));

vi.mock('../../features/projectContentMode/useProjectContentMode.js', () => ({
  default: () => ({
    contentMode: 'safe',
    setContentMode: vi.fn(),
  }),
}));

vi.mock('../../features/projectContentMode/ProjectContentModeControl.jsx', () => ({
  default: () => <div data-testid="project-content-mode-control" />,
}));

vi.mock('../../services/ai/promptManagerMeta', () => ({
  PROJECT_PROMPT_GROUPS: [
    {
      key: 'core',
      title: 'Core prompt list',
      summary: 'Minimal prompt list group for editing tests.',
      items: [
        {
          key: 'constitution',
          label: 'Luật cốt lõi',
          type: 'list',
          purpose: 'Kiểm tra editor prompt dạng danh sách.',
          expectedOutput: 'Danh sách luật vẫn soạn được như textarea bình thường.',
        },
        {
          key: 'free_prompt',
          label: 'Lệnh tự do',
          type: 'text',
          purpose: 'Kiểm tra editor prompt dạng văn bản.',
          expectedOutput: 'Prompt văn bản vẫn soạn được như textarea bình thường.',
        },
      ],
    },
  ],
}));

import ProjectPromptManager from '../../pages/ProjectPromptManager/ProjectPromptManager.jsx';
import { stripProtectedTaskInstruction } from '../../services/ai/promptBuilder/taskInstructionProtection.js';

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

describe('phase10 project prompt manager editing', () => {
  let container;
  let root;

  beforeEach(() => {
    vi.useFakeTimers();
    projectStoreMock.state.currentProject = {
      id: 1,
      title: 'Prompt Editing Test',
      genre_primary: 'fantasy',
      prompt_templates: '{}',
      ai_guidelines: '',
      writing_style: '',
      project_style_runtime_block: '',
      project_style_runtime_enabled: false,
      project_style_runtime_meta: null,
    };
    projectStoreMock.loadProject.mockClear();
    projectStoreMock.updateProjectSettings.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    vi.useRealTimers();
  });

  async function renderPromptManager() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/project/1/prompts']}>
          <Routes>
            <Route path="/project/:projectId/prompts" element={<ProjectPromptManager />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
  }

  function getPromptTextareas() {
    return Array.from(container.querySelectorAll('textarea.prompt-editor-block__textarea'));
  }

  function getFirstCoreEditButton() {
    return Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Bật chỉnh thử') || button.textContent?.includes('Tắt chỉnh thử'));
  }

  it('preserves a typed space while editing list prompt overrides', async () => {
    await renderPromptManager();

    const textareas = getPromptTextareas();
    expect(textareas).toHaveLength(4);
    const overrideTextarea = textareas[1];

    await act(async () => {
      setTextareaValue(overrideTextarea, 'Giữ khoảng trắng ');
    });

    const toggleCoreEditButton = getFirstCoreEditButton();
    expect(toggleCoreEditButton).toBeDefined();
    await act(async () => {
      toggleCoreEditButton.click();
    });

    const rerenderedOverrideTextarea = getPromptTextareas()[1];
    expect(rerenderedOverrideTextarea.value).toBe('Giữ khoảng trắng ');
  });

  it('preserves a typed space while editing text prompt overrides', async () => {
    await renderPromptManager();

    const textareas = getPromptTextareas();
    expect(textareas).toHaveLength(4);
    const overrideTextarea = textareas[3];

    await act(async () => {
      setTextareaValue(overrideTextarea, 'Giữ khoảng trắng ');
    });

    const toggleCoreEditButton = getFirstCoreEditButton();
    expect(toggleCoreEditButton).toBeDefined();
    await act(async () => {
      toggleCoreEditButton.click();
    });

    const rerenderedOverrideTextarea = getPromptTextareas()[3];
    expect(rerenderedOverrideTextarea.value).toBe('Giữ khoảng trắng ');
  });

  it('normalizes list prompt overrides only when saving', async () => {
    await renderPromptManager();

    const overrideTextarea = getPromptTextareas()[1];
    await act(async () => {
      setTextareaValue(overrideTextarea, 'Rule one \n\n Rule two ');
    });

    expect(getPromptTextareas()[1].value).toBe('Rule one \n\n Rule two ');

    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    expect(projectStoreMock.updateProjectSettings).toHaveBeenCalledTimes(1);
    const payload = projectStoreMock.updateProjectSettings.mock.calls[0][0];
    expect(JSON.parse(payload.prompt_templates)).toMatchObject({
      constitution: ['Rule one', 'Rule two'],
    });
    expect(getPromptTextareas()[1].value).toBe('Rule one \n\n Rule two ');
  });

  it('does not rehydrate local editor state after autosave updates the same project', async () => {
    await renderPromptManager();

    const toggleCoreEditButton = getFirstCoreEditButton();
    expect(toggleCoreEditButton).toBeDefined();
    await act(async () => {
      toggleCoreEditButton.click();
    });
    expect(getFirstCoreEditButton()?.textContent).toContain('Tắt chỉnh thử');

    await act(async () => {
      setTextareaValue(getPromptTextareas()[1], 'Rule one ');
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    await renderPromptManager();

    expect(getFirstCoreEditButton()?.textContent).toContain('Tắt chỉnh thử');
    expect(getPromptTextareas()[1].value).toBe('Rule one ');
  });

  it('keeps autosave from changing visible saving chrome while typing', async () => {
    let resolveSave;
    projectStoreMock.updateProjectSettings.mockImplementationOnce((data) => new Promise((resolve) => {
      resolveSave = () => {
        projectStoreMock.state.currentProject = {
          ...projectStoreMock.state.currentProject,
          ...data,
          updated_at: Date.now(),
        };
        resolve();
      };
    }));

    await renderPromptManager();

    await act(async () => {
      setTextareaValue(getPromptTextareas()[1], 'Rule one ');
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Lưu Prompt truyện'));
    expect(saveButton?.disabled).toBe(false);
    expect(container.querySelector('.prompt-manager-status')?.className).toContain('is-empty');
    expect(container.textContent).not.toContain('Đang tự lưu Prompt truyện');

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
  });
});

describe('phase10 task instruction editing helpers', () => {
  it('preserves editable prompt whitespace when no locked task contract is present', () => {
    expect(stripProtectedTaskInstruction('free_prompt', 'Giữ khoảng trắng ')).toBe('Giữ khoảng trắng ');
  });
});
