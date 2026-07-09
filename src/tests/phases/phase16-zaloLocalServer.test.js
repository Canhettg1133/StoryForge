import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildZaloDemoReceiptSvg,
  createZaloLocalServer,
  normalizeVietnameseMobilePhone,
  parseOpenZcaJson,
  selectSingleOpenZcaUser,
} from '../../../tools/zalo-local-server/server.mjs';

function makeRunner(handler) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    return handler(args);
  };
  runner.calls = calls;
  return runner;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function waitForIdle(baseUrl) {
  for (let i = 0; i < 150; i += 1) {
    const response = await fetch(`${baseUrl}/api/zalo/status`);
    const body = await response.json();
    if (!body.queue.running) return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('queue did not become idle');
}

describe('Zalo local OpenZCA server contracts', () => {
  const servers = [];
  const tempDirs = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await close(servers.pop());
    }
    while (tempDirs.length > 0) {
      await fs.rm(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  async function makeTempDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zalo-receipts-'));
    tempDirs.push(dir);
    return dir;
  }

  function makeReceiptBrowser(handler = {}) {
    const browser = {
      captures: [],
      opened: false,
      async getStatus() {
        return handler.status || {
          available: true,
          browserOpen: browser.opened,
          loggedInLikely: browser.opened,
          message: browser.opened ? 'Zalo Web receipt browser đang mở.' : 'Zalo Web receipt browser chưa mở.',
        };
      },
      async open() {
        browser.opened = true;
        return browser.getStatus();
      },
      async captureReceipt(input) {
        browser.captures.push(input);
        if (handler.captureReceipt) return handler.captureReceipt(input);
        throw new Error('captureReceipt handler missing');
      },
    };
    return browser;
  }

  it('normalizes only valid Vietnamese mobile numbers', () => {
    expect(normalizeVietnameseMobilePhone('+84 912 345 678')).toBe('0912345678');
    expect(normalizeVietnameseMobilePhone('0912.345.678')).toBe('0912345678');
    expect(normalizeVietnameseMobilePhone('0123456789')).toBe('');
  });

  it('selects one OpenZCA user and rejects ambiguous candidates', () => {
    const single = selectSingleOpenZcaUser(
      parseOpenZcaJson('{"users":[{"userId":"123","displayName":"Lan"}]}'),
      '0912345678',
    );
    expect(single.userId).toBe('123');

    expect(() =>
      selectSingleOpenZcaUser(
        parseOpenZcaJson('[{"userId":"123"},{"userId":"456"}]'),
        '0912345678',
      ),
    ).toThrow(/nhiều/i);
  });

  it('resolves a phone and sends exactly the compiled text with --raw', async () => {
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth') return { stdout: 'logged in', stderr: '' };
      if (args[0] === 'friend') return { stdout: '{"users":[{"userId":"user_123"}]}', stderr: '' };
      if (args[0] === 'msg') return { stdout: '{"success":true}', stderr: '' };
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({ commandRunner: runner, defaultDelayMs: 0, receiptRenderer: null });
    servers.push(server);
    const baseUrl = await listen(server);

    const start = await fetch(`${baseUrl}/api/zalo/queue/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delaySec: 0,
        queue: [
          {
            id: 'lead_1',
            name: 'Lan',
            phone: '0912 345 678',
            source: 'FB Tour',
            message: 'Chao Lan\nDung noi dung nay',
          },
        ],
      }),
    });

    expect(start.status).toBe(202);
    const status = await waitForIdle(baseUrl);
    expect(status.queue.items[0]).toMatchObject({
      id: 'lead_1',
      phone: '0912345678',
      status: 'SUCCESS',
      userId: 'user_123',
    });
    expect(runner.calls).toContainEqual([
      'friend',
      'find',
      '--json',
      '0912345678',
    ]);
    expect(runner.calls).toContainEqual([
      'msg',
      'send',
      'user_123',
      'Chao Lan\nDung noi dung nay',
      '--raw',
    ]);
  });

  it('builds a demo receipt SVG with a subtle synthetic marker and the real Zalo name', () => {
    const svg = buildZaloDemoReceiptSvg({
      name: 'Fallback Lead',
      zaloName: 'Lan Tour Zalo',
      phone: '0912345678',
      message: 'Chào chị\nLink tham gia nhóm: https://zalo.me/g/faptpg490',
      completedAt: '2026-06-29T12:39:00.000Z',
    });

    expect(svg).toContain('Mô phỏng');
    expect(svg).not.toContain('>DEMO<');
    expect(svg).toContain('Lan Tour Zalo');
    expect(svg).not.toContain('Fallback Lead</text>');
    expect(svg).toContain('https://zalo.me/g/faptpg490');
    expect(svg).toContain('width="916"');
    expect(svg).toContain('height="2047"');
  });

  it('uses bitmap assets for the mobile header and Zalo group preview', () => {
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message: 'Link tham gia nhom:\nhttps://zalo.me/g/faptpg490',
      completedAt: '2026-06-29T12:39:00.000Z',
    });

    const embeddedImages = svg.match(/<image /g) || [];
    expect(embeddedImages.length).toBeGreaterThanOrEqual(2);
    expect(svg).not.toContain('fill="#0c6be8"');
  });

  it('renders Zalo group links in blue and keeps the preview close to the link text', () => {
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message: 'Link tham gia nhom:\nhttps://zalo.me/g/faptpg490',
      completedAt: '2026-06-29T12:39:00.000Z',
    });

    const previewY = Number(svg.match(/data-demo-preview-y="(\d+)"/)?.[1]);
    const linkLineY = Number(svg.match(/data-demo-link-line-y="(\d+)"/)?.[1]);
    expect(svg).toContain('data-demo-link-text="true"');
    expect(svg).toContain('fill="#0068d9"');
    expect(previewY - linkLineY).toBeGreaterThan(50);
    expect(previewY - linkLineY).toBeLessThan(95);
  });

  it('matches the sample mobile input bar assets and aligns status time with sent time', () => {
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message: 'Tin test',
      completedAt: '2026-06-29T13:21:00.000Z',
    });

    const embeddedImages = svg.match(/<image /g) || [];
    expect(embeddedImages.length).toBeGreaterThanOrEqual(3);
    expect(svg).toContain('data-demo-input-bar="bitmap"');
    expect(svg).toContain('data-demo-heart="bitmap"');
    expect(svg).toContain('data-demo-heart-clip="circle"');
    expect(svg).toContain('data-demo-share="bitmap"');
    expect(svg).toContain('data-demo-share-clip="circle"');
    expect(svg).toContain('data-demo-sent-status="bitmap"');
    expect(svg).toContain('data-demo-sent-status-clip="round"');
    expect(svg).toContain('data-demo-status-time="20:21"');
  });

  it('renders yellow hand emoji from the sample asset instead of a dark font fallback', () => {
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message: 'Nội dung test nha ạ 🫶',
      completedAt: '2026-06-29T13:21:00.000Z',
    });

    expect(svg).toContain('data-demo-yellow-hand="bitmap"');
    expect(svg).toContain('data-demo-yellow-hand-line="true"');
    expect(svg).not.toContain('🫶</tspan>');
  });

  it('keeps the sent status close to the input bar like the Zalo mobile sample', () => {
    const message = [
      'Chào anh/chị ạ 🌿',
      'Bên em hiện có một nhóm cộng đồng du lịch Đà Nẵng dành cho mọi người giao lưu, chia sẻ kinh nghiệm và kết nối du lịch.',
      'Rất mong được chào đón anh/chị vào nhóm để cùng nhau giao lưu và phát triển cộng đồng ✨',
      'Link tham gia nhóm:\nhttps://zalo.me/g/faptpg490',
    ].join('\n\n');
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message,
      completedAt: '2026-06-29T13:21:00.000Z',
    });

    const sentStatusY = Number(svg.match(/data-demo-sent-status="bitmap"[^>]* y="(\d+)"/)?.[1]);
    expect(sentStatusY).toBeGreaterThanOrEqual(1760);
    expect(sentStatusY).toBeLessThanOrEqual(1820);
  });

  it('keeps the message bubble close under the add-friend bar', () => {
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message: 'Tin test\nhttps://zalo.me/g/faptpg490',
      completedAt: '2026-06-29T13:21:00.000Z',
    });

    const bubbleY = Number(svg.match(/data-demo-bubble-y="(\d+)"/)?.[1]);
    expect(bubbleY).toBeGreaterThanOrEqual(312);
    expect(bubbleY).toBeLessThanOrEqual(330);
  });

  it('does not leave a large empty blue area inside short demo message bubbles', () => {
    const svg = buildZaloDemoReceiptSvg({
      zaloName: 'Vu Nhat Anh',
      message: 'Tin ngắn 🫶\nLink tham gia nhóm:\nhttps://zalo.me/g/faptpg490',
      completedAt: '2026-06-29T13:21:00.000Z',
    });

    const bubbleY = Number(svg.match(/data-demo-bubble-y="(\d+)"/)?.[1]);
    const bubbleHeight = Number(svg.match(/data-demo-bubble-height="(\d+)"/)?.[1]);
    const previewY = Number(svg.match(/data-demo-preview-y="(\d+)"/)?.[1]);
    const xemThongTinY = previewY + 363;
    expect((bubbleY + bubbleHeight) - xemThongTinY).toBeGreaterThan(20);
    expect((bubbleY + bubbleHeight) - xemThongTinY).toBeLessThan(85);
  });

  it('creates a Zalo-style demo PNG receipt after a successful send', async () => {
    const receiptsDir = await makeTempDir();
    const recentMessage = 'Chao Lan\nDung noi dung that';
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth') return { stdout: 'logged in', stderr: '' };
      if (args[0] === 'friend') return { stdout: '{"users":[{"userId":"user_123","displayName":"Lan Tour"}]}', stderr: '' };
      if (args[0] === 'msg' && args[1] === 'send') return { stdout: '{ success: true }', stderr: '' };
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({
      commandRunner: runner,
      defaultDelayMs: 0,
      receiptsDir,
    });
    servers.push(server);
    const baseUrl = await listen(server);

    await fetch(`${baseUrl}/api/zalo/queue/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delaySec: 0,
        queue: [{
          id: 'lead:bad/name',
          name: 'Lan Tour',
          phone: '0912 345 678',
          source: 'FB Tour',
          message: recentMessage,
        }],
      }),
    });

    const status = await waitForIdle(baseUrl);
    const item = status.queue.items[0];
    expect(item).toMatchObject({
      status: 'SUCCESS',
      zaloName: 'Lan Tour',
      receiptCreatedAt: expect.any(String),
      receiptUrl: expect.stringMatching(/^\/receipts\/\d{4}-\d{2}-\d{2}\/.+\.png$/),
      receiptKind: 'zalo-demo-render',
      receiptVerifiedBy: 'openzca-send-success',
      receiptRecentVerified: false,
    });
    expect(item.receiptPath).not.toMatch(/[\\:]|\.\./);
    expect(runner.calls.some((args) => args[0] === 'msg' && args[1] === 'recent')).toBe(false);

    const absoluteReceiptPath = path.join(receiptsDir, item.receiptPath);
    const png = await fs.readFile(absoluteReceiptPath);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const metadata = await sharp(png).metadata();
    expect(metadata.width).toBe(916);
    expect(metadata.height).toBe(2047);

    const receiptResponse = await fetch(`${baseUrl}${item.receiptUrl}`);
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.headers.get('content-type')).toContain('image/png');
  });

  it('does not create a demo receipt when OpenZCA does not return the real Zalo name', async () => {
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth') return { stdout: 'logged in', stderr: '' };
      if (args[0] === 'friend') return { stdout: '{"users":[{"userId":"user_123"}]}', stderr: '' };
      if (args[0] === 'msg' && args[1] === 'send') return { stdout: '{"success":true}', stderr: '' };
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({
      commandRunner: runner,
      defaultDelayMs: 0,
    });
    servers.push(server);
    const baseUrl = await listen(server);

    await fetch(`${baseUrl}/api/zalo/queue/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delaySec: 0,
        queue: [{
          id: 'lead_1',
          name: 'Tên từ Facebook',
          phone: '0912345678',
          source: 'FB Tour',
          message: 'Chao test',
        }],
      }),
    });

    const status = await waitForIdle(baseUrl);
    expect(status.queue.items[0]).toMatchObject({
      status: 'SUCCESS',
      zaloName: '',
      receiptUrl: '',
      receiptError: expect.stringContaining('Không lấy được tên Zalo thật'),
    });
  });

  it('keeps a lead successful when receipt rendering fails', async () => {
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth') return { stdout: 'logged in', stderr: '' };
      if (args[0] === 'friend') return { stdout: '{"users":[{"userId":"user_123"}]}', stderr: '' };
      if (args[0] === 'msg') return { stdout: '{"success":true}', stderr: '' };
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({
      commandRunner: runner,
      defaultDelayMs: 0,
      receiptRenderer: async () => {
        throw new Error('render failed');
      },
    });
    servers.push(server);
    const baseUrl = await listen(server);

    await fetch(`${baseUrl}/api/zalo/queue/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delaySec: 0,
        queue: [{ id: 'lead_1', name: 'Lan', phone: '0912345678', message: 'Hello' }],
      }),
    });

    const status = await waitForIdle(baseUrl);
    expect(status.queue.items[0]).toMatchObject({
      status: 'SUCCESS',
      receiptError: 'render failed',
    });
    expect(status.queue.items[0].receiptUrl).toBe('');
  });

  it('reports Zalo Web receipt browser as disabled by default', async () => {
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth') return { stdout: 'logged in', stderr: '' };
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({ commandRunner: runner });
    servers.push(server);
    const baseUrl = await listen(server);

    const before = await fetch(`${baseUrl}/api/zalo-web/status`).then((res) => res.json());
    expect(before.receiptBrowser).toMatchObject({
      available: false,
      browserOpen: false,
      loggedInLikely: false,
    });

    const opened = await fetch(`${baseUrl}/api/zalo-web/open`, { method: 'POST' });
    expect(opened.status).toBe(410);
  });

  it('marks a lead failed when OpenZCA cannot resolve a unique user', async () => {
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth') return { stdout: 'logged in', stderr: '' };
      if (args[0] === 'friend') return { stdout: '[]', stderr: '' };
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({ commandRunner: runner, defaultDelayMs: 0 });
    servers.push(server);
    const baseUrl = await listen(server);

    await fetch(`${baseUrl}/api/zalo/queue/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delaySec: 0,
        queue: [{ id: 'lead_1', phone: '0912345678', message: 'Hello' }],
      }),
    });

    const status = await waitForIdle(baseUrl);
    expect(status.queue.items[0].status).toBe('FAILED');
    expect(status.queue.items[0].error).toMatch(/không tìm thấy/i);
    expect(runner.calls.some((args) => args[0] === 'msg')).toBe(false);
  });

  it('reports the logged-in Zalo account without exposing credential paths as fields', async () => {
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return {
          stdout: `{
  profile: 'default',
  loggedIn: true,
  userId: '124136449945644070',
  displayName: 'Trần Văn Đạt',
  credentialsPath: 'C:\\Users\\tranv\\.openzca\\profiles\\default\\credentials.json'
}`,
          stderr: '',
        };
      }
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({ commandRunner: runner, defaultDelayMs: 0 });
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/zalo/status`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.auth).toMatchObject({
      loggedIn: true,
      profile: 'default',
      userId: '124136449945644070',
      displayName: 'Trần Văn Đạt',
    });
    expect(body.auth).not.toHaveProperty('credentialsPath');
  });

  it('returns a QR data URL for UI login', async () => {
    const qrDataUrl = 'data:image/png;base64,QUJD';
    const runner = makeRunner(async (args) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        throw new Error('not logged in');
      }
      if (args[0] === 'auth' && args[1] === 'login' && args.includes('--qr-base64')) {
        return { stdout: `${qrDataUrl}\n`, stderr: '' };
      }
      throw new Error(`unexpected command ${args.join(' ')}`);
    });
    const { server } = createZaloLocalServer({ commandRunner: runner, defaultDelayMs: 0 });
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/zalo/auth/login-qr`, {
      method: 'POST',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, qrDataUrl });
    expect(runner.calls).toContainEqual(['auth', 'login', '--qr-base64']);
  });

  it('serves the dashboard HTML from the local server', async () => {
    const runner = makeRunner(async () => ({ stdout: 'logged in', stderr: '' }));
    const { server } = createZaloLocalServer({ commandRunner: runner, defaultDelayMs: 0 });
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/zalo-lead-connector.html`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('TravelLead Connect');
    expect(html).toContain('btn-zalo-login-qr');
  });
});
