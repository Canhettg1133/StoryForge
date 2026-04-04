/**
 * ExportModal - Export events to various formats
 */

import { useState } from 'react';
import { exportEvents, downloadFile, copyToClipboard, getExportFilename } from '../../../../services/viewer/exportService.js';

const FORMAT_OPTIONS = [
  { value: 'markdown', label: 'Markdown', desc: 'Dùng cho ghi chú và tài liệu' },
  { value: 'json', label: 'JSON', desc: 'Dùng để sao lưu và import' },
  { value: 'csv', label: 'CSV', desc: 'Dùng cho bảng tính' },
  { value: 'clipboard', label: 'Sao chép clipboard', desc: 'Dán trực tiếp' },
];

const OPTIONS = [
  { key: 'includeAnnotations', label: 'Bao gồm ghi chú' },
  { key: 'includeCharacterInfo', label: 'Bao gồm thông tin nhân vật' },
  { key: 'includeChapterRefs', label: 'Bao gồm tham chiếu chương' },
  { key: 'includeTags', label: 'Bao gồm tag' },
  { key: 'includeRarity', label: 'Bao gồm độ hiếm' },
  { key: 'includeIntensity', label: 'Bao gồm cường độ' },
];

export default function ExportModal({ selectedItems, onClose, onExport }) {
  const [format, setFormat] = useState('markdown');
  const [options, setOptions] = useState({
    includeAnnotations: true,
    includeCharacterInfo: true,
    includeChapterRefs: true,
    includeTags: true,
    includeRarity: true,
    includeIntensity: false,
  });
  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(null);

  const loadPreview = async () => {
    setPreviewLoading(true);
    try {
      const text = await exportEvents(selectedItems, { ...options, format });
      setPreview(text);
    } catch {
      setPreview('Lỗi tạo xem trước.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportSuccess(null);

    try {
      if (format === 'clipboard') {
        const text = await exportEvents(selectedItems, { ...options, format });
        await copyToClipboard(text);
        setExportSuccess('Đã sao chép vào clipboard.');
      } else {
        const text = await exportEvents(selectedItems, { ...options, format });
        const mimeTypes = {
          markdown: 'text/markdown',
          md: 'text/markdown',
          json: 'application/json',
          csv: 'text/csv',
        };
        downloadFile(text, getExportFilename(format), mimeTypes[format] || 'text/plain');
        setExportSuccess(`Đã tải xuống ${getExportFilename(format)}`);
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setExportSuccess(`Lỗi: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const toggleOption = (key) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="export-modal-backdrop" onClick={onClose}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3>Xuất sự kiện ({selectedItems.length} mục đã chọn)</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="export-modal-body">
          {/* Format selection */}
          <div className="export-format-section">
            <h4>Định dạng</h4>
            <div className="format-options">
              {FORMAT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`format-option ${format === opt.value ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={opt.value}
                    checked={format === opt.value}
                    onChange={() => setFormat(opt.value)}
                  />
                  <span className="format-label">{opt.label}</span>
                  <span className="format-desc">{opt.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="export-options-section">
            <h4>Tùy chọn</h4>
            <div className="export-options-grid">
              {OPTIONS.map((opt) => (
                <label key={opt.key} className="export-option">
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="export-preview-section">
            <div className="preview-header">
              <h4>Xem trước</h4>
              <button
                className="btn-preview"
                onClick={loadPreview}
                disabled={previewLoading}
              >
                {previewLoading ? 'Đang tải...' : 'Làm mới xem trước'}
              </button>
            </div>
            <div className="preview-content">
              {preview ? (
                <pre>{preview.substring(0, 1000)}{preview.length > 1000 ? '\n...' : ''}</pre>
              ) : (
                <p className="preview-empty">Nhấn "Làm mới xem trước" để xem dữ liệu.</p>
              )}
            </div>
          </div>
        </div>

        <div className="export-modal-actions">
          {exportSuccess && (
            <span className="export-success">{exportSuccess}</span>
          )}
          <button className="btn-cancel" onClick={onClose}>Hủy</button>
          <button className="btn-export" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Đang xuất...' : format === 'clipboard' ? 'Sao chép' : 'Tải xuống'}
          </button>
        </div>
      </div>
    </div>
  );
}
