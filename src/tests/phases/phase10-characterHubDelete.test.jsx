import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CharacterHub from '../../pages/CharacterHub/CharacterHub.jsx';

let projectState;
let codexState;

vi.mock('../../stores/projectStore', () => ({
  default: () => projectState,
}));

vi.mock('../../stores/codexStore', () => ({
  default: () => codexState,
}));

vi.mock('../../components/common/AIGenerateButton', () => ({
  default: () => <button type="button">AI generate</button>,
}));

vi.mock('../../components/common/BatchGenerate', () => ({
  default: () => <div>Batch generate</div>,
}));

vi.mock('../../components/common/RelationshipMap', () => ({
  default: () => <div>Relationship map</div>,
}));

vi.mock('../../components/common/EntityTimeline', () => ({
  default: () => <div>Entity timeline</div>,
}));

vi.mock('../../components/mobile/MobileBibleTabs', () => ({
  default: () => null,
}));

function createCharacter(overrides = {}) {
  return {
    id: overrides.id || 1,
    project_id: 1,
    name: overrides.name || 'Nhan vat',
    role: 'supporting',
    appearance: '',
    personality: '',
    flaws: '',
    pronouns_self: '',
    pronouns_other: '',
    speech_pattern: '',
    goals: '',
    secrets: '',
    notes: '',
    personality_tags: '',
    current_status: '',
    ...overrides,
  };
}

function normalizedText(node) {
  return (node.textContent || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

describe('phase10 CharacterHub deletion', () => {
  let container;
  let root;

  beforeEach(() => {
    projectState = {
      currentProject: { id: 1, title: 'Project', genre_primary: 'modern' },
      chapters: [],
    };
    codexState = {
      characters: [createCharacter({ id: 1, name: 'A' })],
      taboos: [],
      loading: false,
      loadCodex: vi.fn(),
      createCharacter: vi.fn(),
      updateCharacter: vi.fn(),
      deleteCharacter: vi.fn(async () => {}),
      deleteCharacters: vi.fn(async () => {}),
      createTaboo: vi.fn(),
      updateTaboo: vi.fn(),
      deleteTaboo: vi.fn(),
    };
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

  async function renderHub() {
    root = createRoot(container);
    await act(async () => {
      root.render(<CharacterHub />);
    });
  }

  it('does not open the character editor when confirming a card deletion', async () => {
    await renderHub();

    const deleteIconButton = container.querySelector('.character-card-actions button:last-child');
    expect(deleteIconButton).not.toBeNull();

    await act(async () => {
      deleteIconButton.click();
    });

    const confirmDeleteButton = container.querySelector('.character-delete-confirm .btn-danger');
    expect(confirmDeleteButton).not.toBeNull();

    await act(async () => {
      confirmDeleteButton.click();
    });

    expect(codexState.deleteCharacter).toHaveBeenCalledWith(1, 1);
    expect(container.querySelector('.codex-modal')).toBeNull();
  });

  it('deletes all selected characters through the bulk action', async () => {
    codexState.characters = [
      createCharacter({ id: 1, name: 'A' }),
      createCharacter({ id: 2, name: 'B' }),
      createCharacter({ id: 3, name: 'C' }),
    ];

    await renderHub();

    const selectModeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => normalizedText(button).includes('Chon'));
    expect(selectModeButton).toBeDefined();

    await act(async () => {
      selectModeButton.click();
    });

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    expect(checkboxes).toHaveLength(3);

    await act(async () => {
      checkboxes[0].click();
      checkboxes[2].click();
    });

    const deleteSelectedButton = Array.from(container.querySelectorAll('button'))
      .find((button) => normalizedText(button).includes('Xoa da chon'));
    expect(deleteSelectedButton).toBeDefined();

    await act(async () => {
      deleteSelectedButton.click();
    });

    const confirmBulkButton = Array.from(container.querySelectorAll('button'))
      .find((button) => normalizedText(button).includes('Xoa 2 nhan vat'));
    expect(confirmBulkButton).toBeDefined();

    await act(async () => {
      confirmBulkButton.click();
    });

    expect(codexState.deleteCharacters).toHaveBeenCalledWith([1, 3], 1);
    expect(container.querySelector('.codex-modal')).toBeNull();
  });
});
