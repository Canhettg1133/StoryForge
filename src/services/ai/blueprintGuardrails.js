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

const TITLE_COMMAND_PREFIXES = [
  'tao',
  'viet',
  'hay tao',
  'hay viet',
  'giup toi',
  'cho toi',
  'goi y',
  'dat ten',
  'sinh',
  'lap',
  'create',
  'generate',
  'write',
  'suggest',
  'name',
];

const TITLE_REQUEST_MARKERS = [
  'truyen',
  'cau chuyen',
  'story',
  'idea',
  'the loai',
  'genre',
  'bat ky',
  'cho toi',
  'giup toi',
];

function looksLikePromptInstruction(value) {
  const normalized = normalizeBlueprintText(value);
  if (!normalized) return false;

  const startsWithCommand = TITLE_COMMAND_PREFIXES.some((prefix) => (
    normalized === prefix || normalized.startsWith(prefix + ' ')
  ));
  if (!startsWithCommand) return false;

  return TITLE_REQUEST_MARKERS.some((marker) => normalized.includes(marker));
}

function sanitizeWizardTitleCandidate(value) {
  const trimmed = String(value || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '');

  if (!trimmed) return '';
  if (looksLikePromptInstruction(trimmed)) return '';

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 12 && /[.!?]/.test(trimmed)) return '';

  return trimmed;
}

function getChapterLabel(index) {
  return `Chuong ${index + 1}`;
}

function splitTextIntoBeats(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];

  const sentenceParts = trimmed
    .split(/[.!?]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  if (sentenceParts.length > 1) {
    return sentenceParts.slice(0, 3);
  }

  return trimmed
    .split(/[,;:\-]\s+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
    .slice(0, 3);
}

function extractChapterNumbers(value) {
  const text = String(value || '');
  const numbers = new Set();

  const rangeMatches = text.matchAll(/(\d+)\s*[-–]\s*(\d+)/g);
  for (const match of rangeMatches) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    if (max - min > 20) continue;
    for (let current = min; current <= max; current += 1) {
      numbers.add(current);
    }
  }

  const singleMatches = text.matchAll(/(?:chuong|chapter|chap)\s*(\d+)/gi);
  for (const match of singleMatches) {
    const numeric = Number(match[1]);
    if (Number.isFinite(numeric)) {
      numbers.add(numeric);
    }
  }

  return numbers;
}

function chapterReferenceMatches(reference, chapterTitle, index) {
  const normalizedReference = normalizeBlueprintText(reference);
  if (!normalizedReference) return false;

  const chapterNumber = index + 1;
  const normalizedChapterTitle = normalizeBlueprintText(chapterTitle);
  if (normalizedChapterTitle && normalizedReference.includes(normalizedChapterTitle)) {
    return true;
  }

  if (
    normalizedReference.includes(`chuong ${chapterNumber}`)
    || normalizedReference.includes(`chapter ${chapterNumber}`)
    || normalizedReference.includes(`chap ${chapterNumber}`)
  ) {
    return true;
  }

  return extractChapterNumbers(reference).has(chapterNumber);
}

function findMentionedEntityNames(textParts, entities = []) {
  const searchableText = normalizeBlueprintText(textParts.filter(Boolean).join(' \n '));
  if (!searchableText) return [];

  return entities
    .map((entity) => getBlueprintEntityName(entity))
    .filter(Boolean)
    .filter((name) => searchableText.includes(normalizeBlueprintText(name)));
}

function buildEntityNamePool(entities = [], filterFn = null) {
  return dedupeNormalized(
    entities
      .filter((item) => !filterFn || filterFn(item))
      .map((item) => getBlueprintEntityName(item)),
  );
}

function pickFallbackNames(pool = [], index = 0, maxItems = 1) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const safeMax = Math.max(1, maxItems);
  const start = Math.abs(index) % pool.length;
  const picks = [];
  for (let offset = 0; offset < pool.length && picks.length < safeMax; offset += 1) {
    picks.push(pool[(start + offset) % pool.length]);
  }
  return dedupeNormalized(picks);
}

