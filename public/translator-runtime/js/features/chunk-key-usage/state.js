// Provider-independent, redacted request journal. Never store credentials or request bodies here.
const TRANSLATOR_KEY_USAGE_LIMIT = 40;
const TRANSLATOR_KEY_USAGE_KINDS = new Set(['main', 'retry', 'manual_retry', 'split_retry']);
let translatorKeyUsageScope = { sessionId: null, chunks: new Map() };

function getTranslatorKeyUsageSessionId() {
    return typeof currentTranslatorSessionId !== 'undefined' ? currentTranslatorSessionId || null : null;
}

function normalizeTranslatorChunkKeyUsage(usage, restored = false) {
    if (!usage || !Array.isArray(usage.attempts)) return null;
    const attempts = usage.attempts.slice(-TRANSLATOR_KEY_USAGE_LIMIT).map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const keyless = entry.keyless === true;
        const statuses = ['pending', 'responded', 'failed', 'cancelled', 'retried', 'interrupted'];
        const status = statuses.includes(entry.status) ? entry.status : 'interrupted';
        return {
            provider: String(entry.provider || 'unknown').slice(0, 64),
            model: String(entry.model || '').slice(0, 160),
            keyless,
            keyIndex: !keyless && Number.isInteger(entry.keyIndex) && entry.keyIndex >= 0 ? entry.keyIndex : null,
            keySuffix: !keyless && /^[a-zA-Z0-9_-]{4}$/.test(entry.keySuffix || '') ? entry.keySuffix : '',
            kind: TRANSLATOR_KEY_USAGE_KINDS.has(entry.kind) ? entry.kind : 'main',
            partIndex: Number.isInteger(entry.partIndex) && entry.partIndex >= 0 ? entry.partIndex : null,
            status: restored && status === 'pending' ? 'interrupted' : status,
        };
    }).filter(Boolean);
    return {
        version: 1,
        omitted: Math.max(0, Math.trunc(Number(usage.omitted) || 0)) + Math.max(0, usage.attempts.length - TRANSLATOR_KEY_USAGE_LIMIT),
        attempts,
    };
}

function resetTranslatorChunkKeyUsage(rows = []) {
    translatorKeyUsageScope = { sessionId: getTranslatorKeyUsageSessionId(), chunks: new Map() };
    restoreTranslatorChunkKeyUsage(rows);
}

function restoreTranslatorChunkKeyUsage(rows = []) {
    for (const row of rows) {
        if (!Number.isInteger(row?.chunkIndex) || row.chunkIndex < 0) continue;
        const usage = normalizeTranslatorChunkKeyUsage(row.keyUsage, true);
        if (usage) translatorKeyUsageScope.chunks.set(row.chunkIndex, usage);
    }
}

function getTranslatorChunkKeyUsage(chunkIndex) {
    if (translatorKeyUsageScope.sessionId !== getTranslatorKeyUsageSessionId()) return null;
    return normalizeTranslatorChunkKeyUsage(translatorKeyUsageScope.chunks.get(chunkIndex));
}

function hydrateTranslatorChunkKeyUsage(row) {
    if (!row || (row.sessionId && row.sessionId !== getTranslatorKeyUsageSessionId())) return;
    if (translatorKeyUsageScope.sessionId !== getTranslatorKeyUsageSessionId()) resetTranslatorChunkKeyUsage();
    if (!translatorKeyUsageScope.chunks.has(row.chunkIndex)) restoreTranslatorChunkKeyUsage([row]);
}

function getTranslatorChunkKeyUsagePatch(chunkIndex) {
    const keyUsage = getTranslatorChunkKeyUsage(chunkIndex);
    return keyUsage ? { keyUsage } : {};
}

function notifyTranslatorChunkKeyUsage(scope, chunkIndex) {
    if (scope !== translatorKeyUsageScope || scope.sessionId !== getTranslatorKeyUsageSessionId()) return;
    // A presentation failure must never turn a successful provider request into a retry.
    try {
        if (typeof refreshTranslatorChunkKeyBadge === 'function') refreshTranslatorChunkKeyBadge(chunkIndex);
        if (typeof refreshTranslatorChunkKeyDetail === 'function') refreshTranslatorChunkKeyDetail(chunkIndex);
    } catch (_) { /* The next tracker render will use the recorded journal. */ }
}

async function withTranslatorChunkKeyUsage(requestOptions = {}, send) {
    const context = requestOptions.chunkKeyUsage;
    if (globalThis.isHanFileAuditBusy || !context || !Number.isInteger(context.chunkIndex) || context.chunkIndex < 0
        || !TRANSLATOR_KEY_USAGE_KINDS.has(context.kind)
        || typeof requestOptions.onChunkKeyUsage === 'function') {
        return send(requestOptions);
    }
    if (translatorKeyUsageScope.sessionId !== getTranslatorKeyUsageSessionId()) resetTranslatorChunkKeyUsage();
    const scope = translatorKeyUsageScope;
    const chunkIndex = context.chunkIndex;
    let activeEntry = null;
    const options = {
        ...requestOptions,
        onChunkKeyUsage(identity) {
            if (scope !== translatorKeyUsageScope || scope.sessionId !== getTranslatorKeyUsageSessionId()) return;
            if (activeEntry?.status === 'pending') activeEntry.status = 'retried';
            const key = String(identity.key || '');
            activeEntry = normalizeTranslatorChunkKeyUsage({ attempts: [{
                provider: identity.provider,
                model: identity.model,
                keyIndex: identity.keyIndex,
                keySuffix: key.length > 8 ? key.slice(-4) : '',
                keyless: identity.keyless,
                kind: context.kind,
                partIndex: context.partIndex,
                status: 'pending',
            }] }).attempts[0];
            let usage = scope.chunks.get(chunkIndex);
            if (!usage) {
                usage = { version: 1, omitted: 0, attempts: [] };
                scope.chunks.set(chunkIndex, usage);
            }
            usage.attempts.push(activeEntry);
            if (usage.attempts.length > TRANSLATOR_KEY_USAGE_LIMIT) {
                usage.attempts.shift();
                usage.omitted += 1;
            }
            notifyTranslatorChunkKeyUsage(scope, chunkIndex);
        },
    };
    try {
        const result = await send(options);
        if (activeEntry) activeEntry.status = 'responded';
        return result;
    } catch (error) {
        if (activeEntry) activeEntry.status = String(error?.message || '').includes('TRANSLATION_CANCELLED') ? 'cancelled' : 'failed';
        throw error;
    } finally {
        notifyTranslatorChunkKeyUsage(scope, chunkIndex);
    }
}
