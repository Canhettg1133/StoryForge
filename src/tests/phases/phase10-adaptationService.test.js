import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock('../../services/ai/client.js', () => ({
  default: {
    send: sendMock,
  },
}));

import { adaptEvent } from '../../services/viewer/adaptationService.js';

describe('phase10 adaptation service', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('passes callbacks when starting the request and resolves the parsed response', async () => {
    sendMock.mockImplementation((options) => {
      queueMicrotask(() => {
        options.onToken?.('{"equivalentEvent":"Ky thi Chunin",');
        options.onToken?.('"similarityScore":0.8}');
        options.onComplete?.('{"equivalentEvent":"Ky thi Chunin","similarityScore":0.8}');
      });
      return {
        abort: vi.fn(),
        routeInfo: { provider: 'test', model: 'test' },
      };
    });

    const resultPromise = adaptEvent(
      { description: 'A difficult school tournament' },
      'Naruto',
      'Harry Potter',
    );

    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
        onToken: expect.any(Function),
        onComplete: expect.any(Function),
        onError: expect.any(Function),
      }));
    });

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      equivalentEvent: 'Ky thi Chunin',
      similarityScore: 0.8,
    }));
  });
});