function inferChapterTargetIndexes(references = [], chapters = [], fallbackIndex = 0) {
  if (!Array.isArray(chapters) || chapters.length === 0) return [];

  const matchedIndexes = [];
  references
    .filter(Boolean)
    .forEach((reference) => {
      chapters.forEach((chapter, chapterIndex) => {
        const chapterTitle = chapter?.title || getChapterLabel(chapterIndex);
        if (chapterReferenceMatches(reference, chapterTitle, chapterIndex)) {
          matchedIndexes.push(chapterIndex);
        }
      });
    });

  if (matchedIndexes.length > 0) {
    return [...new Set(matchedIndexes)];
  }

  if (references.some((reference) => hasEarlyStorySignal(reference))) {
    return [0];
  }

  return [Math.min(Math.max(fallbackIndex, 0), chapters.length - 1)];
}

function buildPurposeFallback(chapter = {}, keyEvents = [], threadTitles = []) {
  const summaryBeats = splitTextIntoBeats(chapter.summary);
  if (summaryBeats[0]) {
    return summaryBeats[0];
  }
  if (keyEvents[0]) {
    return `Day beat "${keyEvents[0]}".`;
  }
  if (threadTitles[0]) {
    return `Day tiep tuyen "${threadTitles[0]}".`;
  }
  if (chapter.title) {
    return `Day tien trinh cua ${chapter.title}.`;
  }
  return 'Dat them mot neo cot truyen ro rang cho chuong nay.';
}

function buildKeyEventFallback(chapter = {}, primaryLocation = '', threadTitles = []) {
  const beats = splitTextIntoBeats(chapter.summary);
  if (beats.length > 0) {
    return beats.slice(0, 2);
  }

  const fallbackEvents = [];
  if (chapter.title) fallbackEvents.push(chapter.title);
  if (threadTitles[0]) fallbackEvents.push(`Day tuyen ${threadTitles[0]}`);
  if (primaryLocation) fallbackEvents.push(`Canh chinh tai ${primaryLocation}`);
  return dedupeNormalized(fallbackEvents).slice(0, 2);
}

