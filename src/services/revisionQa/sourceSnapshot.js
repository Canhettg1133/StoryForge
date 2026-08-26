const ANCHOR_CONTEXT_LENGTH = 32;

export function normalizeSourceText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

export async function computeTextSignature(value) {
  const bytes = new TextEncoder().encode(normalizeSourceText(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

function decodeHtmlEntities(value) {
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html');
    return document.body.textContent || '';
  }

  return value
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(html) {
  const value = String(html ?? '');
  if (!value) return '';

  const withBoundaries = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|pre|li)>/gi, '\n\n')
    .replace(/<li(?:\s[^>]*)?>/gi, '— ')
    .replace(/<[^>]+>/g, '');

  return normalizeSourceText(decodeHtmlEntities(withBoundaries))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

function occurrenceAt(text, quote, targetStart) {
  let occurrence = 0;
  let cursor = 0;
  while (cursor <= text.length) {
    const found = text.indexOf(quote, cursor);
    if (found < 0 || found > targetStart) break;
    occurrence += 1;
    if (found === targetStart) return occurrence;
    cursor = found + Math.max(quote.length, 1);
  }
  return Math.max(occurrence, 1);
}

export function buildFindingAnchor(text, from, to) {
  const source = String(text ?? '');
  const safeFrom = Math.max(0, Math.min(Number(from) || 0, source.length));
  const safeTo = Math.max(safeFrom, Math.min(Number(to) || safeFrom, source.length));
  const quote = source.slice(safeFrom, safeTo);

  return {
    quote,
    prefix: source.slice(Math.max(0, safeFrom - ANCHOR_CONTEXT_LENGTH), safeFrom),
    suffix: source.slice(safeTo, safeTo + ANCHOR_CONTEXT_LENGTH),
    occurrence: occurrenceAt(source, quote, safeFrom),
    from: safeFrom,
    to: safeTo,
  };
}

function contextMatches(text, start, anchor) {
  const prefix = String(anchor.prefix ?? '');
  const suffix = String(anchor.suffix ?? '');
  const prefixStart = Math.max(0, start - prefix.length);
  const suffixStart = start + String(anchor.quote ?? '').length;
  return text.slice(prefixStart, start) === prefix
    && text.slice(suffixStart, suffixStart + suffix.length) === suffix;
}

export function resolveFindingAnchor(text, anchor) {
  const source = String(text ?? '');
  const quote = String(anchor?.quote ?? '');
  if (!quote) return null;

  const hintedFrom = Number(anchor?.from);
  const hintedTo = Number(anchor?.to);
  if (
    Number.isInteger(hintedFrom)
    && Number.isInteger(hintedTo)
    && source.slice(hintedFrom, hintedTo) === quote
    && contextMatches(source, hintedFrom, anchor)
  ) {
    return { from: hintedFrom, to: hintedTo };
  }

  const candidates = [];
  let cursor = 0;
  while (cursor <= source.length) {
    const start = source.indexOf(quote, cursor);
    if (start < 0) break;
    if (contextMatches(source, start, anchor)) {
      candidates.push({ from: start, to: start + quote.length });
    }
    cursor = start + Math.max(quote.length, 1);
  }

  return candidates.length === 1 ? candidates[0] : null;
}
