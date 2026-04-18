import React, { useEffect, useRef, useState } from 'react';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import db from '../../services/db/database';
import CodexPanel from '../editor/CodexPanel';
import {
  PenTool,
  RefreshCw,
  Maximize2,
  Lightbulb,
  Map,
  Sparkles,
  Send,
  Square,
  Copy,
  Check,
  Trash2,
  ArrowDownToLine,
  X,
  ShieldAlert,
  Loader2,
  Replace,
  Bookmark,
} from 'lucide-react';
import './AISidebar.css';

const PROSE_INSERT_TASKS = ['continue', 'free_prompt'];
const PROSE_REPLACE_TASKS = ['rewrite', 'expand'];
const AI_DRAFT_READY_EVENT = 'storyforge:ai-draft-ready';
const MOBILE_AI_TABS = [
  { id: 'ai', label: 'AI' },
  { id: 'codex', label: 'Codex' },
  { id: 'results', label: 'Kết quả' },
];

const QUICK_ACTIONS = [
  { id: 'continue', icon: PenTool, label: 'Viết tiếp', taskFn: 'continueWriting', needsText: true, needsGuidance: true, placeholder: 'VD: "Nhân vật gặp phục kích", "Chuyển cảnh sang nhân vật phụ"...' },
  { id: 'rewrite', icon: RefreshCw, label: 'Viết lại', taskFn: 'rewriteText', needsSelection: true, needsGuidance: true, placeholder: 'VD: "Thêm drama hơn", "Giọng văn trang trọng hơn"...' },
  { id: 'expand', icon: Maximize2, label: 'Mở rộng', taskFn: 'expandText', needsSelection: true, needsGuidance: true, placeholder: 'VD: "Mở rộng phần chiến đấu", "Thêm nội tâm nhân vật"...' },
  { id: 'plot', icon: Lightbulb, label: 'Gợi ý plot', taskFn: 'suggestPlot', needsText: true },
  { id: 'outline', icon: Map, label: 'Outline', taskFn: 'outlineChapter', needsText: false },
  { id: 'extract', icon: Sparkles, label: 'Trích xuất', taskFn: 'extractTerms', needsText: true },
  { id: 'conflict', icon: ShieldAlert, label: 'Check Mâu Thuẫn', taskFn: 'checkConflict', needsText: true, isCustom: true },
];