function hydrateWizardBlueprintResult(result = {}) {
  const chapters = Array.isArray(result.chapters)
    ? result.chapters.map((chapter, index) => ({ ...chapter, title: chapter.title || getChapterLabel(index) }))
    : [];
  const characters = Array.isArray(result.characters) ? result.characters : [];
  const locations = Array.isArray(result.locations) ? result.locations : [];
  const objects = Array.isArray(result.objects) ? result.objects : [];
  const factions = Array.isArray(result.factions) ? result.factions : [];
  const terms = Array.isArray(result.terms) ? result.terms : [];
  const plotThreads = Array.isArray(result.plot_threads)
    ? result.plot_threads.map((thread) => ({ ...thread }))
    : [];

  const protagonistNames = buildEntityNamePool(characters, (item) => String(item?.role || '').toLowerCase() === 'protagonist');
  const supportingNames = buildEntityNamePool(characters, (item) => String(item?.role || '').toLowerCase() !== 'minor');
  const characterPool = protagonistNames.length > 0 ? protagonistNames : supportingNames;
  const locationPool = buildEntityNamePool(locations);
  const factionPool = buildEntityNamePool(factions);
  const termPool = buildEntityNamePool(terms);
  const objectPool = buildEntityNamePool(objects);
  const threadPool = dedupeNormalized(
    plotThreads
      .map((thread) => String(thread?.title || '').trim())
      .filter(Boolean),
  );

  chapters.forEach((chapter, index) => {
    const textParts = [chapter.title, chapter.summary, chapter.purpose];
    const explicitFeatured = normalizeChapterListField(chapter.featured_characters);
    const explicitThreads = normalizeChapterListField(chapter.thread_titles);
    const explicitKeyEvents = normalizeChapterListField(chapter.key_events);
    const explicitRequiredFactions = normalizeChapterListField(chapter.required_factions);
    const explicitRequiredTerms = normalizeChapterListField(chapter.required_terms);
    const explicitRequiredObjects = normalizeChapterListField(chapter.required_objects);
    const explicitPrimaryLocation = normalizeOptionalText(chapter.primary_location);

    const mentionedCharacters = findMentionedEntityNames(textParts, characters);
    const mentionedLocations = findMentionedEntityNames(textParts, locations);
    const mentionedFactions = findMentionedEntityNames(textParts, factions);
    const mentionedTerms = findMentionedEntityNames(textParts, terms);
    const mentionedObjects = findMentionedEntityNames(textParts, objects);
    const referencedThreads = plotThreads
      .filter((thread) => {
        const title = String(thread?.title || '').trim();
        if (!title) return false;
        const searchableText = normalizeBlueprintText(textParts.join(' \n '));
        if (searchableText.includes(normalizeBlueprintText(title))) return true;
        return inferChapterTargetIndexes(
          [thread.opening_window, ...(normalizeChapterListField(thread.anchor_chapters))],
          chapters,
          index,
        ).includes(index);
      })
      .map((thread) => thread.title);

    const featuredCharacters = dedupeNormalized([
      ...explicitFeatured,
      ...mentionedCharacters,
      ...(explicitFeatured.length === 0 ? pickFallbackNames(characterPool, index, protagonistNames.length > 0 ? Math.min(2, protagonistNames.length) : 1) : []),
    ]);

    const primaryLocation = explicitPrimaryLocation
      || mentionedLocations[0]
      || pickFallbackNames(locationPool, index, 1)[0]
      || '';

    const threadTitles = dedupeNormalized([
      ...explicitThreads,
      ...referencedThreads,
      ...(explicitThreads.length === 0 ? pickFallbackNames(threadPool, index, 1) : []),
    ]);

    const keyEvents = dedupeNormalized([
      ...explicitKeyEvents,
      ...(explicitKeyEvents.length === 0 ? buildKeyEventFallback(chapter, primaryLocation, threadTitles) : []),
    ]);

    const requiredFactions = dedupeNormalized([
      ...explicitRequiredFactions,
      ...mentionedFactions,
      ...(index < 2 ? pickFallbackNames(factionPool, index, 1) : []),
    ]);
    const requiredTerms = dedupeNormalized([
      ...explicitRequiredTerms,
      ...mentionedTerms,
      ...(index < 2 ? pickFallbackNames(termPool, index, 1) : []),
    ]);
    const requiredObjects = dedupeNormalized([
      ...explicitRequiredObjects,
      ...mentionedObjects,
      ...(index === 0 ? pickFallbackNames(objectPool, index, 1) : []),
    ]);

    const purpose = normalizeOptionalText(chapter.purpose)
      || buildPurposeFallback(chapter, keyEvents, threadTitles);

    chapters[index] = {
      ...chapter,
      purpose,
      featured_characters: featuredCharacters,
      primary_location: primaryLocation,
      thread_titles: threadTitles,
      key_events: keyEvents,
      required_factions: requiredFactions,
      required_terms: requiredTerms,
      required_objects: requiredObjects,
    };
  });

  plotThreads.forEach((thread, threadIndex) => {
    const title = String(thread?.title || '').trim();
    if (!title || chapters.length === 0) return;

    const targetIndexes = inferChapterTargetIndexes(
      [thread.opening_window, ...(normalizeChapterListField(thread.anchor_chapters))],
      chapters,
      threadIndex,
    );

    const alreadyAnchored = chapters.some((chapter) => (
      normalizeChapterListField(chapter.thread_titles).some((item) => normalizeBlueprintText(item) === normalizeBlueprintText(title))
      || buildChapterSearchText(chapter).includes(normalizeBlueprintText(title))
    ));

    if (!alreadyAnchored) {
      targetIndexes.forEach((chapterIndex) => {
        chapters[chapterIndex].thread_titles = dedupeNormalized([
          ...normalizeChapterListField(chapters[chapterIndex].thread_titles),
          title,
        ]);
      });
    }

    thread.anchor_chapters = dedupeNormalized([
      ...normalizeChapterListField(thread.anchor_chapters),
      ...targetIndexes.map((chapterIndex) => chapters[chapterIndex]?.title || getChapterLabel(chapterIndex)),
    ]);
  });

  locations.forEach((location, locationIndex) => {
    const locationName = getBlueprintEntityName(location);
    if (!locationName || chapters.length === 0) return;

    const normalizedName = normalizeBlueprintText(locationName);
    const isUsed = chapters.some((chapter) => buildChapterSearchText(chapter).includes(normalizedName));
    if (isUsed) return;

    const targetIndexes = inferChapterTargetIndexes([location.story_function], chapters, locationIndex);
    targetIndexes.forEach((chapterIndex) => {
      chapters[chapterIndex].key_events = dedupeNormalized([
        ...normalizeChapterListField(chapters[chapterIndex].key_events),
        `Canh co lien quan den ${locationName}`,
      ]);
    });
  });

  factions.forEach((faction, factionIndex) => {
    const factionName = getBlueprintEntityName(faction);
    if (!factionName || chapters.length === 0) return;

    const normalizedName = normalizeBlueprintText(factionName);
    const isUsed = chapters.some((chapter) => buildChapterSearchText(chapter).includes(normalizedName));
    if (isUsed) return;

    const targetIndexes = inferChapterTargetIndexes([faction.story_function], chapters, factionIndex);
    targetIndexes.forEach((chapterIndex) => {
      chapters[chapterIndex].required_factions = dedupeNormalized([
        ...normalizeChapterListField(chapters[chapterIndex].required_factions),
        factionName,
      ]);
    });
  });

  terms.forEach((term, termIndex) => {
    const termName = getBlueprintEntityName(term);
    if (!termName || chapters.length === 0) return;

    const normalizedName = normalizeBlueprintText(termName);
    const isUsed = chapters.some((chapter) => buildChapterSearchText(chapter).includes(normalizedName));
    if (isUsed) return;

    const targetIndexes = inferChapterTargetIndexes([term.story_function], chapters, termIndex);
    targetIndexes.forEach((chapterIndex) => {
      chapters[chapterIndex].required_terms = dedupeNormalized([
        ...normalizeChapterListField(chapters[chapterIndex].required_terms),
        termName,
      ]);
    });
  });

  return {
    ...result,
    chapters,
    plot_threads: plotThreads,
  };
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
  nextResult.title = sanitizeWizardTitleCandidate(nextResult.title);
  nextResult.title_options = dedupeNormalized([
    ...(Array.isArray(nextResult.title_options) ? nextResult.title_options : []),
    nextResult.title,
    sanitizeWizardTitleCandidate(fallbackTitle),
  ].map(sanitizeWizardTitleCandidate).filter(Boolean));
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

  return hydrateWizardBlueprintResult(nextResult);
}

