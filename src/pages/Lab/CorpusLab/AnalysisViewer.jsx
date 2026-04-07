/**
 * AnalysisViewer - Main page for viewing analysis results
 * Phase 4: Analysis Results Viewer - Complete with DB integration
 */

import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useAnalysisViewer, { VIEW_MODES } from './hooks/useAnalysisViewer.js';
import ViewToggle from './components/ViewToggle.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import EventListView from './components/EventListView.jsx';
import IncidentListView from './components/IncidentListView.jsx';
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
import ReviewQueueView from './components/ReviewQueueView.jsx';
import KnowledgeView from './components/KnowledgeView.jsx';
import StoryGraphView from './components/StoryGraphView.jsx';
import ArtifactDebugView from './components/ArtifactDebugView.jsx';
import './AnalysisViewer.css';
import './AnalysisViewer.components.css';

function getViewCountSummary({
  view,
  incidents = [],
  reviewQueue = [],
  storyGraph = null,
  displayEvents = [],
  totalEvents = 0,
  searchResultCount = null,
  analysisWindows = [],
}) {
  switch (view) {
    case 'incidents':
      return {
        label: 'sự kiện lớn',
        shown: incidents.length,
        total: incidents.length,
      };
    case 'review':
      return {
        label: 'mục review',
        shown: reviewQueue.length,
        total: reviewQueue.length,
      };
    case 'graph':
      return {
        label: 'nút đồ thị',
        shown: Array.isArray(storyGraph?.nodes) ? storyGraph.nodes.length : 0,
        total: Array.isArray(storyGraph?.nodes) ? storyGraph.nodes.length : 0,
      };
    case 'knowledge':
      return {
        label: 'cửa sổ phân tích',
        shown: analysisWindows.length,
        total: analysisWindows.length,
      };
    default:
      return {
        label: 'sự kiện',
        shown: searchResultCount !== null ? searchResultCount : displayEvents.length,
        total: totalEvents,
      };
  }
}

