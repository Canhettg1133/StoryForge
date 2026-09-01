(function (root) {
    'use strict';
    const ns = root.AiStudioScheduler = root.AiStudioScheduler || {};
    ns.MAX_PARALLEL = 60;
    ns.STAGGER_MS = 10000;
    ns.WINDOW_MS = typeof TRANSLATOR_RPM_WINDOW_MS === 'number' ? TRANSLATOR_RPM_WINDOW_MS : 65000;
    ns.settings = { enabled: false, parallelCount: 2 };
    ns.activeRun = null;
    ns.normalizeParallel = value => Math.max(1, Math.min(ns.MAX_PARALLEL, Math.trunc(Number(value)) || 1));
    ns.isEnabled = () => ns.settings.enabled === true
        && typeof useProxy !== 'undefined' && !useProxy
        && typeof useOllama !== 'undefined' && !useOllama;
    ns.isLocked = () => Boolean(ns.activeRun) || (ns.isEnabled() && typeof isTranslating !== 'undefined' && isTranslating);
    ns.cancelledError = () => new Error('TRANSLATION_CANCELLED');
    ns.guardSettingsChange = () => {
        if (!ns.isLocked()) return false;
        if (typeof showToast === 'function') showToast('Hãy kết thúc hoặc hủy lượt dịch trước khi đổi cấu hình AI Studio.', 'warning');
        ns.refreshSettings?.();
        return true;
    };
})(globalThis);
