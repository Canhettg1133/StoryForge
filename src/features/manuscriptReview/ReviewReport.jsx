import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LITERARY_CRITERIA, MODE_LABELS, REQUIREMENT_LABELS, SIGNAL_CRITERIA, SIGNAL_LABELS } from './constants.js';

const severityLabels = { high: 'Ảnh hưởng lớn', medium: 'Đáng lưu ý', low: 'Cân nhắc' };

function CriterionDisclosure({ label, children }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="manuscript-review-criterion">
    <button type="button" className="manuscript-review-criterion-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>
      <ChevronDown size={15} aria-hidden="true" /> {label}
    </button>
    {expanded && <div id={id}>{children}</div>}
  </div>;
}

function Evidence({ evidence, onEvidence, selectedEvidence }) {
  return evidence.map((item, index) => <button type="button" className="manuscript-review-evidence" key={`${item.paragraph_id}:${index}`}
    aria-pressed={selectedEvidence === `${item.paragraph_id}:${item.quote}`} onClick={() => onEvidence(item)}>
    Xem bằng chứng: {item.quote.length > 220 ? `${item.quote.slice(0, 220)}…` : item.quote}
  </button>);
}

export default function ReviewReport({ report, stale, onEvidence, onRetry, busy, selectedEvidence }) {
  const [expanded, setExpanded] = useState(false);
  const result = report.result;
  const scoreLabel = report.mode === 'signals' ? SIGNAL_LABELS[result.signal_level]
    : result.score === null ? 'Chưa đủ căn cứ cho điểm' : `${result.score}/100`;
  return <section className="manuscript-review-report" aria-label={MODE_LABELS[report.mode]}>
    <div className="manuscript-review-row manuscript-review-report-heading"><h3>{MODE_LABELS[report.mode]}</h3><span className="manuscript-review-score">{scoreLabel}</span></div>
    <p className="manuscript-review-hint">{report.provider} · {report.model} · {new Date(report.created_at).toLocaleString('vi-VN')} · Rubric {report.rubric_version}</p>
    {result.coverage && <p className="manuscript-review-hint">Đánh giá được {result.coverage.observed}/{result.coverage.total} tiêu chí{report.mode === 'literary' ? ` · ${result.coverage.weight}% trọng số` : ''}.</p>}
    {stale && <p className="manuscript-review-notice">Báo cáo cũ — bản thảo hoặc yêu cầu đã đổi. Chạy lại để đánh giá nội dung hiện tại.</p>}
    <p>{result.summary}</p>
    {result.rejected_evidence > 0 && <p className="manuscript-review-notice">Đã loại {result.rejected_evidence} bằng chứng không khớp; các điểm thiếu bằng chứng không được tính.</p>}
    <div className="manuscript-review-actions">
      <button type="button" className="btn btn-ghost" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Thu gọn' : `Xem chi tiết (${result.findings.length} nhận xét)`}</button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onRetry(report.mode)}>Chạy lại phần này</button>
    </div>
    {expanded && <div className="manuscript-review-details">
      {result.findings.map((finding) => <article className="manuscript-review-finding" key={finding.id}>
        <p><strong>{SIGNAL_CRITERIA[finding.criterion_id] || LITERARY_CRITERIA.find(({ id }) => id === finding.criterion_id)?.label || finding.criterion_id}</strong></p>
        <p><strong>{severityLabels[finding.severity]}</strong> · Độ chắc của nhận xét {Math.round(finding.confidence * 100)}% · AI</p>
        <Evidence evidence={finding.evidence} onEvidence={onEvidence} selectedEvidence={selectedEvidence} />
        <p>{finding.explanation}</p><p><strong>Hướng sửa:</strong> {finding.suggestion}</p>
      </article>)}
      {!result.findings.length && <p>Không có vấn đề ưu tiên kèm bằng chứng đã xác minh.</p>}
      {result.criteria?.map((item) => <CriterionDisclosure key={item.criterion_id} label={`${REQUIREMENT_LABELS[item.status]} — ${report.requirements.find((requirement) => requirement.id === item.criterion_id)?.text || item.criterion_id}`}>
        <p className="manuscript-review-hint">Nguồn: {item.criterion_id}</p><p>{item.reason}</p>
        <Evidence evidence={item.evidence} onEvidence={onEvidence} selectedEvidence={selectedEvidence} />
      </CriterionDisclosure>)}
      {result.scores?.map((item) => <CriterionDisclosure key={item.criterion_id} label={`${LITERARY_CRITERIA.find(({ id }) => id === item.criterion_id)?.label} — ${item.score === null ? 'N/A' : `${item.score}/5`}`}>
        <Evidence evidence={item.evidence} onEvidence={onEvidence} selectedEvidence={selectedEvidence} />
        {item.strength && <p><strong>Điểm mạnh:</strong> {item.strength}</p>}<p><strong>Giới hạn:</strong> {item.limitation}</p>
        <p className="manuscript-review-hint">Độ chắc của nhận xét: {Math.round(item.confidence * 100)}%</p>
      </CriterionDisclosure>)}
    </div>}
  </section>;
}
