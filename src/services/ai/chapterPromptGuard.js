function normalizeVietnameseText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase();
}

const OUTLINE_PROMPT_MARKERS = [
  'tom tat',
  'muc tieu',
  'noi dung can viet',
  'purpose',
  'summary',
  'key event',
  'su kien',
];

const TOKEN_STOPWORDS = new Set([
  'chuong',
  'chapter',
  'canh',
  'scene',
  'muc',
  'tieu',
  'tom',
  'tat',
  'noi',
  'dung',
  'can',
  'viet',
  'the',
  'va',
  'voi',
  'cua',
  'cho',
  'mot',
  'nhung',
  'duoc',
  'trong',
  'sau',
  'nay',
  'hien',
  'tai',
]);

export function extractRequestedChapterNumbers(text = '') {
  const normalized = normalizeVietnameseText(text);
  const matches = [];
  const rx = /(?:^|[^a-z0-9])(?:chuong|chapter|chap|ch)\s*[:.#-]?\s*(\d{1,4})(?=$|[^a-z0-9])/g;
  let match = rx.exec(normalized);

  while (match) {
    const number = Number(match[1]);
    if (Number.isFinite(number) && number > 0) {
      matches.push(number);
    }
    match = rx.exec(normalized);
  }

  return [...new Set(matches)];
}

function parseLooseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // Fall through to loose parsing.
  }

  return trimmed
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenize(value = '') {
  return normalizeVietnameseText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
}

function hasOutlinePromptShape(userPrompt = '') {
  const normalized = normalizeVietnameseText(userPrompt);
  return OUTLINE_PROMPT_MARKERS.some((marker) => normalized.includes(marker));
}

function chapterNumberFromCandidate(chapter = {}, index = 0) {
  const explicitNumber = Number(chapter.chapterNumber || chapter.chapter_number);
  if (Number.isFinite(explicitNumber) && explicitNumber > 0) return explicitNumber;

  const orderIndex = Number(chapter.order_index ?? chapter.orderIndex);
  if (Number.isFinite(orderIndex) && orderIndex >= 0) return orderIndex + 1;

  const [titleNumber] = extractRequestedChapterNumbers(chapter.title || '');
  return titleNumber || index + 1;
}

function chapterIdMatchesContext(chapter = {}, context = {}) {
  if (context.chapterId == null || chapter.id == null) return false;
  return String(chapter.id) === String(context.chapterId);
}

function chapterTextFields(chapter = {}) {
  return [
    chapter.title,
    chapter.summary,
    chapter.purpose,
    chapter.state_delta,
    chapter.stateDelta,
    ...parseLooseList(chapter.key_events),
    ...parseLooseList(chapter.keyEvents),
  ].filter(Boolean);
}

function scoreChapterPromptMatch(userPrompt = '', chapter = {}) {
  const normalizedPrompt = normalizeVietnameseText(userPrompt).replace(/\s+/g, ' ').trim();
  const promptTokens = new Set(tokenize(userPrompt));
  if (!normalizedPrompt || promptTokens.size === 0) {
    return { score: 0, exact: false };
  }

  let score = 0;
  let exact = false;

  for (const field of chapterTextFields(chapter)) {
    const normalizedField = normalizeVietnameseText(field).replace(/\s+/g, ' ').trim();
    const fieldTokens = tokenize(field);
    if (!normalizedField || fieldTokens.length < 3) continue;

    if (normalizedField.length >= 24 && normalizedPrompt.includes(normalizedField)) {
      exact = true;
      score += Math.min(1.2, fieldTokens.length / 10);
      continue;
    }

    const matchedTokens = fieldTokens.filter((token) => promptTokens.has(token));
    const coverage = matchedTokens.length / Math.max(1, fieldTokens.length);
    if (coverage >= 0.45) {
      score += coverage * Math.min(1, fieldTokens.length / 8);
    }
  }

  return { score, exact };
}

