import {
  WORD_COUNT_CACHE_VERSION,
  countSceneWords,
  getEffectiveSceneText,
  getStoredSceneWordCount,
  hasCurrentWordCountVersion,
} from './sceneWordCounts.js';

function defaultWaitForIdle() {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return new Promise((resolve) => {
      window.requestIdleCallback(resolve, { timeout: 250 });
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}

export async function reconcileProjectWordCounts({
  db,
  projectId,
  chapters = [],
  scenes = [],
  batchSize = 25,
  waitForIdle = defaultWaitForIdle,
  isCancelled = () => false,
}) {
  const normalizedProjectId = Number(projectId);
  const snapshots = scenes
    .filter((scene) => Number(scene?.project_id) === normalizedProjectId)
    .map((scene) => ({
      id: scene.id,
      chapterId: scene.chapter_id,
      text: getEffectiveSceneText(scene),
      cacheVerified: hasCurrentWordCountVersion(scene),
      wordCount: hasCurrentWordCountVersion(scene)
        ? getStoredSceneWordCount(scene)
        : null,
    }));
  const totals = new Map(
    chapters
      .filter((chapter) => Number(chapter?.project_id) === normalizedProjectId)
      .map((chapter) => [chapter.id, 0]),
  );
  const dirtyChapterIds = new Set();

  for (let offset = 0; offset < snapshots.length; offset += batchSize) {
    if (isCancelled()) {
      return { cancelled: true, chapterWordCounts: new Map(), dirtyChapterIds };
    }
    await waitForIdle();
    if (isCancelled()) {
      return { cancelled: true, chapterWordCounts: new Map(), dirtyChapterIds };
    }

    const batch = snapshots.slice(offset, offset + batchSize).map((snapshot) => ({
      ...snapshot,
      wordCount: snapshot.cacheVerified
        ? snapshot.wordCount
        : countSceneWords({ draft_text: snapshot.text }),
    }));
    await db.transaction('rw', db.scenes, async () => {
      for (const snapshot of batch) {
        const current = await db.scenes.get(snapshot.id);
        if (
          !current
          || Number(current.project_id) !== normalizedProjectId
          || current.chapter_id !== snapshot.chapterId
          || getEffectiveSceneText(current) !== snapshot.text
        ) {
          dirtyChapterIds.add(snapshot.chapterId);
          if (current?.chapter_id != null) dirtyChapterIds.add(current.chapter_id);
          continue;
        }

        totals.set(
          snapshot.chapterId,
          (totals.get(snapshot.chapterId) || 0) + snapshot.wordCount,
        );
        if (
          Number(current.word_count) !== snapshot.wordCount
          || !hasCurrentWordCountVersion(current)
        ) {
          await db.scenes.update(snapshot.id, {
            word_count: snapshot.wordCount,
            word_count_version: WORD_COUNT_CACHE_VERSION,
          });
        }
      }
    });
  }

  if (isCancelled()) {
    return { cancelled: true, chapterWordCounts: new Map(), dirtyChapterIds };
  }

  const chapterWordCounts = new Map(
    [...totals].filter(([chapterId]) => !dirtyChapterIds.has(chapterId)),
  );
  if (chapterWordCounts.size > 0) {
    await db.transaction('rw', db.chapters, async () => {
      for (const [chapterId, actualWordCount] of chapterWordCounts) {
        const chapter = await db.chapters.get(chapterId);
        if (Number(chapter?.project_id) !== normalizedProjectId) continue;
        if (
          Number(chapter.actual_word_count) !== actualWordCount
          || !hasCurrentWordCountVersion(chapter)
        ) {
          await db.chapters.update(chapterId, {
            actual_word_count: actualWordCount,
            word_count_version: WORD_COUNT_CACHE_VERSION,
          });
        }
      }
    });
  }

  return { cancelled: false, chapterWordCounts, dirtyChapterIds };
}