export default function AnalysisViewer({ corpusId: propCorpusId, analysisId: propAnalysisId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const corpusId = propCorpusId || location.state?.corpusId;
  const analysisId = propAnalysisId || location.state?.analysisId;
  const [reviewFilter, setReviewFilter] = useState('all');
  const [utilityPanel, setUtilityPanel] = useState('filters');
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [showRunSummary, setShowRunSummary] = useState(false);

  const {
    // Data
    corpus,
    analysis,
    parsed,
    allEvents,
    displayEvents,
    incidents,
    incidentClusters,
    reviewQueue,
    reviewQueueStats,
    storyGraph,
    artifactData,
    analysisWindows,
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
    handleResolveReview,
    handleUpdateIncident,
    handleRerunScope,

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
  const viewCountSummary = getViewCountSummary({
    view,
    incidents,
    reviewQueue,
    storyGraph,
    displayEvents,
    totalEvents: totalCount,
    searchResultCount,
    analysisWindows,
  });
  const isEventCentricView = ['list', 'timeline', 'mindmap', 'compare'].includes(view);

  const toggleUtilityPanel = (panelKey) => {
    if (utilityOpen && utilityPanel === panelKey) {
      setUtilityOpen(false);
      return;
    }
    setUtilityPanel(panelKey);
    setUtilityOpen(true);
  };

  const summaryChips = [
    { label: 'Sự kiện lớn', value: artifactData?.incidents?.length || incidents.length },
    { label: 'Nhịp', value: artifactData?.incidentBeats?.length || allEvents.length },
    { label: 'Cửa sổ', value: analysisWindows.length },
    { label: 'Cần duyệt', value: reviewQueue.length, tone: 'warn' },
    { label: 'Tự động', value: qualityStats?.autoAccepted ?? 0, tone: 'ok' },
  ];

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
          <div className="analysis-heading-row">
            <h2>{corpus?.title || 'Kết quả phân tích'}</h2>
            {analysis?.result?.meta?.runMode && (
              <span className="mode-badge">Chế độ: {analysis.result.meta.runMode}</span>
            )}
            {analysis?.artifactVersion && (
              <span className="mode-badge">Bản dựng {analysis.artifactVersion}</span>
            )}
          </div>
          <div className="analysis-summary-strip">
            {summaryChips.map((chip) => (
              <span key={chip.label} className={`analysis-summary-chip ${chip.tone || ''}`}>
                <strong>{chip.value}</strong> {chip.label}
              </span>
            ))}
          </div>
          {showRunSummary && stats && (
            <div className="analysis-stats-summary detail">
              <span>{stats.total} sự kiện</span>
              <span className="separator">·</span>
              <span className="canon-count">{stats.canonCount} chính sử</span>
              <span className="separator">·</span>
              <span className="fanon-count">{stats.fanonCount} phi chính sử</span>
              <span className="separator">·</span>
              <span>{stats.locationLinkedCount ?? 0} đã gắn địa điểm</span>
              <span className="separator">·</span>
              <span>P0: {reviewQueueStats?.P0 || 0}</span>
              <span className="separator">·</span>
              <span>P1: {reviewQueueStats?.P1 || 0}</span>
              <span className="separator">·</span>
              <span>P2: {reviewQueueStats?.P2 || 0}</span>
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
              title={`Ngưỡng tự duyệt: quality >= ${autoAcceptThreshold}, chapterConfidence >= ${confidenceThreshold}`}
            >
              Cần duyệt: {qualityStats.needsReview}/{qualityStats.total}
            </span>
          )}
        </div>

        <div className="analysis-viewer-controls">
          <button
            type="button"
            className="analysis-header-btn"
            onClick={() => setShowRunSummary((current) => !current)}
          >
            {showRunSummary ? 'Thu gọn tóm tắt' : 'Mở rộng tóm tắt'}
          </button>
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

      <div className={`analysis-viewer-body ${utilityOpen ? 'with-utility' : 'without-utility'}`}>
        <main className="analysis-viewer-content">
          <div className="view-toolbar">
            <div className="view-toolbar-main">
              <ViewToggle view={view} onChange={setView} modes={VIEW_MODES} />
            </div>

            <div className="view-toolbar-actions">
              <button
                type="button"
                className={`analysis-toolbar-btn ${utilityOpen && utilityPanel === 'search' ? 'active' : ''}`}
                onClick={() => toggleUtilityPanel('search')}
              >
                Tìm kiếm
              </button>
              <button
                type="button"
                className={`analysis-toolbar-btn ${utilityOpen && utilityPanel === 'filters' ? 'active' : ''}`}
                onClick={() => toggleUtilityPanel('filters')}
              >
                Bộ lọc
              </button>
              <button
                type="button"
                className={`analysis-toolbar-btn ${utilityOpen && utilityPanel === 'selection' ? 'active' : ''}`}
                onClick={() => toggleUtilityPanel('selection')}
              >
                Đã chọn {selectedCount > 0 ? `(${selectedCount})` : ''}
              </button>
            </div>
          </div>

          <div className="view-toolbar-subrow">
            <div className="view-count">
              {showSearchBadge ? (
                <span>
                  {isEventCentricView ? (
                    <>
                      Có <strong>{searchResultCount}</strong> kết quả cho "{searchQuery}"
                    </>
                  ) : (
                    <>
                      Đang tìm trong sự kiện nội bộ, màn này hiển thị <strong>{viewCountSummary.shown}</strong> {viewCountSummary.label}
                    </>
                  )}
                </span>
              ) : (
                <span>
                  Hiển thị <strong>{viewCountSummary.shown}</strong> / {viewCountSummary.total} {viewCountSummary.label}
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
              <IncidentListView
                incidents={incidents}
                events={displayEvents}
                onIncidentClick={null}
                onUpdateIncident={handleUpdateIncident}
                onRerunIncident={(incident) => handleRerunScope({
                  phase: 'incident',
                  incidentIds: [incident.id],
                  reason: `Chạy lại thủ công từ card incident: ${incident.title || incident.id}`,
                })}
              />
            )}

            {view === 'knowledge' && (
              <KnowledgeView
                parsed={parsed}
                events={allEvents}
                passStatus={analysis?.passStatus || analysis?.result?.pass_status}
                degradedReport={analysis?.degradedReport || analysis?.result?.degraded_run_report}
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
                incidents={incidents}
                selectedIds={selectedIds}
                onToggle={toggleSelection}
                onEdit={handleEditEvent}
                onAnnotate={handleAddAnnotation}
              />
            )}

            {view === 'graph' && (
              storyGraph?.nodes?.length ? (
                <StoryGraphView graph={storyGraph} />
              ) : (
                <CharacterGraph
                  data={characterGraph}
                  events={displayEvents}
                  selectedIds={selectedIds}
                  onNodeClick={(node) => {
                    updateFilter('character', node.id);
                  }}
                />
              )
            )}

            {view === 'compare' && (
              <CompareMode
                corpusId={corpusId}
                compareCorpusId={compareCorpusId}
                onSelectCorpusB={setCompareCorpusId}
              />
            )}

            {view === 'review' && (
              <ReviewQueueView
                items={reviewQueue}
                filter={reviewFilter}
                onFilterChange={setReviewFilter}
                onResolve={handleResolveReview}
                onRerun={handleRerunScope}
              />
            )}

            {view === 'debug' && (
              <ArtifactDebugView
                artifact={artifactData}
                windows={analysisWindows}
              />
            )}
          </div>
        </main>
      </div>

      {utilityOpen && (
        <aside className="analysis-utility-panel">
          <div className="analysis-utility-header">
            <strong>
              {utilityPanel === 'search'
                ? 'Tìm kiếm'
                : utilityPanel === 'selection'
                  ? 'Mục đã chọn'
                  : 'Bộ lọc'}
            </strong>
            <button
              type="button"
              className="analysis-utility-close"
              onClick={() => setUtilityOpen(false)}
              aria-label="Đóng panel tiện ích"
            >
              ×
            </button>
          </div>

          <div className="analysis-utility-tabs">
            <button
              type="button"
              className={utilityPanel === 'search' ? 'active' : ''}
              onClick={() => setUtilityPanel('search')}
            >
              Tìm kiếm
            </button>
            <button
              type="button"
              className={utilityPanel === 'filters' ? 'active' : ''}
              onClick={() => setUtilityPanel('filters')}
            >
              Bộ lọc
            </button>
            <button
              type="button"
              className={utilityPanel === 'selection' ? 'active' : ''}
              onClick={() => setUtilityPanel('selection')}
            >
              Đã chọn
            </button>
          </div>

          <div className="analysis-utility-content">
            {utilityPanel === 'search' && (
              <SearchPanel
                query={searchQuery}
                onSearch={setSearchQuery}
                resultsCount={showSearchBadge && isEventCentricView ? searchResultCount : null}
                totalCount={isEventCentricView ? totalCount : incidents.length}
                savedSearches={savedSearches}
                searchHistory={searchHistory}
                onSaveSearch={handleSaveCurrentSearch}
                onDeleteSavedSearch={handleDeleteSavedSearch}
                onLoadSavedSearch={handleLoadSavedSearch}
                onClearHistory={handleClearHistory}
              />
            )}

            {utilityPanel === 'filters' && (
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                allTags={allTags}
                allLocations={allLocations}
                allCharacters={allCharacters}
                allShips={allShips}
                onReset={resetFilters}
              />
            )}

            {utilityPanel === 'selection' && (
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
            )}
          </div>
        </aside>
      )}

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
