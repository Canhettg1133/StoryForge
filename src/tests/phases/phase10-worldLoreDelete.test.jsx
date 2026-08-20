import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorldLore from '../../pages/WorldLore/WorldLore.jsx';

let projectState;
let codexState;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../components/common/AIGenerateButton', () => ({
  default: () => null,
}));

vi.mock('../../components/common/BatchGenerate', () => ({
  default: () => null,
}));

vi.mock('../../components/common/EntityTimeline', () => ({
  default: () => null,
}));

vi.mock('../../components/mobile/MobileBibleTabs', () => ({
  default: () => null,
}));

function clickButton(container, text) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent.includes(text));
  expect(button, `Không tìm thấy nút "${text}"`).toBeTruthy();
  button.click();
}

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

describe('phase10 WorldLore bulk deletion', () => {
  let container;
  let root;

  beforeEach(() => {
    projectState = {
      currentProject: {
        id: 1,
        title: 'Project',
        world_name: '',
        world_description: '',
        world_rules: '[]',
      },
      updateWorldProfile: vi.fn(),
    };
    codexState = {
      locations: [
        { id: 1, name: 'Thành Cổ', description: '' },
        { id: 2, name: 'Rừng Sương', description: '' },
        { id: 3, name: 'Hải Cảng', description: '' },
      ],
      objects: [
        { id: 11, name: 'Ngọc bội', description: '' },
      ],
      worldTerms: [
        { id: 21, name: 'Linh căn', definition: '', category: 'other' },
      ],
      characters: [],
      loading: false,
      loadCodex: vi.fn(),
      createLocation: vi.fn(),
      updateLocation: vi.fn(),
      deleteLocation: vi.fn(),
      deleteLocations: vi.fn(async () => {}),
      createObject: vi.fn(),
      updateObject: vi.fn(),
      deleteObject: vi.fn(),
      deleteObjects: vi.fn(async () => {}),
      createWorldTerm: vi.fn(),
      updateWorldTerm: vi.fn(),
      deleteWorldTerm: vi.fn(),
      deleteWorldTerms: vi.fn(async () => {}),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
      root = null;
    }
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('selects and deletes multiple locations with the location bulk API', async () => {
    await act(async () => {
      root.render(<WorldLore />);
    });

    await act(async () => {
      clickButton(container, 'Chọn nhiều');
    });

    expect(container.querySelectorAll('.bulk-selection-action')).toHaveLength(2);

    await act(async () => {
      container.querySelector('input[aria-label="Chọn Thành Cổ"]').click();
      container.querySelector('input[aria-label="Chọn Hải Cảng"]').click();
    });

    expect(container.textContent).toContain('2 địa điểm đã chọn');

    await act(async () => {
      clickButton(container, 'Xóa đã chọn');
    });
    expect(container.textContent).toContain('Xóa vĩnh viễn 2 địa điểm đã chọn?');

    await act(async () => {
      clickButton(container, 'Xóa 2 địa điểm');
      await Promise.resolve();
    });

    expect(codexState.deleteLocations).toHaveBeenCalledWith([1, 3], 1);
    expect(container.textContent).not.toContain('2 địa điểm đã chọn');
  });

  it.each([
    { tabIndex: 1, bulkMethod: 'deleteObjects', expectedId: 11 },
    { tabIndex: 2, bulkMethod: 'deleteWorldTerms', expectedId: 21 },
  ])('routes bulk deletion to $bulkMethod for its entity tab', async ({
    tabIndex,
    bulkMethod,
    expectedId,
  }) => {
    await act(async () => {
      root.render(<WorldLore />);
    });

    await act(async () => {
      container.querySelectorAll('.codex-tab')[tabIndex].click();
    });
    await act(async () => {
      clickButton(container, 'Chọn nhiều');
    });
    await act(async () => {
      container.querySelector('.world-card input[type="checkbox"]').click();
    });
    await act(async () => {
      container.querySelector('.world-bulk-toolbar .btn-danger').click();
    });
    await act(async () => {
      container.querySelector('.world-bulk-toolbar .btn-danger').click();
      await Promise.resolve();
    });

    expect(codexState[bulkMethod]).toHaveBeenCalledWith([expectedId], 1);
  });

  it('clears selection when switching entity tabs', async () => {
    await act(async () => {
      root.render(<WorldLore />);
    });

    await act(async () => {
      clickButton(container, 'Chọn nhiều');
    });
    await act(async () => {
      container.querySelector('input[aria-label="Chọn Thành Cổ"]').click();
    });
    expect(container.textContent).toContain('1 địa điểm đã chọn');

    await act(async () => {
      clickButton(container, 'Vật phẩm');
    });

    expect(container.textContent).not.toContain('địa điểm đã chọn');
    expect(container.querySelector('input[aria-label="Chọn Ngọc bội"]')).toBeNull();
  });

  it('uses the shared form-control vocabulary in the create and edit modal', async () => {
    await act(async () => {
      root.render(<WorldLore />);
    });

    await act(async () => {
      clickButton(container, 'Thêm thủ công');
    });

    const modal = container.querySelector('.codex-modal');
    expect(modal.querySelector('input[type="text"]').classList.contains('input')).toBe(true);
    modal.querySelectorAll('textarea').forEach((field) => {
      expect(field.classList.contains('textarea')).toBe(true);
    });
  });

  it.each([
    { tabLabel: 'Địa điểm', expectedFields: 2 },
    { tabLabel: 'Vật phẩm', expectedFields: 2 },
    { tabLabel: 'Thuật ngữ', expectedFields: 1 },
  ])('expands every $tabLabel detail field without internal scrolling', async ({
    tabLabel,
    expectedFields,
  }) => {
    await act(async () => {
      root.render(<WorldLore />);
    });

    if (tabLabel !== 'Địa điểm') {
      await act(async () => {
        clickButton(container, tabLabel);
      });
    }
    await act(async () => {
      clickButton(container, 'Thêm thủ công');
    });

    const fields = Array.from(container.querySelectorAll('.codex-modal textarea'));
    expect(fields).toHaveLength(expectedFields);
    fields.forEach((field) => {
      expect(field.classList).toContain('textarea');
      expect(field.classList).toContain('auto-resize-textarea');
    });

    const longField = fields[fields.length - 1];
    Object.defineProperty(longField, 'scrollHeight', {
      configurable: true,
      value: 248,
    });

    await act(async () => {
      setTextareaValue(longField, 'Nội dung thế giới dài '.repeat(30));
    });

    expect(longField.style.height).toBe('248px');
    expect(longField.style.overflowY).toBe('hidden');
  });
});
