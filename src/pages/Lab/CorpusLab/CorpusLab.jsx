import React, { useEffect, useMemo, useState } from 'react';
import useCorpusStore from '../../../stores/corpusStore';
import AnalysisPanel from './components/AnalysisPanel';
import ChapterList from './components/ChapterList';
import ChunkOptimizer from './components/ChunkOptimizer';
import CorpusList from './components/CorpusList';
import FilePreview from './components/FilePreview';
import MetadataEditor from './components/MetadataEditor';
import UploadDropzone from './components/UploadDropzone';
import useCorpusUpload from './hooks/useCorpusUpload';
import './CorpusLab.css';

function getOrderedCorpuses(corpusOrder, corpusesMap) {
  return corpusOrder
    .map((id) => corpusesMap[id])
    .filter(Boolean);
}

function getChapterDisplayTitle(chapter) {
  if (!chapter) {
    return 'Xem chương';
  }

  const index = Number(chapter.index || 0);
  const safeIndex = Number.isFinite(index) && index > 0 ? index : '?';
  const title = String(chapter.title || '').trim();

  if (!title) {
    return `Chương ${safeIndex}`;
  }

  return `Chương ${safeIndex}: ${title}`;
}

export default function CorpusLab() {
  const [previewChapter, setPreviewChapter] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const corpuses = useCorpusStore((state) => state.corpuses);
  const corpusOrder = useCorpusStore((state) => state.corpusOrder);
  const totalCorpuses = useCorpusStore((state) => state.totalCorpuses);
  const currentCorpus = useCorpusStore((state) => state.currentCorpus);
  const currentChapter = useCorpusStore((state) => state.currentChapter);
  const listLoading = useCorpusStore((state) => state.listLoading);
  const detailLoading = useCorpusStore((state) => state.detailLoading);
  const filters = useCorpusStore((state) => state.filters);
  const chunkSize = useCorpusStore((state) => state.chunkSize);
  const listCorpuses = useCorpusStore((state) => state.listCorpuses);
  const getCorpus = useCorpusStore((state) => state.getCorpus);
  const getChapter = useCorpusStore((state) => state.getChapter);
  const deleteCorpus = useCorpusStore((state) => state.deleteCorpus);
  const setFilters = useCorpusStore((state) => state.setFilters);
  const setChunkSize = useCorpusStore((state) => state.setChunkSize);
  const setCurrentCorpus = useCorpusStore((state) => state.setCurrentCorpus);
  const setCurrentChapter = useCorpusStore((state) => state.setCurrentChapter);
  const updateMetadata = useCorpusStore((state) => state.updateMetadata);

  const {
    file,
    metadata,
    uploadState,
    uploadProgress,
    uploadError,
    isUploading,
    selectFile,
    updateMetadata: updateUploadMetadata,
    submitUpload,
  } = useCorpusUpload();

  const orderedCorpuses = useMemo(
    () => getOrderedCorpuses(corpusOrder, corpuses),
    [corpusOrder, corpuses],
  );

  const selectedCorpus = currentCorpus ? corpuses[currentCorpus] : null;

  useEffect(() => {
    const timer = setTimeout(() => {
      listCorpuses(filters).catch(() => {});
    }, 250);

    return () => clearTimeout(timer);
  }, [filters.fandom, filters.search, filters.status, listCorpuses]);

  useEffect(() => {
    if (!selectedCorpus?.chapters?.length) {
      return;
    }

    if (!currentChapter) {
      setCurrentChapter(selectedCorpus.chapters[0].id);
    }
  }, [currentChapter, selectedCorpus, setCurrentChapter]);

  const handleUpload = async () => {
    const result = await submitUpload();
    await listCorpuses(filters);
    if (result?.id) {
      await getCorpus(result.id);
    }
  };

  const handleSelectCorpus = async (corpus) => {
    if (!corpus?.id) {
      return;
    }

    setCurrentCorpus(corpus.id);
    const detail = await getCorpus(corpus.id);
    if (detail?.chapters?.[0]?.id) {
      setCurrentChapter(detail.chapters[0].id);
      await getChapter(corpus.id, detail.chapters[0].id);
    }
  };

  const handleSelectChapter = async (chapter) => {
    if (!currentCorpus || !chapter?.id) {
      return;
    }

    setCurrentChapter(chapter.id);
    await getChapter(currentCorpus, chapter.id);
  };

  const handleOpenChapterPreview = async (chapter) => {
    if (!currentCorpus || !chapter?.id) {
      return;
    }

    try {
      setPreviewError(null);
      setPreviewLoading(true);

      const detail = await getChapter(currentCorpus, chapter.id);
      setPreviewChapter(detail || chapter);
    } catch (error) {
      setPreviewError(error?.message || 'Không thể tải nội dung chương.');
      setPreviewChapter(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreviewModal = () => {
    setPreviewChapter(null);
    setPreviewLoading(false);
    setPreviewError(null);
  };

  const handleDeleteCorpus = async (corpus) => {
    if (!corpus?.id) {
      return;
    }

    await deleteCorpus(corpus.id);
    await listCorpuses(filters);
  };

  const handleCorpusUpdated = async () => {
    if (!selectedCorpus?.id) {
      return;
    }

    const detail = await getCorpus(selectedCorpus.id);
    const nextChapterId = currentChapter || detail?.chapters?.[0]?.id;

    if (nextChapterId) {
      await getChapter(selectedCorpus.id, nextChapterId);
    }
  };

  return (
    <>
      <div className="corpus-lab-page">
        <section className="corpus-lab-left">
          <h2>Phòng thí nghiệm Corpus</h2>
          <p className="muted">Tải lên và tách truyện để chuẩn bị cho các phase phân tích tiếp theo.</p>

          <UploadDropzone
            onFileSelect={selectFile}
            uploadState={uploadState}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
          />

          <FilePreview file={file} corpus={selectedCorpus} />

          <MetadataEditor
            metadata={metadata}
            onChange={updateUploadMetadata}
            onSubmit={handleUpload}
            chunkSize={chunkSize}
            onChunkSizeChange={setChunkSize}
            detectedFandom={selectedCorpus?.fandomSuggestion}
            disabled={isUploading}
            canSubmit={!!file}
          />

          {selectedCorpus && (
            <div className="corpus-card metadata-actions">
              <h3>Cập nhật metadata cho corpus hiện tại</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => updateMetadata(selectedCorpus.id, metadata)}
              >
                Lưu metadata
              </button>
            </div>
          )}

          <ChapterList
            chapters={selectedCorpus?.chapters || []}
            selectedChapterId={currentChapter}
            onSelect={handleSelectChapter}
            onOpenPreview={handleOpenChapterPreview}
            loading={detailLoading}
          />
        </section>

        <section className="corpus-lab-right">
          <CorpusList
            corpuses={orderedCorpuses}
            total={totalCorpuses}
            selectedId={currentCorpus}
            loading={listLoading}
            filters={filters}
            onFilterChange={setFilters}
            onSelect={handleSelectCorpus}
            onDelete={handleDeleteCorpus}
          />

          {selectedCorpus && (
            <ChunkOptimizer
              corpus={selectedCorpus}
              onCorpusUpdated={handleCorpusUpdated}
            />
          )}

          {selectedCorpus && (
            <AnalysisPanel corpus={selectedCorpus} />
          )}
        </section>
      </div>

      {(previewChapter || previewLoading || previewError) && (
        <div className="chapter-modal-backdrop" onClick={closePreviewModal}>
          <div className="chapter-modal" onClick={(event) => event.stopPropagation()}>
            <div className="chapter-modal-header">
              <h3>{getChapterDisplayTitle(previewChapter)}</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closePreviewModal}
              >
                Đóng
              </button>
            </div>

            {previewLoading && <p className="muted">Đang tải nội dung chương...</p>}
            {previewError && <p className="corpus-error">{previewError}</p>}

            {!previewLoading && previewChapter && (
              <div className="chapter-modal-content">
                {previewChapter.content || 'Nội dung chương chưa được tải.'}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}


