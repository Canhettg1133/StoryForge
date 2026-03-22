import React, { useState } from 'react';
import { X, Download, FileText, Loader2, FileArchive } from 'lucide-react';
import { exportToTxt, exportToDocx } from '../../utils/exportService';

export default function ExportModal({ project, onClose }) {
    const [format, setFormat] = useState('docx');
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState(null);

    const handleExport = async () => {
        setIsExporting(true);
        setError(null);
        try {
            if (format === 'txt') {
                await exportToTxt(project.id);
            } else {
                await exportToDocx(project.id);
            }
            onClose(); // Đóng modal sau khi tải xong (hoặc trình duyệt đã bắt đầu tải)
        } catch (err) {
            console.error('Export failed:', err);
            setError('Đã xảy ra lỗi khi trích xuất dữ liệu. Vui lòng thử lại.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={!isExporting ? onClose : undefined}>
            <div className="modal animate-scale-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        <Download size={20} style={{ color: 'var(--color-accent)' }} />
                        {' '}Xuất bản Tác phẩm
                    </h2>
                    {!isExporting && (
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
                            <X size={18} />
                        </button>
                    )}
                </div>

                <div style={{ padding: '0 var(--space-5) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0, lineHeight: 1.5 }}>
                        Xuất toàn bộ hệ thống chương và nội dung của dự án <strong>{project.title}</strong> thành file offline.
                    </p>

                    <div className="form-group">
                        <label className="form-label">Định dạng file</label>
                        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                            <button
                                type="button"
                                className={`wizard-choice-btn ${format === 'docx' ? 'wizard-choice-btn--ai' : ''}`}
                                style={{ flex: 1, padding: 'var(--space-3)' }}
                                onClick={() => setFormat('docx')}
                                disabled={isExporting}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <FileText size={20} style={{ color: format === 'docx' ? 'var(--color-accent)' : 'inherit' }} />
                                    <strong>Word (.docx)</strong>
                                </div>
                            </button>

                            <button
                                type="button"
                                className={`wizard-choice-btn ${format === 'txt' ? 'wizard-choice-btn--ai' : ''}`}
                                style={{ flex: 1, padding: 'var(--space-3)' }}
                                onClick={() => setFormat('txt')}
                                disabled={isExporting}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <FileArchive size={20} style={{ color: format === 'txt' ? 'var(--color-accent)' : 'inherit' }} />
                                    <strong>Text (.txt)</strong>
                                </div>
                            </button>
                        </div>
                        {format === 'txt' && <span className="form-hint" style={{ marginTop: '8px' }}>File văn bản thô, dễ dàng sao chép.</span>}
                        {format === 'docx' && <span className="form-hint" style={{ marginTop: '8px' }}>Giữ nguyên cấu trúc phân chương, dễ chỉnh sửa lại.</span>}
                    </div>

                    {error && (
                        <div style={{ padding: 'var(--space-3)', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: 'var(--radius-md)', fontSize: '14px' }}>
                            {error}
                        </div>
                    )}

                    <div className="modal-actions" style={{ marginTop: 'var(--space-2)' }}>
                        <button className="btn btn-ghost" onClick={onClose} disabled={isExporting}>Hủy</button>
                        <button className="btn btn-primary" onClick={handleExport} disabled={isExporting}>
                            {isExporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                            {isExporting ? 'Đang tạo file...' : 'Tải xuống'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
