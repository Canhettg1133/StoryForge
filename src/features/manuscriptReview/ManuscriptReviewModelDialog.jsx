import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import aiService from '../../services/ai/client.js';
import { getAvailableModelOptions, setOllamaModelCatalog } from '../../services/ai/modelOptions.js';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import './ManuscriptReview.css';

let catalogRequest;
function loadCatalog() {
  catalogRequest ??= aiService.testConnection('ollama').finally(() => { catalogRequest = null; });
  return catalogRequest;
}

export default function ManuscriptReviewModelDialog({ modelState, onCancel, onConfirm, confirmLabel = 'Lưu model' }) {
  const id = useId();
  const dialogRef = useModalAccessibility({ open: Boolean(modelState), onClose: onCancel });
  const [selected, setSelected] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!modelState) return;
    let alive = true;
    setSelected(modelState.selectedModel); setOptions(modelState.options); setError(''); setLoading(false);
    if (modelState.provider === 'ollama') {
      setLoading(true);
      loadCatalog().then((result) => {
        if (!alive) return;
        if (!result.success) throw new Error(result.error || 'Không lấy được danh sách model Ollama.');
        const catalog = setOllamaModelCatalog(result.models);
        const next = getAvailableModelOptions('ollama', { ollamaModels: catalog }).filter((item) => catalog.includes(item.id));
        setOptions(next); setSelected((value) => next.some((item) => item.id === value) ? value : '');
      }).catch((issue) => { if (alive) setError(issue.message); })
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [modelState]);
  if (!modelState) return null;
  return createPortal(
    <div className="manuscript-review-modal" onMouseDown={onCancel}>
      <section className="manuscript-review-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // The enclosing Editor sheet also listens on document; only this top modal owns Escape.
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
        }}>
        <div className="manuscript-review-row">
          <h2 id={`${id}-title`}>Chọn model phân tích</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Đóng chọn model phân tích" onClick={onCancel}><X size={18} /></button>
        </div>
        <p id={`${id}-description`}>{modelState.providerLabel}. Lựa chọn này chỉ dùng cho Phân tích bản thảo, không đổi Hoàn thành chương.</p>
        <label htmlFor={`${id}-model`}>Model phân tích</label>
        <select id={`${id}-model`} className="select" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={loading}>
          <option value="" disabled={!options.some((item) => item.id === modelState.currentModel)}>Theo model AI hiện tại — {modelState.currentModel || 'chưa chọn'}</option>
          {options.map((item) => <option key={item.id} value={item.id}>{item.label}{item.meta ? ` — ${item.meta}` : ''}</option>)}
        </select>
        <p className="manuscript-review-hint">{modelState.suggestedFromCompletion ? 'Gợi ý lần đầu từ Hoàn thành chương. ' : ''}Có thể dùng model nhẹ; độ chính xác của nhận xét và điểm vẫn cần tác giả đối chiếu.</p>
        {loading && <p role="status">Đang lấy danh sách Ollama…</p>}
        {error && <p role="alert">{error} Có thể kiểm tra kết nối trong Cài đặt.</p>}
        <div className="manuscript-review-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Hủy</button>
          <button type="button" className="btn btn-primary" disabled={loading || !options.some((item) => item.id === (selected || modelState.currentModel))} onClick={() => {
            try { onConfirm(selected); } catch (issue) { setError(issue.message); }
          }}>{confirmLabel}</button>
        </div>
      </section>
    </div>, document.body,
  );
}
