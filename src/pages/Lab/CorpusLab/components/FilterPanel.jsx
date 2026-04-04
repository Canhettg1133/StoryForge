/**
 * FilterPanel - Filters sidebar for analysis viewer
 */

export default function FilterPanel({
  filters,
  onChange,
  allTags = [],
  allLocations = [],
  allCharacters = [],
  allShips = [],
  onReset,
}) {
  const handleChange = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <h4>Bộ lọc</h4>
        <button className="filter-reset-btn" onClick={onReset}>
          Đặt lại
        </button>
      </div>

      {/* Severity */}
      <label className="filter-group">
        <span className="filter-label">Mức độ quan trọng</span>
        <select
          value={filters.severity}
          onChange={(e) => handleChange('severity', e.target.value)}
        >
          <option value="all">Tất cả</option>
          <option value="crucial">🔴 Cốt lõi</option>
          <option value="major">🟠 Quan trọng</option>
          <option value="moderate">🟡 Trung bình</option>
          <option value="minor">⚪ Nhẹ</option>
        </select>
      </label>

      {/* Rarity */}
      <label className="filter-group">
        <span className="filter-label">Độ hiếm</span>
        <select
          value={filters.rarity}
          onChange={(e) => handleChange('rarity', e.target.value)}
        >
          <option value="all">Tất cả</option>
          <option value="rare">⭐ Chỉ sự kiện hiếm</option>
          <option value="common_but_good">✨ Thường nhưng tốt</option>
          <option value="common">Thường</option>
        </select>
      </label>

      {/* Chính sử/Phi chính sử */}
      <label className="filter-group">
        <span className="filter-label">Chính sử / Phi chính sử</span>
        <select
          value={filters.canonFanon}
          onChange={(e) => handleChange('canonFanon', e.target.value)}
        >
          <option value="all">Tất cả</option>
          <option value="canon">🔵 Chỉ chính sử</option>
          <option value="fanon">🟣 Chỉ phi chính sử</option>
        </select>
      </label>

      {/* Tags */}
      {allTags.length > 0 && (
        <label className="filter-group">
          <span className="filter-label">Tag</span>
          <select
            value={filters.tag}
            onChange={(e) => handleChange('tag', e.target.value)}
          >
            <option value="all">Tất cả tag</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Characters */}
      {allLocations.length > 0 && (
        <label className="filter-group">
          <span className="filter-label">Địa điểm</span>
          <select
            value={filters.location || 'all'}
            onChange={(e) => handleChange('location', e.target.value)}
          >
            <option value="all">Tất cả địa điểm</option>
            {allLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Characters */}
      {allCharacters.length > 0 && (
        <label className="filter-group">
          <span className="filter-label">Nhân vật</span>
          <select
            value={filters.character}
            onChange={(e) => handleChange('character', e.target.value)}
          >
            <option value="all">Tất cả nhân vật</option>
            {allCharacters.map((char) => (
              <option key={char} value={char}>
                {char}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Ships */}
      {allShips.length > 0 && (
        <label className="filter-group">
          <span className="filter-label">Cặp đôi (Ship)</span>
          <select
            value={filters.ship}
            onChange={(e) => handleChange('ship', e.target.value)}
          >
            <option value="all">Tất cả ship</option>
            {allShips.map((ship) => (
              <option key={ship} value={ship}>
                {ship}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Intensity range */}
      <label className="filter-group">
        <span className="filter-label">
          Cường độ tối thiểu: <strong>{filters.minIntensity}+</strong>
        </span>
        <input
          type="range"
          min="1"
          max="10"
          value={filters.minIntensity}
          onChange={(e) => handleChange('minIntensity', parseInt(e.target.value, 10))}
        />
      </label>

      {/* Event type */}
      <label className="filter-group">
        <span className="filter-label">Loại sự kiện</span>
        <select
          value={filters._type}
          onChange={(e) => handleChange('_type', e.target.value)}
        >
          <option value="all">Tất cả loại</option>
          <option value="major">Sự kiện lớn</option>
          <option value="minor">Sự kiện nhỏ</option>
          <option value="twist">Plot twist</option>
          <option value="cliffhanger">Cliffhanger</option>
        </select>
      </label>

      <label className="filter-group">
        <span className="filter-label">Trạng thái duyệt</span>
        <select
          value={filters.reviewStatus || 'all'}
          onChange={(e) => handleChange('reviewStatus', e.target.value)}
        >
          <option value="all">Tất cả</option>
          <option value="auto_accepted">Tự động chấp nhận</option>
          <option value="needs_review">Cần duyệt</option>
        </select>
      </label>

      {/* Boolean filters */}
      <div className="filter-toggles">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filters.hasAnnotation}
            onChange={(e) => handleChange('hasAnnotation', e.target.checked)}
          />
          Có ghi chú
        </label>

        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filters.starred}
            onChange={(e) => handleChange('starred', e.target.checked)}
          />
          ⭐ Chỉ mục đã đánh sao
        </label>
      </div>
    </div>
  );
}
