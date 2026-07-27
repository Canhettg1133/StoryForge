import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

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

describe('Supreme global chat UI contract', () => {
  it('adds the Supreme mode only to global chat with a Crown affordance', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');

    expect(/SUPREME\s*:\s*['"]supreme['"]/u.test(source), 'defines CHAT_MODES.SUPREME').toBe(true);
    expect(source.includes('Tối Thượng'), 'renders the Tối Thượng label').toBe(true);
    expect(source.includes('Crown'), 'uses the Crown icon').toBe(true);
    expect(
      /projectScopeEnabled[\s\S]+AI của truyện[\s\S]+Tự do hỏi đáp/u.test(source),
      'keeps Story and Free in project chat',
    ).toBe(true);
    expect(
      /!projectScopeEnabled[\s\S]+Tự do hỏi đáp[\s\S]+Tối Thượng/u.test(source),
      'shows Free and Supreme only in global chat',
    ).toBe(true);
  });

  it('creates isolated Supreme threads with an empty system prompt', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');

    expect(/chat_mode\s*:\s*CHAT_MODES\.SUPREME/u.test(source), 'creates a Supreme thread').toBe(true);
    expect(
      /chat_mode\s*:\s*CHAT_MODES\.SUPREME[\s\S]{0,300}system_prompt\s*:\s*['"]/u.test(source),
      'stores an empty Supreme system prompt',
    ).toBe(true);
    expect(
      /chat_mode\s*:\s*CHAT_MODES\.SUPREME[\s\S]{0,350}system_prompt_customized\s*:\s*false/u.test(source),
      'does not mark the Supreme system prompt as customized',
    ).toBe(true);
    expect(source.includes('ai_chat.supreme'), 'checks the Supreme feature gate').toBe(true);
  });

  it('does not expose or build a client-side system prompt in Supreme mode', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');

    expect(
      /activeThreadMode\s*!==\s*CHAT_MODES\.SUPREME[\s\S]{0,300}System prompt/u.test(source),
      'hides the System prompt button in Supreme mode',
    ).toBe(true);
    expect(
      /activeThreadMode\s*!==\s*CHAT_MODES\.SUPREME[\s\S]{0,500}project-chat-system-prompt/u.test(source),
      'hides the System prompt drawer in Supreme mode',
    ).toBe(true);
    expect(/CHAT_MODES\.SUPREME[\s\S]{0,200}buildFreeSystemPrompt/u.test(source)).toBe(false);
    expect(/CHAT_MODES\.SUPREME[\s\S]{0,200}buildDefaultSystemPrompt/u.test(source)).toBe(false);
  });

  it('routes only Supreme turns through the non-streaming Supreme client', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');
    const client = readPlannedFile('src/services/ai/supremeChatClient.js');

    expect(source.includes('supremeChatClient'), 'imports the dedicated Supreme client').toBe(true);
    expect(
      /CHAT_MODES\.SUPREME[\s\S]+supremeChatClient/u.test(source),
      'routes only Supreme turns through the dedicated client',
    ).toBe(true);
    expect(client).toContain('/api/supreme-chat');
    expect(client).toContain('X-StoryForge-Upstream-Key');
    expect(client).toContain('AbortController');
    expect(client).not.toMatch(/systemPrompt|system_prompt|role:\s*['"]system['"]/u);
    expect(client).not.toMatch(/stream\s*:\s*true/u);
  });

  it('keeps attachment controls and sends full-read chunk and merge operations through Supreme API', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');
    const payload = readPlannedFile('src/services/chatAttachments/supremePayload.js');

    expect(source.includes('Đọc kỹ toàn bộ'), 'keeps the full-read attachment control').toBe(true);
    expect(/CHAT_MODES\.SUPREME[\s\S]+attachment_chunk/u.test(source)).toBe(true);
    expect(/CHAT_MODES\.SUPREME[\s\S]+attachment_merge/u.test(source)).toBe(true);
    expect(payload).toContain('document_context');
    expect(payload).toContain('profileText');
    expect(payload).toContain('chunks');
    expect(payload).toContain('turnOnly');
    expect(payload).not.toMatch(/systemPrompt|system_prompt|role:\s*['"]system['"]/u);
  });

  it('locks unsupported providers without fallback and preserves the draft', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');

    expect(source.includes('Không hỗ trợ Tối Thượng'), 'labels unsupported providers').toBe(true);
    expect(/AG_PROXY_PROFILE_ID/u.test(source), 'allows only the fixed AG proxy profile').toBe(true);
    expect(/PROVIDERS\.GEMINI_DIRECT/u.test(source), 'allows Gemini Direct for supported turns').toBe(true);
    expect(/CHAT_MODES\.SUPREME[\s\S]+disabled/u.test(source), 'disables unsupported composer routes').toBe(true);
    expect(/CHAT_MODES\.SUPREME[\s\S]{0,500}(fallback|setPreferredProvider)/iu.test(source)).toBe(false);
  });

  it('fails closed for image uploads when the active runtime cannot accept them', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');
    const client = readPlannedFile('src/services/ai/supremeChatClient.js');

    expect(client).toContain('/api/supreme-chat-capabilities');
    expect(source).toContain('supremeCapabilities.images');
    expect(source).toContain('Ảnh Tối Thượng chưa hỗ trợ trên runtime này');
    expect(source).toMatch(/supremeCapabilities\.images[\s\S]+return false/u);
  });
});

