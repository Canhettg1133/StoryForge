import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSceneAutosaveController } from '../../components/editor/storyEditorAutosave.js';

describe('phase10 story editor autosave controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('persists the scene id and html captured at schedule time', async () => {
    const onSave = vi.fn(async () => undefined);
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      onSave,
    });

    controller.schedule({ sceneId: 11, html: '<p>Scene A</p>' });

    await vi.advanceTimersByTimeAsync(2000);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(11, '<p>Scene A</p>');
  });

  it('flushes the previous pending scene before switching to another scene', async () => {
    const onSave = vi.fn(async () => undefined);
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      onSave,
    });

    controller.schedule({ sceneId: 11, html: '<p>Pending scene A</p>' });
    await controller.flush();
    controller.schedule({ sceneId: 12, html: '<p>Scene B</p>' });

    await vi.advanceTimersByTimeAsync(2000);

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(1, 11, '<p>Pending scene A</p>');
    expect(onSave).toHaveBeenNthCalledWith(2, 12, '<p>Scene B</p>');
  });
});
