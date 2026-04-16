import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookKey,
  HeartHandshake,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import useProjectStore from '../../stores/projectStore';
import useCodexStore from '../../stores/codexStore';
import useCanonStore from '../../stores/canonStore';
import CanonRepairDialog from '../../components/canon/CanonRepairDialog';
import MobileBibleTabs from '../../components/mobile/MobileBibleTabs';
import {
  buildCharacterStateSummary,
  getChapterRevisionDetail,
  getChapterRevisionHistory,
  getProjectCanonOverview,
} from '../../services/canon/engine';
import '../StoryBible/StoryBible.css';
import './CanonTruth.css';

const STATUS_LABELS = {
  draft: 'Nháp',
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
  available: 'Sẵn dùng',
  consumed: 'Đã dùng hết',
  destroyed: 'Đã hỏng',
  lost: 'Đã thất lạc',
  public: 'Công khai',
  secret: 'Bí mật',
  secret_exposed: 'Đã lộ',
  mutual: 'Hai bên đồng thuận',
  unclear: 'Chưa rõ',
  unknown: 'Chưa rõ',
};

const FACT_TYPE_LABELS = {
  fact: 'Sự thật',
  secret: 'Bí mật',
  rule: 'Quy tắc',
};

const SEVERITY_LABELS = {
  error: 'Lỗi',
  warning: 'Cảnh báo',
  info: 'Thông tin',
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
  OBJECT_STATUS_CHANGED: 'Đổi trạng thái vật phẩm',
  OBJECT_TRANSFERRED: 'Chuyển chủ vật phẩm',
  OBJECT_CONSUMED: 'Vật phẩm đã dùng hết',
  RELATIONSHIP_STATUS_CHANGED: 'Đổi trạng thái quan hệ',
  RELATIONSHIP_SECRET_CHANGED: 'Đổi mức độ bí mật quan hệ',
  INTIMACY_LEVEL_CHANGED: 'Đổi mức độ thân mật',
};

const EVIDENCE_TYPE_LABELS = {
  story_event: 'Sự kiện',
  chapter_revision: 'Phiên bản chương',
  fact: 'Sự thật',
  scene: 'Cảnh',
  candidate_op: 'Ứng viên thay đổi',
};

const RELATIONSHIP_LABELS = {
  lover: 'Tình cảm',
  ally: 'Đồng minh',
  enemy: 'Thù địch',
  friend: 'Bạn bè',
  family: 'Gia đình',
  mentor: 'Sư đồ',
  rival: 'Đối địch',
  subordinate: 'Cấp trên/cấp dưới',
  other: 'Khác',
};

const INTIMACY_LABELS = {
  none: 'Chưa thân mật',
  low: 'Nhẹ',
  medium: 'Gần gũi',
  high: 'Rất gần gũi',
};

function translateStatus(status) {
  return STATUS_LABELS[status] || 'Chưa rõ';
}

function translateFactType(type) {
  return FACT_TYPE_LABELS[type] || 'Mục dữ liệu';
}

function translateSeverity(severity) {
  return SEVERITY_LABELS[severity] || 'Thông tin';
}

function translateOpType(opType) {
  return OP_TYPE_LABELS[opType] || 'Sự kiện truyện';
}

function translateEvidenceType(type) {
  return EVIDENCE_TYPE_LABELS[type] || 'Bằng chứng';
}

function translateRelationshipType(type) {
  return RELATIONSHIP_LABELS[type] || type || 'Khác';
}

function translateIntimacyLevel(level) {
  return INTIMACY_LABELS[level] || level || 'Chưa rõ';
}

function buildSceneLabel(sceneId) {
  return sceneId ? `Cảnh ${sceneId}` : 'Cấp chương';
}

function buildRelationshipSummary(state, characterNameMap) {
  const characterA = characterNameMap.get(state.character_a_id) || `Nhân vật #${state.character_a_id}`;
  const characterB = characterNameMap.get(state.character_b_id) || `Nhân vật #${state.character_b_id}`;
  const parts = [
    translateRelationshipType(state.relationship_type),
    state.intimacy_level ? `Thân mật: ${translateIntimacyLevel(state.intimacy_level)}` : null,
    state.secrecy_state ? `Mức lộ: ${translateStatus(state.secrecy_state)}` : null,
    state.consent_state ? `Đồng thuận: ${translateStatus(state.consent_state)}` : null,
  ].filter(Boolean);

  return {
    pairLabel: `${characterA} × ${characterB}`,
    summary: parts.join(' | '),
    aftermath: state.emotional_aftermath || '',
  };
}

function formatConstraintCount(items = []) {
  if (!items.length) return 'Không có mục nào.';
  return `${items.length} mục cần chú ý.`;
}