describe('Supreme thread persistence and leak prevention', () => {
  it('normalizes imported Supreme threads to an empty system prompt', async () => {
    const persistence = await importPlannedModule('src/services/ai/supremeThreadPersistence.js');
    if (!persistence) return;

    expect(persistence.normalizeSupremeThreadForPersistence({
      id: 10,
      chat_mode: 'supreme',
      system_prompt: 'ATTACKER-SUPPLIED-PROMPT',
      systemPrompt: 'ATTACKER-SUPPLIED-ALTERNATE-PROMPT',
      system_prompt_customized: true,
      promptRevision: 9,
      canary: 'SF-CANARY-LEAK',
      encryptionMetadata: { keyVersion: 1 },
    })).toEqual({
      id: 10,
      chat_mode: 'supreme',
      system_prompt: '',
      system_prompt_customized: false,
    });
  });

  it('preserves full text, messages, files, and images while removing prompt secrets', async () => {
    const persistence = await importPlannedModule('src/services/ai/supremeThreadPersistence.js');
    if (!persistence) return;

    const exported = persistence.sanitizeSupremeThreadExport({
      id: 10,
      chat_mode: 'supreme',
      system_prompt: 'SECRET',
      canary: 'SF-CANARY-LEAK',
      promptRevision: 3,
      messages: [
        { role: 'user', content: 'Câu hỏi đầy đủ' },
        { role: 'assistant', content: 'Câu trả lời đầy đủ' },
      ],
      attachments: [
        { kind: 'document_context', fileName: 'truyen.pdf', chunks: [{ text: 'Nội dung tệp' }] },
        { kind: 'image', fileName: 'anh.png', turnOnly: false },
      ],
    });

    expect(exported.chat_mode).toBe('supreme');
    expect(exported.system_prompt).toBe('');
    expect(exported.messages).toHaveLength(2);
    expect(exported.attachments).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain('SECRET');
    expect(JSON.stringify(exported)).not.toContain('SF-CANARY');
    expect(JSON.stringify(exported)).not.toContain('promptRevision');
  });

  it('keeps Free and Story behavior on their existing streaming path', () => {
    const source = read('src/pages/ProjectChat/ProjectChat.jsx');

    expect(source).toContain('aiService.send');
    expect(source).toMatch(/stream\s*:\s*true/u);
    expect(source).toContain('buildFreeSystemPrompt');
    expect(source).toContain('buildStorySystemPrompt');
  });
});
