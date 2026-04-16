function normalizeBlueprintText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLooseList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // Fall back to loose CSV/newline parsing.
  }

  return trimmed
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeNormalized(values = []) {
  const seen = new Set();
  const deduped = [];
  values.forEach((value) => {
    const cleanValue = String(value || '').trim();
    const normalized = normalizeBlueprintText(cleanValue);
    if (!cleanValue || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(cleanValue);
  });
  return deduped;
}

export function normalizeChapterListField(value) {
  return dedupeNormalized(parseLooseList(value));
}

function normalizeOptionalText(value) {
  return String(value || '').trim();
}

function chapterHasCanonAnchor(chapter = {}) {
  return normalizeChapterListField(chapter.thread_titles).length > 0
    || normalizeChapterListField(chapter.key_events).length > 0;
}

function buildChapterSearchText(chapter = {}) {
  return normalizeBlueprintText([
    chapter.title,
    chapter.purpose,
    chapter.summary,
    ...(normalizeChapterListField(chapter.featured_characters)),
    chapter.primary_location,
    ...(normalizeChapterListField(chapter.thread_titles)),
    ...(normalizeChapterListField(chapter.key_events)),
    ...(normalizeChapterListField(chapter.required_factions)),
    ...(normalizeChapterListField(chapter.required_terms)),
    ...(normalizeChapterListField(chapter.required_objects)),
  ].filter(Boolean).join(' \n '));
}

function hasEarlyStorySignal(value) {
  const normalized = normalizeBlueprintText(value);
  if (!normalized) return false;

  const earlySignals = [
    'mo dau',
    'opening',
    'chapter dau',
    'chuong 1',
    'chuong 2',
    'chap 1',
    'chap 2',
    'xuat hien som',
    'gioi thieu som',
    'neo som',
  ];

  return earlySignals.some((signal) => normalized.includes(signal));
}

function isEarlyRelevantEntity(entity = {}, requiredFieldName, chapterSignals = []) {
  const normalizedName = normalizeBlueprintText(getBlueprintEntityName(entity));
  if (!normalizedName) return false;

  if (chapterSignals.some((chapterSignal) => (
    Array.isArray(chapterSignal[requiredFieldName])
    && chapterSignal[requiredFieldName].some((item) => normalizeBlueprintText(item) === normalizedName)
  ))) {
    return true;
  }

  return hasEarlyStorySignal(entity.story_function);
}

function createIssue(type, code, message, meta = {}) {
  return {
    type,
    code,
    severity: type === 'blocking' ? 'error' : 'warning',
    message,
    ...meta,
  };
}

function normalizeEntityRecord(rawValue, fieldMap = {}) {
  const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const nextValue = {};

  Object.entries(fieldMap).forEach(([key, kind]) => {
    if (kind === 'list') {
      nextValue[key] = normalizeChapterListField(source[key]);
      return;
    }
    if (kind === 'text') {
      nextValue[key] = normalizeOptionalText(source[key]);
      return;
    }
    nextValue[key] = source[key];
  });

  return nextValue;
}

function getBlueprintEntityName(item = {}) {
  return String(item?.name || item?.title || '').trim();
}

export function normalizeWizardBlueprintResult(rawValue, fallbackTitle = '') {
  const nextResult = rawValue && typeof rawValue === 'object' ? { ...rawValue } : {};
  nextResult.title = String(nextResult.title || '').trim();
  nextResult.title_options = dedupeNormalized([
    ...(Array.isArray(nextResult.title_options) ? nextResult.title_options : []),
    nextResult.title || fallbackTitle,
  ]);
  nextResult.characters = Array.isArray(nextResult.characters)
    ? nextResult.characters
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        name: 'text',
        role: 'text',
        appearance: 'text',
        personality: 'text',
        personality_tags: 'text',
        flaws: 'text',
        goals: 'text',
        secrets: 'text',
        story_function: 'text',
      }))
    : [];
  nextResult.locations = Array.isArray(nextResult.locations)
    ? nextResult.locations
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        name: 'text',
        description: 'text',
        details: 'text',
        story_function: 'text',
      }))
    : [];
  nextResult.objects = Array.isArray(nextResult.objects)
    ? nextResult.objects
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        name: 'text',
        description: 'text',
        owner: 'text',
        story_function: 'text',
      }))
    : [];
  nextResult.factions = Array.isArray(nextResult.factions)
    ? nextResult.factions
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        name: 'text',
        faction_type: 'text',
        description: 'text',
        notes: 'text',
        story_function: 'text',
      }))
    : [];
  nextResult.terms = Array.isArray(nextResult.terms)
    ? nextResult.terms
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        name: 'text',
        definition: 'text',
        category: 'text',
        story_function: 'text',
      }))
    : [];
  nextResult.chapters = Array.isArray(nextResult.chapters)
    ? nextResult.chapters
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        title: 'text',
        purpose: 'text',
        summary: 'text',
        featured_characters: 'list',
        primary_location: 'text',
        thread_titles: 'list',
        key_events: 'list',
        required_factions: 'list',
        required_objects: 'list',
        required_terms: 'list',
      }))
    : [];
  nextResult.plot_threads = Array.isArray(nextResult.plot_threads)
    ? nextResult.plot_threads
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeEntityRecord(item, {
        title: 'text',
        type: 'text',
        description: 'text',
        state: 'text',
        opening_window: 'text',
        anchor_chapters: 'list',
      }))
    : [];

  if (!nextResult.title && nextResult.title_options[0]) {
    nextResult.title = nextResult.title_options[0];
  }

  return nextResult;
}

