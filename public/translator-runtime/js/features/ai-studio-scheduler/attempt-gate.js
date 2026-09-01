(function (ns) {
    'use strict';
    ns.createAttemptGate = keys => {
        const provider = TRANSLATOR_PROVIDERS.GEMINI_DIRECT;
        const disabled = new Set();
        const leases = new Set();
        return {
            health(key) {
                const invalid = keyHealthMap[key.keyIndex]?.lastError === 'INVALID_KEY'
                    && Number(keyHealthMap[key.keyIndex]?.disabledUntil) > Date.now();
                return {
                    disabled: disabled.has(key.keyIndex) || invalid,
                    cooldownMs: getModelKeyCooldownMs(key.model, key.keyIndex),
                    remaining: getTranslatorRpmRemainingForKey(provider, key.keyIndex),
                    rpmWaitMs: getTranslatorRpmWaitMsForKey(provider, key.keyIndex),
                };
            },
            fail(key, error) {
                if (['INVALID_API_KEY', 'GEMINI_PERMISSION_DENIED'].includes(error?.code)) disabled.add(key.keyIndex);
            },
            reserve(key, kind) {
                const reservation = reserveTranslatorRpmSlot(provider, key.keyIndex, kind);
                if (!reservation) return null;
                const controller = new AbortController();
                let sent = false;
                let released = false;
                let timeout = null;
                const lease = {
                    pair: key, signal: controller.signal,
                    commit() {
                        if (released || controller.signal.aborted) throw ns.cancelledError();
                        if (sent) return;
                        if (!commitTranslatorRpmReservation(reservation, Date.now())) throw ns.cancelledError();
                        sent = true;
                        timeout = setTimeout(() => controller.abort('request-timeout'), 120000);
                    },
                    abort() { controller.abort('translation-cancelled'); },
                    release() {
                        if (released) return;
                        released = true;
                        clearTimeout(timeout);
                        releaseTranslatorRpmReservation(reservation);
                        unregisterActiveRequestController(controller);
                        leases.delete(lease);
                    },
                };
                registerActiveRequestController(controller);
                leases.add(lease);
                return lease;
            },
            cancel() { leases.forEach(lease => lease.abort()); },
        };
    };
})(globalThis.AiStudioScheduler);
