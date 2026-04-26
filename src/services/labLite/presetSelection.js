export function selectPresetDeepChapterIndexes({
  mode = 'complete',
  chapters = [],
  scoutResults = [],
  arcs = [],
  chapterCoverage = [],
} = {}) {
  const existing = new Set((chapters || []).map((chapter) => Number(chapter.index || chapter.chapterIndex)));
  const selected = new Set();
  const add = (value) => {
    const chapterIndex = Math.trunc(Number(value));
    if (Number.isFinite(chapterIndex) && chapterIndex > 0 && existing.has(chapterIndex)) selected.add(chapterIndex);
  };

  (scoutResults || [])
    .filter((result) => (
      result.recommendation === 'deep_load'
      || ['critical', 'high'].includes(result.priority)
      || (mode === 'deep' && (result.detectedSignals || []).some((signal) => ['reveal', 'worldbuilding', 'relationship_shift', 'adult_sensitive', 'sensitive_or_relationship_heavy'].includes(signal)))
    ))
    .forEach((result) => add(result.chapterIndex));

  (arcs || [])
    .filter((arc) => mode === 'deep' || ['critical', 'high'].includes(arc.importance))
    .forEach((arc) => {
      (arc.recommendedDeepChapters || []).forEach(add);
      if (mode === 'deep') {
        add(arc.chapterStart);
        add(arc.chapterEnd);
      }
    });

  if (mode === 'deep') {
    (chapterCoverage || [])
      .filter((entry) => entry.status === 'error' || entry.failedReason || entry.scoutSynthetic || !entry.digestDone)
      .forEach((entry) => add(entry.chapterIndex));
  }

  if (selected.size === 0 && chapters.length > 0) {
    add(chapters[0]?.index);
    add(chapters[Math.floor(chapters.length / 2)]?.index);
    add(chapters[chapters.length - 1]?.index);
  }

  return [...selected].sort((a, b) => a - b);
}
