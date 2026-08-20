export function deriveChapterProgress({
  chapterWordCount = 0,
  persistedSceneWordCount = 0,
  liveSceneWordCount = 0,
  targetWordCount = 7_000,
} = {}) {
  const parsedTarget = Number(targetWordCount);
  let target = Number.isFinite(parsedTarget) && parsedTarget > 0
    ? parsedTarget
    : 7_000;
  if (target === 3_000) target = 7_000;
  const chapterTotal = Number(chapterWordCount);
  const persistedSceneTotal = Number(persistedSceneWordCount);
  const liveSceneTotal = Number(liveSceneWordCount);
  const current = Math.max(
    0,
    (Number.isFinite(chapterTotal) ? chapterTotal : 0)
      - (Number.isFinite(persistedSceneTotal) ? persistedSceneTotal : 0)
      + (Number.isFinite(liveSceneTotal) ? liveSceneTotal : 0),
  );
  return {
    current,
    target,
    percent: Math.min(100, Math.round((current / target) * 100)),
  };
}
