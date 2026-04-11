import { useMemo } from 'react';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLooseText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toComparable(value) {
  return normalizeText(value).toLowerCase();
}

function makeSlug(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

function tokenizeName(value) {
  return normalizeText(value).split(/\s+/u).filter(Boolean);
}

function dedupeTimeline(items = []) {
  const map = new Map();
  for (const item of toArray(items)) {
    if (!item) continue;
    const normalized = {
      eventId: item?.eventId || item?.id || null,
      chapter: Number.isFinite(Number(item?.chapter)) ? Number(item.chapter) : null,
      summary: normalizeText(item?.summary || item?.description || ''),
    };
    if (!(normalized.eventId || normalized.chapter || normalized.summary)) continue;
    const key = `${normalized.eventId || ''}|${normalized.chapter || ''}|${normalized.summary || ''}`;
    if (!map.has(key)) {
      map.set(key, normalized);
    }
  }
  return [...map.values()].sort((left, right) => Number(left.chapter || 999999) - Number(right.chapter || 999999));
}

function mergeKnowledgeItem(existing, item) {
  return {
    ...existing,
    ...item,
    id: existing.id || item.id,
    name: existing.name || item.name,
    description: existing.description || item.description,
    definition: existing.definition || item.definition,
    owner: existing.owner || item.owner,
    category: existing.category || item.category,
    properties: existing.properties || item.properties,
    aliases: [...new Set([...(existing.aliases || []), ...(item.aliases || [])])],
    timeline: dedupeTimeline([...(existing.timeline || []), ...(item.timeline || [])]),
  };
}

function dedupeKnowledgeItems(items = []) {
  const map = new Map();

  for (const item of toArray(items)) {
    if (!item) continue;
    const name = normalizeText(item.name);
    if (!name) continue;

    const key = makeSlug(name) || toComparable(name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    map.set(key, mergeKnowledgeItem(existing, item));
  }

  return [...map.values()];
}

function extractTimeline(events = [], matcher = () => false, limit = 8) {
  const matched = [];
  for (const event of toArray(events)) {
    if (!matcher(event)) continue;
    matched.push({
      eventId: event.id || null,
      chapter: Number.isFinite(Number(event.chapter)) ? Number(event.chapter) : null,
      summary: normalizeText(event.description || event.summary || ''),
    });
  }

  return dedupeTimeline(matched).slice(0, limit);
}

function timelineFromEntity(entity = {}, events = []) {
  const explicit = dedupeTimeline(entity.timeline || []);
  if (explicit.length > 0) return explicit;

  const entityName = toComparable(entity.name);
  if (!entityName) return [];

  return extractTimeline(events, (event) => {
    const eventLocation = toComparable(event.locationLink?.locationName || event.primaryLocationName);
    const desc = toComparable(event.description || '');
    const tags = toArray(event.tags).map(toComparable);
    const terms = toArray(event.terms).map(toComparable);
    const objects = toArray(event.objects).map(toComparable);

    if (eventLocation && (eventLocation === entityName || eventLocation.includes(entityName) || entityName.includes(eventLocation))) {
      return true;
    }
    if (desc.includes(entityName)) {
      return true;
    }
    if (tags.some((tag) => tag.includes(entityName) || entityName.includes(tag))) {
      return true;
    }
    if (terms.some((term) => term.includes(entityName) || entityName.includes(term))) {
      return true;
    }
    if (objects.some((object) => object.includes(entityName) || entityName.includes(object))) {
      return true;
    }
    return false;
  });
}

function entityViewKey(prefix, item, index) {
  const id = normalizeText(item?.id);
  const name = makeSlug(item?.name || '');
  return `${prefix}:${id || 'noid'}:${name || 'noname'}:${index}`;
}

function hasMeaningfulWorldProfile(worldProfile = {}) {
  const worldType = normalizeText(worldProfile?.worldType);
  return Boolean(
    normalizeText(worldProfile?.worldName)
    || (worldType && worldType.toLowerCase() !== 'unknown' ? worldType : '')
    || normalizeText(worldProfile?.worldScale)
    || normalizeText(worldProfile?.worldEra)
    || normalizeText(worldProfile?.worldDescription)
    || toArray(worldProfile?.worldRules).length,
  );
}

function hasDetailedCharacterProfile(item = {}) {
  return Boolean(
    normalizeText(item.appearance)
    || normalizeText(item.description)
    || normalizeText(item.personality)
    || toArray(item.personalityTags || item.personality_tags || item.traits).length
    || normalizeText(item.flaws)
    || normalizeText(item.goals)
    || normalizeText(item.motivation)
    || normalizeText(item.secrets),
  );
}

function characterTailKey(name) {
  const tokens = tokenizeName(name);
  if (!tokens.length) return '';
  return normalizeLooseText(tokens.slice(-Math.min(2, tokens.length)).join(' '));
}

function mergeCharacterProfiles(items = []) {
  const merged = [];

  const mergeIntoTarget = (target, source) => ({
    ...mergeKnowledgeItem(target, source),
    name: hasDetailedCharacterProfile(target) ? target.name : (source.name || target.name),
    role: target.role || source.role,
    appearance: target.appearance || source.appearance,
    description: target.description || source.description,
    personality: target.personality || source.personality,
    flaws: target.flaws || source.flaws,
    goals: target.goals || source.goals,
    motivation: target.motivation || source.motivation,
    secrets: target.secrets || source.secrets,
    aliases: [...new Set([
      target.name,
      source.name,
      ...(target.aliases || []),
      ...(source.aliases || []),
    ].map((entry) => normalizeText(entry)).filter(Boolean))],
  });

  for (const item of toArray(items)) {
    if (!item?.name) continue;

    const exactIndex = merged.findIndex((existing) => toComparable(existing.name) === toComparable(item.name));
    if (exactIndex >= 0) {
      merged[exactIndex] = mergeIntoTarget(merged[exactIndex], item);
      continue;
    }

    const itemTail = characterTailKey(item.name);
    const similarIndex = merged.findIndex((existing) => {
      if (!itemTail || itemTail !== characterTailKey(existing.name)) return false;
      const eitherFallback = !hasDetailedCharacterProfile(existing) || !hasDetailedCharacterProfile(item);
      const eitherShort = Math.min(tokenizeName(existing.name).length, tokenizeName(item.name).length) <= 2;
      return eitherFallback || eitherShort;
    });

    if (similarIndex >= 0) {
      merged[similarIndex] = mergeIntoTarget(merged[similarIndex], item);
      continue;
    }

    merged.push({
      ...item,
      aliases: [...new Set([item.name, ...(item.aliases || [])].map((entry) => normalizeText(entry)).filter(Boolean))],
    });
  }

  return merged;
}

function characterNameSet(character = {}) {
  return new Set(
    [character?.name, ...(character?.aliases || [])]
      .map(toComparable)
      .filter(Boolean),
  );
}

function countCharacterAppearances(character, events = []) {
  const comparableNames = characterNameSet(character);
  let count = 0;
  for (const event of toArray(events)) {
    const names = toArray(event.characters).map(toComparable);
    if (names.some((name) => comparableNames.has(name))) count += 1;
  }
  return count;
}

function characterChapters(character, events = []) {
  const comparableNames = characterNameSet(character);
  const chapters = toArray(events)
    .filter((event) => toArray(event.characters).map(toComparable).some((name) => comparableNames.has(name)))
    .map((event) => Number(event.chapter))
    .filter((chapter) => Number.isFinite(chapter) && chapter > 0);
  return [...new Set(chapters)].sort((left, right) => left - right);
}

function characterLocations(character, events = []) {
  const comparableNames = characterNameSet(character);
  const map = new Map();
  for (const event of toArray(events)) {
    const names = toArray(event.characters).map(toComparable);
    if (!names.some((name) => comparableNames.has(name))) continue;
    const locationName = normalizeText(event.locationLink?.locationName || event.primaryLocationName || '');
    if (!locationName) continue;
    const key = makeSlug(locationName);
    if (!map.has(key)) {
      map.set(key, locationName);
    }
  }
  return [...map.values()];
}

function inferFallbackRole(character, events = [], rankedNames = new Map()) {
  const appearances = countCharacterAppearances(character, events);
  const top = rankedNames.get('top') || 0;
  if (appearances === 0) return 'chưa suy ra';
  if (appearances === top && top > 0) return 'trung tâm';
  if (top > 0 && appearances >= Math.ceil(top * 0.5)) return 'nổi bật';
  return 'phụ';
}

function buildTermEnrichment(term, events = []) {
  const variants = new Set([term.name, ...(term.aliases || [])].map(toComparable).filter(Boolean));
  const matchedEvents = toArray(events).filter((event) => {
    const eventTerms = toArray(event.terms).map(toComparable);
    return eventTerms.some((item) => variants.has(item));
  });
  const chapters = [...new Set(
    matchedEvents
      .map((event) => Number(event.chapter))
      .filter((chapter) => Number.isFinite(chapter) && chapter > 0),
  )].sort((left, right) => left - right);

  return {
    ...term,
    _mentionCount: matchedEvents.length,
    _chapters: chapters,
    _fallbackDefinition: normalizeText(term.definition)
      || normalizeText(term.description)
      || normalizeText(matchedEvents[0]?.description || ''),
    _fallback: !normalizeText(term.definition),
  };
}

function renderTimeline(timeline = []) {
  if (!timeline.length) return 'Chưa có';
  return timeline.map((item) => `Ch.${item.chapter || '?'} ${item.summary || item.eventId || ''}`).join(' | ');
}

function Section({ title, count, children }) {
  return (
    <section className="knowledge-section">
      <div className="knowledge-section-head">
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

export default function KnowledgeView({
  parsed = null,
  events = [],
  passStatus = null,
  degradedReport = null,
}) {
  const worldProfile = parsed?.worldProfile || {};
  const characters = mergeCharacterProfiles(dedupeKnowledgeItems(parsed?.characterProfiles));
  const locations = dedupeKnowledgeItems(parsed?.locations);
  const objects = dedupeKnowledgeItems(parsed?.objects);
  const terms = dedupeKnowledgeItems(parsed?.terms);

  const passCStatus = passStatus?.pass_c || passStatus?.knowledge || null;
  const hasKnowledgeDegraded = passCStatus?.status === 'degraded'
    || toArray(degradedReport?.items).some((item) => String(item?.passId || '') === 'pass_c');

  const characterRankMap = useMemo(() => {
    const counts = characters
      .map((item) => countCharacterAppearances(item, events))
      .sort((left, right) => right - left);
    return new Map([['top', counts[0] || 0]]);
  }, [characters, events]);

  const enrichedCharacters = useMemo(() => {
    return characters.map((item) => {
      const appearances = countCharacterAppearances(item, events);
      const chapters = characterChapters(item, events);
      const relatedLocations = characterLocations(item, events);
      const fallbackRole = inferFallbackRole(item, events, characterRankMap);
      return {
        ...item,
        _fallback: !hasDetailedCharacterProfile(item),
        _appearances: appearances,
        _chapters: chapters,
        _relatedLocations: relatedLocations,
        _displayRole: normalizeText(item.role) && normalizeText(item.role) !== 'secondary'
          ? item.role
          : fallbackRole,
      };
    });
  }, [characters, characterRankMap, events]);

  const locationTimelineMap = useMemo(() => {
    const map = new Map();
    for (const location of locations) {
      map.set(makeSlug(location.name), timelineFromEntity(location, events));
    }
    return map;
  }, [locations, events]);

  const objectTimelineMap = useMemo(() => {
    const map = new Map();
    for (const object of objects) {
      map.set(makeSlug(object.name), timelineFromEntity(object, events));
    }
    return map;
  }, [objects, events]);

  const enrichedTerms = useMemo(() => {
    return terms.map((term) => buildTermEnrichment(term, events));
  }, [events, terms]);

  const termTimelineMap = useMemo(() => {
    const map = new Map();
    for (const term of enrichedTerms) {
      map.set(makeSlug(term.name), timelineFromEntity(term, events));
    }
    return map;
  }, [enrichedTerms, events]);

  return (
    <div className="knowledge-view">
      {hasKnowledgeDegraded && (
        <div className="knowledge-note knowledge-note-warning">
          Pass tri thức đang ở trạng thái degraded. Màn này đang ghép từ dữ liệu sự kiện và incident có sẵn,
          nên hồ sơ chi tiết có thể chưa đầy đủ.
        </div>
      )}

      <Section title="Thế Giới" count={hasMeaningfulWorldProfile(worldProfile) ? 1 : 0}>
        {hasMeaningfulWorldProfile(worldProfile) ? (
          <div className="knowledge-card">
            {worldProfile?.worldName && <p><strong>Tên:</strong> {worldProfile.worldName}</p>}
            {normalizeText(worldProfile?.worldType) && String(worldProfile.worldType).toLowerCase() !== 'unknown' && (
              <p><strong>Loại:</strong> {worldProfile.worldType}</p>
            )}
            {worldProfile?.worldScale && <p><strong>Quy mô:</strong> {worldProfile.worldScale}</p>}
            {worldProfile?.worldEra && <p><strong>Thời đại:</strong> {worldProfile.worldEra}</p>}
            {worldProfile?.worldDescription && <p><strong>Mô tả:</strong> {worldProfile.worldDescription}</p>}
            {toArray(worldProfile?.worldRules).length > 0 && (
              <p><strong>Quy tắc:</strong> {toArray(worldProfile.worldRules).join(' | ')}</p>
            )}
          </div>
        ) : (
          <div className="knowledge-note">
            Run này chưa có world profile đủ tốt để hiển thị. Thường là Pass C chưa rút được tri thức thế giới
            đủ chắc từ incidents và beats.
          </div>
        )}
      </Section>

      <Section title="Nhân Vật" count={enrichedCharacters.length}>
        <div className="knowledge-grid">
          {enrichedCharacters.map((item, index) => (
            <article key={entityViewKey('char', item, index)} className="knowledge-card">
              <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
              <p><strong>Vai trò:</strong> {item._displayRole || 'chưa suy ra'}</p>
              {toArray(item.aliases).length > 1 && (
                <p><strong>Bí danh:</strong> {toArray(item.aliases).filter((alias) => alias !== item.name).join(', ')}</p>
              )}
              {item._fallback ? (
                <>
                  <p><strong>Nguồn:</strong> fallback từ events/incidents</p>
                  <p><strong>Xuất hiện:</strong> {item._appearances || 0} sự kiện</p>
                  <p><strong>Chương:</strong> {item._chapters.length ? `${item._chapters[0]} - ${item._chapters[item._chapters.length - 1]}` : 'Chưa rõ'}</p>
                  {item._relatedLocations.length > 0 && (
                    <p><strong>Địa điểm liên quan:</strong> {item._relatedLocations.join(', ')}</p>
                  )}
                </>
              ) : (
                <>
                  {(item.appearance || item.description) && <p><strong>Ngoại hình:</strong> {item.appearance || item.description}</p>}
                  {(item.personality || toArray(item.traits).length > 0) && <p><strong>Tính cách:</strong> {item.personality || toArray(item.traits).join(', ')}</p>}
                  {toArray(item.personalityTags || item.personality_tags || item.traits).length > 0 && (
                    <p><strong>Tags tâm lý:</strong> {toArray(item.personalityTags || item.personality_tags || item.traits).join(', ')}</p>
                  )}
                  {item.flaws && <p><strong>Điểm yếu:</strong> {item.flaws}</p>}
                  {(item.goals || item.motivation) && <p><strong>Mục tiêu:</strong> {item.goals || item.motivation}</p>}
                  {item.secrets && <p><strong>Bí mật:</strong> {item.secrets}</p>}
                </>
              )}
            </article>
          ))}
        </div>
      </Section>

      <Section title="Địa Điểm" count={locations.length}>
        {locations.length > 0 ? (
          <div className="knowledge-grid">
            {locations.map((item, index) => {
              const timeline = locationTimelineMap.get(makeSlug(item.name)) || [];
              return (
                <article key={entityViewKey('loc', item, index)} className="knowledge-card">
                  <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                  {item.description && <p><strong>Mô tả:</strong> {item.description}</p>}
                  {(item.chapterStart || item.chapterEnd) && (
                    <p><strong>Chương:</strong> {item.chapterStart || '?'} - {item.chapterEnd || '?'}</p>
                  )}
                  <p><strong>Dòng thời gian:</strong> {renderTimeline(timeline)}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-note">Chưa có địa điểm canonical đủ sạch để hiển thị.</div>
        )}
      </Section>

      <Section title="Vật Phẩm" count={objects.length}>
        {objects.length > 0 ? (
          <div className="knowledge-grid">
            {objects.map((item, index) => {
              const timeline = objectTimelineMap.get(makeSlug(item.name)) || [];
              return (
                <article key={entityViewKey('obj', item, index)} className="knowledge-card">
                  <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                  {item.owner && <p><strong>Chủ sở hữu:</strong> {item.owner}</p>}
                  {item.description && <p><strong>Mô tả:</strong> {item.description}</p>}
                  {item.properties && <p><strong>Thuộc tính:</strong> {item.properties}</p>}
                  <p><strong>Dòng thời gian:</strong> {renderTimeline(timeline)}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-note">Chưa có vật phẩm canonical để hiển thị.</div>
        )}
      </Section>

      <Section title="Thuật Ngữ" count={enrichedTerms.length}>
        {enrichedTerms.length > 0 ? (
          <div className="knowledge-grid">
            {enrichedTerms.map((item, index) => {
              const timeline = termTimelineMap.get(makeSlug(item.name)) || [];
              return (
                <article key={entityViewKey('term', item, index)} className="knowledge-card">
                  <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                  {item.category && <p><strong>Phân loại:</strong> {item.category}</p>}
                  {item._fallback ? (
                    <>
                      <p><strong>Nguồn:</strong> fallback từ events/incidents</p>
                      {item._fallbackDefinition && <p><strong>Diễn giải:</strong> {item._fallbackDefinition}</p>}
                      <p><strong>Nhắc tới:</strong> {item._mentionCount || 0} sự kiện</p>
                      <p><strong>Chương:</strong> {item._chapters.length ? `${item._chapters[0]} - ${item._chapters[item._chapters.length - 1]}` : 'Chưa rõ'}</p>
                    </>
                  ) : (
                    <>
                      {item.definition && <p><strong>Định nghĩa:</strong> {item.definition}</p>}
                      {item.description && <p><strong>Mô tả:</strong> {item.description}</p>}
                    </>
                  )}
                  <p><strong>Dòng thời gian:</strong> {renderTimeline(timeline)}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-note">Chưa có thuật ngữ canonical để hiển thị.</div>
        )}
      </Section>
    </div>
  );
}
