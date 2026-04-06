import { useMemo } from 'react';

function normalizeText(value) {
  return String(value || '').trim();
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

    map.set(key, {
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
    });
  }

  return [...map.values()];
}

function extractTimeline(events = [], matcher = () => false, limit = 8) {
  const matched = [];
  for (const event of events || []) {
    if (!event) continue;
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

    if (eventLocation && (eventLocation === entityName || eventLocation.includes(entityName) || entityName.includes(eventLocation))) {
      return true;
    }
    if (desc.includes(entityName)) {
      return true;
    }
    if (tags.some((tag) => tag.includes(entityName) || entityName.includes(tag))) {
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

function countCharacterAppearances(name, events = []) {
  const comparable = toComparable(name);
  let count = 0;
  for (const event of toArray(events)) {
    const names = toArray(event.characters).map(toComparable);
    if (names.includes(comparable)) count += 1;
  }
  return count;
}

function characterChapters(name, events = []) {
  const comparable = toComparable(name);
  const chapters = toArray(events)
    .filter((event) => toArray(event.characters).map(toComparable).includes(comparable))
    .map((event) => Number(event.chapter))
    .filter((chapter) => Number.isFinite(chapter) && chapter > 0);
  return [...new Set(chapters)].sort((left, right) => left - right);
}

function characterLocations(name, events = []) {
  const comparable = toComparable(name);
  const map = new Map();
  for (const event of toArray(events)) {
    const names = toArray(event.characters).map(toComparable);
    if (!names.includes(comparable)) continue;
    const locationName = normalizeText(event.locationLink?.locationName || event.primaryLocationName || '');
    if (!locationName) continue;
    const key = makeSlug(locationName);
    if (!map.has(key)) {
      map.set(key, locationName);
    }
  }
  return [...map.values()];
}

function inferFallbackRole(name, events = [], rankedNames = new Map()) {
  const appearances = countCharacterAppearances(name, events);
  const top = rankedNames.get('top') || 0;
  if (appearances === 0) return 'chưa suy ra';
  if (appearances === top && top > 0) return 'trung tâm';
  if (top > 0 && appearances >= Math.ceil(top * 0.5)) return 'nổi bật';
  return 'phụ';
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
  const characters = dedupeKnowledgeItems(parsed?.characterProfiles);
  const locations = dedupeKnowledgeItems(parsed?.locations);
  const objects = dedupeKnowledgeItems(parsed?.objects);
  const terms = dedupeKnowledgeItems(parsed?.terms);

  const passCStatus = passStatus?.pass_c || passStatus?.knowledge || null;
  const hasKnowledgeDegraded = passCStatus?.status === 'degraded'
    || toArray(degradedReport?.items).some((item) => String(item?.passId || '') === 'pass_c');

  const characterRankMap = useMemo(() => {
    const counts = characters
      .map((item) => countCharacterAppearances(item.name, events))
      .sort((left, right) => right - left);
    return new Map([['top', counts[0] || 0]]);
  }, [characters, events]);

  const enrichedCharacters = useMemo(() => {
    return characters.map((item) => {
      const appearances = countCharacterAppearances(item.name, events);
      const chapters = characterChapters(item.name, events);
      const relatedLocations = characterLocations(item.name, events);
      const fallbackRole = inferFallbackRole(item.name, events, characterRankMap);
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

  const termTimelineMap = useMemo(() => {
    const map = new Map();
    for (const term of terms) {
      map.set(makeSlug(term.name), timelineFromEntity(term, events));
    }
    return map;
  }, [terms, events]);

  return (
    <div className="knowledge-view">
      {hasKnowledgeDegraded && (
        <div className="knowledge-note knowledge-note-warning">
          Pass tri thức đang ở trạng thái degraded. Màn này hiện đang ghép từ dữ liệu sự kiện/incidents có sẵn, nên hồ sơ chi tiết có thể thiếu.
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
            Run này chưa có world profile đủ tốt để hiển thị. Nguyên nhân thường là Pass C không rút được tri thức thế giới từ incidents/events.
          </div>
        )}
      </Section>

      <Section title="Nhân Vật" count={enrichedCharacters.length}>
        <div className="knowledge-grid">
          {enrichedCharacters.map((item, index) => (
            <article key={entityViewKey('char', item, index)} className="knowledge-card">
              <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
              <p><strong>Vai trò:</strong> {item._displayRole || 'chưa suy ra'}</p>
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
                  {item.flaws && <p><strong>Điểm yếu / khuyết điểm:</strong> {item.flaws}</p>}
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
                  <p><strong>Dòng thời gian:</strong> {timeline.length ? timeline.map((t) => `Ch.${t.chapter || '?'} ${t.summary || t.eventId || ''}`).join(' | ') : 'Chưa có'}</p>
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
                  <p><strong>Dòng thời gian:</strong> {timeline.length ? timeline.map((t) => `Ch.${t.chapter || '?'} ${t.summary || t.eventId || ''}`).join(' | ') : 'Chưa có'}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="knowledge-note">Chưa có vật phẩm canonical để hiển thị.</div>
        )}
      </Section>

      <Section title="Thuật Ngữ" count={terms.length}>
        {terms.length > 0 ? (
          <div className="knowledge-grid">
            {terms.map((item, index) => {
              const timeline = termTimelineMap.get(makeSlug(item.name)) || [];
              return (
                <article key={entityViewKey('term', item, index)} className="knowledge-card">
                  <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                  {item.category && <p><strong>Phân loại:</strong> {item.category}</p>}
                  {item.definition && <p><strong>Định nghĩa:</strong> {item.definition}</p>}
                  <p><strong>Dòng thời gian:</strong> {timeline.length ? timeline.map((t) => `Ch.${t.chapter || '?'} ${t.summary || t.eventId || ''}`).join(' | ') : 'Chưa có'}</p>
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
