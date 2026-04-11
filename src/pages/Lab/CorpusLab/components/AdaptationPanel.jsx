/**
 * AdaptationPanel - AI-powered adaptation suggestions panel
 * Shows equivalent events from other fandoms
 */

import { useState } from 'react';
import {
  adaptEvents,
  getAvailableFandoms,
  buildAdaptationSummary,
} from '../../../../services/viewer/adaptationService.js';

const TROPES = [
  'rival_meeting', 'secret_relationship', 'training_arc', 'betrayal_reveal',
  'first_kiss', 'forbidden_love', 'hurt_comfort', 'enemy_to_lover',
  'time_skip', 'final_battle', 'mentor_death', 'power_revelation',
  'group_formation', 'road_trip', 'fake_dating', 'forced_proximity',
];

export default function AdaptationPanel({ selectedEvents, corpusFandom, onClose }) {
  const [targetFandom, setTargetFandom] = useState('generic');
  const [adapting, setAdapting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const fandoms = getAvailableFandoms();

  const handleAdapt = async () => {
    if (!selectedEvents.length) return;

    setAdapting(true);
    setError(null);
    setResults(null);

    try {
      const adaptResults = await adaptEvents(
        selectedEvents,
        targetFandom,
        corpusFandom || 'HP',
        (prog) => setProgress(prog)
      );

      setResults(adaptResults);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdapting(false);
      setProgress(null);
    }
  };

  const summary = results ? buildAdaptationSummary(results) : null;

  const handleExportJSON = () => {
    const blob = new Blob(
      [JSON.stringify({ results, summary }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adaptation-results.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="adaptation-panel">
      <div className="adaptation-header">
        <h3>Chuyển thể AI</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      {/* Setup */}
      {!results && (
        <>
          <div className="adaptation-setup">
            <div className="adapt-info">
              <p>
                Chuyển thể <strong>{selectedEvents.length}</strong> sự kiện đã chọn
                {corpusFandom ? ` từ ${corpusFandom}` : ''} sang vũ trụ{' '}
                <strong>{fandoms.find((f) => f.id === targetFandom)?.label}</strong>.
              </p>
            </div>

            <div className="adapt-target-select">
              <label>Fandom mục tiêu</label>
              <select
                value={targetFandom}
                onChange={(e) => setTargetFandom(e.target.value)}
              >
                {fandoms.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>

            <div className="adapt-trope-preview">
              <h4>Trope phổ biến</h4>
              <div className="trope-list">
                {TROPES.slice(0, 8).map((trope) => (
                  <span key={trope} className="trope-chip">{trope.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </div>

            {error && <p className="adapt-error">Lỗi: {error}</p>}

            <button
              className="btn-adapt"
              onClick={handleAdapt}
              disabled={adapting || !selectedEvents.length}
            >
              {adapting ? 'Đang chuyển thể...' : 'Bắt đầu chuyển thể AI'}
            </button>
          </div>
        </>
      )}

      {/* Progress */}
      {adapting && progress && (
        <div className="adapt-progress">
          <div className="progress-info">
            <span>Đang chuyển thể {progress.current} / {progress.total}...</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <p className="progress-event">{progress.event}</p>
        </div>
      )}

      {/* Results */}
      {results && summary && (
        <div className="adapt-results">
          <div className="adapt-summary">
            <div className="summary-stats">
              <div className="stat">
                <strong>{summary.successRate}%</strong>
                <span>Tỉ lệ thành công</span>
              </div>
              <div className="stat">
                <strong>{summary.avgSimilarity}</strong>
                <span>Độ tương tự TB</span>
              </div>
              <div className="stat">
                <strong>{summary.highIntensityMatches}</strong>
                <span>Cường độ cao</span>
              </div>
            </div>
          </div>

          {summary.topCautions.length > 0 && (
            <div className="adapt-cautions">
              <h4>Lưu ý thường gặp</h4>
              {summary.topCautions.map((c, i) => (
                <div key={i} className="caution-item">
                  <span className="caution-count">{c.count}×</span>
                  <span>{c.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="adapt-result-list">
            {results.map(({ event, adaptation, index }) => (
              <div
                key={index}
                className={`adapt-result-item ${
                  adaptation.error ? 'error' : adaptation.equivalentEvent ? 'success' : 'no-match'
                }`}
              >
                <div className="result-source">
                  <span className="source-label">Nguồn:</span>
                  <p>{event.description?.substring(0, 60)}...</p>
                </div>

                {adaptation.equivalentEvent && (
                  <div className="result-target">
                    <span className="target-label">
                      → {fandoms.find((f) => f.id === targetFandom)?.label}:
                    </span>
                    <p>{adaptation.equivalentEvent}</p>
                    {adaptation.characterEquivalent && (
                      <span className="char-equivalent">
                        Nhân vật tương đương: {adaptation.characterEquivalent}
                      </span>
                    )}
                  </div>
                )}

                {adaptation.cautions?.length > 0 && (
                  <div className="result-cautions">
                    <span>⚠️ Lưu ý:</span>
                    <ul>
                      {adaptation.cautions.slice(0, 2).map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {adaptation.notes?.length > 0 && (
                  <div className="result-notes">
                    <span>Ghi chú:</span>
                    <ul>
                      {adaptation.notes.slice(0, 2).map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!adaptation.equivalentEvent && !adaptation.error && (
                  <p className="no-match-msg">Không tìm thấy sự kiện tương đương trong fandom mục tiêu.</p>
                )}
              </div>
            ))}
          </div>

          <div className="adapt-result-actions">
            <button className="btn-secondary" onClick={() => setResults(null)}>
              Chuyển thể mới
            </button>
            <button className="btn-export" onClick={handleExportJSON}>
              Xuất kết quả
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