export default function CanonTruth() {
  const { currentProject, chapters } = useProjectStore();
  const {
    characters,
    canonFacts,
    loadCodex,
    createCanonFact,
    updateCanonFact,
    deleteCanonFact,
  } = useCodexStore();
  const {
    repairPreview,
    repairChapterRevision,
    saveRepairDraftRevision,
    savingRepairDraft,
    lastActionOutcome,
    clearRepairText,
    clearActionOutcome,
  } = useCanonStore();

  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState(null);
  const [revisionHistory, setRevisionHistory] = useState(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState(null);
  const [revisionDetail, setRevisionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(null);

  const activeFacts = useMemo(
    () => canonFacts.filter((fact) => fact.status === 'active'),
    [canonFacts]
  );
  const archivedFacts = useMemo(
    () => canonFacts.filter((fact) => fact.status === 'deprecated'),
    [canonFacts]
  );
  const characterNameMap = useMemo(
    () => new Map(characters.map((character) => [character.id, character.name])),
    [characters]
  );
  const selectedEvidence = useMemo(
    () => revisionDetail?.evidence?.find((item) => item.id === selectedEvidenceId)
      || revisionDetail?.evidence?.[0]
      || null,
    [revisionDetail?.evidence, selectedEvidenceId]
  );
  const scopedRepairPreview = useMemo(() => {
    if (!selectedChapterId) return null;
    return repairPreview?.chapterId === selectedChapterId ? repairPreview : null;
  }, [repairPreview, selectedChapterId]);
  const entityCards = useMemo(
    () => (overview?.entityStates || []).map((state) => ({
      ...state,
      displayName: characterNameMap.get(state.entity_id) || `Nhân vật #${state.entity_id}`,
      summaryText: buildCharacterStateSummary(state),
    })),
    [overview?.entityStates, characterNameMap]
  );
  const itemCards = useMemo(
    () => (overview?.itemStates || []).map((state) => ({
      ...state,
      displayName: state.object_name || `Vật phẩm #${state.object_id}`,
      ownerName: state.owner_character_id ? characterNameMap.get(state.owner_character_id) || `Nhân vật #${state.owner_character_id}` : '',
      availabilityLabel: translateStatus(state.availability || 'available'),
    })),
    [overview?.itemStates, characterNameMap]
  );
  const relationshipCards = useMemo(
    () => (overview?.relationshipStates || []).map((state) => ({
      ...state,
      ...buildRelationshipSummary(state, characterNameMap),
    })),
    [overview?.relationshipStates, characterNameMap]
  );
  const criticalPanels = useMemo(() => {
    const constraints = overview?.criticalConstraints || {};
    return [
      {
        id: 'warnings',
        icon: AlertTriangle,
        title: 'Cảnh báo đang mở',
        tone: 'warning',
        count: constraints.activeWarnings?.length || 0,
        description: formatConstraintCount(constraints.activeWarnings),
        items: (constraints.activeWarnings || []).slice(0, 4).map((report) => ({
          title: translateSeverity(report.severity),
          detail: report.message,
          badge: report.chapter_title || 'Bản nháp',
        })),
      },
      {
        id: 'dead',
        icon: ShieldAlert,
        title: 'Nhân vật đã chết',
        tone: 'danger',
        count: constraints.deadCharacters?.length || 0,
        description: formatConstraintCount(constraints.deadCharacters),
        items: (constraints.deadCharacters || []).slice(0, 4).map((state) => ({
          title: characterNameMap.get(state.entity_id) || `Nhân vật #${state.entity_id}`,
          detail: buildCharacterStateSummary(state) || 'Không còn được hành động nếu không có hồi sinh hợp lệ.',
          badge: translateStatus(state.alive_status || 'dead'),
        })),
      },
      {
        id: 'items',
        icon: Package,
        title: 'Vật phẩm đã khóa',
        tone: 'danger',
        count: constraints.blockedItems?.length || 0,
        description: formatConstraintCount(constraints.blockedItems),
        items: (constraints.blockedItems || []).slice(0, 4).map((state) => ({
          title: state.object_name || `Vật phẩm #${state.object_id}`,
          detail: state.status_note || 'Không được tái sử dụng nếu chưa có event khôi phục hợp lệ.',
          badge: translateStatus(state.availability || (state.is_consumed ? 'consumed' : 'lost')),
        })),
      },
      {
        id: 'relationships',
        icon: HeartHandshake,
        title: 'Quan hệ nhạy cảm',
        tone: 'accent',
        count: constraints.sensitiveRelationships?.length || 0,
        description: formatConstraintCount(constraints.sensitiveRelationships),
        items: (constraints.sensitiveRelationships || []).slice(0, 4).map((state) => {
          const details = buildRelationshipSummary(state, characterNameMap);
          return {
            title: details.pairLabel,
            detail: details.aftermath || details.summary || 'Quan hệ này đang có continuity quan trọng.',
            badge: translateIntimacyLevel(state.intimacy_level || 'none'),
          };
        }),
      },
    ];
  }, [overview?.criticalConstraints, characterNameMap]);

  const loadOverview = useCallback(async () => {
    if (!currentProject?.id) {
      setOverview(null);
      return;
    }

    setLoadingOverview(true);
    try {
      const nextOverview = await getProjectCanonOverview(currentProject.id);
      setOverview(nextOverview);
    } finally {
      setLoadingOverview(false);
    }
  }, [currentProject?.id]);

  const loadRevisionInspector = useCallback(async (chapterId, preferredRevisionId = null) => {
    if (!currentProject?.id || !chapterId) {
      setRevisionHistory(null);
      setRevisionDetail(null);
      setSelectedEvidenceId(null);
      return;
    }

    setDetailLoading(true);
    try {
      const history = await getChapterRevisionHistory(currentProject.id, chapterId);
      const fallbackRevisionId = preferredRevisionId
        || history?.commit?.current_revision_id
        || history?.revisions?.[0]?.id
        || null;

      setRevisionHistory(history);
      setSelectedChapterId(chapterId);
      setSelectedRevisionId(fallbackRevisionId);

      if (!fallbackRevisionId) {
        setRevisionDetail(null);
        setSelectedEvidenceId(null);
        return;
      }

      const detail = await getChapterRevisionDetail(currentProject.id, fallbackRevisionId);
      setRevisionDetail(detail);
      setSelectedEvidenceId(detail?.evidence?.[0]?.id || null);
    } finally {
      setDetailLoading(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id) {
      loadCodex(currentProject.id);
      loadOverview();
    }
  }, [currentProject?.id, loadCodex, loadOverview]);

  useEffect(() => {
    clearActionOutcome();
    clearRepairText();
  }, [selectedChapterId, selectedRevisionId, clearActionOutcome, clearRepairText]);

  useEffect(() => {
    if (!overview?.chapterCommits?.length) {
      setSelectedChapterId(null);
      setRevisionHistory(null);
      setSelectedRevisionId(null);
      setRevisionDetail(null);
      setSelectedEvidenceId(null);
      return;
    }

    const targetChapterId = selectedChapterId || overview.chapterCommits[0]?.chapter_id;
    if (targetChapterId) {
      loadRevisionInspector(targetChapterId, selectedRevisionId);
    }
  }, [overview?.chapterCommits, loadRevisionInspector]);

  const handleAddFact = useCallback(() => {
    if (!currentProject?.id) return;
    createCanonFact({
      project_id: currentProject.id,
      description: '',
      fact_type: 'fact',
      status: 'active',
    });
  }, [createCanonFact, currentProject?.id]);

  const handleGenerateRepair = useCallback(async (reportId) => {
    if (!currentProject?.id || !selectedChapterId || !selectedRevisionId) return;
    try {
      await repairChapterRevision({
        projectId: currentProject.id,
        chapterId: selectedChapterId,
        revisionId: selectedRevisionId,
        reportId,
      });
    } catch {
      // Store keeps the detailed failure state for the dialog and action banner.
    }
  }, [currentProject?.id, repairChapterRevision, selectedChapterId, selectedRevisionId]);

  const handleSaveRepairDraft = useCallback(async () => {
    if (!currentProject?.id || !selectedChapterId || !selectedRevisionId || !scopedRepairPreview?.text) return;
    try {
      const saved = await saveRepairDraftRevision({
        projectId: currentProject.id,
        chapterId: selectedChapterId,
        revisionId: selectedRevisionId,
        reportId: scopedRepairPreview.reportId || null,
        chapterText: scopedRepairPreview.text,
      });
      await loadOverview();
      await loadRevisionInspector(selectedChapterId, saved?.id || null);
    } catch {
      // Outcome is stored centrally.
    }
  }, [
    currentProject?.id,
    loadOverview,
    loadRevisionInspector,
    saveRepairDraftRevision,
    scopedRepairPreview,
    selectedChapterId,
    selectedRevisionId,
  ]);

  const handleCopyRepair = useCallback(async () => {
    if (!scopedRepairPreview?.text) return;
    try {
      await navigator.clipboard.writeText(scopedRepairPreview.text);
    } catch (error) {
      console.warn('[CanonTruth] Failed to copy repair preview:', error);
    }
  }, [scopedRepairPreview?.text]);

  return (
    <div className="story-bible su-that-page">
      <MobileBibleTabs />

      <div className="su-that-page__header">
        <div>
          <h2 className="su-that-page__title">
            <BookKey size={22} />
            Sự thật
          </h2>
          <p className="su-that-page__subtitle">
            Trang này giữ toàn bộ sự thật chính thức của truyện: chương đang có hiệu lực, trạng thái nhân vật,
            vật phẩm, quan hệ, tuyến truyện, bằng chứng và các ràng buộc continuity đang còn hiệu lực.
          </p>
        </div>

        <div className="su-that-page__actions">
          <button className="btn btn-ghost" type="button" onClick={loadOverview} disabled={loadingOverview}>
            <RotateCcw size={16} className={loadingOverview ? 'spin' : ''} />
            Tải lại
          </button>
          <button className="btn btn-primary" type="button" onClick={handleAddFact} disabled={!currentProject?.id}>
            <Plus size={16} />
            Thêm sự thật
          </button>
        </div>
      </div>

      <div className="su-that-page__summary">
        <div className="bible-canon-stat">
          <span className="bible-canon-stat-label">Chương chính thức</span>
          <strong>{overview?.stats?.canonical_count || 0}/{overview?.stats?.chapter_count || chapters.length}</strong>
        </div>
        <div className="bible-canon-stat">
          <span className="bible-canon-stat-label">Bị chặn</span>
          <strong>{overview?.stats?.blocked_count || 0}</strong>
        </div>
        <div className="bible-canon-stat">
          <span className="bible-canon-stat-label">Cảnh báo</span>
          <strong>{(overview?.stats?.warning_count || 0) + (overview?.stats?.error_count || 0)}</strong>
        </div>
        <div className="bible-canon-stat">
          <span className="bible-canon-stat-label">Sự kiện</span>
          <strong>{overview?.stats?.event_count || 0}</strong>
        </div>
        <div className="bible-canon-stat">
          <span className="bible-canon-stat-label">Vật phẩm</span>
          <strong>{overview?.stats?.item_count || 0}</strong>
        </div>
        <div className="bible-canon-stat">
          <span className="bible-canon-stat-label">Quan hệ</span>
          <strong>{overview?.stats?.relationship_count || 0}</strong>
        </div>
      </div>

      {lastActionOutcome?.message && (
        <div className={`su-that-page__feedback su-that-page__feedback--${lastActionOutcome.ok ? 'success' : lastActionOutcome.kind === 'blocked' ? 'warning' : 'error'}`}>
          {lastActionOutcome.message}
        </div>
      )}

      {(overview?.recentPurgeArchives || []).length > 0 && (
        <section className="bible-canon-panel">
          <div className="bible-canon-panel-header">
            <strong>Da purge gan day</strong>
            <span>{overview.recentPurgeArchives.length}</span>
          </div>
          <div className="bible-canon-list">
            {overview.recentPurgeArchives.map((archive) => {
              const removedCounts = archive.removed_counts || {};
              const warningText = Array.isArray(archive.warnings) && archive.warnings.length > 0
                ? archive.warnings.join(' ')
                : archive.payload?.warnings?.join(' ') || '';
              return (
                <div key={archive.id} className="bible-canon-list-item su-that-page__archive-card">
                  <div className="su-that-page__archive-row">
                    <div>
                      <strong>{archive.chapter_title || `Chuong ${archive.chapter_id}`}</strong>
                      <p>
                        Purge {new Date(archive.created_at || Date.now()).toLocaleString()}
                        {archive.chapter_order_index != null ? ` | Thu tu cu: ${archive.chapter_order_index + 1}` : ''}
                      </p>
                      <p>
                        {[
                          removedCounts.revisions ? `${removedCounts.revisions} revision` : null,
                          removedCounts.events ? `${removedCounts.events} su kien` : null,
                          removedCounts.reports ? `${removedCounts.reports} report` : null,
                          removedCounts.facts ? `${removedCounts.facts} fact` : null,
                          removedCounts.characters ? `${removedCounts.characters} nhan vat` : null,
                          removedCounts.locations ? `${removedCounts.locations} dia diem` : null,
                          removedCounts.world_terms ? `${removedCounts.world_terms} world term` : null,
                          removedCounts.objects ? `${removedCounts.objects} vat pham` : null,
                        ].filter(Boolean).join(' | ') || 'Khong co artifact nao duoc luu.'}
                      </p>
                      {warningText && <p>{warningText}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="su-that-page__priority-grid">
        {criticalPanels.map((panel) => {
          const Icon = panel.icon;
          return (
            <div key={panel.id} className={`su-that-page__priority-panel su-that-page__priority-panel--${panel.tone}`}>
              <div className="su-that-page__panel-title">
                <div className="su-that-page__panel-icon">
                  <Icon size={16} />
                </div>
                <div>
                  <strong>{panel.title}</strong>
                  <p>{panel.description}</p>
                </div>
                <span className="bible-canon-badge bible-canon-badge--warning">{panel.count}</span>
              </div>

              <div className="su-that-page__compact-list">
                {panel.items.length > 0 ? panel.items.map((item, index) => (
                  <div key={`${panel.id}-${index}`} className="su-that-page__compact-item">
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                    <span className="bible-canon-meta">{item.badge}</span>
                  </div>
                )) : (
                  <p className="text-muted bible-canon-empty">Hiện chưa có mục nổi bật.</p>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="su-that-page__state-grid">
        <div className="bible-canon-panel su-that-page__state-panel su-that-page__state-panel--wide">
          <div className="bible-canon-panel-header">
            <strong>Chương đang có hiệu lực</strong>
            <span>{overview?.chapterCommits?.length || 0}</span>
          </div>
          <div className="bible-canon-list">
            {(overview?.chapterCommits || []).map((commit) => (
              <button
                key={commit.id || commit.chapter_id}
                type="button"
                className={`bible-canon-list-item bible-canon-list-item--interactive bible-canon-list-item--${commit.status || 'draft'} ${selectedChapterId === commit.chapter_id ? 'is-selected' : ''}`}
                onClick={() => loadRevisionInspector(commit.chapter_id)}
              >
                <div>
                  <strong>{commit.chapter_title || `Chương ${commit.chapter_id}`}</strong>
                  <p>Phiên bản hiện tại: r{commit.current_revision?.revision_number || 0}</p>
                </div>
                <span className={`bible-canon-badge bible-canon-badge--${commit.status || 'draft'}`}>
                  {translateStatus(commit.status || 'draft')}
                </span>
              </button>
            ))}
            {(overview?.chapterCommits || []).length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có chương nào được chốt thành sự thật chính thức.</p>
            )}
          </div>
        </div>

        <div className="bible-canon-panel su-that-page__state-panel">
          <div className="bible-canon-panel-header">
            <strong>Trạng thái nhân vật</strong>
            <span>{entityCards.length}</span>
          </div>
          <div className="bible-canon-list">
            {entityCards.map((state) => (
              <div key={state.id || state.entity_id} className="bible-canon-list-item">
                <div>
                  <strong>{state.displayName}</strong>
                  <p>{state.summaryText || 'Chưa có bản tóm tắt trạng thái.'}</p>
                </div>
                <span className={`bible-canon-badge bible-canon-badge--${state.alive_status || 'alive'}`}>
                  {translateStatus(state.alive_status || 'alive')}
                </span>
              </div>
            ))}
            {entityCards.length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có trạng thái nhân vật đã kết xuất.</p>
            )}
          </div>
        </div>

        <div className="bible-canon-panel su-that-page__state-panel">
          <div className="bible-canon-panel-header">
            <strong>Trạng thái vật phẩm</strong>
            <span>{itemCards.length}</span>
          </div>
          <div className="bible-canon-list">
            {itemCards.map((state) => (
              <div key={state.id || state.object_id} className="bible-canon-list-item">
                <div>
                  <strong>{state.displayName}</strong>
                  <p>
                    {state.ownerName ? `Chủ hiện tại: ${state.ownerName}` : 'Chưa có chủ rõ ràng.'}
                    {state.status_note ? ` | ${state.status_note}` : ''}
                  </p>
                </div>
                <span className={`bible-canon-badge bible-canon-badge--${state.availability || 'available'}`}>
                  {state.availabilityLabel}
                </span>
              </div>
            ))}
            {itemCards.length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có trạng thái vật phẩm nào được ghi nhận.</p>
            )}
          </div>
        </div>

        <div className="bible-canon-panel su-that-page__state-panel">
          <div className="bible-canon-panel-header">
            <strong>Trạng thái quan hệ</strong>
            <span>{relationshipCards.length}</span>
          </div>
          <div className="bible-canon-list">
            {relationshipCards.map((state) => (
              <div key={state.id || state.pair_key} className="bible-canon-list-item">
                <div>
                  <strong>{state.pairLabel}</strong>
                  <p>{state.summary || 'Chưa có tóm tắt quan hệ.'}</p>
                  {state.aftermath && <p>{state.aftermath}</p>}
                </div>
                <span className={`bible-canon-badge bible-canon-badge--${state.secrecy_state || 'public'}`}>
                  {translateStatus(state.secrecy_state || 'public')}
                </span>
              </div>
            ))}
            {relationshipCards.length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có trạng thái quan hệ nào được ghi nhận.</p>
            )}
          </div>
        </div>

        <div className="bible-canon-panel su-that-page__state-panel">
          <div className="bible-canon-panel-header">
            <strong>Trạng thái tuyến truyện</strong>
            <span>{overview?.threadStates?.length || 0}</span>
          </div>
          <div className="bible-canon-list">
            {(overview?.threadStates || []).map((threadState) => (
              <div key={threadState.id || threadState.thread_id} className="bible-canon-list-item">
                <div>
                  <strong>{threadState.thread_title || `Tuyến #${threadState.thread_id}`}</strong>
                  <p>{threadState.summary || 'Chưa có tóm tắt cho tuyến truyện này.'}</p>
                </div>
                <span className={`bible-canon-badge bible-canon-badge--${threadState.state || 'active'}`}>
                  {translateStatus(threadState.state || 'active')}
                </span>
              </div>
            ))}
            {(overview?.threadStates || []).length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có tuyến truyện nào được kết xuất.</p>
            )}
          </div>
        </div>
      </section>

      <section className="su-that-page__log-grid">
        <div className="bible-canon-panel">
          <div className="bible-canon-panel-header">
            <strong>Báo cáo kiểm tra gần đây</strong>
            <span>{overview?.recentReports?.length || 0}</span>
          </div>
          <div className="bible-canon-list">
            {(overview?.recentReports || []).map((report) => (
              <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--${report.severity}`}>
                <div>
                  <strong>{translateSeverity(report.severity)}</strong>
                  <p>{report.message}</p>
                </div>
                <span className="bible-canon-meta">{report.chapter_title || 'Bản nháp'}</span>
              </div>
            ))}
            {(overview?.recentReports || []).length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có báo cáo kiểm tra nào.</p>
            )}
          </div>
        </div>

        <div className="bible-canon-panel">
          <div className="bible-canon-panel-header">
            <strong>Sự kiện gần đây</strong>
            <span>{overview?.recentEvents?.length || 0}</span>
          </div>
          <div className="bible-canon-list">
            {(overview?.recentEvents || []).map((event) => (
              <div key={event.id} className="bible-canon-list-item">
                <div>
                  <strong>{translateOpType(event.op_type)}</strong>
                  <p>{event.summary || event.subject_name || event.thread_title || event.fact_description || 'Sự kiện truyện'}</p>
                </div>
                <span className="bible-canon-meta">{event.chapter_title || 'Chương chưa rõ'}</span>
              </div>
            ))}
            {(overview?.recentEvents || []).length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có sự kiện nào được ghi nhận.</p>
            )}
          </div>
        </div>

        <div className="bible-canon-panel">
          <div className="bible-canon-panel-header">
            <strong>Bằng chứng và phiên bản</strong>
            <span>{(overview?.recentEvidence?.length || 0) + (overview?.recentRevisions?.length || 0)}</span>
          </div>
          <div className="bible-canon-list">
            {(overview?.recentEvidence || []).map((item) => (
              <div key={`evidence-${item.id}`} className="bible-canon-list-item">
                <div>
                  <strong>{translateEvidenceType(item.target_type)}</strong>
                  <p>{item.summary || item.evidence_text || 'Chưa có nội dung bằng chứng.'}</p>
                </div>
                <span className="bible-canon-meta">{item.chapter_title || 'Chương chưa rõ'}</span>
              </div>
            ))}
            {(overview?.recentRevisions || []).map((revision) => (
              <div key={`revision-${revision.id}`} className={`bible-canon-list-item bible-canon-list-item--${revision.status || 'draft'}`}>
                <div>
                  <strong>{revision.chapter_title || `Chương ${revision.chapter_id}`}</strong>
                  <p>Phiên bản r{revision.revision_number || 0} - {translateStatus(revision.status || 'draft')}</p>
                </div>
                <span className="bible-canon-meta">Phiên bản</span>
              </div>
            ))}
            {(overview?.recentEvidence || []).length === 0 && (overview?.recentRevisions || []).length === 0 && (
              <p className="text-muted bible-canon-empty">Chưa có lịch sử bằng chứng hoặc phiên bản.</p>
            )}
          </div>
        </div>
      </section>

      <div className="bible-canon-detail">
        <div className="bible-canon-detail-header">
          <div>
            <strong>{revisionHistory?.chapter?.title || 'Bộ xem phiên bản chương'}</strong>
            <p>
              {revisionHistory?.revisions?.length || 0} phiên bản
              {revisionHistory?.commit?.canonical_revision_id ? ' · có bản chính thức' : ''}
            </p>
          </div>
          <div className="bible-canon-detail-actions">
            <select
              className="select"
              value={selectedRevisionId || ''}
              onChange={async (event) => {
                const revisionId = Number(event.target.value) || null;
                setSelectedRevisionId(revisionId);
                setDetailLoading(true);
                try {
                  const detail = revisionId ? await getChapterRevisionDetail(currentProject.id, revisionId) : null;
                  setRevisionDetail(detail);
                  setSelectedEvidenceId(detail?.evidence?.[0]?.id || null);
                } finally {
                  setDetailLoading(false);
                }
              }}
              disabled={detailLoading || !(revisionHistory?.revisions?.length > 0)}
            >
              <option value="">Chọn phiên bản...</option>
              {(revisionHistory?.revisions || []).map((revision) => (
                <option key={revision.id} value={revision.id}>
                  {`r${revision.revision_number || 0} - ${translateStatus(revision.status || 'draft')}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {revisionDetail && (
          <>
            <div className="bible-canon-detail-meta">
              <span className={`bible-canon-badge bible-canon-badge--${revisionDetail.revision.status || 'draft'}`}>
                {translateStatus(revisionDetail.revision.status || 'draft')}
              </span>
              {revisionDetail.revision.is_current && <span className="bible-canon-meta">Bản hiện tại</span>}
              {revisionDetail.revision.is_canonical && <span className="bible-canon-meta">Bản chính thức</span>}
              <span className="bible-canon-meta">{revisionDetail.events.length} sự kiện</span>
              <span className="bible-canon-meta">{revisionDetail.evidence.length} bằng chứng</span>
              <span className="bible-canon-meta">{revisionDetail.reports.length} báo cáo</span>
            </div>

            <div className="bible-canon-detail-grid">
              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header">
                  <strong>Sự kiện trong phiên bản</strong>
                  <span>{revisionDetail.events.length}</span>
                </div>
                <div className="bible-canon-list">
                  {revisionDetail.events.map((event) => (
                    <div key={event.id} className="bible-canon-list-item">
                      <div>
                        <strong>{translateOpType(event.op_type)}</strong>
                        <p>{event.summary || event.subject_name || event.fact_description || 'Sự kiện truyện'}</p>
                      </div>
                      <span className="bible-canon-meta">{buildSceneLabel(event.scene_id)}</span>
                    </div>
                  ))}
                  {revisionDetail.events.length === 0 && (
                    <p className="text-muted bible-canon-empty">Phiên bản này chưa có sự kiện nào được chốt.</p>
                  )}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header">
                  <strong>Bộ xem bằng chứng</strong>
                  <span>{revisionDetail.evidence.length}</span>
                </div>
                <div className="bible-canon-evidence-layout">
                  <div className="bible-canon-evidence-list">
                    {revisionDetail.evidence.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`bible-canon-list-item bible-canon-list-item--interactive ${selectedEvidence?.id === item.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedEvidenceId(item.id)}
                      >
                        <div>
                          <strong>{translateEvidenceType(item.target_type)}</strong>
                          <p>{item.summary || item.evidence_text || 'Chưa có mô tả bằng chứng.'}</p>
                        </div>
                      </button>
                    ))}
                    {revisionDetail.evidence.length === 0 && (
                      <p className="text-muted bible-canon-empty">Phiên bản này chưa có bằng chứng.</p>
                    )}
                  </div>
                  <div className="bible-canon-evidence-preview">
                    {selectedEvidence ? (
                      <>
                        <strong>{translateEvidenceType(selectedEvidence.target_type)}</strong>
                        <p>{selectedEvidence.summary || 'Chưa có tóm tắt.'}</p>
                        <pre>{selectedEvidence.evidence_text || 'Chưa có nội dung bằng chứng.'}</pre>
                      </>
                    ) : (
                      <p className="text-muted bible-canon-empty">Chọn một bằng chứng để xem chi tiết.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header">
                  <strong>Báo cáo kiểm tra</strong>
                  <span>{revisionDetail.reports.length}</span>
                </div>
                <div className="bible-canon-list">
                  {revisionDetail.reports.map((report) => (
                    <div key={report.id} className={`bible-canon-list-item bible-canon-list-item--${report.severity}`}>
                      <div className="su-that-page__report-row">
                        <div>
                          <strong>{translateSeverity(report.severity)}</strong>
                          <p>{report.message}</p>
                        </div>
                        <div className="su-that-page__report-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleGenerateRepair(report.id)}
                            disabled={scopedRepairPreview?.loading}
                          >
                            {scopedRepairPreview?.loading && scopedRepairPreview?.reportId === report.id ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                            Gợi ý sửa
                          </button>
                        </div>
                      </div>
                      <span className="bible-canon-meta">{buildSceneLabel(report.scene_id)}</span>
                    </div>
                  ))}
                  {revisionDetail.reports.length === 0 && (
                    <p className="text-muted bible-canon-empty">Phiên bản này không có báo cáo kiểm tra.</p>
                  )}
                </div>
              </div>

              <div className="bible-canon-panel">
                <div className="bible-canon-panel-header">
                  <strong>Ảnh chụp trạng thái</strong>
                  <span>{revisionDetail.snapshotData ? 'Có' : 'Không'}</span>
                </div>
                <div className="bible-canon-snapshot">
                  {revisionDetail.snapshotData ? (
                    <>
                      <div className="bible-canon-snapshot-stats">
                        <span>{revisionDetail.snapshotData.entityStates?.length || 0} trạng thái nhân vật</span>
                        <span>{revisionDetail.snapshotData.threadStates?.length || 0} trạng thái tuyến</span>
                        <span>{revisionDetail.snapshotData.factStates?.length || 0} sự thật</span>
                        <span>{revisionDetail.snapshotData.itemStates?.length || 0} vật phẩm</span>
                        <span>{revisionDetail.snapshotData.relationshipStates?.length || 0} quan hệ</span>
                      </div>
                      <div className="bible-canon-list">
                        {(revisionDetail.snapshotData.entityStates || []).slice(0, 4).map((state) => (
                          <div key={`snap-entity-${state.entity_id}`} className="bible-canon-list-item">
                            <div>
                              <strong>{characterNameMap.get(state.entity_id) || `Nhân vật #${state.entity_id}`}</strong>
                              <p>{buildCharacterStateSummary(state)}</p>
                            </div>
                          </div>
                        ))}
                        {(revisionDetail.snapshotData.itemStates || []).slice(0, 2).map((state) => (
                          <div key={`snap-item-${state.object_id}`} className="bible-canon-list-item">
                            <div>
                              <strong>{state.object_name || `Vật phẩm #${state.object_id}`}</strong>
                              <p>{translateStatus(state.availability || 'available')}</p>
                            </div>
                          </div>
                        ))}
                        {(revisionDetail.snapshotData.relationshipStates || []).slice(0, 2).map((state) => {
                          const details = buildRelationshipSummary(state, characterNameMap);
                          return (
                            <div key={`snap-rel-${state.pair_key}`} className="bible-canon-list-item">
                              <div>
                                <strong>{details.pairLabel}</strong>
                                <p>{details.summary || 'Quan hệ đang được theo dõi.'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-muted bible-canon-empty">Phiên bản này chưa có ảnh chụp trạng thái.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bible-canon-panel">
              <div className="bible-canon-panel-header">
                <strong>Van ban revision</strong>
                <span>{revisionDetail.revision.revision_number || 0}</span>
              </div>
              <div className="bible-canon-snapshot">
                <pre className="su-that-page__revision-text">
                  {revisionDetail.revision.chapter_text || 'Revision nay chua co chapter_text.'}
                </pre>
              </div>
            </div>
          </>
        )}

        {!revisionDetail && !detailLoading && (
          <p className="text-muted bible-canon-empty">Chọn một chương để xem phiên bản, sự kiện và bằng chứng.</p>
        )}
      </div>

      <div className="bible-section">
        <div className="bible-section-header">
          <h3 className="bible-section-title">
            <Sparkles size={18} />
            Sự thật đang hiệu lực ({activeFacts.length})
          </h3>
        </div>

        <div className="bible-cards-list">
          {activeFacts.map((fact) => (
            <div key={fact.id} className="bible-edit-card" style={{ gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <select
                  className="select"
                  style={{ width: '140px' }}
                  value={fact.fact_type}
                  onChange={(event) => updateCanonFact(fact.id, { fact_type: event.target.value })}
                >
                  <option value="fact">Sự thật</option>
                  <option value="secret">Bí mật</option>
                  <option value="rule">Quy tắc</option>
                </select>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={fact.description}
                  onChange={(event) => updateCanonFact(fact.id, { description: event.target.value })}
                  placeholder="Mô tả sự thật, bí mật hoặc quy tắc..."
                />
                <button
                  className="btn btn-icon text-danger"
                  type="button"
                  onClick={() => updateCanonFact(fact.id, { status: 'deprecated' })}
                  title="Lưu trữ"
                >
                  ×
                </button>
              </div>
              <div className="su-that-page__fact-meta">
                <span className="bible-canon-meta">{translateFactType(fact.fact_type)}</span>
              </div>
            </div>
          ))}
          {activeFacts.length === 0 && (
            <p className="text-muted su-that-page__empty">Chưa có sự thật nào đang hiệu lực.</p>
          )}
        </div>
      </div>

      {archivedFacts.length > 0 && (
        <div className="bible-section">
          <div className="bible-section-header">
            <h3 className="bible-section-title">
              <BookKey size={18} />
              Kho lưu trữ ({archivedFacts.length})
            </h3>
          </div>
          <div className="bible-cards-list">
            {archivedFacts.map((fact) => (
              <div key={fact.id} className="bible-edit-card su-that-page__archive-card">
                <div className="su-that-page__archive-row">
                  <span>[{translateFactType(fact.fact_type)}] {fact.description}</span>
                  <div className="su-that-page__archive-actions">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => updateCanonFact(fact.id, { status: 'active' })}>
                      Khôi phục
                    </button>
                    <button className="btn btn-ghost btn-danger btn-sm" type="button" onClick={() => deleteCanonFact(fact.id)}>
                      Xóa vĩnh viễn
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CanonRepairDialog
        open={Boolean(scopedRepairPreview)}
        preview={scopedRepairPreview}
        saving={savingRepairDraft}
        onClose={clearRepairText}
        onCopy={handleCopyRepair}
        onSaveDraft={handleSaveRepairDraft}
      />
    </div>
  );
}
