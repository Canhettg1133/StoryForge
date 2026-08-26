import { wrap } from 'comlink';

let worker = null;
let workerApi = null;

function getWorkerApi() {
  if (typeof Worker === 'undefined') {
    throw new Error('Trình duyệt này không hỗ trợ Web Worker.');
  }
  if (!workerApi) {
    worker = new Worker(new URL('./localAnalysisWorker.js', import.meta.url), { type: 'module' });
    workerApi = wrap(worker);
  }
  return workerApi;
}

export async function analyzeWithLocalWorker(input) {
  return getWorkerApi().analyze(input);
}

export function disposeLocalAnalysisWorker() {
  worker?.terminate();
  worker = null;
  workerApi = null;
}
