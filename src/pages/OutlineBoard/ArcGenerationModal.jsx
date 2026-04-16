import React, { useEffect, useMemo, useState } from 'react';
import useArcGenStore from '../../stores/arcGenerationStore';
import {
    Bot, Sparkles, Wand2, X, Play, Loader2, CheckCircle2,
    AlertTriangle, Flag, RotateCcw, Save, Trash2, BookmarkPlus
} from 'lucide-react';
import './ArcGenerationModal.css';

const QUICK_ACTIONS = [
    { label: 'Lam cham nhip', prompt: 'Lam cham nhip, tang buildup va he qua thay vi day cao trao lien tuc.' },
    { label: 'Tang build-up', prompt: 'Tang build-up, them setup va consequence ro hon cho batch nay.' },
    { label: 'Giam drama', prompt: 'Giam drama va xung dot lon, uu tien dien bien tu nhien hon.' },
    { label: 'Giu bi mat chua lo', prompt: 'Giu cac bi mat lon chua lo, chi cho phep toi da 1 reveal nho neu can.' },
    { label: 'Tang dat dien nhan vat', prompt: 'Tang dat dien cho nhan vat [ten nhan vat], nhung khong day nhanh main plot.' },
    { label: 'Them 1 chuong dem', prompt: 'Chen it nhat 1 chuong dem co setup/build-up/consequence de tranh dot plot qua nhanh.' },
    { label: 'Doi reveal thanh manh moi', prompt: 'Doi cac reveal lon/giai quyet som thanh manh moi nho, he qua nho, hoac nghi van chua ket luan.' },
];

function formatProgressBudget(storyProgressBudget) {
    if (!storyProgressBudget) return [];
    const lines = [];
    if (storyProgressBudget.fromPercent != null && storyProgressBudget.toPercent != null) {
        lines.push(`Tien do batch: ${storyProgressBudget.fromPercent}% -> ${storyProgressBudget.toPercent}%`);
    }
    if (storyProgressBudget.mainPlotMaxStep != null) {
        lines.push(`Main plot toi da +${storyProgressBudget.mainPlotMaxStep} nac`);
    }
    if (storyProgressBudget.romanceMaxStep != null) {
        lines.push(`Romance toi da +${storyProgressBudget.romanceMaxStep} nac`);
    }
    if (storyProgressBudget.mysteryRevealAllowance) {
        lines.push(`Reveal bi an: ${storyProgressBudget.mysteryRevealAllowance}`);
    }
    if (storyProgressBudget.powerProgressionCap) {
        lines.push(`Power progression: ${storyProgressBudget.powerProgressionCap}`);
    }
    if (storyProgressBudget.requiredBeatMix) {
        lines.push(`Beat mix: ${storyProgressBudget.requiredBeatMix}`);
    }
    if (storyProgressBudget.nextMilestone?.label || storyProgressBudget.nextMilestone?.title) {
        const label = storyProgressBudget.nextMilestone.label || storyProgressBudget.nextMilestone.title;
        const percent = storyProgressBudget.nextMilestone.percent != null
            ? ` (${storyProgressBudget.nextMilestone.percent}%)`
            : '';
        lines.push(`Milestone tiep theo: ${label}${percent}`);
    }
    return lines;
}

