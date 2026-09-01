import { afterEach, expect, it } from 'vitest';
import { runtime } from './harness.js';
let r;
afterEach(async()=>{await r?.close();});
it('does not convert a fatal run error into an ordinary Han issue',async()=>{
    r=runtime();r.load('js/translation/han-audit.js');
    const fatal=Object.assign(new Error('All keys invalid'),{code:'INVALID_API_KEY',retryable:false});
    r.context.getHanAuditChunkContent=async()=>({sourceText:'source'});
    r.context.buildHanCorrectionRequest=text=>text;
    r.context.translateChunkWithRetry=async()=>{throw fatal;};
    await expect(r.context.correctHanAuditIssue({chunkIndex:0},{check(){throw fatal;}})).rejects.toBe(fatal);
});
