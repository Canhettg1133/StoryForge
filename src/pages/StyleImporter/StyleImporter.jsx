import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import '../Settings/Settings.css';
import './StyleImporter.css';
import useProjectStore from '../../stores/projectStore.js';
import useStyleImporterStore from '../../stores/styleImporterStore.js';
import { FULL_FILE_MAX_BYTES } from '../../services/styleImporter/fileSafety.js';
import { applyStyleImporterPatches } from '../../services/styleImporter/patchApplier.js';
import {
  buildProjectPromptItemMap,
  buildStyleImporterPromptBases,
  cleanPromptTemplatesForSave,
  parsePromptTemplates,
  STYLE_IMPORTER_ALLOWED_TARGETS,
} from '../../services/styleImporter/projectPromptInterop.js';
import { buildPromptPatchCoverage } from '../../services/styleImporter/promptPatchCoverage.js';

const STEP_DEFS = [
  { id: 'read', label: 'Đọc file' },
  { id: 'chapters', label: 'Tách chương' },
  { id: 'chunks', label: 'Tạo chunk' },
  { id: 'analyze', label: 'Phân tích style' },
  { id: 'patch', label: 'Tạo patch' },
];

const STYLE_FIELDS = [
  ['narrative_voice', 'Giọng kể'],
  ['pov_and_pronouns', 'Xưng hô / POV'],
  ['sentence_rhythm', 'Nhịp câu'],
  ['description_density', 'Mật độ miêu tả'],
  ['dialogue_style', 'Đối thoại'],
  ['action_scene_style', 'Cảnh chiến đấu'],
  ['inner_monologue_style', 'Nội tâm'],
  ['chapter_opening_pattern', 'Mở chương'],
  ['chapter_ending_pattern', 'Kết chương'],
];

const LIST_FIELDS = [
  ['pacing_rules', 'Pacing'],
  ['continuity_rules', 'Continuity'],
  ['must_preserve', 'Cần giữ'],
  ['must_avoid', 'Cần tránh'],
];

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0));
}