export function resolveWizardProjectTitle(result = {}, fallbackTitle = '') {
  const normalizedResult = normalizeWizardBlueprintResult(result, fallbackTitle);
  const safeTitle = sanitizeWizardTitleCandidate(normalizedResult.title)
    || normalizedResult.title_options.find(Boolean)
    || sanitizeWizardTitleCandidate(fallbackTitle);

  if (safeTitle) {
    return safeTitle;
  }

  const premiseFallback = String(normalizedResult.premise || '')
    .trim()
    .split(/[.!?]/)[0]
    .slice(0, 80)
    .trim();

  return premiseFallback || 'Du an moi';
}

export function buildWizardValidation(result, excluded = new Set()) {
  if (!result?.chapters?.length) {
    return { blockingIssues: [], warnings: [], chapterSignals: [] };
  }

  const hasExcludedChapters = Array.from(excluded || []).some((key) => String(key).startsWith('chapter-'));
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
  const downgradeAfterChapterRemoval = new Set([
    'protagonist-unused',
    'thread-without-anchor',
    'location-unused',
    'faction-unused',
    'term-unused',
  ]);
  blockingIssues.forEach((issue) => {
    if (hasExcludedChapters && downgradeAfterChapterRemoval.has(issue.code)) {
      warnings.push({
        ...issue,
        type: 'warning',
        severity: 'warning',
        message: `${issue.message} Kiem tra lai neu ban vua bo chapter co chua neo nay.`,
      });
      return;
    }

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
  resolveWizardProjectTitle,
  buildWizardValidation,
  buildChapterBlueprintContext,
  validateChapterWritingReadiness,
  normalizeChapterListField,
};
