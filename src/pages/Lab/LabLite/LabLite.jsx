import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  BookKey,
  BookOpen,
  CheckCircle2,
  Loader2,
  Map as MapIcon,
  Pause,
  Play,
  RotateCcw,
  Square,
  Wand2,
} from 'lucide-react';
import useLabLiteStore from '../../../stores/labLiteStore.js';
import useProjectStore from '../../../stores/projectStore.js';
import { PROJECT_CONTENT_MODES, resolveProjectContentMode } from '../../../features/projectContentMode/projectContentMode.js';
import { PROJECT_MODES } from '../../../services/labLite/fanficProjectSetup.js';
import { evaluateCanonPackReadiness, buildCanonPackWriteTargets } from '../../../services/labLite/canonPackReadiness.js';
import { buildDeepSelectionPlan, planLabLiteScoutBatches } from '../../../services/labLite/longContextPlanner.js';
import {
  DEEP_PRESETS,
  formatNumber,
  getMaterializeActionLabel,
  getMaterializeDomainLabel,
  getNextAction,
  getPriorityLabel,
  getReadinessLabel,
  getRecommendationLabel,
  getSignalLabel,
  getStepStatus,
  PACK_VIEW_TABS,
  resultMatchesFilter,
  SCOUT_FILTERS,
  SCOUT_GOALS,
  groupMaterializationActions,
  selectPresetDeepChapterIndexes,
  summarizeCoverage,
  WORKFLOW_TABS,
} from './labLiteUiHelpers.js';
import LabLiteHero from './components/LabLiteHero.jsx';
import GuidedWorkspaceRail from './components/GuidedWorkspaceRail.jsx';
import { ChapterDetail, ChapterPanel } from './components/ChapterPanels.jsx';
import { CorpusLibrary, IngestBatchPanel, ParseDiagnostics, UploadPanel } from './components/ImportPanels.jsx';
import './LabLite.css';

const ADULT_CONTENT_MODES = new Set(['nsfw', 'eni']);

// Legacy static labels kept for Phase 0-3 source-contract tests:
// label: 'Nạp liệu'; deep_load: 'Nạp sâu'; light_load: 'Nạp nhẹ'; skip: 'Bỏ qua'; Nạp liệu offline, Danh sách chương, Xem trước chương, AI quét chương, Bản đồ arc.
// Guided workspace: Nạp liệu -> Quét nhanh -> Chọn phân tích sâu -> Canon Pack -> Dùng để viết.
// Product copy: Nạp liệu trực tiếp trên trình duyệt. AI chỉ gợi ý phát hiện lệch canon, không đảm bảo tuyệt đối.
// Preset copy: Phân tích nhanh, Phân tích đầy đủ, Phân tích sâu, Cảnh 18+ / nhạy cảm, Cấm phá canon, Cảnh 18+.
// Component copy: accept=".txt,.md,.docx"; Dữ liệu; Chưa có dữ liệu Lab Lite cho dự án này.; Lịch sử lượt nạp.
// Long-context planning copy: request quét, chương/request.

function CoveragePanel({ coverageSummary, activeFilter, onFilterChange, onRunMissing, onRetryFailures, onRunDeepMissing }) {
  const stats = [
    { key: 'all', label: 'Scout thật', value: `${formatNumber(coverageSummary.realScout)}/${formatNumber(coverageSummary.total)}` },
    { key: 'fallback', label: 'Fallback', value: formatNumber(coverageSummary.syntheticScout) },
    { key: 'missing_digest', label: 'Digest', value: formatNumber(coverageSummary.digestDone) },
    { key: 'missing_deep', label: 'Deep', value: formatNumber(coverageSummary.deepDone) },
    { key: 'missing_scout', label: 'Thiếu', value: formatNumber(coverageSummary.missing) },
    { key: 'error', label: 'Lỗi', value: formatNumber(coverageSummary.failed) },
  ];
  return (
    <section className="lab-lite-card">
      <div className="lab-lite-section-header">
        <div>
          <h3>Độ phủ phân tích</h3>
          <p>Fallback là dữ liệu tạm khi AI bỏ sót chương. Bấm vào từng ô để lọc danh sách chương cần xử lý.</p>
        </div>
      </div>
      <div className="lab-lite-stat-grid lab-lite-stat-grid--coverage">
        {stats.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`lab-lite-stat-button ${activeFilter === item.key ? 'is-active' : ''}`}
            onClick={() => onFilterChange(item.key)}
          >
            <strong>{item.label}</strong>
            <span>{item.value}</span>
          </button>
        ))}
      </div>
      <div className="lab-lite-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRunMissing} disabled={coverageSummary.missing === 0}>
          Quét chương thiếu
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetryFailures} disabled={coverageSummary.failed === 0}>
          Chạy lại lỗi
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRunDeepMissing} disabled={coverageSummary.total === 0}>
          Phân tích sâu phần thiếu
        </button>
      </div>
    </section>
  );
}

