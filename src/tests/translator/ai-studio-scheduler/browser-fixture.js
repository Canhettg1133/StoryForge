// Dev-only fixture: real UI/engine, synthetic credentials, memory-only storage and mocked Google.
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const memoryStorage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key), clear: () => values.clear() };
};
Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
Object.defineProperty(window, 'indexedDB', { value: indexedDB });
Object.defineProperty(window, 'IDBKeyRange', { value: IDBKeyRange });
localStorage.setItem('novelTranslatorProSettings', JSON.stringify({
    apiKeys: ['FAKE-KEY-0', 'FAKE-KEY-1', 'FAKE-KEY-2', 'FAKE-KEY-3'],
    parallelCount: '30', rpmPerKey: '15', chunkSize: '1000', customPrompt: '', activeTranslatorTemplateId: 'convert',
    useProxy: false, activeTranslatorProvider: 'gemini_direct', aiStudioScheduler: { enabled: false, parallelCount: 60 },
}));

const realFetch = window.fetch.bind(window);
const originTime = Date.now();
let elapsed = 0;
Date.now = () => originTime + elapsed;
const requests = [];
const render = () => {
    const output = document.getElementById('fixtureLog');
    if (output) output.textContent = JSON.stringify({ seconds: elapsed / 1000, calls: requests.length,
        perKey: [0, 1, 2, 3].map(key => requests.filter(request => request.key === key).length),
        sends: requests.map(({ key, at }) => `${key + 1}@${at / 1000}`).join(', ') });
};
window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.hostname === 'generativelanguage.googleapis.com') {
        if (!url.pathname.includes(':generateContent')) {
            return Promise.resolve(new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })));
        }
        return new Promise((resolve, reject) => {
            const request = { key: Number(url.searchParams.get('key')?.match(/\d+$/)?.[0]), at: elapsed, pending: true,
                finish() {
                    if (!request.pending) return;
                    request.pending = false;
                    resolve(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Bản dịch kiểm thử bằng tiếng Việt, không dùng quota thật. '.repeat(40) }] } }] })));
                } };
            options.signal?.addEventListener('abort', () => { request.pending = false; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
            requests.push(request); render();
        });
    }
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) {
        return Promise.reject(new Error('Fixture blocks external APIs'));
    }
    return realFetch(input, options);
};
window.mountSchedulerFixture = () => {
    // Test access snapshot only; no production authentication or access code is replaced.
    window.postMessage({ type: 'STORYFORGE_ACCESS_CONTEXT', access: { features: {
        'translator.access': { allowed: true }, 'translator.parallel_high': { allowed: true },
    } } }, location.origin);
    const controls = document.createElement('aside');
    controls.style.cssText = 'position:sticky;top:0;z-index:9999;background:#fff;color:#111;padding:10px;font:14px system-ui';
    controls.innerHTML = '<strong>KIỂM THỬ — dữ liệu giả, không gọi Google thật</strong> '
        + '<button id="fixtureSeed">Nạp truyện mẫu</button> <button id="fixtureAdvance10">+10 giây</button> '
        + '<button id="fixtureAdvance45">+45 giây</button> <button id="fixtureRespond">Trả kết quả giả</button>'
        + '<output id="fixtureLog" style="display:block;overflow-wrap:anywhere;max-height:65px;overflow:auto"></output>';
    document.body.prepend(controls);
    document.getElementById('fixtureSeed').onclick = () => {
        const source = document.getElementById('originalText');
        source.value = Array.from({ length: 100 }, (_, index) => `Chương ${index + 1}\n${'Nội dung truyện giả lập để kiểm tra lịch chạy. '.repeat(25)}`).join('\n\n');
        source.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const advance = milliseconds => { elapsed += milliseconds; window.AiStudioScheduler.activeRun?.wake(); render(); };
    document.getElementById('fixtureAdvance10').onclick = () => advance(10000);
    document.getElementById('fixtureAdvance45').onclick = () => advance(45000);
    document.getElementById('fixtureRespond').onclick = () => requests.slice().reverse().forEach(request => request.finish());
    render();
};
const html = await (await realFetch('/translator-runtime/index.html')).text();
document.open();
document.write(html.replace('<head>', '<head><base href="/translator-runtime/">')
    .replace('</body>', '<script>addEventListener("DOMContentLoaded",window.mountSchedulerFixture,{once:true})</script></body>'));
document.close();
