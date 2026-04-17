import React, { useEffect, useMemo, useState } from 'react';
import useArcGenStore from '../../stores/arcGenerationStore';
import {
    Bot, Sparkles, Wand2, X, Play, Loader2, CheckCircle2,
    AlertTriangle, Flag, RotateCcw, Save, Trash2, BookmarkPlus
} from 'lucide-react';
import './ArcGenerationModal.css';

const QUICK_ACTIONS = [
    { label: 'Làm chậm nhịp', prompt: 'Làm chậm nhịp, tăng phần xây dựng và hệ quả thay vì đẩy cao trào liên tục.' },
    { label: 'Tăng xây dựng', prompt: 'Tăng phần xây dựng, thêm chuẩn bị và hệ quả rõ hơn cho đợt chương này.' },
    { label: 'Giảm drama', prompt: 'Giảm drama và xung đột lớn, ưu tiên diễn biến tự nhiên hơn.' },
    { label: 'Giữ bí mật chưa lộ', prompt: 'Giữ các bí mật lớn chưa lộ, chỉ cho phép tối đa 1 tiết lộ nhỏ nếu cần.' },
    { label: 'Tăng đất diễn nhân vật', prompt: 'Tăng đất diễn cho nhân vật [tên nhân vật], nhưng không đẩy nhanh tuyến chính.' },
    { label: 'Thêm 1 chương đệm', prompt: 'Chèn ít nhất 1 chương đệm có phần chuẩn bị, xây dựng hoặc hệ quả để tránh dồn cốt truyện quá nhanh.' },
    { label: 'Đổi tiết lộ thành manh mối', prompt: 'Đổi các tiết lộ lớn hoặc phần giải quyết sớm thành manh mối nhỏ, hệ quả nhỏ, hoặc nghi vấn chưa kết luận.' },
];

const OUTPUT_MODES = [
    {
        id: 'outline_only',
        title: 'Chỉ tạo dàn ý',
        description: 'Sinh dàn ý, rà soát và lưu vào truyện. Không tạo bản nháp.',
    },
    {
        id: 'outline_review',
        title: 'Dàn ý + bản nháp mẫu',
        description: 'Sinh dàn ý và chỉ tạo thử vài chương mẫu để xem lại.',
    },
    {
        id: 'draft_selected',
        title: 'Chỉ tạo các chương đã chọn',
        description: 'Chỉ tạo bản nháp cho các chương được tick ở bước 2.',
    },
];

const PACING_LABELS = {
    slow: 'Chậm',
    medium: 'Vừa',
    fast: 'Nhanh',
};

const ISSUE_CODE_LABELS = {
    padding: 'Thiếu chất liệu',
    repetitive: 'Lặp ý',
    'too-fast': 'Quá nhanh',
    'premature-resolution': 'Giải quyết sớm',
};

const RESULT_STATUS_LABELS = {
    pending: 'Đang chờ...',
    error: 'Lỗi',
};

function localizeBudgetText(value) {
    return String(value || '')
        .replace(/at least one setup\/build-up\/consequence chapter/gi, 'ít nhất một chương làm nhiệm vụ chuẩn bị, xây dựng hoặc để lại hệ quả')
        .replace(/0-1 minor reveal/gi, '0-1 tiết lộ nhỏ')
        .replace(/1 minor reveal/gi, '1 tiết lộ nhỏ')
        .replace(/co the tang cap neu day la cuoi cot moc/gi, 'có thể tăng cấp nếu đây là cuối cột mốc')
        .replace(/khong vuot tier lon trong batch nay/gi, 'không vượt bậc sức mạnh lớn trong đợt này');
}

