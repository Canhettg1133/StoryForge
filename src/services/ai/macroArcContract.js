const VI_STOPWORDS = new Set([
  'la', 'va', 'cua', 'cho', 'voi', 'trong', 'tren', 'duoi', 'sau', 'truoc',
  'mot', 'nhung', 'cac', 'nhung', 'da', 'dang', 'se', 'duoc', 'bi', 've',
  'tu', 'den', 'tai', 'nay', 'kia', 'do', 'khi', 'neu', 'hay', 'thi', 'ma',
  'de', 'lam', 'nen', 'roi', 'qua', 'rat', 'hon', 'it', 'nhieu', 'nhat',
  'the', 'nho', 'giua', 'giu', 'ra', 'vao', 'cung', 'nhu', 'theo', 'chi',
  'khong', 'chua', 'co', 'can', 'phai', 'moi', 'tung', 'bat', 'dau', 'ket',
  'qua', 'muc', 'tieu', 'noi', 'dung', 'arc', 'chuong', 'phan', 'ke', 'chuyen',
  'cau', 'truyen', 'nhan', 'vat', 'tinh', 'trang', 'trang', 'thai',
]);

const LOW_STAGE_PATTERNS = [
  /gieo mam/,
  /to mo/,
  /an toan/,
  /tin cay/,
  /dang tin/,
  /de y/,
  /chu y/,
  /an tuong/,
  /cam tinh/,
  /hieu ky/,
  /hop tac so khoi/,
  /manh moi tinh cam/,
];

const MID_STAGE_PATTERNS = [
  /cam men/,
  /mo long/,
  /gan gui/,
  /than thiet/,
  /rung dong/,
  /quyen luyen/,
  /thien vi/,
  /uu ai/,
  /bao ve dac biet/,
];

const HIGH_STAGE_PATTERNS = [
  /to tinh/,
  /hen ho/,
  /nguoi yeu/,
  /cap doi/,
  /yeu nhau/,
  /xac lap/,
  /lua chon mot trong/,
  /chon mot trong/,
  /chiem huu/,
  /ghen tuong/,
  /hon nhau/,
  /ket doi/,
  /ket hon/,
  /thanh doi/,
];

const FORBIDDEN_LOW_STAGE_HINTS = [
  'to tinh',
  'hen ho',
  'nguoi yeu',
  'cap doi',
  'yeu nhau',
  'lua chon mot trong',
  'chon mot trong',
  'chiem huu',
  'ghen tuong cong khai',
  'hon nhau',
  'ket doi',
  'ket hon',
];

let fallbackAnchorIdCounter = 0;

