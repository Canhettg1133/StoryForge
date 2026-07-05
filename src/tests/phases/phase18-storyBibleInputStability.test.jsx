import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StoryBibleOverviewSection from '../../pages/StoryBible/sections/StoryBibleOverviewSection.jsx';

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

function getMilestonePercentInput(container) {
  return Array.from(container.querySelectorAll('input[inputmode="numeric"]'))
    .find((input) => input.getAttribute('placeholder') === '%');
}

function StoryBibleOverviewHarness() {
  const [milestonesInfo, setMilestonesInfo] = useState([
    { percent: 50, description: 'Midpoint' },
  ]);

  const updateMilestone = (index, field, value) => {
    setMilestonesInfo((previous) => {
      const next = [...previous];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  return (
    <StoryBibleOverviewSection
      isOpen
      onToggle={vi.fn()}
      chaptersCount={0}
      charactersCount={0}
      locationsCount={0}
      objectsCount={0}
      worldTermsCount={0}
      title="Story"
      setTitle={vi.fn()}
      titleSaved={false}
      genrePrimary="fantasy"
      tone=""
      povMode="third_limited"
      pronounStyle="hien_dai"
      currentPronoun={null}
      synopsis=""
      setSynopsis={vi.fn()}
      synopsisSaved={false}
      storyStructure=""
      targetLengthType="unset"
      targetLength=""
      setTargetLength={vi.fn()}
      targetLengthSaved={false}
      targetLengthWarning=""
      ultimateGoal=""
      setUltimateGoal={vi.fn()}
      ultimateGoalSaved={false}
      milestonesInfo={milestonesInfo}
      milestonesSaved={false}
      addMilestone={vi.fn()}
      updateMilestone={updateMilestone}
      removeMilestone={vi.fn()}
      description=""
      setDescription={vi.fn()}
      descSaved={false}
      save={vi.fn()}
      handleGenreChange={vi.fn()}
      handleToneChange={vi.fn()}
      handlePovChange={vi.fn()}
      handlePronounChange={vi.fn()}
      handleStructureChange={vi.fn()}
      handleTargetLengthTypeChange={vi.fn()}
      pronounStylePresets={[{ value: 'hien_dai', label: 'Modern' }]}
    />
  );
}

describe('phase18 StoryBible input stability', () => {
  let container;
  let root;

  beforeEach(() => {
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

  it('keeps the milestone percent input mounted while the user types', async () => {
    await act(async () => {
      root.render(<StoryBibleOverviewHarness />);
    });

    const percentInput = getMilestonePercentInput(container);
    expect(percentInput).toBeTruthy();

    percentInput.focus();
    expect(document.activeElement).toBe(percentInput);

    await act(async () => {
      setInputValue(percentInput, '51');
    });

    expect(getMilestonePercentInput(container)).toBe(percentInput);
    expect(document.activeElement).toBe(percentInput);
  });
});
