import { buildFindingAnchor, computeTextSignature, normalizeSourceText } from './sourceSnapshot.js';

const STOP_WORDS = new Set([
  'anh', 'ay', 'ba', 'bi', 'bo', 'cac', 'cai', 'chi', 'cho', 'co', 'cua', 'da', 'dang',
  'de', 'den', 'di', 'do', 'duoc', 'gi', 'khi', 'la', 'lai', 'ma', 'mot', 'nao', 'nay',
  'nhung', 'no', 'o', 'roi', 'se', 'thi', 'tu', 'va', 'van', 'voi',
]);

const PROFILE_CATEGORIES = {
  overview: null,
  style: new Set(['format', 'style', 'cliche']),
  pacing: new Set(['pacing', 'style']),
  dialogue: new Set(['dialogue']),
  canon: new Set(['canon']),
  repetition: new Set(['repetition', 'cliche']),
};

export function normalizeForMatching(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackWords(text) {
  const results = [];
  const regex = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  let match;
  while ((match = regex.exec(text))) {
    results.push({ segment: match[0], index: match.index, end: match.index + match[0].length });
  }
  return results;
}

export function segmentWords(value, { forceFallback = false } = {}) {
  const text = String(value ?? '');
  if (forceFallback || typeof Intl?.Segmenter !== 'function') return fallbackWords(text);

  const segmenter = new Intl.Segmenter('vi', { granularity: 'word' });
  return Array.from(segmenter.segment(text))
    .filter((item) => item.isWordLike)
    .map((item) => ({
      segment: item.segment,
      index: item.index,
      end: item.index + item.segment.length,
    }));
}

function trimRange(text, start, end) {
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}

export function segmentSentences(value) {
  const text = String(value ?? '');
  const results = [];
  const regex = /[^.!?\n]+(?:[.!?…]+(?=(?:[”’"']?)(?:\s|$))|$)/gu;
  let match;
  while ((match = regex.exec(text))) {
    const range = trimRange(text, match.index, match.index + match[0].length);
    if (range.end > range.start) {
      results.push({ text: text.slice(range.start, range.end), index: range.start, end: range.end });
    }
  }
  return results;
}

function segmentParagraphs(text) {
  const results = [];
  const regex = /(?:^|\n{2,})([^]*?)(?=\n{2,}|$)/g;
  let match;
  while ((match = regex.exec(text))) {
    const raw = match[1];
    const rawStart = match.index + match[0].indexOf(raw);
    const range = trimRange(text, rawStart, rawStart + raw.length);
    if (range.end > range.start) {
      results.push({ text: text.slice(range.start, range.end), index: range.start, end: range.end });
    }
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return results;
}

function stableConfigValue(phraseConfig) {
  const normalizeList = (items) => [...new Set((items || []).map(normalizeForMatching).filter(Boolean))].sort();
  return JSON.stringify({
    blacklist: normalizeList(phraseConfig?.blacklist),
    whitelist: normalizeList(phraseConfig?.whitelist),
  });
}

export function computePhraseConfigSignature(phraseConfig = {}) {
  return computeTextSignature(stableConfigValue(phraseConfig));
}

function descriptionFor(ruleId, details = {}) {
  const descriptions = {
    LONG_SENTENCE: `Câu có ${details.count} đơn vị từ, vượt ngưỡng đọc nhanh.`,
    LONG_PARAGRAPH: `Đoạn có ${details.count} đơn vị từ; cân nhắc tách nhịp.`,
    MECHANICAL_SHORT_RUN: 'Năm câu rất ngắn liên tiếp tạo nhịp đều và cơ học.',
    REPEATED_TERM_WINDOW: `Từ “${details.term}” lặp lại nhiều lần trong một cửa sổ ngắn.`,
    REPEATED_NGRAM: 'Một cụm từ được lặp nguyên văn trong đoạn gần nhau.',
    REPEATED_OPENING: 'Ba câu liên tiếp mở đầu giống nhau.',
    DENSE_DIALOGUE: 'Nhiều lượt thoại hoặc chỉ dẫn người nói nằm trong cùng một đoạn.',
    UNBALANCED_QUOTES: 'Dấu ngoặc kép mở và đóng không cân bằng.',
    PUNCTUATION_BURST: 'Có chuỗi dấu cảm thán/nghi vấn liên tiếp.',
    MULTIPLE_SPACES: 'Có nhiều khoảng trắng liên tiếp.',
    SPACE_BEFORE_PUNCTUATION: 'Có khoảng trắng đứng trước dấu câu.',
    CLICHE_MATCH: `Khớp cụm cần lưu ý trong cấu hình dự án: “${details.phrase}”.`,
  };
  return descriptions[ruleId] || 'Phát hiện tín hiệu cần xem lại.';
}

function createFinding({ source, sourceSignature, configSignature, runId, text, start, end, ruleId, category, severity, confidence, confidenceBasis, replacement = null, details }) {
  const absoluteStart = source.offsetBase + start;
  const absoluteEnd = source.offsetBase + end;
  return {
    id: `local:${runId}:${source.sceneId}:${ruleId}:${absoluteStart}:${absoluteEnd}`,
    analysis_run_id: runId,
    engine: 'local',
    rule_id: ruleId,
    category,
    severity,
    confidence,
    confidence_basis: confidenceBasis,
    project_id: source.projectId,
    chapter_id: source.chapterId,
    scene_id: source.sceneId,
    evidence: text.slice(start, end),
    explanation: descriptionFor(ruleId, details),
    replacement,
    anchor: buildFindingAnchor(source.sourceText, absoluteStart, absoluteEnd),
    source_signature: sourceSignature,
    config_signature: configSignature,
    status: 'open',
  };
}

function addFinding(state, data) {
  state.findings.push(createFinding({ ...state, ...data }));
}

function quoteCount(paragraph) {
  const curlyPairs = Math.min((paragraph.match(/[“]/g) || []).length, (paragraph.match(/[”]/g) || []).length);
  const singleCurlyPairs = Math.min((paragraph.match(/[‘]/g) || []).length, (paragraph.match(/[’]/g) || []).length);
  const straightPairs = Math.floor((paragraph.match(/"/g) || []).length / 2);
  const dashTurns = (paragraph.match(/(?:^|\n)\s*[—–-]\s+/g) || []).length;
  return curlyPairs + singleCurlyPairs + straightPairs + dashTurns;
}

function speakerCueCount(paragraph) {
  return (paragraph.match(/\b(?:nói|hỏi|đáp|thì thầm|quát|kêu|bảo)\b/giu) || []).length;
}

function analyzeFormatting(state) {
  const { text } = state;
  for (const match of text.matchAll(/[ \t\u00a0]{2,}/g)) {
    addFinding(state, {
      start: match.index,
      end: match.index + match[0].length,
      ruleId: 'MULTIPLE_SPACES',
      category: 'format', severity: 'low', confidence: 1, confidenceBasis: 'exact_match',
      replacement: { text: ' ', kind: 'mechanical', editable: true },
    });
  }
  for (const match of text.matchAll(/[ \t\u00a0]+[,.;:!?]/g)) {
    addFinding(state, {
      start: match.index,
      end: match.index + match[0].length,
      ruleId: 'SPACE_BEFORE_PUNCTUATION',
      category: 'format', severity: 'medium', confidence: 1, confidenceBasis: 'exact_match',
      replacement: { text: match[0].slice(-1), kind: 'mechanical', editable: true },
    });
  }
}

function analyzeLengthAndPacing(state, sentences, paragraphs) {
  for (const sentence of sentences) {
    const count = segmentWords(sentence.text).length;
    if (count >= 45) {
      addFinding(state, {
        start: sentence.index, end: sentence.end, ruleId: 'LONG_SENTENCE', category: 'pacing',
        severity: count >= 70 ? 'high' : 'medium', confidence: 0.9, confidenceBasis: 'threshold', details: { count },
      });
    }
  }

  for (const paragraph of paragraphs) {
    const count = segmentWords(paragraph.text).length;
    if (count >= 120) {
      addFinding(state, {
        start: paragraph.index, end: paragraph.end, ruleId: 'LONG_PARAGRAPH', category: 'pacing',
        severity: count >= 200 ? 'medium' : 'low', confidence: 0.9, confidenceBasis: 'threshold', details: { count },
      });
    }
  }

  for (let index = 0; index <= sentences.length - 5; index += 1) {
    const window = sentences.slice(index, index + 5);
    const windowText = state.text.slice(window[0].index, window[4].end);
    const containsQuotedDialogue = /["“”‘’]/u.test(windowText);
    if (!containsQuotedDialogue && window.every((sentence) => segmentWords(sentence.text).length <= 4)) {
      addFinding(state, {
        start: window[0].index, end: window[4].end, ruleId: 'MECHANICAL_SHORT_RUN', category: 'pacing',
        severity: 'medium', confidence: 0.9, confidenceBasis: 'threshold',
      });
      index += 4;
    }
  }
}

function analyzeRepetition(state, words, sentences) {
  const normalizedWords = words.map((word) => ({
    ...word,
    normalized: normalizeForMatching(word.segment),
    proper: /^\p{Lu}/u.test(word.segment),
  }));

  const reportedTerms = new Set();
  for (let start = 0; start < normalizedWords.length; start += 1) {
    const window = normalizedWords.slice(start, start + 40);
    const counts = new Map();
    for (const word of window) {
      if (word.proper || word.normalized.length < 2 || STOP_WORDS.has(word.normalized)) continue;
      const list = counts.get(word.normalized) || [];
      list.push(word);
      counts.set(word.normalized, list);
    }
    for (const [term, matches] of counts) {
      if (matches.length < 3 || reportedTerms.has(term)) continue;
      reportedTerms.add(term);
      addFinding(state, {
        start: matches[0].index, end: matches[matches.length - 1].end, ruleId: 'REPEATED_TERM_WINDOW', category: 'repetition',
        severity: 'low', confidence: 0.7, confidenceBasis: 'heuristic', details: { term: matches[0].segment },
      });
    }
  }

  const reportedNgrams = new Set();
  for (let size = 6; size >= 3; size -= 1) {
    const seen = new Map();
    for (let index = 0; index <= normalizedWords.length - size; index += 1) {
      const slice = normalizedWords.slice(index, index + size);
      const key = slice.map((word) => word.normalized).join(' ');
      if (!key || reportedNgrams.has(key)) continue;
      const previous = seen.get(key);
      if (previous && index >= previous.index + size) {
        reportedNgrams.add(key);
        addFinding(state, {
          start: previous.start, end: slice[slice.length - 1].end, ruleId: 'REPEATED_NGRAM', category: 'repetition',
          severity: 'low', confidence: 0.7, confidenceBasis: 'heuristic',
        });
      } else if (!previous) {
        seen.set(key, { index, start: slice[0].index });
      }
    }
  }

  for (let index = 0; index <= sentences.length - 3; index += 1) {
    const window = sentences.slice(index, index + 3);
    const openings = window.map((sentence) => segmentWords(sentence.text).slice(0, 2).map((word) => normalizeForMatching(word.segment)));
    const sameTwo = openings.every((opening) => opening.length >= 2 && opening.join(' ') === openings[0].join(' '));
    const sameOne = openings.every((opening) => opening[0] && opening[0] === openings[0][0]);
    if (sameTwo || sameOne) {
      const openingSize = sameTwo ? 2 : 1;
      const openingKey = openings[0].slice(0, openingSize).join(' ');
      addFinding(state, {
        start: window[0].index, end: window[2].end, ruleId: 'REPEATED_OPENING', category: 'repetition',
        severity: 'low', confidence: 0.7, confidenceBasis: 'heuristic',
      });
      let runEnd = index + 3;
      while (runEnd < sentences.length) {
        const nextOpening = segmentWords(sentences[runEnd].text)
          .slice(0, openingSize)
          .map((word) => normalizeForMatching(word.segment))
          .join(' ');
        if (nextOpening !== openingKey) break;
        runEnd += 1;
      }
      index = runEnd - 1;
    }
  }
}

function analyzeDialogueAndPunctuation(state, paragraphs) {
  for (const paragraph of paragraphs) {
    if (quoteCount(paragraph.text) >= 2 || speakerCueCount(paragraph.text) >= 2) {
      addFinding(state, {
        start: paragraph.index, end: paragraph.end, ruleId: 'DENSE_DIALOGUE', category: 'dialogue',
        severity: 'low', confidence: 0.7, confidenceBasis: 'heuristic',
      });
    }
  }

  const pairedQuotes = [['“', '”'], ['‘', '’']];
  for (const [open, close] of pairedQuotes) {
    const openCount = [...state.text].filter((char) => char === open).length;
    const closeCount = [...state.text].filter((char) => char === close).length;
    if (openCount !== closeCount) {
      const position = state.text.search(new RegExp(`[${open}${close}]`, 'u'));
      addFinding(state, {
        start: Math.max(position, 0), end: Math.max(position, 0) + 1, ruleId: 'UNBALANCED_QUOTES', category: 'dialogue',
        severity: 'medium', confidence: 0.9, confidenceBasis: 'threshold',
      });
    }
  }
  const straightQuotes = [...state.text.matchAll(/"/g)];
  if (straightQuotes.length % 2 === 1) {
    const last = straightQuotes.at(-1);
    addFinding(state, {
      start: last.index, end: last.index + 1, ruleId: 'UNBALANCED_QUOTES', category: 'dialogue',
      severity: 'medium', confidence: 0.9, confidenceBasis: 'threshold',
    });
  }

  for (const match of state.text.matchAll(/[!?]{3,}/g)) {
    addFinding(state, {
      start: match.index, end: match.index + match[0].length, ruleId: 'PUNCTUATION_BURST', category: 'style',
      severity: 'low', confidence: 1, confidenceBasis: 'exact_match',
    });
  }
}

function analyzeCliches(state, phraseConfig) {
  const whitelist = new Set((phraseConfig?.whitelist || []).map(normalizeForMatching));
  const blacklist = [...new Set((phraseConfig?.blacklist || []).map(normalizeForMatching).filter(Boolean))];
  for (const phrase of blacklist) {
    if (whitelist.has(phrase)) continue;
    const phraseWords = phrase.split(' ');
    const words = segmentWords(state.text).map((word) => ({ ...word, normalized: normalizeForMatching(word.segment) }));
    for (let index = 0; index <= words.length - phraseWords.length; index += 1) {
      if (words.slice(index, index + phraseWords.length).map((word) => word.normalized).join(' ') !== phrase) continue;
      addFinding(state, {
        start: words[index].index, end: words[index + phraseWords.length - 1].end, ruleId: 'CLICHE_MATCH', category: 'cliche',
        severity: 'medium', confidence: 1, confidenceBasis: 'exact_match', details: { phrase },
      });
    }
  }
}

function dropOverlappingMechanicalFindings(findings) {
  const mechanical = findings.filter((finding) => finding.replacement)
    .sort((left, right) => (right.severity === 'medium') - (left.severity === 'medium'));
  const kept = [];
  for (const finding of mechanical) {
    if (kept.some((other) => finding.anchor.from < other.anchor.to && finding.anchor.to > other.anchor.from)) continue;
    kept.push(finding);
  }
  return findings.filter((finding) => !finding.replacement || kept.includes(finding));
}

export async function analyzeLocalManuscript({ sources = [], scope = 'scene', profile = 'overview', phraseConfig = {}, runId } = {}) {
  const analysisRunId = runId || globalThis.crypto.randomUUID();
  const configSignature = await computePhraseConfigSignature(phraseConfig);
  const findings = [];
  const sourceSignatures = {};
  const metrics = { words: 0, sentences: 0, paragraphs: 0, dialogueParagraphs: 0 };

  for (const input of sources) {
    const source = {
      ...input,
      text: normalizeSourceText(input.text),
      sourceText: normalizeSourceText(input.sourceText ?? input.text),
      offsetBase: Number(input.offsetBase) || 0,
    };
    const sourceSignature = await computeTextSignature(source.sourceText);
    sourceSignatures[source.sceneId] = sourceSignature;
    const words = segmentWords(source.text);
    const sentences = segmentSentences(source.text);
    const paragraphs = segmentParagraphs(source.text);
    metrics.words += words.length;
    metrics.sentences += sentences.length;
    metrics.paragraphs += paragraphs.length;
    metrics.dialogueParagraphs += paragraphs.filter((paragraph) => quoteCount(paragraph.text) > 0).length;

    const state = { source, sourceSignature, configSignature, runId: analysisRunId, text: source.text, findings };
    analyzeFormatting(state);
    analyzeLengthAndPacing(state, sentences, paragraphs);
    analyzeRepetition(state, words, sentences);
    analyzeDialogueAndPunctuation(state, paragraphs);
    analyzeCliches(state, phraseConfig);
  }

  const allowed = PROFILE_CATEGORIES[profile] ?? PROFILE_CATEGORIES.overview;
  const filtered = dropOverlappingMechanicalFindings(findings)
    .filter((finding) => !allowed || allowed.has(finding.category))
    .sort((left, right) => left.scene_id - right.scene_id || left.anchor.from - right.anchor.from);

  return {
    analysis_run_id: analysisRunId,
    scope,
    profile,
    config_signature: configSignature,
    metrics,
    findings: filtered,
    sourceSignatures,
  };
}
