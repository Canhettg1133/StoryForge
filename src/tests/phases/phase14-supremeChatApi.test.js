import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = 'api/_lib/supreme-chat/schema.js';
const HANDLER_PATH = 'api/_web/supreme-chat.js';
const CAPABILITIES_PATH = 'api/_web/supreme-chat-capabilities.js';
const CONTRACT_PATH = 'packages/ai-contracts/src/supremeChat.js';

function readPlannedFile(path) {
  const absolutePath = resolve(process.cwd(), path);
  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

async function importPlannedModule(path) {
  const absolutePath = resolve(process.cwd(), path);
  expect(existsSync(absolutePath), `${path} must exist`).toBe(true);
  if (!existsSync(absolutePath)) return null;
  return import(`${pathToFileURL(absolutePath).href}?test=${Date.now()}`);
}

function validChatRequest(overrides = {}) {
  return {
    operation: 'chat',
    route: {
      provider: 'openai_proxy',
      proxyProfileId: 'ag-gemini-proxy',
      model: 'model-id',
    },
    messages: [{ role: 'user', content: 'Xin chào' }],
    attachments: [],
    ...overrides,
  };
}

describe('Supreme API request schema', () => {
  it('accepts only the three operations and user/assistant message roles', async () => {
    const schema = await importPlannedModule(SCHEMA_PATH);
    if (!schema) return;
    const operationAttachment = {
      kind: 'document_context',
      fileId: 1,
      fileName: 'story.txt',
      fileType: 'txt',
      profileText: '',
      chunks: [{ chunkIndex: 0, title: 'Đoạn 1', text: 'Nội dung an toàn.' }],
    };

    expect(schema.validateSupremeChatRequest(validChatRequest()).operation).toBe('chat');
    expect(schema.validateSupremeChatRequest(validChatRequest({
      operation: 'attachment_chunk',
      attachments: [operationAttachment],
    })).operation).toBe('attachment_chunk');
    expect(schema.validateSupremeChatRequest(validChatRequest({
      operation: 'attachment_merge',
      attachments: [operationAttachment],
    })).operation).toBe('attachment_merge');

    for (const operation of ['unknown', 'debug', 'system']) {
      expect(() => schema.validateSupremeChatRequest(validChatRequest({ operation }))).toThrow();
    }
    for (const role of ['system', 'developer', 'tool']) {
      expect(() => schema.validateSupremeChatRequest(validChatRequest({
        messages: [{ role, content: 'malicious' }],
      }))).toThrow();
    }
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      operation: 'attachment_chunk',
      attachments: [],
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      operation: 'attachment_chunk',
      attachments: [{
        ...operationAttachment,
        chunks: [
          ...operationAttachment.chunks,
          { chunkIndex: 1, title: 'Đoạn 2', text: 'Nội dung thứ hai.' },
        ],
      }],
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      operation: 'attachment_merge',
      attachments: [{
        kind: 'image',
        fileId: 1,
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 8,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }],
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
  });

  it.each([
    'systemPrompt',
    'system_prompt',
    'developer',
    'baseUrl',
    'targetBaseUrl',
    'chatCompletionsPath',
    'apiKey',
    'promptRevision',
    'tools',
    'functions',
  ])('rejects forbidden client field %s', async (field) => {
    const schema = await importPlannedModule(SCHEMA_PATH);
    if (!schema) return;

    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      [field]: 'malicious',
    }))).toThrow();
  });

  it('enforces message, model, image, and aggregate text limits', async () => {
    const schema = await importPlannedModule(SCHEMA_PATH);
    if (!schema) return;

    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      messages: Array.from({ length: 61 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: 'message',
      })),
    }))).toThrow();
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      messages: [{ role: 'user', content: 'x'.repeat(20001) }],
    }))).toThrow();
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      route: {
        provider: 'openai_proxy',
        proxyProfileId: 'ag-gemini-proxy',
        model: 'x'.repeat(201),
      },
    }))).toThrow();
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      attachments: Array.from({ length: 5 }, (_, index) => ({
        kind: 'image',
        fileId: index + 1,
        fileName: `${index}.png`,
        mimeType: 'image/png',
        sizeBytes: 100,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      })),
    }))).toThrow();

    const document = (index, chunks = [{
      chunkIndex: 0,
      title: 'Đoạn',
      text: 'Nội dung',
    }]) => ({
      kind: 'document_context',
      fileId: index + 1,
      fileName: `${index}.txt`,
      fileType: 'txt',
      profileText: '',
      chunks,
    });
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      attachments: Array.from({ length: 9 }, (_, index) => document(index)),
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      attachments: [document(0, [])],
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
    expect(schema.validateSupremeChatRequest(validChatRequest({
      attachments: [{
        ...document(0, []),
        profileText: 'Hồ sơ tệp đã được đọc kỹ trước đó.',
      }],
    })).attachments[0].profileText).toBe('Hồ sơ tệp đã được đọc kỹ trước đó.');
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      attachments: [document(0, [{
        chunkIndex: 0,
        title: 'Đoạn',
        text: 'x'.repeat(20001),
      }])],
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      attachments: [document(0, [{
        chunkIndex: 0,
        title: 't'.repeat(500),
        text: 'x'.repeat(499600),
      }])],
    }))).toThrow(/SUPREME_ATTACHMENT_INVALID/u);
  });

  it('accepts only a public HTTPS Custom Proxy route and rejects unsafe targets', async () => {
    const schema = await importPlannedModule(SCHEMA_PATH);
    if (!schema) return;

    for (const provider of ['ollama', 'ai_studio_relay', 'custom_openai']) {
      expect(() => schema.validateSupremeChatRequest(validChatRequest({
        route: { provider, model: 'model-id' },
      }))).toThrow();
    }

    expect(schema.validateSupremeChatRequest(validChatRequest({
      route: {
        provider: 'openai_proxy',
        proxyProfileId: 'custom-openai-proxy',
        model: 'custom-model-id',
        baseUrl: 'https://proxy.example.com/',
        chatCompletionsPath: '/v1/chat/completions',
      },
    })).route).toEqual({
      provider: 'openai_proxy',
      proxyProfileId: 'custom-openai-proxy',
      model: 'custom-model-id',
      baseUrl: 'https://proxy.example.com/',
      chatCompletionsPath: '/v1/chat/completions',
    });

    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      route: {
        provider: 'openai_proxy',
        proxyProfileId: 'custom-openai-proxy',
        model: 'model-id',
      },
    }))).toThrow();

    for (const baseUrl of [
      'http://proxy.example.com',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.8',
      'https://user:password@proxy.example.com',
      '/api/local-proxy',
    ]) {
      expect(() => schema.validateSupremeChatRequest(validChatRequest({
        route: {
          provider: 'openai_proxy',
          proxyProfileId: 'custom-openai-proxy',
          model: 'model-id',
          baseUrl,
          chatCompletionsPath: '/v1/chat/completions',
        },
      }))).toThrow(/SUPREME_PROVIDER_UNSUPPORTED/u);
    }

    for (const chatCompletionsPath of [
      '//attacker.example/v1/chat/completions',
      'https://attacker.example/v1/chat/completions',
      '/v1/chat\\completions',
    ]) {
      expect(() => schema.validateSupremeChatRequest(validChatRequest({
        route: {
          provider: 'openai_proxy',
          proxyProfileId: 'custom-openai-proxy',
          model: 'model-id',
          baseUrl: 'https://proxy.example.com',
          chatCompletionsPath,
        },
      }))).toThrow(/SUPREME_PROVIDER_UNSUPPORTED/u);
    }

    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      route: {
        provider: 'openai_proxy',
        proxyProfileId: 'ag-gemini-proxy',
        model: 'model-id',
        baseUrl: 'https://attacker.example',
      },
    }))).toThrow();

    expect(() => schema.validateSupremeChatRequest(validChatRequest({
      route: { provider: 'gemini_direct', model: 'gemini-model' },
      attachments: [{
        kind: 'image',
        fileId: 1,
        fileName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }],
    }))).toThrow(/SUPREME_IMAGE_PROVIDER_UNSUPPORTED/u);
  });

  it('accepts valid models exposed by supported web proxies without opening unknown profiles', async () => {
    const contract = await importPlannedModule(CONTRACT_PATH);
    if (!contract) return;

    expect(contract.isSupremeModelAllowed({
      provider: 'openai_proxy',
      proxyProfileId: 'custom-openai-proxy',
      model: 'vendor/custom-model-v2',
    })).toBe(true);
    expect(contract.isSupremeModelAllowed({
      provider: 'openai_proxy',
      proxyProfileId: 'ag-gemini-proxy',
      model: 'attacker-invented-model',
    })).toBe(true);
    expect(contract.isSupremeModelAllowed({
      provider: 'openai_proxy',
      proxyProfileId: 'custom-openai-proxy',
      model: `unsafe\u0000model`,
    })).toBe(false);
    expect(contract.isSupremeModelAllowed({
      provider: 'openai_proxy',
      proxyProfileId: 'unknown-proxy-profile',
      model: 'valid-model-id',
    })).toBe(false);
  });
});

