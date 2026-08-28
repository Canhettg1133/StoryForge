import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const runtimeRoot = path.join(process.cwd(), 'public/translator-runtime');
const source = (file) => fs.readFileSync(path.join(runtimeRoot, file), 'utf8');

function loadFeature() {
    const context = vm.createContext({
        currentTranslatorSessionId: 'session-a',
        document,
        renderChunkRow() {},
    });
    for (const file of ['js/features/chunk-key-usage/state.js', 'js/features/chunk-key-usage/view.js']) {
        vm.runInContext(source(file), context, { filename: file });
    }
    return context;
}

const optionsFor = (chunkIndex, kind = 'main', partIndex) => ({ chunkKeyUsage: { chunkIndex, kind, partIndex } });
const fakeIdentity = (keyIndex = 0, provider = 'gemini_direct') => ({
    provider, model: 'test-model', keyIndex, key: `FAKE-SECRET-ONLY-FOR-TEST-${keyIndex}-abcd`,
});

async function callWith(context, chunkIndex, identity, kind = 'main', partIndex) {
    return context.withTranslatorChunkKeyUsage(optionsFor(chunkIndex, kind, partIndex), async (options) => {
        options.onChunkKeyUsage(identity);
        return 'Bản dịch thử';
    });
}

const translatedText = 'Bản dịch tiếng Việt hợp lệ, đủ dài và có dấu. '.repeat(90);
const apiResponse = () => ({
    ok: true, status: 200,
    json: async () => ({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: translatedText }] } }],
        choices: [{ message: { content: translatedText } }],
        message: { content: translatedText },
    }),
});

function loadRuntime(fetchImpl = async () => apiResponse()) {
    const elements = new Map();
    const stored = new Map();
    const context = vm.createContext({
        AbortController, TextDecoder, TextEncoder, URL, Blob, Date, setTimeout, clearTimeout,
        indexedDB: new IDBFactory(), IDBKeyRange,
        crypto: globalThis.crypto,
        console: { log() {}, warn() {}, error() {} },
        document: {
            addEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement: (tag) => document.createElement(tag),
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, document.createElement('input'));
                return elements.get(id);
            },
        },
        localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)) },
        fetch: fetchImpl,
        showToast() {},
        sleep: async () => {},
    });
    context.window = context;
    for (const file of [
        'js/app.js', 'js/translation/request-contract.js', 'js/translation/errors.js',
        'js/features/chunk-key-usage/state.js', 'js/features/chunk-key-usage/view.js',
        'js/gemini/model-rotation.js', 'js/gemini/api.js', 'js/translation/retry.js',
        'js/local-ai/ollama.js', 'js/ui/chunk-tracker.js',
        'js/translation/source-reader.js', 'js/translation/local-store.js',
    ]) vm.runInContext(source(file), context, { filename: file });
    vm.runInContext(`
        currentTranslatorSessionId = 'session-test';
        renderChunkRow = () => {};
        updateOllamaSpeed = () => {};
        useProxy = false; useOllama = false;
        proxyBaseUrl = 'http://localhost:8000/v1/chat/completions';
        proxyModel = 'proxy-test-model';
        proxyApiKeys = ['FAKE-TEST-KEY-ONE-1111', 'FAKE-TEST-KEY-TWO-2222'];
        proxyApiKey = proxyApiKeys[0];
        customProxyApiKeys = ['FAKE-CUSTOM-KEY-3333'];
        customProxyApiKey = customProxyApiKeys[0];
        customProxyProfile = { baseUrl: 'http://localhost:9000', defaultModel: 'custom-test', chatCompletionsPath: '/v1/chat/completions', transport: 'direct' };
        apiKeys = ['FAKE-DIRECT-KEY-4444'];
        waitForNextModelKeyPairWithQueue = async () => ({ model: 'gemini-test', key: apiKeys[0], keyIndex: 0 });
        document.getElementById('ollamaModel').value = 'local-test';
        document.getElementById('ollamaUrl').value = 'http://localhost:11434';
    `, context);
    return context;
}

