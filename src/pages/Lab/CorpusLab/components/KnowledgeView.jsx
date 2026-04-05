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

  return matched
    .sort((a, b) => Number(a.chapter || 999999) - Number(b.chapter || 999999))
    .slice(0, limit);
}

function timelineFromEntity(entity = {}, events = []) {
  const explicit = toArray(entity.timeline)
    .map((item) => ({
      eventId: item?.eventId || item?.id || null,
      chapter: Number.isFinite(Number(item?.chapter)) ? Number(item.chapter) : null,
      summary: normalizeText(item?.summary || item?.description || ''),
    }))
    .filter((item) => item.chapter || item.summary);
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
}) {
  const worldProfile = parsed?.worldProfile || {};
  const characters = toArray(parsed?.characterProfiles);
  const locations = toArray(parsed?.locations);
  const objects = toArray(parsed?.objects);
  const terms = toArray(parsed?.terms);

  const locationTimelineMap = useMemo(() => {
    const map = new Map();
    for (const location of locations) {
      map.set(location.id || location.name, timelineFromEntity(location, events));
    }
    return map;
  }, [locations, events]);

  const objectTimelineMap = useMemo(() => {
    const map = new Map();
    for (const object of objects) {
      map.set(object.id || object.name, timelineFromEntity(object, events));
    }
    return map;
  }, [objects, events]);

  const termTimelineMap = useMemo(() => {
    const map = new Map();
    for (const term of terms) {
      map.set(term.id || term.name, timelineFromEntity(term, events));
    }
    return map;
  }, [terms, events]);

  return (
    <div className="knowledge-view">
      <Section title="Thế Giới" count={worldProfile?.worldName ? 1 : 0}>
        <div className="knowledge-card">
          <p><strong>Tên:</strong> {worldProfile?.worldName || 'Chưa có'}</p>
          <p><strong>Loại:</strong> {worldProfile?.worldType || 'Chưa có'}</p>
          <p><strong>Quy mô:</strong> {worldProfile?.worldScale || 'Chưa có'}</p>
          <p><strong>Thời đại:</strong> {worldProfile?.worldEra || 'Chưa có'}</p>
          <p><strong>Mô tả:</strong> {worldProfile?.worldDescription || 'Chưa có'}</p>
          <p><strong>Quy tắc:</strong> {toArray(worldProfile?.worldRules).length ? toArray(worldProfile.worldRules).join(' | ') : 'Chưa có'}</p>
        </div>
      </Section>

      <Section title="Nhân Vật" count={characters.length}>
        <div className="knowledge-grid">
          {characters.map((item) => (
            <article key={item.id} className="knowledge-card">
              <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
              <p><strong>Vai trò:</strong> {item.role || 'supporting'}</p>
              <p><strong>Ngoại hình:</strong> {item.appearance || item.description || 'Chưa có'}</p>
              <p><strong>Tính cách:</strong> {item.personality || (toArray(item.traits).join(', ') || 'Chưa có')}</p>
              <p><strong>Tags tâm lý:</strong> {toArray(item.personalityTags || item.personality_tags || item.traits).join(', ') || 'Chưa có'}</p>
              <p><strong>Điểm yếu / khuyết điểm:</strong> {item.flaws || 'Chưa có'}</p>
              <p><strong>Mục tiêu:</strong> {item.goals || item.motivation || 'Chưa có'}</p>
              <p><strong>Bí mật:</strong> {item.secrets || 'Chưa có'}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Địa Điểm" count={locations.length}>
        <div className="knowledge-grid">
          {locations.map((item) => {
            const timeline = locationTimelineMap.get(item.id || item.name) || [];
            return (
              <article key={item.id || item.name} className="knowledge-card">
                <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                <p><strong>Mô tả:</strong> {item.description || 'Chưa có'}</p>
                <p><strong>Chương:</strong> {item.chapterStart || '?'} - {item.chapterEnd || '?'}</p>
                <p><strong>Dòng thời gian:</strong> {timeline.length ? timeline.map((t) => `Ch.${t.chapter || '?'} ${t.summary || t.eventId || ''}`).join(' | ') : 'Chưa có'}</p>
              </article>
            );
          })}
        </div>
      </Section>

      <Section title="Vật Phẩm" count={objects.length}>
        <div className="knowledge-grid">
          {objects.map((item) => {
            const timeline = objectTimelineMap.get(item.id || item.name) || [];
            return (
              <article key={item.id || item.name} className="knowledge-card">
                <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                <p><strong>Chủ sở hữu:</strong> {item.owner || 'Chưa có'}</p>
                <p><strong>Mô tả:</strong> {item.description || 'Chưa có'}</p>
                <p><strong>Thuộc tính:</strong> {item.properties || 'Chưa có'}</p>
                <p><strong>Dòng thời gian:</strong> {timeline.length ? timeline.map((t) => `Ch.${t.chapter || '?'} ${t.summary || t.eventId || ''}`).join(' | ') : 'Chưa có'}</p>
              </article>
            );
          })}
        </div>
      </Section>

      <Section title="Thuật Ngữ" count={terms.length}>
        <div className="knowledge-grid">
          {terms.map((item) => {
            const timeline = termTimelineMap.get(item.id || item.name) || [];
            return (
              <article key={item.id || item.name} className="knowledge-card">
                <p><strong>Tên:</strong> {item.name || 'Chưa rõ'}</p>
                <p><strong>Phân loại:</strong> {item.category || 'other'}</p>
                <p><strong>Định nghĩa:</strong> {item.definition || 'Chưa có'}</p>
                <p><strong>Dòng thời gian:</strong> {timeline.length ? timeline.map((t) => `Ch.${t.chapter || '?'} ${t.summary || t.eventId || ''}`).join(' | ') : 'Chưa có'}</p>
              </article>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
