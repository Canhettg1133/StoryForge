import React, { useState, useRef, useEffect } from 'react';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import CodexPanel from '../editor/CodexPanel';
import {
  PenTool, RefreshCw, Maximize2, Lightbulb, Map, Sparkles,
  Send, Square, Copy, Check, ChevronDown, Zap, Gauge, Crown,
  Trash2, ArrowDownToLine, X, ShieldAlert, Loader2, Replace, Bookmark
} from 'lucide-react';
import './AISidebar.css';

// Task categories for action buttons
const PROSE_INSERT_TASKS = ['continue', 'free_prompt'];
const PROSE_REPLACE_TASKS = ['rewrite', 'expand'];
const ANALYTICAL_TASKS = ['plot', 'outline', 'extract', 'conflict'];

const QUICK_ACTIONS = [
  { id: 'continue', icon: PenTool, label: 'Viết tiếp', taskFn: 'continueWriting', needsText: true, needsGuidance: true, placeholder: 'VD: "Nhân vật gặp phục kích", "Chuyển cảnh sang nhân vật phụ"...' },
  { id: 'rewrite', icon: RefreshCw, label: 'Viết lại', taskFn: 'rewriteText', needsSelection: true, needsGuidance: true, placeholder: 'VD: "Thêm drama hơn", "Giọng văn trang trọng hơn"...' },
  { id: 'expand', icon: Maximize2, label: 'Mở rộng', taskFn: 'expandText', needsSelection: true, needsGuidance: true, placeholder: 'VD: "Mở rộng phần chiến đấu", "Thêm nội tâm nhân vật"...' },
  { id: 'plot', icon: Lightbulb, label: 'Gợi ý plot', taskFn: 'suggestPlot', needsText: true },
  { id: 'outline', icon: Map, label: 'Outline', taskFn: 'outlineChapter', needsText: false },
  { id: 'extract', icon: Sparkles, label: 'Trích xuất', taskFn: 'extractTerms', needsText: true },
  { id: 'conflict', icon: ShieldAlert, label: 'Check Mâu Thuẫn', taskFn: 'checkConflict', needsText: true, isCustom: true },
];

const QUALITY_OPTIONS = [
  { value: 'fast', icon: Zap, label: 'Nhanh', desc: 'Flash models' },
  { value: 'balanced', icon: Gauge, label: 'Cân bằng', desc: 'Mặc định' },
  { value: 'best', icon: Crown, label: 'Tốt nhất', desc: 'Pro models' },
];

