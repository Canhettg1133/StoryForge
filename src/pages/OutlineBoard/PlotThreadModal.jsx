import React, { useState, useEffect } from 'react';
import usePlotStore from '../../stores/plotStore';
import { X, Save, AlertCircle } from 'lucide-react';

const PLOT_TYPES = [
    { value: 'main', label: 'Tuyến chính (Main)' },
    { value: 'subplot', label: 'Tuyến phụ (Subplot)' },
    { value: 'character_arc', label: 'Phát triển nhân vật (Arc)' },
    { value: 'mystery', label: 'Bí ẩn / Phá án' },
    { value: 'romance', label: 'Tình cảm (Romance)' }
];

const PLOT_STATES = [
    { value: 'active', label: 'Đang mở (Active)' },
    { value: 'resolved', label: 'Đã giải quyết (Resolved)' },
    { value: 'dropped', label: 'Đã hủy/Bỏ qua (Dropped)' }
];

export default function PlotThreadModal({ projectId, thread, onClose }) {
    const { createPlotThread, updatePlotThread } = usePlotStore();

    const [form, setForm] = useState({
        title: '',
        type: 'subplot',
        state: 'active',
        description: '',
        resolution: ''
    });

    useEffect(() => {
        if (thread) {
            setForm({
                title: thread.title || '',
                type: thread.type || 'subplot',
                state: thread.state || 'active',
                description: thread.description || '',
                resolution: thread.resolution || ''
            });
        }
    }, [thread]);

    const handleSave = async () => {
        if (!form.title.trim()) return;

        if (thread) {
            await updatePlotThread(thread.id, form);
        } else {
            await createPlotThread({ ...form, project_id: projectId });
        }
        onClose();
    };

    return (
        <div className="codex-modal-overlay" onClick={onClose}>
            <div className="codex-modal codex-modal--sm" onClick={e => e.stopPropagation()}>
                <div className="codex-modal-header">
                    <h3>{thread ? 'Sửa Tuyến truyện' : 'Thêm Tuyến truyện mới'}</h3>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div className="codex-modal-body">
                    <div className="form-group">
                        <label>Tên / Tiêu đề *</label>
                        <input
                            type="text"
                            className="input"
                            value={form.title}
                            onChange={e => setForm({ ...form, title: e.target.value })}
                            placeholder="Ví dụ: Truy vết tổ chức Hắc Phong..."
                            autoFocus
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Phân loại</label>
                            <select
                                className="select"
                                value={form.type}
                                onChange={e => setForm({ ...form, type: e.target.value })}
                            >
                                {PLOT_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Trạng thái</label>
                            <select
                                className="select"
                                value={form.state}
                                onChange={e => setForm({ ...form, state: e.target.value })}
                            >
                                {PLOT_STATES.map(s => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Mô tả chi tiết</label>
                        <textarea
                            className="textarea"
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            placeholder="Giải thích rõ mạch truyện này xoay quanh vấn đề gì, mục tiêu cuối cùng là gì. Để AI hiểu và duy trì mạch lạc ở các chương tiếp theo."
                            rows={3}
                        />
                        <span className="form-hint" style={{ color: 'var(--color-warning)' }}>
                            <AlertCircle size={10} style={{ display: 'inline', marginRight: 4 }} />
                            AI sẽ dựa vào mô tả này để nhắc nhở và tự động phát triển cốt truyện.
                        </span>
                    </div>

                    {(form.state === 'resolved' || form.state === 'dropped') && (
                        <div className="form-group">
                            <label>Kết quả / Diễn biến cuối</label>
                            <textarea
                                className="textarea"
                                value={form.resolution}
                                onChange={e => setForm({ ...form, resolution: e.target.value })}
                                placeholder="Tuyến truyện này đã kết thúc như thế nào?"
                                rows={2}
                            />
                        </div>
                    )}
                </div>

                <div className="codex-modal-footer">
                    <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={!form.title.trim()}
                    >
                        <Save size={15} /> {thread ? 'Lưu thay đổi' : 'Tạo mới'}
                    </button>
                </div>
            </div>
        </div>
    );
}