export function buildWizardValidation(result, excluded = new Set()) {
  if (!result?.chapters?.length) {
    return { blockingIssues: [], warnings: [], chapterSignals: [] };
  }

  const includedChapters = result.chapters.filter((_, index) => !excluded.has(`chapter-${index}`));
  if (!includedChapters.length) {
    return { blockingIssues: [], warnings: [], chapterSignals: [] };
  }

  const includedCharacters = (result.characters || []).filter((_, index) => !excluded.has(`char-${index}`));
  const includedLocations = (result.locations || []).filter((_, index) => !excluded.has(`loc-${index}`));
  const includedObjects = (result.objects || []).filter((_, index) => !excluded.has(`object-${index}`));
  const includedFactions = (result.factions || []).filter((_, index) => !excluded.has(`faction-${index}`));
  const includedTerms = (result.terms || []).filter((_, index) => !excluded.has(`term-${index}`));
  const includedThreads = (result.plot_threads || []).filter((_, index) => !excluded.has(`thread-${index}`));

  const chapterSignals = includedChapters.map((chapter, index) => {
    const featuredCharacters = normalizeChapterListField(chapter.featured_characters);
    const threadTitles = normalizeChapterListField(chapter.thread_titles);
    const keyEvents = normalizeChapterListField(chapter.key_events);
    const requiredFactions = normalizeChapterListField(chapter.required_factions);
    const requiredTerms = normalizeChapterListField(chapter.required_terms);
    const searchableText = buildChapterSearchText(chapter);

    return {
      index,
      chapter,
      title: chapter.title || `Chuong ${index + 1}`,
      purpose: normalizeOptionalText(chapter.purpose),
      summary: normalizeOptionalText(chapter.summary),
      featuredCharacters,
      threadTitles,
      keyEvents,
      requiredFactions,
      requiredTerms,
      primaryLocation: normalizeOptionalText(chapter.primary_location),
      searchableText,
    };
  });

  const blockingIssues = [];
  const warnings = [];

  chapterSignals.forEach((chapterSignal) => {
    if (!chapterSignal.purpose) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-purpose',
        `${chapterSignal.title} thieu purpose ro rang.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (chapterSignal.featuredCharacters.length === 0) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-featured-characters',
        `${chapterSignal.title} chua gan featured_characters.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterSignal.primaryLocation) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-primary-location',
        `${chapterSignal.title} chua co primary_location.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterHasCanonAnchor(chapterSignal.chapter)) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-thread-anchor',
        `${chapterSignal.title} chua co thread_titles hoac key_events de neo cot truyen.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
  });

  const protagonistNames = includedCharacters
    .filter((character) => character?.name && String(character.role || '').toLowerCase() === 'protagonist')
    .map((character) => character.name);
  protagonistNames.forEach((name) => {
    const normalized = normalizeBlueprintText(name);
    const appears = chapterSignals.some((chapterSignal) => (
      chapterSignal.featuredCharacters.some((item) => normalizeBlueprintText(item) === normalized)
      || chapterSignal.searchableText.includes(normalized)
    ));
    if (!appears) {
      blockingIssues.push(createIssue(
        'blocking',
        'protagonist-unused',
        `Nhan vat chinh "${name}" khong xuat hien trong chapter dau.`,
        { entityName: name },
      ));
    }
  });

  includedThreads
    .filter((thread) => thread?.title)
    .forEach((thread) => {
      const normalizedTitle = normalizeBlueprintText(thread.title);
      const anchorChapters = normalizeChapterListField(thread.anchor_chapters);
      const hasAnchor = chapterSignals.some((chapterSignal) => (
        chapterSignal.threadTitles.some((item) => normalizeBlueprintText(item) === normalizedTitle)
        || chapterSignal.searchableText.includes(normalizedTitle)
      ));
      if (!hasAnchor && anchorChapters.length === 0) {
        blockingIssues.push(createIssue(
          'blocking',
          'thread-without-anchor',
          `Tuyen truyuyen "${thread.title}" khong co chapter neo ro rang.`,
          { entityName: thread.title },
        ));
      }
    });

  includedLocations
    .filter((location) => location?.name)
    .forEach((location) => {
      const normalizedName = normalizeBlueprintText(location.name);
      const used = chapterSignals.some((chapterSignal) => (
        normalizeBlueprintText(chapterSignal.primaryLocation) === normalizedName
        || chapterSignal.searchableText.includes(normalizedName)
      ));
      if (!used) {
        blockingIssues.push(createIssue(
          'blocking',
          'location-unused',
          `Dia diem "${location.name}" khong duoc chapter nao su dung.`,
          { entityName: location.name },
        ));
      }
    });

  includedFactions
    .filter((faction) => faction?.name)
    .forEach((faction) => {
      const normalizedName = normalizeBlueprintText(faction.name);
      const used = chapterSignals.some((chapterSignal) => chapterSignal.searchableText.includes(normalizedName));
      if (!used) {
        blockingIssues.push(createIssue(
          'blocking',
          'faction-unused',
          `The luc "${faction.name}" khong duoc chapter nao chạm toi.`,
          { entityName: faction.name },
        ));
      }
    });

  includedTerms
    .filter((term) => term?.name)
    .forEach((term) => {
      const normalizedName = normalizeBlueprintText(term.name);
      const used = chapterSignals.some((chapterSignal) => chapterSignal.searchableText.includes(normalizedName));
      if (!used) {
        blockingIssues.push(createIssue(
          'blocking',
          'term-unused',
          `Thuat ngu "${term.name}" khong duoc chapter nao chạm toi.`,
          { entityName: term.name },
        ));
      }
    });

  const remappedBlockingIssues = [];
  blockingIssues.forEach((issue) => {
    if (issue.code === 'faction-unused') {
      const faction = includedFactions.find((item) => item?.name === issue.entityName);
      if (faction && !isEarlyRelevantEntity(faction, 'requiredFactions', chapterSignals)) {
        warnings.push({
          ...issue,
          type: 'warning',
          severity: 'warning',
          message: `The luc "${issue.entityName}" chua duoc chapter dau cham toi.`,
        });
        return;
      }
    }

    if (issue.code === 'term-unused') {
      const term = includedTerms.find((item) => item?.name === issue.entityName);
      if (term && !isEarlyRelevantEntity(term, 'requiredTerms', chapterSignals)) {
        warnings.push({
          ...issue,
          type: 'warning',
          severity: 'warning',
          message: `Thuat ngu "${issue.entityName}" chua duoc chapter dau cham toi.`,
        });
        return;
      }
    }

    remappedBlockingIssues.push(issue);
  });

  blockingIssues.length = 0;
  blockingIssues.push(...remappedBlockingIssues);

  const totalImportantEntities = includedCharacters.filter((item) => String(item?.role || '').toLowerCase() !== 'minor').length
    + includedLocations.length
    + includedFactions.length
    + includedTerms.length
    + includedThreads.length;
  if (totalImportantEntities > includedChapters.length * 2 + 2) {
    warnings.push(createIssue(
      'warning',
      'entity-density-high',
      'So entity va tuyen dang vuot kha nang gan vao so chapter dau, de gay loang.',
      { entityCount: totalImportantEntities, chapterCount: includedChapters.length },
    ));
  }

  const fastPacingChapters = chapterSignals.filter((chapterSignal) => (
    chapterSignal.keyEvents.length >= 3
    || (chapterSignal.threadTitles.length >= 2 && chapterSignal.summary.length >= 320)
    || (chapterSignal.featuredCharacters.length >= 4 && chapterSignal.summary.length >= 320)
  ));
  if (fastPacingChapters.length >= Math.max(1, Math.ceil(includedChapters.length / 2))) {
    warnings.push(createIssue(
      'warning',
      'pacing-too-fast',
      'Blueprint mo dau co dau hieu day qua nhieu beat lon trong so chapter dau, AI de lao nhanh hon nhip mong muon.',
      { chapterTitles: fastPacingChapters.map((item) => item.title) },
    ));
  }

  chapterSignals.forEach((chapterSignal) => {
    let overloadScore = 0;
    if (chapterSignal.summary.length > 620) overloadScore += 2;
    else if (chapterSignal.summary.length > 500) overloadScore += 1;
    if (chapterSignal.threadTitles.length >= 3) overloadScore += 1;
    if (chapterSignal.featuredCharacters.length >= 4) overloadScore += 1;
    if (chapterSignal.purpose.length > 140) overloadScore += 1;

    if (chapterSignal.summary.length > 420 && overloadScore >= 3) {
      warnings.push(createIssue(
        'warning',
        'chapter-too-dense',
        `${chapterSignal.title} co dau hieu nhoi qua nhieu su kien hoac tuyen trong mot chuong.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
  });

  if (includedObjects.length > includedChapters.length + 1) {
    warnings.push(createIssue(
      'warning',
      'object-density-high',
      'So vat pham blueprint dau truyện dang nhieu hon muc can thiet.',
      { entityCount: includedObjects.length, chapterCount: includedChapters.length },
    ));
  }

  return { blockingIssues, warnings, chapterSignals };
}

function matchBlueprintEntitiesByName(candidates, names = []) {
  const normalizedNames = new Set(names.map((value) => normalizeBlueprintText(value)).filter(Boolean));
  return candidates.filter((item) => {
    const normalized = normalizeBlueprintText(getBlueprintEntityName(item));
    return normalized && normalizedNames.has(normalized);
  });
}

function inferEntityNamesFromChapter(chapter, entities = []) {
  const searchableText = buildChapterSearchText(chapter);
  return entities
    .filter((entity) => getBlueprintEntityName(entity))
    .filter((entity) => searchableText.includes(normalizeBlueprintText(getBlueprintEntityName(entity))))
    .map((entity) => getBlueprintEntityName(entity));
}

export function buildChapterBlueprintContext({
  chapter = null,
  allCharacters = [],
  allLocations = [],
  allObjects = [],
  allFactions = [],
  allTerms = [],
  plotThreads = [],
} = {}) {
  if (!chapter) {
    return null;
  }

  const featuredCharacters = normalizeChapterListField(chapter.featured_characters);
  const threadTitles = normalizeChapterListField(chapter.thread_titles);
  const keyEvents = normalizeChapterListField(chapter.key_events);
  const primaryLocation = normalizeOptionalText(chapter.primary_location);
  const requiredFactions = dedupeNormalized([
    ...normalizeChapterListField(chapter.required_factions),
    ...inferEntityNamesFromChapter(chapter, allFactions),
  ]);
  const requiredObjects = dedupeNormalized([
    ...normalizeChapterListField(chapter.required_objects),
    ...inferEntityNamesFromChapter(chapter, allObjects),
  ]);
  const relevantTerms = dedupeNormalized([
    ...normalizeChapterListField(chapter.required_terms),
    ...inferEntityNamesFromChapter(chapter, allTerms),
  ]);

  return {
    title: normalizeOptionalText(chapter.title),
    summary: normalizeOptionalText(chapter.summary),
    purpose: normalizeOptionalText(chapter.purpose),
    featured_characters: featuredCharacters,
    primary_location: primaryLocation,
    thread_titles: threadTitles,
    key_events: keyEvents,
    required_factions: requiredFactions,
    required_objects: requiredObjects,
    required_terms: relevantTerms,
    relatedCharacters: matchBlueprintEntitiesByName(allCharacters, featuredCharacters),
    relatedLocations: matchBlueprintEntitiesByName(allLocations, primaryLocation ? [primaryLocation] : []),
    relatedObjects: matchBlueprintEntitiesByName(allObjects, requiredObjects),
    relatedFactions: matchBlueprintEntitiesByName(allFactions, requiredFactions),
    relatedTerms: matchBlueprintEntitiesByName(allTerms, relevantTerms),
    relatedThreads: matchBlueprintEntitiesByName(plotThreads, threadTitles),
  };
}

export function validateChapterWritingReadiness({
  chapterBlueprintContext = null,
  sceneContract = {},
  sceneText = '',
} = {}) {
  const blockingIssues = [];
  const warnings = [];
  const hasSceneText = String(sceneText || '').trim().length > 0;

  if (!chapterBlueprintContext) {
    warnings.push(createIssue(
      'warning',
      'missing-blueprint-context',
      'Chuong nay chua co chapter blueprint context, AI se de bi viet lech thiet lap.',
    ));
    return { blockingIssues, warnings };
  }

  if (!chapterBlueprintContext.purpose) {
    blockingIssues.push(createIssue('blocking', 'missing-purpose', 'Chuong nay chua co purpose de AI bam sat.'));
  }
  if (!Array.isArray(chapterBlueprintContext.featured_characters) || chapterBlueprintContext.featured_characters.length === 0) {
    blockingIssues.push(createIssue('blocking', 'missing-featured-characters', 'Chuong nay chua gan featured_characters.'));
  }
  if (!chapterBlueprintContext.primary_location) {
    blockingIssues.push(createIssue('blocking', 'missing-primary-location', 'Chuong nay chua co primary_location.'));
  }
  if (
    (!Array.isArray(chapterBlueprintContext.thread_titles) || chapterBlueprintContext.thread_titles.length === 0)
    && (!Array.isArray(chapterBlueprintContext.key_events) || chapterBlueprintContext.key_events.length === 0)
  ) {
    blockingIssues.push(createIssue('blocking', 'missing-story-anchor', 'Chuong nay chua co thread_titles hoac key_events de neo cot truyen.'));
  }

  const anchorRichness = chapterBlueprintContext.featured_characters.length
    + (chapterBlueprintContext.primary_location ? 1 : 0)
    + chapterBlueprintContext.thread_titles.length
    + chapterBlueprintContext.key_events.length
    + chapterBlueprintContext.required_factions.length
    + chapterBlueprintContext.required_objects.length;
  if (anchorRichness < 3) {
    warnings.push(createIssue(
      'warning',
      'thin-blueprint-anchor',
      'Chapter anchor hien tai con mong, AI de bi bịa them chi tiet ngoai blueprint.',
    ));
  }

  if (!hasSceneText) {
    const hasPov = !!String(sceneContract?.pov_character || '').trim();
    const hasLocation = !!String(sceneContract?.location || '').trim();
    const hasCharactersPresent = Array.isArray(sceneContract?.characters_present) && sceneContract.characters_present.length > 0;
    if (!hasPov || !hasLocation || !hasCharactersPresent) {
      warnings.push(createIssue(
        'warning',
        'empty-scene-bootstrap-weak',
        'Scene moi dang trong va chua du setup POV/location/characters_present, AI de bi bịa.',
      ));
    }
  }

  return { blockingIssues, warnings };
}

export default {
  normalizeBlueprintText,
  normalizeWizardBlueprintResult,
  buildWizardValidation,
  buildChapterBlueprintContext,
  validateChapterWritingReadiness,
  normalizeChapterListField,
};
