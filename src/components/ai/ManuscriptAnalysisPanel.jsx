import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileSearch,
  Loader2,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { analyzeWithLocalWorker } from '../../services/revisionQa/workerClient.js';
import { analyzeCanonForSources } from '../../services/revisionQa/canonAdapter.js';
import {
  loadLatestAnalysisRun,
  saveLatestAnalysisRun,
  updateFindingStatus,
} from '../../services/revisionQa/reportRepository.js';
import { computePhraseConfigSignature } from '../../services/revisionQa/localAnalysis.js';
import { createEditorAnalysisSource, buildProseMirrorTextMap, textRangeToProseMirror } from '../../services/revisionQa/editorSnapshot.js';
import { htmlToPlainText, resolveFindingAnchor } from '../../services/revisionQa/sourceSnapshot.js';
import './ManuscriptAnalysisPanel.css';

const SCOPES = [
  { id: 'selection', label: 'Đoạn đã chọn' },
  { id: 'scene', label: 'Cảnh hiện tại' },
  { id: 'chapter', label: 'Chương hiện tại' },
];

const PROFILES = [
  { id: 'overview', label: 'Tổng hợp' },
  { id: 'style', label: 'Văn phong' },
  { id: 'pacing', label: 'Nhịp truyện' },
  { id: 'dialogue', label: 'Đối thoại' },
  { id: 'canon', label: 'Logic / Canon' },
  { id: 'repetition', label: 'Lặp và sáo' },
];

const SEVERITY_LABELS = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };
const CATEGORY_LABELS = {
  format: 'Định dạng', style: 'Văn phong', pacing: 'Nhịp', dialogue: 'Đối thoại',
  canon: 'Canon', repetition: 'Lặp', cliche: 'Cụm sáo',
};

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePhraseList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(/[\n,;]+/u).map((item) => item.trim()).filter(Boolean);
}

function getPhraseConfig(project) {
  const promptTemplates = parseJsonObject(project?.prompt_templates);
  const localConfig = parseJsonObject(project?.local_qa_config);
  return {
    blacklist: normalizePhraseList(promptTemplates.anti_ai_blacklist),
    whitelist: normalizePhraseList(localConfig.whitelist),
  };
}

function sceneText(scene) {
  return htmlToPlainText(scene?.draft_text || scene?.final_text || '');
}

function scopeKey(scope, sceneId, chapterId) {
  return scope === 'chapter' ? `chapter:${chapterId}` : `${scope}:${sceneId}`;
}

function sourcesForScope({ scope, editor, projectId, chapterId, sceneId, scenes }) {
  if (!editor || !projectId || !chapterId || !sceneId) return [];
  if (scope === 'selection') {
    return [createEditorAnalysisSource(editor, { projectId, chapterId, sceneId, selection: true })];
  }
  if (scope === 'scene') {
    return [createEditorAnalysisSource(editor, { projectId, chapterId, sceneId })];
  }
  return scenes
    .filter((scene) => scene.chapter_id === chapterId)
    .slice()
    .sort((left, right) => (left.order_index || 0) - (right.order_index || 0))
    .map((scene) => (
      scene.id === sceneId
        ? createEditorAnalysisSource(editor, { projectId, chapterId, sceneId })
        : {
            projectId,
            chapterId,
            sceneId: scene.id,
            text: sceneText(scene),
            sourceText: sceneText(scene),
            offsetBase: 0,
          }
    ));
}

function findingCurrentText(finding, activeSceneId, activeEditorText, scenes) {
  if (finding.scene_id === activeSceneId) return activeEditorText;
  return sceneText(scenes.find((scene) => scene.id === finding.scene_id));
}