function fallbackRandomId() {
  fallbackAnchorIdCounter += 1;
  return [
    Date.now().toString(36),
    fallbackAnchorIdCounter.toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join('');
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\*+/g, ' ')
    .replace(/[“”"']/g, ' ')
    .replace(/[^a-z0-9()\s,:;/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForKeyword(value = '') {
  return normalizeText(value)
    .replace(/[():;,\-/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLine(value = '') {
  return String(value || '')
    .replace(/^\s*[-*•]+\s*/u, '')
    .replace(/^\s*\*+|\*+\s*$/gu, '')
    .trim();
}

function splitOutsideParens(value = '') {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of String(value || '')) {
    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;
    if ((char === ';' || char === '\n') && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    if (char === ',' && depth === 0) {
      const normalizedCurrent = normalizeText(current);
      const looksLikeClauseBoundary = /(, )$/.test(`${current}${char}`)
        || /\b(va|nhung|dong thoi|khơi day|gieo mam|tao nen|dat nen|mo duong)\b/.test(normalizedCurrent);
      if (looksLikeClauseBoundary) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts
    .map((item) => cleanLine(item))
    .filter(Boolean);
}

function tokenizeKeywords(value = '') {
  return [...new Set(
    normalizeForKeyword(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !VI_STOPWORDS.has(token)),
  )];
}

function extractSectionContent(lines, sectionMatchers) {
  const collected = [];
  let active = false;

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    const normalized = normalizeText(line);
    const matchedSection = sectionMatchers.some((matcher) => matcher.test(normalized));
    const startsNewSection = /^(muc tieu|ket qua|tinh trang|trang thai|ghi chu|luu y)\b/.test(normalized);

    if (matchedSection) {
      active = true;
      const afterColon = line.includes(':') ? line.split(':').slice(1).join(':').trim() : '';
      if (afterColon) collected.push(afterColon);
      continue;
    }

    if (active && startsNewSection) break;
    if (active) collected.push(line);
  }

  return collected;
}

function findCharacterMentions(text, allCharacters = []) {
  const normalized = normalizeText(text);
  const names = (Array.isArray(allCharacters) ? allCharacters : [])
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return names.filter((name) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return false;
    const pattern = new RegExp(`(^|\\s)${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
    return pattern.test(normalized);
  });
}

function inferStageScore(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return 0;
  if (HIGH_STAGE_PATTERNS.some((pattern) => pattern.test(normalized))) return 3;
  if (MID_STAGE_PATTERNS.some((pattern) => pattern.test(normalized))) return 2;
  if (LOW_STAGE_PATTERNS.some((pattern) => pattern.test(normalized))) return 1;
  return 0;
}

function inferStateCategory(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return 'general';
  if (/(gieo mam|cam tinh|cam men|rung dong|to tinh|hen ho|nguoi yeu|cap doi|yeu nhau)/.test(normalized)) return 'relationship';
  if (/(an toan|tin cay|dang tin|bao ve|dua vao)/.test(normalized)) return 'trust';
  if (/(to mo|hieu ky|chu y|de y|tham do)/.test(normalized)) return 'curiosity';
  if (/(dong minh|hop tac|phe canh|ton trong)/.test(normalized)) return 'alliance';
  return 'general';
}

function buildObjective(entry, index, allCharacters = []) {
  const text = cleanLine(entry);
  const focusCharacters = findCharacterMentions(text, allCharacters);
  return {
    id: `OBJ${index + 1}`,
    text,
    keywords: tokenizeKeywords(text),
    focusCharacters,
  };
}

function extractTargetStates(stateText, allCharacters = []) {
  const states = [];
  const raw = String(stateText || '');
  const regex = /([A-ZÀ-Ỹ][\p{L}0-9_.-]*(?:\s+[A-ZÀ-Ỹ][\p{L}0-9_.-]*){0,3})\s*\(([^)]+)\)/gu;
  for (const match of raw.matchAll(regex)) {
    const character = cleanLine(match[1]);
    const state = cleanLine(match[2]);
    if (!character || !state) continue;
    states.push({
      character,
      state,
      category: inferStateCategory(state),
      stageScore: inferStageScore(state),
    });
  }

  if (states.length > 0) return states;

  return splitOutsideParens(raw)
    .map((item) => {
      const parts = item.split(':');
      if (parts.length < 2) return null;
      const character = cleanLine(parts.shift());
      const state = cleanLine(parts.join(':'));
      if (!character || !state) return null;
      return {
        character,
        state,
        category: inferStateCategory(state),
        stageScore: inferStageScore(state),
      };
    })
    .filter(Boolean)
    .filter((entry) => entry.character || findCharacterMentions(entry.state, allCharacters).length > 0);
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export function createStableChapterAnchorId() {
  const randomId = globalThis?.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : fallbackRandomId();
  return `anchor_${randomId}`;
}

export function isLegacyChapterAnchorId(value = '') {
  const normalized = String(value || '').trim();
  return /^anchor\d+$/i.test(normalized);
}

function normalizeAnchorId(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || isLegacyChapterAnchorId(normalized)) {
    return createStableChapterAnchorId();
  }
  return normalized;
}

export function normalizeBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 0) return false;
    if (value === 1) return true;
    return fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeMacroArcChapterRange(macroArc = null) {
  const chapter_from = Number(macroArc?.chapter_from) || 0;
  const rawChapterTo = Number(macroArc?.chapter_to) || 0;
  const chapter_to =
    chapter_from > 0 && rawChapterTo > 0
      ? Math.max(chapter_from, rawChapterTo)
      : rawChapterTo;
  return {
    chapter_from,
    chapter_to,
  };
}

export function normalizeChapterAnchorInput(rawAnchor = {}, options = {}) {
  if (!rawAnchor || typeof rawAnchor !== 'object') return null;

  const allCharacters = Array.isArray(options.allCharacters) ? options.allCharacters : [];
  const strictness = String(rawAnchor.strictness || '').trim().toLowerCase() === 'soft'
    ? 'soft'
    : 'hard';
  const rawForbidBefore = rawAnchor.forbidBefore ?? rawAnchor.forbid_before;

  return {
    id: normalizeAnchorId(rawAnchor.id),
    targetChapter: Number(rawAnchor.targetChapter ?? rawAnchor.target_chapter ?? rawAnchor.chapter ?? 0) || 0,
    strictness,
    requirementText: cleanLine(
      rawAnchor.requirementText
      || rawAnchor.requirement_text
      || rawAnchor.text
      || rawAnchor.requirement
      || ''
    ),
    objectiveRefs: uniqueStrings(
      Array.isArray(rawAnchor.objectiveRefs)
        ? rawAnchor.objectiveRefs
        : Array.isArray(rawAnchor.objective_refs)
          ? rawAnchor.objective_refs
          : []
    ),
    focusCharacters: uniqueStrings(
      Array.isArray(rawAnchor.focusCharacters)
        ? rawAnchor.focusCharacters
        : Array.isArray(rawAnchor.focus_characters)
          ? rawAnchor.focus_characters
          : findCharacterMentions(
            rawAnchor.requirementText
            || rawAnchor.requirement_text
            || rawAnchor.text
            || rawAnchor.requirement
            || '',
            allCharacters,
          )
    ),
    successSignals: uniqueStrings(
      Array.isArray(rawAnchor.successSignals)
        ? rawAnchor.successSignals.map((item) => cleanLine(item)).filter(Boolean)
        : Array.isArray(rawAnchor.success_signals)
          ? rawAnchor.success_signals.map((item) => cleanLine(item)).filter(Boolean)
          : []
    ),
    forbidBefore: normalizeBoolean(rawForbidBefore, strictness === 'hard'),
    notes: cleanLine(rawAnchor.notes || ''),
  };
}

function buildAnchorSemanticKey(anchor = {}) {
  const requirementText = normalizeText(anchor.requirementText || anchor.requirement_text || '');
  const focusCharacters = uniqueStrings(
    Array.isArray(anchor.focusCharacters)
      ? anchor.focusCharacters.map((item) => normalizeText(item))
      : Array.isArray(anchor.focus_characters)
        ? anchor.focus_characters.map((item) => normalizeText(item))
        : []
  ).sort();
  return JSON.stringify({
    targetChapter: Number(anchor.targetChapter ?? anchor.target_chapter) || 0,
    strictness: String(anchor.strictness || '').trim().toLowerCase() === 'soft' ? 'soft' : 'hard',
    requirementText,
    forbidBefore: anchor.forbidBefore ?? anchor.forbid_before ?? true,
    focusCharacters,
  });
}

export function preserveChapterAnchorIds(nextAnchors = [], previousAnchors = [], options = {}) {
  const allCharacters = Array.isArray(options.allCharacters) ? options.allCharacters : [];
  const previous = (Array.isArray(previousAnchors) ? previousAnchors : [])
    .map((anchor) => normalizeChapterAnchorInput(anchor, { allCharacters }))
    .filter(Boolean);
  const unusedPrevious = new Map(previous.map((anchor) => [anchor.id, anchor]));
  const semanticBuckets = new Map();

  previous.forEach((anchor) => {
    const semanticKey = buildAnchorSemanticKey(anchor);
    const bucket = semanticBuckets.get(semanticKey) || [];
    bucket.push(anchor);
    semanticBuckets.set(semanticKey, bucket);
  });

  return (Array.isArray(nextAnchors) ? nextAnchors : [])
    .map((anchor) => normalizeChapterAnchorInput(anchor, { allCharacters }))
    .filter(Boolean)
    .map((anchor) => {
      const directId = String(anchor.id || '').trim();
      if (directId && unusedPrevious.has(directId)) {
        unusedPrevious.delete(directId);
        const bucket = semanticBuckets.get(buildAnchorSemanticKey(anchor));
        if (bucket) {
          const bucketIndex = bucket.findIndex((item) => item.id === directId);
          if (bucketIndex >= 0) bucket.splice(bucketIndex, 1);
        }
        return anchor;
      }

      const semanticKey = buildAnchorSemanticKey(anchor);
      const bucket = semanticBuckets.get(semanticKey) || [];
      const matched = bucket.find((item) => unusedPrevious.has(item.id));
      if (!matched) return anchor;

      unusedPrevious.delete(matched.id);
      const bucketIndex = bucket.findIndex((item) => item.id === matched.id);
      if (bucketIndex >= 0) bucket.splice(bucketIndex, 1);
      return {
        ...anchor,
        id: matched.id,
      };
    });
}

export function serializeChapterAnchorInput(anchor = null) {
  if (!anchor || typeof anchor !== 'object') return null;
  return {
    id: String(anchor.id || '').trim(),
    target_chapter: Number(anchor.targetChapter ?? anchor.target_chapter) || 0,
    strictness: String(anchor.strictness || '').trim().toLowerCase() === 'soft' ? 'soft' : 'hard',
    requirement_text: cleanLine(anchor.requirementText || anchor.requirement_text || ''),
    objective_refs: uniqueStrings(
      Array.isArray(anchor.objectiveRefs)
        ? anchor.objectiveRefs
        : Array.isArray(anchor.objective_refs)
          ? anchor.objective_refs
          : []
    ),
    focus_characters: uniqueStrings(
      Array.isArray(anchor.focusCharacters)
        ? anchor.focusCharacters
        : Array.isArray(anchor.focus_characters)
          ? anchor.focus_characters
          : []
    ),
    success_signals: uniqueStrings(
      Array.isArray(anchor.successSignals)
        ? anchor.successSignals.map((item) => cleanLine(item)).filter(Boolean)
        : Array.isArray(anchor.success_signals)
          ? anchor.success_signals.map((item) => cleanLine(item)).filter(Boolean)
          : []
    ),
    forbid_before: normalizeBoolean(anchor.forbidBefore ?? anchor.forbid_before, true),
    notes: cleanLine(anchor.notes || ''),
  };
}

function normalizeTargetState(rawState) {
  if (!rawState || typeof rawState !== 'object') return null;
  const character = cleanLine(rawState.character || rawState.name || '');
  const state = cleanLine(rawState.state || rawState.status || rawState.target || '');
  if (!character || !state) return null;
  return {
    character,
    state,
    category: inferStateCategory(state),
    stageScore: inferStageScore(state),
  };
}

function normalizeObjective(rawObjective, index = 0, allCharacters = []) {
  const text = cleanLine(
    typeof rawObjective === 'string'
      ? rawObjective
      : rawObjective?.text || rawObjective?.objective || rawObjective?.description || ''
  );
  if (!text) return null;
  const focusCharacters = Array.isArray(rawObjective?.focusCharacters)
    ? rawObjective.focusCharacters.filter(Boolean)
    : Array.isArray(rawObjective?.focus_characters)
      ? rawObjective.focus_characters.filter(Boolean)
      : findCharacterMentions(text, allCharacters);
  return {
    id: String(rawObjective?.id || `OBJ${index + 1}`).trim(),
    text,
    keywords: Array.isArray(rawObjective?.keywords) && rawObjective.keywords.length > 0
      ? uniqueStrings(rawObjective.keywords.map((item) => normalizeForKeyword(item)).filter(Boolean))
      : tokenizeKeywords(text),
    focusCharacters: uniqueStrings(focusCharacters),
  };
}

function normalizeChapterAnchor(rawAnchor, index = 0, allCharacters = []) {
  const normalized = normalizeChapterAnchorInput(rawAnchor, { allCharacters });
  if (!normalized) return null;

  const targetChapter = Number(normalized.targetChapter) || 0;
  const requirementText = cleanLine(normalized.requirementText || '');
  if (!targetChapter || !requirementText) return null;

  return {
    id: normalized.id,
    targetChapter,
    strictness: normalized.strictness,
    requirementText,
    objectiveRefs: normalized.objectiveRefs,
    focusCharacters: normalized.focusCharacters,
    successSignals: normalized.successSignals,
    forbidBefore: normalized.forbidBefore,
    notes: normalized.notes,
  };
}

function extractFallbackChapterAnchors(description = '', allCharacters = []) {
  const lines = String(description || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  return lines
    .map((line, index) => {
      const match = line.match(/chuong\s+(\d+)\s*(?:[:\-]\s*|(bat buoc|phai|nen)\s+)(.+)$/iu);
      if (!match) return null;
      const strictness = /nen/i.test(match[2] || '') ? 'soft' : 'hard';
      return normalizeChapterAnchor({
        target_chapter: Number(match[1]) || 0,
        strictness,
        requirement_text: cleanLine(match[3] || ''),
        focus_characters: findCharacterMentions(match[3] || '', allCharacters),
        forbid_before: strictness === 'hard',
      }, index, allCharacters);
    })
    .filter(Boolean);
}

function uniqueChapterAnchors(anchors = []) {
  const seen = new Set();
  return (anchors || []).filter((anchor) => {
    const id = String(anchor?.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getRawMacroArcChapterAnchorsForValidation(macroArc = null) {
  if (!macroArc || typeof macroArc !== 'object') return null;
  if (Array.isArray(macroArc.chapter_anchors)) return macroArc.chapter_anchors;

  const rawContract = macroArc.contract_json || macroArc.contract || macroArc.macro_arc_contract || null;
  if (!rawContract) return null;

  try {
    const parsed = typeof rawContract === 'string' ? JSON.parse(rawContract) : rawContract;
    if (!parsed || typeof parsed !== 'object') return null;
    if (Array.isArray(parsed.chapter_anchors)) return parsed.chapter_anchors;
    if (Array.isArray(parsed.chapterAnchors)) return parsed.chapterAnchors;
  } catch {
    return null;
  }

  return null;
}

export function validateMacroArcChapterAnchors(macroArcOrContract = null) {
  if (!macroArcOrContract) return [];
  const isCompiledContract = Array.isArray(macroArcOrContract?.chapterAnchors);
  const rawChapterAnchors = isCompiledContract
    ? null
    : getRawMacroArcChapterAnchorsForValidation(macroArcOrContract);
  const contract = isCompiledContract
    ? macroArcOrContract
    : rawChapterAnchors === null
      ? compileMacroArcContract(macroArcOrContract)
      : null;
  const normalizedRange = normalizeMacroArcChapterRange({
    chapter_from:
      (isCompiledContract ? contract?.chapterFrom : macroArcOrContract?.chapter_from)
      ?? contract?.chapter_from
      ?? macroArcOrContract?.chapterFrom,
    chapter_to:
      (isCompiledContract ? contract?.chapterTo : macroArcOrContract?.chapter_to)
      ?? contract?.chapter_to
      ?? macroArcOrContract?.chapterTo,
  });
  const chapterFrom = normalizedRange.chapter_from;
  const chapterTo = normalizedRange.chapter_to;
  const issues = [];
  const seenIds = new Set();
  const seenRawIds = new Set();
  const anchorsToValidate = rawChapterAnchors !== null
    ? rawChapterAnchors
      .map((anchor, index) => ({
        rawId: String(anchor?.id || '').trim(),
        normalized: normalizeChapterAnchorInput(anchor, { index }) || anchor,
      }))
      .filter((item) => item.normalized)
    : (contract?.chapterAnchors || []).map((anchor) => ({
      rawId: String(anchor?.id || '').trim(),
      normalized: anchor,
    }));

  anchorsToValidate.forEach(({ rawId, normalized: anchor }) => {
    if (!anchor?.targetChapter || !anchor?.requirementText) {
      issues.push({
        code: 'anchor-incomplete',
        severity: anchor?.strictness === 'soft' ? 'warning' : 'error',
        anchorId: anchor?.id || '',
        message: `Anchor ${anchor?.id || ''} dang thieu chapter hoac noi dung bat buoc.`,
      });
      return;
    }

    if (rawChapterAnchors !== null && rawId) {
      if (seenRawIds.has(rawId)) {
        issues.push({
          code: 'anchor-duplicate-id',
          severity: 'error',
          anchorId: rawId,
          message: `Trung id chapter anchor ${rawId}.`,
        });
        return;
      }
      seenRawIds.add(rawId);
    }

    if (
      anchor.strictness === 'hard'
      && chapterFrom > 0
      && chapterTo >= chapterFrom
      && (anchor.targetChapter < chapterFrom || anchor.targetChapter > chapterTo)
    ) {
      issues.push({
        code: 'anchor-out-of-range',
        severity: 'error',
        anchorId: anchor.id,
        message: `Hard anchor ${anchor.id} nam ngoai pham vi cot moc (${chapterFrom}-${chapterTo}).`,
      });
    }

    if (rawChapterAnchors === null && seenIds.has(anchor.id)) {
      issues.push({
        code: 'anchor-duplicate-id',
        severity: 'error',
        anchorId: anchor.id,
        message: `Trung id chapter anchor ${anchor.id}.`,
      });
      return;
    }
    if (rawChapterAnchors === null) {
      seenIds.add(anchor.id);
    }
  });

  return issues;
}

export function parseStoredMacroArcContract(macroArc = null, options = {}) {
  const rawContract = macroArc?.contract_json || macroArc?.contract || macroArc?.macro_arc_contract || null;
  if (!rawContract) return null;

  try {
    const parsed = typeof rawContract === 'string' ? JSON.parse(rawContract) : rawContract;
    if (!parsed || typeof parsed !== 'object') return null;

    const allCharacters = Array.isArray(options.allCharacters) ? options.allCharacters : [];
    const objectives = (Array.isArray(parsed.objectives) ? parsed.objectives : [])
      .map((item, index) => normalizeObjective(item, index, allCharacters))
      .filter(Boolean);
    const targetStates = (Array.isArray(parsed.targetStates || parsed.target_states) ? (parsed.targetStates || parsed.target_states) : [])
      .map((item) => normalizeTargetState(item))
      .filter(Boolean);
    const focusedCharacters = uniqueStrings(
      Array.isArray(parsed.focusedCharacters || parsed.focused_characters)
        ? (parsed.focusedCharacters || parsed.focused_characters)
        : []
    );
    const forbiddenOutcomes = uniqueStrings(
      Array.isArray(parsed.forbiddenOutcomes || parsed.forbidden_outcomes)
        ? (parsed.forbiddenOutcomes || parsed.forbidden_outcomes)
        : []
    );
    const explicitChapterAnchors = Array.isArray(macroArc?.chapter_anchors)
      ? macroArc.chapter_anchors
      : null;
    const chapterAnchors = (
      explicitChapterAnchors !== null
        ? explicitChapterAnchors
        : Array.isArray(parsed.chapterAnchors || parsed.chapter_anchors)
          ? (parsed.chapterAnchors || parsed.chapter_anchors)
          : []
    )
      .map((item, index) => normalizeChapterAnchor(item, index, allCharacters))
      .filter(Boolean);
    const maxRelationshipStage = Number.isFinite(Number(parsed.maxRelationshipStage ?? parsed.max_relationship_stage))
      ? Number(parsed.maxRelationshipStage ?? parsed.max_relationship_stage)
      : targetStates
        .filter((item) => ['relationship', 'trust', 'curiosity'].includes(item.category))
        .reduce((max, item) => Math.max(max, Number(item.stageScore) || 0), 0);

    return {
      title: String(parsed.title || macroArc?.title || '').trim(),
      chapterFrom: Number(parsed.chapterFrom ?? parsed.chapter_from ?? macroArc?.chapter_from) || 0,
      chapterTo: Number(parsed.chapterTo ?? parsed.chapter_to ?? macroArc?.chapter_to) || 0,
      emotionalPeak: String(parsed.emotionalPeak || parsed.emotional_peak || macroArc?.emotional_peak || '').trim(),
      narrativeSummary: String(parsed.narrativeSummary || parsed.narrative_summary || macroArc?.description || '').trim(),
      objectives,
      targetStates,
      focusedCharacters,
      maxRelationshipStage,
      forbiddenOutcomes,
      chapterAnchors: uniqueChapterAnchors(chapterAnchors),
    };
  } catch {
    return null;
  }
}

function buildForbiddenOutcomes(targetStates = [], objectives = []) {
  const objectiveText = objectives.map((item) => item.text).join(' ');
  const maxStageScore = targetStates.reduce((max, item) => Math.max(max, Number(item.stageScore) || 0), 0);
  const hasLowIntensityArc = targetStates.length > 0 && maxStageScore <= 1;
  const mentionsLowSeeding = /(gieo mam|to mo|an toan|tin cay|dang tin)/.test(normalizeText(objectiveText));
  const hints = [];

  if (hasLowIntensityArc || mentionsLowSeeding) {
    hints.push(...FORBIDDEN_LOW_STAGE_HINTS);
  }

  if (targetStates.length >= 2 && (hasLowIntensityArc || mentionsLowSeeding)) {
    hints.push('tam giac tinh cam cong khai');
    hints.push('tranh gianh tinh cam');
  }

  return uniqueStrings(hints);
}

export function compileMacroArcContract(macroArc = null, options = {}) {
  if (!macroArc) return null;

  const stored = parseStoredMacroArcContract(macroArc, options);
  if (stored) return stored;

  const normalizedRange = normalizeMacroArcChapterRange(macroArc);
  const allCharacters = Array.isArray(options.allCharacters) ? options.allCharacters : [];
  const narrativeText = String(macroArc.description || '').trim();
  const lines = narrativeText
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const objectiveLines = extractSectionContent(lines, [
    /muc tieu/,
    /ket qua/,
  ]);
  const stateLines = extractSectionContent(lines, [
    /tinh trang/,
    /trang thai/,
  ]);

  const narrativeSummary = lines
    .filter((line) => {
      const normalized = normalizeText(line);
      return !/^(muc tieu|ket qua|tinh trang|trang thai)\b/.test(normalized);
    })
    .join(' ')
    .trim();

  const objectiveEntries = [
    ...splitOutsideParens(objectiveLines.join('\n')),
    ...(!objectiveLines.length && narrativeSummary ? splitOutsideParens(narrativeSummary) : []),
  ]
    .map((item) => cleanLine(item))
    .filter(Boolean)
    .slice(0, 6);

  const objectives = objectiveEntries.map((item, index) => buildObjective(item, index, allCharacters));
  const targetStates = extractTargetStates(stateLines.join('\n'), allCharacters);

  const focusedCharacters = uniqueStrings([
    ...targetStates.map((item) => item.character),
    ...objectives.flatMap((item) => item.focusCharacters || []),
    ...findCharacterMentions(`${macroArc.title || ''} ${narrativeSummary}`, allCharacters),
  ]);

  const maxRelationshipStage = targetStates
    .filter((item) => ['relationship', 'trust', 'curiosity'].includes(item.category))
    .reduce((max, item) => Math.max(max, Number(item.stageScore) || 0), 0);
  const explicitChapterAnchors = Array.isArray(macroArc?.chapter_anchors)
    ? macroArc.chapter_anchors
    : null;
  const chapterAnchors = explicitChapterAnchors !== null
    ? explicitChapterAnchors
      .map((item, index) => normalizeChapterAnchor(item, index, allCharacters))
      .filter(Boolean)
    : extractFallbackChapterAnchors(narrativeText, allCharacters);

  return {
    title: String(macroArc.title || '').trim(),
    chapterFrom: normalizedRange.chapter_from,
    chapterTo: normalizedRange.chapter_to,
    emotionalPeak: String(macroArc.emotional_peak || '').trim(),
    narrativeSummary,
    objectives,
    targetStates,
    focusedCharacters,
    maxRelationshipStage,
    forbiddenOutcomes: buildForbiddenOutcomes(targetStates, objectives),
    chapterAnchors: uniqueChapterAnchors(chapterAnchors),
  };
}

export function serializeMacroArcContract(contract = null) {
  if (!contract) return '';
  return JSON.stringify({
    title: contract.title || '',
    chapter_from: contract.chapterFrom || 0,
    chapter_to: contract.chapterTo || 0,
    emotional_peak: contract.emotionalPeak || '',
    narrative_summary: contract.narrativeSummary || '',
    objectives: (contract.objectives || []).map((item) => ({
      id: item.id,
      text: item.text,
      keywords: item.keywords || [],
      focusCharacters: item.focusCharacters || [],
    })),
    target_states: (contract.targetStates || []).map((item) => ({
      character: item.character,
      state: item.state,
      category: item.category,
      stageScore: item.stageScore,
    })),
    focused_characters: contract.focusedCharacters || [],
    max_relationship_stage: contract.maxRelationshipStage || 0,
    forbidden_outcomes: contract.forbiddenOutcomes || [],
    chapter_anchors: (contract.chapterAnchors || [])
      .map((item) => serializeChapterAnchorInput(item))
      .filter(Boolean),
  });
}

export function buildMacroArcPersistenceSnapshot(macroArc = null, options = {}) {
  if (!macroArc) return null;
  const normalizedRange = normalizeMacroArcChapterRange(macroArc);

  const base = {
    title: String(macroArc.title || '').trim(),
    description: String(macroArc.description || '').trim(),
    chapter_from: normalizedRange.chapter_from,
    chapter_to: normalizedRange.chapter_to,
    emotional_peak: String(macroArc.emotional_peak || '').trim(),
  };
  const allCharacters = Array.isArray(options.allCharacters) ? options.allCharacters : [];
  const storedContract = parseStoredMacroArcContract(macroArc, options);
  const chapterAnchorsSource = Array.isArray(macroArc.chapter_anchors)
    ? macroArc.chapter_anchors
    : (storedContract?.chapterAnchors || []);
  const chapter_anchors = chapterAnchorsSource
    .map((anchor) => normalizeChapterAnchorInput(anchor, { allCharacters }))
    .filter(Boolean);
  const contract = compileMacroArcContract({
    ...base,
    chapter_anchors,
    contract_json: '',
    contract: null,
    macro_arc_contract: null,
  }, options);
  const serializedContract = contract
    ? JSON.parse(serializeMacroArcContract(contract))
    : {};

  serializedContract.title = base.title;
  serializedContract.chapter_from = base.chapter_from;
  serializedContract.chapter_to = base.chapter_to;
  serializedContract.emotional_peak = base.emotional_peak;
  if (!serializedContract.narrative_summary) {
    serializedContract.narrative_summary = base.description;
  }
  serializedContract.chapter_anchors = chapter_anchors
    .map((anchor) => serializeChapterAnchorInput(anchor))
    .filter(Boolean);

  return {
    ...macroArc,
    ...base,
    chapter_anchors,
    contract,
    contract_json: JSON.stringify(serializedContract),
  };
}

function objectiveMatchesChapter(objective, normalizedChapterText) {
  const keywords = Array.isArray(objective?.keywords) ? objective.keywords : [];
  if (keywords.length === 0) return false;
  const hitCount = keywords.filter((token) => normalizedChapterText.includes(token)).length;
  if (hitCount >= 2) return true;

  const focusCharacters = Array.isArray(objective?.focusCharacters) ? objective.focusCharacters : [];
  if (focusCharacters.length === 0) return false;
  return focusCharacters.some((name) => normalizedChapterText.includes(normalizeText(name))) && hitCount >= 1;
}

function getAnchorSignals(anchor = {}) {
  return uniqueStrings([
    String(anchor.requirementText || '').trim(),
    ...(Array.isArray(anchor.successSignals) ? anchor.successSignals : []),
  ]);
}

function chapterMatchesAnchor(chapter = {}, anchor = {}) {
  const chapterText = normalizeText([
    chapter?.title,
    chapter?.purpose,
    chapter?.summary,
    Array.isArray(chapter?.key_events) ? chapter.key_events.join(' ') : '',
    Array.isArray(chapter?.objective_refs) ? chapter.objective_refs.join(' ') : '',
    Array.isArray(chapter?.anchor_refs) ? chapter.anchor_refs.join(' ') : '',
    chapter?.state_delta,
    chapter?.arc_guard_note,
    chapter?.content,
    chapter?.text,
  ].filter(Boolean).join(' '));
  if (!chapterText) return false;

  const phraseSignals = getAnchorSignals(anchor)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const negationCandidates = uniqueStrings(
    phraseSignals.flatMap((item) => {
      const words = item.split(' ').filter(Boolean);
      if (words.length <= 1) return [item];
      return [
        item,
        words.slice(1).join(' '),
        words.slice(-Math.min(3, words.length)).join(' '),
      ].filter(Boolean);
    })
  );
  const hasNegatedSignal = negationCandidates.some((item) => {
    if (item.length < 4) return false;
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:khong|chua|van chua|chua he)\\b(?:\\s+\\w+){0,2}\\s+${escaped}`, 'i').test(chapterText);
  });
  if (hasNegatedSignal) {
    return false;
  }
  if (phraseSignals.some((item) => item.length >= 6 && chapterText.includes(item))) {
    return true;
  }

  const keywords = uniqueStrings(
    getAnchorSignals(anchor).flatMap((item) => tokenizeKeywords(item))
  );
  const hitCount = keywords.filter((token) => chapterText.includes(token)).length;
  const focusCharacters = Array.isArray(anchor.focusCharacters) ? anchor.focusCharacters : [];
  const focusHit = focusCharacters.length === 0
    || focusCharacters.some((name) => chapterText.includes(normalizeText(name)));

  return (focusHit && hitCount >= 2) || hitCount >= 3;
}

export function getChapterAnchorsInRange(contract = null, chapterStart = 0, chapterEnd = chapterStart) {
  if (!contract) return [];
  const start = Number(chapterStart) || 0;
  const end = Math.max(start, Number(chapterEnd) || start);
  return (contract.chapterAnchors || [])
    .filter((anchor) => anchor?.targetChapter >= start && anchor?.targetChapter <= end);
}

export function validateOutlineAgainstChapterAnchors(generatedOutline, chapterAnchors = [], options = {}) {
  const chapters = Array.isArray(generatedOutline?.chapters) ? generatedOutline.chapters : [];
  const startChapterNumber = Number(options.startChapterNumber) || 1;
  const endChapterNumber = startChapterNumber + Math.max(0, chapters.length - 1);
  if (chapters.length === 0 || !Array.isArray(chapterAnchors) || chapterAnchors.length === 0) {
    return [];
  }

  const issues = [];

  chapterAnchors.forEach((anchor) => {
    if (!anchor?.targetChapter || anchor.targetChapter < startChapterNumber || anchor.targetChapter > endChapterNumber) {
      return;
    }

    const severity = anchor.strictness === 'soft' ? 'warning' : 'error';
    const targetIndex = anchor.targetChapter - startChapterNumber;
    const targetChapter = chapters[targetIndex];
    const matchedIndexes = [];
    const refIndexes = [];

    chapters.forEach((chapter, index) => {
      const hasRef = Array.isArray(chapter?.anchor_refs) && chapter.anchor_refs.includes(anchor.id);
      const hasContent = chapterMatchesAnchor(chapter, anchor);
      if (hasRef) refIndexes.push(index);
      if (hasRef || hasContent) matchedIndexes.push(index);
    });

    if (!Array.isArray(targetChapter?.anchor_refs) || !targetChapter.anchor_refs.includes(anchor.id)) {
      issues.push({
        chapterIndex: targetIndex,
        chapterTitle: targetChapter?.title || `Chuong ${anchor.targetChapter}`,
        code: `${anchor.strictness}-anchor-missing-ref`,
        severity,
        anchorId: anchor.id,
        message: `Chuong ${anchor.targetChapter} phai khai bao anchor_refs cho ${anchor.id}.`,
      });
    }

    if (!targetChapter || !chapterMatchesAnchor(targetChapter, anchor)) {
      issues.push({
        chapterIndex: targetIndex,
        chapterTitle: targetChapter?.title || `Chuong ${anchor.targetChapter}`,
        code: `${anchor.strictness}-anchor-missed`,
        severity,
        anchorId: anchor.id,
        message: `Chuong ${anchor.targetChapter} chua the hien ro yeu cau anchor ${anchor.id}.`,
      });
    }

    matchedIndexes
      .filter((index) => index !== targetIndex)
      .forEach((index) => {
        const code = index < targetIndex && anchor.forbidBefore !== false
          ? `${anchor.strictness}-anchor-early`
          : `${anchor.strictness}-anchor-wrong-chapter`;
        const chapterNumber = startChapterNumber + index;
        issues.push({
          chapterIndex: index,
          chapterTitle: chapters[index]?.title || `Chuong ${chapterNumber}`,
          code,
          severity,
          anchorId: anchor.id,
          message: code.endsWith('early')
            ? `Anchor ${anchor.id} dang bi day som truoc Chuong ${anchor.targetChapter}.`
            : `Anchor ${anchor.id} dang roi vao Chuong ${chapterNumber} thay vi Chuong ${anchor.targetChapter}.`,
        });
      });

    refIndexes
      .filter((index) => index !== targetIndex)
      .forEach((index) => {
        const chapterNumber = startChapterNumber + index;
        const hasWrongChapterIssue = issues.some((issue) => (
          issue.anchorId === anchor.id
          && issue.chapterIndex === index
          && issue.code.endsWith('wrong-chapter')
        ));
        if (hasWrongChapterIssue) return;
        issues.push({
          chapterIndex: index,
          chapterTitle: chapters[index]?.title || `Chuong ${chapterNumber}`,
          code: `${anchor.strictness}-anchor-wrong-chapter`,
          severity,
          anchorId: anchor.id,
          message: `anchor_refs cua ${anchor.id} dang nam sai Chuong ${chapterNumber}.`,
        });
      });
  });

  return issues;
}

export function validateDraftAgainstChapterAnchors(chapterDraft = {}, chapterAnchors = [], options = {}) {
  const currentChapterNumber = Number(options.currentChapterNumber) || 0;
  if (!currentChapterNumber || !Array.isArray(chapterAnchors) || chapterAnchors.length === 0) {
    return [];
  }

  const issues = [];
  const chapterSnapshot = {
    ...chapterDraft,
    content: chapterDraft?.content || chapterDraft?.text || '',
  };

  chapterAnchors.forEach((anchor) => {
    const severity = anchor.strictness === 'soft' ? 'warning' : 'error';
    const hasMatch = chapterMatchesAnchor(chapterSnapshot, anchor);

    if (anchor.targetChapter === currentChapterNumber && !hasMatch) {
      issues.push({
        code: `${anchor.strictness}-anchor-missed`,
        severity,
        anchorId: anchor.id,
        message: `Ban nhap chuong ${currentChapterNumber} chua dat yeu cau anchor ${anchor.id}.`,
      });
    }

    if (anchor.targetChapter > currentChapterNumber && anchor.forbidBefore !== false && hasMatch) {
      issues.push({
        code: `${anchor.strictness}-anchor-early`,
        severity,
        anchorId: anchor.id,
        message: `Ban nhap chuong ${currentChapterNumber} dang dat som anchor ${anchor.id} truoc chuong dich ${anchor.targetChapter}.`,
      });
    }
  });

  return issues;
}

export function getChapterRelationshipStage(chapter = {}) {
  const combined = normalizeText([
    chapter?.title,
    chapter?.purpose,
    chapter?.summary,
    Array.isArray(chapter?.key_events) ? chapter.key_events.join(' ') : '',
    Array.isArray(chapter?.objective_refs) ? chapter.objective_refs.join(' ') : '',
    chapter?.state_delta,
    chapter?.arc_guard_note,
  ].filter(Boolean).join(' '));

  return inferStageScore(combined);
}

export function validateOutlineAgainstMacroArcContract(generatedOutline, macroArcContract, options = {}) {
  const contract = macroArcContract || null;
  const chapters = Array.isArray(generatedOutline?.chapters) ? generatedOutline.chapters : [];
  if (!contract || chapters.length === 0) {
    return [];
  }

  const issues = [];
  const coveredObjectiveIds = new Set();

  chapters.forEach((chapter, index) => {
    const chapterText = normalizeText([
      chapter?.title,
      chapter?.purpose,
      chapter?.summary,
      Array.isArray(chapter?.key_events) ? chapter.key_events.join(' ') : '',
      Array.isArray(chapter?.objective_refs) ? chapter.objective_refs.join(' ') : '',
      chapter?.state_delta,
      chapter?.arc_guard_note,
    ].filter(Boolean).join(' '));

    const objectiveHits = contract.objectives.filter((objective) => objectiveMatchesChapter(objective, chapterText));
    objectiveHits.forEach((objective) => coveredObjectiveIds.add(objective.id));

    if (contract.objectives.length > 0 && objectiveHits.length === 0) {
      issues.push({
        chapterIndex: index,
        chapterTitle: chapter?.title || `Chuong ${index + 1}`,
        code: 'macro-drift',
        severity: 'warning',
        message: 'Chapter nay chua bam ro vao muc tieu/noi dung cot loi cua dai cuc hien tai.',
      });
    }

    if (contract.focusedCharacters.length > 0) {
      const hasFocusedCharacter = contract.focusedCharacters.some((name) => chapterText.includes(normalizeText(name)));
      if (!hasFocusedCharacter && objectiveHits.length === 0) {
        issues.push({
          chapterIndex: index,
          chapterTitle: chapter?.title || `Chuong ${index + 1}`,
          code: 'macro-focus-miss',
          severity: 'warning',
          message: 'Chapter nay khong nhac ro den nhan vat/truc tieu diem ma dai cuc dang theo doi.',
        });
      }
    }

    if (contract.forbiddenOutcomes.some((hint) => chapterText.includes(normalizeText(hint)))) {
      issues.push({
        chapterIndex: index,
        chapterTitle: chapter?.title || `Chuong ${index + 1}`,
        code: 'macro-forbidden-outcome',
        severity: 'error',
        message: 'Chapter co dau hieu vuot qua ket qua/trang thai ma dai cuc hien tai cho phep.',
      });
    }

    if (contract.maxRelationshipStage > 0) {
      const chapterStage = getChapterRelationshipStage(chapter);
      if (chapterStage > contract.maxRelationshipStage) {
        issues.push({
          chapterIndex: index,
          chapterTitle: chapter?.title || `Chuong ${index + 1}`,
          code: 'macro-state-overshoot',
          severity: 'error',
          message: 'Chapter day nhanh hon trang thai muc tieu cua dai cuc hien tai.',
        });
      }
    }
  });

  if (contract.objectives.length > 0 && coveredObjectiveIds.size === 0) {
    issues.push({
      chapterIndex: null,
      chapterTitle: '',
      code: 'macro-drift',
      severity: 'error',
      message: 'Ca batch chuong chua bam duoc vao muc tieu/noi dung cot loi cua dai cuc hien tai.',
    });
  } else if (contract.objectives.length > 1 && coveredObjectiveIds.size < Math.min(2, contract.objectives.length)) {
    issues.push({
      chapterIndex: null,
      chapterTitle: '',
      code: 'macro-objective-gap',
      severity: 'warning',
      message: 'Batch chuong moi chi cover mot phan nho muc tieu dai cuc; nen phan bo lai de bam sat arc hon.',
    });
  }

  if (contract.chapterAnchors?.length > 0) {
    issues.push(...validateOutlineAgainstChapterAnchors(generatedOutline, contract.chapterAnchors, {
      startChapterNumber: Number(options.startChapterNumber) || Number(contract.chapterFrom) || 1,
    }));
  }

  return issues;
}

export function formatMacroArcContract(contract, options = {}) {
  if (!contract) return '';
  const lines = [];
  const header = options.header || '[HOP DONG DAI CUC]';
  lines.push(header);
  if (contract.title) lines.push('Ten dai cuc: ' + contract.title);
  if (contract.chapterFrom || contract.chapterTo) {
    lines.push('Pham vi: Chuong ' + (contract.chapterFrom || '?') + ' den Chuong ' + (contract.chapterTo || '?'));
  }
  if (contract.narrativeSummary) lines.push('Noi dung cot loi: ' + contract.narrativeSummary);
  if (contract.objectives.length > 0) {
    lines.push('Muc tieu cot loi:');
    contract.objectives.forEach((objective) => {
      lines.push('- ' + objective.id + ': ' + objective.text);
    });
  }
  if (contract.focusedCharacters.length > 0) {
    lines.push('Nhan vat/truc tieu diem: ' + contract.focusedCharacters.join(', '));
  }
  if (contract.targetStates.length > 0) {
    lines.push('Trang thai dich duoc phep khi ket thuc arc nay:');
    contract.targetStates.forEach((state) => {
      lines.push('- ' + state.character + ': ' + state.state);
    });
  }
  if (contract.forbiddenOutcomes.length > 0) {
    lines.push('Ket qua bi cam trong arc nay:');
    contract.forbiddenOutcomes.forEach((item) => {
      lines.push('- ' + item);
    });
  }
  if (contract.chapterAnchors?.length > 0) {
    lines.push('Chapter anchors bat buoc:');
    contract.chapterAnchors.forEach((anchor) => {
      const pieces = [
        anchor.id,
        'Chuong ' + anchor.targetChapter,
        anchor.strictness === 'soft' ? 'SOFT' : 'HARD',
        anchor.requirementText,
      ];
      if (anchor.forbidBefore !== false) pieces.push('khong duoc som hon');
      lines.push('- ' + pieces.join(' | '));
    });
  }
  return lines.join('\n');
}
