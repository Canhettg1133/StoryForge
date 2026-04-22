import React from 'react';
import { BookKey, Plus, RotateCcw, X } from 'lucide-react';
import { buildCharacterStateSummary } from '../../../services/canon/state';

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
  return (
    <div className="bible-section">
      <div className="bible-section-header" onClick={() => onToggle('canon')} style={{ cursor: 'pointer' }}>
        <h3 className="bible-section-title">
          <RotateCcw size={14} style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: '0.2s' }} />
          <BookKey size={18} /> Sự thật Canon ({activeCanonFacts.length})
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
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Chapter canonical</span><strong>{canonOverview?.stats?.canonical_count || 0}/{canonOverview?.stats?.chapter_count || chapters.length}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Blocked</span><strong>{canonOverview?.stats?.blocked_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Invalidated</span><strong>{canonOverview?.stats?.invalidated_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Events</span><strong>{canonOverview?.stats?.event_count || 0}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Reports</span><strong>{(canonOverview?.stats?.warning_count || 0) + (canonOverview?.stats?.error_count || 0)}</strong></div>
              <div className="bible-canon-stat"><span className="bible-canon-stat-label">Evidence</span><strong>{canonOverview?.stats?.evidence_count || 0}</strong></div>
            </div>

            <div className="bible-canon-columns">
              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Chapter status</strong><span>{canonOverview?.chapterCommits?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.chapterCommits || []).map((commit) => (
                    <button key={commit.id || commit.chapter_id} type="button" className={`bible-canon-list-item bible-canon-list-item--interactive bible-canon-list-item--${commit.status || 'draft'} ${selectedCanonChapterId === commit.chapter_id ? 'is-selected' : ''}`} onClick={() => loadChapterRevisionInspector(commit.chapter_id)}>
                      <div><strong>{commit.chapter_title}</strong><p>revision hiện tại: r{commit.current_revision?.revision_number || 0}</p></div>
                      <span className="bible-canon-badge">{commit.status || 'draft'}</span>
                    </button>
                  ))}
                  {(canonOverview?.chapterCommits || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có chapter nào được canonize.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Entity state</strong><span>{canonEntityCards.length}</span></div>
                <div className="bible-canon-list">
                  {canonEntityCards.map((state) => (
                    <div key={state.id || state.entity_id} className="bible-canon-list-item">
                      <div><strong>{state.displayName}</strong><p>{state.summaryText || 'Chưa có state tóm tắt.'}</p></div>
                      <span className={`bible-canon-badge bible-canon-badge--${state.alive_status || 'alive'}`}>{state.alive_status || 'alive'}</span>
                    </div>
                  ))}
                  {canonEntityCards.length === 0 && <p className="text-muted bible-canon-empty">Chưa có entity state projection.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Plot thread state</strong><span>{canonOverview?.threadStates?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.threadStates || []).map((threadState) => (
                    <div key={threadState.id || threadState.thread_id} className="bible-canon-list-item">
                      <div><strong>{threadState.thread_title}</strong><p>{threadState.summary || 'Không có tóm tắt thread.'}</p></div>
                      <span className={`bible-canon-badge bible-canon-badge--${threadState.state || 'active'}`}>{threadState.state || 'active'}</span>
                    </div>
                  ))}
                  {(canonOverview?.threadStates || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có plot thread projection.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Validator reports</strong><span>{canonOverview?.recentReports?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.recentReports || []).map((report) => (
                    <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--${report.severity}`}>
                      <div><strong>{report.rule_code || report.severity}</strong><p>{report.message}</p></div>
                      <span className="bible-canon-meta">{report.chapter_title || 'Draft'}</span>
                    </div>
                  ))}
                  {(canonOverview?.recentReports || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có báo cáo kiểm tra nào.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Recent events</strong><span>{canonOverview?.recentEvents?.length || 0}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.recentEvents || []).map((event) => (
                    <div key={event.id} className="bible-canon-list-item">
                      <div><strong>{event.op_type}</strong><p>{event.subject_name || event.thread_title || event.fact_description || 'Canon event'}</p></div>
                      <span className="bible-canon-meta">{event.chapter_title || 'Chapter không rõ'}</span>
                    </div>
                  ))}
                  {(canonOverview?.recentEvents || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có story event nào.</p>}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header"><strong>Evidence và revisions</strong><span>{(canonOverview?.recentEvidence?.length || 0) + (canonOverview?.recentRevisions?.length || 0)}</span></div>
                <div className="bible-canon-list">
                  {(canonOverview?.recentEvidence || []).map((item) => (
                    <div key={`evidence-${item.id}`} className="bible-canon-list-item">
                      <div><strong>{item.target_type || 'evidence'}</strong><p>{item.evidence_text || item.excerpt || 'Không có evidence text.'}</p></div>
                      <span className="bible-canon-meta">{item.chapter_title || 'Chapter không rõ'}</span>
                    </div>
                  ))}
                  {(canonOverview?.recentRevisions || []).map((revision) => (
                    <div key={`revision-${revision.id}`} className={`bible-canon-list-item bible-canon-list-item--${revision.status || 'draft'}`}>
                      <div><strong>{revision.chapter_title || `Chapter ${revision.chapter_id}`}</strong><p>Revision r{revision.revision_number || 0} - {revision.status || 'draft'}</p></div>
                      <span className="bible-canon-meta">rev</span>
                    </div>
                  ))}
                  {(canonOverview?.recentEvidence || []).length === 0 && (canonOverview?.recentRevisions || []).length === 0 && <p className="text-muted bible-canon-empty">Chưa có evidence hoặc revision log.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="bible-canon-detail">
            <div className="bible-canon-detail-header">
              <div>
                <strong>{chapterRevisionHistory?.chapter?.title || 'Revision Inspector'}</strong>
                <p>{chapterRevisionHistory?.revisions?.length || 0} revision{chapterRevisionHistory?.commit?.canonical_revision_id ? ' · có bản canonical' : ''}</p>
              </div>
              <div className="bible-canon-detail-actions">
                <select className="select" value={selectedCanonRevisionId || ''} onChange={(event) => handleRevisionChange(Number(event.target.value) || null)} disabled={canonDetailLoading || !(chapterRevisionHistory?.revisions?.length > 0)}>
                  <option value="">Chọn revision...</option>
                  {(chapterRevisionHistory?.revisions || []).map((revision) => (
                    <option key={revision.id} value={revision.id}>{`r${revision.revision_number || 0} - ${revision.status || 'draft'}`}</option>
                  ))}
                </select>
              </div>
            </div>

            {selectedRevisionDetail && (
              <>
                <div className="bible-canon-detail-meta">
                  <span className={`bible-canon-badge bible-canon-badge--${selectedRevisionDetail.revision.status || 'draft'}`}>{selectedRevisionDetail.revision.status || 'draft'}</span>
                  {selectedRevisionDetail.revision.is_current && <span className="bible-canon-meta">current</span>}
                  {selectedRevisionDetail.revision.is_canonical && <span className="bible-canon-meta">canonical</span>}
                  <span className="bible-canon-meta">{selectedRevisionDetail.events.length} events</span>
                  <span className="bible-canon-meta">{selectedRevisionDetail.evidence.length} evidence</span>
                  <span className="bible-canon-meta">{selectedRevisionDetail.reports.length} reports</span>
                </div>
                <div className="bible-canon-detail-grid">
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Events trong revision</strong><span>{selectedRevisionDetail.events.length}</span></div>
                    <div className="bible-canon-list">
                      {selectedRevisionDetail.events.map((event) => (
                        <div key={event.id} className="bible-canon-list-item">
                          <div><strong>{event.op_type}</strong><p>{event.summary || event.subject_name || event.fact_description || 'Canon event'}</p></div>
                          <span className="bible-canon-meta">{event.scene_id ? `scene ${event.scene_id}` : 'chapter'}</span>
                        </div>
                      ))}
                      {selectedRevisionDetail.events.length === 0 && <p className="text-muted bible-canon-empty">Revision này chưa có event commit.</p>}
                    </div>
                  </div>
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Evidence viewer</strong><span>{selectedRevisionDetail.evidence.length}</span></div>
                    <div className="bible-canon-evidence-layout">
                      <div className="bible-canon-evidence-list">
                        {selectedRevisionDetail.evidence.map((item) => (
                          <button key={item.id} type="button" className={`bible-canon-list-item bible-canon-list-item--interactive ${selectedEvidence?.id === item.id ? 'is-selected' : ''}`} onClick={() => setSelectedEvidenceId(item.id)}>
                            <div><strong>{item.target_type || 'evidence'}</strong><p>{item.summary || item.evidence_text || 'Không có mô tả evidence.'}</p></div>
                          </button>
                        ))}
                        {selectedRevisionDetail.evidence.length === 0 && <p className="text-muted bible-canon-empty">Revision này chưa có evidence.</p>}
                      </div>
                      <div className="bible-canon-evidence-preview">
                        {selectedEvidence ? (
                          <>
                            <strong>{selectedEvidence.target_type || 'evidence'}</strong>
                            <p>{selectedEvidence.summary || 'Không có summary.'}</p>
                            <pre>{selectedEvidence.evidence_text || 'Không có evidence text.'}</pre>
                          </>
                        ) : (
                          <p className="text-muted bible-canon-empty">Chọn một evidence để xem chi tiết.</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Validator reports</strong><span>{selectedRevisionDetail.reports.length}</span></div>
                    <div className="bible-canon-list">
                      {selectedRevisionDetail.reports.map((report) => (
                        <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--${report.severity}`}>
                          <div><strong>{report.rule_code || report.severity}</strong><p>{report.message}</p></div>
                          <span className="bible-canon-meta">{report.scene_id ? `scene ${report.scene_id}` : 'chapter'}</span>
                        </div>
                      ))}
                      {selectedRevisionDetail.reports.length === 0 && <p className="text-muted bible-canon-empty">Revision này không có report.</p>}
                    </div>
                  </div>
                  <div className="bible-canon-panel">
                    <div className="bible-canon-panel-header"><strong>Snapshot</strong><span>{selectedRevisionDetail.snapshotData ? 'available' : 'none'}</span></div>
                    <div className="bible-canon-snapshot">
                      {selectedRevisionDetail.snapshotData ? (
                        <>
                          <div className="bible-canon-snapshot-stats">
                            <span>{selectedRevisionDetail.snapshotData.entityStates?.length || 0} entity states</span>
                            <span>{selectedRevisionDetail.snapshotData.threadStates?.length || 0} thread states</span>
                            <span>{selectedRevisionDetail.snapshotData.factStates?.length || 0} fact states</span>
                          </div>
                          <div className="bible-canon-list">
                            {(selectedRevisionDetail.snapshotData.entityStates || []).slice(0, 6).map((state) => (
                              <div key={`snap-entity-${state.entity_id}`} className="bible-canon-list-item">
                                <div><strong>{characterNameMap.get(state.entity_id) || `Character ${state.entity_id}`}</strong><p>{buildCharacterStateSummary(state)}</p></div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-muted bible-canon-empty">Revision này chưa có snapshot.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            {!selectedRevisionDetail && !canonDetailLoading && <p className="text-muted bible-canon-empty">Chọn một chapter canonical để xem revision và evidence.</p>}
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
