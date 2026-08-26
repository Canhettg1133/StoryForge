import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ManuscriptAnalysisPanel from '../../components/ai/ManuscriptAnalysisPanel.jsx';

function createEditor({ selected = true } = {}) {
  return {
    state: {
      selection: { empty: !selected, from: 1, to: selected ? 5 : 1 },
      doc: {
        content: { size: 8 },
        forEach(callback) {
          callback({
            isText: false,
            type: { name: 'paragraph' },
            forEach(childCallback) {
              childCallback({ isText: true, text: 'Một câu.', type: { name: 'text' } }, 0);
            },
          }, 0);
        },
      },
    },
    commands: { clearAnalysisHighlight() {} },
  };
}

describe('manuscript analysis panel', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('communicates local privacy and defaults to the selected passage', async () => {
    await act(async () => {
      root.render(
        <ManuscriptAnalysisPanel
          editor={createEditor({ selected: true })}
          currentProject={{ id: 1, prompt_templates: {} }}
          activeChapterId={11}
          activeSceneId={101}
          scenes={[{ id: 101, chapter_id: 11, draft_text: '<p>Một câu.</p>' }]}
          onBack={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain('Phân tích bản thảo');
    expect(container.textContent).toContain('Local · Không gửi dữ liệu');
    expect(container.querySelector('[aria-label="Phạm vi phân tích"]').value).toBe('selection');
    expect(container.textContent).not.toMatch(/văn AI|văn dở/i);
  });

  it('defaults to the current scene when there is no selection', async () => {
    await act(async () => {
      root.render(
        <ManuscriptAnalysisPanel
          editor={createEditor({ selected: false })}
          currentProject={{ id: 1, prompt_templates: {} }}
          activeChapterId={11}
          activeSceneId={101}
          scenes={[{ id: 101, chapter_id: 11, draft_text: '<p>Một câu.</p>' }]}
          onBack={() => {}}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Phạm vi phân tích"]').value).toBe('scene');
  });
});
