/**
 * StoryForge Canon Pack bridge for the static translator runtime.
 * Uses native IndexedDB so the iframe does not need React, Dexie, or the main app bundle.
 */

const CANON_PACK_DB_NAME = 'StoryForgeLabLiteDB';
const CANON_PACK_STORE = 'canonPacks';
const CANON_PACK_PROMPT_START = '[CANON PACK TRANSLATION CONTEXT]';
const CANON_PACK_PROMPT_END = '[END CANON PACK TRANSLATION CONTEXT]';

let availableCanonPacks = [];
let selectedCanonPackId = '';
let useCanonPackTranslation = false;

function compactLine(label, value) {
    const text = Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value || '').trim();
    return text ? `${label}: ${text}` : '';
}

function clipText(text, maxChars) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function buildCanonPackTranslatorPrompt(canonPack, options = {}) {
    if (!canonPack || typeof canonPack !== 'object') return '';
    const maxChars = Number(options.maxChars || 6500);
    const lines = [
        CANON_PACK_PROMPT_START,
        'Use this context only to keep translation names, glossary, style, relationships, and canon wording consistent.',
        'Do not re-analyze the source corpus during translation.',
        compactLine('Canon Pack', canonPack.title || canonPack.id || ''),
    ];

    const characters = (canonPack.characterCanon || []).slice(0, 32).map((character) => {
        const names = [character.name, ...(character.aliases || [])].filter(Boolean).join(' / ');
        return [names, character.role, character.voice].filter(Boolean).join(' - ');
    }).filter(Boolean);
    if (characters.length) lines.push(compactLine('Names and voices', characters));

    const relationships = (canonPack.relationshipCanon || []).slice(0, 24).map((relationship) => {
        const pair = [relationship.characterA || relationship.from, relationship.characterB || relationship.to].filter(Boolean).join(' <-> ');
        return [pair, relationship.relation || relationship.type, relationship.change || relationship.status].filter(Boolean).join(' - ');
    }).filter(Boolean);
    if (relationships.length) lines.push(compactLine('Relationship wording', relationships));

    const worldUpdates = canonPack.metadata?.worldUpdates || canonPack.worldUpdates || [];
    const glossary = worldUpdates.slice(0, 40).map((item) => {
        const name = item.name || item.term || item.title;
        return [name, item.description || item.summary || item.type].filter(Boolean).join(' = ');
    }).filter(Boolean);
    const worldRules = Array.isArray(canonPack.globalCanon?.worldRules) ? canonPack.globalCanon.worldRules : [];
    if (glossary.length || worldRules.length) lines.push(compactLine('Glossary and world rules', [...glossary, ...worldRules].slice(0, 48)));

    const style = canonPack.styleCanon || {};
    const styleLines = [
        style.tone,
        style.pacing,
        style.narration,
        ...(style.observations || []),
        ...(style.openingAndEndingPatterns || []),
    ].filter(Boolean);
    if (styleLines.length) lines.push(compactLine('Style', styleLines.slice(0, 18)));

    const restrictions = (canonPack.canonRestrictions || []).slice(0, 24).map((item) => (
        typeof item === 'string' ? item : item.text || item.rule || item.summary || item.description
    )).filter(Boolean);
    if (restrictions.length) lines.push(compactLine('Canon restrictions', restrictions));

    lines.push(CANON_PACK_PROMPT_END);
    return clipText(lines.filter(Boolean).join('\n'), maxChars);
}

function stripCanonPackTranslationContext(promptText) {
    const text = String(promptText || '');
    const escapedStart = CANON_PACK_PROMPT_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = CANON_PACK_PROMPT_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withoutBoundedBlocks = text.replace(new RegExp(`\\n*${escapedStart}[\\s\\S]*?${escapedEnd}\\n*`, 'g'), '\n').trim();
    const startIndex = withoutBoundedBlocks.indexOf(CANON_PACK_PROMPT_START);
    if (startIndex < 0) return withoutBoundedBlocks;
    return withoutBoundedBlocks.slice(0, startIndex).trim();
}

