/**
 * StoryForge - AI Generate Button (Reusable)
 *
 * A floating "Tao bang AI" button with:
 * - Prompt input popup
 * - AI request
 * - Preview -> Approve/Edit flow
 *
 * Props:
 *   entityType: 'character' | 'location' | 'object' | 'term'
 *   projectContext: { projectTitle, genre }
 *   onApprove: (data) => void
 *   buttonLabel?: string
 */

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Loader2, Check, RotateCcw } from 'lucide-react';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import './AIGenerateButton.css';

const ENTITY_PROMPTS = {
  character: {
    placeholder: 'Vi du: Nu sat thu lanh lung, 20 tuoi, co bi mat den toi...',
  },
  location: {
    placeholder: 'Vi du: Toa thanh co tren dinh nui, bao quanh boi suong mu...',
  },
  object: {
    placeholder: 'Vi du: Thanh kiem co phat sang trong bong toi, co y chi rieng...',
  },
  term: {
    placeholder: 'Vi du: Nang luong phep thuat, he thong cap bac tu luyen...',
  },
};

const ENTITY_LABELS = {
  character: 'nhan vat',
  location: 'dia diem',
  object: 'vat pham',
  term: 'thuat ngu',
};

export default function AIGenerateButton({ entityType, projectContext = {}, onApprove, buttonLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const popupRef = useRef(null);

  const config = ENTITY_PROMPTS[entityType] || ENTITY_PROMPTS.character;
  const label = ENTITY_LABELS[entityType] || 'muc';

  const resolvePromptTemplates = () => {
    if (!projectContext?.promptTemplates) return {};
    if (typeof projectContext.promptTemplates === 'string') {
      try { return JSON.parse(projectContext.promptTemplates); } catch { return {}; }
    }
    return typeof projectContext.promptTemplates === 'object' ? projectContext.promptTemplates : {};
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);
    setResult(null);

    const messages = buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
      projectTitle: projectContext.projectTitle || '',
      genre: projectContext.genre || '',
      promptTemplates: resolvePromptTemplates(),
      userPrompt: prompt,
      entityType,
      batchCount: 1,
      entityContextText: projectContext.description || projectContext.worldName || '',
    });

    aiService.send({
      taskType: TASK_TYPES.AI_GENERATE_ENTITY,
      messages,
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          const parsedValue = parseAIJsonValue(text);
          const nextResult = Array.isArray(parsedValue)
            ? (parsedValue.length === 1 && isPlainObject(parsedValue[0]) ? parsedValue[0] : null)
            : (isPlainObject(parsedValue) ? parsedValue : null);

          if (!nextResult) {
            setError('AI tra ve sai dinh dang cho mot muc don. Thu lai?');
            return;
          }

          setResult(nextResult);
        } catch (e) {
          console.error('[AIGenerate] Parse error:', e, '\nRaw text:', text);
          setError('Khong parse duoc ket qua. Thu lai?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(err.message || 'Loi ket noi AI');
      },
    });
  };

  const handleApprove = () => {
    if (result && onApprove) {
      onApprove(result);
    }

    setIsOpen(false);
    setResult(null);
    setPrompt('');
  };

  const handleRetry = () => {
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    setResult(null);
    setPrompt('');
    setError(null);
    setIsGenerating(false);
  };

  return (
    <div className="ai-gen-wrapper">
      <button
        className="btn btn-accent btn-sm ai-gen-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`Tao ${label} bang AI`}
      >
        <Sparkles size={14} />
        {buttonLabel || `AI tao ${label}`}
      </button>

      {isOpen && (
        <div className="ai-gen-popup" ref={popupRef}>
          <div className="ai-gen-popup-header">
            <h4><Sparkles size={14} /> Tao {label} bang AI</h4>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleClose}>
              <X size={16} />
            </button>
          </div>

          {!result && !error && (
            <div className="ai-gen-popup-body">
              <textarea
                className="ai-gen-input"
                placeholder={config.placeholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                disabled={isGenerating}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
              <button
                className="btn btn-primary btn-sm ai-gen-submit"
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
              >
                {isGenerating ? (
                  <><Loader2 size={14} className="spin" /> Dang tao...</>
                ) : (
                  <><Sparkles size={14} /> Tao</>
                )}
              </button>
            </div>
          )}

          {error && (
            <div className="ai-gen-popup-body">
              <div className="ai-gen-error">{error}</div>
              <button className="btn btn-ghost btn-sm" onClick={handleRetry}>
                <RotateCcw size={14} /> Thu lai
              </button>
            </div>
          )}

          {result && (
            <div className="ai-gen-popup-body">
              <div className="ai-gen-preview">
                {Object.entries(result).map(([key, value]) => (
                  <div key={key} className="ai-gen-preview-field">
                    <span className="ai-gen-preview-label">{key}</span>
                    <span className="ai-gen-preview-value">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="ai-gen-actions">
                <button className="btn btn-ghost btn-sm" onClick={handleRetry}>
                  <RotateCcw size={14} /> Tao lai
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleApprove}>
                  <Check size={14} /> Dung ket qua
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
