import { countWords } from '../../utils/constants';

export function isChapterReaderSceneEmpty(html = '') {
  return !String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function buildChapterReaderModel(scenes = [], chapterId = null) {
  const chapterScenes = scenes
    .filter((scene) => scene.chapter_id === chapterId)
    .slice()
    .sort((left, right) => Number(left.order_index || 0) - Number(right.order_index || 0));
  const readableScenes = chapterScenes.filter(
    (scene) => !isChapterReaderSceneEmpty(scene.draft_text || ''),
  );

  return {
    readableScenes,
    totalSceneCount: chapterScenes.length,
    wordCount: readableScenes.reduce(
      (total, scene) => total + countWords(scene.draft_text || ''),
      0,
    ),
    html: readableScenes.map((scene) => scene.draft_text || '').join('<hr>'),
  };
}
