import { afterEach, describe, expect, it } from 'vitest';
import { engineRuntime } from './engine-harness.js';
import { flush } from './harness.js';
import vm from 'node:vm';
let r, job;
async function settle() { for(let i=0;i<10;i++) await flush(); }
afterEach(async()=>{r?.cancel();await job;await r?.close();document.body.innerHTML='';});
describe('Real translation engine with AI Studio scheduling',()=>{
    it.each([false,true])('dispatches 60 and preserves ordered checkpoints (large=%s)',async large=>{
        r=engineRuntime({large,count:60,parallel:60,rpm:15,keyCount:4});job=r.start();await settle();
        expect(r.toasts).toEqual([]);
        expect(r.requests).toHaveLength(15);
        await r.advance(10000);expect(r.requests).toHaveLength(30);
        await r.advance(10000);expect(r.requests).toHaveLength(45);
        await r.advance(10000);expect(r.requests).toHaveLength(60);
        r.requests.slice(1).reverse().forEach(request=>request.finish());await settle();
        expect(r.checkpoints.every(index=>index===0)).toBe(true);
        r.requests[0].finish();await job;
        expect(r.outputs.size).toBe(60);expect(r.checkpoints.at(-1)).toBe(60);
        expect(r.checkpoints).toEqual([...r.checkpoints].sort((a,b)=>a-b));
        expect(r.ns.activeRun).toBeNull();
        expect(document.getElementById('translatedText').value.indexOf('Kết quả số 0')).toBeLessThan(document.getElementById('translatedText').value.indexOf('Kết quả số 1'));
    });
    it('uses 60 for enhanced Direct estimates without raising legacy providers above 30',()=>{
        r=engineRuntime({count:1,parallel:60,rpm:15,keyCount:4});
        expect(vm.runInContext(`resolveEffectiveTranslationParallel({
            requestedParallel:60,useProxyMode:false,useOllamaMode:false
        })`,r.context)).toBe(60);
        expect(vm.runInContext(`resolveEffectiveTranslationParallel({
            requestedParallel:60,useProxyMode:true,useOllamaMode:false
        })`,r.context)).toBe(30);
        r.ns.settings.enabled=false;
        expect(vm.runInContext(`resolveEffectiveTranslationParallel({
            requestedParallel:60,useProxyMode:false,useOllamaMode:false
        })`,r.context)).toBe(30);
    });
    it('still applies the non-VIP limit before creating the new scheduler',async()=>{
        r=engineRuntime({vip:false,count:10});job=r.start();await flush();
        expect(r.toasts.filter(toast=>toast.kind==='error')).toEqual([]);
        expect(r.ns.activeRun.parallel).toBe(2);
        await r.advance(30000);expect(r.requests.length).toBeLessThanOrEqual(2);
    });
    it('counts restored chunks in the large-file 2P read-ahead window',async()=>{
        const persisted=Array.from({length:20},(_,i)=>({chunkIndex:i+1,status:'done',outputText:'Bản dịch đã lưu.'}));
        r=engineRuntime({large:true,count:30,parallel:2,persisted});job=r.start();await settle();
        expect(r.requests).toHaveLength(1);
        expect(r.reads.length).toBeLessThanOrEqual(4);
    });
    it('restores tracker status for already persisted chunks',async()=>{
        r=engineRuntime({large:true,count:30,parallel:2,persisted:[{chunkIndex:1,status:'done',outputText:'Đã lưu'}]});
        const restored=[];r.context.trackChunkSuccess=(index)=>restored.push(index);
        job=r.start();await settle();expect(restored).toContain(1);
    });
    it('pins the post-pass recovery to Direct too',async()=>{
        r=engineRuntime({count:1});
        r.context.translateChunkWithRetry=async()=>{vm.runInContext('useProxy=true;useOllama=true',r.context);throw new Error('OUTPUT_TOO_SHORT');};
        job=r.start();await settle();expect(r.requests).toHaveLength(1);
        r.requests[0].finish();await r.advance(1000);await job;
    });
    it('passes the run context to automatic correction, not a standalone run',async()=>{
        r=engineRuntime({count:1});let auditContext;
        r.context.runHanAuditAfterTranslation=async context=>{auditContext=context;};
        job=r.start();await settle();r.requests[0].finish();await job;
        expect(auditContext?.parallel).toBe(45);
    });
    it('does not announce completion when automatic correction reports a fatal error',async()=>{
        r=engineRuntime({count:1});
        r.context.runHanAuditAfterTranslation=async()=>({ok:false,error:new Error('Fatal correction failure')});
        job=r.start();await settle();r.requests[0].finish();await job;
        expect(r.toasts.some(toast=>toast.kind==='success')).toBe(false);
        expect(r.toasts.some(toast=>toast.kind==='error')).toBe(true);
    });
});