function formatProgressBudget(storyProgressBudget) {
    if (!storyProgressBudget) return [];
    const lines = [];
    if (storyProgressBudget.fromPercent != null && storyProgressBudget.toPercent != null) {
        lines.push(`Tiến độ đợt này: ${storyProgressBudget.fromPercent}% -> ${storyProgressBudget.toPercent}%`);
    }
    if (storyProgressBudget.mainPlotMaxStep != null) {
        lines.push(`Tuyến chính tối đa +${storyProgressBudget.mainPlotMaxStep} nấc`);
    }
    if (storyProgressBudget.romanceMaxStep != null) {
        lines.push(`Tuyến tình cảm tối đa +${storyProgressBudget.romanceMaxStep} nấc`);
    }
    if (storyProgressBudget.mysteryRevealAllowance) {
        lines.push(`Mức lộ bí ẩn: ${localizeBudgetText(storyProgressBudget.mysteryRevealAllowance)}`);
    }
    if (storyProgressBudget.powerProgressionCap) {
        lines.push(`Giới hạn tiến triển sức mạnh: ${localizeBudgetText(storyProgressBudget.powerProgressionCap)}`);
    }
    if (storyProgressBudget.requiredBeatMix) {
        lines.push(`Nhịp bắt buộc: ${localizeBudgetText(storyProgressBudget.requiredBeatMix)}`);
    }
    if (storyProgressBudget.nextMilestone?.label || storyProgressBudget.nextMilestone?.title) {
        const label = storyProgressBudget.nextMilestone.label || storyProgressBudget.nextMilestone.title;
        const percent = storyProgressBudget.nextMilestone.percent != null
            ? ` (${storyProgressBudget.nextMilestone.percent}%)`
            : '';
        lines.push(`Cột mốc tiếp theo: ${label}${percent}`);
    }
    return lines;
}

function getIssueLabel(issue, currentChapterCount) {
    if (issue?.chapterIndex == null) return 'Toàn bộ đợt';
    return `Chương ${currentChapterCount + issue.chapterIndex + 1}`;
}

function formatIssueCode(code) {
    return ISSUE_CODE_LABELS[code] || code;
}

function formatIssueMessage(message) {
    return String(message || '')
        .replace(/Chuong/gi, 'Chương')
        .replace(/summary/gi, 'tóm tắt')
        .replace(/thread/gi, 'tuyến truyện')
        .replace(/su kien/gi, 'sự kiện')
        .replace(/Chapter/gi, 'Chương')
        .replace(/purpose/gi, 'mục tiêu')
        .replace(/plot\/reveal/gi, 'cốt truyện hoặc tiết lộ')
        .replace(/budget tien do hien tai/gi, 'nhịp tiến độ hiện tại')
        .replace(/resolve som/gi, 'giải quyết sớm')
        .replace(/buildup\/setup\/consequence/gi, 'chuẩn bị, xây dựng hoặc hệ quả');
}

