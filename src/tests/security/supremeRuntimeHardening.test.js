import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CHAT_IMAGE_FILE_BYTES,
  validateSupremeImage,
} from '../../../api/_lib/supreme-chat/attachments.js';
import { callSupremeProvider } from '../../../api/_lib/supreme-chat/providers.js';

function pngDataUrlWithDeclaredSize(sizeBytes) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 0,
  ]);
  const encodedLength = Math.ceil(sizeBytes / 3) * 4;
  const prefix = signature.toString('base64');
  const padding = sizeBytes % 3 === 1 ? '==' : sizeBytes % 3 === 2 ? '=' : '';
  return `data:image/png;base64,${prefix}${'A'.repeat(encodedLength - prefix.length - padding.length)}${padding}`;
}

describe('Supreme runtime hardening boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates an 8 MB image by decoding only its signature prefix', () => {
    const originalAtob = globalThis.atob;
    const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementation((value) => {
      expect(String(value).length).toBeLessThanOrEqual(24);
      return originalAtob(value);
    });
    const dataUrl = pngDataUrlWithDeclaredSize(MAX_CHAT_IMAGE_FILE_BYTES);

    expect(validateSupremeImage({
      kind: 'image',
      fileId: 1,
      fileName: 'large.png',
      mimeType: 'image/png',
      sizeBytes: MAX_CHAT_IMAGE_FILE_BYTES,
      dataUrl,
      turnOnly: false,
    })).toMatchObject({ fileName: 'large.png' });
    expect(atobSpy).toHaveBeenCalled();
  });

  it('rejects an upstream response that exceeds the bounded response budget', async () => {
    let cancelled = false;
    const oversizedChunk = new TextEncoder().encode('x'.repeat((1024 * 1024) + 1));
    const reader = {
      read: vi.fn().mockResolvedValue({ done: false, value: oversizedChunk }),
      cancel: vi.fn().mockImplementation(async () => {
        cancelled = true;
      }),
      releaseLock: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: {
        getReader() {
          return reader;
        },
      },
      text: vi.fn().mockResolvedValue('not-json'),
    });

    await expect(callSupremeProvider({
      route: {
        provider: 'openai_proxy',
        proxyProfileId: 'ag-gemini-proxy',
        model: 'model-id',
      },
      messages: [{ role: 'user', content: 'Xin chào' }],
      upstreamKey: 'user-key',
    })).rejects.toMatchObject({
      code: 'SUPREME_UPSTREAM_FAILED',
      status: 502,
    });
    expect(cancelled).toBe(true);
  });
  it('retains only safe metadata when the upstream rejects a provider key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'upstream-secret-diagnostic' },
    }), { status: 403 }));

    await expect(callSupremeProvider({
      route: {
        provider: 'openai_proxy',
        proxyProfileId: 'ag-gemini-proxy',
        model: 'model-id',
      },
      messages: [{ role: 'user', content: 'Hello' }],
      upstreamKey: 'user-key',
    })).rejects.toMatchObject({
      code: 'SUPREME_PROVIDER_KEY_REJECTED',
      status: 422,
      upstreamStatus: 403,
      failureKind: 'upstream_http',
    });
  });

  it('classifies Worker fetch failures without retaining sensitive diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Fetch blocked with error 1021 for https://private-provider.example'),
    );

    let caught;
    try {
      await callSupremeProvider({
        route: {
          provider: 'openai_proxy',
          proxyProfileId: 'custom-openai-proxy',
          baseUrl: 'https://private-provider.example:20128',
          chatCompletionsPath: '/v1/chat/completions',
          model: 'model-id',
        },
        messages: [{ role: 'user', content: 'Hello' }],
        upstreamKey: 'user-key',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'SUPREME_UPSTREAM_FAILED',
      status: 502,
      failureKind: 'network',
      networkReason: 'target_not_allowed',
      targetKind: 'nonstandard_https_port',
    });
    expect(caught.message).toBe('SUPREME_UPSTREAM_FAILED');
    expect(JSON.stringify(caught)).not.toContain('private-provider.example');
  });
});
