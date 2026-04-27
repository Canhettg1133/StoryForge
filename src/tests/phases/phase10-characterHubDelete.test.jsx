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
  default: ({ onApprove, canonRoleLocks = [] }) => (
    <button
      type="button"
      data-testid="mock-ai-generate"
      data-role-lock-count={canonRoleLocks.length}
      onClick={() => onApprove({
        name: 'Hac Y Ve 19',
        role: 'supporting',
        appearance: 'Ao den',
        personality: 'Tram lang',
      })}
    >
      AI generate
    </button>
  ),
}));

vi.mock('../../components/common/BatchGenerate', () => ({
  default: ({ onBatchCreated, canonRoleLocks = [] }) => (
    <div>
      <button
        type="button"
        data-testid="mock-batch-generate"
        data-role-lock-count={canonRoleLocks.length}
        onClick={() => onBatchCreated([
          { name: 'Hac Y Ve 19', role: 'supporting', personality: 'Tram lang' },
          { name: 'Hac Y Ve 20', role: 'supporting', personality: 'Can trong' },
        ])}
      >
        Batch add
      </button>
    </div>
  ),
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

function setCheckboxValue(input, checked) {
  if (input.checked !== checked) {
    input.click();
  }
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

  it('sends the 19th manually-created character to the store', async () => {
    codexState.characters = Array.from({ length: 18 }, (_, index) => (
      createCharacter({ id: index + 1, name: `Hac Y Ve ${index + 1}` })
    ));

    await renderHub();

    const manualCreateButton = container.querySelector('.codex-header-actions .btn-primary');
    expect(manualCreateButton).not.toBeNull();

    await act(async () => {
      manualCreateButton.click();
    });

    const nameInput = container.querySelector('.codex-modal input[type="text"]');
    expect(nameInput).not.toBeNull();

    await act(async () => {
      setInputValue(nameInput, 'Hac Y Ve 19');
    });

    const saveButton = container.querySelector('.codex-modal-footer .btn-primary');
    await act(async () => {
      saveButton.click();
    });

    expect(codexState.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 1,
      name: 'Hac Y Ve 19',
    }), { dedupe: false });
  });

  it('keeps AI-created character approval editable and saves it through the same create path', async () => {
    codexState.characters = Array.from({ length: 18 }, (_, index) => (
      createCharacter({ id: index + 1, name: `Hac Y Ve ${index + 1}` })
    ));

    await renderHub();

    const aiButton = Array.from(container.querySelectorAll('button'))
      .find((button) => normalizedText(button).includes('AI generate'));
    expect(aiButton).toBeDefined();

    await act(async () => {
      aiButton.click();
    });

    expect(container.querySelector('.codex-modal input[type="text"]').value).toBe('Hac Y Ve 19');

    const saveButton = container.querySelector('.codex-modal-footer .btn-primary');
    await act(async () => {
      saveButton.click();
    });

    expect(codexState.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 1,
      name: 'Hac Y Ve 19',
      appearance: 'Ao den',
      personality: 'Tram lang',
    }), { dedupe: false });
  });

  it('passes each batch-generated 19th+ character to createCharacter', async () => {
    codexState.characters = Array.from({ length: 18 }, (_, index) => (
      createCharacter({ id: index + 1, name: `Hac Y Ve ${index + 1}` })
    ));

    await renderHub();

    const batchButton = container.querySelector('.codex-header-actions .btn-accent');
    expect(batchButton).not.toBeNull();

    await act(async () => {
      batchButton.click();
    });

    const batchAddButton = Array.from(container.querySelectorAll('button'))
      .find((button) => normalizedText(button).includes('Batch add'));
    expect(batchAddButton).toBeDefined();

    await act(async () => {
      batchAddButton.click();
    });

    expect(codexState.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 1,
      name: 'Hac Y Ve 19',
    }), { dedupe: false });
    expect(codexState.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 1,
      name: 'Hac Y Ve 20',
    }), { dedupe: false });
  });

  it('auto-locks a specific role when entered and persists it on save', async () => {
    await renderHub();

    const manualCreateButton = container.querySelector('.codex-header-actions .btn-primary');
    await act(async () => {
      manualCreateButton.click();
    });

    const nameInput = container.querySelector('.codex-modal input[type="text"]');
    const specificRoleInput = container.querySelector('[data-testid="character-specific-role-input"]');
    const lockInput = container.querySelector('[data-testid="character-specific-role-locked"]');

    expect(specificRoleInput).not.toBeNull();
    expect(lockInput).not.toBeNull();
    expect(lockInput.checked).toBe(false);

    await act(async () => {
      setInputValue(nameInput, 'Lan');
      setInputValue(specificRoleInput, 'nguoi giu ban do co');
    });

    expect(lockInput.checked).toBe(true);

    const saveButton = container.querySelector('.codex-modal-footer .btn-primary');
    await act(async () => {
      saveButton.click();
    });

    expect(codexState.createCharacter).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 1,
      name: 'Lan',
      specific_role: 'nguoi giu ban do co',
      specific_role_locked: true,
    }), { dedupe: false });
  });

  it('can unlock a specific role before saving', async () => {
    codexState.characters = [
      createCharacter({
        id: 1,
        name: 'Lan',
        specific_role: 'nguoi giu ban do co',
        specific_role_locked: true,
      }),
    ];

    await renderHub();

    const editButton = container.querySelector('.character-card-actions button:first-child');
    await act(async () => {
      editButton.click();
    });

    const specificRoleInput = container.querySelector('[data-testid="character-specific-role-input"]');
    const lockInput = container.querySelector('[data-testid="character-specific-role-locked"]');
    expect(specificRoleInput.value).toBe('nguoi giu ban do co');
    expect(lockInput.checked).toBe(true);

    await act(async () => {
      setCheckboxValue(lockInput, false);
    });
    expect(lockInput.checked).toBe(false);

    const saveButton = container.querySelector('.codex-modal-footer .btn-primary');
    await act(async () => {
      saveButton.click();
    });

    expect(codexState.updateCharacter).toHaveBeenCalledWith(1, expect.objectContaining({
      specific_role: 'nguoi giu ban do co',
      specific_role_locked: false,
    }));
  });

  it('can clear a specific role before saving', async () => {
    codexState.characters = [
      createCharacter({
        id: 1,
        name: 'Lan',
        specific_role: 'nguoi giu ban do co',
        specific_role_locked: false,
      }),
    ];

    await renderHub();

    const editButton = container.querySelector('.character-card-actions button:first-child');
    await act(async () => {
      editButton.click();
    });

    const specificRoleInput = container.querySelector('[data-testid="character-specific-role-input"]');
    const lockInput = container.querySelector('[data-testid="character-specific-role-locked"]');
    expect(specificRoleInput.value).toBe('nguoi giu ban do co');
    expect(lockInput.checked).toBe(false);

    await act(async () => {
      setInputValue(specificRoleInput, '');
    });
    expect(lockInput.checked).toBe(false);

    const saveButton = container.querySelector('.codex-modal-footer .btn-primary');
    await act(async () => {
      saveButton.click();
    });

    expect(codexState.updateCharacter).toHaveBeenCalledWith(1, expect.objectContaining({
      specific_role: '',
      specific_role_locked: false,
    }));
  });

  it('passes locked specific roles to AI generation controls', async () => {
    codexState.characters = [
      createCharacter({
        id: 1,
        name: 'Lan',
        specific_role: 'nguoi giu ban do co',
        specific_role_locked: true,
      }),
    ];

    await renderHub();

    const aiButton = container.querySelector('[data-testid="mock-ai-generate"]');
    expect(aiButton?.dataset.roleLockCount).toBe('1');

    const batchOpenButton = container.querySelector('.codex-header-actions .btn-accent');
    await act(async () => {
      batchOpenButton.click();
    });

    const batchButton = container.querySelector('[data-testid="mock-batch-generate"]');
    expect(batchButton?.dataset.roleLockCount).toBe('1');
  });

  it('shows locked specific roles on character cards and in the role lock panel', async () => {
    codexState.characters = [
      createCharacter({
        id: 1,
        name: 'Lan',
        specific_role: 'nguoi giu ban do co',
        specific_role_locked: true,
      }),
      createCharacter({
        id: 2,
        name: 'Ha',
        specific_role: 'nguoi tung phan boi hoi dong',
        specific_role_locked: false,
      }),
    ];

    await renderHub();

    const text = normalizedText(container);
    expect(text).toContain('Vai tro canon da khoa (1)');
    expect(text).toContain('Lan: nguoi giu ban do co');
    expect(text).toContain('Vai tro cu the: nguoi giu ban do co');
    expect(text).toContain('da khoa');
    expect(text).not.toContain('Ha: nguoi tung phan boi hoi dong');
  });

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