function getIssueLabel(issue, currentChapterCount) {
    if (issue?.chapterIndex == null) return 'Toan batch';
    return `Chuong ${currentChapterCount + issue.chapterIndex + 1}`;
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
            {[
                {
                    id: 'outline_only',
                    title: 'Outline only',
                    description: 'Sinh outline, review, luu vao truyyen. Khong draft.',
                },
                {
                    id: 'outline_review',
                    title: 'Outline + review',
                    description: 'Sinh outline va chi draft mot vai chuong mau de review.',
                },
                {
                    id: 'draft_selected',
                    title: 'Draft selected chapters only',
                    description: 'Chi draft cac chuong duoc tick o step 2.',
                },
            ].map((mode) => (
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
                <strong>Story Progress Budget</strong>
                {selectedMacroArc && <span>{selectedMacroArc.title}</span>}
            </div>
            <div className="arc-budget-list">
                {progressBudgetLines.length > 0 ? progressBudgetLines.map((line) => (
                    <div key={line} className="arc-budget-line">{line}</div>
                )) : (
                    <div className="arc-budget-line">Chua co budget. He thong se tinh sau khi chon batch va macro arc.</div>
                )}
            </div>
        </div>
    );

    const renderValidatorPanel = () => (
        <div className="arc-validator-panel">
            <div className="arc-validator-header">
                <div>
                    <h4>Outline Validator</h4>
                    <p>
                        `padding` va `repetitive` la canh bao.
                        `too-fast` va `premature-resolution` se chan draft, nhung van co the luu outline de sua tiep.
                    </p>
                </div>
                {hasBlockingIssues && (
                    <span className="arc-validator-badge arc-validator-badge--error">Dang bi chan</span>
                )}
            </div>
            {hasBlockingIssues && (
                <div className="arc-warning-box">
                    Draft dang bi chan de tranh outline day plot qua nhanh. Ban van co the luu outline de sua tiep trong truyen.
                    <div className="arc-quick-actions mt-2">
                        <button
                            className="arc-quick-action"
                            onClick={() => appendRevisionPrompt('Chen it nhat 1 chuong dem co setup/build-up/consequence de tranh dot plot qua nhanh.')}
                        >
                            Them chapter dem
                        </button>
                        <button
                            className="arc-quick-action"
                            onClick={() => appendRevisionPrompt('Doi cac reveal lon/giai quyet som thanh manh moi nho, he qua nho, hoac nghi van chua ket luan.')}
                        >
                            Doi reveal thanh manh moi
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={handleCommitOutlineOnly}>
                            Luu outline bat chap
                        </button>
                    </div>
                </div>
            )}
            {validatorIssues.length === 0 ? (
                <div className="arc-validator-empty">Chua thay van de dang ke trong batch outline nay.</div>
            ) : (
                <div className="arc-validator-list">
                    {validatorIssues.map((issue, index) => (
                        <div
                            key={`${issue.code}-${issue.chapterIndex ?? 'batch'}-${index}`}
                            className={`arc-validator-item arc-validator-item--${issue.severity}`}
                        >
                            <div className="arc-validator-item__top">
                                <span className="arc-validator-chip">{issue.code}</span>
                                <span className="arc-validator-scope">{getIssueLabel(issue, currentChapterCount)}</span>
                            </div>
                            <div className="arc-validator-message">{issue.message}</div>
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
                    <Bot size={16} /> Guided
                </button>
                <button
                    className={`arc-tab ${activeTab === 'auto' ? 'arc-tab--active' : ''}`}
                    onClick={() => setActiveTab('auto')}
                >
                    <Sparkles size={16} /> Auto Brainstorm
                </button>
            </div>

            {renderOutputModes()}

            <div className="arc-tab-content">
                {activeTab === 'guided' ? (
                    <div className="form-group">
                        <label className="form-label">Muc tieu batch outline nay</label>
                        <textarea
                            className="textarea"
                            rows={3}
                            placeholder="VD: Main di vao bi canh, mo mot thread moi, tang buildup, khong lo dai bi mat..."
                            value={arcStore.arcGoal}
                            onChange={(e) => arcStore.setArcConfig({ arcGoal: e.target.value })}
                        />
                    </div>
                ) : (
                    <div className="arc-auto-desc">
                        Auto mode se tu lay plot thread + canon fact de brainstorm batch tiep theo.
                        Prompt van bi rang buoc boi progress budget va macro arc.
                    </div>
                )}

                <div className="arc-config-grid">
                    <div className="form-group">
                        <label className="form-label">So chuong muon tao</label>
                        <input
                            type="number"
                            className="input"
                            min="1"
                            max="20"
                            value={arcStore.arcChapterCount}
                            onChange={(e) => arcStore.setArcConfig({ arcChapterCount: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        />
                        <div className="arc-help-text">
                            De xuat hien tai: {arcStore.recommendedBatchCount} chuong cho target_length {arcStore.projectTargetLength || 'chua set'}.
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Nhip do</label>
                        <select
                            className="select"
                            value={arcStore.arcPacing}
                            onChange={(e) => arcStore.setArcConfig({ arcPacing: e.target.value })}
                        >
                            <option value="slow">Slow</option>
                            <option value="medium">Medium</option>
                            <option value="fast">Fast</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Macro arc</label>
                        <select
                            className="select"
                            value={arcStore.selectedMacroArcId || ''}
                            onChange={(e) => {
                                const value = e.target.value ? Number(e.target.value) : null;
                                arcStore.setArcConfig({ selectedMacroArcId: value });
                            }}
                        >
                            <option value="">Khong khoa macro arc</option>
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
                        Batch hien tai vuot muc de xuat cho truyyen dai. He thong se van sinh,
                        nhung nguy co day nhanh plot va tao chuong rac se tang.
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
                    Tao dan y
                </button>
            </div>
        </div>
    );

    const renderStep2 = () => {
        if (arcStore.outlineStatus === 'generating') {
            return (
                <div className="arc-loading-state">
                    <Loader2 size={48} className="spin" style={{ color: 'var(--color-primary)' }} />
                    <h3>Dang xu ly dan y...</h3>
                    <p>He thong dang rebuild outline theo macro arc, budget va note sua.</p>
                </div>
            );
        }

        if (arcStore.outlineStatus === 'error') {
            return (
                <div className="arc-loading-state">
                    <AlertTriangle size={48} style={{ color: 'var(--color-danger)' }} />
                    <h3>Khong tao duoc dan y</h3>
                    <button className="btn btn-primary mt-4" onClick={handleGenerateOutline}>Thu lai</button>
                </div>
            );
        }

        if (!arcStore.generatedOutline) return null;

        const primaryLabel = arcStore.outputMode === 'outline_only'
            ? (hasBlockingIssues ? 'Luu outline bat chap' : 'Luu outline')
            : arcStore.outputMode === 'outline_review'
                ? 'Draft de review'
                : 'Draft cac chuong da chon';
        const primaryAction = arcStore.outputMode === 'outline_only'
            ? handleCommitOutlineOnly
            : handleStartDrafting;

        return (
            <div className="arc-step-content">
                <div className="arc-outline-head">
                    <div>
                        <h3 className="arc-outline-title">{arcStore.generatedOutline.arc_title || 'Dan y moi'}</h3>
                        <p className="arc-subtitle">
                            Sua tay, khoa macro arc, chon chuong can draft, hoac dua note de AI revise dan y hien tai.
                        </p>
                    </div>
                    <div className="arc-outline-head__meta">
                        <span className="badge">{arcStore.generatedOutline.chapters.length} chuong</span>
                        <span className="badge border">{selectedDraftCount} chuong duoc chon de draft</span>
                    </div>
                </div>

                {renderBudgetBox()}
                {renderValidatorPanel()}

                <div className="arc-revise-box">
                    <div className="form-group">
                        <label className="form-label">Sua dan y theo y toi</label>
                        <textarea
                            className="textarea"
                            rows={3}
                            placeholder="VD: Giu bi mat lon chua lo, them 1 chuong buildup, tang dat dien cho nhan vat X..."
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
                            AI chinh lai dan y
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
                                        <span>Draft chuong nay</span>
                                    </label>
                                    <div className="arc-outline-card-header__actions">
                                        {issueCount > 0 && <span className="badge border">{issueCount} flag</span>}
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
                                    placeholder="Purpose cua chuong..."
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
                                    <span className="badge">Nhip: {chapter.pacing || 'medium'}</span>
                                    <span className="badge border">{chapter.key_events?.length || 0} su kien</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="arc-actions">
                    <button className="btn btn-ghost" onClick={() => setStep(1)}>Quay lai</button>
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
                            <BookmarkPlus size={16} /> {hasBlockingIssues ? 'Luu outline bat chap' : 'Luu outline truoc'}
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
                    <h3>Dang draft ({arcStore.draftProgress.current} / {arcStore.draftProgress.total})</h3>
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
                                {result.status === 'pending' && <span className="text-muted">Dang cho...</span>}
                                {result.status === 'done' && <><CheckCircle2 size={14} className="text-success" /> {result.wordCount} tu</>}
                                {result.status === 'error' && <><AlertTriangle size={14} className="text-danger" /> Loi</>}
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
                        Dung lai
                    </button>
                </div>
            </div>
        );
    };

    const renderStep4 = () => (
        <div className="arc-step-content">
            <div className="arc-results-header">
                <h3>Draft xong cac chuong da chon</h3>
                <p>Review cac draft mau, cam co neu sai logic, va co the regenerate tu bat ky draft nao tro di.</p>
            </div>

            <div className="arc-results-list">
                {arcStore.draftResults.map((result, index) => (
                    <div key={`${result.chapterIndex}-${index}`} className={`arc-result-card ${result.status === 'flagged' ? 'arc-result-card--flagged' : ''}`}>
                        <div className="arc-result-header">
                            <strong className="arc-result-title">Chuong {result.chapterIndex + 1}: {result.title}</strong>
                            <span className="arc-result-meta">{result.wordCount} tu</span>
                        </div>

                        <div className="arc-result-preview">
                            {result.content ? `${result.content.substring(0, 180)}...` : '(Chua viet xong)'}
                        </div>

                        {result.status === 'flagged' && (
                            <div className="arc-result-flag-input mt-2">
                                <input
                                    className="input input-sm"
                                    placeholder="Ghi chu can sua..."
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
                                <Flag size={12} /> {result.status === 'flagged' ? 'Bo co' : 'Cam co loi'}
                            </button>

                            <button
                                className="btn btn-sm btn-ghost text-warning"
                                onClick={() => handleRegenerateFrom(index)}
                                title="Se tao lai draft nay va cac draft duoc chon sau no"
                            >
                                <RotateCcw size={12} /> Tao lai tu day
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="arc-actions border-top pt-4">
                <button className="btn btn-ghost text-danger" onClick={onClose}>Dong</button>
                <button className="btn btn-secondary" onClick={handleCommitOutlineOnly} disabled={hasBlockingIssues}>
                    <BookmarkPlus size={16} /> Luu outline
                </button>
                <button className="btn btn-primary" onClick={handleCommit}>
                    <Save size={16} /> Luu draft vao truyen
                </button>
            </div>
        </div>
    );

    return (
        <div className="arc-modal-overlay">
            <div className="arc-modal">
                <div className="arc-modal-header">
                    <h2><Sparkles size={20} style={{ color: 'var(--color-primary)' }} /> Tao chuong tu dong</h2>
                    <button className="btn btn-icon btn-ghost" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="arc-stepper">
                    {[1, 2, 3, 4].map((item) => (
                        <div key={item} className={`arc-step ${step >= item ? 'arc-step--active' : ''}`}>
                            <div className="arc-step-num">{item}</div>
                            <div className="arc-step-label">
                                {item === 1 && 'Thiet lap'}
                                {item === 2 && 'Dan y'}
                                {item === 3 && 'Draft'}
                                {item === 4 && 'Ket qua'}
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
