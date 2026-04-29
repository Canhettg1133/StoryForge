import React, { useRef, useState } from 'react';
import { AlertCircle, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { ANALYSIS_MODES, INGEST_TYPES, formatNumber, summarizeParserPreflight } from '../labLiteUiHelpers.js';

export function UploadPanel({
  importState,
  currentCorpus,
  presetRunState,
  ingestType,
  onIngestTypeChange,
  analysisMode,
  onAnalysisModeChange,
  allowAdultIngest,
  onAllowAdultIngestChange,
  adultModeAllowed,
  onImport,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [showImportDetails, setShowImportDetails] = useState(false);
  const inputRef = useRef(null);
  const isBusy = importState.status === 'reading' || importState.status === 'saving';
  const preflight = currentCorpus ? summarizeParserPreflight(currentCorpus) : null;
  const currentMode = ANALYSIS_MODES.find((mode) => mode.value === analysisMode);
  const suggestedMode = ANALYSIS_MODES.find((mode) => mode.value === preflight?.suggestedMode);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file && !isBusy) {
      onImport(file);
    }
  };

  return (
    <section className="lab-lite-card lab-lite-upload">
      <div className="lab-lite-section-header">
        <div>
          <h3>Nạp liệu offline</h3>
          <p>Chọn mức phân tích, kéo thả file, rồi Lab Lite sẽ tự chạy preset đã chọn sau khi nạp xong.</p>
        </div>
      </div>
      <div className="lab-lite-control-grid lab-lite-control-grid--two">
        <label>
          Loại nạp liệu
          <select value={ingestType} onChange={(event) => onIngestTypeChange(event.target.value)} disabled={isBusy}>
            {INGEST_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="lab-lite-checkbox-row">
          <input
            type="checkbox"
            checked={allowAdultIngest}
            onChange={(event) => onAllowAdultIngestChange(event.target.checked)}
            disabled={isBusy || (!adultModeAllowed && ingestType !== 'adult_scene')}
          />
          <span>Cho phép phân tích nội dung trưởng thành / 18+</span>
        </label>
      </div>
      <div className="lab-lite-mode-picker" aria-label="Chế độ phân tích">
        {ANALYSIS_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            className={`lab-lite-mode-option ${analysisMode === mode.value ? 'is-active' : ''}`}
            onClick={() => onAnalysisModeChange(mode.value)}
            disabled={isBusy}
          >
            <strong>{mode.label}</strong>
            <small>{mode.detail}</small>
          </button>
        ))}
      </div>
      <p className="lab-lite-muted lab-lite-mode-note">
        Preset đang chọn: {currentMode?.label || 'Phân tích nhanh'}. Sau khi nạp, Lab Lite sẽ tự chạy preset này. Bước ghi vào Story Bible vẫn cần bạn xác nhận riêng.
      </p>
      <input
        ref={inputRef}
        className="lab-lite-file-input"
        type="file"
        accept=".txt,.md,.docx"
        onChange={(event) => handleFiles(event.target.files)}
        disabled={isBusy}
      />
      <button
        type="button"
        className={`lab-lite-dropzone ${isDragging ? 'is-dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isBusy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer?.files);
        }}
        disabled={isBusy}
      >
        {isBusy ? <Loader2 size={28} className="spin" /> : <UploadCloud size={28} />}
        <span className="dropzone-title">Kéo thả TXT, MD, DOCX</span>
        <span className="dropzone-subtitle">Lab Lite sẽ tách chương, lưu local và bắt đầu phân tích theo preset.</span>
      </button>
      {importState.error ? <p className="lab-lite-error">{importState.error}</p> : null}
      {presetRunState?.status === 'running' ? (
        <div className="lab-lite-inline-status">
          <Loader2 size={14} className="spin" />
          <span>{presetRunState.label || 'Đang chạy preset phân tích'}.</span>
        </div>
      ) : null}
      {presetRunState?.status === 'error' ? <p className="lab-lite-error">{presetRunState.error}</p> : null}
      {preflight ? (
        <div className="lab-lite-preflight">
          <div className="lab-lite-section-header">
            <div>
              <h4>Kiểm tra sau khi nạp</h4>
              <p>{suggestedMode ? `Gợi ý: ${suggestedMode.label}` : 'File đã sẵn sàng cho các bước tiếp theo.'}</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowImportDetails((value) => !value)}>
              {showImportDetails ? 'Ẩn chi tiết' : 'Xem chi tiết'}
            </button>
          </div>
          <div className="lab-lite-stat-grid lab-lite-stat-grid--compact">
            {preflight.stats.slice(0, 2).map((item) => (
              <span key={item.label} className="lab-lite-stat-badge">
                <span className="stat-label">{item.label}</span>
                <strong className="stat-value">{item.value}</strong>
              </span>
            ))}
          </div>
          {preflight.warnings.length ? (
            <div className="lab-lite-warning-list">
              {preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : <p className="lab-lite-muted">Chưa thấy cảnh báo tách chương đáng chú ý.</p>}
          {showImportDetails ? (
            <div className="lab-lite-stat-grid lab-lite-stat-grid--compact">
              {preflight.stats.slice(2).map((item) => (
                <span key={item.label} className="lab-lite-stat-badge">
                  <span className="stat-label">{item.label}</span>
                  <strong className="stat-value">{item.value}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function CorpusLibrary({ corpuses, currentCorpusId, onSelect, onDelete, onRename, isProjectScoped = false }) {
  return (
    <section className="lab-lite-card lab-lite-library">
      <div className="lab-lite-section-header">
        <div>
          <h3>Dữ liệu local</h3>
          <p>{corpuses.length} bộ dữ liệu đã lưu</p>
        </div>
      </div>
      <div className="lab-lite-corpus-list">
        {corpuses.length === 0 ? (
          <p className="lab-lite-muted">
            {isProjectScoped ? 'Chưa có dữ liệu Lab Lite cho dự án này.' : 'Chưa có bộ dữ liệu nào.'}
          </p>
        ) : null}
        {corpuses.map((corpus) => (
          <div key={corpus.id} className="lab-lite-corpus-row">
            <button
              type="button"
              className={`lab-lite-corpus-item ${corpus.id === currentCorpusId ? 'is-active' : ''}`}
              onClick={() => onSelect(corpus.id)}
            >
              <strong>{corpus.title}</strong>
              <span>{corpus.sourceFileName || corpus.fileType}</span>
              <small>{formatNumber(corpus.chapterCount)} chương - {formatNumber(corpus.totalEstimatedTokens)} token ước tính</small>
            </button>
            <button
              type="button"
              className="lab-lite-icon-button lab-lite-danger-button"
              aria-label={`Xóa dữ liệu Lab Lite ${corpus.title}`}
              title="Xóa dữ liệu Lab Lite khỏi IndexedDB"
              onClick={() => onDelete?.(corpus.id)}
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              className="lab-lite-link-button lab-lite-corpus-rename"
              onClick={() => {
                const nextTitle = window.prompt('Tên dữ liệu mới', corpus.title);
                if (nextTitle && nextTitle.trim() && nextTitle.trim() !== corpus.title) onRename?.(corpus.id, nextTitle.trim());
              }}
            >
              Đổi tên
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function IngestBatchPanel({ ingestBatches }) {
  return (
    <section className="lab-lite-card lab-lite-advanced-card">
      <details>
        <summary>Lịch sử lượt nạp</summary>
        <p className="lab-lite-muted">{formatNumber(ingestBatches.length)} lượt nạp đang được theo dõi.</p>
        <div className="lab-lite-result-list">
          {ingestBatches.length === 0 ? <p className="lab-lite-muted">Chưa có lượt nạp nào.</p> : null}
          {ingestBatches.slice(0, 8).map((batch) => (
            <div key={batch.id} className="lab-lite-result-item">
              <strong>{INGEST_TYPES.find((item) => item.value === batch.type)?.label || batch.type}</strong>
              <p>{batch.status || 'đã nạp'}{batch.allowAdultCanon ? ' - có phân tích 18+' : ''}</p>
              <small>{batch.sourceFileName || batch.id}</small>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

export function ParseDiagnostics({ corpus }) {
  const diagnostics = corpus?.parseDiagnostics || {};
  const rejected = Array.isArray(diagnostics.rejectedBoundaries) ? diagnostics.rejectedBoundaries.slice(0, 6) : [];
  return (
    <section className="lab-lite-card lab-lite-advanced-card">
      <details>
        <summary>Chẩn đoán tách chương</summary>
        <p className="lab-lite-muted">{formatNumber(diagnostics.headingCandidates?.length || 0)} ứng viên - {formatNumber(diagnostics.acceptedBoundaries?.length || 0)} ranh giới đã nhận</p>
        {corpus?.frontMatter?.content ? (
          <div className="lab-lite-diagnostic-block">
            <strong>Phần đầu file</strong>
            <p>{corpus.frontMatter.content}</p>
          </div>
        ) : null}
        <div className="lab-lite-diagnostic-block">
          <strong>Ranh giới đã loại</strong>
          {rejected.length === 0 ? <p>Chưa có ranh giới đáng ngờ.</p> : null}
          {rejected.map((item, index) => (
            <p key={`${item.lineNumber}-${index}`}>Dòng {item.lineNumber}: {item.text} - {item.rejectedReason}</p>
          ))}
        </div>
      </details>
    </section>
  );
}

