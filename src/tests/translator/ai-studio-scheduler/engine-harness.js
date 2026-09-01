import vm from 'node:vm';
import { runtime } from './harness.js';

export function engineRuntime({large = false, count = 90, vip = true, parallel = 45, rpm = 15, keyCount = 3, persisted = []} = {}) {
    const r = runtime({parallel, rpm, count:keyCount});
    const reads = [];
    const outputs = new Map();
    const checkpoints = [];
    const requests = [];
    const toasts = [];
    const chunks = Array.from({length:count},(_,index)=>`TEST_CHUNK_${index}\n${'Nội dung tiếng Việt có dấu. '.repeat(30)}`);
    document.body.innerHTML = '<textarea id="originalText">source</textarea><textarea id="customPrompt"></textarea><textarea id="translatedText"></textarea>'
        + `<input id="sourceLang" value="auto"><input id="chunkSize" value="1000"><input id="parallelCount" value="${parallel}"><input id="rpmPerKey" value="${rpm}">`
        + '<button id="translateBtn"></button><button id="pauseBtn"></button><button id="cancelBtn"></button>'
        + '<section id="progressSection"></section><section id="resultSection"></section><div id="cancelModal"></div>';
    document.getElementById('resultSection').scrollIntoView = () => {};
    Object.assign(r.context, {
        document, sleep:async()=>{}, waitWhilePaused:async()=>{}, splitTextIntoChunks:()=>chunks,
        updateProgress(){},updateProgressStats(){},updateLargeFileProgress(){},updateStats(){},formatTime:()=>'',
        showToast:(message,kind)=>toasts.push({message,kind}), addToHistory:()=> 'test-history', updateHistoryProgress(){},
        getTranslatorSessionChunks:async()=>persisted,
        persistTranslatorChunkBatch:async(_session,rows,patch)=>{
            rows.forEach(row=>outputs.set(row.chunkIndex,row.outputText)); checkpoints.push(patch.resumeChunkIndex);
            return {session:{id:'test-session',...patch}};
        },
        updateTranslatorSession:async(_id,patch)=>({id:'test-session',...patch}),
        createLazyChunkReader:async function* () { for(let index=0;index<count;index++) { reads.push(index); yield {index,text:chunks[index],byteStart:index*100,byteEnd:(index+1)*100}; } },
        fetch:(_url,options)=>new Promise((resolve,reject)=>{
            const index=Number(JSON.parse(options.body).contents[0].parts[0].text.match(/TEST_CHUNK_(\d+)/)[1]);
            const keyIndex=Number(new URL(_url).searchParams.get('key').match(/\d+$/)[0]);
            const request={index,keyIndex,at:r.now,pending:true,finish(){
                if(!request.pending)return;request.pending=false;
                resolve({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:`Kết quả số ${index}. ${'Bản dịch tiếng Việt rõ ràng và có dấu. '.repeat(40)}`}]}}]})});
            }};
            options.signal.addEventListener('abort',()=>{request.pending=false;reject(new DOMException('aborted','AbortError'));},{once:true});
            requests.push(request);
        }),
    });
    ['js/translation/request-contract.js','js/gemini/api.js','js/translation/retry.js','js/features/ai-studio-scheduler/run-adapter.js','js/translation/engine.js'].forEach(r.load);
    r.ns.settings.enabled=true;
    vm.runInContext("setActiveTranslatorTemplateId('convert')",r.context);
    vm.runInContext(`storyForgeAccessSnapshot.features['translator.parallel_high'].allowed = ${vip}; currentTranslatorSessionId='test-session'; currentTranslatorSessionMeta={id:'test-session',totalChunks:${count}};`,r.context);
    if(large) vm.runInContext(`currentSourceMode=TRANSLATOR_SOURCE_MODES.LARGE_FILE; currentSourceFile={size:${count*100}};`,r.context);
    return {...r, outputs,checkpoints,requests,toasts,reads,
        start:()=>r.context.startTranslation(),
        cancel(){vm.runInContext('cancelRequested=true',r.context);r.ns.activeRun?.cancel();},
    };
}
