const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;
const WORD_REGEX = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu;
const VIETNAMESE_DIACRITIC_REGEX = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/iu;

export function countLabLiteWords(text = '') {
  return String(text || '').match(WORD_REGEX)?.length || 0;
}

export function estimateTokens(text = '') {
  return estimateTokensDetailed(text).estimatedTokens;
}

export function estimateTokensDetailed(text = '', { overheadTokens = 0 } = {}) {
  const value = String(text || '');
  if (!value.trim()) {
    return {
      estimatedTokens: Math.max(0, Math.trunc(Number(overheadTokens)) || 0),
      wordCount: 0,
      cjkCharacters: 0,
      nonWhitespaceChars: 0,
      languageHint: 'empty',
      overheadTokens: Math.max(0, Math.trunc(Number(overheadTokens)) || 0),
    };
  }

  const wordCount = countLabLiteWords(value);
  const cjkCount = (value.match(CJK_REGEX) || []).length;
  const nonWhitespaceChars = value.replace(/\s+/g, '').length;
  const overhead = Math.max(0, Math.trunc(Number(overheadTokens)) || 0);
  const languageHint = cjkCount > Math.max(4, nonWhitespaceChars * 0.25)
    ? 'cjk'
    : VIETNAMESE_DIACRITIC_REGEX.test(value)
      ? 'vietnamese'
      : 'latin';

  const wordMultiplier = languageHint === 'vietnamese' ? 1.55 : 1.35;
  const charDivisor = languageHint === 'vietnamese' ? 3.2 : 3.8;
  const wordBased = Math.ceil(wordCount * wordMultiplier);
  const cjkBased = Math.ceil(cjkCount * 1.08);
  const charBased = Math.ceil(nonWhitespaceChars / charDivisor);

  return {
    estimatedTokens: Math.max(1, wordBased, cjkBased, charBased) + overhead,
    wordCount,
    cjkCharacters: cjkCount,
    nonWhitespaceChars,
    languageHint,
    overheadTokens: overhead,
  };
}

export function summarizeTextStats(text = '') {
  const normalized = String(text || '');
  const detail = estimateTokensDetailed(normalized);
  return {
    wordCount: detail.wordCount,
    estimatedTokens: detail.estimatedTokens,
    charCount: normalized.length,
  };
}