describe('translator shared chunk key usage', () => {
    it('does not record an assigned key until the transport dispatches it', async () => {
        const context = loadFeature();
        await context.withTranslatorChunkKeyUsage(optionsFor(0), async () => 'no request');
        expect(context.getTranslatorChunkKeyUsage(0)).toBeNull();
        await callWith(context, 0, fakeIdentity(26));
        const usage = context.getTranslatorChunkKeyUsage(0);
        expect(usage.attempts[0]).toMatchObject({ keyIndex: 26, keySuffix: 'abcd', status: 'responded' });
        expect(JSON.stringify(usage)).not.toContain('FAKE-SECRET');
        expect(context.renderTranslatorChunkKeyBadge(0)).toContain('Key 27');
    });

    it('keeps a failed key and the actual rotated key, including split-part identity', async () => {
        const context = loadFeature();
        await expect(context.withTranslatorChunkKeyUsage(optionsFor(3), async (options) => {
            options.onChunkKeyUsage(fakeIdentity(0, 'ag_proxy'));
            throw new Error('HTTP 403');
        })).rejects.toThrow('HTTP 403');
        await callWith(context, 3, fakeIdentity(1, 'ag_proxy'), 'split_retry', 0);
        await callWith(context, 3, fakeIdentity(2, 'custom_proxy'), 'split_retry', 1);
        expect(context.getTranslatorChunkKeyUsage(3).attempts.map((entry) => [entry.keyIndex, entry.status, entry.partIndex]))
            .toEqual([[0, 'failed', null], [1, 'responded', 0], [2, 'responded', 1]]);
        const detail = context.renderTranslatorChunkKeyDetail(3);
        expect(detail).toContain('Key 1');
        expect(detail).toContain('Key 2');
        expect(detail).toContain('Key 3');
        expect(detail).toContain('Phần 2');
    });

    it('isolates concurrent chunks and snapshots key position before configuration changes', async () => {
        const context = loadFeature();
        const identity = fakeIdentity(1);
        let finish;
        const pending = context.withTranslatorChunkKeyUsage(optionsFor(0), async (options) => {
            options.onChunkKeyUsage(identity);
            await new Promise((resolve) => { finish = resolve; });
            return 'A';
        });
        identity.keyIndex = 8;
        identity.key = 'CHANGED';
        await callWith(context, 1, fakeIdentity(2));
        expect(context.getTranslatorChunkKeyUsage(0).attempts[0].status).toBe('pending');
        finish();
        await pending;
        expect(context.getTranslatorChunkKeyUsage(0).attempts[0].keyIndex).toBe(1);
        expect(context.getTranslatorChunkKeyUsage(1).attempts[0].keyIndex).toBe(2);
    });

    it('does not let a late response enter another session or a reset run', async () => {
        const context = loadFeature();
        let finish;
        const pending = context.withTranslatorChunkKeyUsage(optionsFor(0), async (options) => {
            options.onChunkKeyUsage(fakeIdentity(0));
            await new Promise((resolve) => { finish = resolve; });
        });
        context.currentTranslatorSessionId = 'session-b';
        context.resetTranslatorChunkKeyUsage();
        await callWith(context, 0, fakeIdentity(3));
        finish();
        await pending;
        expect(context.getTranslatorChunkKeyUsage(0).attempts.map((entry) => entry.keyIndex)).toEqual([3]);
    });

    it('excludes story-prompt and unscoped calls; represents Ollama without a fictitious key', async () => {
        const context = loadFeature();
        for (const options of [{}, optionsFor(0, 'story_prompt'), optionsFor(undefined)]) {
            await context.withTranslatorChunkKeyUsage(options, async (requestOptions) => {
                if (requestOptions.onChunkKeyUsage) requestOptions.onChunkKeyUsage(fakeIdentity());
            });
        }
        expect(context.getTranslatorChunkKeyUsage(0)).toBeNull();
        await callWith(context, 0, { provider: 'ollama', model: 'local-model', keyless: true });
        expect(context.renderTranslatorChunkKeyBadge(0)).toContain('Không dùng key');
        expect(context.renderTranslatorChunkKeyBadge(0)).not.toContain('Key 1');
    });

    it('handles repeated dispatch after relay auth refresh without inventing a success', async () => {
        const context = loadFeature();
        await context.withTranslatorChunkKeyUsage(optionsFor(0), async (options) => {
            options.onChunkKeyUsage(fakeIdentity(0, 'ag_proxy'));
            options.onChunkKeyUsage(fakeIdentity(0, 'ag_proxy'));
        });
        expect(context.getTranslatorChunkKeyUsage(0).attempts.map((entry) => entry.status))
            .toEqual(['retried', 'responded']);
    });

    it('keeps cancellation separate from failure and propagates the original error', async () => {
        const context = loadFeature();
        const error = new Error('TRANSLATION_CANCELLED');
        await expect(context.withTranslatorChunkKeyUsage(optionsFor(0, 'manual_retry'), async (options) => {
            options.onChunkKeyUsage(fakeIdentity());
            throw error;
        })).rejects.toBe(error);
        expect(context.getTranslatorChunkKeyUsage(0).attempts[0].status).toBe('cancelled');
    });

    it('bounds per-chunk storage, restores safely and never guesses legacy key identity', async () => {
        const context = loadFeature();
        for (let index = 0; index < 45; index += 1) await callWith(context, 0, fakeIdentity(index));
        const usage = context.getTranslatorChunkKeyUsage(0);
        expect(usage.attempts).toHaveLength(40);
        expect(usage.omitted).toBe(5);
        context.resetTranslatorChunkKeyUsage([{ chunkIndex: 0, keyUsage: usage }, { chunkIndex: 1, keyLabel: 'A' }]);
        expect(context.getTranslatorChunkKeyUsage(0)).toEqual(usage);
        expect(context.renderTranslatorChunkKeyBadge(1)).toContain('Chưa ghi nhận key');
        usage.attempts[0].keySuffix = 'FULL-SECRET-MUST-NOT-SURVIVE';
        usage.attempts[0].key = 'SECRET';
        usage.attempts[0].status = 'pending';
        context.resetTranslatorChunkKeyUsage([{ chunkIndex: 0, keyUsage: usage }]);
        const restored = context.getTranslatorChunkKeyUsage(0);
        expect(JSON.stringify(restored)).not.toContain('SECRET');
        expect(restored.attempts[0].status).toBe('interrupted');
    });

    it('escapes provider/model markup and hides short keys completely', async () => {
        const context = loadFeature();
        await callWith(context, 0, { provider: '<img src=x onerror=alert(1)>', model: '<script>bad()</script>', key: 'abc', keyIndex: 0 });
        const html = context.renderTranslatorChunkKeyDetail(0);
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('abc');
    });

    it('loads the shared feature before transports and keeps responsive styles separate', () => {
        const index = source('index.html');
        expect(index.indexOf('js/features/chunk-key-usage/state.js')).toBeLessThan(index.indexOf('js/gemini/api.js'));
        expect(index).toContain('css/features/chunk-key-usage.css');
        const css = source('css/features/chunk-key-usage.css');
        expect(css).toContain('@media (max-width: 768px)');
        expect(css).toContain('overflow-wrap: anywhere');
        expect(css).not.toMatch(/display:\s*none/);
    });

    it('refreshes only the badge in place without redrawing the tracker or losing keyboard focus', async () => {
        const context = loadFeature();
        let redraws = 0;
        context.renderChunkRow = () => { redraws += 1; };
        const row = document.createElement('div');
        row.id = 'chunk-row-0';
        row.innerHTML = context.renderTranslatorChunkKeyBadge(0);
        document.body.append(row);
        const button = row.querySelector('button');
        button.focus();
        try {
            await callWith(context, 0, fakeIdentity(1));
            expect(redraws).toBe(0);
            expect(button.textContent).toContain('Key 2');
            expect(document.activeElement).toBe(button);
        } finally {
            row.remove();
        }
    });

    it('shows only the latest key number on the row while retaining full detail inside', async () => {
        const context = loadFeature();
        await callWith(context, 0, fakeIdentity(0));
        await callWith(context, 0, fakeIdentity(1), 'retry');
        const row = document.createElement('div');
        row.innerHTML = context.renderTranslatorChunkKeyBadge(0);
        expect(row.textContent).toBe('Key 2');
        expect(row.querySelector('button').getAttribute('aria-label')).toContain('Lần gọi gần nhất');
        expect(context.renderTranslatorChunkKeyDetail(0)).toContain('Key 1');
        expect(context.renderTranslatorChunkKeyDetail(0)).toContain('Key 2');
    });

    it('uses a stable separate color for each key and updates it without replacing the button', async () => {
        const context = loadFeature();
        const colors = [];
        const row = document.createElement('div');
        row.id = 'chunk-row-0';
        row.innerHTML = context.renderTranslatorChunkKeyBadge(0);
        document.body.append(row);
        const button = row.querySelector('button');
        try {
            for (let keyIndex = 0; keyIndex < 40; keyIndex += 1) {
                await callWith(context, 0, fakeIdentity(keyIndex));
                expect(row.querySelector('button')).toBe(button);
                colors.push(button.style.getPropertyValue('--chunk-key-color'));
            }
            expect(colors.every(Boolean)).toBe(true);
            expect(new Set(colors).size).toBe(40);
            await callWith(context, 0, fakeIdentity(0, 'custom_proxy'));
            expect(button.style.getPropertyValue('--chunk-key-color')).toBe(colors[0]);
            await callWith(context, 0, { provider: 'ollama', model: 'local', keyless: true });
            expect(button.style.getPropertyValue('--chunk-key-color')).toBe('');
        } finally {
            row.remove();
        }
    });

    it('keeps the key label unboxed at the row end without reserving a full mobile line', () => {
        const css = source('css/features/chunk-key-usage.css');
        const badge = css.match(/\.ct-row \.chunk-key-usage__badge\s*\{([^}]+)\}/)[1];
        expect(badge).toContain('border: 0');
        expect(badge).toContain('background: transparent');
        expect(badge).toContain('flex: 0 0 auto');
        expect(badge).toContain('order: 9');
        expect(css).not.toContain('flex: 1 0 100%');
        expect(css).not.toContain('width: 100%');
        expect(css).toContain('html[data-theme="light"]');
        expect(css).toContain('html[data-theme="cream"]');
    });

    it('keeps every key hue readable against dark, light and cream row surfaces', () => {
        const css = source('css/features/chunk-key-usage.css');
        const lightness = [...css.matchAll(/--chunk-key-lightness:\s*(\d+)%/g)].map(match => Number(match[1]) / 100);
        const luminance = rgb => rgb
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        for (const [background, level] of [['#30303a', lightness[0]], ['#f1f5f9', lightness[1]], ['#eee8df', lightness[1]]]) {
            const bg = luminance(background.slice(1).match(/../g).map(part => parseInt(part, 16) / 255));
            for (let hue = 0; hue < 360; hue += 1) {
                const amplitude = 0.72 * Math.min(level, 1 - level);
                const fg = luminance([0, 8, 4].map(offset => {
                    const position = (offset + hue / 30) % 12;
                    return level - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1));
                }));
                expect((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it.each(['gemini_direct', 'ag_proxy', 'custom_proxy', 'ollama'])('records the actual %s transport credential and leaves the request body unchanged', async (provider) => {
        const requests = [];
        const context = loadRuntime(async (url, options) => {
            requests.push({ url, options });
            expect(context.getTranslatorChunkKeyUsage(7).attempts.at(-1).status).toBe('pending');
            return apiResponse();
        });
        vm.runInContext(`activeTranslatorProvider = '${provider}'; useProxy = ${provider.includes('proxy')}; useOllama = ${provider === 'ollama'};`, context);
        const result = await context.translateChunkWithRetry('Nguồn cần dịch. '.repeat(80), 7, 1);
        expect(result).toBe(translatedText.trim());
        const [entry] = context.getTranslatorChunkKeyUsage(7).attempts;
        const request = requests[0];
        expect(entry.provider).toBe(provider);
        expect(entry.status).toBe('responded');
        const body = JSON.parse(request.options.body);
        expect(body).not.toHaveProperty('chunkKeyUsage');
        expect(body).not.toHaveProperty('onChunkKeyUsage');
        const actualKey = provider === 'gemini_direct'
            ? new URL(request.url).searchParams.get('key')
            : request.options.headers.Authorization?.replace('Bearer ', '');
        if (provider === 'ollama') {
            expect(entry.keyless).toBe(true);
            expect(entry.keyIndex).toBeNull();
        } else {
            expect(entry.keySuffix).toBe(actualKey.slice(-4));
            expect(JSON.stringify(context.getTranslatorChunkKeyUsage(7))).not.toContain(actualKey);
        }
    });

    it('records real proxy rotation after HTTP 403, not the planned dispatch key', async () => {
        const usedKeys = [];
        const context = loadRuntime(async (_url, options) => {
            usedKeys.push(options.headers.Authorization);
            return usedKeys.length === 1
                ? { ok: false, status: 403, json: async () => ({ error: { message: 'CONSUMER_SUSPENDED' } }) }
                : apiResponse();
        });
        vm.runInContext("activeTranslatorProvider = 'ag_proxy'; useProxy = true;", context);
        await context.translateChunkWithRetry('Nguồn cần dịch. '.repeat(80), 5, 3);
        expect(usedKeys).toEqual(['Bearer FAKE-TEST-KEY-ONE-1111', 'Bearer FAKE-TEST-KEY-TWO-2222']);
        expect(context.getTranslatorChunkKeyUsage(5).attempts.map((entry) => [entry.keySuffix, entry.status]))
            .toEqual([['1111', 'failed'], ['2222', 'responded']]);
    });

    it('records each real split request and manual retry under the original chunk index', async () => {
        const context = loadRuntime();
        await context.translateLargeChunkBySplitting(('Nguồn cần dịch. '.repeat(20) + '\n').repeat(12), 9);
        const split = context.getTranslatorChunkKeyUsage(9).attempts;
        expect(split.length).toBeGreaterThan(1);
        expect(split.every((entry, index) => entry.kind === 'split_retry' && entry.partIndex === index)).toBe(true);
        await context.sendManualRetryAttempt(9, 'Nguồn cần dịch. '.repeat(80));
        expect(context.getTranslatorChunkKeyUsage(9).attempts.at(-1).kind).toBe('manual_retry');
        expect(context.getTranslatorChunkKeyUsage(0)).toBeNull();
    });

    it('does not pollute chunk 0 with story analysis or a separate Han-audit file', async () => {
        const context = loadRuntime();
        await context.sendDirectTranslationAttempt({ chunkIndex: 0, kind: 'story_prompt', text: 'Nguồn' });
        context.isHanFileAuditBusy = true;
        await context.translateChunkWithRetry('Nguồn cần dịch. '.repeat(80), 0, 1);
        expect(context.getTranslatorChunkKeyUsage(0)).toBeNull();
    });

    it('does not label a relay request cancelled before the batch was dispatched as a used key', async () => {
        let fetchCount = 0;
        const context = loadRuntime(async () => { fetchCount += 1; return apiResponse(); });
        vm.runInContext("useProxy = true; activeTranslatorProvider = 'ag_proxy'; proxyBaseUrl = 'https://proxy.example.test/v1/chat/completions';", context);
        const pending = context.translateChunkViaProxy('Nguồn cần dịch. '.repeat(80), 0.7, 'FAKE-TEST-KEY-ONE-1111', true, optionsFor(4));
        vm.runInContext("cancelRequested = true; abortActiveTranslationRequests('test-cancel');", context);
        await expect(pending).rejects.toThrow('TRANSLATION_CANCELLED');
        expect(fetchCount).toBe(0);
        expect(context.getTranslatorChunkKeyUsage(4)).toBeNull();
    });

    it('keeps relay metadata tied to its queued payload when provider settings change before flush', async () => {
        const context = loadRuntime();
        vm.runInContext("useProxy = true; activeTranslatorProvider = 'ag_proxy'; proxyBaseUrl = 'https://proxy.example.test/v1/chat/completions';", context);
        const pending = context.translateChunkViaProxy('Nguồn cần dịch. '.repeat(80), 0.7, 'FAKE-TEST-KEY-TWO-2222', true, optionsFor(4));
        expect(context.getTranslatorChunkKeyUsage(4)).toBeNull();
        vm.runInContext("activeTranslatorProvider = 'custom_proxy'; proxyApiKeys = []; proxyModel = 'changed';", context);
        await pending;
        expect(context.getTranslatorChunkKeyUsage(4).attempts[0]).toMatchObject({ provider: 'ag_proxy', keyIndex: 1, keySuffix: '2222', model: 'proxy-test-model' });
    });

    it('persists a redacted journal through IndexedDB batch/update and restores it without changing output', async () => {
        const context = loadRuntime();
        const file = new Blob(['Nguồn cần dịch.'], { type: 'text/plain' });
        file.name = 'test.txt';
        file.lastModified = 1;
        const session = await context.createTranslatorSessionFromFile(file, { chunkSize: 4500 });
        vm.runInContext(`currentTranslatorSessionId = ${JSON.stringify(session.id)};`, context);
        await context.sendManualRetryAttempt(2, 'Nguồn cần dịch. '.repeat(80));
        const usage = context.getTranslatorChunkKeyUsage(2);
        await context.persistTranslatorChunkBatch(session.id, [{ chunkIndex: 2, status: 'done', outputText: translatedText, ...context.getTranslatorChunkKeyUsagePatch(2) }]);
        await context.updateTranslatorChunkResult(session.id, 2, { outputText: 'Bản sửa thủ công' });
        const rows = await context.getTranslatorSessionChunks(session.id);
        expect(rows[0].keyUsage).toEqual(usage);
        expect(rows[0].outputText).toBe('Bản sửa thủ công');
        context.resetTranslatorChunkKeyUsage(rows);
        expect(context.getTranslatorChunkKeyUsage(2)).toEqual(usage);
        expect(JSON.stringify(rows)).not.toContain('FAKE-DIRECT-KEY');
    });

    it.each(['retry', 'han-correction'])('hydrates old large-file journals before %s without overwriting newer in-memory attempts', async (flow) => {
        const context = loadRuntime();
        const file = new Blob(['Nguồn cần dịch.'], { type: 'text/plain' });
        file.name = 'resume.txt';
        file.lastModified = 1;
        const session = await context.createTranslatorSessionFromFile(file, { chunkSize: 4500 });
        vm.runInContext(`currentTranslatorSessionId = ${JSON.stringify(session.id)};`, context);
        await context.sendManualRetryAttempt(0, 'Nguồn cần dịch. '.repeat(80));
        await context.persistTranslatorChunkBatch(session.id, [{ chunkIndex: 0, sourceText: 'Nguồn cần dịch.', status: 'failed', outputText: '[LỖI CHUNK 1]', ...context.getTranslatorChunkKeyUsagePatch(0) }]);
        context.resetTranslatorChunkKeyUsage();
        vm.runInContext(source('js/translation/han-audit.js'), context);
        const read = flow === 'retry'
            ? () => context.readIssueRetrySource({ chunkIndex: 0 }, 'large-file')
            : () => context.getHanAuditChunkContent(0);
        await read();
        expect(context.getTranslatorChunkKeyUsage(0)?.attempts).toHaveLength(1);
        await context.sendManualRetryAttempt(0, 'Nguồn cần dịch. '.repeat(80));
        await read();
        expect(context.getTranslatorChunkKeyUsage(0).attempts).toHaveLength(2);
    });
});
