/**
 * Novel Translator Pro - Worker-Based Timer
 * Giải quyết vấn đề trình duyệt throttle setTimeout khi tab bị ẩn (background).
 * 
 * Web Workers KHÔNG bị throttle, nên timer luôn chính xác dù user chuyển tab.
 */

// ============================================
// INLINE WEB WORKER (không cần file riêng)
// ============================================
const WORKER_BLOB = new Blob([`
    // Worker timer - Không bị throttle khi tab ẩn
    const timers = new Map();
    let nextId = 1;

    self.onmessage = function(e) {
        const { type, id, ms } = e.data;

        if (type === 'setTimeout') {
            const timerId = id || nextId++;
            const timer = setTimeout(() => {
                timers.delete(timerId);
                self.postMessage({ type: 'timeout', id: timerId });
            }, ms);
            timers.set(timerId, timer);
            self.postMessage({ type: 'timerCreated', id: timerId });
        }

        if (type === 'clearTimeout') {
            if (timers.has(id)) {
                clearTimeout(timers.get(id));
                timers.delete(id);
            }
        }

        if (type === 'clearAll') {
            timers.forEach(timer => clearTimeout(timer));
            timers.clear();
        }
    };
`], { type: 'application/javascript' });

let timerWorker = null;
let workerCallbacks = new Map();
let workerTimerId = 1;
let workerAvailable = false;

/**
 * Khởi tạo Worker Timer
 */
function initWorkerTimer() {
    try {
        const workerUrl = URL.createObjectURL(WORKER_BLOB);
        timerWorker = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);

        timerWorker.onmessage = function (e) {
            const { type, id } = e.data;
            if (type === 'timeout') {
                const callback = workerCallbacks.get(id);
                if (callback) {
                    workerCallbacks.delete(id);
                    callback();
                }
            }
        };

        // FIX: Thêm workerCallbacks.clear() để tránh memory leak khi Worker lỗi
        timerWorker.onerror = function (err) {
            console.warn('[WorkerTimer] Worker error, falling back to setTimeout:', err);
            workerAvailable = false;
            workerCallbacks.clear();
        };

        workerAvailable = true;
        console.log('✅ [WorkerTimer] Web Worker timer initialized - tab ẩn sẽ không bị chậm!');
    } catch (e) {
        console.warn('[WorkerTimer] Cannot create Web Worker, using fallback setTimeout:', e);
        workerAvailable = false;
    }
}

/**
 * setTimeout qua Web Worker (không bị throttle)
 * Fallback sang setTimeout thường nếu Worker không khả dụng
 */
function workerSetTimeout(callback, ms) {
    if (workerAvailable && timerWorker) {
        const id = workerTimerId++;
        workerCallbacks.set(id, callback);
        timerWorker.postMessage({ type: 'setTimeout', id, ms });
        return id;
    }
    // Fallback
    return setTimeout(callback, ms);
}

/**
 * clearTimeout qua Web Worker
 */
function workerClearTimeout(id) {
    if (workerAvailable && timerWorker) {
        workerCallbacks.delete(id);
        timerWorker.postMessage({ type: 'clearTimeout', id });
    } else {
        clearTimeout(id);
    }
}

/**
 * Sleep sử dụng Worker Timer - KHÔNG bị throttle khi tab ẩn!
 * FIX: Dùng Date.now() deadline thay vì elapsed += wait
 * → Nếu Worker/setTimeout bị delay, wall-clock vẫn luôn chính xác
 */
