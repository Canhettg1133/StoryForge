import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookOpen, CheckCircle2 } from 'lucide-react';
import { getChapterContent } from '../../../../services/labLite/labLiteDb.js';
import { buildChapterCoverageBadges, buildCoverageMap, chapterMatchesCoverageFilter, formatChapterDisplayTitle, formatNumber, getPriorityLabel, getRecommendationLabel } from '../labLiteUiHelpers.js';

export function ChapterPanel({ chapters, currentChapterId, scoutResults, chapterCoverage, filter, coverageFilter, onCoverageFilterChange, onSelect }) {
  const parentRef = useRef(null);
  const [search, setSearch] = useState('');
  const [jumpValue, setJumpValue] = useState('');
  const resultByIndex = useMemo(() => new Map(
    scoutResults.map((result) => [Number(result.chapterIndex), result]),
  ), [scoutResults]);
  const coverageByIndex = useMemo(() => buildCoverageMap(chapterCoverage), [chapterCoverage]);

  const visibleChapters = useMemo(() => chapters.filter((chapter) => {
    const result = resultByIndex.get(Number(chapter.index));
    const coverage = coverageByIndex.get(Number(chapter.index));
    const normalizedSearch = search.trim().toLowerCase();
    const matchesSearch = !normalizedSearch
      || String(chapter.title || '').toLowerCase().includes(normalizedSearch)
      || String(chapter.index || '').includes(normalizedSearch);
    const matchesScout = filter === 'all'
      ? true
      : Boolean(result && resultMatchesFilter(result, filter));
    return matchesSearch && matchesScout && chapterMatchesCoverageFilter(chapter, coverage, coverageFilter);
  }), [chapters, filter, coverageFilter, search, resultByIndex, coverageByIndex]);
  const rowVirtualizer = useVirtualizer({
    count: visibleChapters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });

  return (
    <section className="lab-lite-card lab-lite-chapters">
      <div className="lab-lite-section-header">
        <div>
          <h3>Danh sách chương</h3>
          <p>{formatNumber(visibleChapters.length)} / {formatNumber(chapters.length)} chương đang hiện</p>
        </div>
      </div>
      <div className="lab-lite-chapter-tools">
        <label>
          Tìm chương
          <input value={search} placeholder="Tên hoặc số chương" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          Nhảy tới
          <input
            inputMode="numeric"
            value={jumpValue}
            placeholder="VD: 120"
            onChange={(event) => setJumpValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const chapter = chapters.find((item) => Number(item.index) === Number(jumpValue));
              if (chapter) onSelect(chapter.id);
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const chapter = chapters.find((item) => Number(item.index) === Number(jumpValue));
            if (chapter) onSelect(chapter.id);
          }}
        >
          Tới
        </button>
      </div>
      <div className="lab-lite-coverage-filter-row" aria-label="Lọc theo độ phủ chương">
        {[
          ['all', 'Tất cả'],
          ['missing_scout', 'Thiếu Scout'],
          ['missing_digest', 'Thiếu digest'],
          ['missing_deep', 'Thiếu deep'],
          ['fallback', 'Fallback'],
          ['error', 'Lỗi'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`btn btn-secondary btn-sm ${coverageFilter === value ? 'is-active' : ''}`}
            onClick={() => onCoverageFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={parentRef} className="lab-lite-chapter-list lab-lite-virtual-list">
        <div
          className="lab-lite-virtual-spacer"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const chapter = visibleChapters[virtualRow.index];
            const result = resultByIndex.get(Number(chapter.index));
            const coverage = coverageByIndex.get(Number(chapter.index));
            const badges = buildChapterCoverageBadges(coverage);
            return (
              <div
                key={chapter.id}
                className="lab-lite-virtual-row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
              >
            <button
              type="button"
              className={`lab-lite-chapter-item ${chapter.id === currentChapterId ? 'is-active' : ''}`}
              onClick={() => onSelect(chapter.id)}
            >
              <span className="lab-lite-chapter-title">{formatChapterDisplayTitle(chapter)}</span>
              <span className="lab-lite-chapter-meta">
                {formatNumber(chapter.wordCount)} từ - {formatNumber(chapter.estimatedTokens)} token
              </span>
              {result ? (
                <span className={`lab-lite-priority is-${result.priority}`}>
                  {getRecommendationLabel(result.recommendation)} - {getPriorityLabel(result.priority)}
                </span>
              ) : null}
              <span className="lab-lite-chapter-badges">
                {badges.slice(0, 3).map((badge) => <span key={badge.label} className={`lab-lite-coverage-badge is-${badge.tone}`}>{badge.label}</span>)}
              </span>
            </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ChapterDetail({ chapter, corpus, hasPrevious, hasNext, onPrevious, onNext, onRename, onSplit }) {
  const [title, setTitle] = useState('');
  const [splitLine, setSplitLine] = useState('');
  const [splitTitle, setSplitTitle] = useState('');
  const [content, setContent] = useState('');
  const [contentState, setContentState] = useState({ status: 'idle', error: '' });
  const [editState, setEditState] = useState({ status: 'idle', error: '' });
  const [showFullContent, setShowFullContent] = useState(false);

  useEffect(() => {
    setTitle(chapter?.title || '');
    setSplitLine('');
    setSplitTitle('');
    setShowFullContent(false);
    setEditState({ status: 'idle', error: '' });
  }, [chapter?.id, chapter?.title]);

  useEffect(() => {
    let canceled = false;
    setContent('');
    if (!chapter?.id) {
      setContentState({ status: 'idle', error: '' });
      return () => {
        canceled = true;
      };
    }
    setContentState({ status: 'loading', error: '' });
    getChapterContent(chapter.id)
      .then((text) => {
        if (canceled) return;
        setContent(text);
        setContentState({ status: 'complete', error: '' });
      })
      .catch((error) => {
        if (canceled) return;
        setContentState({ status: 'error', error: error?.message || 'Không tải được nội dung chương.' });
      });
    return () => {
      canceled = true;
    };
  }, [chapter?.id]);

  if (!chapter) {
    return (
      <section className="lab-lite-card lab-lite-preview">
        <p className="lab-lite-muted">Chọn hoặc nạp bộ dữ liệu để xem trước chương.</p>
      </section>
    );
  }

  const lineCount = Number(chapter.lineCount || 0) || (content ? content.split(/\n/u).length : 0);
  const previewLimit = 12000;
  const isContentLong = content.length > previewLimit;
  const previewContent = showFullContent || !isContentLong
    ? content
    : `${content.slice(0, previewLimit).trim()}\n\n[Đã rút gọn phần xem trước. Bấm "Hiện toàn bộ" để mở nội dung đầy đủ.]`;
  const previewWithLineNumbers = previewContent
    .split(/\n/u)
    .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
  const handleRename = async () => {
    setEditState({ status: 'saving', error: '' });
    try {
      await onRename(chapter.id, title);
      setEditState({ status: 'complete', error: '' });
    } catch (error) {
      setEditState({ status: 'error', error: error?.message || 'Không lưu được tên chương.' });
    }
  };
  const handleSplit = async () => {
    const confirmed = window.confirm(
      'Tách chương sẽ thay đổi cấu trúc dữ liệu và xóa kết quả Scout, phân tích sâu, Canon Pack, cache liên quan để tránh dùng sai index chương. Tiếp tục?',
    );
    if (!confirmed) return;
    setEditState({ status: 'saving', error: '' });
    try {
      await onSplit(chapter.id, splitLine, splitTitle);
      setEditState({ status: 'complete', error: '' });
      setSplitLine('');
      setSplitTitle('');
    } catch (error) {
      setEditState({ status: 'error', error: error?.message || 'Không tách được chương.' });
    }
  };

  return (
    <section className="lab-lite-card lab-lite-preview">
      <div className="lab-lite-section-header">
        <div>
          <h3>Xem trước chương</h3>
          <p>{formatChapterDisplayTitle(chapter)} - {corpus?.title || 'Corpus'} - {formatNumber(lineCount)} dòng</p>
        </div>
        <div className="lab-lite-actions lab-lite-actions--tight">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onPrevious} disabled={!hasPrevious}>Chương trước</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onNext} disabled={!hasNext}>Chương sau</button>
        </div>
      </div>
      <div className="lab-lite-edit-row">
        <label>
          Tên chương
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary" onClick={handleRename} disabled={editState.status === 'saving'}>
          Lưu tên
        </button>
      </div>
      <div className="lab-lite-edit-row">
        <label>
          Tách tại dòng
          <input
            inputMode="numeric"
            value={splitLine}
            placeholder="VD: 35"
            onChange={(event) => setSplitLine(event.target.value)}
          />
        </label>
        <label>
          Tên chương mới
          <input
            value={splitTitle}
            placeholder={`Chương ${chapter.index + 1}`}
            onChange={(event) => setSplitTitle(event.target.value)}
          />
        </label>
        <button type="button" className="btn btn-secondary" onClick={handleSplit} disabled={editState.status === 'saving'}>
          Tách
        </button>
      </div>
      <p className="lab-lite-muted">Nhập số dòng theo cột bên trái của phần xem trước. Tách chương sẽ buộc chạy lại phân tích cho corpus này.</p>
      {editState.status === 'complete' ? <p className="lab-lite-muted">Đã lưu thay đổi.</p> : null}
      {editState.status === 'error' ? <p className="lab-lite-error">{editState.error}</p> : null}
      {contentState.status === 'loading' ? (
        <p className="lab-lite-muted">Đang tải nội dung chương...</p>
      ) : null}
      {contentState.status === 'error' ? <p className="lab-lite-error">{contentState.error}</p> : null}
      {contentState.status === 'complete' ? (
        <>
          <pre className="lab-lite-chapter-preview-text lab-lite-chapter-preview-text--numbered">{previewWithLineNumbers}</pre>
          {isContentLong ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm lab-lite-preview-toggle"
              onClick={() => setShowFullContent((value) => !value)}
            >
              {showFullContent ? 'Thu gọn xem trước' : 'Hiện toàn bộ'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

