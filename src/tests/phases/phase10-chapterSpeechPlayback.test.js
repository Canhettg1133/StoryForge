import { describe, expect, it, vi } from 'vitest';

import { createChapterPlaybackController } from '../../components/editor/chapterSpeech.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPlayback() {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
}

describe('chapter speech playback controller', () => {
  it('keeps the current audio and applies source/rate changes to the next segment', async () => {
    const players = [];
    const factory = vi.fn(async ({ onEnded }) => {
      const player = createPlayback();
      player.finish = onEnded;
      players.push(player);
      return player;
    });
    const firstSource = { key: 'edge:hoai-my' };
    const secondSource = { key: 'edge:nam-minh' };
    const controller = createChapterPlaybackController({ createPlayback: factory });

    controller.setSegments(['Đoạn một.', 'Đoạn hai.']);
    controller.setOptions({ source: firstSource, rate: 1 });
    controller.play();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    controller.setOptions({ source: secondSource, rate: 1.75 });

    expect(players[0].stop).not.toHaveBeenCalled();
    expect(players[0].play).toHaveBeenCalledTimes(1);
    players[0].finish();

    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    expect(factory.mock.calls[1][0]).toMatchObject({
      text: 'Đoạn hai.',
      source: secondSource,
      rate: 1.75,
    });
  });

  it('aborts a preparing segment and ignores its late result after stop', async () => {
    const pending = deferred();
    const latePlayer = createPlayback();
    const factory = vi.fn(({ signal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return pending.promise;
    });
    const controller = createChapterPlaybackController({ createPlayback: factory });

    controller.setSegments(['Đoạn tải chậm.']);
    controller.setOptions({ source: { key: 'edge:hoai-my' } });
    controller.play();
    await vi.waitFor(() => expect(controller.getState().status).toBe('preparing'));
    controller.stop();
    pending.resolve(latePlayer);
    await Promise.resolve();
    await Promise.resolve();

    expect(latePlayer.play).not.toHaveBeenCalled();
    expect(latePlayer.stop).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'idle', index: 0 });
  });

  it('does not activate an aborted preparation after pausing and resuming', async () => {
    const firstPending = deferred();
    const secondPending = deferred();
    const stalePlayer = createPlayback();
    const activePlayer = createPlayback();
    const factory = vi.fn()
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);
    const controller = createChapterPlaybackController({ createPlayback: factory });

    controller.setSegments(['Doan dang tai.']);
    controller.play();
    await vi.waitFor(() => expect(controller.getState().status).toBe('preparing'));

    controller.pause();
    controller.resume();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));

    firstPending.resolve(stalePlayer);
    secondPending.resolve(activePlayer);
    await vi.waitFor(() => expect(activePlayer.play).toHaveBeenCalledTimes(1));

    expect(stalePlayer.play).not.toHaveBeenCalled();
    expect(stalePlayer.stop).toHaveBeenCalledTimes(1);
    expect(activePlayer.stop).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('playing');
  });

  it('pauses and resumes generated audio without replaying the segment', async () => {
    const player = createPlayback();
    const factory = vi.fn(async ({ onEnded }) => {
      player.finish = onEnded;
      return player;
    });
    const controller = createChapterPlaybackController({ createPlayback: factory });

    controller.setSegments(['Đang đọc.', 'Tiếp theo.']);
    controller.play();
    await vi.waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    controller.pause();
    controller.resume();

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.resume).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('ignores a late resume failure after a new playback session starts', async () => {
    const resumePending = deferred();
    const firstPlayer = createPlayback();
    firstPlayer.resume.mockReturnValue(resumePending.promise);
    const secondPlayer = createPlayback();
    const factory = vi.fn()
      .mockResolvedValueOnce(firstPlayer)
      .mockResolvedValueOnce(secondPlayer);
    const controller = createChapterPlaybackController({ createPlayback: factory });

    controller.setSegments(['Luot doc cu.']);
    controller.play();
    await vi.waitFor(() => expect(firstPlayer.play).toHaveBeenCalledTimes(1));
    controller.pause();
    controller.resume();
    controller.stop();
    controller.setSegments(['Luot doc moi.']);
    controller.play();
    await vi.waitFor(() => expect(secondPlayer.play).toHaveBeenCalledTimes(1));

    resumePending.reject(new Error('late resume failure'));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe('playing');
    expect(secondPlayer.stop).not.toHaveBeenCalled();
  });

  it('cancels stale callbacks when switching chapters', async () => {
    const players = [];
    const factory = vi.fn(async ({ onEnded }) => {
      const player = createPlayback();
      player.finish = onEnded;
      players.push(player);
      return player;
    });
    const controller = createChapterPlaybackController({ createPlayback: factory });

    controller.setSegments(['Chương cũ.']);
    controller.play();
    await vi.waitFor(() => expect(players).toHaveLength(1));
    controller.setSegments(['Chương mới.'], { force: true });
    players[0].finish();

    expect(players[0].stop).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'idle', index: 0, total: 1 });
  });
});
