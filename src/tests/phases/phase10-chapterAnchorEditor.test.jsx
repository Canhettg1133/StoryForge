import React, { useEffect, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ChapterAnchorEditor from '../../pages/StoryBible/components/ChapterAnchorEditor.jsx';
import EditableMacroMilestoneCard from '../../pages/StoryBible/components/EditableMacroMilestoneCard.jsx';
import {
  parseChapterAnchorFocusCharacters,
  splitChapterAnchorFocusInput,
  splitChapterAnchorRequirementLines,
} from '../../pages/StoryBible/components/chapterAnchorUtils.js';

function createAnchor(overrides = {}) {
  return {
    id: overrides.id || 'anchor_test_1',
    targetChapter: 12,
    strictness: 'hard',
    requirementText: '',
    focusCharacters: [],
    objectiveRefs: [],
    successSignals: [],
    forbidBefore: true,
    notes: '',
    ...overrides,
  };
}

function Harness({ initialAnchors, allCharacters, onValue }) {
  const [anchors, setAnchors] = useState(initialAnchors);

  useEffect(() => {
    onValue(anchors);
  }, [anchors, onValue]);

  return (
    <ChapterAnchorEditor
      anchors={anchors}
      onChange={setAnchors}
      allCharacters={allCharacters}
      scopeStart={12}
      scopeEnd={20}
    />
  );
}

function setElementValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('phase10 chapter anchor utils', () => {
  it('does not split focus character names on spaces', () => {
    expect(parseChapterAnchorFocusCharacters('Lâm Mặc')).toEqual(['Lâm Mặc']);
    expect(parseChapterAnchorFocusCharacters('lão già áo đen')).toEqual(['lão già áo đen']);
  });

  it('splits focus character names on commas', () => {
    expect(parseChapterAnchorFocusCharacters('Lâm Mặc, Diệp Ninh, đội hộ vệ')).toEqual([
      'Lâm Mặc',
      'Diệp Ninh',
      'đội hộ vệ',
    ]);
  });

  it('splits focus character names on new lines', () => {
    expect(parseChapterAnchorFocusCharacters('Lâm Mặc\nDiệp Ninh\nđội hộ vệ')).toEqual([
      'Lâm Mặc',
      'Diệp Ninh',
      'đội hộ vệ',
    ]);
  });

  it('returns committed entries and remainder for delimited focus input', () => {
    expect(splitChapterAnchorFocusInput('Lâm Mặc, Diệp Ninh')).toEqual({
      committedValues: ['Lâm Mặc'],
      remainder: ' Diệp Ninh',
    });
    expect(splitChapterAnchorFocusInput('Lâm Mặc,\nDiệp Ninh,\n')).toEqual({
      committedValues: ['Lâm Mặc', 'Diệp Ninh'],
      remainder: '',
    });
  });

  it('splits requirement textarea into multiple lines and preserves inner spacing', () => {
    expect(splitChapterAnchorRequirementLines(
      '  Lâm  Mặc phát hiện mật thất dưới tổ từ.  \n\n  Diệp Ninh nhìn thấy nhưng giả vờ không biết.  ',
    )).toEqual([
      'Lâm  Mặc phát hiện mật thất dưới tổ từ.',
      'Diệp Ninh nhìn thấy nhưng giả vờ không biết.',
    ]);
  });
});

describe('phase10 ChapterAnchorEditor', () => {
  let container;
  let root;
  let latestAnchors;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    latestAnchors = [];
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
  });

  async function mountEditor({ initialAnchors, allCharacters = [] }) {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <Harness
          initialAnchors={initialAnchors}
          allCharacters={allCharacters}
          onValue={(value) => {
            latestAnchors = value;
          }}
        />,
      );
    });
  }

  it('selects the highlighted character when Enter is pressed', async () => {
    await mountEditor({
      initialAnchors: [createAnchor()],
      allCharacters: ['Lâm Mặc', 'Diệp Ninh'],
    });

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).not.toBeNull();

    await act(async () => {
      combobox.focus();
      setElementValue(combobox, 'Lâm');
    });

    const options = Array.from(container.querySelectorAll('[role="option"]'));
    expect(options.some((node) => node.textContent?.includes('Lâm Mặc'))).toBe(true);

    await act(async () => {
      combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(latestAnchors[0].focusCharacters).toEqual(['Lâm Mặc']);
  });

  it('adds a custom chip and marks it as outside the character hub when Enter has no match', async () => {
    await mountEditor({
      initialAnchors: [createAnchor()],
      allCharacters: ['Lâm Mặc', 'Diệp Ninh'],
    });

    const combobox = container.querySelector('[role="combobox"]');

    await act(async () => {
      combobox.focus();
      setElementValue(combobox, 'đội hộ vệ');
    });

    await act(async () => {
      combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(latestAnchors[0].focusCharacters).toEqual(['đội hộ vệ']);
    expect(container.textContent).toContain('Ngoài danh sách');
  });

  it('splits textarea content into multiple anchors when requested', async () => {
    await mountEditor({
      initialAnchors: [createAnchor()],
      allCharacters: ['Lâm Mặc', 'Diệp Ninh'],
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      setElementValue(textarea, 'Lâm  Mặc phát hiện mật thất dưới tổ từ.\n\nDiệp Ninh nhìn thấy nhưng giả vờ không biết.');
    });

    const splitButton = Array.from(container.querySelectorAll('button'))
      .find((node) => node.textContent?.includes('Tách thành nhiều yêu cầu'));
    expect(splitButton).not.toBeNull();

    await act(async () => {
      splitButton.click();
    });

    expect(latestAnchors).toHaveLength(2);
    expect(latestAnchors.map((item) => item.requirementText)).toEqual([
      'Lâm  Mặc phát hiện mật thất dưới tổ từ.',
      'Diệp Ninh nhìn thấy nhưng giả vờ không biết.',
    ]);
  });

  it('preserves trailing spaces while editing the requirement textarea', async () => {
    await mountEditor({
      initialAnchors: [createAnchor()],
      allCharacters: ['LĂ¢m Máº·c'],
    });

    const requirementTextarea = container.querySelector('textarea');
    expect(requirementTextarea).not.toBeNull();

    await act(async () => {
      setElementValue(requirementTextarea, 'tao ');
    });

    expect(requirementTextarea.value).toBe('tao ');
    expect(latestAnchors[0].requirementText).toBe('tao ');
  });

  it('does not bubble requirement textarea clicks to the editable milestone card toggle', async () => {
    function MilestoneHarness() {
      const [isSelected, setIsSelected] = useState(false);
      const [milestone, setMilestone] = useState({
        title: 'Moc 1',
        chapter_from: 12,
        chapter_to: 14,
        description: '',
        emotional_peak: '',
        chapter_anchors: [createAnchor()],
      });

      return (
        <div data-selected={isSelected ? 'yes' : 'no'}>
          <EditableMacroMilestoneCard
            milestone={milestone}
            index={0}
            isSelected={isSelected}
            isAnalyzing={false}
            allCharacterNames={['Lâm Mặc']}
            onToggle={() => setIsSelected((current) => !current)}
            onUpdate={(index, field, value) => {
              if (field === 'chapter_anchors') {
                setMilestone((current) => ({ ...current, chapter_anchors: value }));
                return;
              }
              setMilestone((current) => ({ ...current, [field]: value }));
            }}
            onRemove={() => {}}
            onAnalyze={() => {}}
          />
        </div>
      );
    }

    root = createRoot(container);
    await act(async () => {
      root.render(<MilestoneHarness />);
    });

    const selectedFlag = () => container.querySelector('[data-selected]')?.getAttribute('data-selected');
    expect(selectedFlag()).toBe('no');

    const requirementTextarea = Array.from(container.querySelectorAll('textarea'))
      .find((node) => node.getAttribute('aria-label') === 'Điều bắt buộc');
    expect(requirementTextarea).not.toBeNull();

    await act(async () => {
      requirementTextarea.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(selectedFlag()).toBe('no');
  });
});
