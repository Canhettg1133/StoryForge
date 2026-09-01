import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export async function flush() {
    for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

export function runtime({ parallel = 45, rpm = 15, count = 3 } = {}) {
    let now = 100000;
    let timerId = 0;
    const timers = new Map();
    const requests = [];
    const jobs = [];
    class RuntimeDate extends Date { static now() { return now; } }
    const context = vm.createContext({
        Date: RuntimeDate, AbortController, URL, queueMicrotask,
        console: { log() {}, warn() {}, error() {} },
        document: { addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
        localStorage: { getItem() { return null; }, setItem() {} },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout(id) { timers.delete(id); },
    });
    const load = file => vm.runInContext(fs.readFileSync(path.join(process.cwd(), 'public/translator-runtime', file), 'utf8'), context, { filename: file });
    ['js/app.js', 'js/translation/errors.js', 'js/gemini/model-rotation.js'].forEach(load);
    ['config', 'allocation', 'clock', 'attempt-gate', 'scheduler'].forEach(name => load(`js/features/ai-studio-scheduler/${name}.js`));
    vm.runInContext(`apiKeys = Array.from({length:${count}}, (_, i) => 'FAKE-KEY-' + i); rpmPerKey = ${rpm}; useProxy = false; useOllama = false; GEMINI_MODELS = [{name:'test-model',enabled:true}];`, context);
    vm.runInContext("storyForgeAccessSnapshot = {features:{'translator.access':{allowed:true},'translator.parallel_high':{allowed:true}}}", context);
    const ns = context.AiStudioScheduler;
    const keys = vm.runInContext("apiKeys.map((key,keyIndex) => ({key,keyIndex,model:'test-model'}))", context);
    const gate = ns.createAttemptGate(keys);
    const scheduler = ns.createScheduler({ parallel, rpm, keys, gate, clock: ns.createClock() });
    const enqueue = (kind = 'main', pending = false) => {
        const job = scheduler.enqueue({ kind, run: async lease => {
            lease.commit();
            const request = { keyIndex: lease.pair.keyIndex, at: now, kind, pending };
            requests.push(request);
            if (pending) await new Promise((resolve, reject) => {
                request.finish = resolve;
                lease.signal.addEventListener('abort', () => reject(new Error('TRANSLATION_CANCELLED')), { once: true });
            });
            return request;
        }});
        jobs.push(job.catch(error => error));
        return job;
    };
    return {
        context, ns, scheduler, gate, requests, keys, load, enqueue,
        get now() { return now; },
        counts() { return keys.map(key => requests.filter(r => r.keyIndex === key.keyIndex).length); },
        enqueueMany(n, kind = 'main', pending = false) { for (let i = 0; i < n; i++) enqueue(kind, pending); },
        async advance(ms) {
            await flush();
            const target = now + ms;
            let guard = 0;
            while (true) {
                const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                if (++guard > 20000) throw new Error('Timer spin');
                now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
            }
            now = target; await flush();
        },
        async resumeAfter(ms) {
            await flush(); now += ms;
            const due = [...timers].filter(([, timer]) => timer.at <= now);
            due.forEach(([id, timer]) => { timers.delete(id); timer.callback(); });
            await flush();
        },
        async close() { scheduler.cancel(); await Promise.all(jobs); await flush(); scheduler.dispose(); },
    };
}
