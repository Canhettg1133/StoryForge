function normalizeBlueprintText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CENTRAL_CHARACTER_ROLES = new Set(['protagonist', 'deuteragonist']);

function isCentralCharacterRole(role) {
  return CENTRAL_CHARACTER_ROLES.has(String(role || '').toLowerCase());
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
  return `Chương ${index + 1}`;
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
  return 'Đặt thêm một neo cốt truyện rõ ràng cho chương này.';
}

function buildKeyEventFallback(chapter = {}, primaryLocation = '', threadTitles = []) {
  const beats = splitTextIntoBeats(chapter.summary);
  if (beats.length > 0) {
    return beats.slice(0, 2);
  }

  const fallbackEvents = [];
  if (chapter.title) fallbackEvents.push(chapter.title);
  if (threadTitles[0]) fallbackEvents.push(`Đẩy tuyến ${threadTitles[0]}`);
  if (primaryLocation) fallbackEvents.push(`Cảnh chính tại ${primaryLocation}`);
  return dedupeNormalized(fallbackEvents).slice(0, 2);
}

function countBlueprintWords(value = '') {
  const normalized = normalizeBlueprintText(value);
  return normalized ? normalized.split(' ').filter(Boolean).length : 0;
}

function normalizeProposedEntities(rawValue = {}) {
  const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const normalizeCollection = (items, fieldMap) => (
    Array.isArray(items)
      ? items
        .filter((item) => item && typeof item === 'object')
        .map((item) => normalizeEntityRecord(item, fieldMap))
      : []
  );

  return {
    characters: normalizeCollection(source.characters, {
      name: 'text',
      role: 'text',
      specific_role: 'text',
      specific_role_locked: 'boolean',
      age: 'text',
      appearance: 'text',
      personality: 'text',
      personality_tags: 'text',
      flaws: 'text',
      goals: 'text',
      current_status: 'text',
      story_function: 'text',
      reason: 'text',
    }).map((item) => ({
      ...item,
      specific_role_locked: Boolean(item.specific_role_locked && item.specific_role),
    })),
    locations: normalizeCollection(source.locations, {
      name: 'text',
      description: 'text',
      details: 'text',
      story_function: 'text',
      reason: 'text',
    }),
    objects: normalizeCollection(source.objects, {
      name: 'text',
      description: 'text',
      owner: 'text',
      story_function: 'text',
      reason: 'text',
    }),
    factions: normalizeCollection(source.factions, {
      name: 'text',
      faction_type: 'text',
      description: 'text',
      notes: 'text',
      story_function: 'text',
      reason: 'text',
    }),
    terms: normalizeCollection(source.terms, {
      name: 'text',
      definition: 'text',
      category: 'text',
      story_function: 'text',
      reason: 'text',
    }),
    plot_threads: normalizeCollection(source.plot_threads, {
      title: 'text',
      type: 'text',
      description: 'text',
      state: 'text',
      opening_window: 'text',
      anchor_chapters: 'list',
      reason: 'text',
    }),
  };
}

function getCollectionRecordName(collectionKey, item = {}) {
  return collectionKey === 'plot_threads'
    ? String(item?.title || '').trim()
    : getBlueprintEntityName(item);
}

function buildOutlineReferenceProposal(collectionKey, reference, chapterTitle) {
  const reason = `Dàn ý gọi mục "${reference}" trong ${chapterTitle}, nhưng nền truyện chưa có mục này.`;
  const storyFunction = `Được dàn ý dùng trong ${chapterTitle}.`;

  if (collectionKey === 'characters') {
    return {
      name: reference,
      role: 'supporting',
      story_function: storyFunction,
      reason,
    };
  }
  if (collectionKey === 'locations') {
    return {
      name: reference,
      description: '',
      story_function: `Được dàn ý dùng làm địa điểm chính trong ${chapterTitle}.`,
      reason,
    };
  }
  if (collectionKey === 'objects') {
    return {
      name: reference,
      description: '',
      owner: '',
      story_function: storyFunction,
      reason,
    };
  }
  if (collectionKey === 'factions') {
    return {
      name: reference,
      faction_type: 'other',
      description: '',
      story_function: storyFunction,
      reason,
    };
  }
  if (collectionKey === 'terms') {
    return {
      name: reference,
      definition: '',
      category: 'other',
      story_function: storyFunction,
      reason,
    };
  }
  return {
    title: reference,
    type: 'subplot',
    description: '',
    state: 'active',
    opening_window: chapterTitle,
    anchor_chapters: [chapterTitle],
    reason,
  };
}

