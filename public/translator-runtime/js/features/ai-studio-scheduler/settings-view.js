(function (ns) {
    'use strict';
    let initialized = false;
    let enhancedView = false;
    let legacyParallel = '2';
    let lockValues = null;
    const disabledControls = new Map();
    const input = () => document.getElementById('parallelCount');
    const legacyValue = value => String(normalizeTranslatorParallel(value));
    ns.loadConfig = (saved = {}) => {
        legacyParallel = legacyValue(saved.parallelCount || input()?.value || 2);
        ns.settings = { enabled: saved.aiStudioScheduler?.enabled === true,
            parallelCount: ns.normalizeParallel(saved.aiStudioScheduler?.parallelCount ?? legacyParallel) };
        enhancedView = false; initialized = true;
        if (input()) input().value = legacyParallel;
    };
    ns.refreshSettings = () => {
        if (!initialized) ns.loadConfig();
        const parallel = input();
        const enabled = ns.isEnabled();
        if (parallel && enabled !== enhancedView) {
            if (enhancedView) ns.settings.parallelCount = ns.normalizeParallel(parallel.value);
            else legacyParallel = legacyValue(parallel.value);
            parallel.value = enabled ? String(ns.settings.parallelCount) : legacyParallel;
        }
        enhancedView = enabled;
        if (parallel) parallel.max = enabled ? String(ns.MAX_PARALLEL) : '30';
        const toggle = document.getElementById('aiStudioSchedulerToggle');
        const busy = typeof isTranslating !== 'undefined' && isTranslating;
        if (toggle) { toggle.checked = ns.settings.enabled; toggle.disabled = busy || Boolean(ns.activeRun); }
        const locked = ns.isLocked();
        const rpm = document.getElementById('rpmPerKey');
        if (locked && !lockValues) lockValues = { parallel: parallel?.value, rpm: rpm?.value };
        if (locked && lockValues) {
            if (parallel) parallel.value = lockValues.parallel;
            if (rpm) rpm.value = lockValues.rpm;
        }
        const controls = document.querySelectorAll('.gemini-direct-panel input, .gemini-direct-panel select, .gemini-direct-panel button, #parallelCount, #rpmPerKey, #useProxyToggle, #customProxyToggle, #useOllamaToggle');
        controls.forEach(control => {
            if (control === toggle) return;
            if (locked) {
                if (!disabledControls.has(control)) disabledControls.set(control, control.disabled);
                control.disabled = true;
            }
        });
        if (!locked) {
            disabledControls.forEach((wasDisabled, control) => { control.disabled = wasDisabled; });
            disabledControls.clear(); lockValues = null;
        }
        const hint = document.getElementById('aiStudioSchedulerLimit');
        if (hint) hint.textContent = ns.settings.enabled
            ? `Đã bật cho lượt dịch AI Studio Direct. Tối đa ${ns.MAX_PARALLEL} request song song, trong giới hạn tài khoản.`
            : 'Đang dùng cơ chế cũ, tối đa 30 request song song.';
        if (!enabled && !ns.activeRun) ns.finishStatus?.();
    };
    ns.settingsPayload = () => {
        ns.refreshSettings();
        if (enhancedView) ns.settings.parallelCount = ns.normalizeParallel(input()?.value || ns.settings.parallelCount);
        else legacyParallel = legacyValue(input()?.value || legacyParallel);
        return { parallelCount: legacyParallel, aiStudioScheduler: { ...ns.settings } };
    };
    ns.setEnabled = enabled => {
        if ((typeof isTranslating !== 'undefined' && isTranslating) || ns.activeRun
            || globalThis.isHanFileAuditBusy || globalThis.isChunkIssueRetryBusy
            || (typeof isHanAuditBusy !== 'undefined' && isHanAuditBusy)) {
            ns.refreshSettings(); return false;
        }
        ns.settings.enabled = enabled === true;
        ns.refreshSettings();
        if (typeof saveSettings === 'function') saveSettings();
        return true;
    };
    ns.rateSummary = () => {
        const rate = normalizeTranslatorRpm(document.getElementById('rpmPerKey')?.value || rpmPerKey);
        const count = apiKeys.length;
        const requested = ns.normalizeParallel(input()?.value);
        const parallel = typeof hasStoryForgeFeature === 'function' && !hasStoryForgeFeature('translator.parallel_high')
            ? Math.min(2, requested) : requested;
        return count ? `${count} key · tối đa ${Math.min(parallel, count * rate)} request/đợt · ${rate} lượt/key trong 65 giây. RPM dư chỉ dành cho retry.`
            : 'Thêm API key AI Studio để sử dụng hàng chờ riêng.';
    };
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('aiStudioSchedulerToggle')?.addEventListener('change', event => ns.setEnabled(event.target.checked));
        ns.refreshSettings();
    });
})(globalThis.AiStudioScheduler);
