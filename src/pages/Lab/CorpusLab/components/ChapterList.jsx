import React, { useEffect, useMemo, useState } from 'react';

const ITEM_HEIGHT = 92;
const VIEWPORT_HEIGHT = 700;
const OVERSCAN_ITEMS = 6;
const VIRTUALIZE_THRESHOLD = 80;

function formatWords(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function stripLeadingChapterPrefix(title) {
  let normalized = String(title || '').trim();

  for (let guard = 0; guard < 3; guard += 1) {
    const next = normalized
      .replace(/^(chương|chuong|chapter|chap|ch\.?)\s*/iu, '')
      .replace(/^(\d+|[ivxlcdm]+)\s*[:.)\-]?\s*/iu, '')
      .trim();

    if (next === normalized) {
      break;
    }

    normalized = next;
  }

  return normalized.trim();
}

function formatChapterTitle(chapter, fallbackIndex) {
  const title = String(chapter?.title || '').trim();
  const chapterIndex = Number(chapter?.index);
  const safeIndex = Number.isFinite(chapterIndex) && chapterIndex > 0
    ? chapterIndex
    : fallbackIndex;

  if (!title) {
    return `Chương ${safeIndex}`;
  }

  const normalized = stripLeadingChapterPrefix(title);
  if (!normalized) {
    return `Chương ${safeIndex}`;
  }

  return `Chương ${safeIndex}: ${normalized}`;
}

function ChapterButton({ chapter, isActive, onSelect, onOpenPreview, ordinal }) {
  const wordCount = Number(chapter.wordCount || chapter.word_count || 0);

  return (
    <button
      type="button"
      key={chapter.id}
      className={`corpus-chapter-item ${isActive ? 'is-active' : ''}`}
      onClick={() => onSelect?.(chapter)}
      onDoubleClick={() => onOpenPreview?.(chapter)}
      title={chapter.title || undefined}
    >
      <span className="corpus-chapter-title">
        {formatChapterTitle(chapter, ordinal)}
      </span>
      <span className="corpus-chapter-meta">{formatWords(wordCount)} từ</span>
    </button>
  );
}

export default function ChapterList({
  chapters = [],
  selectedChapterId,
  onSelect,
  onOpenPreview,
  loading,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const shouldVirtualize = chapters.length >= VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    setScrollTop(0);
  }, [chapters.length]);

  const totalHeight = chapters.length * ITEM_HEIGHT;
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        start: 0,
        end: chapters.length,
      };
    }

    const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT) + (OVERSCAN_ITEMS * 2);
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN_ITEMS);
    const end = Math.min(chapters.length, start + visibleCount);

    return { start, end };
  }, [chapters.length, scrollTop, shouldVirtualize]);

  const visibleChapters = shouldVirtualize
    ? chapters.slice(visibleRange.start, visibleRange.end)
    : chapters;

  return (
    <div className="corpus-card corpus-chapter-list">
      <div className="corpus-chapter-list-header">
        <h3>Danh sách chương</h3>
        <span>{formatWords(chapters.length)} chương</span>
      </div>

      {loading && <p className="muted">Đang tải danh sách chương...</p>}

      {!loading && chapters.length === 0 && (
        <p className="muted">Chưa có chương để hiển thị.</p>
      )}

      {!loading && chapters.length > 0 && (
        <p className="muted">Nhấn đúp vào chương để mở cửa sổ xem nội dung chương.</p>
      )}

      {!shouldVirtualize && (
        <div className="corpus-chapter-items">
          {visibleChapters.map((chapter, index) => (
            <ChapterButton
              key={chapter.id}
              chapter={chapter}
              isActive={selectedChapterId === chapter.id}
              onSelect={onSelect}
              onOpenPreview={onOpenPreview}
              ordinal={index + 1}
            />
          ))}
        </div>
      )}

      {shouldVirtualize && (
        <div
          className="corpus-chapter-items is-virtualized"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          style={{ maxHeight: `${VIEWPORT_HEIGHT}px` }}
        >
          <div
            className="corpus-chapter-items-viewport"
            style={{ height: `${totalHeight}px` }}
          >
            <div
              className="corpus-chapter-items-window"
              style={{ transform: `translateY(${visibleRange.start * ITEM_HEIGHT}px)` }}
            >
              {visibleChapters.map((chapter, index) => (
                <ChapterButton
                  key={chapter.id}
                  chapter={chapter}
                  isActive={selectedChapterId === chapter.id}
                  onSelect={onSelect}
                  onOpenPreview={onOpenPreview}
                  ordinal={visibleRange.start + index + 1}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
