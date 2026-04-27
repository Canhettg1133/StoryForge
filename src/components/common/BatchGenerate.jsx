/**
 * StoryForge — Batch AI Generation (Phase 3 Enhancement)
 * 
 * Context-aware batch entity generation.
 * AI reads existing outline + characters + world profile to generate
 * entities that FIT the story, not random ones.
 * 
 * Props:
 *   entityType: 'character' | 'location' | 'object' | 'term'
 *   projectContext: { projectTitle, genre, description }
 *   existingEntities: { characters, locations, objects, terms, chapters }
 *   canonRoleLocks?: [{ characterId, characterName, specificRole, locked }]
 *   onBatchCreated: (items[]) => void
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, X, Loader2, Check, RotateCcw, Trash2, Plus } from 'lucide-react';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import {
  BATCH_CHARACTER_MAX_COUNT,
  buildCharacterBatchPlan,
  clampBatchCount,
} from '../../utils/batchCharacterHint';
import './BatchGenerate.css';

const ENTITY_CONFIG = {
  character: {
    label: 'nhân vật',
    plural: 'nhân vật',
    defaultCount: 3,
    maxCount: BATCH_CHARACTER_MAX_COUNT,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng nhân vật cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện và nhân vật đã có, TẠO THÊM nhân vật mới PHÙ HỢP với mạch truyện.
Mỗi nhân vật phải có LÝ DO TỒN TẠI trong cốt truyện (không tạo random).

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","role":"protagonist|antagonist|supporting|mentor|minor","specific_role":"vai tro canon cu the neu tac gia yeu cau; de rong neu khong co","specific_role_locked":false,"appearance":"2-3 câu","personality":"2-3 câu","goals":"mục tiêu","notes":"vai trò trong cốt truyện"}] }`,
  },
  location: {
    label: 'địa điểm',
    plural: 'địa điểm',
    defaultCount: 3,
    maxCount: 8,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện và thế giới đã có, TẠO THÊM địa điểm mới PHÙ HỢP với mạch truyện.
Mỗi địa điểm phải ĐÃ ĐƯỢC ĐỀ CẬP trong outline hoặc SẼ CẦN cho cốt truyện.

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","description":"mô tả 2-3 câu","details":"chi tiết kiến trúc, đặc điểm 2-3 câu"}] }`,
  },
  object: {
    label: 'vật phẩm',
    plural: 'vật phẩm',
    defaultCount: 3,
    maxCount: 6,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện, TẠO vật phẩm quan trọng cho câu chuyện.
Mỗi vật phẩm phải CÓ VAI TRÒ trong cốt truyện (chìa khóa giải quyết xung đột, nguồn sức mạnh, v.v.)

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","description":"mô tả 2-3 câu","properties":"thuộc tính, công dụng, hạn chế","owner":"tên nhân vật sở hữu (nếu có)"}] }`,
  },
  term: {
    label: 'thuật ngữ',
    plural: 'thuật ngữ',
    defaultCount: 4,
    maxCount: 10,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện và thế giới đã có, TẠO THÊM thuật ngữ/khái niệm PHÙ HỢP.
Mỗi thuật ngữ phải GIẢI THÍCH một khía cạnh của thế giới truyện.

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","definition":"định nghĩa 3-5 câu","category":"magic|organization|race|technology|concept|culture|other"}] }`,
  },
};

export default function BatchGenerate({
  entityType = 'character',
  projectContext = {},
  existingEntities = {},
  canonRoleLocks: providedCanonRoleLocks = [],
  onBatchCreated,
  onClose,
}) {
  const [count, setCount] = useState(ENTITY_CONFIG[entityType]?.defaultCount || 3);
  const [customHint, setCustomHint] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [error, setError] = useState(null);
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(true);
  const [generatingCount, setGeneratingCount] = useState(null);

  const config = ENTITY_CONFIG[entityType];
  const defaultCount = config?.defaultCount || 3;
  const maxCount = config?.maxCount || BATCH_CHARACTER_MAX_COUNT;
  const derivedCanonRoleLocks = useMemo(() => (
    (existingEntities.characters || [])
      .map((character) => ({
        characterId: character.id,
        characterName: String(character.name || '').trim(),
        specificRole: String(character.specific_role || character.specificRole || '').trim(),
        locked: Boolean(character.specific_role_locked ?? character.specificRoleLocked),
      }))
      .filter((item) => item.locked && item.characterName && item.specificRole)
  ), [existingEntities.characters]);
  const canonRoleLocks = Array.isArray(providedCanonRoleLocks) && providedCanonRoleLocks.length > 0
    ? providedCanonRoleLocks
    : derivedCanonRoleLocks;

  const characterBatchPlan = useMemo(() => {
    if (entityType !== 'character' || !autoDetectEnabled) {
      const clampedCount = clampBatchCount(count, 1, maxCount);
      return {
        count: clampedCount,
        effectiveCount: clampedCount,
        suggestedCount: clampedCount,
        hasClearMissingList: false,
        warning: '',
        hintAnalysis: {
          detectedCharacters: [],
          existingCharacters: [],
          missingCharacters: [],
          clearList: false,
        },
      };
    }

    return buildCharacterBatchPlan({
      selectedCount: count,
      hint: customHint,
      existingCharacters: existingEntities.characters || [],
      maxCount,
    });
  }, [autoDetectEnabled, count, customHint, entityType, existingEntities.characters, maxCount]);

  useEffect(() => {
    setCount((previousCount) => clampBatchCount(previousCount, 1, maxCount));
  }, [maxCount]);

  useEffect(() => {
    if (entityType !== 'character' || customHint.trim()) return;
    setCount(defaultCount);
  }, [customHint, defaultCount, entityType]);

  const setClampedCount = (value) => {
    setCount(clampBatchCount(value, 1, maxCount));
  };

  const missingCharacterNames = characterBatchPlan.hintAnalysis.missingCharacters
    .map((character) => character.name);
  const hasMissingCharacterPlan = entityType === 'character' && autoDetectEnabled && characterBatchPlan.hasClearMissingList;
  const missingCount = missingCharacterNames.length;
  const manualCount = clampBatchCount(count, 1, maxCount);
  const manualWarning = hasMissingCharacterPlan && manualCount < missingCount
    ? `Phát hiện ${characterBatchPlan.hintAnalysis.detectedCharacters.length} nhân vật trong dàn ý, đã có ${characterBatchPlan.hintAnalysis.existingCharacters.length}, còn thiếu ${missingCount}. Bạn đang chọn ${manualCount}.`
    : '';

  const resolvePromptTemplates = () => {
    if (!projectContext?.promptTemplates) return {};
    if (typeof projectContext.promptTemplates === 'string') {
      try { return JSON.parse(projectContext.promptTemplates); } catch { return {}; }
    }
    return typeof projectContext.promptTemplates === 'object' ? projectContext.promptTemplates : {};
  };

  // Build context string from existing story data
  const buildContext = () => {
    const parts = [];
    
    if (projectContext.projectTitle) {
      parts.push(`Tên truyện: ${projectContext.projectTitle}`);
    }
    if (projectContext.description) {
      parts.push(`Premise: ${projectContext.description}`);
    }

    // Existing characters
    if (existingEntities.characters?.length > 0) {
      const charList = existingEntities.characters
        .map((c) => {
          const specificRole = String(c.specific_role || c.specificRole || '').trim();
          const roleLocked = Boolean((c.specific_role_locked ?? c.specificRoleLocked) && specificRole);
          return `- ${c.name} (${c.role})${specificRole ? ' | Vai tro cu the: ' + specificRole + (roleLocked ? ' (da khoa canon)' : '') : ''}${c.current_status ? ' | Live Canon: ' + c.current_status : ''}${c.goals ? ': ' + c.goals.substring(0, 50) : ''}`;
        })
        .join('\n');
      parts.push(`Nhân vật đã có:\n${charList}`);
    }

    // Existing locations
    if (existingEntities.locations?.length > 0) {
      const locList = existingEntities.locations.map(l => `- ${l.name}`).join('\n');
      parts.push(`Địa điểm đã có:\n${locList}`);
    }

    // Existing terms
    if (existingEntities.terms?.length > 0) {
      const termList = existingEntities.terms.map(t => `- ${t.name}`).join('\n');
      parts.push(`Thuật ngữ đã có:\n${termList}`);
    }

    // Chapter outlines
    if (existingEntities.chapters?.length > 0) {
      const chapList = existingEntities.chapters
        .map((ch, i) => `${i + 1}. ${ch.title}`)
        .join('\n');
      parts.push(`Outline chương:\n${chapList}`);
    }

    // World profile
    if (projectContext.worldName) {
      parts.push(`Thế giới: ${projectContext.worldName}${projectContext.worldType ? ` (${projectContext.worldType})` : ''}`);
    }

    return parts.join('\n\n');
  };

  const handleGenerate = async (generationMode = 'manual') => {
    const useMissingMode = generationMode === 'missing' && hasMissingCharacterPlan;
    const generationCount = useMissingMode ? Math.min(missingCount, maxCount) : manualCount;
    setIsGenerating(true);
    setGeneratingCount(generationCount);
    setError(null);
    setResults([]);
    setExcluded(new Set());

    const contextStr = buildContext();
    const missingTargetList = missingCharacterNames.length > 0
      ? missingCharacterNames.join(', ')
      : '';
    const promptUserRequest = customHint.trim()
      ? useMissingMode
        ? [
          `Dua tren yeu cau bo sung duoi day va danh sach nhan vat da co, hay tu phan tich danh sach nhan vat ro rang trong dan y.`,
          `Chi tao ho so cho toi da ${generationCount} nhan vat con thieu so voi name + aliases da co.`,
          missingTargetList ? `Uu tien cac ten con thieu: ${missingTargetList}.` : '',
          'Neu danh sach nhan vat ro rang it hon so luong toi da, chi tra ve so nhan vat con thieu thuc te.',
          'Khong tao them nhan vat ngoai danh sach con thieu neu dan y da neu ro danh sach.',
          '',
          '[YEU CAU BO SUNG]',
          customHint,
        ].filter(Boolean).join('\n')
        : [
          `Dua tren yeu cau bo sung duoi day, tao ${generationCount} ${config.plural}.`,
          '',
          '[YEU CAU BO SUNG]',
          customHint,
        ].join('\n')
      : `Tao ${generationCount} ${config.plural} phu hop voi cot truyen tren.`;

    aiService.send({
      taskType: TASK_TYPES.AI_GENERATE_ENTITY,
      messages: buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
        projectTitle: projectContext.projectTitle || '',
        genre: projectContext.genre || '',
        promptTemplates: resolvePromptTemplates(),
        userPrompt: promptUserRequest,
        entityType,
        batchCount: generationCount,
        aiInferCharacterList: useMissingMode,
        knownMissingCharacterNames: missingCharacterNames,
        selectedBatchCount: manualCount,
        canonRoleLocks,
        entityContextText: contextStr,
      }),
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        setGeneratingCount(null);
        try {
          const parsed = parseAIJsonValue(text);
          const items = Array.isArray(parsed)
            ? parsed
            : isPlainObject(parsed)
              ? parsed.items || parsed.characters || parsed.locations || parsed.terms || parsed.objects || []
              : [];
          setResults(Array.isArray(items) ? items : []);
        } catch (e) {
          console.error('[BatchGenerate] Parse error:', e, '\nRaw:', text);
          setError('Không parse được. Thử lại?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setGeneratingCount(null);
        setError(err.message || 'Lỗi AI');
      },
    });
  };

  const toggleExclude = (idx) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleApprove = () => {
    const approved = results.filter((_, i) => !excluded.has(i));
    if (onBatchCreated) onBatchCreated(approved);
  };

  return (
    <div className="batch-gen">
      {/* Header */}
      <div className="batch-gen-header">
        <h4><Sparkles size={16} /> Tạo hàng loạt {config.plural}</h4>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Step 1: Config */}
      {results.length === 0 && !isGenerating && (
        <div className="batch-gen-config">
          <div className="batch-gen-row">
            <label>Số lượng:</label>
            <div className="batch-gen-count">
              <button className="btn btn-ghost btn-sm batch-gen-count-btn" onClick={() => setClampedCount(count - 1)}>−</button>
              <input
                className="batch-gen-count-input"
                type="number"
                min={1}
                max={maxCount}
                value={count}
                onChange={(event) => setClampedCount(event.target.value)}
                onBlur={(event) => setClampedCount(event.target.value)}
                aria-label="Số lượng cần tạo"
              />
              <button className="btn btn-ghost btn-sm batch-gen-count-btn" onClick={() => setClampedCount(count + 1)}>+</button>
            </div>
            <div className="batch-gen-count-meta">
              Tối đa {maxCount}. Nút tạo chính sẽ dùng đúng số bạn đang chọn: {manualCount}.
            </div>
          </div>

          <div className="batch-gen-row">
            <label>Yêu cầu bổ sung (tùy chọn):</label>
            <textarea
              className="batch-gen-hint"
              placeholder={entityType === 'character' 
                ? 'Ví dụ: Tạo các thành viên của phe phản diện, có quan hệ quyền lực nội bộ...'
                : entityType === 'location'
                ? 'Ví dụ: Tạo các địa điểm cho arc chiến trường, từ biên cương đến kinh đô...'
                : entityType === 'term'
                ? 'Ví dụ: Tạo hệ thống cấp bậc tu luyện cho thế giới này...'
                : 'Ví dụ: Tạo vũ khí cho các nhân vật chính...'}
              value={customHint}
              onChange={e => setCustomHint(e.target.value)}
              rows={2}
            />
          </div>

          {entityType === 'character' && (
            <label className="batch-gen-auto-toggle">
              <input
                type="checkbox"
                checked={autoDetectEnabled}
                onChange={(event) => setAutoDetectEnabled(event.target.checked)}
              />
              <span>Phân tích danh sách nhân vật trong yêu cầu bổ sung</span>
            </label>
          )}

          {entityType === 'character' && autoDetectEnabled && characterBatchPlan.hintAnalysis.detectedCharacters.length > 0 && (
            <div className="batch-gen-auto-detect">
              <span className="batch-gen-auto-detect__label">Tự đoán từ yêu cầu bổ sung</span>
              <p>
                Phát hiện {characterBatchPlan.hintAnalysis.detectedCharacters.length} nhân vật trong dàn ý,
                {' '}đã có {characterBatchPlan.hintAnalysis.existingCharacters.length},
                {' '}còn thiếu {characterBatchPlan.hintAnalysis.missingCharacters.length}.
              </p>
              {missingCharacterNames.length > 0 && (
                <div className="batch-gen-auto-detect__names">
                  {missingCharacterNames.slice(0, 10).join(', ')}
                  {missingCharacterNames.length > 10 ? ` +${missingCharacterNames.length - 10}` : ''}
                </div>
              )}
            </div>
          )}

          {manualWarning && (
            <div className="batch-gen-warning">{manualWarning}</div>
          )}

          {/* Context preview */}
          <div className="batch-gen-context-preview">
            <span className="batch-gen-context-label">AI sẽ dựa trên:</span>
            <div className="batch-gen-context-tags">
              {existingEntities.chapters?.length > 0 && <span className="batch-tag">📋 {existingEntities.chapters.length} chương</span>}
              {existingEntities.characters?.length > 0 && <span className="batch-tag">👤 {existingEntities.characters.length} nhân vật</span>}
              {canonRoleLocks.length > 0 && <span className="batch-tag">{canonRoleLocks.length} vai trò canon đã khóa</span>}
              {existingEntities.locations?.length > 0 && <span className="batch-tag">📍 {existingEntities.locations.length} địa điểm</span>}
              {existingEntities.terms?.length > 0 && <span className="batch-tag">📖 {existingEntities.terms.length} thuật ngữ</span>}
              {projectContext.worldName && <span className="batch-tag">🌍 {projectContext.worldName}</span>}
            </div>
          </div>

          {error && <div className="batch-gen-error">{error}</div>}

          <div className="batch-gen-generate-actions">
            <button className="btn btn-primary" onClick={() => handleGenerate('manual')} disabled={isGenerating || manualCount < 1}>
              <Sparkles size={15} /> Tạo {manualCount} {config.plural}
            </button>
            {hasMissingCharacterPlan && missingCount > 0 && (
              <button className="btn btn-ghost" onClick={() => handleGenerate('missing')} disabled={isGenerating}>
                Tạo {missingCount} nhân vật còn thiếu
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {isGenerating && (
        <div className="batch-gen-loading">
          <Loader2 size={32} className="spin" />
          <p>AI đang tạo {generatingCount || manualCount} {config.plural} phù hợp cốt truyện...</p>
        </div>
      )}

      {/* Step 2: Review */}
      {results.length > 0 && (
        <div className="batch-gen-results">
          <p className="batch-gen-results-info">
            AI tạo {results.length} {config.plural} — bỏ tick để loại
          </p>

          <div className="batch-gen-items">
            {results.map((item, i) => (
              <div
                key={i}
                className={`batch-gen-item ${excluded.has(i) ? 'batch-gen-item--excluded' : ''}`}
                onClick={() => toggleExclude(i)}
              >
                <div className="batch-gen-item-header">
                  <span className="batch-gen-item-check">
                    {excluded.has(i) ? '☐' : '☑'}
                  </span>
                  <strong>{item.name}</strong>
                  {item.role && <span className="badge badge-sm">{item.role}</span>}
                  {item.age && <span className="badge badge-sm">{item.age}</span>}
                  {item.specific_role && <span className="badge badge-sm">Vai trò cụ thể</span>}
                  {item.category && <span className="badge badge-sm">{item.category}</span>}
                </div>
                <div className="batch-gen-item-body">
                  {item.specific_role && (
                    <p>
                      <b>Vai trò cụ thể:</b> {item.specific_role}
                      {item.specific_role_locked && ' · đã khóa'}
                    </p>
                  )}
                  {item.personality && <p>{item.personality}</p>}
                  {item.personality_tags && <p><b>Tags:</b> {item.personality_tags}</p>}
                  {item.flaws && <p><b>Flaws:</b> {item.flaws}</p>}
                  {item.current_status && <p><b>Live Canon:</b> {item.current_status}</p>}
                  {item.description && <p>{item.description}</p>}
                  {item.definition && <p>{item.definition}</p>}
                  {item.goals && <p><b>Mục tiêu:</b> {item.goals}</p>}
                  {item.notes && <p className="batch-gen-item-notes">{item.notes}</p>}
                  {item.details && <p className="batch-gen-item-notes">{item.details}</p>}
                  {item.properties && <p className="batch-gen-item-notes"><b>Thuộc tính:</b> {item.properties}</p>}
                  {item.owner && <p className="batch-gen-item-notes"><b>Chủ:</b> {item.owner}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="batch-gen-actions">
            <button className="btn btn-ghost" onClick={() => { setResults([]); setError(null); }}>
              <RotateCcw size={14} /> Tạo lại
            </button>
            <button
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={results.length === excluded.size}
            >
              <Check size={14} /> Thêm {results.length - excluded.size} {config.plural}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
