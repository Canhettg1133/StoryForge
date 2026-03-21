import React, { useState, useEffect } from 'react';
import useArcGenStore from '../../stores/arcGenerationStore';
import {
    Bot, Sparkles, Wand2, X, Play, Loader2, CheckCircle2,
    AlertTriangle, Flag, RotateCcw, Save, Trash2, Eye, BookmarkPlus
} from 'lucide-react';
import './ArcGenerationModal.css';

export default function ArcGenerationModal({ projectId, genre, currentChapterCount, onClose }) {
    const arcStore = useArcGenStore();
    const [step, setStep] = useState(1);
    const [activeTab, setActiveTab] = useState('guided'); // 'guided' | 'auto'

    useEffect(() => {
        arcStore.resetArc();
    }, []);

    // Sync state between UI tabs and store mode
    useEffect(() => {
        arcStore.setArcConfig({ arcMode: activeTab });
    }, [activeTab]);

    const handleGenerateOutline = async () => {
        await arcStore.generateOutline({
            projectId,
            chapterIndex: currentChapterCount,
            genre
        });
        setStep(2);
    };

    const handleStartDrafting = async () => {
        setStep(3);
        await arcStore.startBatchDraft({
            projectId,
            genre,
            startingChapterIndex: currentChapterCount
        });
        setStep(4);
    };

    const handleRegenerateFrom = async (index) => {
        setStep(3);
        await arcStore.regenerateFromIndex({
            projectId,
            genre,
            fromIndex: index,
            startingChapterIndex: currentChapterCount
        });
        setStep(4);
    };

    const handleCommitOutlineOnly = async () => {
        await arcStore.commitOutlineOnly(projectId);
        onClose();
    };

    const handleCommit = async () => {
        await arcStore.commitDraftsToProject(projectId);
        onClose();
    };

    // ------------------------------------------
    // Render Step 1: Setup
    // ------------------------------------------
    const renderStep1 = () => (
        <div className="arc-step-content">
            <div className="arc-tabs">
                <button
                    className={`arc-tab ${activeTab === 'guided' ? 'arc-tab--active' : ''}`}
                    onClick={() => setActiveTab('guided')}
                >
                    <Bot size={16} /> Bán Tự Động (Guided)
                </button>
                <button
                    className={`arc-tab ${activeTab === 'auto' ? 'arc-tab--active' : ''}`}
                    onClick={() => setActiveTab('auto')}
                >
                    <Sparkles size={16} /> Đột Phá (Auto Brainstorm)
                </button>
            </div>

            <div className="arc-tab-content">
                {activeTab === 'guided' ? (
                    <>
                        <div className="form-group">
                            <label className="form-label">Mục tiêu của chặng này (Story Arc)</label>
                            <textarea
                                className="textarea"
                                rows={3}
                                placeholder="VD: Main đi vào Bí cảnh Huyết Nguyệt tìm thảo dược..."
                                value={arcStore.arcGoal}
                                onChange={(e) => arcStore.setArcConfig({ arcGoal: e.target.value })}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Số chương muốn tạo</label>
                                <input
                                    type="number"
                                    className="input"
                                    min="1" max="50"
                                    value={arcStore.arcChapterCount}
                                    onChange={(e) => arcStore.setArcConfig({ arcChapterCount: parseInt(e.target.value) || 1 })}
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Nhịp độ</label>
                                <select
                                    className="select"
                                    value={arcStore.arcPacing}
                                    onChange={(e) => arcStore.setArcConfig({ arcPacing: e.target.value })}
                                >
                                    <option value="slow">Chậm (Tập trung khám phá, xây dựng)</option>
                                    <option value="medium">Vừa (Cân bằng)</option>
                                    <option value="fast">Nhanh (Hành động, cao trào)</option>
                                </select>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="arc-auto-desc">
                            Hệ thống sẽ tự động bốc 1 Tuyến Truyện (Plot Thread) lâu chưa được nhắc tới,
                            kết hợp với 1 Sự Thật (Canon Fact) ngẫu nhiên để tạo ra rẽ nhánh bất ngờ.
                        </div>
                        <div className="form-group" style={{ maxWidth: '300px', margin: '0 auto' }}>
                            <label className="form-label">Số chương sinh ra</label>
                            <input
                                type="number"
                                className="input"
                                min="1" max="50"
                                value={arcStore.arcChapterCount}
                                onChange={(e) => arcStore.setArcConfig({ arcChapterCount: parseInt(e.target.value) || 1 })}
                            />
                        </div>
                    </>
                )}
            </div>

            <div className="arc-actions">
                <button
                    className="btn btn-primary"
                    onClick={handleGenerateOutline}
                    disabled={arcStore.outlineStatus === 'generating'}
                >
                    {arcStore.outlineStatus === 'generating' ? <Loader2 className="spin" /> : <Wand2 size={16} />}
                    Tạo Dàn Ý
                </button>
            </div>
        </div>
    );

    // ------------------------------------------
    // Render Step 2: Outline
    // ------------------------------------------
    const renderStep2 = () => {
        if (arcStore.outlineStatus === 'generating') {
            return (
                <div className="arc-loading-state">
                    <Loader2 size={48} className="spin" style={{ color: 'var(--color-primary)' }} />
                    <h3>Đang suy nghĩ dàn ý...</h3>
                    <p>Thu thập ngữ cảnh, tuyến truyện, milestone...</p>
                </div>
            );
        }

        if (arcStore.outlineStatus === 'error') {
            return (
                <div className="arc-loading-state">
                    <AlertTriangle size={48} style={{ color: 'var(--color-danger)' }} />
                    <h3>Có lỗi xảy ra khi tạo dàn ý</h3>
                    <button className="btn btn-primary mt-4" onClick={handleGenerateOutline}>Thử lại</button>
                </div>
            );
        }

        const { generatedOutline } = arcStore;
        if (!generatedOutline) return null;

        return (
            <div className="arc-step-content">
                <h3 className="arc-outline-title">{generatedOutline.arc_title || 'Dàn Ý Mới'}</h3>
                <p className="arc-subtitle">Chỉnh sửa lại dàn ý trước khi chốt để AI bắt đầu đắp thịt.</p>

                <div className="arc-outline-list">
                    {generatedOutline.chapters.map((ch, idx) => (
                        <div key={idx} className="arc-outline-card">
                            <div className="arc-outline-card-header">
                                <input
                                    className="input input-inline font-bold"
                                    value={ch.title}
                                    onChange={(e) => arcStore.updateOutlineChapter(idx, { title: e.target.value })}
                                />
                                <button
                                    className="btn btn-icon btn-ghost btn-sm text-danger"
                                    onClick={() => arcStore.removeOutlineChapter(idx)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <textarea
                                className="textarea mt-2"
                                rows={2}
                                value={ch.summary}
                                onChange={(e) => arcStore.updateOutlineChapter(idx, { summary: e.target.value })}
                            />
                            <div className="arc-outline-card-meta mt-2">
                                <span className="badge">Nhịp: {ch.pacing}</span>
                                <span className="badge border">{ch.key_events?.length || 0} sự kiện</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="arc-actions">
                    <button className="btn btn-ghost" onClick={() => setStep(1)}>Quay lại</button>
                    <button className="btn btn-primary" onClick={handleCommitOutlineOnly}>
                        <BookmarkPlus size={16} /> Lưu Dàn Ý
                    </button>
                    <button className="btn btn-accent" onClick={handleStartDrafting}>
                        <Play size={16} /> Đắp Thịt Tự Động
                    </button>
                </div>
            </div>
        );
    };

    // ------------------------------------------
    // Render Step 3: Drafting
    // ------------------------------------------
    const renderStep3 = () => (
        <div className="arc-step-content">
            <div className="arc-progress-header">
                <h3>Đang Đắp Thịt ({arcStore.draftProgress.current} / {arcStore.draftProgress.total})</h3>
                <div className="arc-progress-bar">
                    <div
                        className="arc-progress-fill"
                        style={{ width: `${(arcStore.draftProgress.current / arcStore.draftProgress.total) * 100}%` }}
                    />
                </div>
            </div>

            <div className="arc-draft-list">
                {arcStore.draftResults.map((result, idx) => (
                    <div key={idx} className={`arc-draft-card arc-draft-card--${result.status}`}>
                        <span className="arc-draft-title">C. {result.chapterIndex + 1}: {result.title}</span>
                        <div className="arc-draft-status">
                            {result.status === 'pending' && <span className="text-muted">Đang chờ...</span>}
                            {result.status === 'done' && <><CheckCircle2 size={14} className="text-success" /> {result.wordCount} từ</>}
                            {result.status === 'error' && <><AlertTriangle size={14} className="text-danger" /> Lỗi</>}
                        </div>
                    </div>
                ))}
            </div>

            <div className="arc-actions" style={{ justifyContent: 'center' }}>
                <button className="btn btn-ghost text-danger" onClick={() => {
                    arcStore.cancelDraft();
                    setStep(4); // Move to results with whatever we have
                }}>
                    Dừng Lại
                </button>
            </div>
        </div>
    );

    // ------------------------------------------
    // Render Step 4: Results & Feedback
    // ------------------------------------------
    const renderStep4 = () => (
        <div className="arc-step-content">
            <div className="arc-results-header">
                <h3>Hoàn Tất Tạo Quyển</h3>
                <p>Kiểm tra chất lượng các chương. Bạn có thể yêu cầu tạo lại từ một chương bất kỳ nếu thấy AI đi lệch hướng.</p>
            </div>

            <div className="arc-results-list">
                {arcStore.draftResults.map((result, idx) => (
                    <div key={idx} className={`arc-result-card ${result.status === 'flagged' ? 'arc-result-card--flagged' : ''}`}>
                        <div className="arc-result-header">
                            <strong className="arc-result-title">Chương {result.chapterIndex + 1}: {result.title}</strong>
                            <span className="arc-result-meta">{result.wordCount} từ</span>
                        </div>

                        <div className="arc-result-preview">
                            {result.content ? result.content.substring(0, 150) + '...' : '(Chưa viết xong)'}
                        </div>

                        {result.status === 'flagged' && (
                            <div className="arc-result-flag-input mt-2">
                                <input
                                    className="input input-sm"
                                    placeholder="Ghi chú lỗi sai (VD: Nhân vật này đã chết)..."
                                    value={result.flagNote || ''}
                                    onChange={(e) => arcStore.flagChapter(idx, e.target.value)}
                                />
                            </div>
                        )}

                        <div className="arc-result-actions">
                            <button
                                className={`btn btn-sm ${result.status === 'flagged' ? 'btn-danger' : 'btn-ghost'}`}
                                onClick={() => arcStore.flagChapter(idx, result.status === 'flagged' ? '' : 'Sai logic')}
                            >
                                <Flag size={12} /> {result.status === 'flagged' ? 'Bỏ Cờ' : 'Cắm Cờ Lỗi'}
                            </button>

                            <button
                                className="btn btn-sm btn-ghost text-warning"
                                onClick={() => handleRegenerateFrom(idx)}
                                title="Sẽ tạo lại chương này VÀ TẤT CẢ các chương sau nó"
                            >
                                <RotateCcw size={12} /> Tạo lại từ đây
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="arc-actions border-top pt-4">
                <button className="btn btn-ghost text-danger" onClick={onClose}>Hủy & Xóa Bỏ</button>
                <button className="btn btn-primary" onClick={handleCommit}>
                    <Save size={16} /> Lưu Tất Cả Vào Truyện
                </button>
            </div>
        </div>
    );

    return (
        <div className="arc-modal-overlay">
            <div className="arc-modal">
                <div className="arc-modal-header">
                    <h2><Sparkles size={20} style={{ color: 'var(--color-primary)' }} /> Tạo Chương Tự Động (Story Arc)</h2>
                    <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="arc-stepper">
                    {[1, 2, 3, 4].map(s => (
                        <div key={s} className={`arc-step ${step >= s ? 'arc-step--active' : ''}`}>
                            <div className="arc-step-num">{s}</div>
                            <div className="arc-step-label">
                                {s === 1 && 'Thiết Lập'}
                                {s === 2 && 'Dàn Ý'}
                                {s === 3 && 'Đắp Thịt'}
                                {s === 4 && 'Kết Quả'}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="arc-modal-body">
                    {step === 1 && renderStep1()}
                    {step === 2 && renderStep2()}
                    {step === 3 && renderStep3()}
                    {step === 4 && renderStep4()}
                </div>
            </div>
        </div>
    );
}