export default function AISidebar({ editor }) {
  const {
    isStreaming, streamingText, completedText, error,
    lastRouteInfo, lastElapsed, qualityMode,
    abort, clearOutput, setQualityMode,
    continueWriting, rewriteText, expandText,
    suggestPlot, outlineChapter, extractTerms, freePrompt, checkConflict, isCheckingConflict,
  } = useAIStore();

  const { currentProject, scenes, activeSceneId, chapters, activeChapterId } = useProjectStore();

  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionGuidance, setActionGuidance] = useState('');
  const [lastTaskId, setLastTaskId] = useState(null);
  const [plotSuggestions, setPlotSuggestions] = useState([]);
  const [showPlotManager, setShowPlotManager] = useState(false);
  const outputRef = useRef(null);
  const guidanceRef = useRef(null);

  // Load plot suggestions for current chapter from localStorage
  useEffect(() => {
    if (activeChapterId) {
      try {
        const saved = localStorage.getItem(`sf-plot-${activeChapterId}`);
        setPlotSuggestions(saved ? JSON.parse(saved) : []);
      } catch { setPlotSuggestions([]); }
    } else {
      setPlotSuggestions([]);
    }
  }, [activeChapterId]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingText, completedText]);

  // Clear active action when streaming finishes
  useEffect(() => {
    if (!isStreaming && !isCheckingConflict && activeAction) {
      setActiveAction(null);
    }
  }, [isStreaming, isCheckingConflict]);

  const getContext = () => {
    const scene = scenes.find(s => s.id === activeSceneId);
    const chapter = chapters.find(c => c.id === activeChapterId);
    const selectedText = editor?.state?.selection?.empty
      ? ''
      : editor?.state?.doc?.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        ' '
      ) || '';

    return {
      selectedText,
      sceneText: scene?.draft_text?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim() || '',
      sceneTitle: scene?.title || '',
      chapterTitle: chapter?.title || '',
      projectTitle: currentProject?.title || '',
      genre: currentProject?.genre_primary || '',
      // Phase 3: Context Engine needs these
      projectId: currentProject?.id || null,
      chapterId: activeChapterId || null,
      sceneId: activeSceneId || null,
      chapterIndex: chapter ? chapters.indexOf(chapter) : 0,
    };
  };

  const handleQuickAction = (action) => {
    // Plot: show manager if already has suggestions
    if (action.id === 'plot' && plotSuggestions.length > 0 && !isStreaming) {
      setShowPlotManager(true);
      return;
    }
    // Actions that need guidance: show inline input first
    if (action.needsGuidance && !isStreaming) {
      setPendingAction(action);
      setActionGuidance('');
      setTimeout(() => guidanceRef.current?.focus(), 50);
      return;
    }
    // Otherwise execute immediately
    executeAction(action, '');
  };

  const executeAction = (action, guidance) => {
    const ctx = getContext();

    // Validate
    if (action.needsSelection && !ctx.selectedText) {
      ctx.selectedText = ctx.sceneText;
    }
    if (action.needsText && !ctx.sceneText && !ctx.selectedText) {
      return;
    }

    // Add user guidance to context
    if (guidance.trim()) {
      ctx.userPrompt = guidance.trim();
    }

    // Clear pending state
    setPendingAction(null);
    setActionGuidance('');

    // Track active action for UI feedback
    setActiveAction(action.id);
    setLastTaskId(action.id);

    if (action.isCustom && action.id === 'conflict') {
      handleCheckConflict(ctx);
      return;
    }

    const taskFns = { continueWriting, rewriteText, expandText, suggestPlot, outlineChapter, extractTerms };
    const fn = taskFns[action.taskFn];
    if (fn) fn(ctx);
  };

  const handleGuidanceSubmit = () => {
    if (pendingAction) executeAction(pendingAction, actionGuidance);
  };

  const handleGuidanceSkip = () => {
    if (pendingAction) executeAction(pendingAction, '');
  };

  const handleCheckConflict = async (ctx) => {
    try {
      clearOutput();
      useAIStore.setState({ streamingText: 'Đang kiểm tra mâu thuẫn cốt truyện...' });

      const result = await checkConflict(ctx);
      let outText = '';
      if (result && result.conflicts && result.conflicts.length > 0) {
        outText = '⚠️ PHÁT HIỆN MÂU THUẪN:\n\n';
        result.conflicts.forEach((c, idx) => {
          outText += `${idx + 1}. [${(c.severity || 'medium').toUpperCase()}] ${c.description}\n`;
          if (c.suggestion) outText += `   💡 Lời khuyên: ${c.suggestion}\n`;
          outText += '\n';
        });
      } else {
        outText = '✅ Tuyệt vời! Không phát hiện mâu thuẫn logic nào trong nội dung này so với Canon Facts và Trạng thái nhân vật hiện tại.';
      }
      useAIStore.setState({ streamingText: '', completedText: outText });
    } catch (err) {
      useAIStore.setState({ streamingText: '', error: 'Lỗi kiểm tra mâu thuẫn: ' + err.message });
    }
  };

  const handleFreePrompt = (e) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    const ctx = getContext();
    ctx.userPrompt = customPrompt.trim();
    setLastTaskId('free_prompt');
    freePrompt(ctx);
    setCustomPrompt('');
  };

  const handleCopy = () => {
    const text = completedText || streamingText;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Convert plain text to HTML paragraphs
  const textToHtml = (text) => {
    return text
      .split(/\n\n+/)
      .filter(p => p.trim())
      .map(para => {
        const escaped = para
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        return '<p>' + escaped + '</p>';
      })
      .join('');
  };

  // Insert at cursor (Viết tiếp, Yêu cầu tự do)
  const handleInsertToEditor = () => {
    const text = completedText || streamingText;
    if (text && editor) {
      editor.chain().focus().insertContent(textToHtml(text)).run();
      clearOutput();
    }
  };

  // Replace all editor content (Viết lại, Mở rộng)
  const handleReplaceEditor = () => {
    const text = completedText || streamingText;
    if (text && editor) {
      editor.chain().focus().selectAll().deleteSelection().insertContent(textToHtml(text)).run();
      clearOutput();
    }
  };

  // Save plot suggestions when plot task completes (per chapter)
  useEffect(() => {
    if (!isStreaming && completedText && lastTaskId === 'plot' && activeChapterId) {
      // Parse numbered suggestions — handle multiple formats
      // Splits on lines starting with: 1. / 1) / **1.** / - / * / Hướng 1:
      const parsed = completedText
        .split(/\n(?=(?:\*{0,2})?\d+[\)\.\:]|(?:^|\n)[-\*]\s|(?:^|\n)\*{2}[^\*])/m)
        .map(s => s.trim())
        .filter(s => s.length > 15);
      if (parsed.length > 0) {
        setPlotSuggestions(parsed);
        setShowPlotManager(false);
        localStorage.setItem(`sf-plot-${activeChapterId}`, JSON.stringify(parsed));
      }
    }
  }, [isStreaming, completedText, lastTaskId, activeChapterId]);

  // Regenerate plot suggestions
  const handleRegeneratePlot = () => {
    setShowPlotManager(false);
    const plotAction = QUICK_ACTIONS.find(a => a.id === 'plot');
    if (plotAction) executeAction(plotAction, '');
  };

  // Use a plot suggestion — fill guidance input
  const handlePickPlotSuggestion = (text) => {
    setActionGuidance(text);
  };

  const displayText = streamingText || completedText;
  const hasOutput = !!displayText || !!error || isStreaming || isCheckingConflict;

  // Get current scene text for Codex Panel
  const currentSceneText = (() => {
    const scene = scenes.find(s => s.id === activeSceneId);
    return scene?.draft_text || '';
  })();

  return (
    <div className="ai-sidebar">
      {/* Codex Panel — real-time entity detection */}
      <CodexPanel sceneText={currentSceneText} />

      {/* Quick Actions */}
      <div className="ai-quick-actions">
        {QUICK_ACTIONS.map(action => {
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

      {/* Plot Manager */}
      {showPlotManager && (
        <div className="ai-guidance-panel">
          <div className="ai-guidance-header">
            <Lightbulb size={14} />
            <span>Gợi ý plot — Chương hiện tại</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowPlotManager(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="ai-plot-manager">
            {plotSuggestions.map((s, i) => {
              const title = s.replace(/^\*{0,2}\d+[\.\)]\*{0,2}\s*/, '').split(/[\.\!\?]/)[0];
              return (
                <div key={i} className="ai-plot-manager-item">
                  <div className="ai-plot-manager-title">{title}</div>
                  <p className="ai-plot-manager-text">{s}</p>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const updated = plotSuggestions.filter((_, idx) => idx !== i);
                      setPlotSuggestions(updated);
                      if (activeChapterId) {
                        if (updated.length > 0) {
                          localStorage.setItem(`sf-plot-${activeChapterId}`, JSON.stringify(updated));
                        } else {
                          localStorage.removeItem(`sf-plot-${activeChapterId}`);
                          setShowPlotManager(false);
                        }
                      }
                    }}
                  >
                    <Trash2 size={12} /> Xoá ý này
                  </button>
                </div>
              );
            })}
          </div>
          <div className="ai-guidance-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setPlotSuggestions([]);
              if (activeChapterId) localStorage.removeItem(`sf-plot-${activeChapterId}`);
              setShowPlotManager(false);
            }}>
              <Trash2 size={12} /> Xoá tất cả
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleRegeneratePlot}>
              <RefreshCw size={12} /> Sinh mới
            </button>
          </div>
        </div>
      )}

      {/* Inline Guidance Input */}
      {pendingAction && (
        <div className="ai-guidance-panel">
          <div className="ai-guidance-header">
            <pendingAction.icon size={14} />
            <span>{pendingAction.label}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPendingAction(null)}>
              <X size={14} />
            </button>
          </div>

          {/* Plot suggestion chips */}
          {plotSuggestions.length > 0 && (
            <div className="ai-guidance-chips">
              <div className="ai-guidance-chips-header">
                <Bookmark size={12} />
                <span>Gợi ý plot ({plotSuggestions.length})</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                  setPlotSuggestions([]);
                  if (activeChapterId) localStorage.removeItem(`sf-plot-${activeChapterId}`);
                }}>
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="ai-guidance-chips-list">
                {plotSuggestions.map((s, i) => {
                  // Extract short label (first sentence or first 60 chars)
                  const label = s.replace(/^\d+[\.\)]\s*/, '').split(/[\.!\?]/)[0].substring(0, 60);
                  return (
                    <button
                      key={i}
                      className={`ai-chip ${actionGuidance === s ? 'ai-chip--active' : ''}`}
                      onClick={() => handlePickPlotSuggestion(s)}
                      title={s}
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
            onChange={(e) => setActionGuidance(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGuidanceSubmit();
              }
            }}
            rows={2}
          />
          <div className="ai-guidance-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleGuidanceSkip}>
              Bỏ qua
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleGuidanceSubmit}>
              <Send size={12} /> Gửi
            </button>
          </div>
        </div>
      )}

      {/* Output */}
      {hasOutput && (
        <div className="ai-output-area">
          <div className="ai-output-header">
            <span className="ai-output-label">
              {isStreaming || isCheckingConflict ? (
                <><span className="ai-streaming-dot" /> {isCheckingConflict ? 'Đang kiểm tra...' : 'Đang viết...'}</>
              ) : error ? (
                'Lỗi'
              ) : (
                'Kết quả'
              )}
            </span>
            <div className="ai-output-actions">
              {!isStreaming && displayText && (
                <>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCopy} title="Copy">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  {/* Insert for prose tasks */}
                  {PROSE_INSERT_TASKS.includes(lastTaskId) && (
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={handleInsertToEditor} title="Chèn vào editor">
                      <ArrowDownToLine size={14} />
                    </button>
                  )}
                  {/* Replace for rewrite/expand */}
                  {PROSE_REPLACE_TASKS.includes(lastTaskId) && (
                    <button className="btn btn-accent btn-sm" onClick={handleReplaceEditor} title="Thay thế đoạn gốc">
                      <Replace size={12} /> Thay thế
                    </button>
                  )}
                  {/* Analytical: only Copy, no insert */}
                </>
              )}
              {isStreaming ? (
                <button className="btn btn-danger btn-sm" onClick={abort}>
                  <Square size={12} /> Dừng
                </button>
              ) : (
                <button className="btn btn-ghost btn-icon btn-sm" onClick={clearOutput} title="Xoá">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="ai-output-content" ref={outputRef}>
            {error ? (
              <div className="ai-output-error">{error}</div>
            ) : displayText ? (
              <div className="ai-output-text">{displayText}
                {isStreaming && <span className="ai-cursor">|</span>}
              </div>
            ) : (
              <div className="ai-output-loading">
                <Loader2 size={20} className="spin" />
                <span>Đang suy nghĩ...</span>
              </div>
            )}
          </div>

          {/* Meta info */}
          {lastRouteInfo && !isStreaming && !error && (
            <div className="ai-output-meta">
              <span>{lastRouteInfo.provider === 'ollama' ? '🏠' : '☁️'} {lastRouteInfo.model}</span>
              {lastElapsed && <span>· {(lastElapsed / 1000).toFixed(1)}s</span>}
            </div>
          )}
        </div>
      )}

      {/* Free Prompt */}
      <form className="ai-free-prompt" onSubmit={handleFreePrompt}>
        <textarea
          className="ai-prompt-input"
          placeholder="Nhập yêu cầu tự do..."
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleFreePrompt(e);
            }
          }}
          rows={2}
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
    </div>
  );
}