export default function AISidebar({
  editor,
  isMobileLayout = false,
  mobileTab = 'ai',
  onMobileTabChange,
  onMobileInputFocusChange,
}) {
  const {
    isStreaming,
    streamingText,
    completedText,
    error,
    lastRouteInfo,
    lastElapsed,
    abort,
    clearOutput,
    continueWriting,
    rewriteText,
    expandText,
    suggestPlot,
    outlineChapter,
    extractTerms,
    freePrompt,
    checkConflict,
    isCheckingConflict,
  } = useAIStore();

  const { currentProject, scenes, activeSceneId, chapters, activeChapterId } = useProjectStore();

  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionGuidance, setActionGuidance] = useState('');
  const [lastTaskId, setLastTaskId] = useState(null);
  const [plotSuggestions, setPlotSuggestions] = useState([]);
  const [showPlotManager, setShowPlotManager] = useState(false);
  const outputRef = useRef(null);
  const guidanceRef = useRef(null);
  const lastPublishedDraftRef = useRef('');

  useEffect(() => {
    if (activeChapterId) {
      db.getPlotSuggestions(activeChapterId)
        .then((suggestions) => {
          setPlotSuggestions(suggestions.map((item) => item.suggested_value || item.reasoning || ''));
        })
        .catch(() => setPlotSuggestions([]));
    } else {
      setPlotSuggestions([]);
    }
  }, [activeChapterId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingText, completedText]);

  useEffect(() => {
    if (!isStreaming && !isCheckingConflict && activeAction) {
      setActiveAction(null);
    }
  }, [isStreaming, isCheckingConflict, activeAction]);

  const displayText = streamingText || completedText;
  const hasOutput = !!displayText || !!error || isStreaming || isCheckingConflict;

  const isSceneEmpty = (html = '') => (
    !String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
  );

  useEffect(() => {
    if (!isMobileLayout || !hasOutput || !onMobileTabChange) return;
    onMobileTabChange('results');
  }, [isMobileLayout, hasOutput, onMobileTabChange]);

  useEffect(() => {
    if (!completedText || !PROSE_INSERT_TASKS.includes(lastTaskId) || !activeSceneId) return;

    const scene = scenes.find((item) => item.id === activeSceneId);
    if (!isSceneEmpty(scene?.draft_text || '')) return;

    const draftKey = `${activeSceneId}:${lastTaskId}:${completedText}`;
    if (lastPublishedDraftRef.current === draftKey) return;
    lastPublishedDraftRef.current = draftKey;

    window.dispatchEvent(new CustomEvent(AI_DRAFT_READY_EVENT, {
      detail: {
        sceneId: activeSceneId,
        chapterId: activeChapterId || null,
        taskId: lastTaskId,
        text: completedText,
      },
    }));
  }, [completedText, lastTaskId, activeSceneId, activeChapterId, scenes]);

  const getContext = () => {
    const scene = scenes.find((item) => item.id === activeSceneId);
    const chapter = chapters.find((item) => item.id === activeChapterId);
    const selectedText = editor?.state?.selection?.empty
      ? ''
      : editor?.state?.doc?.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        ' ',
      ) || '';

    return {
      selectedText,
      sceneText: scene?.draft_text?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim() || '',
      sceneTitle: scene?.title || '',
      chapterTitle: chapter?.title || '',
      projectTitle: currentProject?.title || '',
      genre: currentProject?.genre_primary || '',
      projectId: currentProject?.id || null,
      chapterId: activeChapterId || null,
      sceneId: activeSceneId || null,
      chapterIndex: chapter ? chapters.indexOf(chapter) : 0,
    };
  };

  const executeAction = (action, guidance) => {
    const context = getContext();

    if (action.needsSelection && !context.selectedText) {
      context.selectedText = context.sceneText;
    }
    if (action.needsText && !context.sceneText && !context.selectedText) {
      return;
    }

    if (guidance.trim()) {
      context.userPrompt = guidance.trim();
    }

    setPendingAction(null);
    setActionGuidance('');
    setActiveAction(action.id);
    setLastTaskId(action.id);

    if (action.isCustom && action.id === 'conflict') {
      handleCheckConflict(context);
      return;
    }

    const taskFns = { continueWriting, rewriteText, expandText, suggestPlot, outlineChapter, extractTerms };
    const fn = taskFns[action.taskFn];
    if (fn) fn(context);
  };

  const handleQuickAction = (action) => {
    if (action.id === 'plot' && plotSuggestions.length > 0 && !isStreaming) {
      setShowPlotManager(true);
      return;
    }

    if (action.needsGuidance && !isStreaming) {
      setPendingAction(action);
      setActionGuidance('');
      setTimeout(() => guidanceRef.current?.focus(), 50);
      return;
    }

    executeAction(action, '');
  };

  const handleCheckConflict = async (context) => {
    try {
      clearOutput();
      useAIStore.setState({ streamingText: 'Đang kiểm tra mâu thuẫn cốt truyện...' });

      const result = await checkConflict(context);
      let outputText = '';
      if (result?.conflicts?.length > 0) {
        outputText = '⚠️ PHÁT HIỆN MÂU THUẪN:\n\n';
        result.conflicts.forEach((conflict, index) => {
          outputText += `${index + 1}. [${(conflict.severity || 'medium').toUpperCase()}] ${conflict.description}\n`;
          if (conflict.suggestion) outputText += `   Gợi ý: ${conflict.suggestion}\n`;
          outputText += '\n';
        });
      } else {
        outputText = '✅ Không phát hiện mâu thuẫn logic nào trong nội dung này.';
      }
      useAIStore.setState({ streamingText: '', completedText: outputText });
    } catch (err) {
      useAIStore.setState({ streamingText: '', error: `Lỗi kiểm tra mâu thuẫn: ${err.message}` });
    }
  };

  const handleFreePrompt = (event) => {
    event.preventDefault();
    if (!customPrompt.trim()) return;
    const context = getContext();
    context.userPrompt = customPrompt.trim();
    setLastTaskId('free_prompt');
    freePrompt(context);
    setCustomPrompt('');
  };

  const handleCopy = () => {
    const text = completedText || streamingText;
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const textToHtml = (text) => (
    text
      .split(/\n\n+/)
      .filter((paragraph) => paragraph.trim())
      .map((paragraph) => {
        const escaped = paragraph
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        return `<p>${escaped}</p>`;
      })
      .join('')
  );

  const handleInsertToEditor = () => {
    const text = completedText || streamingText;
    if (text && editor) {
      editor.chain().focus().insertContent(textToHtml(text)).run();
      clearOutput();
    }
  };

  const handleReplaceEditor = () => {
    const text = completedText || streamingText;
    if (text && editor) {
      editor.chain().focus().selectAll().deleteSelection().insertContent(textToHtml(text)).run();
      clearOutput();
    }
  };

  useEffect(() => {
    if (!isStreaming && completedText && lastTaskId === 'plot' && activeChapterId) {
      const parsed = completedText
        .split(/\n(?=(?:\*{0,2})?\d+[\)\.\:]|(?:^|\n)[-\*]\s|(?:^|\n)\*{2}[^\*])/m)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 15);
      if (parsed.length > 0) {
        setPlotSuggestions(parsed);
        setShowPlotManager(false);
        db.savePlotSuggestions(activeChapterId, currentProject?.id, parsed).catch((err) => {
          console.warn('[PlotSuggestions] Save failed:', err);
        });
      }
    }
  }, [isStreaming, completedText, lastTaskId, activeChapterId, currentProject?.id]);

  const handleRegeneratePlot = () => {
    setShowPlotManager(false);
    const plotAction = QUICK_ACTIONS.find((action) => action.id === 'plot');
    if (plotAction) executeAction(plotAction, '');
  };

  const currentSceneText = (() => {
    const scene = scenes.find((item) => item.id === activeSceneId);
    return scene?.draft_text || '';
  })();

  const renderQuickActions = () => (
    <div className="ai-quick-actions">
      {QUICK_ACTIONS.map((action) => {
        const isActive = activeAction === action.id && (isStreaming || isCheckingConflict);
        return (
          <button
            key={action.id}
            className={`ai-action-btn ${action.id === 'conflict' ? 'ai-action-btn--warn' : ''} ${isActive ? 'ai-action-btn--active' : ''}`}
            onClick={() => handleQuickAction(action)}
            disabled={isStreaming || isCheckingConflict}
            title={action.label}
          >
            {isActive ? <Loader2 size={15} className="spin" /> : <action.icon size={15} />}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderPlotManager = () => showPlotManager && (
    <div className="ai-guidance-panel">
      <div className="ai-guidance-header">
        <Lightbulb size={14} />
        <span>Gợi ý plot</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowPlotManager(false)}>
          <X size={14} />
        </button>
      </div>
      <div className="ai-plot-manager">
        {plotSuggestions.map((suggestion, index) => {
          const title = suggestion.replace(/^\*{0,2}\d+[\.\)]\*{0,2}\s*/, '').split(/[\.\!\?]/)[0];
          return (
            <div key={index} className="ai-plot-manager-item">
              <div className="ai-plot-manager-title">{title}</div>
              <p className="ai-plot-manager-text">{suggestion}</p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const updated = plotSuggestions.filter((_, itemIndex) => itemIndex !== index);
                  setPlotSuggestions(updated);
                  if (activeChapterId) {
                    if (updated.length > 0) {
                      db.savePlotSuggestions(activeChapterId, currentProject?.id, updated).catch((err) => {
                        console.warn('[PlotSuggestions] Delete item failed:', err);
                      });
                    } else {
                      db.suggestions
                        .where('source_chapter_id').equals(activeChapterId)
                        .filter((item) => item.source_type === 'plot_suggestion')
                        .delete()
                        .then(() => setShowPlotManager(false));
                    }
                  }
                }}
              >
                <Trash2 size={12} /> Xóa ý này
              </button>
            </div>
          );
        })}
      </div>
      <div className="ai-guidance-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setPlotSuggestions([]);
            if (activeChapterId) {
              db.suggestions
                .where('source_chapter_id').equals(activeChapterId)
                .filter((item) => item.source_type === 'plot_suggestion')
                .delete()
                .then(() => setShowPlotManager(false));
            } else {
              setShowPlotManager(false);
            }
          }}
        >
          <Trash2 size={12} /> Xóa tất cả
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleRegeneratePlot}>
          <RefreshCw size={12} /> Sinh mới
        </button>
      </div>
    </div>
  );

  const renderGuidanceInput = () => pendingAction && (
    <div className="ai-guidance-panel">
      <div className="ai-guidance-header">
        <pendingAction.icon size={14} />
        <span>{pendingAction.label}</span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPendingAction(null)}>
          <X size={14} />
        </button>
      </div>

      {plotSuggestions.length > 0 && (
        <div className="ai-guidance-chips">
          <div className="ai-guidance-chips-header">
            <Bookmark size={12} />
            <span>Gợi ý plot ({plotSuggestions.length})</span>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => {
                setPlotSuggestions([]);
                if (activeChapterId) {
                  db.suggestions
                    .where('source_chapter_id').equals(activeChapterId)
                    .filter((item) => item.source_type === 'plot_suggestion')
                    .delete();
                }
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
          <div className="ai-guidance-chips-list">
            {plotSuggestions.map((suggestion, index) => {
              const label = suggestion.replace(/^\d+[\.\)]\s*/, '').split(/[\.!\?]/)[0].substring(0, 60);
              return (
                <button
                  key={index}
                  className={`ai-chip ${actionGuidance === suggestion ? 'ai-chip--active' : ''}`}
                  onClick={() => setActionGuidance(suggestion)}
                  title={suggestion}
                >
                  {label}...
                </button>
              );
            })}
          </div>
        </div>
      )}

      <textarea
        ref={guidanceRef}
        className="ai-guidance-input"
        placeholder={pendingAction.placeholder || 'Hướng dẫn thêm cho AI...'}
        value={actionGuidance}
        onFocus={() => onMobileInputFocusChange?.(true)}
        onBlur={() => onMobileInputFocusChange?.(false)}
        onChange={(event) => setActionGuidance(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            executeAction(pendingAction, actionGuidance);
          }
        }}
        rows={2}
      />
      <div className="ai-guidance-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => executeAction(pendingAction, '')}>
          Bỏ qua
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => executeAction(pendingAction, actionGuidance)}>
          <Send size={12} /> Gửi
        </button>
      </div>
    </div>
  );

  const renderOutputArea = (showEmptyState = false) => {
    if (!hasOutput && !showEmptyState) return null;

    return (
      <div className="ai-output-area">
        <div className="ai-output-header">
          <span className="ai-output-label">
            {isStreaming || isCheckingConflict ? (
              <><span className="ai-streaming-dot" /> {isCheckingConflict ? 'Đang kiểm tra...' : 'Đang viết...'}</>
            ) : error ? 'Lỗi' : 'Kết quả'}
          </span>
          <div className="ai-output-actions">
            {!isStreaming && displayText && (
              <>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCopy} title="Copy">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                {PROSE_INSERT_TASKS.includes(lastTaskId) && (
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={handleInsertToEditor} title="Chèn vào editor">
                    <ArrowDownToLine size={14} />
                  </button>
                )}
                {PROSE_REPLACE_TASKS.includes(lastTaskId) && (
                  <button className="btn btn-accent btn-sm" onClick={handleReplaceEditor} title="Thay thế đoạn gốc">
                    <Replace size={12} /> Thay thế
                  </button>
                )}
              </>
            )}
            {isStreaming ? (
              <button className="btn btn-danger btn-sm" onClick={abort}>
                <Square size={12} /> Dừng
              </button>
            ) : (
              <button className="btn btn-ghost btn-icon btn-sm" onClick={clearOutput} title="Xóa">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="ai-output-content" ref={outputRef}>
          {error ? (
            <div className="ai-output-error">{error}</div>
          ) : displayText ? (
            <div className="ai-output-text">{displayText}{isStreaming && <span className="ai-cursor">|</span>}</div>
          ) : (
            <div className="ai-output-empty">Chưa có kết quả. Chạy một tác vụ AI để xem nội dung ở đây.</div>
          )}
        </div>

        {lastRouteInfo && !isStreaming && !error && (
          <div className="ai-output-meta">
            <span>{lastRouteInfo.provider === 'ollama' ? 'Local' : 'Cloud'} · {lastRouteInfo.model}</span>
            {lastElapsed && <span>· {(lastElapsed / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
    );
  };

  const renderPromptComposer = () => (
    <form className="ai-free-prompt" onSubmit={handleFreePrompt}>
      <textarea
        className="ai-prompt-input"
        placeholder="Nhập yêu cầu tự do..."
        value={customPrompt}
        onFocus={() => onMobileInputFocusChange?.(true)}
        onBlur={() => onMobileInputFocusChange?.(false)}
        onChange={(event) => setCustomPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleFreePrompt(event);
          }
        }}
        rows={isMobileLayout ? 3 : 2}
        disabled={isStreaming}
      />
      <button
        type="submit"
        className="btn btn-primary btn-sm ai-send-btn"
        disabled={isStreaming || isCheckingConflict || !customPrompt.trim()}
      >
        {isStreaming ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
      </button>
    </form>
  );

  const renderMobileBody = () => (
    <div className="ai-mobile-layout">
      <div className="ai-mobile-tabs">
        {MOBILE_AI_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`ai-mobile-tab ${mobileTab === tab.id ? 'ai-mobile-tab--active' : ''}`}
            onClick={() => onMobileTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ai-mobile-panel">
        {mobileTab === 'ai' && (
          <>
            {renderQuickActions()}
            {renderPlotManager()}
            {renderGuidanceInput()}
            {renderPromptComposer()}
          </>
        )}

        {mobileTab === 'codex' && (
          <div className="ai-mobile-codex">
            <CodexPanel sceneText={currentSceneText} />
          </div>
        )}

        {mobileTab === 'results' && renderOutputArea(true)}
      </div>
    </div>
  );

  if (isMobileLayout) {
    return (
      <div className="ai-sidebar ai-sidebar--mobile">
        {renderMobileBody()}
      </div>
    );
  }

  return (
    <div className="ai-sidebar">
      <CodexPanel sceneText={currentSceneText} />
      {renderQuickActions()}
      {renderPlotManager()}
      {renderGuidanceInput()}
      {renderOutputArea(false)}
      {renderPromptComposer()}
    </div>
  );
}
