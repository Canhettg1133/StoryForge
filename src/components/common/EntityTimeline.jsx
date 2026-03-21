import React, { useEffect, useState } from 'react';
import useTimelineStore from '../../stores/timelineStore';
import useProjectStore from '../../stores/projectStore';
import { Clock, Plus, Trash2, Edit3 } from 'lucide-react';
import './EntityTimeline.css';

export default function EntityTimeline({ entityId, entityType }) {
    const { currentProject } = useProjectStore();
    const { timelineEvents, loadTimeline, createEvent, deleteEvent } = useTimelineStore();

    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ description: '', chapter_id: '', type: 'INFO_CHANGE' });

    useEffect(() => {
        if (currentProject) {
            loadTimeline(currentProject.id);
        }
    }, [currentProject?.id]);

    if (!entityId) {
        return <div className="timeline-empty">Lưu nhân vật trước khi thêm dòng thời gian.</div>;
    }

    // Lọc sự kiện của entity này
    const events = timelineEvents
        .filter(e => e.entity_id === entityId)
        .sort((a, b) => a.timestamp - b.timestamp);

    const handleCreate = async () => {
        if (!form.description.trim()) return;
        await createEvent({
            project_id: currentProject.id,
            entity_id: entityId,
            entity_type: entityType,
            type: form.type,
            chapter_id: form.chapter_id ? Number(form.chapter_id) : null,
            description: form.description,
        });
        setForm({ description: '', chapter_id: '', type: 'INFO_CHANGE' });
        setShowAdd(false);
    };

    return (
        <div className="entity-timeline">
            <div className="timeline-header">
                <h4><Clock size={16} /> Lịch sử & Trạng thái</h4>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(!showAdd)}>
                    <Plus size={14} /> Thêm kiện
                </button>
            </div>

            {showAdd && (
                <div className="timeline-add-box">
                    <input
                        type="text"
                        placeholder="Mô tả sự kiện (VD: Bị thương nặng...)"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        autoFocus
                    />
                    <div className="timeline-add-row">
                        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                            <option value="INFO_CHANGE">Thay đổi thông tin</option>
                            <option value="STATUS_CHANGE">Thay đổi trạng thái (Khỏe/Yếu)</option>
                            <option value="RELATION_CHANGE">Quan hệ</option>
                            <option value="APPEARANCE">Ngoại hình</option>
                        </select>
                        <input
                            type="number"
                            placeholder="Chương số"
                            value={form.chapter_id}
                            onChange={(e) => setForm({ ...form, chapter_id: e.target.value })}
                        />
                        <button className="btn btn-primary btn-sm" onClick={handleCreate}>Lưu</button>
                    </div>
                </div>
            )}

            {events.length === 0 ? (
                <div className="timeline-empty">
                    <p>Chưa có sự kiện nào. AI sẽ tự động ghi nhận khi bạn hoàn thành chương.</p>
                </div>
            ) : (
                <div className="timeline-stepper">
                    {events.map((ev, idx) => (
                        <div className="timeline-item" key={ev.id}>
                            <div className="timeline-dot" />
                            <div className="timeline-content">
                                <div className="timeline-meta">
                                    {ev.chapter_id ? `Chương ${ev.chapter_id}` : 'Chung'}
                                    <span className="timeline-type-badge">{ev.type}</span>
                                    <button className="btn btn-ghost btn-icon btn-sm timeline-del" onClick={() => deleteEvent(ev.id, currentProject.id)}>
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                                <p>{ev.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
