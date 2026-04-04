const VIETNAMESE_DIACRITIC_REGEX = /[\u0300-\u036f]/g;
const SPECIAL_VIETNAMESE_REGEX = /[đĐ]/g;

const HTML_ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function scoreDecodedText(text) {
  if (!text) {
    return -Infinity;
  }

  const replacementCount = (text.match(/�/g) || []).length;
  const nullCount = (text.match(/\u0000/g) || []).length;
  const printableCount = (text.match(/[\p{L}\p{N}\p{P}\p{Zs}\r\n\t]/gu) || []).length;
  const vietnameseCount = (text.match(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệóòỏõọốồổỗộớờởỡợúùủũụứừửữựíìỉĩịýỳỷỹỵ]/giu) || []).length;

  const length = Math.max(1, text.length);
  const printableRatio = printableCount / length;
  const replacementPenalty = replacementCount / length;
  const nullPenalty = nullCount / length;
  const vietnameseBonus = Math.min(0.2, vietnameseCount / length);

  return printableRatio - replacementPenalty * 4 - nullPenalty * 2 + vietnameseBonus;
}

function decodeWithEncoding(buffer, encoding) {
  try {
    const decoder = new TextDecoder(encoding, { fatal: false });
    return decoder.decode(buffer);
  } catch {
    return null;
  }
}

export function decodeTextBuffer(buffer) {
  if (typeof buffer === 'string') {
    return stripBom(buffer);
  }

  const candidates = ['utf-8', 'utf-16le', 'windows-1258', 'windows-1252', 'iso-8859-1'];
  let bestText = '';
  let bestScore = -Infinity;

  for (const encoding of candidates) {
    const decoded = decodeWithEncoding(buffer, encoding);
    if (decoded == null) {
      continue;
    }

    const clean = stripBom(decoded);
    const score = scoreDecodedText(clean);
    if (score > bestScore) {
      bestScore = score;
      bestText = clean;
    }
  }

  return bestText || Buffer.from(buffer).toString('utf8');
}

export function stripBom(text = '') {
  return text.replace(/^\uFEFF/, '');
}

export function removeVietnameseTones(text = '') {
  return text
    .normalize('NFD')
    .replace(VIETNAMESE_DIACRITIC_REGEX, '')
    .replace(SPECIAL_VIETNAMESE_REGEX, (match) => (match === 'đ' ? 'd' : 'D'));
}

export function normalizeForSearch(text = '') {
  return removeVietnameseTones(String(text || ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeWhitespace(text = '') {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeHtmlEntities(text = '') {
  let decoded = String(text || '');

  for (const [entity, value] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.split(entity).join(value);
  }

  decoded = decoded.replace(/&#(\d+);/g, (_, code) => {
    const parsed = Number(code);
    return Number.isNaN(parsed) ? _ : String.fromCodePoint(parsed);
  });

  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const parsed = Number.parseInt(hex, 16);
    return Number.isNaN(parsed) ? _ : String.fromCodePoint(parsed);
  });

  return decoded;
}

export function stripHtml(html = '') {
  const withoutScripts = String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');

  const withBreaks = withoutScripts
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|section|article)>/gi, '\n');

  const plain = withBreaks.replace(/<[^>]+>/g, ' ');
  return sanitizeWhitespace(decodeHtmlEntities(plain));
}

export function extractWords(text = '') {
  return String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [];
}

export function countWords(text = '') {
  return extractWords(text).length;
}

export function cleanTitle(title = '', fallback = 'Untitled') {
  const cleaned = sanitizeWhitespace(String(title || '').replace(/[\u0000-\u001F]/g, ' '));
  return cleaned || fallback;
}
