import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildProjectContentModePatch,
  resolveProjectContentMode,
} from '../../features/projectContentMode/projectContentMode.js';
import {
  CONTENT_MODE_QUICK_ACTION_ID,
  getWriterQuickActionOrder,
} from '../../components/ai/quickActionLayout.js';
import ProjectContentModeControl from '../../features/projectContentMode/ProjectContentModeControl.jsx';

describe('phase10 project content mode helpers', () => {
  it('maps ENI mode to both persisted project flags', () => {
    expect(buildProjectContentModePatch('eni')).toEqual({
      nsfw_mode: true,
      super_nsfw_mode: true,
    });
  });

  it('derives the current content mode from the persisted project flags', () => {
    expect(resolveProjectContentMode({
      nsfw_mode: true,
      super_nsfw_mode: true,
    })).toBe('eni');

    expect(resolveProjectContentMode({
      nsfw_mode: true,
      super_nsfw_mode: false,
    })).toBe('nsfw');

    expect(resolveProjectContentMode({
      nsfw_mode: false,
      super_nsfw_mode: false,
    })).toBe('safe');
  });

  it('pins the content mode quick action to the first slot of the last row on desktop and mobile', () => {
    expect(getWriterQuickActionOrder(false)).toEqual([
      'continue',
      'rewrite',
      'expand',
      'plot',
      CONTENT_MODE_QUICK_ACTION_ID,
      'outline',
      'extract',
      'conflict',
    ]);

    expect(getWriterQuickActionOrder(true)).toEqual([
      'continue',
      'rewrite',
      'expand',
      'plot',
      'outline',
      'extract',
      CONTENT_MODE_QUICK_ACTION_ID,
      'conflict',
    ]);
  });
});

describe('phase10 project content mode control', () => {
  let container;
  let root;

  beforeEach(() => {
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
  });

  async function renderControl(props) {
    root = createRoot(container);
    await act(async () => {
      root.render(<ProjectContentModeControl {...props} />);
    });
  }

  it('renders the main editor control for Prompt truyện', async () => {
    await renderControl({
      surface: 'prompt',
      mode: 'safe',
      onChange: () => {},
    });

    expect(container.textContent).toContain('Chế độ nội dung');
    expect(container.textContent).toContain('Thường');
    expect(container.textContent).toContain('18+');
    expect(container.textContent).toContain('ENI');
  });

  it('renders the writing surface as a single compact button by default', async () => {
    await renderControl({
      surface: 'writer',
      mode: 'nsfw',
      onChange: () => {},
    });

    expect(container.textContent).toContain('18+');
    expect(container.querySelector('.project-content-mode__writer-button')).not.toBeNull();
    expect(container.querySelector('.project-content-mode__writer-popover')).toBeNull();
  });

  it('opens the writer quick toggle on demand and closes after selecting a mode', async () => {
    const onChange = vi.fn();

    await renderControl({
      surface: 'writer',
      mode: 'safe',
      onChange,
    });

    const trigger = container.querySelector('.project-content-mode__writer-button');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger.click();
    });

    expect(container.textContent).toContain('Thường');
    expect(container.textContent).toContain('18+');
    expect(container.textContent).toContain('ENI');

    const eniButton = Array.from(container.querySelectorAll('.project-content-mode__writer-item'))
      .find((node) => node.textContent?.includes('ENI'));
    expect(eniButton).toBeDefined();

    await act(async () => {
      eniButton.click();
    });

    expect(onChange).toHaveBeenCalledWith('eni');
    expect(container.querySelector('.project-content-mode__writer-popover')).toBeNull();
  });

  it('renders StoryBible as a status surface with a prompt shortcut instead of editable checkboxes', async () => {
    await renderControl({
      surface: 'story-bible',
      mode: 'eni',
      onChange: () => {},
      onOpenPrompts: () => {},
    });

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(container.textContent).toContain('Trạng thái hiện tại');
    expect(container.textContent).toContain('Prompt truyện');
  });

  it('renders the initial selector for Project Wizard', async () => {
    await renderControl({
      surface: 'wizard',
      mode: 'safe',
      onChange: () => {},
    });

    expect(container.textContent).toContain('Chế độ nội dung');
    expect(container.textContent).toContain('Dùng ngay khi tạo truyện');
  });
});
