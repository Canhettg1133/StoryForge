/**
 * SearchPanel - Advanced search with saved searches and history
 */

import { useRef, useState } from 'react';

export default function SearchPanel({
  query,
  onSearch,
  resultsCount,
  totalCount,
  savedSearches = [],
  searchHistory = [],
  onSaveSearch,
  onDeleteSavedSearch,
  onLoadSavedSearch,
  onClearHistory,
}) {
  const inputRef = useRef(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const isFiltered = resultsCount !== null && resultsCount !== totalCount;

  const handleSubmit = (e) => {
    e.preventDefault();
  };

  const handleClear = () => {
    onSearch('');
    inputRef.current?.focus();
  };

  const handleSave = () => {
    if (saveName.trim()) {
      onSaveSearch(saveName.trim());
      setSaveName('');
      setShowSaveModal(false);
    }
  };

  const handleHistoryClick = (item) => {
    onLoadSavedSearch(item);
    setShowHistory(false);
  };

  const handleSavedClick = (saved) => {
    onLoadSavedSearch(saved);
    setShowSaved(false);
  };

  return (
    <div className="search-panel">
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder='Tìm sự kiện... (ví dụ: "angst", yêu, -loại_trừ)'
            className="search-input"
            aria-label="Tìm sự kiện"
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={handleClear}
              aria-label="Xóa tìm kiếm"
            >
              ×
            </button>
          )}
        </div>

        {/* Search actions */}
        <div className="search-actions">
          {query && (
            <button
              type="button"
              className="btn-save-search"
              onClick={() => setShowSaveModal(true)}
              title="Lưu tìm kiếm này"
            >
              💾 Lưu
            </button>
          )}

          {/* History dropdown */}
          {searchHistory.length > 0 && (
            <div className="search-dropdown">
              <button
                type="button"
                className="btn-history-toggle"
                onClick={() => { setShowHistory(!showHistory); setShowSaved(false); }}
                title="Lịch sử tìm kiếm"
              >
                🕐 Lịch sử
              </button>
              {showHistory && (
                <div className="search-dropdown-menu">
                  <div className="dropdown-header">
                    <span>Tìm kiếm gần đây</span>
                    <button
                      type="button"
                      className="btn-clear-history"
                      onClick={() => { onClearHistory(); setShowHistory(false); }}
                    >
                      Xóa hết
                    </button>
                  </div>
                  {searchHistory.map((item, i) => (
                    <button
                      key={item.id || i}
                      type="button"
                      className="history-item"
                      onClick={() => handleHistoryClick(item)}
                    >
                      <span className="history-query">{item.query}</span>
                      <span className="history-time">
                        {new Date(item.created_at).toLocaleDateString('vi-VN')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Saved searches dropdown */}
          {savedSearches.length > 0 && (
            <div className="search-dropdown">
              <button
                type="button"
                className="btn-saved-toggle"
                onClick={() => { setShowSaved(!showSaved); setShowHistory(false); }}
                title="Tìm kiếm đã lưu"
              >
                📚 Đã lưu ({savedSearches.length})
              </button>
              {showSaved && (
                <div className="search-dropdown-menu">
                  <div className="dropdown-header">
                    <span>Tìm kiếm đã lưu</span>
                  </div>
                  {savedSearches.map((saved) => (
                    <div key={saved.id} className="saved-item">
                      <button
                        type="button"
                        className="saved-item-btn"
                        onClick={() => handleSavedClick(saved)}
                      >
                        <span className="saved-name">{saved.name}</span>
                        <span className="saved-query">{saved.query}</span>
                      </button>
                      <button
                        type="button"
                        className="btn-delete-saved"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSavedSearch(saved.id);
                        }}
                        title="Xóa"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      {/* Save search modal */}
      {showSaveModal && (
        <div className="save-search-modal" onClick={() => setShowSaveModal(false)}>
          <div className="save-search-content" onClick={(e) => e.stopPropagation()}>
            <h4>Lưu tìm kiếm</h4>
            <p className="save-query-preview">Truy vấn: "{query}"</p>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Đặt tên cho tìm kiếm này..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setShowSaveModal(false);
              }}
            />
            <div className="save-search-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowSaveModal(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="btn-save"
                onClick={handleSave}
                disabled={!saveName.trim()}
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {isFiltered && (
        <div className="search-results-badge">
          <strong>{resultsCount}</strong> / {totalCount} sự kiện
        </div>
      )}

      <div className="search-tips">
        <details>
          <summary>Mẹo tìm kiếm</summary>
          <ul>
            <li><code>"cụm từ"</code> - khớp chính xác</li>
            <li><code>AND</code> - phải có cả hai từ</li>
            <li><code>OR</code> - có một trong hai từ</li>
            <li><code>-từ</code> - loại trừ từ</li>
            <li>Nhấn tag hoặc nhân vật để lọc nhanh</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