function detectOutlineChapterMismatch(context = {}, options = {}) {
  if (!hasOutlinePromptShape(context.userPrompt || '')) return null;

  const chapters = Array.isArray(options.chapters)
    ? options.chapters
    : Array.isArray(context.chapterCandidates)
      ? context.chapterCandidates
      : [];
  if (chapters.length < 2) return null;

  const currentChapterNumber = resolveCurrentChapterNumber(context);
  if (!currentChapterNumber) return null;

  let best = null;
  let currentScore = 0;

  chapters.forEach((chapter, index) => {
    const chapterNumber = chapterNumberFromCandidate(chapter, index);
    const match = scoreChapterPromptMatch(context.userPrompt || '', chapter);
    if (chapterNumber === currentChapterNumber || chapterIdMatchesContext(chapter, context)) {
      currentScore = Math.max(currentScore, match.score);
    }
    if (!best || match.score > best.score) {
      best = {
        chapter,
        chapterNumber,
        score: match.score,
        exact: match.exact,
      };
    }
  });

  if (!best || best.chapterNumber === currentChapterNumber || chapterIdMatchesContext(best.chapter, context)) {
    return null;
  }

  const isStrongMatch = best.exact || best.score >= 0.75;
  const clearlyBeatsCurrent = best.score - currentScore >= 0.35;
  if (!isStrongMatch || !clearlyBeatsCurrent) return null;

  const currentTitle = context.chapterTitle
    ? ` "${context.chapterTitle}"`
    : '';
  const targetTitle = best.chapter?.title
    ? ` "${best.chapter.title}"`
    : '';

  return {
    code: 'chapter_prompt_mismatch',
    requestedChapterNumber: best.chapterNumber,
    currentChapterNumber,
    matchedBy: 'outline_content',
    message: `Yêu cầu có vẻ đang khớp với Chương ${best.chapterNumber}${targetTitle}, nhưng context hiện tại là Chương ${currentChapterNumber}${currentTitle}. Hãy chọn đúng chương/cảnh trước khi gửi AI.`,
  };
}

export function resolveCurrentChapterNumber(context = {}) {
  const explicitNumber = Number(context.currentChapterNumber);
  if (Number.isFinite(explicitNumber) && explicitNumber > 0) return explicitNumber;

  const currentChapterIndex = Number(context.currentChapterIndex);
  if (Number.isFinite(currentChapterIndex) && currentChapterIndex >= 0) {
    return currentChapterIndex + 1;
  }

  const chapterIndex = Number(context.chapterIndex);
  if (Number.isFinite(chapterIndex) && chapterIndex >= 0) {
    return chapterIndex + 1;
  }

  const [titleNumber] = extractRequestedChapterNumbers(context.chapterTitle || '');
  return titleNumber || null;
}

function detectExplicitChapterMismatch(context = {}) {
  const requestedNumbers = extractRequestedChapterNumbers(context.userPrompt || '');
  if (requestedNumbers.length === 0) return null;

  const currentChapterNumber = resolveCurrentChapterNumber(context);
  if (!currentChapterNumber) return null;
  if (requestedNumbers.includes(currentChapterNumber)) return null;

  const requestedChapterNumber = requestedNumbers[0];
  const currentTitle = context.chapterTitle
    ? ` "${context.chapterTitle}"`
    : '';

  return {
    code: 'chapter_prompt_mismatch',
    requestedChapterNumber,
    currentChapterNumber,
    matchedBy: 'explicit_chapter_reference',
    message: `Yêu cầu đang nhắc Chương ${requestedChapterNumber}, nhưng context hiện tại là Chương ${currentChapterNumber}${currentTitle}. Hãy chọn đúng chương/cảnh trước khi gửi AI.`,
  };
}

export function detectChapterPromptMismatch(context = {}, options = {}) {
  const explicitMismatch = detectExplicitChapterMismatch(context);
  if (explicitMismatch) return explicitMismatch;
  return detectOutlineChapterMismatch(context, options);
}

export default {
  extractRequestedChapterNumbers,
  resolveCurrentChapterNumber,
  detectChapterPromptMismatch,
};