function autoProposeMissingOutlineReferences(outline = {}, seed = {}) {
  const proposedEntities = normalizeProposedEntities(outline.proposed_entities);
  const allowedByCollection = new Map();
  const seedCollections = {
    characters: seed.characters || [],
    locations: seed.locations || [],
    objects: seed.objects || [],
    factions: seed.factions || [],
    terms: seed.terms || [],
    plot_threads: seed.plot_threads || [],
  };

  Object.keys(proposedEntities).forEach((collectionKey) => {
    const allowed = new Set();
    [...(seedCollections[collectionKey] || []), ...(proposedEntities[collectionKey] || [])]
      .forEach((item) => {
        const normalizedName = normalizeBlueprintText(getCollectionRecordName(collectionKey, item));
        if (normalizedName) allowed.add(normalizedName);
      });
    allowedByCollection.set(collectionKey, allowed);
  });

  const addMissingReference = (collectionKey, reference, chapterTitle) => {
    const normalizedReference = normalizeBlueprintText(reference);
    if (!normalizedReference) return;
    const allowed = allowedByCollection.get(collectionKey);
    if (!allowed || allowed.has(normalizedReference)) return;

    proposedEntities[collectionKey].push(buildOutlineReferenceProposal(collectionKey, reference, chapterTitle));
    allowed.add(normalizedReference);
  };

  (outline.chapters || []).forEach((chapter, index) => {
    const chapterTitle = chapter?.title || getChapterLabel(index);
    normalizeChapterListField(chapter?.featured_characters)
      .forEach((reference) => addMissingReference('characters', reference, chapterTitle));
    if (chapter?.primary_location) {
      addMissingReference('locations', chapter.primary_location, chapterTitle);
    }
    normalizeChapterListField(chapter?.thread_titles)
      .forEach((reference) => addMissingReference('plot_threads', reference, chapterTitle));
    normalizeChapterListField(chapter?.required_factions)
      .forEach((reference) => addMissingReference('factions', reference, chapterTitle));
    normalizeChapterListField(chapter?.required_objects)
      .forEach((reference) => addMissingReference('objects', reference, chapterTitle));
    normalizeChapterListField(chapter?.required_terms)
      .forEach((reference) => addMissingReference('terms', reference, chapterTitle));
  });

  return proposedEntities;
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

  const protagonistNames = buildEntityNamePool(characters, (item) => isCentralCharacterRole(item?.role));
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
    const textParts = [
      chapter.title,
      chapter.summary,
      chapter.purpose,
      chapter.opening_state,
      chapter.handoff_from_previous,
      chapter.ending_state,
    ];
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
      opening_state: normalizeOptionalText(chapter.opening_state),
      handoff_from_previous: normalizeOptionalText(chapter.handoff_from_previous),
      ending_state: normalizeOptionalText(chapter.ending_state),
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
        `Cảnh có liên quan đến ${locationName}`,
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
    chapter.opening_state,
    chapter.handoff_from_previous,
    chapter.ending_state,
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
    if (kind === 'boolean') {
      nextValue[key] = normalizeBoolean(source[key]);
      return;
    }
    nextValue[key] = source[key];
  });

  return nextValue;
}

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = normalizeBlueprintText(value);
    if (['true', 'yes', '1', 'co', 'da khoa'].includes(normalized)) return true;
    if (['false', 'no', '0', 'khong', 'khong khoa'].includes(normalized)) return false;
  }
  return Boolean(value);
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
        specific_role: 'text',
        specific_role_locked: 'boolean',
        age: 'text',
        appearance: 'text',
        personality: 'text',
        personality_tags: 'text',
        flaws: 'text',
        goals: 'text',
        current_status: 'text',
        secrets: 'text',
        story_function: 'text',
      }))
      .map((item) => ({
        ...item,
        specific_role_locked: Boolean(item.specific_role_locked && item.specific_role),
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
        opening_state: 'text',
        handoff_from_previous: 'text',
        ending_state: 'text',
        state_delta: 'text',
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
  nextResult.proposed_entities = normalizeProposedEntities(nextResult.proposed_entities);

  if (!nextResult.title && nextResult.title_options[0]) {
    nextResult.title = nextResult.title_options[0];
  }

  return hydrateWizardBlueprintResult(nextResult);
}

export function normalizeStoryBibleSeedResult(rawValue, fallbackTitle = '') {
  const normalized = normalizeWizardBlueprintResult({
    ...(rawValue && typeof rawValue === 'object' ? rawValue : {}),
    chapters: [],
    proposed_entities: {},
  }, fallbackTitle);

  return {
    ...normalized,
    chapters: [],
    proposed_entities: normalizeProposedEntities({}),
  };
}

export function normalizeChapterOutlinePassResult(rawValue, seed = {}) {
  const source = Array.isArray(rawValue)
    ? { chapters: rawValue }
    : (rawValue && typeof rawValue === 'object' ? rawValue : {});
  const proposedEntities = normalizeProposedEntities(source.proposed_entities);
  const normalized = normalizeWizardBlueprintResult({
    ...(seed && typeof seed === 'object' ? seed : {}),
    chapters: Array.isArray(source.chapters) ? source.chapters : [],
    plot_threads: Array.isArray(source.plot_threads) ? source.plot_threads : [],
    proposed_entities: proposedEntities,
  });

  return {
    chapters: normalized.chapters,
    plot_threads: normalized.plot_threads,
    proposed_entities: autoProposeMissingOutlineReferences({
      chapters: normalized.chapters,
      plot_threads: normalized.plot_threads,
      proposed_entities: proposedEntities,
    }, seed),
  };
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

  return premiseFallback || 'Dự án mới';
}

function getSeedCharacterLimit(chapterCount = 1) {
  const safeChapterCount = Math.max(1, Math.round(Number(chapterCount) || 1));
  if (safeChapterCount === 1) return 2;
  if (safeChapterCount <= 3) return 4;
  return 5;
}

function looksDeferredToFuture(value = '') {
  const normalized = normalizeBlueprintText(value);
  if (!normalized) return false;
  return [
    'de danh',
    've sau',
    'sau nay',
    'tuong lai',
    'chua xuat hien',
    'phan sau',
    'later',
    'future',
  ].some((marker) => normalized.includes(marker));
}

export function buildStoryBibleSeedValidation(seed = {}, options = {}) {
  const excluded = options.excluded || new Set();
  const chapterCount = Math.max(1, Math.round(Number(options.initialChapterCount) || 1));
  const blockingIssues = [];
  const warnings = [];
  const includedCharacters = (seed.characters || []).filter((_, index) => !excluded.has(`char-${index}`));
  const importantCharacters = includedCharacters.filter((character) => (
    String(character?.role || '').toLowerCase() !== 'minor'
  ));
  const protagonists = importantCharacters.filter((character) => (
    isCentralCharacterRole(character?.role)
  ));
  const characterLimit = getSeedCharacterLimit(chapterCount);

  if (protagonists.length === 0) {
    blockingIssues.push(createIssue(
      'blocking',
      'seed-missing-protagonist',
      'Nền truyện phải có ít nhất một nhân vật chính hoặc trung tâm.',
    ));
  } else if (protagonists.length > 2) {
    warnings.push(createIssue(
      'warning',
      'seed-too-many-protagonists',
      'Nền truyện có hơn hai nhân vật chính; vẫn dùng được nhưng nên giữ tuyến mở đầu thật tập trung.',
      { protagonistCount: protagonists.length },
    ));
  }

  if (importantCharacters.length > characterLimit) {
    blockingIssues.push(createIssue(
      'blocking',
      'seed-character-cap-exceeded',
      `${chapterCount} chương khởi đầu chỉ nên có tối đa ${characterLimit} nhân vật quan trọng, hiện có ${importantCharacters.length}.`,
      { characterCount: importantCharacters.length, characterLimit, chapterCount },
    ));
  }

  if (chapterCount >= 2 && importantCharacters.length < 2) {
    warnings.push(createIssue(
      'warning',
      'seed-character-count-low',
      'Seed đang rất ít nhân vật so với số chương khởi đầu; vẫn dùng được nếu truyện mở đầu đơn tuyến.',
      { characterCount: importantCharacters.length, chapterCount },
    ));
  }

  importantCharacters
    .filter((character) => !isCentralCharacterRole(character?.role))
    .forEach((character, index) => {
      const name = getBlueprintEntityName(character) || `Nhân vật phụ ${index + 1}`;
      if (!normalizeOptionalText(character.story_function) || looksDeferredToFuture(character.story_function)) {
        blockingIssues.push(createIssue(
          'blocking',
          'seed-deferred-character',
          `Nhân vật "${name}" chưa có vai trò sớm rõ ràng; không tạo nhân vật để dành về sau trong nền truyện.`,
          { entityName: name },
        ));
      }
    });

  if (Array.isArray(seed.chapters) && seed.chapters.length > 0) {
    warnings.push(createIssue(
      'warning',
      'seed-contained-chapters',
      'Nền truyện không nên chứa dàn ý chương; app sẽ bỏ qua phần dàn ý ở bước tạo nền truyện.',
      { chapterCount: seed.chapters.length },
    ));
  }

  return { blockingIssues, warnings };
}

function buildNameSet(items = [], getter = getBlueprintEntityName) {
  return new Set(
    items
      .map((item) => normalizeBlueprintText(getter(item)))
      .filter(Boolean),
  );
}

function buildAcceptedProposalEntities(proposedEntities = {}, acceptedProposals = new Set()) {
  const normalized = normalizeProposedEntities(proposedEntities);
  return Object.fromEntries(
    Object.entries(normalized).map(([collectionKey, items]) => [
      collectionKey,
      items.filter((_, index) => acceptedProposals.has(`proposal-${collectionKey}-${index}`)),
    ]),
  );
}

function hasProposalReference(proposedEntities = {}, collectionKey, reference) {
  const normalizedReference = normalizeBlueprintText(reference);
  if (!normalizedReference) return false;
  const getter = collectionKey === 'plot_threads'
    ? (item) => item?.title
    : getBlueprintEntityName;
  return (proposedEntities[collectionKey] || []).some((item) => (
    normalizeBlueprintText(getter(item)) === normalizedReference
  ));
}

function pushUnknownReferenceIssues({
  blockingIssues,
  warnings,
  collectionKey,
  allowedSet,
  proposedEntities,
  references,
  chapterSignal,
  label,
  requireNonEmpty = false,
}) {
  normalizeChapterListField(references).forEach((reference) => {
    const normalizedReference = normalizeBlueprintText(reference);
    if (!normalizedReference || allowedSet.has(normalizedReference)) return;

    if (hasProposalReference(proposedEntities, collectionKey, reference)) {
      blockingIssues.push(createIssue(
        'blocking',
        'outline-proposal-pending',
        `${chapterSignal.title} dùng ${label} "${reference}" từ Đề xuất mới nhưng đề xuất này chưa được duyệt.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title, entityName: reference, collectionKey },
      ));
      return;
    }

    blockingIssues.push(createIssue(
      'blocking',
      `outline-unknown-${collectionKey}`,
      `${chapterSignal.title} gọi ${label} "${reference}" chưa có trong nền truyện và không nằm trong Đề xuất mới.`,
      { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title, entityName: reference, collectionKey },
    ));
  });

  if (requireNonEmpty && (!references || normalizeChapterListField(references).length === 0)) {
    warnings.push(createIssue(
      'warning',
      `outline-empty-${collectionKey}`,
      `${chapterSignal.title} chưa khai báo ${label}.`,
      { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title, collectionKey },
    ));
  }
}

export function buildChapterOutlinePassValidation(outline = {}, seed = {}, options = {}) {
  const excluded = options.excluded || new Set();
  const acceptedProposals = options.acceptedProposals || new Set();
  const proposedEntities = normalizeProposedEntities(outline.proposed_entities || seed.proposed_entities);
  const acceptedEntities = buildAcceptedProposalEntities(proposedEntities, acceptedProposals);
  const includedChapters = (outline.chapters || []).filter((_, index) => !excluded.has(`chapter-${index}`));
  const blockingIssues = [];
  const warnings = [];

  if (includedChapters.length === 0) {
    blockingIssues.push(createIssue(
      'blocking',
      'outline-missing-chapters',
      'Dàn ý chương phải có ít nhất một chương.',
    ));
    return { blockingIssues, warnings, chapterSignals: [] };
  }

  const allowedCharacters = buildNameSet([...(seed.characters || []), ...(acceptedEntities.characters || [])]);
  const allowedLocations = buildNameSet([...(seed.locations || []), ...(acceptedEntities.locations || [])]);
  const allowedObjects = buildNameSet([...(seed.objects || []), ...(acceptedEntities.objects || [])]);
  const allowedFactions = buildNameSet([...(seed.factions || []), ...(acceptedEntities.factions || [])]);
  const allowedTerms = buildNameSet([...(seed.terms || []), ...(acceptedEntities.terms || [])]);
  const allowedThreads = buildNameSet([...(seed.plot_threads || []), ...(acceptedEntities.plot_threads || [])], (item) => item?.title);

  const chapterSignals = includedChapters.map((chapter, index) => ({
    index,
    chapter,
    title: chapter.title || `Chương ${index + 1}`,
    openingState: normalizeOptionalText(chapter.opening_state),
    handoffFromPrevious: normalizeOptionalText(chapter.handoff_from_previous),
    endingState: normalizeOptionalText(chapter.ending_state),
    featuredCharacters: normalizeChapterListField(chapter.featured_characters),
    primaryLocation: normalizeOptionalText(chapter.primary_location),
    threadTitles: normalizeChapterListField(chapter.thread_titles),
    requiredFactions: normalizeChapterListField(chapter.required_factions),
    requiredObjects: normalizeChapterListField(chapter.required_objects),
    requiredTerms: normalizeChapterListField(chapter.required_terms),
  }));

  chapterSignals.forEach((chapterSignal) => {
    if (!chapterSignal.openingState) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-opening-state',
        `${chapterSignal.title} thiếu Trạng thái mở chương.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterSignal.endingState) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-ending-state',
        `${chapterSignal.title} thiếu Trạng thái kết chương.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (chapterSignal.index > 0 && !chapterSignal.handoffFromPrevious) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-handoff',
        `${chapterSignal.title} thiếu Cầu nối từ chương trước.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }

    pushUnknownReferenceIssues({
      blockingIssues,
      warnings,
      collectionKey: 'characters',
      allowedSet: allowedCharacters,
      proposedEntities,
      references: chapterSignal.featuredCharacters,
      chapterSignal,
      label: 'nhân vật',
      requireNonEmpty: true,
    });

    pushUnknownReferenceIssues({
      blockingIssues,
      warnings,
      collectionKey: 'locations',
      allowedSet: allowedLocations,
      proposedEntities,
      references: chapterSignal.primaryLocation ? [chapterSignal.primaryLocation] : [],
      chapterSignal,
      label: 'địa điểm',
      requireNonEmpty: true,
    });

    pushUnknownReferenceIssues({
      blockingIssues,
      warnings,
      collectionKey: 'plot_threads',
      allowedSet: allowedThreads,
      proposedEntities,
      references: chapterSignal.threadTitles,
      chapterSignal,
      label: 'tuyến truyện',
      requireNonEmpty: true,
    });

    pushUnknownReferenceIssues({
      blockingIssues,
      warnings,
      collectionKey: 'factions',
      allowedSet: allowedFactions,
      proposedEntities,
      references: chapterSignal.requiredFactions,
      chapterSignal,
      label: 'thế lực',
    });

    pushUnknownReferenceIssues({
      blockingIssues,
      warnings,
      collectionKey: 'objects',
      allowedSet: allowedObjects,
      proposedEntities,
      references: chapterSignal.requiredObjects,
      chapterSignal,
      label: 'vật phẩm',
    });

    pushUnknownReferenceIssues({
      blockingIssues,
      warnings,
      collectionKey: 'terms',
      allowedSet: allowedTerms,
      proposedEntities,
      references: chapterSignal.requiredTerms,
      chapterSignal,
      label: 'thuật ngữ',
    });
  });

  return { blockingIssues, warnings, chapterSignals };
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
      title: chapter.title || `Chương ${index + 1}`,
      purpose: normalizeOptionalText(chapter.purpose),
      summary: normalizeOptionalText(chapter.summary),
      openingState: normalizeOptionalText(chapter.opening_state),
      handoffFromPrevious: normalizeOptionalText(chapter.handoff_from_previous),
      endingState: normalizeOptionalText(chapter.ending_state),
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
        `${chapterSignal.title} thiếu mục đích rõ ràng.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (chapterSignal.featuredCharacters.length === 0) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-featured-characters',
        `${chapterSignal.title} chưa gắn nhân vật xuất hiện.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterSignal.primaryLocation) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-primary-location',
        `${chapterSignal.title} chưa có địa điểm chính.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterHasCanonAnchor(chapterSignal.chapter)) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-thread-anchor',
        `${chapterSignal.title} chưa có tuyến truyện hoặc sự kiện chính để neo cốt truyện.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterSignal.openingState) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-opening-state',
        `${chapterSignal.title} thiếu trạng thái mở chương.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (!chapterSignal.endingState) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-ending-state',
        `${chapterSignal.title} thiếu trạng thái kết chương để chương sau nối tiếp.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
    if (chapterSignal.index > 0 && !chapterSignal.handoffFromPrevious) {
      blockingIssues.push(createIssue(
        'blocking',
        'chapter-missing-handoff',
        `${chapterSignal.title} thiếu cầu nối nhân quả với chương trước.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    } else if (chapterSignal.handoffFromPrevious && countBlueprintWords(chapterSignal.handoffFromPrevious) < 5) {
      warnings.push(createIssue(
        'warning',
        'chapter-handoff-thin',
        `${chapterSignal.title} có cầu nối chương trước quá mỏng, nên nêu rõ quan hệ nhân quả từ chương trước.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
  });

  const protagonistNames = includedCharacters
    .filter((character) => character?.name && isCentralCharacterRole(character.role))
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
        `Nhân vật chính/trung tâm "${name}" không xuất hiện trong chương đầu.`,
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
          `Tuyến truyện "${thread.title}" không có chương neo rõ ràng.`,
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
          `Địa điểm "${location.name}" không được chương nào sử dụng.`,
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
          `Thế lực "${faction.name}" không được chương nào chạm tới.`,
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
          `Thuật ngữ "${term.name}" không được chương nào chạm tới.`,
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
        message: `${issue.message} Kiểm tra lại nếu bạn vừa bỏ chương có chứa neo này.`,
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
          message: `Thế lực "${issue.entityName}" chưa được chương đầu chạm tới.`,
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
          message: `Thuật ngữ "${issue.entityName}" chưa được chương đầu chạm tới.`,
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
      'Số thực thể và tuyến truyện đang vượt khả năng gắn vào số chương đầu, dễ gây loãng.',
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
      'Dàn ý mở đầu có dấu hiệu đẩy quá nhiều nhịp truyện lớn trong số chương đầu, AI dễ lao nhanh hơn nhịp mong muốn.',
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
        `${chapterSignal.title} có dấu hiệu nhồi quá nhiều sự kiện hoặc tuyến trong một chương.`,
        { chapterIndex: chapterSignal.index, chapterTitle: chapterSignal.title },
      ));
    }
  });

  if (includedObjects.length > includedChapters.length + 1) {
    warnings.push(createIssue(
      'warning',
      'object-density-high',
      'Số vật phẩm đầu truyện đang nhiều hơn mức cần thiết.',
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
    opening_state: normalizeOptionalText(chapter.opening_state),
    handoff_from_previous: normalizeOptionalText(chapter.handoff_from_previous),
    ending_state: normalizeOptionalText(chapter.ending_state),
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
      'Chương này chưa có ngữ cảnh dàn ý, AI sẽ dễ viết lệch thiết lập.',
    ));
    return { blockingIssues, warnings };
  }

  if (!chapterBlueprintContext.purpose) {
    blockingIssues.push(createIssue('blocking', 'missing-purpose', 'Chương này chưa có mục đích để AI bám sát.'));
  }
  if (!Array.isArray(chapterBlueprintContext.featured_characters) || chapterBlueprintContext.featured_characters.length === 0) {
    blockingIssues.push(createIssue('blocking', 'missing-featured-characters', 'Chương này chưa gắn nhân vật xuất hiện.'));
  }
  if (!chapterBlueprintContext.primary_location) {
    blockingIssues.push(createIssue('blocking', 'missing-primary-location', 'Chương này chưa có địa điểm chính.'));
  }
  if (
    (!Array.isArray(chapterBlueprintContext.thread_titles) || chapterBlueprintContext.thread_titles.length === 0)
    && (!Array.isArray(chapterBlueprintContext.key_events) || chapterBlueprintContext.key_events.length === 0)
  ) {
    blockingIssues.push(createIssue('blocking', 'missing-story-anchor', 'Chương này chưa có tuyến truyện hoặc sự kiện chính để neo cốt truyện.'));
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
      'Neo chương hiện tại còn mỏng, AI dễ bịa thêm chi tiết ngoài dàn ý.',
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
        'Scene mới đang trống và chưa đủ setup POV/location/characters_present, AI dễ bị bịa.',
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