export default function ArcGenerationModal({ projectId, genre, currentChapterCount, onClose }) {
    const arcStore = useArcGenStore();
    const [step, setStep] = useState(1);
    const [activeTab, setActiveTab] = useState('guided');

    useEffect(() => {
        let ignore = false;
        arcStore.resetArc();
        (async () => {
            await arcStore.initializeArcGeneration({ projectId, currentChapterCount });
            if (!ignore) {
                setActiveTab(useArcGenStore.getState().arcMode || 'guided');
            }
        })();
        return () => {
            ignore = true;
        };
    }, [projectId, currentChapterCount]);

    useEffect(() => {
        arcStore.setArcConfig({ arcMode: activeTab });
    }, [activeTab]);

    const selectedMacroArc = useMemo(
        () => arcStore.availableMacroArcs.find((item) => item.id === arcStore.selectedMacroArcId) || null,
        [arcStore.availableMacroArcs, arcStore.selectedMacroArcId],
    );
    const progressBudgetLines = useMemo(
        () => formatProgressBudget(arcStore.storyProgressBudget),
        [arcStore.storyProgressBudget],
    );
    const validatorIssues = arcStore.outlineValidation?.issues || [];
    const hasBlockingIssues = !!arcStore.outlineValidation?.hasBlockingIssues;
    const selectedDraftCount = arcStore.selectedDraftIndexes?.length || 0;
    const batchWarning = arcStore.projectTargetLength >= 300
        && arcStore.arcChapterCount > arcStore.recommendedBatchCount;

    const appendRevisionPrompt = (extraPrompt) => {
        const current = (arcStore.outlineRevisionPrompt || '').trim();
        const next = current ? `${current}\n- ${extraPrompt}` : extraPrompt;
        arcStore.setArcConfig({ outlineRevisionPrompt: next });
    };

    const handleGenerateOutline = async () => {
        await arcStore.generateOutline({
            projectId,
            chapterIndex: currentChapterCount,
            genre,
        });
        if (useArcGenStore.getState().outlineStatus === 'ready') {
            setStep(2);
        }
    };

    const handleReviseOutline = async () => {
        const revised = await arcStore.reviseGeneratedOutline({
            projectId,
            chapterIndex: currentChapterCount,
            genre,
            instruction: arcStore.outlineRevisionPrompt,
        });
        if (revised) setStep(2);
    };

    const handleStartDrafting = async () => {
        setStep(3);
        const started = await arcStore.startBatchDraft({
            projectId,
            genre,
            startingChapterIndex: currentChapterCount,
        });
        setStep(started ? 4 : 2);
    };

    const handleRegenerateFrom = async (index) => {
        setStep(3);
        const started = await arcStore.regenerateFromIndex({
            projectId,
            genre,
            fromIndex: index,
            startingChapterIndex: currentChapterCount,
        });
        setStep(started ? 4 : 4);
    };

    const handleCommitOutlineOnly = async () => {
        const committed = await arcStore.commitOutlineOnly(projectId);
        if (committed) onClose();
    };

    const handleCommit = async () => {
        const committed = await arcStore.commitDraftsToProject(projectId);
        if (committed) onClose();
    };

    const renderOutputModes = () => (
        <div className="arc-mode-grid">
            {OUTPUT_MODES.map((mode) => (
                <button
                    key={mode.id}
                    className={`arc-mode-card ${arcStore.outputMode === mode.id ? 'arc-mode-card--active' : ''}`}
                    onClick={() => arcStore.setArcConfig({ outputMode: mode.id })}
                >
                    <strong>{mode.title}</strong>
                    <span>{mode.description}</span>
                </button>
            ))}
        </div>
    );

    const renderBudgetBox = () => (
        <div className="arc-budget-box">
            <div className="arc-budget-box__header">
                <strong>Ngân sách tiến độ truyện</strong>
                {selectedMacroArc && <span>{selectedMacroArc.title}</span>}
            </div>
            <div className="arc-budget-list">
                {progressBudgetLines.length > 0 ? progressBudgetLines.map((line) => (
                    <div key={line} className="arc-budget-line">{line}</div>
                )) : (
                    <div className="arc-budget-line">Chưa có dữ liệu tiến độ. Hệ thống sẽ tính sau khi chọn đợt chương và macro arc.</div>
                )}
            </div>
        </div>
    );

    const renderValidatorPanel = () => (
        <div className="arc-validator-panel">
            <div className="arc-validator-header">
                <div>
                    <h4>Kiểm tra dàn ý</h4>
                    <p>
                        Các lỗi `Thiếu chất liệu` và `Lặp ý` là cảnh báo.
                        Các lỗi `Quá nhanh` và `Giải quyết sớm` sẽ chặn tạo bản nháp, nhưng bạn vẫn có thể lưu dàn ý để sửa tiếp.
                    </p>
                </div>
                {hasBlockingIssues && (
                    <span className="arc-validator-badge arc-validator-badge--error">Đang bị chặn</span>
                )}
            </div>
            {hasBlockingIssues && (
                <div className="arc-warning-box">
                    Việc tạo bản nháp đang bị chặn để tránh dàn ý dồn cốt truyện quá nhanh. Bạn vẫn có thể lưu dàn ý để sửa tiếp trong truyện.
                    <div className="arc-quick-actions mt-2">
                        <button
                            className="arc-quick-action"
                            onClick={() => appendRevisionPrompt('Chèn ít nhất 1 chương đệm có phần chuẩn bị, xây dựng hoặc hệ quả để tránh dồn cốt truyện quá nhanh.')}
                        >
                            Thêm chương đệm
                        </button>
                        <button
                            className="arc-quick-action"
                            onClick={() => appendRevisionPrompt('Đổi các tiết lộ lớn hoặc phần giải quyết sớm thành manh mối nhỏ, hệ quả nhỏ, hoặc nghi vấn chưa kết luận.')}
                        >
                            Đổi tiết lộ thành manh mối
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={handleCommitOutlineOnly}>
                            Lưu dàn ý bất chấp
                        </button>
                    </div>
                </div>
            )}
            {validatorIssues.length === 0 ? (
                <div className="arc-validator-empty">Chưa thấy vấn đề đáng kể trong đợt dàn ý này.</div>
            ) : (
                <div className="arc-validator-list">
                    {validatorIssues.map((issue, index) => (
                        <div
                            key={`${issue.code}-${issue.chapterIndex ?? 'batch'}-${index}`}
                            className={`arc-validator-item arc-validator-item--${issue.severity}`}
                        >
                            <div className="arc-validator-item__top">
                                <span className="arc-validator-chip">{formatIssueCode(issue.code)}</span>
                                <span className="arc-validator-scope">{getIssueLabel(issue, currentChapterCount)}</span>
                            </div>
                            <div className="arc-validator-message">{formatIssueMessage(issue.message)}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderStep1 = () => (
        <div className="arc-step-content">
            <div className="arc-tabs">
                <button
                    className={`arc-tab ${activeTab === 'guided' ? 'arc-tab--active' : ''}`}
                    onClick={() => setActiveTab('guided')}
                >
                    <Bot size={16} /> Có định hướng
                </button>
                <button
                    className={`arc-tab ${activeTab === 'auto' ? 'arc-tab--active' : ''}`}
                    onClick={() => setActiveTab('auto')}
                >
                    <Sparkles size={16} /> Tự động gợi ý
                </button>
            </div>

            {renderOutputModes()}

            <div className="arc-tab-content">
                {activeTab === 'guided' ? (
                    <div className="form-group">
                        <label className="form-label">Mục tiêu của đợt dàn ý này</label>
                        <textarea
                            className="textarea"
                            rows={3}
                            placeholder="VD: Nhân vật chính đi vào bế cảnh, mở một tuyến truyện mới, tăng phần xây dựng, chưa lộ bí mật lớn..."
                            value={arcStore.arcGoal}
                            onChange={(e) => arcStore.setArcConfig({ arcGoal: e.target.value })}
                        />
                    </div>
                ) : (
                    <div className="arc-auto-desc">
                        Chế độ tự động sẽ tự lấy các tuyến truyện và dữ kiện canon để gợi ý đợt chương tiếp theo.
                        Kết quả vẫn bị ràng buộc bởi nhịp tiến độ và macro arc.
                    </div>
                )}

                <div className="arc-config-grid">
                    <div className="form-group">
                        <label className="form-label">Số chương muốn tạo</label>
                        <input
                            type="number"
                            className="input"
                            min="1"
                            max="20"
                            value={arcStore.arcChapterCount}
                            onChange={(e) => arcStore.setArcConfig({ arcChapterCount: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        />
                        <div className="arc-help-text">
                            Đề xuất hiện tại: {arcStore.recommendedBatchCount} chương cho tổng độ dài {arcStore.projectTargetLength || 'chưa đặt'}.
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Nhịp độ</label>
                        <select
                            className="select"
                            value={arcStore.arcPacing}
                            onChange={(e) => arcStore.setArcConfig({ arcPacing: e.target.value })}
                        >
                            <option value="slow">Chậm</option>
                            <option value="medium">Vừa</option>
                            <option value="fast">Nhanh</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Đại cục hiện hành</label>
                        <select
                            className="select"
                            value={arcStore.selectedMacroArcId || ''}
                            onChange={(e) => {
                                const value = e.target.value ? Number(e.target.value) : null;
                                arcStore.setArcConfig({ selectedMacroArcId: value });
                            }}
                        >
                            <option value="">Không khóa theo macro arc</option>
                            {arcStore.availableMacroArcs.map((macroArc) => (
                                <option key={macroArc.id} value={macroArc.id}>
                                    {macroArc.title}
                                    {macroArc.chapter_from && macroArc.chapter_to
                                        ? ` (${macroArc.chapter_from}-${macroArc.chapter_to})`
                                        : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {batchWarning && (
                    <div className="arc-warning-box">
                        Đợt chương hiện tại vượt mức đề xuất cho truyện dài. Hệ thống vẫn có thể tạo,
                        nhưng nguy cơ dồn cốt truyện quá nhanh và sinh chương rời rạc sẽ tăng.
                    </div>
                )}

                {renderBudgetBox()}
            </div>

            <div className="arc-actions">
                <button
                    className="btn btn-primary"
                    onClick={handleGenerateOutline}
                    disabled={arcStore.outlineStatus === 'generating'}
                >
                    {arcStore.outlineStatus === 'generating' ? <Loader2 className="spin" /> : <Wand2 size={16} />}
                    Tạo dàn ý
                </button>
            </div>
        </div>
    );

    const renderStep2 = () => {
        if (arcStore.outlineStatus === 'generating') {
            return (
                <div className="arc-loading-state">
                    <Loader2 size={48} className="spin" style={{ color: 'var(--color-primary)' }} />
                    <h3>Đang xử lý dàn ý...</h3>
                    <p>Hệ thống đang dựng lại dàn ý theo macro arc, nhịp tiến độ và ghi chú chỉnh sửa.</p>
                </div>
            );
        }

        if (arcStore.outlineStatus === 'error') {
            return (
                <div className="arc-loading-state">
                    <AlertTriangle size={48} style={{ color: 'var(--color-danger)' }} />
                    <h3>Không tạo được dàn ý</h3>
                    <button className="btn btn-primary mt-4" onClick={handleGenerateOutline}>Thử lại</button>
                </div>
            );
        }

        if (!arcStore.generatedOutline) return null;

        const primaryLabel = arcStore.outputMode === 'outline_only'
            ? (hasBlockingIssues ? 'Lưu dàn ý bất chấp' : 'Lưu dàn ý')
            : arcStore.outputMode === 'outline_review'
                ? 'Tạo bản nháp để xem'
                : 'Tạo các chương đã chọn';
        const primaryAction = arcStore.outputMode === 'outline_only'
            ? handleCommitOutlineOnly
            : handleStartDrafting;

        return (
            <div className="arc-step-content">
                <div className="arc-outline-head">
                    <div>
                        <h3 className="arc-outline-title">{arcStore.generatedOutline.arc_title || 'Dàn ý mới'}</h3>
                        <p className="arc-subtitle">
                            Bạn có thể sửa tay, khóa theo macro arc, chọn chương cần tạo bản nháp, hoặc đưa ghi chú để AI chỉnh lại dàn ý hiện tại.
                        </p>
                    </div>
                    <div className="arc-outline-head__meta">
                        <span className="badge">{arcStore.generatedOutline.chapters.length} chương</span>
                        <span className="badge border">{selectedDraftCount} chương được chọn để tạo bản nháp</span>
                    </div>
                </div>

                {renderBudgetBox()}
                {renderValidatorPanel()}

                <div className="arc-revise-box">
                    <div className="form-group">
                        <label className="form-label">Sửa dàn ý theo ý tôi</label>
                        <textarea
                            className="textarea"
                            rows={3}
                            placeholder="VD: Giữ bí mật lớn chưa lộ, thêm 1 chương đệm, tăng đất diễn cho nhân vật X..."
                            value={arcStore.outlineRevisionPrompt}
                            onChange={(e) => arcStore.setArcConfig({ outlineRevisionPrompt: e.target.value })}
                        />
                    </div>
                    <div className="arc-quick-actions">
                        {QUICK_ACTIONS.map((action) => (
                            <button
                                key={action.label}
                                className="arc-quick-action"
                                onClick={() => appendRevisionPrompt(action.prompt)}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                    <div className="arc-actions arc-actions--compact">
                        <button
                            className="btn btn-secondary"
                            onClick={handleReviseOutline}
                            disabled={arcStore.outlineStatus === 'generating' || !(arcStore.outlineRevisionPrompt || '').trim()}
                        >
                            {arcStore.outlineStatus === 'generating' ? <Loader2 className="spin" /> : <Sparkles size={16} />}
                            AI chỉnh lại dàn ý
                        </button>
                    </div>
                </div>

                <div className="arc-outline-list">
                    {arcStore.generatedOutline.chapters.map((chapter, index) => {
                        const issueCount = validatorIssues.filter((issue) => issue.chapterIndex === index).length;
                        const checked = arcStore.selectedDraftIndexes.includes(index);
                        return (
                            <div key={index} className="arc-outline-card">
                                <div className="arc-outline-card-header arc-outline-card-header--top">
                                    <label className="arc-outline-select">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => arcStore.toggleDraftIndex(index)}
                                        />
                                        <span>Tạo bản nháp chương này</span>
                                    </label>
                                    <div className="arc-outline-card-header__actions">
                                        {issueCount > 0 && <span className="badge border">{issueCount} cảnh báo</span>}
                                        <button
                                            className="btn btn-icon btn-ghost btn-sm text-danger"
                                            onClick={() => arcStore.removeOutlineChapter(index)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <input
                                    className="input input-inline font-bold"
                                    value={chapter.title}
                                    onChange={(e) => arcStore.updateOutlineChapter(index, { title: e.target.value })}
                                />

                                <textarea
                                    className="textarea mt-2"
                                    rows={2}
                                    placeholder="Mục tiêu của chương..."
                                    value={chapter.purpose || ''}
                                    onChange={(e) => arcStore.updateOutlineChapter(index, { purpose: e.target.value })}
                                />

                                <textarea
                                    className="textarea mt-2"
                                    rows={3}
                                    value={chapter.summary}
                                    onChange={(e) => arcStore.updateOutlineChapter(index, { summary: e.target.value })}
                                />

                                <div className="arc-outline-card-meta mt-2">
                                    <span className="badge">Nhịp: {PACING_LABELS[chapter.pacing] || PACING_LABELS.medium}</span>
                                    <span className="badge border">{chapter.key_events?.length || 0} sự kiện</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="arc-actions">
                    <button className="btn btn-ghost" onClick={() => setStep(1)}>Quay lại</button>
                    <button
                        className="btn btn-primary"
                        onClick={primaryAction}
                        disabled={arcStore.outputMode !== 'outline_only' && (selectedDraftCount === 0 || hasBlockingIssues)}
                    >
                        {arcStore.outputMode === 'outline_only' ? <BookmarkPlus size={16} /> : <Play size={16} />}
                        {primaryLabel}
                    </button>
                    {arcStore.outputMode !== 'outline_only' && (
                        <button className="btn btn-secondary" onClick={handleCommitOutlineOnly}>
                            <BookmarkPlus size={16} /> {hasBlockingIssues ? 'Lưu dàn ý bất chấp' : 'Lưu dàn ý trước'}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const renderStep3 = () => {
        const total = Math.max(arcStore.draftProgress.total || 0, 1);
        const progress = Math.min(100, ((arcStore.draftProgress.current || 0) / total) * 100);
        return (
            <div className="arc-step-content">
                <div className="arc-progress-header">
                    <h3>Đang tạo bản nháp ({arcStore.draftProgress.current} / {arcStore.draftProgress.total})</h3>
                    <div className="arc-progress-bar">
                        <div className="arc-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                </div>

                <div className="arc-draft-list">
                    {arcStore.draftResults.map((result, index) => (
                        <div key={`${result.chapterIndex}-${index}`} className={`arc-draft-card arc-draft-card--${result.status}`}>
                            <span className="arc-draft-title">
                                C. {result.chapterIndex + 1}: {result.title}
                            </span>
                            <div className="arc-draft-status">
                                {result.status === 'pending' && <span className="text-muted">{RESULT_STATUS_LABELS.pending}</span>}
                                {result.status === 'done' && <><CheckCircle2 size={14} className="text-success" /> {result.wordCount} từ</>}
                                {result.status === 'error' && <><AlertTriangle size={14} className="text-danger" /> {RESULT_STATUS_LABELS.error}</>}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="arc-actions" style={{ justifyContent: 'center' }}>
                    <button
                        className="btn btn-ghost text-danger"
                        onClick={() => {
                            arcStore.cancelDraft();
                            setStep(4);
                        }}
                    >
                        Dừng lại
                    </button>
                </div>
            </div>
        );
    };

    const renderStep4 = () => (
        <div className="arc-step-content">
            <div className="arc-results-header">
                <h3>Đã tạo xong các chương đã chọn</h3>
                <p>Xem lại các bản nháp mẫu, đánh cờ nếu sai logic, và có thể tạo lại từ bất kỳ bản nháp nào trở đi.</p>
            </div>

            <div className="arc-results-list">
                {arcStore.draftResults.map((result, index) => (
                    <div key={`${result.chapterIndex}-${index}`} className={`arc-result-card ${result.status === 'flagged' ? 'arc-result-card--flagged' : ''}`}>
                        <div className="arc-result-header">
                            <strong className="arc-result-title">Chương {result.chapterIndex + 1}: {result.title}</strong>
                            <span className="arc-result-meta">{result.wordCount} từ</span>
                        </div>

                        <div className="arc-result-preview">
                            {result.content ? `${result.content.substring(0, 180)}...` : '(Chưa viết xong)'}
                        </div>

                        {result.status === 'flagged' && (
                            <div className="arc-result-flag-input mt-2">
                                <input
                                    className="input input-sm"
                                    placeholder="Ghi chú cần sửa..."
                                    value={result.flagNote || ''}
                                    onChange={(e) => arcStore.flagChapter(index, e.target.value)}
                                />
                            </div>
                        )}

                        <div className="arc-result-actions">
                            <button
                                className={`btn btn-sm ${result.status === 'flagged' ? 'btn-danger' : 'btn-ghost'}`}
                                onClick={() => arcStore.flagChapter(index, result.status === 'flagged' ? '' : 'Sai logic / lech huong')}
                            >
                                <Flag size={12} /> {result.status === 'flagged' ? 'Bỏ cờ' : 'Cắm cờ lỗi'}
                            </button>

                            <button
                                className="btn btn-sm btn-ghost text-warning"
                                onClick={() => handleRegenerateFrom(index)}
                                title="Sẽ tạo lại bản nháp này và các bản nháp được chọn sau nó"
                            >
                                <RotateCcw size={12} /> Tạo lại từ đây
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="arc-actions border-top pt-4">
                <button className="btn btn-ghost text-danger" onClick={onClose}>Đóng</button>
                <button className="btn btn-secondary" onClick={handleCommitOutlineOnly} disabled={hasBlockingIssues}>
                    <BookmarkPlus size={16} /> Lưu dàn ý
                </button>
                <button className="btn btn-primary" onClick={handleCommit}>
                    <Save size={16} /> Lưu bản nháp vào truyện
                </button>
            </div>
        </div>
    );

    return (
        <div className="arc-modal-overlay">
            <div className="arc-modal">
                <div className="arc-modal-header">
                    <h2><Sparkles size={20} style={{ color: 'var(--color-primary)' }} /> Tạo chương tự động</h2>
                    <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="arc-stepper">
                    {[1, 2, 3, 4].map((item) => (
                        <div key={item} className={`arc-step ${step >= item ? 'arc-step--active' : ''}`}>
                            <div className="arc-step-num">{item}</div>
                            <div className="arc-step-label">
                                {item === 1 && 'Thiết lập'}
                                {item === 2 && 'Dàn ý'}
                                {item === 3 && 'Bản nháp'}
                                {item === 4 && 'Kết quả'}
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
