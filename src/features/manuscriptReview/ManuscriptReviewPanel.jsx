import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import { OPENAI_PROXY_SETTINGS_CHANGED_EVENT } from '../../services/ai/openAIProxyConfig.js';
import { buildReviewContract } from './contract.js';
import { MODE_LABELS, REVIEW_MODES } from './constants.js';
import { getManuscriptReviewModelState, REVIEW_MODEL_CHANGE_EVENT, saveManuscriptReviewModelPreference } from './modelRouting.js';
import { captureReviewContext, createManuscriptSnapshot, findEvidenceInEditor, getManuscriptSceneParagraphs, hashReviewValue, stableReviewJson } from './snapshot.js';
import { loadReviewReports } from './repository.js';
import useManuscriptReviewRunStore, { getManuscriptReviewTargetKey } from './runStore.js';
import { startManuscriptReview } from './service.js';
import ManuscriptReviewModelDialog from './ManuscriptReviewModelDialog.jsx';
import ReviewReport from './ReviewReport.jsx';
import ReviewSelect from './ReviewSelect.jsx';
import './ManuscriptReview.css';

// Operate: extend the existing Editor; evidence and author intent lead, not a dashboard score.
export default function ManuscriptReviewPanel({ editor, project, scene, chapter, active, mobileOpen = false, onBack, onClose, onNavigateEvidence }) {
  const id = useId();
  const [scope, setScope] = useState(() => editor?.state.selection.empty === false ? 'selection' : 'scene');
  const [mode, setMode] = useState('all');
  const [authorRequest, setAuthorRequest] = useState('');
  const [modelState, setModelState] = useState(getManuscriptReviewModelState);
  const [dialog, setDialog] = useState(null);
  const [reports, setReports] = useState([]);
  const [stale, setStale] = useState({});
  const [contractStale, setContractStale] = useState({});
  const [error, setError] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState('');
  const alive = useRef(true);
  const notesTouched = useRef(false);
  const revision = useRef(0);
  const heading = useRef(null);
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const panelRef = useModalAccessibility({ open: mobileOpen && active, onClose });
  const context = useMemo(() => captureReviewContext({ project, scene, chapter }), [project, scene, chapter]);
  const contextKey = stableReviewJson(context);
  const backgroundRun = useManuscriptReviewRunStore((state) => state.run);
  const startBackgroundRun = useManuscriptReviewRunStore((state) => state.start);
  const cancelBackgroundRun = useManuscriptReviewRunStore((state) => state.cancel);
  const targetKey = getManuscriptReviewTargetKey({ projectId: project?.id, sceneId: scene?.id, scope });
  const matchingRun = backgroundRun?.targetKey === targetKey ? backgroundRun : null;
  const busy = backgroundRun?.status === 'running';
  const progress = matchingRun?.progress || {};
  const runningElsewhere = busy && !matchingRun;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, [editor, project?.id, scene?.id]);

  useEffect(() => {
    if (active && !mobileOpen) heading.current?.focus({ preventScroll: true });
  }, [active, mobileOpen]);

  useEffect(() => {
    const refresh = () => setModelState(getManuscriptReviewModelState());
    const events = ['focus', 'storage', REVIEW_MODEL_CHANGE_EVENT, OPENAI_PROXY_SETTINGS_CHANGED_EVENT];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => events.forEach((event) => window.removeEventListener(event, refresh));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReports([]); setStale({}); setContractStale({}); setError('');
    loadReviewReports({ projectId: project?.id, sceneId: scene?.id, scope }).then((rows) => {
      if (cancelled) return;
      setReports(rows);
      setStale(Object.fromEntries(rows.map((report) => [report.id, true])));
      setContractStale(Object.fromEntries(rows.map((report) => [report.id, true])));
      if (!notesTouched.current && rows.length) setAuthorRequest([...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].author_request || '');
    }).catch(() => { if (!cancelled) setError('Không đọc được báo cáo đã lưu. Hãy thử mở lại panel.'); });
    return () => { cancelled = true; };
  }, [project?.id, scene?.id, scope]);

  useEffect(() => {
    if (!matchingRun?.reports.length) return;
    setReports((current) => matchingRun.reports.reduce(
      (next, report) => [...next.filter((item) => item.mode !== report.mode), report],
      current,
    ));
  }, [matchingRun?.reports]);

  useEffect(() => {
    if (!editor) return;
    const changed = ({ transaction }) => {
      if (!transaction.docChanged) return;
      revision.current++;
      // O(1) per keystroke apart from at most three report IDs; no text extraction or hash here.
      setStale((current) => reportsRef.current.every((report) => current[report.id])
        ? current : Object.fromEntries(reportsRef.current.map((report) => [report.id, true])));
    };
    editor.on('transaction', changed);
    return () => editor.off('transaction', changed);
  }, [editor]);

  useEffect(() => {
    if (!reports.length || !editor) return;
    let cancelled = false;
    const atRevision = revision.current;
    (async () => {
      const source = await hashReviewValue(getManuscriptSceneParagraphs(editor));
      if (!cancelled) setStale(Object.fromEntries(reports.map((report) => [report.id,
        atRevision !== revision.current || source !== report.scene_signature])));
    })().catch(() => { if (!cancelled) setStale(Object.fromEntries(reports.map((report) => [report.id, true]))); });
    return () => { cancelled = true; };
  }, [reports, editor]);

  useEffect(() => {
    if (!reports.length) return;
    let cancelled = false;
    hashReviewValue(buildReviewContract({ ...JSON.parse(contextKey), authorRequest })).then((signature) => {
      if (!cancelled) setContractStale(Object.fromEntries(reports.map((report) => [report.id, signature !== report.config_signature])));
    }).catch(() => { if (!cancelled) setContractStale(Object.fromEntries(reports.map((report) => [report.id, true]))); });
    return () => { cancelled = true; };
  }, [reports, contextKey, authorRequest]);

  const run = (snapshot, selectedModes, state) => {
    setError('');
    try {
      startBackgroundRun({
        execute: startManuscriptReview,
        snapshot,
        modes: selectedModes,
        authorRequest,
        route: { provider: state.provider, model: state.routeOptions.modelOverride, proxyProfileId: state.proxyProfileId },
        onProgress: (event) => {
          if (!alive.current || !event.report) return;
          setStale((current) => ({ ...current, [event.report.id]: editor.state.doc !== snapshot.document }));
        },
      });
    } catch (issue) { setError(issue.message); }
  };

  const requestRun = (selectedModes = mode === 'all' ? REVIEW_MODES : [mode]) => {
    if (busy) return;
    try {
      const snapshot = createManuscriptSnapshot(editor, { scope, project, scene, chapter });
      const state = getManuscriptReviewModelState(); setModelState(state); setError('');
      if (state.shouldPrompt) setDialog({ state, snapshot, modes: selectedModes });
      else run(snapshot, selectedModes, state);
    } catch (issue) { setError(issue.message); }
  };

  const confirmModel = (selected) => {
    const state = getManuscriptReviewModelState();
    if (state.scopeKey !== dialog.state.scopeKey) throw new Error('Provider/profile đã đổi. Đóng hộp thoại và chọn lại model.');
    if (!state.options.some((item) => item.id === (selected || state.currentModel))) throw new Error('Model không còn trong danh sách. Hãy chọn lại.');
    if (dialog.snapshot && editor.state.doc !== dialog.snapshot.document) throw new Error('Bản thảo đã đổi khi đang chọn model. Hủy rồi bấm phân tích lại để chụp nội dung mới.');
    saveManuscriptReviewModelPreference({ ...state, model: selected });
    const next = getManuscriptReviewModelState(); setModelState(next); setDialog(null);
    if (dialog.snapshot) run(dialog.snapshot, dialog.modes, next);
  };

  const navigateEvidence = async (evidence, sceneSignature) => {
    let range;
    try { range = await findEvidenceInEditor(editor, evidence, { sceneSignature }); }
    catch { range = null; }
    if (!alive.current || editor.isDestroyed) return;
    if (!range) { setError('Bằng chứng đã đổi hoặc không còn duy nhất. Hãy phân tích lại; không nhảy tới đoạn phỏng đoán.'); return; }
    setSelectedEvidence(`${evidence.paragraph_id}:${evidence.quote}`); setError('');
    editor.commands.setTextSelection({ from: range.from, to: range.to });
    onNavigateEvidence?.();
    // The mobile sheet needs to become non-inert before the editor receives focus.
    requestAnimationFrame(() => {
      if (!alive.current || editor.isDestroyed) return;
      editor.commands.focus(undefined, { scrollIntoView: false }); editor.commands.scrollIntoView();
    });
  };

  const priorities = useMemo(() => {
    const seen = new Set();
    return reports.flatMap((report) => stale[report.id] || contractStale[report.id] || report.author_request !== authorRequest
      ? [] : report.result.findings.map((finding) => ({ ...finding, sceneSignature: report.scene_signature }))).sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))
      .filter((finding) => { const key = `${finding.suggestion}:${finding.evidence[0]?.quote}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
  }, [reports, stale, contractStale, authorRequest]);

  return <section ref={panelRef} className="manuscript-review" role={mobileOpen ? 'dialog' : 'region'} aria-modal={mobileOpen ? true : undefined} aria-labelledby={`${id}-title`}>
    <header className="manuscript-review-header">
      <div className="manuscript-review-row">
        <button type="button" className="btn btn-ghost" onClick={onBack}><ArrowLeft size={16} /> {mobileOpen ? 'Bản thảo' : 'Trợ lý'}</button>
        {matchingRun?.status === 'running' && <span className="manuscript-review-running">Đang chạy nền</span>}
        {mobileOpen && <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Đóng phân tích bản thảo"><X size={18} /></button>}
      </div>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>Phân tích bản thảo</h2>
      <p className="manuscript-review-hint">Đánh giá tham khảo · Không tự sửa bản thảo</p>
    </header>
    <div className="manuscript-review-scroll">
      <div className="manuscript-review-model">
        <p>{modelState.providerLabel} · {modelState.routeOptions.modelOverride || 'Chưa chọn model'}</p>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDialog({ state: getManuscriptReviewModelState() })}>Đổi model</button>
      </div>
      <form className="manuscript-review-form" onSubmit={(event) => { event.preventDefault(); requestRun(); }}>
        <div className="manuscript-review-fields">
          <div className="manuscript-review-field">
            <label htmlFor={`${id}-scope`}>Phạm vi</label>
            <ReviewSelect id={`${id}-scope`} label="Phạm vi phân tích" value={scope} disabled={busy} onChange={setScope}
              options={[{ value: 'selection', label: 'Đoạn đang chọn' }, { value: 'scene', label: 'Cảnh hiện tại' }]} />
          </div>
          <div className="manuscript-review-field">
            <label htmlFor={`${id}-mode`}>Nội dung đánh giá</label>
            <ReviewSelect id={`${id}-mode`} label="Phần phân tích" value={mode} disabled={busy} onChange={setMode}
              options={[{ value: 'all', label: 'Toàn diện — cả ba phần' }, ...REVIEW_MODES.map((value) => ({ value, label: MODE_LABELS[value] }))]} />
          </div>
        </div>
        <label className="manuscript-review-field" htmlFor={`${id}-notes`}>
          <span>Lưu ý khi đánh giá <span className="manuscript-review-hint">(tùy chọn)</span></span>
          <textarea id={`${id}-notes`} className="textarea" rows={3} maxLength={6000} value={authorRequest} disabled={busy} onChange={(event) => { notesTouched.current = true; setAuthorRequest(event.target.value); }} placeholder="Ví dụ: Đây là cảnh nghỉ, giữ giọng kể chậm và kín đáo." />
        </label>
        <p className="manuscript-review-hint">{mode === 'all' ? 'Ba request chạy tuần tự, có thể tốn nhiều token hơn chạy riêng. ' : 'Một request cho phần đã chọn. '}Nội dung và ngữ cảnh đánh giá sẽ gửi tới model hiển thị ở trên.</p>
        {modelState.provider === 'ollama' && <p className="manuscript-review-notice">Ollama dùng tài nguyên máy của Anh Đạt; có thể chậm trên thiết bị yếu.</p>}
        <div className="manuscript-review-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !editor || !scene}>{mode === 'all' ? 'Phân tích toàn diện' : 'Chạy phân tích'}</button>
          {matchingRun?.status === 'running' && <button type="button" className="btn btn-ghost" onClick={cancelBackgroundRun}>Hủy phân tích</button>}
        </div>
      </form>
      <div role="status" aria-live="polite" aria-atomic="true" className="manuscript-review-progress">
        {REVIEW_MODES.filter((value) => progress[value]).map((value) => <p key={value}>{MODE_LABELS[value]}: {({ queued: 'Đang chờ', running: 'Đang phân tích…', complete: 'Đã lưu', error: 'Chưa hoàn tất', cancelled: 'Đã hủy' })[progress[value].status]}{progress[value].status === 'running' ? ` · khoảng ${progress[value].inputTokens.toLocaleString('vi-VN')} token đầu vào (ước lượng)` : ''}</p>)}
      </div>
      {runningElsewhere && <p role="status" className="manuscript-review-notice">Một lượt phân tích khác đang chạy nền. Có thể quay lại cảnh đã chạy để xem tiến trình hoặc hủy.</p>}
      {(error || matchingRun?.error) && <p role="alert" className="manuscript-review-notice">{error || matchingRun.error}</p>}
      {REVIEW_MODES.filter((value) => progress[value]?.error).map((value) => <div key={value} className="manuscript-review-notice">
        <p>{MODE_LABELS[value]}: {progress[value].error}</p><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => requestRun([value])}>Thử lại {MODE_LABELS[value]}</button>
      </div>)}
      {!!priorities.length && <section className="manuscript-review-priorities"><h3>Ưu tiên cân nhắc</h3><ol>{priorities.map((finding, index) => <li key={index}>{finding.suggestion}<button type="button" className="manuscript-review-evidence" onClick={() => navigateEvidence(finding.evidence[0], finding.sceneSignature)}>Xem bằng chứng: {finding.evidence[0].quote.slice(0, 220)}</button></li>)}</ol></section>}
      {REVIEW_MODES.map((value) => reports.find((report) => report.mode === value)).filter(Boolean).map((report) => <ReviewReport key={report.id} report={report} stale={stale[report.id] || contractStale[report.id] || report.author_request !== authorRequest} onEvidence={(evidence) => navigateEvidence(evidence, report.scene_signature)} selectedEvidence={selectedEvidence} busy={busy} onRetry={(value) => requestRun([value])} />)}
      {!reports.length && !busy && <p className="manuscript-review-empty">Chọn một đoạn hoặc cảnh để bắt đầu. Mỗi phần chỉ giữ báo cáo thành công gần nhất; phân tích không xác định ai là tác giả.</p>}
    </div>
    <ManuscriptReviewModelDialog modelState={dialog?.state} onCancel={() => setDialog(null)} onConfirm={confirmModel} confirmLabel={dialog?.snapshot ? 'Xác nhận và phân tích' : 'Lưu model'} />
  </section>;
}
