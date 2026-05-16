/**
 * CompareMode - Side-by-side corpus comparison
 */

import { useEffect, useState } from 'react';
import useCorpusStore from '../../../../stores/corpusStore.js';
import { compareCorpora, findTropeEquivalents } from '../../../../services/viewer/comparisonEngine.js';

export default function CompareMode({ corpusId, compareCorpusId, onSelectCorpusB }) {
  const corpuses = useCorpusStore((state) => state.corpuses);
  const corpusA = corpuses[corpusId];
  const corpusB = compareCorpusId ? corpuses[compareCorpusId] : null;

  const [comparison, setComparison] = useState(null);
  const [tropeEquivalents, setTropeEquivalents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Run comparison when both corpora are selected
  useEffect(() => {
    if (!corpusA || !corpusB) {
      setComparison(null);
      setTropeEquivalents(null);
      return;
    }

    setLoading(true);
    setError(null);

    compareCorpora(corpusA, corpusB)
      .then((result) => {
        setComparison(result);
        return findTropeEquivalents(corpusA, corpusB);
      })
      .then((tropeResult) => {
        setTropeEquivalents(tropeResult);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [corpusA, corpusB]);

  // List other corpora to compare
  const otherCorpora = Object.values(corpuses).filter(
    (c) => c.id !== corpusId
  );

  if (!corpusId) {
    return (
      <div className="compare-empty">
        <div className="empty-icon">⚖️</div>
        <h3>Hãy chọn corpus để so sánh</h3>
        <p>Chọn một corpus ở thanh bên trước.</p>
      </div>
    );
  }

  return (
    <div className="compare-mode">
      <div className="compare-header">
        <div className="compare-corpus compare-corpus-a">
          <label>Bộ dữ liệu A</label>
          <div className="corpus-pill">
            <span className="corpus-label">A</span>
            <span className="corpus-name">{corpusA?.title || 'Không xác định'}</span>
          </div>
        </div>

        <div className="compare-vs">Đối chiếu</div>

        <div className="compare-corpus compare-corpus-b">
          <label>Bộ dữ liệu B</label>
          {!compareCorpusId ? (
            <select
              className="corpus-select"
              onChange={(e) => onSelectCorpusB(e.target.value || null)}
              value=""
            >
              <option value="">Chọn corpus để so sánh...</option>
              {otherCorpora.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.name || c.id}
                </option>
              ))}
            </select>
          ) : (
            <div className="corpus-pill">
              <span className="corpus-label">B</span>
              <span className="corpus-name">{corpusB?.title || 'Không xác định'}</span>
              <button
                className="change-btn"
                onClick={() => onSelectCorpusB(null)}
              >
                Đổi
              </button>
            </div>
          )}
        </div>
      </div>

      {!corpusB ? (
        <div className="compare-placeholder">
          <p>Chọn corpus thứ hai ở trên để bắt đầu so sánh.</p>
        </div>
      ) : loading ? (
        <div className="compare-loading">
          <div className="loading-spinner" />
          <p>Đang so sánh dữ liệu...</p>
        </div>
      ) : error ? (
        <div className="compare-error">
          <p>Lỗi: {error}</p>
        </div>
      ) : comparison ? (
        <div className="compare-content">
          <div className="compare-stats-grid">
            <div className="stat-card">
              <h4>{comparison.stats.corpusA.title}</h4>
              <div className="stat-row">
                <span>Tổng sự kiện</span>
                <strong>{comparison.stats.corpusA.total}</strong>
              </div>
              <div className="stat-row">
                <span>Chính sử</span>
                <strong>{comparison.stats.corpusA.canonCount}</strong>
              </div>
              <div className="stat-row">
                <span>Phi chính sử</span>
                <strong>{comparison.stats.corpusA.fanonCount}</strong>
              </div>
              <div className="stat-row">
                <span>Cường độ TB</span>
                <strong>{comparison.stats.corpusA.avgIntensity}/10</strong>
              </div>
            </div>

            <div className="stat-card">
              <h4>{comparison.stats.corpusB.title}</h4>
              <div className="stat-row">
                <span>Tổng sự kiện</span>
                <strong>{comparison.stats.corpusB.total}</strong>
              </div>
              <div className="stat-row">
                <span>Chính sử</span>
                <strong>{comparison.stats.corpusB.canonCount}</strong>
              </div>
              <div className="stat-row">
                <span>Phi chính sử</span>
                <strong>{comparison.stats.corpusB.fanonCount}</strong>
              </div>
              <div className="stat-row">
                <span>Cường độ TB</span>
                <strong>{comparison.stats.corpusB.avgIntensity}/10</strong>
              </div>
            </div>
          </div>

          <div className="similarity-score">
            <span className="score-label">Điểm tương đồng</span>
            <div className="score-bar">
              <div
                className="score-fill"
                style={{ width: `${Math.min(comparison.stats.similarity.similarityScore, 100)}%` }}
              />
            </div>
            <span className="score-value">
              {comparison.stats.similarity.similarityScore}%
            </span>
          </div>

          <div className="compare-section">
            <h4>Mẫu tương tự ({comparison.similarities.length})</h4>
            {comparison.similarities.length === 0 ? (
              <p className="no-data">Không tìm thấy mẫu tương tự.</p>
            ) : (
              <div className="pattern-list">
                {comparison.similarities.slice(0, 10).map((sim, i) => (
                  <div key={i} className="pattern-item">
                    <span className="pattern-badge similarity">
                      {Math.round(sim.similarity * 100)}%
                    </span>
                    <div className="pattern-content">
                      <span className="pattern-a">
                        {sim.corpusA?.description?.substring(0, 50)}
                      </span>
                      <span className="pattern-arrow">≈</span>
                      <span className="pattern-b">
                        {sim.corpusB?.description?.substring(0, 50)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="compare-sections-split">
            <div className="compare-section half">
              <h4>Chỉ có ở {comparison.stats.corpusA.title} ({comparison.uniqueA.length})</h4>
              <div className="unique-list">
                {comparison.uniqueA.slice(0, 5).map((item, i) => (
                  <div key={i} className="unique-item">
                    <span className="badge-a">A</span>
                    <span>{item.event?.description?.substring(0, 40)}...</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="compare-section half">
              <h4>Chỉ có ở {comparison.stats.corpusB.title} ({comparison.uniqueB.length})</h4>
              <div className="unique-list">
                {comparison.uniqueB.slice(0, 5).map((item, i) => (
                  <div key={i} className="unique-item">
                    <span className="badge-b">B</span>
                    <span>{item.event?.description?.substring(0, 40)}...</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {tropeEquivalents && (
            <div className="compare-section">
              <h4>Mô-típ tương đương</h4>
              <div className="trope-list">
                {tropeEquivalents.map((trope, i) => (
                  <div key={i} className={`trope-item status-${trope.status}`}>
                    <span className="trope-label">{trope.trope}</span>
                    <div className="trope-status">
                      {trope.corpusA.found && <span className="found-a">✓ A</span>}
                      {!trope.corpusA.found && <span className="missing-a">✗ A</span>}
                      {trope.corpusB.found && <span className="found-b">✓ B</span>}
                      {!trope.corpusB.found && <span className="missing-b">✗ B</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
