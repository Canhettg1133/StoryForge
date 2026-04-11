import { randomUUID } from 'node:crypto';

const CONTRADICTION_RULES = [
  { positive: ['alive', 'living', 'survives'], negative: ['dead', 'dies', 'killed'] },
  { positive: ['married', 'wedded'], negative: ['divorced', 'break up', 'single again'] },
  { positive: ['healthy', 'recovered'], negative: ['injured', 'wounded', 'sick'] },
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasAnyKeyword(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectStateContradiction(prevEvent, nextEvent, character) {
  const prevText = normalizeText(prevEvent?.description || prevEvent?.title);
  const nextText = normalizeText(nextEvent?.description || nextEvent?.title);

  for (const rule of CONTRADICTION_RULES) {
    const prevPositive = hasAnyKeyword(prevText, rule.positive);
    const prevNegative = hasAnyKeyword(prevText, rule.negative);
    const nextPositive = hasAnyKeyword(nextText, rule.positive);
    const nextNegative = hasAnyKeyword(nextText, rule.negative);

    if ((prevPositive && nextNegative) || (prevNegative && nextPositive)) {
      return {
        description: `Potential state contradiction for ${character}.`,
        details: {
          character,
          prevEventId: prevEvent.id,
          nextEventId: nextEvent.id,
          prevSignals: prevPositive ? 'positive' : 'negative',
          nextSignals: nextPositive ? 'positive' : 'negative',
        },
      };
    }
  }

  return null;
}

export function checkStateContradictions(events = []) {
  const grouped = new Map();
  for (const event of events || []) {
    if (!Array.isArray(event?.characters)) continue;
    for (const character of event.characters) {
      if (!grouped.has(character)) grouped.set(character, []);
      grouped.get(character).push(event);
    }
  }

  const risks = [];

  for (const [character, charEvents] of grouped.entries()) {
    const ordered = [...charEvents].sort((a, b) => (
      toNumber(a?.chapterIndex ?? a?.chapter, 0) - toNumber(b?.chapterIndex ?? b?.chapter, 0)
    ));

    for (let i = 0; i < ordered.length - 1; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const chapterA = toNumber(ordered[i]?.chapterIndex ?? ordered[i]?.chapter, null);
        const chapterB = toNumber(ordered[j]?.chapterIndex ?? ordered[j]?.chapter, null);
        if (chapterA == null || chapterB == null) continue;
        if (chapterB - chapterA > 5) break;

        const contradiction = detectStateContradiction(ordered[i], ordered[j], character);
        if (!contradiction) continue;

        risks.push({
          id: `risk_${randomUUID()}`,
          type: 'state_contradiction',
          severity: 'hard',
          description: contradiction.description,
          details: contradiction.details,
          involvedEvents: [ordered[i].id, ordered[j].id],
          involvedIncidents: [ordered[i].incidentId, ordered[j].incidentId].filter(Boolean),
          involvedLocations: [],
          evidence: [
            String(ordered[i].description || ordered[i].title || '').slice(0, 200),
            String(ordered[j].description || ordered[j].title || '').slice(0, 200),
          ].filter(Boolean),
          chapterRange: [chapterA, chapterB],
        });
      }
    }
  }

  return risks;
}