function ScoutPanel({
  scoutState,
  scoutResults,
  filter,
  onFilterChange,
  onRun,
  onPause,
  onCancel,
  onRetry,
  onSelectChapter,
  onToggleDeepChapter,
}) {
  const [goal, setGoal] = useState(scoutState.goal || 'story_bible');
  const [concurrency, setConcurrency] = useState(scoutState.concurrency || 2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resultSearch, setResultSearch] = useState('');
  const completeResults = scoutResults.filter((result) => result.status === 'complete');
  const failedResults = scoutResults.filter((result) => result.status === 'error');
  const isRunning = scoutState.status === 'running';
  const resultListRef = useRef(null);
  const visibleResults = completeResults
    .filter((result) => {
      const needle = resultSearch.trim().toLowerCase();
      return !needle
        || String(result.chapterIndex || '').includes(needle)
        || String(result.reason || '').toLowerCase().includes(needle)
        || (result.detectedSignals || []).some((signal) => getSignalLabel(signal).toLowerCase().includes(needle));
    })
    .slice(0, 200);
  const deepRecommended = completeResults.filter((result) => result.recommendation === 'deep_load' || ['critical', 'high'].includes(result.priority)).length;
  const resultVirtualizer = useVirtualizer({
    count: visibleResults.length,
    getScrollElement: () => resultListRef.current,
    estimateSize: () => 112,
    overscan: 6,
  });

  return (
    <section className="lab-lite-card lab-lite-scout">
      <div className="lab-lite-section-header">
        <div>
          <h3>AI quét chương</h3>
          <p>Quét mẫu từng chương bằng AI, không dùng keyword cứng.</p>
        </div>
        {isRunning ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
      </div>
      <div className="lab-lite-control-grid">
        <label>
          Mục tiêu
          <select value={goal} onChange={(event) => setGoal(event.target.value)} disabled={isRunning}>
            {SCOUT_GOALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Bộ lọc
          <select value={filter} onChange={(event) => onFilterChange(event.target.value)}>
            {SCOUT_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Tìm kết quả
          <input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Chương, lý do, signal" />
        </label>
      </div>
      <details className="lab-lite-advanced-details" open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)}>
        <summary>Thiết lập nâng cao</summary>
        <div className="lab-lite-control-grid lab-lite-control-grid--two">
          <label>
            Số luồng
            <select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} disabled={isRunning}>
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
      </details>
      <div className="lab-lite-progress-row">
        <div className="progress-track">
          <div
            className="progress-bar"
            style={{ width: `${scoutState.total ? Math.round((scoutState.completed / scoutState.total) * 100) : 0}%` }}
          />
        </div>
        <span>
          {scoutState.completed}/{scoutState.total} chương - {scoutState.completedRequests || 0}/{scoutState.estimatedRequests || 0} request - lỗi {scoutState.failed}
        </span>
      </div>
      {scoutState.strategy ? (
        <p className="lab-lite-muted">
          Chiến lược: {scoutState.strategy.label} - tối đa {scoutState.batchSize || 1} chương/request.
        </p>
      ) : null}
      {completeResults.length > 0 ? (
        <div className="lab-lite-summary-strip">
          <span>{formatNumber(completeResults.length)} chương đã quét</span>
          <span>{formatNumber(deepRecommended)} chương nên phân tích sâu</span>
          <span>{formatNumber(failedResults.length)} lỗi</span>
          {visibleResults.length < completeResults.length ? <span>Đang hiển thị {formatNumber(visibleResults.length)} kết quả đầu phù hợp</span> : null}
        </div>
      ) : null}
      <div className="lab-lite-actions">
        <button type="button" className="btn btn-primary" onClick={() => onRun(goal, concurrency)} disabled={isRunning}>
          <Play size={14} /> Quét chương
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onRun(goal, concurrency, true)} disabled={isRunning}>
          <RotateCcw size={14} /> Quét lại tất cả
        </button>
        <button type="button" className="btn btn-secondary" onClick={onPause} disabled={!isRunning}>
          <Pause size={14} /> Tạm dừng
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!isRunning}>
          <Square size={14} /> Hủy
        </button>
        <button type="button" className="btn btn-secondary" onClick={onRetry} disabled={isRunning || failedResults.length === 0}>
          <RotateCcw size={14} /> Thử lại lỗi
        </button>
      </div>
      {scoutState.error ? <p className="lab-lite-error">{scoutState.error}</p> : null}
      <div ref={resultListRef} className="lab-lite-result-list lab-lite-virtual-list">
        <div
          className="lab-lite-virtual-spacer"
          style={{ height: `${resultVirtualizer.getTotalSize()}px` }}
        >
          {resultVirtualizer.getVirtualItems().map((virtualRow) => {
            const result = visibleResults[virtualRow.index];
            return (
              <div
                key={result.id}
                className="lab-lite-virtual-row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="lab-lite-result-item">
                  <strong>Chương {result.chapterIndex} - {getRecommendationLabel(result.recommendation)}</strong>
                  <p>{result.reason}</p>
                  <div className="lab-lite-tags">
                    {result.detectedSignals.map((signal) => <span key={signal}>{getSignalLabel(signal)}</span>)}
                  </div>
                  <div className="lab-lite-actions lab-lite-actions--tight">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelectChapter?.(result.chapterIndex)}>
                      Mở chương
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onToggleDeepChapter?.(result.chapterIndex)}>
                      Chọn phân tích sâu
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ArcPanel({ arcState, arcs, selectedArcIds, onRun, onCancel, onSelect, onToggle }) {
  const isRunning = arcState.status === 'running';
  return (
    <section className="lab-lite-card lab-lite-arcs">
      <div className="lab-lite-section-header">
        <div>
          <h3>Bản đồ arc</h3>
          <p>Gom kết quả quét thành mạch truyện để chọn phần cần nạp sâu.</p>
        </div>
        {isRunning ? <Loader2 className="spin" size={18} /> : <MapIcon size={18} />}
      </div>
      <div className="lab-lite-actions">
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={isRunning}>
          <MapIcon size={14} /> Tạo arc
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!isRunning}>
          <Square size={14} /> Hủy
        </button>
      </div>
      {arcState.error ? <p className="lab-lite-error">{arcState.error}</p> : null}
      <div className="lab-lite-arc-list">
        {arcs.map((arc) => (
          <article key={arc.id} className="lab-lite-arc-item">
            <div className="lab-lite-arc-title-row">
              <button type="button" className="lab-lite-link-button" onClick={() => onSelect(arc.id)}>
                {arc.title}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onToggle(arc.id)}>
                {selectedArcIds.has(arc.id) ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                {selectedArcIds.has(arc.id) ? 'Đã chọn' : 'Chọn arc'}
              </button>
            </div>
            <p>Chương {arc.chapterStart}-{arc.chapterEnd} - {getPriorityLabel(arc.importance)}</p>
            <p>{arc.summary}</p>
            {arc.whyLoad ? <small>{arc.whyLoad}</small> : null}
            <div className="lab-lite-tags">
              {arc.recommendedDeepChapters.map((chapter) => <span key={chapter}>Nạp chương {chapter}</span>)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function DeepAnalysisPanel({
  chapters,
  arcs,
  deepPlan,
  deepPreset,
  onDeepPresetChange,
  rangeStart,
  rangeEnd,
  onRangeStartChange,
  onRangeEndChange,
  characterName,
  onCharacterNameChange,
  selectedDeepChapterIndexes,
  selectedArcIds,
  deepState,
  deepAnalysisItems,
  onToggleChapter,
  onSelectRecommended,
  onSelectMissingDigest,
  onToggleArc,
  onRun,
  onCancel,
}) {
  const isRunning = deepState.status === 'running';
  const completeItems = deepAnalysisItems.filter((item) => item.status === 'complete');
  const failedItems = deepAnalysisItems.filter((item) => item.status === 'error');

  return (
    <section className="lab-lite-card lab-lite-deep">
      <div className="lab-lite-section-header">
        <div>
          <h3>Phân tích sâu</h3>
          <p>Chọn phần quan trọng để AI đọc kỹ, thay vì bắt tác giả lần tay qua danh sách dài.</p>
        </div>
        {isRunning ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
      </div>

      <div className="lab-lite-control-grid lab-lite-control-grid--planner">
        <label>
          Preset
          <select value={deepPreset} onChange={(event) => onDeepPresetChange(event.target.value)} disabled={isRunning}>
            {DEEP_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Từ chương
          <input value={rangeStart} onChange={(event) => onRangeStartChange(event.target.value)} disabled={isRunning} placeholder="1" />
        </label>
        <label>
          Đến chương
          <input value={rangeEnd} onChange={(event) => onRangeEndChange(event.target.value)} disabled={isRunning} placeholder={String(chapters.length || 1)} />
        </label>
        <label>
          Nhân vật
          <input value={characterName} onChange={(event) => onCharacterNameChange(event.target.value)} disabled={isRunning} placeholder="Tên hoặc bí danh" />
        </label>
      </div>

      <div className="lab-lite-planner-summary">
        <span>{formatNumber(deepPlan.selectedCount)} chương được chọn</span>
        <span>{deepPlan.strategy?.label || 'Chưa có chiến lược'}</span>
        <span>Độ phủ sau chạy: {Math.round((deepPlan.coverageAfterRun || 0) * 100)}%</span>
      </div>
      <details className="lab-lite-advanced-details">
        <summary>Ước tính kỹ thuật</summary>
        <div className="lab-lite-planner-summary">
          <span>{formatNumber(deepPlan.estimatedTokens)} token</span>
          <span>{formatNumber(deepPlan.estimatedRequests)} request dự kiến</span>
        </div>
      </details>

      <div className="lab-lite-actions">
        <button type="button" className="btn btn-secondary" onClick={onSelectRecommended} disabled={isRunning}>
          Để AI tự chọn phần quan trọng
        </button>
        <button type="button" className="btn btn-secondary" onClick={onSelectMissingDigest} disabled={isRunning}>
          Phân tích mọi chương còn thiếu digest
        </button>
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={isRunning}>
          <Play size={14} /> Chạy phân tích sâu
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!isRunning}>
          <Square size={14} /> Dừng
        </button>
      </div>

      <div className="lab-lite-progress-row">
        <div className="progress-track">
          <div
            className="progress-bar"
            style={{ width: `${deepState.total ? Math.round((deepState.completed / deepState.total) * 100) : 0}%` }}
          />
        </div>
        <span>{deepState.completed}/{deepState.total} target - đang chạy {deepState.running || 0} - lỗi {deepState.failed}</span>
      </div>
      {deepState.error ? <p className="lab-lite-error">{deepState.error}</p> : null}

      <div className="lab-lite-two-column">
        <div>
          <h4>Chọn arc</h4>
          <div className="lab-lite-mini-list">
            {arcs.length === 0 ? <p className="lab-lite-muted">Chưa có arc. Hãy tạo bản đồ arc trước.</p> : null}
            {arcs.map((arc) => (
              <button
                key={arc.id}
                type="button"
                className={`lab-lite-select-row ${selectedArcIds.has(arc.id) ? 'is-active' : ''}`}
                onClick={() => onToggleArc(arc.id)}
                disabled={isRunning}
              >
                <span>{arc.title}</span>
                <small>Chương {arc.chapterStart}-{arc.chapterEnd}</small>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h4>Chương đã chọn</h4>
          <div className="lab-lite-mini-list">
            {deepPlan.selectedChapterIndexes.length === 0 ? <p className="lab-lite-muted">Chưa có chương nào trong preset hiện tại.</p> : null}
            {deepPlan.selectedChapterIndexes.slice(0, 80).map((chapterIndex) => {
              const chapter = chapters.find((item) => Number(item.index) === Number(chapterIndex));
              if (!chapter) return null;
              return (
              <button
                key={chapter.id}
                type="button"
                className={`lab-lite-select-row ${selectedDeepChapterIndexes.has(Number(chapter.index)) ? 'is-active' : ''}`}
                onClick={() => onToggleChapter(chapter.index)}
                disabled={isRunning}
              >
                <span>Chương {chapter.index}: {chapter.title}</span>
                <small>{formatNumber(chapter.estimatedTokens)} token</small>
              </button>
              );
            })}
            {deepPlan.selectedChapterIndexes.length > 80 ? (
              <p className="lab-lite-muted">+{formatNumber(deepPlan.selectedChapterIndexes.length - 80)} chương khác không hiện trong danh sách rút gọn.</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="lab-lite-result-list">
        {completeItems.slice(0, 20).map((item) => (
          <div key={item.id} className="lab-lite-result-item">
            <strong>{item.title || item.targetId}</strong>
            <p>{formatNumber(item.result?.chapterCanon?.length || 0)} canon chương - {formatNumber(item.result?.characterUpdates?.length || 0)} nhân vật - {formatNumber(item.result?.canonRestrictions?.length || 0)} ràng buộc</p>
          </div>
        ))}
        {failedItems.map((item) => (
          <div key={item.id} className="lab-lite-result-item">
            <strong>{item.title || item.targetId}</strong>
            <p className="lab-lite-error">{item.error}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CanonPackPanel({ canonPackState, canonPacks, canonPackMergePlans, currentProject, readiness, writeTargets, allowAdultCanon, onBuild, onLinkToProject, onOpenEditor, onCreateFanficProject, onCreateMergePlan, onApplyMergePlan }) {
  const isBuilding = canonPackState.status === 'building';
  const latestPack = canonPacks[0] || null;
  const [viewTab, setViewTab] = useState('overview');
  const [showAdultDetails, setShowAdultDetails] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedMergeActionIds, setSelectedMergeActionIds] = useState(new Set());
  const isLinkedToCurrentProject = Boolean(
    currentProject?.id
    && latestPack?.id
    && currentProject.source_canon_pack_id === latestPack.id,
  );
  const canWrite = latestPack && ['usable', 'strong'].includes(readiness?.status);
  const visiblePackTabs = PACK_VIEW_TABS.filter((tab) => tab.id !== 'adult' || (allowAdultCanon && latestPack?.adultCanon?.enabled));
  const latestMergePlan = canonPackMergePlans?.[0] || null;

  useEffect(() => {
    if (!latestMergePlan?.actions) {
      setSelectedMergeActionIds(new Set());
      return;
    }
    setSelectedMergeActionIds(new Set(latestMergePlan.actions
      .filter((action) => ['create', 'update'].includes(action.action))
      .map((action) => action.id)));
  }, [latestMergePlan?.id]);

  const renderPackView = () => {
    if (!latestPack) return <p className="lab-lite-muted">Chưa có Canon Pack. Hãy chạy phân tích sâu trước để dữ liệu đủ sạch.</p>;
    if (viewTab === 'characters') {
      return latestPack.characterCanon?.slice(0, 40).map((character) => (
        <div key={character.name} className="lab-lite-result-item">
          <strong>{character.name}</strong>
          <p>{character.status || character.role || 'Chưa có trạng thái'} {character.voice ? `- Giọng: ${character.voice}` : ''}</p>
        </div>
      ));
    }
    if (viewTab === 'relationships') {
      return latestPack.relationshipCanon?.slice(0, 40).map((relationship, index) => (
        <div key={`${relationship.characterA || relationship.source}-${index}`} className="lab-lite-result-item">
          <strong>{relationship.characterA || relationship.source || '?'} / {relationship.characterB || relationship.target || '?'}</strong>
          <p>{relationship.relation || relationship.relationship || relationship.change || relationship.description || 'Quan hệ cần bổ sung mô tả.'}</p>
        </div>
      ));
    }
    if (viewTab === 'timeline') {
      return latestPack.globalCanon?.timelineAnchors?.slice(0, 40).map((item, index) => (
        <div key={index} className="lab-lite-result-item">
          <strong>{item.chapterIndex ? `Chương ${item.chapterIndex}` : `Mốc ${index + 1}`}</strong>
          <p>{item.event || item.description || String(item)}</p>
        </div>
      ));
    }
    if (viewTab === 'style') {
      return (
        <div className="lab-lite-result-item">
          <strong>Style Canon</strong>
          <p>Tone: {latestPack.styleCanon?.tone || 'Chưa rõ'} - Pacing: {latestPack.styleCanon?.pacing || 'Chưa rõ'} - Voice: {latestPack.styleCanon?.voice || 'Chưa rõ'}</p>
          {latestPack.styleCanon?.observations?.map((item, index) => <p key={index}>{item}</p>)}
        </div>
      );
    }
    if (viewTab === 'restrictions') {
      return latestPack.canonRestrictions?.slice(0, 60).map((item, index) => (
        <div key={index} className="lab-lite-result-item">
          <strong>Điều cấm phá canon</strong>
          <p>{item}</p>
        </div>
      ));
    }
    if (viewTab === 'gaps') {
      return latestPack.creativeGaps?.slice(0, 60).map((item, index) => (
        <div key={index} className="lab-lite-result-item">
          <strong>Vùng trống sáng tạo</strong>
          <p>{item}</p>
        </div>
      ));
    }
    if (viewTab === 'adult') {
      if (!showAdultDetails) {
        return (
          <div className="lab-lite-result-item">
            <strong>Adult Canon đang được ẩn</strong>
            <p>Thông tin 18+ được lưu riêng và chỉ mở khi bạn chủ động xem.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdultDetails(true)}>Hiện chi tiết 18+</button>
          </div>
        );
      }
      return latestPack.adultCanon?.notes?.slice(0, 30).map((item, index) => (
        <div key={index} className="lab-lite-result-item">
          <strong>Adult Canon {index + 1}</strong>
          <p>{typeof item === 'string' ? item : item.dynamic || item.tone || item.boundary || item.evidence || JSON.stringify(item)}</p>
        </div>
      ));
    }
    return (
      <>
        <div className="lab-lite-stat-grid">
          <span>{formatNumber(latestPack.arcCanon?.length)} arc</span>
          <span>{formatNumber(latestPack.characterCanon?.length)} nhân vật</span>
          <span>{formatNumber(latestPack.relationshipCanon?.length)} quan hệ</span>
          <span>{formatNumber(latestPack.chapterCanon?.length)} canon chương</span>
        </div>
        <div className="lab-lite-result-item">
          <strong>Tổng quan</strong>
          <p>{latestPack.globalCanon?.summary || 'Chưa có tổng quan đủ tốt.'}</p>
        </div>
      </>
    );
  };

  return (
    <section className="lab-lite-card lab-lite-canon-pack">
      <div className="lab-lite-section-header">
        <div>
          <h3>Dùng Canon Pack để viết</h3>
          <p>Gộp kết quả quét, bản đồ arc và phân tích sâu thành bộ nhớ tác giả có thể dùng ngay trong dự án.</p>
        </div>
        {isBuilding ? <Loader2 className="spin" size={18} /> : <BookKey size={18} />}
      </div>
      {latestPack ? (
        <div className={`lab-lite-readiness is-${readiness?.status || 'not_ready'}`}>
          <strong>{getReadinessLabel(readiness?.status)} - {formatNumber(readiness?.score)}%</strong>
          <div className="progress-track"><div className="progress-bar" style={{ width: `${readiness?.score || 0}%` }} /></div>
          {readiness?.missing?.length ? <p>Chưa đủ vì thiếu: {readiness.missing.join(', ')}</p> : <p>Đủ dùng cho bước viết tiếp theo.</p>}
          {readiness?.nextActions?.slice(0, 2).map((action) => <p key={action}>{action}</p>)}
        </div>
      ) : null}
      <div className="lab-lite-actions">
        <button type="button" className="btn btn-primary" onClick={onBuild} disabled={isBuilding}>
          <Wand2 size={14} /> Dựng Canon Pack
        </button>
        {latestPack && currentProject?.id ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onLinkToProject(latestPack.id)}
            disabled={isLinkedToCurrentProject}
          >
            <BookKey size={14} />
            {isLinkedToCurrentProject ? 'Đã dùng cho dự án này' : 'Dùng Canon Pack để viết'}
          </button>
        ) : null}
        {canWrite ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={onCreateFanficProject}>
              Tạo project đồng nhân từ Canon Pack
            </button>
            <button type="button" className="btn btn-primary" onClick={onOpenEditor} disabled={!currentProject?.id}>
              Mở editor với Canon Pack
            </button>
          </>
        ) : null}
      </div>
      {canonPackState.error ? <p className="lab-lite-error">{canonPackState.error}</p> : null}
      {latestPack && currentProject?.id && !isLinkedToCurrentProject ? <p className="lab-lite-muted">Liên kết Canon Pack sẽ chuyển project sang mode đồng nhân nếu project hiện tại chưa có mode phù hợp.</p> : null}
      {latestPack ? (
        <div className="lab-lite-pack-preview">
          <h4>{latestPack.title}</h4>
          <div className="lab-lite-pack-tabs">
            {visiblePackTabs.map((tab) => (
              <button key={tab.id} type="button" className={`lab-lite-tab ${viewTab === tab.id ? 'is-active' : ''}`} onClick={() => setViewTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="lab-lite-result-list lab-lite-pack-view">
            {renderPackView()}
          </div>
          <div className="lab-lite-result-list">
            <h4>Gợi ý dùng để viết</h4>
            {writeTargets.length === 0 ? <p className="lab-lite-muted">Chưa có gợi ý viết rõ ràng. Hãy chạy thêm phân tích sâu cho arc hoặc vùng còn thiếu.</p> : null}
            {writeTargets.slice(0, 8).map((target) => (
              <div key={target.id} className="lab-lite-result-item">
                <strong>{target.title}</strong>
                <p>{target.description}</p>
              </div>
            ))}
          </div>
          <details className="lab-lite-advanced-details" open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)}>
            <summary>Nâng cao: export và merge Canon Pack</summary>
            <div className="lab-lite-actions">
              {latestPack ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(latestPack, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${latestPack.title || 'canon-pack'}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export JSON
                </button>
              ) : null}
              {canonPacks.length > 1 ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCreateMergePlan(canonPacks[0]?.id, canonPacks[1]?.id)}>
                  Tạo kế hoạch merge nạp thêm
                </button>
              ) : null}
            </div>
            {latestMergePlan ? (
              <>
                <div className="lab-lite-stat-grid">
                  <span>{getMaterializeActionLabel('create')}: {formatNumber(latestMergePlan.summary?.create)}</span>
                  <span>{getMaterializeActionLabel('update')}: {formatNumber(latestMergePlan.summary?.update)}</span>
                  <span>Xung đột: {formatNumber(latestMergePlan.summary?.conflict)}</span>
                  <span>{getMaterializeActionLabel('skip')}: {formatNumber(latestMergePlan.summary?.skip)}</span>
                </div>
                {latestMergePlan.actions?.slice(0, 20).map((action) => (
                  <div key={action.id} className="lab-lite-result-item">
                    <label className="lab-lite-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedMergeActionIds.has(action.id)}
                        disabled={!['create', 'update'].includes(action.action)}
                        onChange={() => setSelectedMergeActionIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(action.id)) next.delete(action.id);
                          else next.add(action.id);
                          return next;
                        })}
                      />
                      <strong>{getMaterializeActionLabel(action.action)} - {getMaterializeDomainLabel(action.type)}</strong>
                    </label>
                    <p>{action.source?.name || action.source?.description || action.reason || String(action.source || '')}</p>
                    <small>{action.reason}</small>
                  </div>
                ))}
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onApplyMergePlan(latestMergePlan.id, [...selectedMergeActionIds])}>
                  Merge mục đã duyệt
                </button>
              </>
            ) : (
              <p className="lab-lite-muted">Khi nạp thêm tạo Canon Pack mới, bạn có thể tạo merge plan để duyệt trước khi nhập vào pack chính.</p>
            )}
          </details>
        </div>
      ) : (
        <p className="lab-lite-muted">Chưa có Canon Pack. Hãy chạy phân tích sâu trước để dữ liệu đủ sạch.</p>
      )}
    </section>
  );
}

function MaterializePanel({
  currentProject,
  canonPacks,
  materializationPlan,
  materializeState,
  onPlan,
  onApply,
}) {
  const [selectedPackId, setSelectedPackId] = useState('');
  const [activeGroup, setActiveGroup] = useState('all');
  const [selectedActionIds, setSelectedActionIds] = useState(new Set());

  useEffect(() => {
    if (!selectedPackId && canonPacks[0]?.id) {
      setSelectedPackId(canonPacks[0].id);
    }
  }, [canonPacks, selectedPackId]);

  useEffect(() => {
    if (!materializationPlan?.actions) {
      setSelectedActionIds(new Set());
      return;
    }
    setSelectedActionIds(new Set(
      materializationPlan.actions
        .filter((action) => ['create', 'update'].includes(action.action))
        .map((action) => action.id),
    ));
  }, [materializationPlan?.id]);

  const actionGroups = groupMaterializationActions(materializationPlan?.actions || []);
  const visibleGroups = activeGroup === 'all'
    ? actionGroups
    : actionGroups.filter((group) => group.label === activeGroup);
  const toggleAction = (id) => {
    setSelectedActionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectedCount = selectedActionIds.size;

  return (
    <section className="lab-lite-card lab-lite-materialize">
      <div className="lab-lite-section-header">
        <div>
          <h3>Đưa vào Story Bible</h3>
          <p>Bước này không bắt buộc. Duyệt các mục sẽ thêm hoặc cập nhật trước khi ghi vào dự án.</p>
        </div>
        <BookOpen size={18} />
      </div>

      <div className="lab-lite-control-grid lab-lite-control-grid--two">
        <label>
          Canon Pack
          <select value={selectedPackId} onChange={(event) => setSelectedPackId(event.target.value)}>
            {canonPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.title}</option>)}
          </select>
        </label>
        <label>
          Dự án
          <input value={currentProject?.title || 'Chưa mở dự án'} disabled />
        </label>
      </div>

      <div className="lab-lite-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onPlan(selectedPackId)}
          disabled={!selectedPackId || !currentProject?.id || materializeState.status === 'planning'}
        >
          Tạo bản duyệt
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            const confirmed = window.confirm(`Áp dụng ${formatNumber(selectedCount)} mục đã duyệt vào Story Bible của dự án này?`);
            if (confirmed) onApply([...selectedActionIds]);
          }}
          disabled={!materializationPlan || materializeState.status === 'applying'}
        >
          Áp dụng {formatNumber(selectedCount)} mục đã duyệt
        </button>
      </div>
      {materializeState.error ? <p className="lab-lite-error">{materializeState.error}</p> : null}
      {materializeState.status === 'applied' ? <p className="lab-lite-muted">Đã áp dụng {formatNumber(materializeState.appliedCount)} mục.</p> : null}

      {materializationPlan ? (
        <div className="lab-lite-materialize-plan">
          <div className="lab-lite-stat-grid">
            <span>{getMaterializeActionLabel('create')}: {formatNumber(materializationPlan.summary?.create)}</span>
            <span>{getMaterializeActionLabel('update')}: {formatNumber(materializationPlan.summary?.update)}</span>
            <span>{getMaterializeActionLabel('skip')}: {formatNumber(materializationPlan.summary?.skip)}</span>
            <span>{getMaterializeActionLabel('needs_review')}: {formatNumber(materializationPlan.summary?.needs_review)}</span>
          </div>
          <div className="lab-lite-actions">
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${activeGroup === 'all' ? 'is-active' : ''}`}
              onClick={() => setActiveGroup('all')}
            >
              Tất cả
            </button>
            {actionGroups.map((group) => (
              <button
                key={group.label}
                type="button"
                className={`btn btn-secondary btn-sm ${activeGroup === group.label ? 'is-active' : ''}`}
                onClick={() => setActiveGroup(group.label)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <div className="lab-lite-result-list">
            {visibleGroups.map((group) => (
              <div key={group.label} className="lab-lite-materialize-group">
                <h4>{group.label}</h4>
                {group.items.slice(0, 120).map((item) => (
                  <div key={item.id} className="lab-lite-result-item">
                    <label className="lab-lite-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedActionIds.has(item.id)}
                        onChange={() => toggleAction(item.id)}
                        disabled={!item.selectable}
                      />
                      <strong>{item.actionLabel} - {item.title}</strong>
                    </label>
                    <p>{item.reason}</p>
                    {!item.selectable ? <small>Mục này chỉ để xem lại, chưa ghi tự động.</small> : null}
                    {item.hasDiff ? (
                      <details className="lab-lite-diff-details">
                        <summary>Nâng cao: xem dữ liệu trước/sau</summary>
                        <pre>{JSON.stringify({ before: item.before, after: item.after }, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function LabLite() {
  const {
    corpuses,
    currentCorpus,
    currentCorpusId,
    currentChapterId,
    chapters,
    scoutResults,
    arcs,
    deepAnalysisItems,
    canonPacks,
    ingestBatches,
    canonPackMergePlans,
    chapterCoverage,
    materializationPlan,
    selectedArcIds,
    selectedDeepChapterIndexes,
    loading,
    error,
    importState,
    scoutState,
    arcState,
    deepState,
    canonPackState,
    materializeState,
    presetRunState,
    initialize,
    importFile,
    runAnalysisPreset,
    selectCorpus,
    deleteCorpus,
    selectChapter,
    renameCorpus,
    renameChapter,
    splitChapter,
    runScout,
    pauseScout,
    cancelScout,
    retryScoutFailures,
    setScoutFilter,
    runArcMapper,
    cancelArcMapper,
    selectArc,
    toggleArcSelection,
    toggleDeepChapterSelection,
    setDeepChapterSelection,
    runDeepAnalysis,
    cancelDeepAnalysis,
    buildCanonPack,
    createCanonPackMergePlan,
    applyCanonPackMergePlan,
    createMaterializationPlan,
    applyMaterialization,
  } = useLabLiteStore();
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams();
  const [activeTab, setActiveTab] = useState('import');
  const [ingestType, setIngestType] = useState('source_story');
  const [analysisMode, setAnalysisMode] = useState('fast');
  const [allowAdultIngest, setAllowAdultIngest] = useState(false);
  const [deepPreset, setDeepPreset] = useState('ai_recommended');
  const [rangeStart, setRangeStart] = useState('1');
  const [rangeEnd, setRangeEnd] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [coverageFilter, setCoverageFilter] = useState('all');
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProjectSettings = useProjectStore((state) => state.updateProjectSettings);
  const createProject = useProjectStore((state) => state.createProject);
  const activeLabLiteProjectId = routeProjectId || currentProject?.id || null;
  const contentMode = resolveProjectContentMode(currentProject || {});
  const adultModeAllowed = ADULT_CONTENT_MODES.has(contentMode) || allowAdultIngest || ingestType === 'adult_scene';

  useEffect(() => {
    initialize({ projectId: activeLabLiteProjectId });
  }, [initialize, activeLabLiteProjectId]);

  const currentChapter = chapters.find((chapter) => chapter.id === currentChapterId) || chapters[0] || null;
  const currentChapterPosition = currentChapter ? chapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1;
  const activeScoutResults = scoutResults.filter((result) => result.corpusId === currentCorpusId && result.goal === scoutState.goal);
  const scoutFilter = scoutState.filter || 'all';
  const latestPack = canonPacks[0] || null;
  const readiness = useMemo(() => evaluateCanonPackReadiness(latestPack || {}, currentCorpus || {}, {
    deepAnalysisItems,
    chapterCoverage,
    allowAdultCanon: adultModeAllowed,
  }), [latestPack, currentCorpus, deepAnalysisItems, chapterCoverage, adultModeAllowed]);
  const coverageSummary = useMemo(() => summarizeCoverage(
    chapterCoverage,
    currentCorpus?.chapterCount || chapters.length,
  ), [chapterCoverage, currentCorpus?.chapterCount, chapters.length]);
  const writeTargets = useMemo(() => buildCanonPackWriteTargets(latestPack || {}, {
    allowAdultCanon: adultModeAllowed,
  }), [latestPack, adultModeAllowed]);
  const scoutPlan = useMemo(() => planLabLiteScoutBatches({
    chapters,
    totalEstimatedTokens: currentCorpus?.totalEstimatedTokens || 0,
    chapterCount: currentCorpus?.chapterCount || chapters.length,
  }), [chapters, currentCorpus?.chapterCount, currentCorpus?.totalEstimatedTokens]);
  const deepPlan = useMemo(() => buildDeepSelectionPlan({
    preset: deepPreset,
    chapters,
    scoutResults: activeScoutResults,
    arcs,
    allowAdultCanon: adultModeAllowed,
    rangeStart,
    rangeEnd,
    characterName,
    chapterCoverage,
  }), [deepPreset, chapters, activeScoutResults, arcs, adultModeAllowed, rangeStart, rangeEnd, characterName, chapterCoverage]);
  const stepStatuses = useMemo(() => Object.fromEntries(WORKFLOW_TABS.map((step) => [
    step.id,
    getStepStatus({
      stepId: step.id,
      currentCorpus,
      coverageSummary,
      scoutResults: activeScoutResults,
      arcs,
      deepAnalysisItems,
      latestPack,
      readiness,
      materializationPlan,
      importState,
      scoutState,
      arcState,
      deepState,
      canonPackState,
      materializeState,
      presetRunState,
    }),
  ])), [currentCorpus, coverageSummary, activeScoutResults, arcs, deepAnalysisItems, latestPack, readiness, materializationPlan, importState, scoutState, arcState, deepState, canonPackState, materializeState, presetRunState]);
  const nextAction = useMemo(() => getNextAction({
    currentCorpus,
    coverageSummary,
    scoutResults: activeScoutResults,
    arcs,
    deepPlan,
    deepAnalysisItems,
    latestPack,
    readiness,
    materializationPlan,
    currentProject,
  }), [currentCorpus, coverageSummary, activeScoutResults, arcs, deepPlan, deepAnalysisItems, latestPack, readiness, materializationPlan, currentProject]);

  const handleImport = async (file) => {
    try {
      await importFile(file, {
        projectId: activeLabLiteProjectId,
        ingestType,
        analysisMode,
        allowAdultCanon: adultModeAllowed,
      });
      await runAnalysisPreset({
        mode: analysisMode,
        goal: 'story_bible',
        contentMode: adultModeAllowed ? PROJECT_CONTENT_MODES.NSFW : contentMode,
        concurrency: 2,
      });
    } catch (error) {
      console.error('Lab Lite import/preset failed:', error);
    }
  };

  const handleDeleteCorpus = (corpusId) => {
    const corpus = corpuses.find((item) => item.id === corpusId);
    const title = corpus?.title || 'bộ dữ liệu này';
    const confirmed = window.confirm(
      `Xóa vĩnh viễn dữ liệu Lab Lite "${title}" khỏi IndexedDB?\n\nThao tác này sẽ xóa chương gốc, kết quả Scout, phân tích sâu, Canon Pack, cache, job và coverage liên quan. Không thể hoàn tác.`,
    );
    if (!confirmed) return;
    deleteCorpus(corpusId).catch(() => {});
  };

  const handleRunScout = (goal, concurrency, forceRerun = false) => {
    runScout({ goal, concurrency, contentMode: adultModeAllowed ? PROJECT_CONTENT_MODES.NSFW : contentMode, forceRerun }).catch(() => {});
  };

  const handleRunArcMapper = () => {
    runArcMapper(currentCorpusId).catch(() => {});
  };

  const handleRunDeepAnalysis = () => {
    runDeepAnalysis({ contentMode: adultModeAllowed ? PROJECT_CONTENT_MODES.NSFW : contentMode }).catch(() => {});
  };

  const handleApplyDeepPlanner = () => {
    setDeepChapterSelection(deepPlan.selectedChapterIndexes);
  };

  const handleSelectMissingDigest = () => {
    const missingDigest = chapterCoverage
      .filter((entry) => !entry.digestDone)
      .map((entry) => Number(entry.chapterIndex))
      .filter((chapterIndex) => Number.isFinite(chapterIndex) && chapterIndex > 0);
    if (missingDigest.length > 0) {
      setDeepChapterSelection(missingDigest);
      setCoverageFilter('missing_digest');
      setActiveTab('deep');
    }
  };

  const handleRunDeepMissing = () => {
    const selected = selectPresetDeepChapterIndexes({
      mode: 'deep',
      chapters,
      scoutResults: activeScoutResults,
      arcs,
      chapterCoverage,
    });
    setDeepChapterSelection(selected);
    setActiveTab('deep');
    if (selected.length > 0) {
      runDeepAnalysis({ contentMode: adultModeAllowed ? PROJECT_CONTENT_MODES.NSFW : contentMode }).catch(() => {});
    }
  };

  const handleSelectChapterByIndex = (chapterIndex) => {
    const chapter = chapters.find((item) => Number(item.index) === Number(chapterIndex));
    if (chapter) selectChapter(chapter.id);
  };

  const handleBuildCanonPack = () => {
    buildCanonPack({ contentMode: adultModeAllowed ? PROJECT_CONTENT_MODES.NSFW : contentMode }).catch(() => {});
  };

  const handleLinkCanonPackToProject = (canonPackId) => {
    if (!canonPackId || !currentProject?.id) return;
    const currentMode = currentProject.project_mode;
    updateProjectSettings({
      source_canon_pack_id: canonPackId,
      project_mode: ['fanfic', 'rewrite', 'translation_context'].includes(currentMode) ? currentMode : 'fanfic',
      canon_adherence_level: currentProject.canon_adherence_level || 'balanced',
    }).catch(() => {});
  };

  const handleOpenEditor = () => {
    if (currentProject?.id) navigate(`/project/${currentProject.id}/editor`);
  };

  const handleCreateFanficProject = async () => {
    if (!latestPack) return;
    try {
      const id = await createProject({
        title: `${latestPack.metadata?.sourceTitle || latestPack.title || 'Canon'} - đồng nhân`,
        description: 'Dự án đồng nhân được tạo từ Lab Lite Canon Pack.',
        genre_primary: 'fantasy',
        project_mode: PROJECT_MODES.FANFIC,
        source_canon_pack_id: latestPack.id,
        canon_adherence_level: 'balanced',
        skipFirstChapter: true,
      });
      navigate(`/project/${id}/editor`);
    } catch (error) {
      console.error('Failed to create fanfic project from Canon Pack:', error);
    }
  };

  const handleCreateMaterializationPlan = (canonPackId) => {
    createMaterializationPlan({ canonPackId, projectId: currentProject?.id }).catch(() => {});
  };

  const handleCreateMergePlan = (baseCanonPackId, incomingCanonPackId) => {
    createCanonPackMergePlan({ baseCanonPackId, incomingCanonPackId }).catch(() => {});
  };

  const handleApplyMergePlan = (mergePlanId, selectedActionIds) => {
    applyCanonPackMergePlan({ mergePlanId, selectedActionIds }).catch(() => {});
  };

  const handleRunWorkflowAction = (action) => {
    setActiveTab(action.step);
    if (action.action === 'runScoutMissing') handleRunScout(scoutState.goal || 'story_bible', scoutState.concurrency || 2);
    else if (action.action === 'retryScoutFailures') retryScoutFailures().catch(() => {});
    else if (action.action === 'runArcMapper') handleRunArcMapper();
    else if (action.action === 'applyDeepPlanner') handleApplyDeepPlanner();
    else if (action.action === 'runDeepAnalysis') handleRunDeepAnalysis();
    else if (action.action === 'buildCanonPack') handleBuildCanonPack();
    else if (action.action === 'runDeepMissing') handleRunDeepMissing();
    else if (action.action === 'openEditor') handleOpenEditor();
    else if (action.action === 'useCanonPack' && latestPack?.id && currentProject?.id) handleLinkCanonPackToProject(latestPack.id);
  };

  return (
    <div className="lab-lite-page">
      <LabLiteHero currentCorpus={currentCorpus} chapters={chapters} scoutPlan={scoutPlan} />

      {loading ? <div className="lab-lite-loading"><Loader2 className="spin" size={18} /> Đang tải Lab Lite...</div> : null}
      {error ? <p className="lab-lite-error">{error}</p> : null}

      <GuidedWorkspaceRail
        activeStep={activeTab}
        stepStatuses={stepStatuses}
        nextAction={nextAction}
        onStepChange={setActiveTab}
        onRunAction={handleRunWorkflowAction}
      />

      <div className={`lab-lite-grid lab-lite-grid--${activeTab}`}>
        <aside className="lab-lite-left">
          {activeTab === 'import' ? (
            <UploadPanel
              importState={importState}
              currentCorpus={currentCorpus}
              presetRunState={presetRunState}
              ingestType={ingestType}
              onIngestTypeChange={setIngestType}
              analysisMode={analysisMode}
              onAnalysisModeChange={setAnalysisMode}
              allowAdultIngest={allowAdultIngest}
              onAllowAdultIngestChange={setAllowAdultIngest}
              adultModeAllowed={adultModeAllowed}
              onImport={handleImport}
            />
          ) : null}
          <CorpusLibrary
            corpuses={corpuses}
            currentCorpusId={currentCorpusId}
            onSelect={selectCorpus}
            onDelete={handleDeleteCorpus}
            onRename={(corpusId, title) => renameCorpus(corpusId, title).catch(() => {})}
            isProjectScoped={Boolean(activeLabLiteProjectId)}
          />
          {activeTab === 'import' ? <IngestBatchPanel ingestBatches={ingestBatches} /> : null}
          {activeTab === 'import' && currentCorpus ? <ParseDiagnostics corpus={currentCorpus} /> : null}
          {currentCorpus ? (
            <CoveragePanel
              coverageSummary={coverageSummary}
              activeFilter={coverageFilter}
              onFilterChange={setCoverageFilter}
              onRunMissing={() => handleRunScout(scoutState.goal || 'story_bible', scoutState.concurrency || 2)}
              onRetryFailures={() => retryScoutFailures().catch(() => {})}
              onRunDeepMissing={handleRunDeepMissing}
            />
          ) : null}
          {activeTab === 'deep' ? (
            <DeepAnalysisPanel
              chapters={chapters}
              arcs={arcs}
              deepPlan={deepPlan}
              deepPreset={deepPreset}
              onDeepPresetChange={setDeepPreset}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onRangeStartChange={setRangeStart}
              onRangeEndChange={setRangeEnd}
              characterName={characterName}
              onCharacterNameChange={setCharacterName}
              selectedDeepChapterIndexes={selectedDeepChapterIndexes}
              selectedArcIds={selectedArcIds}
              deepState={deepState}
              deepAnalysisItems={deepAnalysisItems}
              onToggleChapter={toggleDeepChapterSelection}
              onSelectRecommended={handleApplyDeepPlanner}
              onSelectMissingDigest={handleSelectMissingDigest}
              onToggleArc={toggleArcSelection}
              onRun={handleRunDeepAnalysis}
              onCancel={cancelDeepAnalysis}
            />
          ) : null}
          {activeTab === 'canon-pack' ? (
            <CanonPackPanel
              canonPackState={canonPackState}
              canonPacks={canonPacks}
              canonPackMergePlans={canonPackMergePlans}
              currentProject={currentProject}
              readiness={readiness}
              writeTargets={writeTargets}
              allowAdultCanon={adultModeAllowed}
              onBuild={handleBuildCanonPack}
              onLinkToProject={handleLinkCanonPackToProject}
              onOpenEditor={handleOpenEditor}
              onCreateFanficProject={handleCreateFanficProject}
              onCreateMergePlan={handleCreateMergePlan}
              onApplyMergePlan={handleApplyMergePlan}
            />
          ) : null}
          {activeTab === 'materialize' ? (
            <MaterializePanel
              currentProject={currentProject}
              canonPacks={canonPacks}
              materializationPlan={materializationPlan}
              materializeState={materializeState}
              onPlan={handleCreateMaterializationPlan}
              onApply={(selectedActionIds) => applyMaterialization({ selectedActionIds }).catch(() => {})}
            />
          ) : null}
        </aside>

        <main className="lab-lite-main">
          {activeTab === 'canon-pack' || activeTab === 'materialize' ? null : (
            <>
              <ChapterPanel
                chapters={chapters}
                currentChapterId={currentChapter?.id}
                scoutResults={activeScoutResults}
                chapterCoverage={chapterCoverage}
                filter={scoutFilter}
                coverageFilter={coverageFilter}
                onCoverageFilterChange={setCoverageFilter}
                onSelect={selectChapter}
              />
              <ChapterDetail
                chapter={currentChapter}
                corpus={currentCorpus}
                hasPrevious={currentChapterPosition > 0}
                hasNext={currentChapterPosition >= 0 && currentChapterPosition < chapters.length - 1}
                onPrevious={() => {
                  if (currentChapterPosition > 0) selectChapter(chapters[currentChapterPosition - 1].id);
                }}
                onNext={() => {
                  if (currentChapterPosition >= 0 && currentChapterPosition < chapters.length - 1) selectChapter(chapters[currentChapterPosition + 1].id);
                }}
                onRename={renameChapter}
                onSplit={splitChapter}
              />
            </>
          )}
        </main>

        <aside className="lab-lite-right">
          {activeTab === 'scout' || activeTab === 'import' ? (
            <>
              <ScoutPanel
                scoutState={scoutState}
                scoutResults={activeScoutResults}
                filter={scoutFilter}
                onFilterChange={setScoutFilter}
                onRun={handleRunScout}
                onPause={pauseScout}
                onCancel={cancelScout}
                onRetry={() => retryScoutFailures().catch(() => {})}
                onSelectChapter={handleSelectChapterByIndex}
                onToggleDeepChapter={toggleDeepChapterSelection}
              />
              <ArcPanel
                arcState={arcState}
                arcs={arcs}
                selectedArcIds={selectedArcIds}
                onRun={handleRunArcMapper}
                onCancel={cancelArcMapper}
                onSelect={selectArc}
                onToggle={toggleArcSelection}
              />
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
