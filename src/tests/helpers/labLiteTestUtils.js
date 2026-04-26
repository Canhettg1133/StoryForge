import 'fake-indexeddb/auto';
import { act } from 'react';

export const VIETNAMESE_CJK_TEXT = [
  'Chương một mở ra trong thành cổ, nơi Linh nghe tiếng chuông rất khẽ.',
  'Cô gặp Minh và ghi lại lời hứa không được phá vỡ trước bình minh.',
  '她在旧城门前停下，发现灵力正在改变。',
].join('\n');

export function makeLongVietnameseText(repeat = 80) {
  return Array.from({ length: repeat }, (_item, index) => (
    `Đoạn ${index + 1}: Linh giữ bí mật về chiếc ấn cổ, Minh theo dấu manh mối, còn thế giới vẫn đổi luật.`
  )).join('\n\n');
}

export function makeLabLiteChapters(count = 3, overrides = {}) {
  return Array.from({ length: count }, (_item, index) => {
    const chapterIndex = index + 1;
    const content = overrides.content || [
      `Chương ${chapterIndex} bắt đầu với một biến cố nhỏ.`,
      `Linh và Minh tìm thấy manh mối số ${chapterIndex}.`,
      '她记下新的规则 để không phá canon.',
    ].join('\n');
    return {
      id: overrides.id || `chapter_${String(chapterIndex).padStart(5, '0')}`,
      corpusId: overrides.corpusId || 'corpus_test',
      index: chapterIndex,
      title: overrides.title || `Chương ${chapterIndex}: Dấu mốc ${chapterIndex}`,
      content,
      wordCount: overrides.wordCount || content.split(/\s+/u).filter(Boolean).length,
      estimatedTokens: overrides.estimatedTokens || 240 + chapterIndex,
      lineCount: overrides.lineCount,
      contentHash: overrides.contentHash,
    };
  });
}

export function makeParsedCorpus({
  id = 'corpus_test',
  title = 'Truyện thử tiếng Việt',
  chapterCount = 3,
  chapters = null,
} = {}) {
  return {
    id,
    title,
    sourceFileName: `${id}.txt`,
    fileType: 'txt',
    chapters: chapters || makeLabLiteChapters(chapterCount, { corpusId: id }),
    diagnostics: {
      headingCandidates: [],
      acceptedBoundaries: [],
      rejectedBoundaries: [],
    },
  };
}

export function makeLargeChapterMetas(count = 2000, corpusId = 'corpus_large') {
  return Array.from({ length: count }, (_item, index) => ({
    id: `${corpusId}_chapter_${String(index + 1).padStart(5, '0')}`,
    corpusId,
    index: index + 1,
    title: `Chương ${index + 1}`,
    wordCount: 900,
    estimatedTokens: 1200,
    lineCount: 24,
    contentHash: `hash_${index + 1}`,
  }));
}

export async function resetLabLiteDb(labLiteDb) {
  if (typeof labLiteDb.close === 'function' && labLiteDb.isOpen?.()) {
    labLiteDb.close();
  }
  await labLiteDb.delete();
  await labLiteDb.open();
}

export async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function makeFile(name, content, type = 'text/plain') {
  return new File([content], name, { type });
}