function formatBytes(value) {
  const size = Math.max(0, Number(value) || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function getPatchId(patch, index) {
  return `${patch.target_prompt}:${index}`;
}

function StatusIcon({ status }) {
  if (status === 'done') return <CheckCircle2 size={15} />;
  if (status === 'running') return <Loader2 size={15} className="spin" />;
  if (status === 'error') return <AlertCircle size={15} />;
  return <span className="style-importer-step-dot" />;
}

function StatCard({ label, value }) {
  return (
    <span className="style-importer-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function StyleDnaPreview({ stylePack }) {
  if (!stylePack) {
    return (
      <div className="style-importer-empty">
        <Sparkles size={18} />
        <p>Chưa có Style DNA. Hãy tải file và chạy phân tích.</p>
      </div>
    );
  }

  return (
    <div className="style-importer-style-grid">
      {STYLE_FIELDS.map(([key, label]) => (
        <div key={key} className="style-importer-style-card">
          <span>{label}</span>
          <p>{stylePack[key] || 'Chưa có nhận xét rõ.'}</p>
        </div>
      ))}
      {LIST_FIELDS.map(([key, label]) => (
        <div key={key} className="style-importer-style-card style-importer-style-card--wide">
          <span>{label}</span>
          {Array.isArray(stylePack[key]) && stylePack[key].length > 0 ? (
            <ul>
              {stylePack[key].slice(0, 6).map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <p>Chưa có rule rõ.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function PatchCoveragePanel({ coverage }) {
  if (!coverage || coverage.items.length === 0) return null;

  return (
    <div className="style-importer-coverage">
      <div className="style-importer-coverage__header">
        <div>
          <strong>Kiểm tra phân bổ patch</strong>
          <p>Style Importer ưu tiên cập nhật prompt theo đúng vai trò, thay vì chỉ nhồi vào prompt viết trực tiếp.</p>
        </div>
        {coverage.missingRequiredCount > 0 ? (
          <span className="style-importer-coverage__badge is-warning">
            Thiếu {formatNumber(coverage.missingRequiredCount)} target nên có
          </span>
        ) : (
          <span className="style-importer-coverage__badge is-ok">Đủ lớp chính</span>
        )}
      </div>
      <div className="style-importer-coverage__grid">
        {coverage.items.map((item) => {
          const statusClass = item.covered ? 'is-covered' : item.required ? 'is-missing' : 'is-optional';
          return (
            <div key={item.target} className={`style-importer-coverage-item ${statusClass}`}>
              <div>
                {item.covered ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <strong>{item.label}</strong>
              </div>
              <span>{item.covered ? 'Đã có patch' : item.required ? 'Nên có patch' : 'Tùy chọn'}</span>
              <p>{item.reason}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatchPreview({
  patches,
  selectedPatchIds,
  onTogglePatch,
  patchResult,
  itemMap,
  currentPromptsForAI,
}) {
  if (!patches.length) {
    return (
      <div className="style-importer-empty">
        <FileText size={18} />
        <p>Chưa có patch. Sau khi phân tích, AI sẽ đề xuất cập nhật từng prompt.</p>
      </div>
    );
  }

  const rejectedById = new Map((patchResult?.rejected || []).map((item) => [item.id, item]));

  return (
    <div className="style-importer-patch-list">
      {patches.map((patch, index) => {
        const id = getPatchId(patch, index);
        const targetKey = String(patch.target_prompt || '').toLowerCase();
        const item = itemMap.get(targetKey);
        const rejected = rejectedById.get(id);
        const currentValue = currentPromptsForAI?.[targetKey]?.current_value;
        const existingPrompt = Array.isArray(currentValue)
          ? currentValue.join('\n')
          : String(currentValue || '');
        const beforePreview = patch.before || existingPrompt;
        return (
          <article key={id} className={`style-importer-patch ${rejected ? 'is-rejected' : ''}`}>
            <label className="style-importer-patch__header">
              <input
                type="checkbox"
                checked={selectedPatchIds.has(id)}
                onChange={() => onTogglePatch(id)}
              />
              <span>
                <strong>{item?.label || patch.target_prompt}</strong>
                <small>{patch.operation} · {patch.target_prompt}</small>
              </span>
              {rejected ? <em>Không áp dụng</em> : null}
            </label>
            {patch.reason ? <p className="style-importer-patch__reason">{patch.reason}</p> : null}
            {patch.risk ? <p className="style-importer-patch__risk">Rủi ro: {patch.risk}</p> : null}
            {rejected ? <p className="style-importer-patch__risk">{rejected.reason}</p> : null}
            <div className="style-importer-diff-grid">
              <div>
                <span>{patch.before ? 'Đoạn sẽ thay thế' : 'Prompt hiện có trước khi cập nhật'}</span>
                <pre>{beforePreview || 'Chưa có nội dung hiện có cho prompt này.'}</pre>
              </div>
              <div>
                <span>Sau / nội dung thêm</span>
                <pre>{patch.after}</pre>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function StyleImporter() {
  const { currentProject, updateProjectSettings } = useProjectStore();
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const {
    fileState,
    userInstruction,
    progress,
    runError,
    stylePack,
    patches,
    selectedPatchIds,
    isRunning,
    isSaving,
    saveMessage,
    backupSnapshot,
    setUserInstruction,
    importFile,
    runAnalysis,
    togglePatch,
    setIsSaving,
    setSaveMessage,
    setBackupSnapshot,
  } = useStyleImporterStore();
  const itemMap = useMemo(() => buildProjectPromptItemMap(), []);

  const promptBases = useMemo(() => (
    buildStyleImporterPromptBases({ currentProject })
  ), [currentProject]);

  const patchResult = useMemo(() => applyStyleImporterPatches({
    currentPromptTemplates: promptBases.currentPromptTemplates,
    basePromptTemplates: promptBases.basePromptTemplates,
    currentAiGuidelines: promptBases.currentAiGuidelines,
    patches,
    selectedPatchIds,
  }), [patches, selectedPatchIds, promptBases]);
  const patchCoverage = useMemo(() => buildPromptPatchCoverage({
    patches,
    stylePack,
  }), [patches, stylePack]);

  const handleRunAnalysis = async () => {
    await runAnalysis({
      promptBases,
      allowedTargets: STYLE_IMPORTER_ALLOWED_TARGETS,
    });
  };

  const handleSave = async () => {
    if (!currentProject || isSaving || patchResult.applied.length === 0) return;
    setIsSaving(true);
    setSaveMessage(null);
    const snapshot = {
      prompt_templates: currentProject.prompt_templates || '',
      ai_guidelines: currentProject.ai_guidelines || '',
    };

    try {
      const cleaned = cleanPromptTemplatesForSave(patchResult.promptTemplates);
      const existingTemplates = parsePromptTemplates(currentProject.prompt_templates);
      await updateProjectSettings({
        prompt_templates: JSON.stringify({ ...existingTemplates, ...cleaned }),
        ai_guidelines: patchResult.aiGuidelines,
      });
      setBackupSnapshot(snapshot);
      setSaveMessage({ type: 'success', text: 'Đã lưu vào Prompt truyện. Override mới có hiệu lực ngay.' });
    } catch (error) {
      setSaveMessage({ type: 'error', text: error?.message || 'Không thể lưu Prompt truyện.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUndo = async () => {
    if (!backupSnapshot || isSaving) return;
    setIsSaving(true);
    try {
      await updateProjectSettings(backupSnapshot);
      setSaveMessage({ type: 'success', text: 'Đã hoàn tác về snapshot trước khi lưu.' });
      setBackupSnapshot(null);
    } catch (error) {
      setSaveMessage({ type: 'error', text: error?.message || 'Không thể hoàn tác.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file) importFile(file);
  };

  const canAnalyze = !!fileState?.chunkPlan && !isRunning;
  const canSave = patchResult.applied.length > 0 && !isSaving;
  const chunkCount = fileState?.chunkPlan?.chunks?.length || 0;
  const fullContext = fileState?.chunkPlan?.mode === 'full';

  if (!currentProject) {
    return (
      <div className="settings-page style-importer-page">
        <div className="prompt-manager-empty card">
          <AlertCircle size={18} />
          <div>
            <strong>Chưa nạp được dự án</strong>
            <p>Hãy mở một truyện trước khi dùng Style Importer.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page style-importer-page">
      <header className="settings-header animate-fade-in style-importer-header">
        <div>
          <h1 className="settings-title">Prompt Doctor</h1>
          <p className="settings-subtitle">
            Tải truyện mẫu lên để AI học văn phong, tạo patch prompt và lưu vào Project Override của <strong>{currentProject.title}</strong>.
          </p>
        </div>
        <div className="style-importer-header__actions">
          <button type="button" className="btn btn-secondary" onClick={handleUndo} disabled={!backupSnapshot || isSaving}>
            <RefreshCw size={14} /> Hoàn tác
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
            {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            Lưu vào Prompt truyện
          </button>
        </div>
      </header>

      <section className="settings-section card style-importer-upload-card animate-slide-up">
        <div className="settings-section-header">
          <UploadCloud size={20} />
          <div>
            <h2>Tải tác phẩm mẫu</h2>
            <p>V1 xử lý TXT/MD trong browser, không upload binary thô lên backend.</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          className="style-importer-file-input"
          type="file"
          accept=".txt,.md"
          onChange={(event) => handleFiles(event.target.files)}
          disabled={isRunning}
        />
        <button
          type="button"
          className={`style-importer-dropzone ${isDragging ? 'is-dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!isRunning) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            handleFiles(event.dataTransfer?.files);
          }}
          disabled={isRunning}
        >
          <UploadCloud size={28} />
          <span>{fileState?.file?.name || 'Kéo thả hoặc chọn file TXT/MD'}</span>
          <small>Giới hạn 10MB. File trên 5MB sẽ tự chia mega chunks.</small>
        </button>

        {fileState ? (
          <div className="style-importer-stats">
            <StatCard label="Kích thước" value={formatBytes(fileState.file?.size)} />
            <StatCard label="Token ước tính" value={formatNumber(fileState.tokenDetail?.estimatedTokens)} />
            <StatCard label="Số chương" value={formatNumber(fileState.chapters?.length)} />
            <StatCard label="Chunk" value={fullContext ? 'Full context' : formatNumber(chunkCount)} />
          </div>
        ) : (
          <div className="style-importer-stats">
            <StatCard label="Ngưỡng full" value={`${formatBytes(FULL_FILE_MAX_BYTES)} / 750k token`} />
            <StatCard label="Chunk target" value="650k token" />
            <StatCard label="Hard cap" value="750k token" />
            <StatCard label="Song song" value="Tối đa 2 request" />
          </div>
        )}

        {fileState?.safety ? (
          <div className={`style-importer-status ${fileState.safety.ok ? 'is-success' : 'is-error'}`}>
            {fileState.safety.ok ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
            {fileState.safety.message}
          </div>
        ) : null}
        {fileState?.error ? <p className="style-importer-error">{fileState.error}</p> : null}
        {fileState?.warnings?.length ? (
          <div className="style-importer-warning-list">
            {fileState.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
      </section>

      <section className="settings-section card animate-slide-up">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>Yêu cầu học phong cách</h2>
            <p>Yêu cầu này sẽ được ưu tiên khi tạo Style Pack và patch prompt.</p>
          </div>
        </div>
        <textarea
          className="textarea style-importer-instruction"
          value={userInstruction}
          onChange={(event) => setUserInstruction(event.target.value)}
          placeholder="Ví dụ: Chỉ học cách viết chiến đấu và nhịp chương, không học canon. Giữ logic timeline chặt hơn bản mẫu."
          rows={4}
        />
        <div className="style-importer-actions">
          <button type="button" className="btn btn-primary" onClick={handleRunAnalysis} disabled={!canAnalyze}>
            {isRunning ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            Phân tích và tạo patch
          </button>
        </div>
      </section>

      <section className="settings-section card animate-slide-up">
        <div className="settings-section-header">
          <CheckCircle2 size={20} />
          <div>
            <h2>Tiến trình</h2>
            <p>Pipeline chạy Auto Mode, không cần chọn chế độ thủ công.</p>
          </div>
        </div>
        <div className="style-importer-progress">
          {STEP_DEFS.map((step) => (
            <div key={step.id} className={`style-importer-step is-${progress[step.id] || 'idle'}`}>
              <StatusIcon status={progress[step.id]} />
              <span>{step.label}</span>
            </div>
          ))}
        </div>
        {runError ? <p className="style-importer-error">{runError}</p> : null}
        {saveMessage ? (
          <div className={`style-importer-status ${saveMessage.type === 'success' ? 'is-success' : 'is-error'}`}>
            {saveMessage.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {saveMessage.text}
          </div>
        ) : null}
      </section>

      <section className="settings-section card animate-slide-up">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>Style DNA Preview</h2>
            <p>Xem những quy tắc AI rút ra trước khi lưu vào prompt.</p>
          </div>
        </div>
        <StyleDnaPreview stylePack={stylePack} />
      </section>

      <section className="settings-section card animate-slide-up">
        <div className="settings-section-header">
          <FileText size={20} />
          <div>
            <h2>Prompt Patch Preview</h2>
            <p>Chọn những patch muốn áp dụng. Patch bị lỗi biến template hoặc contract sẽ tự bị chặn.</p>
          </div>
        </div>
        {patches.length > 0 ? (
          <div className="style-importer-patch-count">
            Danh sách patch đề xuất: {formatNumber(patches.length)}
          </div>
        ) : null}
        <PatchPreview
          patches={patches}
          selectedPatchIds={selectedPatchIds}
          onTogglePatch={togglePatch}
          patchResult={patchResult}
          itemMap={itemMap}
          currentPromptsForAI={promptBases.currentPromptsForAI}
        />
        {patches.length > 0 ? <PatchCoveragePanel coverage={patchCoverage} /> : null}
        {patches.length > 0 ? (
          <div className="style-importer-apply-summary">
            <span>{formatNumber(patchResult.applied.length)} patch sẵn sàng áp dụng</span>
            <span>{formatNumber(patchResult.rejected.length)} patch bị chặn</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