function applyCanonPackPromptToTranslatorPrompt(basePrompt, canonPrompt) {
    const base = stripCanonPackTranslationContext(basePrompt);
    const canon = String(canonPrompt || '').trim();
    if (!canon) return base;
    return `${base ? `${base}\n\n` : ''}${canon}`.trim();
}

function loadStoryForgeCanonPacks() {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve([]);
            return;
        }

        let request;
        try {
            request = indexedDB.open(CANON_PACK_DB_NAME);
        } catch (error) {
            console.warn('[Canon Pack] Could not open IndexedDB:', error);
            resolve([]);
            return;
        }

        request.onerror = () => resolve([]);
        request.onsuccess = (event) => {
            try {
                const db = event.target.result;
                const transaction = db.transaction(CANON_PACK_STORE, 'readonly');
                const store = transaction.objectStore(CANON_PACK_STORE);
                const getAllRequest = store.getAll();
                getAllRequest.onerror = () => resolve([]);
                getAllRequest.onsuccess = (resultEvent) => {
                    const packs = Array.isArray(resultEvent.target.result) ? resultEvent.target.result : [];
                    resolve(packs.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
                };
            } catch (error) {
                console.warn('[Canon Pack] Could not read Canon Packs:', error);
                resolve([]);
            }
        };
    });
}

async function refreshCanonPackSelector() {
    availableCanonPacks = await loadStoryForgeCanonPacks();
    const select = document.getElementById('canonPackSelect');
    const status = document.getElementById('canonPackStatus');
    if (select) {
        select.innerHTML = '';
        availableCanonPacks.forEach((pack) => {
            const option = document.createElement('option');
            option.value = pack.id;
            option.textContent = pack.title || pack.id;
            select.appendChild(option);
        });
        if (selectedCanonPackId && availableCanonPacks.some((pack) => pack.id === selectedCanonPackId)) {
            select.value = selectedCanonPackId;
        } else {
            selectedCanonPackId = availableCanonPacks[0]?.id || '';
            select.value = selectedCanonPackId;
        }
    }
    if (status) status.textContent = availableCanonPacks.length ? `${availableCanonPacks.length} pack` : 'Chưa có Canon Pack';
    if (typeof updateSettingsAccordions === 'function') updateSettingsAccordions();
    return availableCanonPacks;
}

function getSelectedCanonPack() {
    const select = document.getElementById('canonPackSelect');
    const id = select?.value || selectedCanonPackId || availableCanonPacks[0]?.id || '';
    selectedCanonPackId = id;
    return availableCanonPacks.find((pack) => pack.id === id) || availableCanonPacks[0] || null;
}

async function applyActiveCanonPackToPrompt(basePrompt) {
    if (!useCanonPackTranslation) {
        return stripCanonPackTranslationContext(basePrompt);
    }
    if (!availableCanonPacks.length) {
        await refreshCanonPackSelector();
    }
    const pack = getSelectedCanonPack();
    if (!pack) return stripCanonPackTranslationContext(basePrompt);
    return applyCanonPackPromptToTranslatorPrompt(basePrompt, buildCanonPackTranslatorPrompt(pack));
}

async function applySelectedCanonPackToPrompt() {
    const promptInput = document.getElementById('customPrompt');
    if (!promptInput) return '';
    promptInput.value = await applyActiveCanonPackToPrompt(promptInput.value || '');
    if (typeof saveSettings === 'function') saveSettings();
    if (typeof showToast === 'function') showToast('Đã nạp Canon Pack vào prompt dịch.', 'success');
    return promptInput.value;
}

function handleCanonPackToggle() {
    const toggle = document.getElementById('useCanonPackToggle');
    useCanonPackTranslation = Boolean(toggle?.checked);
    if (!useCanonPackTranslation) {
        const promptInput = document.getElementById('customPrompt');
        if (promptInput) promptInput.value = stripCanonPackTranslationContext(promptInput.value);
    }
    if (typeof saveSettings === 'function') saveSettings();
    if (typeof updateSettingsAccordions === 'function') updateSettingsAccordions();
}
