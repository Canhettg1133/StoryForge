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
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import './AIGenerateButton.css';

const ENTITY_PROMPTS = {
  character: {
    placeholder: 'Vi du: Nu sat thu lanh lung, 20 tuoi, co bi mat den toi...',
    systemPrompt: (genre) => `Ban la tro ly tao nhan vat cho truyen the loai ${genre || 'fantasy'}.
Dua tren mo ta cua tac gia, tao 1 nhan vat chi tiet.
Tra ve CHINH XAC JSON (khong them gi khac):
{
  "name": "Ten nhan vat",
  "role": "protagonist|antagonist|supporting|mentor|minor",
  "appearance": "Mo ta ngoai hinh 2-3 cau",
  "personality": "Mo ta tinh cach 2-3 cau",
  "personality_tags": "tag1, tag2",
  "flaws": "Diem yeu / khuyet diem ro rang",
  "goals": "Muc tieu chinh",
  "secrets": "Bi mat (neu co)",
  "notes": "Ghi chu them"
}`,
  },
  location: {
    placeholder: 'Vi du: Toa thanh co tren dinh nui, bao quanh boi suong mu...',
    systemPrompt: (genre) => `Ban la tro ly xay dung the gioi cho truyen the loai ${genre || 'fantasy'}.
Dua tren mo ta, tao 1 dia diem chi tiet.
Tra ve CHINH XAC JSON:
{
  "name": "Ten dia diem",
  "description": "Mo ta tong quan 2-3 cau",
  "details": "Chi tiet bo sung: kien truc, dac diem noi bat, bi mat..."
}`,
  },
  object: {
    placeholder: 'Vi du: Thanh kiem co phat sang trong bong toi, co y chi rieng...',
    systemPrompt: (genre) => `Ban la tro ly xay dung the gioi cho truyen the loai ${genre || 'fantasy'}.
Dua tren mo ta, tao 1 vat pham chi tiet.
Tra ve CHINH XAC JSON:
{
  "name": "Ten vat pham",
  "description": "Mo ta ngoai hinh va lich su 2-3 cau",
  "properties": "Thuoc tinh dac biet, cong dung, han che..."
}`,
  },
  term: {
    placeholder: 'Vi du: Nang luong phep thuat, he thong cap bac tu luyen...',
    systemPrompt: (genre) => `Ban la tro ly xay dung the gioi cho truyen the loai ${genre || 'fantasy'}.
Dua tren mo ta, tao 1 thuat ngu/khai niem chi tiet.
Tra ve CHINH XAC JSON:
{
  "name": "Ten thuat ngu",
  "definition": "Dinh nghia chi tiet 3-5 cau",
  "category": "magic|organization|race|technology|other"
}`,
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

    const messages = [
      { role: 'system', content: config.systemPrompt(projectContext.genre) },
      { role: 'user', content: `Truyen: ${projectContext.projectTitle || 'Chua dat ten'}\n\nYeu cau: ${prompt}` },
    ];

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
