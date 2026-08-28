import React, { useState } from 'react';
import { getManuscriptReviewModelState, saveManuscriptReviewModelPreference } from './modelRouting.js';
import './ManuscriptReview.css';

export default function ManuscriptReviewModelSetting({ ollamaModels }) {
  const [, refresh] = useState(0);
  const [error, setError] = useState('');
  const state = getManuscriptReviewModelState({ ...(ollamaModels === undefined ? {} : { ollamaModels }) });
  return <div className="manuscript-review-setting">
    <div>
      <label className="form-label" htmlFor="manuscript-review-setting-model">Model phân tích bản thảo</label>
      <p>Lưu riêng với Hoàn thành chương. Không ép dùng model Pro; điểm chấm luôn là đánh giá tham khảo.</p>
    </div>
    <div>
      <select id="manuscript-review-setting-model" className="select" value={state.prompted ? state.selectedModel : '__unconfirmed'} onChange={(event) => {
        try { saveManuscriptReviewModelPreference({ ...state, model: event.target.value }); setError(''); refresh((value) => value + 1); }
        catch (issue) { setError(issue.message); }
      }}>
        {!state.prompted && <option value="__unconfirmed" disabled>Chưa xác nhận — sẽ hỏi khi phân tích lần đầu</option>}
        <option value="">Theo model AI hiện tại — {state.currentModel || 'chưa chọn'}</option>
        {state.options.map((item) => <option key={item.id} value={item.id}>{item.label}{item.meta ? ` — ${item.meta}` : ''}</option>)}
      </select>
      <p>Provider: {state.providerLabel}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