function sleep(ms) {
    const duration = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (duration === 0) return Promise.resolve();

    // Sử dụng Web Worker timer khi có thể
    if (workerAvailable && timerWorker) {
        return new Promise(resolve => {
            const deadline = Date.now() + duration; // FIX: dùng deadline tuyệt đối
            const stepMs = 200;

            const tick = () => {
                if (cancelRequested) return resolve();
                const remaining = deadline - Date.now(); // FIX: tính remaining từ wall-clock
                if (remaining <= 0) return resolve();

                const wait = Math.min(stepMs, remaining);
                const timerId = workerTimerId++;
                workerCallbacks.set(timerId, () => tick());
                timerWorker.postMessage({ type: 'setTimeout', id: timerId, ms: wait });
            };

            tick();
        });
    }

    // Fallback: dùng setTimeout thường (bị throttle khi tab ẩn)
    return new Promise(resolve => {
        const deadline = Date.now() + duration; // FIX: dùng deadline tuyệt đối
        const stepMs = 100;

        const tick = () => {
            if (cancelRequested) return resolve();
            const remaining = deadline - Date.now(); // FIX: tính remaining từ wall-clock
            if (remaining <= 0) return resolve();
            setTimeout(tick, Math.min(stepMs, remaining));
        };

        tick();
    });
}

let translatorCountdownWaitId = 0;
const translatorCountdownWaits = new Map();
let translatorCountdownRenderer = null;
let lastTranslatorCountdownStatus = '';

function getActiveTranslatorCountdownWait(now = Date.now()) {
    let selected = null;
    translatorCountdownWaits.forEach((entry, id) => {
        if (entry.deadline <= now) {
            translatorCountdownWaits.delete(id);
            return;
        }
        if (!selected || entry.deadline > selected.deadline) selected = entry;
    });
    return selected;
}

function getActiveTranslatorCountdownStatus(now = Date.now()) {
    const activeWait = getActiveTranslatorCountdownWait(now);
    if (!activeWait) return '';
    const remainingSeconds = Math.max(1, Math.ceil((activeWait.deadline - now) / 1000));
    return `${activeWait.statusPrefix}... ${remainingSeconds}s`;
}

function renderActiveTranslatorCountdown() {
    const status = getActiveTranslatorCountdownStatus();
    if (!status || status === lastTranslatorCountdownStatus) return status;
    lastTranslatorCountdownStatus = status;
    updateProgress(completedChunks, totalChunksCount, status);
    return status;
}

function ensureTranslatorCountdownRenderer() {
    if (translatorCountdownRenderer) return translatorCountdownRenderer;
    translatorCountdownRenderer = (async () => {
        while (!cancelRequested && getActiveTranslatorCountdownWait()) {
            renderActiveTranslatorCountdown();
            await sleep(1000);
        }
    })().finally(() => {
        translatorCountdownRenderer = null;
        lastTranslatorCountdownStatus = '';
        if (!cancelRequested && getActiveTranslatorCountdownWait()) ensureTranslatorCountdownRenderer();
    });
    return translatorCountdownRenderer;
}

/**
 * Chờ theo deadline thật và dùng một countdown chung cho mọi waiter.
 * Quota vẫn hồi theo wall-clock khi tab ẩn hoặc khi người dùng tạm dừng.
 */
async function sleepWithCountdown(ms, statusPrefix = '⏳ Chờ quota reset') {
    const duration = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (duration === 0 || cancelRequested) return;

    const waitId = ++translatorCountdownWaitId;
    translatorCountdownWaits.set(waitId, {
        deadline: Date.now() + duration,
        statusPrefix,
    });
    renderActiveTranslatorCountdown();
    ensureTranslatorCountdownRenderer();

    try {
        await sleep(duration);
    } finally {
        translatorCountdownWaits.delete(waitId);
    }
}

// ============================================
// VISIBILITY CHANGE MONITOR
// ============================================
let tabHiddenSince = null;

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        tabHiddenSince = Date.now();
        if (isTranslating) {
            console.log('[WorkerTimer] 📋 Tab ẩn - Worker timer vẫn hoạt động bình thường!');
        }
    } else {
        if (tabHiddenSince && isTranslating) {
            const hiddenDuration = ((Date.now() - tabHiddenSince) / 1000).toFixed(1);
            console.log(`[WorkerTimer] 👁️ Tab hiện lại (đã ẩn ${hiddenDuration}s) - dịch vẫn đang chạy!`);
        }
        tabHiddenSince = null;
    }
});

// Tự động init khi load
initWorkerTimer();