export default function ManuscriptAnalysisPanel({
  editor,
  currentProject,
  scenes = [],
  activeSceneId,
  activeChapterId,
  onBack,
  onSetActiveScene,
  onUpdateProjectSettings,
  onFindingNavigate,
}) {
  const hasSelection = Boolean(editor && !editor.state.selection.empty);
  const [scope, setScope] = useState(hasSelection ? 'selection' : 'scene');
  const [profile, setProfile] = useState('overview');
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState(null);
  const [replacementDrafts, setReplacementDrafts] = useState({});
  const [selectedFindingId, setSelectedFindingId] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const phraseConfig = useMemo(() => getPhraseConfig(currentProject), [currentProject]);
  const [whitelistDraft, setWhitelistDraft] = useState(phraseConfig.whitelist.join('\n'));
  const [currentConfigSignature, setCurrentConfigSignature] = useState('');
  const backButtonRef = useRef(null);
  const currentScopeKey = scopeKey(scope, activeSceneId, activeChapterId);

  useEffect(() => {
    setWhitelistDraft(phraseConfig.whitelist.join('\n'));
    computePhraseConfigSignature(phraseConfig).then(setCurrentConfigSignature).catch(() => setCurrentConfigSignature(''));
  }, [phraseConfig]);

  useEffect(() => {
    let cancelled = false;
    if (!currentProject?.id || !currentScopeKey) return undefined;
    loadLatestAnalysisRun({ projectId: currentProject.id, scopeKey: currentScopeKey })
      .then((saved) => {
        if (!cancelled) setReport(saved);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      });
    return () => { cancelled = true; };
  }, [currentProject?.id, currentScopeKey]);

  useEffect(() => () => editor?.commands?.clearAnalysisHighlight?.(), [editor]);

  const configChanged = Boolean(report?.config_signature && currentConfigSignature && report.config_signature !== currentConfigSignature);
  const findings = report?.findings || [];
  const needsActiveEditorText = findings.some((finding) => (
    finding.scene_id === activeSceneId && finding.status === 'open' && finding.replacement
  ));
  const activeEditorText = needsActiveEditorText && editor
    ? buildProseMirrorTextMap(editor.state.doc).text
    : '';

  const updateLocalFinding = (findingId, patch) => {
    setReport((current) => current ? {
      ...current,
      findings: current.findings.map((finding) => finding.id === findingId ? { ...finding, ...patch } : finding),
    } : current);
  };

  const markStale = async (finding) => {
    updateLocalFinding(finding.id, { status: 'stale' });
    await updateFindingStatus({ findingId: finding.id, status: 'stale' });
  };

  const isAnchorValid = (finding) => {
    if (finding.status === 'stale' || configChanged) return false;
    return Boolean(resolveFindingAnchor(findingCurrentText(finding, activeSceneId, activeEditorText, scenes), finding.anchor));
  };

  const highlightFinding = (finding) => {
    setSelectedFindingId(finding.id);
    if (finding.scene_id !== activeSceneId) {
      onSetActiveScene?.(finding.scene_id);
      onFindingNavigate?.(finding);
      return;
    }
    const map = buildProseMirrorTextMap(editor.state.doc);
    const range = resolveFindingAnchor(map.text, finding.anchor);
    if (!range) {
      void markStale(finding);
      return;
    }
    const pmRange = textRangeToProseMirror(map, range.from, range.to);
    if (!pmRange) {
      void markStale(finding);
      return;
    }
    editor.commands?.setAnalysisHighlight?.(pmRange);
    editor.chain?.().focus().setTextSelection(pmRange).scrollIntoView().run();
    onFindingNavigate?.(finding);
  };

  useEffect(() => {
    const finding = findings.find((item) => item.id === selectedFindingId && item.scene_id === activeSceneId);
    if (!finding || !editor) return;
    const frame = requestAnimationFrame(() => highlightFinding(finding));
    return () => cancelAnimationFrame(frame);
    // Re-run only after scene navigation; highlightFinding intentionally reads the fresh editor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId, editor]);

  const runAnalysis = async () => {
    if (scope === 'selection' && !hasSelection) {
      setError('Vùng chọn không còn tồn tại. Hãy bôi đen đoạn cần phân tích hoặc đổi phạm vi.');
      return;
    }
    const sources = sourcesForScope({
      scope,
      editor,
      projectId: currentProject?.id,
      chapterId: activeChapterId,
      sceneId: activeSceneId,
      scenes,
    });
    if (!sources.some((source) => source.text.trim())) {
      setError('Phạm vi này chưa có nội dung để phân tích.');
      return;
    }
    setStatus('running');
    setError('');
    try {
      const runId = globalThis.crypto.randomUUID();
      const localResult = await analyzeWithLocalWorker({ sources, scope, profile, phraseConfig, runId });
      const canonFindings = ['overview', 'canon'].includes(profile)
        ? await analyzeCanonForSources({
            projectId: currentProject.id,
            chapterId: activeChapterId,
            sources,
            scenes,
            runId,
            configSignature: localResult.config_signature,
          })
        : [];
      const nextReport = {
        ...localResult,
        scope_key: currentScopeKey,
        source_signatures: localResult.sourceSignatures,
        findings: [...localResult.findings, ...canonFindings],
        created_at: Date.now(),
      };
      await saveLatestAnalysisRun({ projectId: currentProject.id, chapterId: activeChapterId, run: nextReport });
      setReport(nextReport);
      setStatus('complete');
      setReviewingId(null);
      setReplacementDrafts({});
    } catch (analysisError) {
      setError(analysisError?.message || 'Worker phân tích gặp lỗi. Báo cáo cũ vẫn được giữ nguyên.');
      setStatus('error');
    }
  };

  const ignoreFinding = async (finding) => {
    await updateFindingStatus({ findingId: finding.id, status: 'ignored' });
    updateLocalFinding(finding.id, { status: 'ignored' });
  };

  const acceptFinding = async (finding) => {
    if (!finding.replacement || configChanged || finding.scene_id !== activeSceneId || !editor) return;
    const map = buildProseMirrorTextMap(editor.state.doc);
    const range = resolveFindingAnchor(map.text, finding.anchor);
    if (!range) {
      await markStale(finding);
      return;
    }
    const pmRange = textRangeToProseMirror(map, range.from, range.to);
    if (!pmRange) {
      await markStale(finding);
      return;
    }
    const replacementText = replacementDrafts[finding.id] ?? finding.replacement.text;
    editor.chain().focus().insertContentAt(pmRange, replacementText).run();
    await updateFindingStatus({ findingId: finding.id, status: 'accepted' });
    updateLocalFinding(finding.id, { status: 'accepted' });
    setReviewingId(null);

    const updatedText = buildProseMirrorTextMap(editor.state.doc).text;
    const remaining = findings.filter((item) => item.id !== finding.id && item.scene_id === activeSceneId && item.status === 'open');
    for (const item of remaining) {
      if (!resolveFindingAnchor(updatedText, item.anchor)) await markStale(item);
    }
    editor.commands?.clearAnalysisHighlight?.();
  };

  const saveWhitelist = async () => {
    const whitelist = normalizePhraseList(whitelistDraft);
    await onUpdateProjectSettings?.({ local_qa_config: JSON.stringify({ version: 1, whitelist }) });
    setShowConfig(false);
  };

  const severityCounts = findings.reduce((counts, finding) => {
    if (finding.status === 'open' || finding.status === 'stale') counts[finding.severity] += 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });

  return (
    <section className="revision-qa-panel" aria-label="Phân tích bản thảo">
      <header className="revision-qa-header">
        <button ref={backButtonRef} type="button" className="revision-qa-back" onClick={onBack} aria-label="Quay lại Trợ lý">
          <ArrowLeft size={16} />
        </button>
        <div className="revision-qa-heading">
          <h2>Phân tích bản thảo</h2>
          <div className="revision-qa-privacy"><ShieldCheck size={12} /> Local · Không gửi dữ liệu</div>
        </div>
        <button type="button" className="revision-qa-config-button" onClick={() => setShowConfig((value) => !value)} aria-expanded={showConfig} aria-label="Cấu hình phân tích">
          <SlidersHorizontal size={15} />
        </button>
      </header>

      {showConfig && (
        <div className="revision-qa-config">
          <label htmlFor="revision-qa-whitelist">Whitelist cụm từ <span>Mỗi dòng một cụm</span></label>
          <textarea id="revision-qa-whitelist" rows={4} value={whitelistDraft} onChange={(event) => setWhitelistDraft(event.target.value)} />
          <div className="revision-qa-config-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowConfig(false)}>Huỷ</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveWhitelist}>Lưu cấu hình</button>
          </div>
        </div>
      )}

      <div className="revision-qa-controls">
        <label>
          <span>Phạm vi</span>
          <select aria-label="Phạm vi phân tích" value={scope} onChange={(event) => setScope(event.target.value)}>
            {SCOPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Profile</span>
          <select aria-label="Profile phân tích" value={profile} onChange={(event) => setProfile(event.target.value)}>
            {PROFILES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary revision-qa-run" onClick={runAnalysis} disabled={status === 'running'}>
          {status === 'running' ? <Loader2 size={14} className="spin" /> : <FileSearch size={14} />}
          {status === 'running' ? 'Đang phân tích…' : 'Phân tích'}
        </button>
      </div>

      <div className="revision-qa-live" aria-live="polite">
        {error && <div className="revision-qa-message revision-qa-message--error">{error} <button type="button" onClick={runAnalysis}><RotateCcw size={12} /> Thử lại</button></div>}
        {configChanged && <div className="revision-qa-message">Cấu hình cụm từ đã đổi. Hãy phân tích lại trước khi áp dụng sửa.</div>}
      </div>

      {report ? (
        <div className="revision-qa-results">
          <div className="revision-qa-summary" aria-label="Tóm tắt kết quả">
            <div className="revision-qa-severity-counts">
              <span className="is-high"><strong>{severityCounts.high}</strong> Cao</span>
              <span className="is-medium"><strong>{severityCounts.medium}</strong> Vừa</span>
              <span className="is-low"><strong>{severityCounts.low}</strong> Thấp</span>
            </div>
            <div className="revision-qa-metrics">
              <span>{report.metrics?.words || 0} từ</span>
              <span>{report.metrics?.sentences || 0} câu</span>
              <span>{report.metrics?.paragraphs || 0} đoạn</span>
            </div>
          </div>

          {findings.length === 0 ? (
            <div className="revision-qa-empty"><Check size={20} /><strong>Không có tín hiệu cần lưu ý</strong><span>Đây không phải điểm số chất lượng; chỉ là kết quả của bộ rule local hiện tại.</span></div>
          ) : (
            <div className="revision-qa-findings">
              {findings.map((finding) => {
                const canAccept = Boolean(finding.replacement) && finding.status === 'open' && isAnchorValid(finding) && !configChanged;
                const isReviewing = reviewingId === finding.id;
                return (
                  <article key={finding.id} className={`revision-qa-finding is-${finding.severity} ${selectedFindingId === finding.id ? 'is-selected' : ''} is-${finding.status}`}>
                    <button type="button" className="revision-qa-finding-main" onClick={() => highlightFinding(finding)}>
                      <span className="revision-qa-finding-meta">
                        <span>{SEVERITY_LABELS[finding.severity]}</span>
                        <span>{CATEGORY_LABELS[finding.category] || finding.category}</span>
                        <span>{Math.round(finding.confidence * 100)}% tin cậy</span>
                        <span>Local</span>
                      </span>
                      <q>{finding.evidence}</q>
                      <span className="revision-qa-explanation">{finding.explanation}</span>
                      <ChevronRight size={15} className="revision-qa-finding-chevron" />
                    </button>

                    {finding.status === 'stale' && <div className="revision-qa-stale">Đoạn đích đã đổi — cần phân tích lại.</div>}
                    {finding.status === 'ignored' && <div className="revision-qa-resolved">Đã bỏ qua occurrence này.</div>}
                    {finding.status === 'accepted' && <div className="revision-qa-resolved">Đã áp dụng sửa.</div>}

                    {isReviewing && canAccept && (
                      <div className="revision-qa-diff">
                        <div><span>Trước</span><del>{finding.evidence}</del></div>
                        <div><span>Sau</span><input aria-label="Câu thay thế" value={replacementDrafts[finding.id] ?? finding.replacement.text} onChange={(event) => setReplacementDrafts((drafts) => ({ ...drafts, [finding.id]: event.target.value }))} /></div>
                      </div>
                    )}

                    {finding.status === 'open' && (
                      <div className="revision-qa-finding-actions">
                        {finding.replacement ? (
                          canAccept ? (
                            isReviewing ? (
                              <>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReviewingId(null)}><X size={12} /> Huỷ</button>
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => acceptFinding(finding)}><Check size={12} /> Chấp nhận</button>
                              </>
                            ) : <button type="button" className="btn btn-secondary btn-sm" onClick={() => { highlightFinding(finding); setReviewingId(finding.id); }}>Xem thay đổi</button>
                          ) : <span className="revision-qa-manual-label">Đoạn đích đã thay đổi</span>
                        ) : <span className="revision-qa-manual-label">Cần tác giả/AI biên tập</span>}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => ignoreFinding(finding)}>Bỏ qua</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="revision-qa-empty revision-qa-empty--initial">
          <FileSearch size={22} />
          <strong>Chưa có báo cáo cho phạm vi này</strong>
          <span>Chạy thủ công khi Anh muốn kiểm tra. Nội dung chỉ được xử lý trong trình duyệt.</span>
        </div>
      )}
    </section>
  );
}
