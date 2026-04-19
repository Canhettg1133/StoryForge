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

  return {
    title: String(macroArc.title || '').trim(),
    chapterFrom: Number(macroArc.chapter_from) || 0,
    chapterTo: Number(macroArc.chapter_to) || 0,
    emotionalPeak: String(macroArc.emotional_peak || '').trim(),
    narrativeSummary,
    objectives,
    targetStates,
    focusedCharacters,
    maxRelationshipStage,
    forbiddenOutcomes: buildForbiddenOutcomes(targetStates, objectives),
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
  });
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

export function validateOutlineAgainstMacroArcContract(generatedOutline, macroArcContract) {
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
  return lines.join('\n');
}
