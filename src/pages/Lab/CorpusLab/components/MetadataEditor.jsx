import React from 'react';

const RATINGS = [
  { value: 'general', label: 'Mọi lứa tuổi' },
  { value: 'teen', label: 'Thiếu niên' },
  { value: 'mature', label: 'Trưởng thành' },
  { value: 'explicit', label: 'Nhạy cảm' },
];

const CANON_TYPES = [
  { value: '', label: 'Không chọn' },
  { value: 'canon', label: 'Canon' },
  { value: 'fanfic', label: 'Fanfic' },
  { value: 'both', label: 'Cả hai' },
];

export default function MetadataEditor({
  metadata,
  onChange,
  onSubmit,
  detectedFandom,
  disabled,
  canSubmit,
}) {
  return (
    <form
      className="corpus-card metadata-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <h3>Thông tin mô tả</h3>

      <label>
        <span>Tiêu đề</span>
        <input
          type="text"
          value={metadata.title || ''}
          onChange={(event) => onChange?.('title', event.target.value)}
          placeholder="Nhập tiêu đề"
          disabled={disabled}
        />
      </label>

      <label>
        <span>Tác giả</span>
        <input
          type="text"
          value={metadata.author || ''}
          onChange={(event) => onChange?.('author', event.target.value)}
          placeholder="Nhập tên tác giả"
          disabled={disabled}
        />
      </label>

      <label>
        <span>Fandom</span>
        <input
          type="text"
          value={metadata.fandom || ''}
          onChange={(event) => onChange?.('fandom', event.target.value)}
          placeholder="Ví dụ: naruto"
          disabled={disabled}
        />
      </label>

      {detectedFandom?.label && !metadata.fandom && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange?.('fandom', detectedFandom.fandom || detectedFandom.label)}
          disabled={disabled}
        >
          Dùng gợi ý: {detectedFandom.label} ({Math.round((detectedFandom.confidence || 0) * 100)}%)
        </button>
      )}

      <div className="metadata-row">
        <label>
          <span>Độ tuổi</span>
          <select
            value={metadata.rating || 'general'}
            onChange={(event) => onChange?.('rating', event.target.value)}
            disabled={disabled}
          >
            {RATINGS.map((rating) => (
              <option key={rating.value} value={rating.value}>{rating.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Canon/Fanfic</span>
          <select
            value={metadata.isCanonFanfic || ''}
            onChange={(event) => onChange?.('isCanonFanfic', event.target.value)}
            disabled={disabled}
          >
            {CANON_TYPES.map((item) => (
              <option key={item.value || 'none'} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label>
        <span>Ngôn ngữ</span>
        <input
          type="text"
          value={metadata.language || 'vi'}
          onChange={(event) => onChange?.('language', event.target.value)}
          placeholder="vi / en"
          disabled={disabled}
        />
      </label>

      <p className="metadata-note">
        Nút này chỉ tải file lên và tách chương. Chunk nội bộ vẫn được tạo ở backend để phục vụ grounding và phân tích về sau, nhưng không còn là bước cấu hình chính của bạn ở đây.
      </p>

      <button type="submit" className="btn btn-primary" disabled={disabled || !canSubmit}>
        Tải lên và tách chương
      </button>
    </form>
  );
}
