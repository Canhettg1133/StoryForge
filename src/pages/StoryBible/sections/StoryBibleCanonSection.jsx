import React from 'react';
import { BookKey, Plus, RotateCcw, X } from 'lucide-react';
import { buildCharacterStateSummary } from '../../../services/canon/state';
import { getCanonReportTitle } from '../../../services/canon/reportLabels';

const STATUS_LABELS = {
  draft: 'Bản nháp',
  validated: 'Đã kiểm',
  canonical: 'Chính thức',
  has_warnings: 'Có cảnh báo',
  blocked: 'Bị chặn',
  invalidated: 'Vô hiệu',
  superseded: 'Đã thay thế',
  active: 'Đang mở',
  resolved: 'Đã khép',
  alive: 'Còn sống',
  dead: 'Đã chết',
};

const OP_TYPE_LABELS = {
  CHARACTER_STATUS_CHANGED: 'Đổi trạng thái nhân vật',
  CHARACTER_LOCATION_CHANGED: 'Đổi vị trí nhân vật',
  CHARACTER_RESCUED: 'Nhân vật được cứu',
  CHARACTER_DIED: 'Nhân vật tử vong',
  SECRET_REVEALED: 'Bí mật bị lộ',
  GOAL_CHANGED: 'Đổi mục tiêu',
  ALLEGIANCE_CHANGED: 'Đổi phe',
  THREAD_OPENED: 'Mở tuyến truyện',
  THREAD_PROGRESS: 'Tiến triển tuyến truyện',
  THREAD_RESOLVED: 'Khép tuyến truyện',
  FACT_REGISTERED: 'Ghi nhận sự thật',
  OBJECT_ACQUIRED: 'Nhận vật phẩm',
  OBJECT_STATUS_CHANGED: 'Đổi trạng thái vật phẩm',
  OBJECT_TRANSFERRED: 'Chuyển vật phẩm',
  OBJECT_CONSUMED: 'Dùng hết vật phẩm',
  OBJECT_LOST: 'Mất vật phẩm',
  OBJECT_FOUND: 'Tìm lại vật phẩm',
  OBJECT_RESTORED: 'Khôi phục vật phẩm',
  OBJECT_PARTIALLY_CONSUMED: 'Tiêu hao một phần vật phẩm',
  OBJECT_SPENT: 'Tiêu hao vật phẩm',
  OBJECT_RETURNED: 'Trả lại vật phẩm',
  RELATIONSHIP_STATUS_CHANGED: 'Đổi trạng thái quan hệ',
  RELATIONSHIP_SECRET_CHANGED: 'Đổi mức bí mật quan hệ',
  INTIMACY_LEVEL_CHANGED: 'Đổi mức độ thân mật',
};

function translateStatus(status) {
  return STATUS_LABELS[status] || 'Chưa rõ';
}

function translateOpType(opType) {
  return OP_TYPE_LABELS[opType] || 'Sự kiện canon';
}

function buildSceneLabel(sceneId) {
  return sceneId ? `Cảnh ${sceneId}` : 'Cấp chương';
}

function translateEvidenceType(type) {
  if (type === 'story_event') return 'Sự kiện';
  if (type === 'chapter_revision') return 'Phiên bản chương';
  if (type === 'fact') return 'Sự thật';
  if (type === 'scene') return 'Cảnh';
  if (type === 'candidate_op') return 'Ứng viên thay đổi';
  return 'Bằng chứng';
}

