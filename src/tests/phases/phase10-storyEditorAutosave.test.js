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

  it('serializes saves and keeps the latest snapshot scheduled during an in-flight save', async () => {
    let releaseFirstSave;
    const firstSave = new Promise((resolve) => {
      releaseFirstSave = resolve;
    });
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      onSave,
    });

    controller.schedule({ sceneId: 11, html: '<p>First</p>' });
    await vi.advanceTimersByTimeAsync(2000);
    controller.schedule({ sceneId: 11, html: '<p>Latest</p>' });
    await vi.advanceTimersByTimeAsync(2000);

    expect(onSave).toHaveBeenCalledTimes(1);

    releaseFirstSave();
    await controller.flush();

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(11, '<p>Latest</p>');
  });

  it('keeps the latest pending snapshot for every scene during an in-flight save', async () => {
    let releaseFirstSave;
    const firstSave = new Promise((resolve) => {
      releaseFirstSave = resolve;
    });
    const onSave = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      onSave,
    });

    controller.schedule({ sceneId: 11, html: '<p>Scene A</p>' });
    await vi.advanceTimersByTimeAsync(2000);
    controller.schedule({ sceneId: 12, html: '<p>Scene B old</p>' });
    controller.schedule({ sceneId: 12, html: '<p>Scene B latest</p>' });
    controller.schedule({ sceneId: 13, html: '<p>Scene C</p>' });

    releaseFirstSave();
    await controller.flush();

    expect(onSave).toHaveBeenCalledTimes(3);
    expect(controller.hasPendingForScene(11)).toBe(false);
    expect(controller.hasPendingForScene(12)).toBe(false);
    expect(onSave).toHaveBeenNthCalledWith(2, 12, '<p>Scene B latest</p>');
    expect(onSave).toHaveBeenNthCalledWith(3, 13, '<p>Scene C</p>');
  });

  it('retries once, reports an error, and retains the failed snapshot for manual retry', async () => {
    const error = new Error('IndexedDB quota exceeded');
    const onSave = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const onStatusChange = vi.fn();
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      retryDelayMs: 500,
      onSave,
      onStatusChange,
    });

    controller.schedule({ sceneId: 11, html: '<p>Must survive</p>' });
    const flushPromise = controller.flush();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromise;

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(controller.getStatus()).toMatchObject({
      state: 'error',
      sceneId: 11,
      error,
    });
    expect(controller.hasPending()).toBe(true);

    await controller.retry();

    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onSave).toHaveBeenLastCalledWith(11, '<p>Must survive</p>');
    expect(controller.getStatus()).toMatchObject({
      state: 'saved',
      sceneId: 11,
    });
    expect(controller.hasPending()).toBe(false);
  });

  it('does not report saved until persistence succeeds', async () => {
    let releaseSave;
    const onSave = vi.fn(() => new Promise((resolve) => {
      releaseSave = resolve;
    }));
    const onStatusChange = vi.fn();
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      onSave,
      onStatusChange,
    });

    controller.schedule({ sceneId: 22, html: '<p>Pending</p>' });
    const flushPromise = controller.flush();
    await Promise.resolve();

    expect(controller.getStatus()).toMatchObject({
      state: 'saving',
      sceneId: 22,
    });
    expect(onStatusChange).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'saved' }));

    releaseSave();
    await flushPromise;

    expect(controller.getStatus()).toMatchObject({
      state: 'saved',
      sceneId: 22,
    });
  });

  it('retains a failed scene while later scenes continue saving', async () => {
    const quotaError = new Error('Quota exceeded');
    const onSave = vi.fn()
      .mockRejectedValueOnce(quotaError)
      .mockRejectedValueOnce(quotaError)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const controller = createSceneAutosaveController({
      delayMs: 2000,
      retryDelayMs: 500,
      onSave,
    });

    controller.schedule({ sceneId: 31, html: '<p>Scene failed</p>' });
    controller.schedule({ sceneId: 32, html: '<p>Scene saved</p>' });
    const flushPromise = controller.flush();
    await vi.advanceTimersByTimeAsync(500);
    await flushPromise;

    expect(onSave).toHaveBeenNthCalledWith(3, 32, '<p>Scene saved</p>');
    expect(controller.getStatus()).toMatchObject({
      state: 'error',
      sceneId: 31,
    });
    expect(controller.hasPending()).toBe(true);

    await controller.retry();

    expect(onSave).toHaveBeenNthCalledWith(4, 31, '<p>Scene failed</p>');
    expect(controller.hasPending()).toBe(false);
  });
});