describe('Supreme API security and runtime parity contract', () => {
  it('registers the same dedicated route in Vercel, Cloudflare, and local Vite', () => {
    const wrapper = readPlannedFile('api/supreme-chat.js');
    const capabilityWrapper = readPlannedFile('api/supreme-chat-capabilities.js');
    const handler = readPlannedFile(HANDLER_PATH);
    const worker = readPlannedFile('worker/index.js');
    const vite = readPlannedFile('vite.config.js');
    const vercel = readPlannedFile('vercel.json');

    expect(wrapper).toContain('_web/supreme-chat');
    expect(capabilityWrapper).toContain('_web/supreme-chat-capabilities');
    expect(handler).toContain('createSupremeChatHandler');
    expect(worker).toContain('/api/supreme-chat');
    expect(worker).toContain('/api/supreme-chat-capabilities');
    expect(vite).toContain('/api/supreme-chat');
    expect(vite).toContain('/api/supreme-chat-capabilities');
    expect(vercel).toContain('api/supreme-chat.js');
    expect(vercel).toContain('api/supreme-chat-capabilities.js');
    const wrangler = readPlannedFile('wrangler.toml');
    expect(wrangler).toContain('SUPREME_EDGE_RATE_LIMITER');
    expect(wrangler).toContain('SUPREME_CHAT_RATE_LIMITER');
    expect(wrangler).toContain('SUPREME_CHUNK_RATE_LIMITER');
  });

  it('advertises image support by runtime without exposing protected prompt metadata', async () => {
    const capabilities = await importPlannedModule(CAPABILITIES_PATH);
    if (!capabilities) return;

    const handler = capabilities.createSupremeChatCapabilitiesWebHandler();
    const cloudflareResponse = await handler(
      new Request('https://storyforge.example/api/supreme-chat-capabilities'),
      { platform: 'cloudflare' },
    );
    const vercelResponse = await handler(
      new Request('https://storyforge.example/api/supreme-chat-capabilities'),
      { platform: 'vercel' },
    );
    const cloudflarePayload = await cloudflareResponse.json();
    const vercelPayload = await vercelResponse.json();

    expect(cloudflarePayload.images).toBe(true);
    expect(vercelPayload.images).toBe(false);
    expect(JSON.stringify([cloudflarePayload, vercelPayload])).not.toMatch(
      /prompt|revision|cipher|canary/iu,
    );
  });

  it('keeps the upstream key in a header and constrains Custom Proxy targets server-side', () => {
    const handler = readPlannedFile(HANDLER_PATH);
    const provider = readPlannedFile('api/_lib/supreme-chat/providers.js');

    expect(handler).toContain('X-StoryForge-Upstream-Key');
    expect(handler).toContain('ai_chat.access');
    expect(handler).toContain('ai_chat.supreme');
    expect(handler).toContain('getClientIp');
    expect(handler).toMatch(/key\??\.fill\(0\)/u);
    expect(provider).toContain('ag-gemini-proxy');
    expect(provider).toMatch(/generativelanguage\.googleapis\.com/iu);
    expect(provider).toMatch(/redirect\s*:\s*['"]error['"]/u);
    expect(provider).toContain('CUSTOM_PROXY_PROFILE_ID');
    expect(provider).toContain('isRelayAllowedTarget');
    expect(provider).toContain('buildOpenAIProxyEndpoint');
    expect(provider).not.toMatch(/body\.baseUrl|targetBaseUrl/u);
  });

  it('keeps shared Supreme contracts and server crypto outside app-specific source trees', () => {
    const handler = readPlannedFile(HANDLER_PATH);
    const projectChat = readPlannedFile('src/pages/ProjectChat/ProjectChat.jsx');
    const adminSecurePrompt = readPlannedFile(
      'apps/admin-api-worker/src/securePrompts/index.js',
    );
    const cryptoBridge = readPlannedFile('api/_lib/supreme-chat/crypto.js');

    expect(handler).toContain('packages/ai-contracts');
    expect(handler).not.toMatch(/from\s+['"][^'"]*src\/(?:config|pages|services)\//u);
    expect(projectChat).toContain('packages/ai-contracts');
    expect(projectChat).not.toContain('../../config/supremeModels');
    expect(adminSecurePrompt).toContain('packages/server-security');
    expect(adminSecurePrompt).not.toContain('../../../../api/');
    expect(cryptoBridge).toContain('packages/server-security');
  });

  it('uses non-streaming upstream responses and scans every operation before returning', () => {
    const handler = readPlannedFile(HANDLER_PATH);

    expect(handler).toContain('attachment_chunk');
    expect(handler).toContain('attachment_merge');
    expect(handler).toContain('scanProtectedOutput');
    expect(handler).toContain('PROTECTED_OUTPUT_BLOCKED');
    expect(handler).not.toMatch(/ReadableStream|text\/event-stream|data:\s*\$\{/u);
  });

  it('revalidates attachment boundaries and image signatures on the server', () => {
    const attachments = readPlannedFile('api/_lib/supreme-chat/attachments.js');

    expect(attachments).toContain('ATTACHMENT_DATA');
    expect(attachments).toContain('UNTRUSTED_INSTRUCTION_BLOCKED');
    expect(attachments).toContain('25 * 1024 * 1024');
    expect(attachments).toContain('8 * 1024 * 1024');
    expect(attachments).toContain('12 * 1024 * 1024');
    expect(attachments).toMatch(/magic/iu);
    expect(attachments).toMatch(/image\/png/iu);
    expect(attachments).toMatch(/image\/jpeg/iu);
    expect(attachments).toMatch(/image\/webp/iu);
  });

  it('publishes only safe public error metadata', () => {
    const handler = readPlannedFile(HANDLER_PATH);

    for (const code of [
      'AUTH_REQUIRED',
      'SUPREME_CHAT_NOT_ALLOWED',
      'SUPREME_PROVIDER_NOT_ALLOWED',
      'SUPREME_PROMPT_NOT_PUBLISHED',
      'SUPREME_CHAT_BODY_TOO_LARGE',
      'SUPREME_IMAGE_CONTEXT_TOO_LARGE',
      'SUPREME_CHAT_REQUEST_INVALID',
      'SUPREME_PROVIDER_UNSUPPORTED',
      'SUPREME_ATTACHMENT_INVALID',
      'SUPREME_IMAGE_PROVIDER_UNSUPPORTED',
      'SUPREME_CHAT_RATE_LIMITED',
      'SUPREME_UPSTREAM_FAILED',
      'SUPREME_PROMPT_UNAVAILABLE',
    ]) {
      expect(handler).toContain(code);
    }

    expect(handler).toContain('requestId');
    expect(handler).not.toMatch(/rawUpstreamError|requestBody|console\.log\(.*apiKey/iu);
    expect(handler).toContain('input_blocked');
    expect(handler).toContain('request rejected');
  });
});