const StoryBibleCanonSection = React.memo(function StoryBibleCanonSection({
  isOpen,
  onToggle,
  chapters,
  characterNameMap,
  canonOverview,
  canonOverviewLoading,
  selectedCanonChapterId,
  chapterRevisionHistory,
  selectedCanonRevisionId,
  selectedRevisionDetail,
  canonDetailLoading,
  selectedEvidence,
  canonEntityCards,
  loadCanonOverview,
  loadChapterRevisionInspector,
  handleRevisionChange,
  setSelectedEvidenceId,
  activeCanonFacts,
  deprecatedCanonFacts,
  canonFactDrafts,
  handleCanonFactDraftChange,
  handleAddCanonFact,
  handleArchiveCanonFact,
  handleRestoreCanonFact,
  handleDeleteCanonFactPermanent,
}) {
  const derivedCanonFacts = (canonOverview?.factStates || []).filter((fact) => (
    fact.status === 'active' && fact.derived_from_chapter
  ));
  return (
    <div className="bible-section">
      <div className="bible-section-header" onClick={() => onToggle('canon')} style={{ cursor: 'pointer' }}>
        <h3 className="bible-section-title">
          <RotateCcw size={14} style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
          <BookKey size={18} /> Sự thật Canon ({activeCanonFacts.length + derivedCanonFacts.length})
        </h3>
        <div className="bible-inline-actions">
          <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); loadCanonOverview(); }} disabled={canonOverviewLoading}>
            <RotateCcw size={14} className={canonOverviewLoading ? 'spin' : ''} /> Tải lại canon
          </button>
          <button className="btn btn-primary btn-sm" onClick={(event) => { event.stopPropagation(); handleAddCanonFact(); }}>
            <Plus size={14} /> Thêm
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="bible-cards-list">
          <div className="bible-canon-dashboard">
            <div className="bible-canon-summary">
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Chương chính thức</span><strong>{canonOverview?.stats?.canonical_count || 0}/{canonOverview?.stats?.chapter_count || chapters.length}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Bị chặn</span><strong>{canonOverview?.stats?.blocked_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Vô hiệu</span><strong>{canonOverview?.stats?.invalidated_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Sự kiện</span><strong>{canonOverview?.stats?.event_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Báo cáo</span><strong>{(canonOverview?.stats?.warning_count || 0) + (canonOverview?.stats?.error_count || 0)}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Bằng chứng</span><strong>{canonOverview?.stats?.evidence_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Sự thật</span><strong>{canonOverview?.stats?.fact_count || activeCanonFacts.length}</strong></div>
            </div>

            <div className="bible-canon-columns">
              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Trạng thái chương</strong><span>{canonOverview?.chapterCommits?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.chapterCommits || []).map((commit) => (
                    <button key={commit.id || commit.chapter_id} type="button" className={`bible-canon-list-item bible-canon-list-item--flow bible-canon-list-item--interactive bible-canon-list-item--${commit.status || 'draft'} ${selectedCanonChapterId === commit.chapter_id ? 'is-selected' : ''}`} onClick={() => loadChapterRevisionInspector(commit.chapter_id)}>
                      <div><strong>{commit.chapter_title}</strong><p>Phiên bản hiện tại: r{commit.current_revision?.revision_number || 0}</p></div>
                      <span className="bible-canon-badge">{translateStatus(commit.status || 'draft')}</span>
                    </button>
                  ))}
                  {(canonOverview?.chapterCommits || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có chương nào được chốt canon.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Trạng thái nhân vật</strong><span>{canonEntityCards.length}</span></div>
                <div className="bible-canon-list">
                  {canonEntityCards.map((state) => (
                    <div key={state.id || state.entity_id} className="bible-canon-list-item bible-canon-list-item--flow">
                      <div><strong>{state.displayName}</strong><p>{state.summaryText || 'Chưa có tóm tắt trạng thái.'}</p></div>
                      <span className={`bible-canon-badge bible-canon-badge--${state.alive_status || 'alive'}`}>{translateStatus(state.alive_status || 'alive')}</span>
                    </div>
                  ))}
                  {canonEntityCards.length === 0 && <p className="text-muted bible-canon-empty">Chưa có trạng thái nhân vật đã kết xuất.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Trạng thái tuyến truyện</strong><span>{canonOverview?.threadStates?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.threadStates || []).map((threadState) => (
                    <div key={threadState.id || threadState.thread_id} className="bible-canon-list-item bible-canon-list-item--flow">
                      <div><strong>{threadState.thread_title}</strong><p>{threadState.summary || 'Không có tóm tắt tuyến truyện.'}</p></div>
                      <span className={`bible-canon-badge bible-canon-badge--${threadState.state || 'active'}`}>{translateStatus(threadState.state || 'active')}</span>
                    </div>
                  ))}
                  {(canonOverview?.threadStates || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có tuyến truyện đã kết xuất.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Báo cáo kiểm tra</strong><span>{canonOverview?.recentReports?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.recentReports || []).map((report) => (
                    <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--flow bible-canon-list-item--${report.severity}`}>
                      <div><strong>{getCanonReportTitle(report)}</strong><p>{report.message}</p></div>
                      <span className="bible-canon-meta" title={report.chapter_title || 'Bản nháp'}>{report.chapter_title || 'Bản nháp'}</span>
                    </div>
                  ))}
                  {(canonOverview?.recentReports || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có báo cáo kiểm tra nào.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Sự kiện gần đây</strong><span>{canonOverview?.recentEvents?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.recentEvents || []).map((event) => (
                    <div key={event.id} className="bible-canon-list-item bible-canon-list-item--flow">
                      <div><strong>{translateOpType(event.op_type)}</strong><p>{event.subject_name || event.thread_title || event.fact_description || 'Sự kiện canon'}</p></div>
                      <span className="bible-canon-meta" title={event.chapter_title || 'Chương chưa rõ'}>{event.chapter_title || 'Chương chưa rõ'}</span>
                    </div>
                  ))}
                  {(canonOverview?.recentEvents || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có sự kiện truyện nào.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Bằng chứng và phiên bản</strong><span>{(canonOverview?.recentEvidence?.length || 0) + (canonOverview?.recentRevisions?.length || 0)}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.recentEvidence || []).map((item) => (
                    <div key={`evidence-${item.id}`} className="bible-canon-list-item bible-canon-list-item--flow">
                      <div><strong>{translateEvidenceType(item.target_type)}</strong><p>{item.evidence_text || item.excerpt || 'Không có nội dung bằng chứng.'}</p></div>
                      <span className="bible-canon-meta" title={item.chapter_title || 'Chương chưa rõ'}>{item.chapter_title || 'Chương chưa rõ'}</span>
                    </div>
                  ))}
                  {(canonOverview?.recentRevisions || []).map((revision) => (
                    <div key={`revision-${revision.id}`} className={`bible-canon-list-item bible-canon-list-item--flow bible-canon-list-item--${revision.status || 'draft'}`}>
                      <div><strong>{revision.chapter_title || `Chương ${revision.chapter_id}`}</strong><p>Phiên bản r{revision.revision_number || 0} - {translateStatus(revision.status || 'draft')}</p></div>
                      <span className="bible-canon-meta">Phiên bản</span>
                    </div>
                  ))}
                  {(canonOverview?.recentEvidence || []).length === 0 && (canonOverview?.recentRevisions || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có bằng chứng hoặc lịch sử phiên bản.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="bible-canon-detail">
            <div className="bible-canon-detail-header">
              <div>
                <strong>{chapterRevisionHistory?.chapter?.title || 'Trình xem phiên bản'}</strong>
                <p>{chapterRevisionHistory?.revisions?.length || 0} phiên bản{chapterRevisionHistory?.commit?.canonical_revision_id ? ' · có bản chính thức' : ''}</p>
              </div>
              <div className="bible-canon-detail-actions">
                <select className="select" value={selectedCanonRevisionId || ''} onChange={(event) => handleRevisionChange(Number(event.target.value) || null)} disabled={canonDetailLoading || !(chapterRevisionHistory?.revisions?.length > 0)}>
                  <option value="">Chọn phiên bản...</option>
                  {(chapterRevisionHistory?.revisions || []).map((revision) => (
                    <option key={revision.id} value={revision.id}>{`r${revision.revision_number || 0} - ${translateStatus(revision.status || 'draft')}`}</option>
                  ))}
                </select>
              </div>
            </div>

            {selectedRevisionDetail && (
              <>
                <div className="bible-canon-detail-meta">
                  <span className={`bible-canon-badge bible-canon-badge--${selectedRevisionDetail.revision.status || 'draft'}`}>{translateStatus(selectedRevisionDetail.revision.status || 'draft')}</span>
                  {selectedRevisionDetail.revision.is_current && <span className="bible-canon-meta">Bản hiện tại</span>}
                  {selectedRevisionDetail.revision.is_canonical && <span className="bible-canon-meta">Bản chính thức</span>}
                  <span className="bible-canon-meta">{selectedRevisionDetail.events.length} sự kiện</span>
                  <span className="bible-canon-meta">{selectedRevisionDetail.evidence.length} bằng chứng</span>
                  <span className="bible-canon-meta">{selectedRevisionDetail.reports.length} báo cáo</span>
                </div>
                <div className="bible-canon-detail-grid">
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Sự kiện trong phiên bản</strong><span>{selectedRevisionDetail.events.length}</span></div>
                    <div className="bible-canon-list">
                      {selectedRevisionDetail.events.map((event) => (
                        <div key={event.id} className="bible-canon-list-item bible-canon-list-item--flow">
                          <div><strong>{translateOpType(event.op_type)}</strong><p>{event.summary || event.subject_name || event.fact_description || 'Sự kiện canon'}</p></div>
                          <span className="bible-canon-meta">{buildSceneLabel(event.scene_id)}</span>
                        </div>
                      ))}
                      {selectedRevisionDetail.events.length === 0 && <p className="text-muted bible-canon-empty">Phiên bản này chưa có sự kiện được chốt.</p>}
                    </div>
                  </div>
                  <div className="bible-canon-panel bible-canon-panel--evidence">
                    <div className="bible-canon-panel-header"><strong>Trình xem bằng chứng</strong><span>{selectedRevisionDetail.evidence.length}</span></div>
                    <div className="bible-canon-evidence-layout">
                      <div className="bible-canon-evidence-list">
                        {selectedRevisionDetail.evidence.map((item) => (
                          <button key={item.id} type="button" className={`bible-canon-list-item bible-canon-list-item--interactive ${selectedEvidence?.id === item.id ? 'is-selected' : ''}`} onClick={() => setSelectedEvidenceId(item.id)}>
                            <div><strong>{translateEvidenceType(item.target_type)}</strong><p>{item.summary || item.evidence_text || 'Không có mô tả bằng chứng.'}</p></div>
                          </button>
                        ))}
                        {selectedRevisionDetail.evidence.length === 0 && <p className="text-muted bible-canon-empty">Phiên bản này chưa có bằng chứng.</p>}
                      </div>
                      <div className="bible-canon-evidence-preview">
                        {selectedEvidence ? (
                          <>
                            <strong>{translateEvidenceType(selectedEvidence.target_type)}</strong>
                            <p>{selectedEvidence.summary || 'Không có tóm tắt.'}</p>
                            <pre>{selectedEvidence.evidence_text || 'Không có nội dung bằng chứng.'}</pre>
                          </>
                        ) : (
                          <p className="text-muted bible-canon-empty">Chọn một bằng chứng để xem chi tiết.</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Báo cáo kiểm tra</strong><span>{selectedRevisionDetail.reports.length}</span></div>
                    <div className="bible-canon-list">
                      {selectedRevisionDetail.reports.map((report) => (
                        <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--flow bible-canon-list-item--${report.severity}`}>
                          <div><strong>{getCanonReportTitle(report)}</strong><p>{report.message}</p></div>
                          <span className="bible-canon-meta">{buildSceneLabel(report.scene_id)}</span>
                        </div>
                      ))}
                      {selectedRevisionDetail.reports.length === 0 && <p className="text-muted bible-canon-empty">Phiên bản này không có báo cáo.</p>}
                    </div>
                  </div>
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Ảnh chụp trạng thái</strong><span>{selectedRevisionDetail.snapshotData ? 'Có' : 'Không'}</span></div>
                    <div className="bible-canon-snapshot">
                      {selectedRevisionDetail.snapshotData ? (
                        <>
                          <div className="bible-canon-snapshot-stats">
                            <span>{selectedRevisionDetail.snapshotData.entityStates?.length || 0} trạng thái nhân vật</span>
                            <span>{selectedRevisionDetail.snapshotData.threadStates?.length || 0} trạng thái tuyến truyện</span>
                            <span>{selectedRevisionDetail.snapshotData.factStates?.length || 0} trạng thái sự thật</span>
                          </div>
                          <div className="bible-canon-list">
                            {(selectedRevisionDetail.snapshotData.entityStates || []).slice(0, 6).map((state) => (
                              <div key={`snap-entity-${state.entity_id}`} className="bible-canon-list-item">
                                <div><strong>{characterNameMap.get(state.entity_id) || `Nhân vật ${state.entity_id}`}</strong><p>{buildCharacterStateSummary(state)}</p></div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-muted bible-canon-empty">Phiên bản này chưa có ảnh chụp trạng thái.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            {!selectedRevisionDetail && !canonDetailLoading && <p className="text-muted bible-canon-empty">Chọn một chương đã chốt canon để xem phiên bản và bằng chứng.</p>}
          </div>

          <div className="bible-canon-panel-header">
            <strong>Sự thật nền thủ công</strong>
            <span>{activeCanonFacts.length}</span>
          </div>
          {activeCanonFacts.map((fact) => {
            const draft = canonFactDrafts[fact.id] || fact;
            return (
              <div key={fact.id} className="bible-edit-card" style={{ gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <select className="select" style={{ width: '120px' }} value={draft.fact_type} onChange={(event) => handleCanonFactDraftChange(fact.id, 'fact_type', event.target.value)}>
                    <option value="fact">Sự thật</option>
                    <option value="secret">Bí mật</option>
                    <option value="rule">Quy tắc</option>
                  </select>
                  <input className="input" style={{ flex: 1 }} value={draft.description} onChange={(event) => handleCanonFactDraftChange(fact.id, 'description', event.target.value)} placeholder="Mô tả sự thật / bí mật / quy luật..." />
                  <button className="btn btn-icon text-danger" onClick={() => handleArchiveCanonFact(fact.id)} title="Lưu trữ"><X size={16} /></button>
                </div>
              </div>
            );
          })}
          {activeCanonFacts.length === 0 && <p className="text-muted" style={{ fontSize: '13px', fontStyle: 'italic' }}>Chưa có sự thật canon nào đang hoạt động.</p>}

          <div className="bible-canon-panel-header">
            <strong>Sự thật phát sinh từ chương</strong>
            <span>{derivedCanonFacts.length}</span>
          </div>
          {derivedCanonFacts.map((fact) => (
            <div key={fact.id || fact.fact_fingerprint} className="bible-edit-card">
              <strong>{fact.description}</strong>
              <span className="bible-canon-meta">
                Chỉ đọc · {fact.source_chapter_title || `Chương ${fact.source_chapter_id}`}
              </span>
            </div>
          ))}
          {derivedCanonFacts.length === 0 && (
            <p className="text-muted" style={{ fontSize: '13px', fontStyle: 'italic' }}>
              Chưa có sự thật nào phát sinh từ chương.
            </p>
          )}

          {deprecatedCanonFacts.length > 0 && (
            <details style={{ marginTop: 'var(--space-4)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '13px' }}>Hiển thị {deprecatedCanonFacts.length} lưu trữ</summary>
              <div className="bible-cards-list" style={{ marginTop: 'var(--space-2)', opacity: 0.7 }}>
                {deprecatedCanonFacts.map((fact) => (
                  <div key={fact.id} className="bible-edit-card" style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px' }}>[{fact.fact_type}] {fact.description}</span>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleRestoreCanonFact(fact.id)}><RotateCcw size={14} /> Khôi phục</button>
                        <button className="btn btn-ghost btn-danger btn-sm" onClick={() => handleDeleteCanonFactPermanent(fact.id)}><X size={14} /> Xóa vĩnh viễn</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
});

export default StoryBibleCanonSection;
