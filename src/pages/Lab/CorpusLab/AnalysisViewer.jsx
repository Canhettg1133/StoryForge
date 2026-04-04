/**
 * AnalysisViewer - Main page for viewing analysis results
 * Phase 4: Analysis Results Viewer - Complete with DB integration
 */

import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useAnalysisViewer, { VIEW_MODES } from './hooks/useAnalysisViewer.js';
import ViewToggle from './components/ViewToggle.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import EventListView from './components/EventListView.jsx';
import IncidentClusterView from './components/IncidentClusterView.jsx';
import MindMapView from './components/MindMapView.jsx';
import TimelineView from './components/TimelineView.jsx';
import CharacterGraph from './components/CharacterGraph.jsx';
import CompareMode from './components/CompareMode.jsx';
import SelectionPanel from './components/SelectionPanel.jsx';
import AnnotationEditor from './components/AnnotationEditor.jsx';
import EventEditModal from './components/EventEditModal.jsx';
import ExportModal from './components/ExportModal.jsx';
import LinkToProjectModal from './components/LinkToProjectModal.jsx';
import AdaptationPanel from './components/AdaptationPanel.jsx';
import './AnalysisViewer.css';
import './AnalysisViewer.components.css';

export default function AnalysisViewer({ corpusId: propCorpusId, analysisId: propAnalysisId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const corpusId = propCorpusId || location.state?.corpusId;
  const analysisId = propAnalysisId || location.state?.analysisId;

  const {
    // Data
    corpus,
    analysis,
    parsed,
    displayEvents,
    incidentClusters,
    selectedItems,
    characterGraph,
    timelineData,
    stats,
    qualityStats,
    autoAcceptThreshold,
    confidenceThreshold,
    mindMapData,

    // Metadata
    allTags,
    allLocations,
    allCharacters,
    allShips,
    quickSelectCounts,

    // UI State
    view,
    setView,
    filters,
    setFilters,
    searchQuery,
    setSearchQuery,
    selectedIds,
    compareCorpusId,
    setCompareCorpusId,
    editingEvent,
    annotatingEvent,
    exportModalOpen,
    linkModalEvent,
    setLinkModalEvent,
    adaptPanelOpen,
    setAdaptPanelOpen,
    savingAnnotation,

    // Database state
    savedSearches,
    searchHistory,
    dbLoading,
    dbError,

    // Actions
    toggleSelection,
    selectAll,
    clearSelection,
    quickSelect,
    resetFilters,
    updateFilter,
    handleEditEvent,
    handleSaveEvent,
    handleAddAnnotation,
    handleSaveAnnotation,
    handleToggleStar,
    handleExport,
    setExportModalOpen,
    setEditingEvent,
    setAnnotatingEvent,
    handleSaveCurrentSearch,
    handleDeleteSavedSearch,
    handleLoadSavedSearch,
    handleClearHistory,
    handleLinkToProject,
    handleUnlinkFromProject,

    // Counts
    displayCount,
    totalCount,
    selectedCount,
    searchResultCount,
  } = useAnalysisViewer({ corpusId, analysisId });

  if (!corpusId) {
    return (
      <div className="analysis-viewer-empty">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h2>Trình xem kết quả phân tích</h2>
          <p>Chọn một corpus từ Kho Corpus để xem kết quả phân tích.</p>
        </div>
      </div>
    );
  }

  if (!analysis && !parsed) {
    return (
      <div className="analysis-viewer-empty">
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h2>Chưa có kết quả phân tích</h2>
          <p>
            {corpus
              ? `Không tìm thấy kết quả phân tích cho "${corpus.title}". Hãy chạy phân tích trước trong Kho Corpus.`
              : 'Chọn một corpus để xem kết quả phân tích.'}
          </p>
        </div>
      </div>
    );
  }

  const showSearchBadge = searchResultCount !== null;

  return (
    <div className="analysis-viewer">
      <header className="analysis-viewer-header">
        <div className="analysis-viewer-title">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/project/${projectId}/corpus-lab`)}
          >
            ← Kho Corpus
          </button>
          <h2>{corpus?.title || 'Kết quả phân tích'}</h2>
          {stats && (
            <div className="analysis-stats-summary">
              <span>{stats.total} sự kiện</span>
              <span className="separator">·</span>
              <span className="canon-count">{stats.canonCount} chính sử</span>
              <span className="separator">·</span>
              <span className="fanon-count">{stats.fanonCount} phi chính sử</span>
              <span className="separator">·</span>
              <span className="accepted-count">{stats.autoAcceptedCount ?? qualityStats?.autoAccepted ?? 0} tự động</span>
              <span className="separator">·</span>
              <span className="needs-review-count">{stats.needsReviewCount ?? qualityStats?.needsReview ?? 0} cần duyệt</span>
              <span className="separator">·</span>
              <span>{stats.locationLinkedCount ?? 0} đã gắn địa điểm</span>
              <span className="separator">·</span>
              <span>{incidentClusters.length} cụm sự kiện lớn</span>
              <span className="separator">·</span>
              <span>Cường độ TB: {stats.avgIntensity}/10</span>
            </div>
          )}
          {dbLoading && <span className="db-loading-indicator">Đang tải...</span>}
          {dbError && (
            <span className="db-error-indicator" title={dbError}>
              Lỗi CSDL: {dbError.substring(0, 30)}...
            </span>
          )}
          {qualityStats?.missingChapterRate >= 0.6 && (
            <span className="db-error-indicator" title="Thiếu chương trong output AI">
              Cảnh báo: Nhiều sự kiện thiếu chương ({qualityStats.missingChapter}/{qualityStats.total})
            </span>
          )}
          {qualityStats?.needsReview > 0 && (
            <span
              className="db-error-indicator"
              title={`Nguong auto-accept: quality >= ${autoAcceptThreshold}, chapterConfidence >= ${confidenceThreshold}`}
            >
              Cần duyệt: {qualityStats.needsReview}/{qualityStats.total}
            </span>
          )}
        </div>

        <div className="analysis-viewer-controls">
          <ViewToggle view={view} onChange={setView} modes={VIEW_MODES} />

          {selectedCount > 0 && (
            <button
              className="btn-export-selected"
              onClick={() => handleExport('markdown')}
            >
              Xuất {selectedCount} mục đã chọn
            </button>
          )}

          {selectedCount > 0 && (
            <button
              className="btn-adapt-selected"
              onClick={() => setAdaptPanelOpen(true)}
              title="Chuyển thể AI cho các sự kiện đã chọn"
            >
              AI Chuyển thể
            </button>
          )}
        </div>
      </header>

      <div className="analysis-viewer-body">
        <aside className="analysis-viewer-sidebar">
          <SearchPanel
            query={searchQuery}
            onSearch={setSearchQuery}
            resultsCount={showSearchBadge ? searchResultCount : null}
            totalCount={totalCount}
            savedSearches={savedSearches}
            searchHistory={searchHistory}
            onSaveSearch={handleSaveCurrentSearch}
            onDeleteSavedSearch={handleDeleteSavedSearch}
            onLoadSavedSearch={handleLoadSavedSearch}
            onClearHistory={handleClearHistory}
          />

          <FilterPanel
            filters={filters}
            onChange={setFilters}
            allTags={allTags}
            allLocations={allLocations}
            allCharacters={allCharacters}
            allShips={allShips}
            onReset={resetFilters}
          />

          <SelectionPanel
            selectedItems={selectedItems}
            selectedIds={selectedIds}
            onToggle={toggleSelection}
            onSelectAll={selectAll}
            onClear={clearSelection}
            onQuickSelect={quickSelect}
            quickSelectCounts={quickSelectCounts}
            onExport={handleExport}
            onLinkToProject={(event) => setLinkModalEvent(event)}
            onAnnotate={handleAddAnnotation}
            onToggleStar={handleToggleStar}
            totalCount={displayCount}
          />
        </aside>

        <main className="analysis-viewer-content">
          <div className="view-toolbar">
            <div className="view-count">
              {showSearchBadge ? (
                <span>
                  Có <strong>{searchResultCount}</strong> kết quả cho "{searchQuery}"
                </span>
              ) : (
                <span>
                  Hiển thị <strong>{displayCount}</strong> / {totalCount} sự kiện
                </span>
              )}
            </div>

            <div className="view-actions">
              {selectedCount > 0 && (
                <button
                  className="btn-clear-selection"
                  onClick={clearSelection}
                >
                  Bỏ chọn ({selectedCount})
                </button>
              )}
            </div>
          </div>

          <div className={`view-content view-${view}`}>
            {view === 'incidents' && (
              <IncidentClusterView
                incidents={incidentClusters}
                events={displayEvents}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                onEdit={handleEditEvent}
                onAnnotate={handleAddAnnotation}
              />
            )}

            {view === 'list' && (
              <EventListView
                events={displayEvents}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                onEdit={handleEditEvent}
                onAnnotate={handleAddAnnotation}
                onSelectAll={selectAll}
              />
            )}

            {view === 'mindmap' && (
              <MindMapView
                data={mindMapData}
                selectedIds={selectedIds}
                onNodeClick={(node) => {
                  if (node.data) {
                    toggleSelection(node.data.id);
                  }
                }}
                onNodeDoubleClick={(node) => {
                  if (node.data) {
                    handleEditEvent(node.data);
                  }
                }}
              />
            )}

            {view === 'timeline' && (
              <TimelineView
                data={timelineData}
                events={displayEvents}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                onEdit={handleEditEvent}
                onAnnotate={handleAddAnnotation}
              />
            )}

            {view === 'graph' && (
              <CharacterGraph
                data={characterGraph}
                events={displayEvents}
                selectedIds={selectedIds}
                onNodeClick={(node) => {
                  // Filter by character
                  updateFilter('character', node.id);
                }}
              />
            )}

            {view === 'compare' && (
              <CompareMode
                corpusId={corpusId}
                compareCorpusId={compareCorpusId}
                onSelectCorpusB={setCompareCorpusId}
              />
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      {editingEvent && (
        <EventEditModal
          event={editingEvent}
          onSave={handleSaveEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {annotatingEvent && (
        <AnnotationEditor
          event={annotatingEvent}
          onSave={handleSaveAnnotation}
          onCancel={() => setAnnotatingEvent(null)}
          saving={savingAnnotation}
        />
      )}

      {exportModalOpen && (
        <ExportModal
          selectedItems={selectedItems}
          onClose={() => setExportModalOpen(false)}
          onExport={handleExport}
        />
      )}

      {linkModalEvent && (
        <LinkToProjectModal
          event={linkModalEvent}
          corpusId={corpusId}
          onLink={handleLinkToProject}
          onUnlink={handleUnlinkFromProject}
          onClose={() => setLinkModalEvent(null)}
        />
      )}

      {adaptPanelOpen && (
        <div className="adapt-panel-backdrop" onClick={() => setAdaptPanelOpen(false)}>
          <div className="adapt-panel-container" onClick={(e) => e.stopPropagation()}>
            <AdaptationPanel
              selectedEvents={selectedItems}
              corpusFandom={corpus?.fandom || corpus?.genre}
              onClose={() => setAdaptPanelOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
