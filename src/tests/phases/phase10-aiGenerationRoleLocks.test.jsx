import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AIGenerateButton from '../../components/common/AIGenerateButton.jsx';
import BatchGenerate from '../../components/common/BatchGenerate.jsx';
import aiService from '../../services/ai/client';

vi.mock('../../services/ai/client', () => ({
  default: {
    send: vi.fn(),
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

describe('phase10 AI generation canon role locks', () => {
  let container;
  let root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function render(ui) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(ui);
    });
    return container;
  }

  it('passes canon role locks into single character generation prompts', async () => {
    await render(
      <AIGenerateButton
        entityType="character"
        projectContext={{ projectTitle: 'Du An Thu', genre: 'fantasy' }}
        canonRoleLocks={[{
          characterId: 1,
          characterName: 'Lan',
          specificRole: 'nguoi giu ban do co',
          locked: true,
        }]}
      />,
    );

    await act(async () => {
      container.querySelector('.ai-gen-trigger').click();
    });
    await act(async () => {
      setTextareaValue(container.querySelector('.ai-gen-input'), 'Tao mot nhan vat phu.');
    });
    await act(async () => {
      container.querySelector('.ai-gen-submit').click();
    });

    const messages = aiService.send.mock.calls[0][0].messages;
    expect(messages[0].content).toContain('[CANON VAI TRO DA KHOA - BAT BUOC]');
    expect(messages[0].content).toContain('- Lan: nguoi giu ban do co');
    expect(messages[1].content).toContain('"specific_role"');
  });

  it('derives canon role locks from existing batch characters and sends them to prompts', async () => {
    await render(
      <BatchGenerate
        entityType="character"
        projectContext={{ projectTitle: 'Du An Thu', genre: 'fantasy' }}
        existingEntities={{
          characters: [{
            id: 1,
            name: 'Lan',
            role: 'supporting',
            specific_role: 'nguoi giu ban do co',
            specific_role_locked: true,
            current_status: 'Dang giu ban do',
          }],
          locations: [],
          objects: [],
          terms: [],
          chapters: [],
        }}
        onBatchCreated={() => {}}
        onClose={() => {}}
      />,
    );

    await act(async () => {
      container.querySelector('.batch-gen-generate-actions .btn-primary').click();
    });

    const messages = aiService.send.mock.calls[0][0].messages;
    const combined = messages.map((message) => message.content).join('\n');
    expect(messages[0].content).toContain('[CANON VAI TRO DA KHOA - BAT BUOC]');
    expect(messages[0].content).toContain('- Lan: nguoi giu ban do co');
    expect(combined).toContain('Vai tro cu the: nguoi giu ban do co (da khoa canon)');
    expect(messages[1].content).toContain('Neu yeu cau can mot vai tro da khoa');
  });
});
