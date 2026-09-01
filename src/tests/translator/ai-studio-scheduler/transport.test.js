import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, runtime } from './harness.js';
let r, run;
afterEach(async () => { await run?.close(); await r?.close(); });
function setup() {
    r = runtime({parallel:1,rpm:15,count:1});
    ['js/translation/request-contract.js','js/gemini/api.js','js/translation/retry.js','js/features/ai-studio-scheduler/run-adapter.js'].forEach(r.load);
    run = r.ns.createRun(1);
}
describe('Scheduled Direct transport', () => {
    it('pins routing through the retry entry point too',async()=>{
        setup(); let calls=0;
        r.context.fetch=async()=>{calls++;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Bản dịch tiếng Việt có dấu, rõ ràng.'}]}}]})};};
        vm.runInContext('useProxy=true; useOllama=true',r.context);
        await expect(r.context.translateChunkWithRetry('source',0,1,run)).resolves.toContain('Bản dịch');
        expect(calls).toBe(1);
    });
    it('commits only once immediately before fetch, and pins the provider', async () => {
        setup(); let atFetch;
        r.context.fetch = async (_url, options) => {
            atFetch = r.context.getTranslatorRpmRecentCount('gemini_direct',0);
            return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'Bản dịch tiếng Việt có dấu, rõ ràng.'}]}}]})};
        };
        vm.runInContext('useProxy = true',r.context);
        const result = await r.context.sendDirectTranslationAttempt({text:'source',kind:'main',schedulingContext:run,requestOptions:{skipValidation:true,cleanResponse:false}});
        expect(atFetch).toBe(1); expect(result.modelKeyPair.keyIndex).toBe(0);
        expect(r.context.getTranslatorRpmRecentCount('gemini_direct',0)).toBe(1);
    });
    it('holds the slot and can cancel while the response body is still pending', async () => {
        setup(); let calls = 0;
        r.context.fetch = async (_url, options) => {
            calls++;
            return {ok:true,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))};
        };
        const first = r.context.sendDirectTranslationAttempt({text:'source',schedulingContext:run}).catch(e=>e);
        await flush();
        const retry = r.context.sendDirectTranslationAttempt({text:'source',kind:'retry',schedulingContext:run}).catch(e=>e);
        await r.advance(65000); expect(calls).toBe(1);
        run.cancel(); expect((await first).message).toContain('TRANSLATION_CANCELLED'); await retry;
        await flush(); expect(run.scheduler.snapshot().inFlight).toBe(0);
    });
    it('times out a response body stalled after headers',async()=>{
        setup();
        r.context.fetch=async(_url,options)=>({ok:true,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))});
        const job=r.context.sendDirectTranslationAttempt({text:'source',schedulingContext:run}).catch(e=>e);
        await r.advance(120000);expect((await job).code).toBe('GEMINI_TIMEOUT');
        await flush();expect(run.scheduler.snapshot().inFlight).toBe(0);
    });
    it('discards a successful late callback after cancellation',async()=>{
        setup();let complete;
        const job=run.scheduleAttempt({kind:'main'},async(_pair,options)=>{
            options.onDirectDispatch();return new Promise(resolve=>{complete=resolve;});
        }).catch(e=>e);
        await flush();run.cancel();complete('late output');
        expect((await job).message).toContain('TRANSLATION_CANCELLED');
    });
});
