import React, { useMemo } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import {
  buildDisplayMacroArcContract,
  getRelationshipStageLabel,
} from '../utils/storyBibleHelpers';

const MacroArcContractPanel = React.memo(function MacroArcContractPanel({
  macroArc,
  allCharacters,
  onAnalyze,
  isAnalyzing = false,
}) {
  const contract = useMemo(
    () => buildDisplayMacroArcContract(macroArc, allCharacters),
    [macroArc, allCharacters]
  );

  const hasCoreData = Boolean(
    contract.narrativeSummary
    || contract.objectives.length
    || contract.targetStates.length
    || contract.focusedCharacters.length
    || contract.forbiddenOutcomes.length
    || contract.chapterAnchors.length
  );

  return (
    <div className={`macro-contract-panel${hasCoreData ? '' : ' macro-contract-panel--empty'}`}>
      <div className="macro-contract-panel__header">
        <div>
          <strong>Contract đại cục</strong>
          <span>
            {contract.hasStructuredSource
              ? 'Đang hiển thị contract đã được AI chuẩn hóa'
              : 'Chưa có contract chuẩn. Hãy bấm "Phân tích bằng AI".'}
          </span>
        </div>
        <div className="macro-contract-panel__actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              onAnalyze?.(event);
            }}
            disabled={!onAnalyze || isAnalyzing}
          >
            {isAnalyzing
              ? <><Loader2 size={14} className="spin" /> Đang phân tích</>
              : <><Wand2 size={14} /> Phân tích bằng AI</>}
          </button>
          <div className="macro-contract-panel__stage">
            <span>{getRelationshipStageLabel(contract.maxRelationshipStage)}</span>
          </div>
        </div>
      </div>

      {hasCoreData ? (
        <div className="macro-contract-panel__body">
          {contract.narrativeSummary && (
            <div className="macro-contract-panel__block">
              <label>Nội dung cốt lõi</label>
              <p>{contract.narrativeSummary}</p>
            </div>
          )}

          {contract.objectives.length > 0 && (
            <div className="macro-contract-panel__block">
              <label>Mục tiêu cốt lõi</label>
              <ul className="macro-contract-panel__list">
                {contract.objectives.slice(0, 4).map((objective) => (
                  <li key={objective.id}>
                    <strong>{objective.id}</strong>
                    <span>{objective.text}</span>
                  </li>
                ))}
              </ul>
              {contract.objectives.length > 4 && (
                <div className="macro-contract-panel__more">
                  +{contract.objectives.length - 4} mục tiêu khác
                </div>
              )}
            </div>
          )}

          {contract.targetStates.length > 0 && (
            <div className="macro-contract-panel__block">
              <label>Trạng thái đích được phép</label>
              <div className="macro-contract-panel__chips">
                {contract.targetStates.map((state) => (
                  <span
                    key={`${state.character}-${state.state}`}
                    className="macro-contract-panel__chip"
                  >
                    {state.character}: {state.state}
                  </span>
                ))}
              </div>
            </div>
          )}

          {contract.focusedCharacters.length > 0 && (
            <div className="macro-contract-panel__block">
              <label>Nhân vật / trục tiêu điểm</label>
              <div className="macro-contract-panel__chips">
                {contract.focusedCharacters.map((name) => (
                  <span key={name} className="macro-contract-panel__chip macro-contract-panel__chip--focus">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {contract.forbiddenOutcomes.length > 0 && (
            <div className="macro-contract-panel__block">
              <label>Không được vượt qua</label>
              <div className="macro-contract-panel__chips">
                {contract.forbiddenOutcomes.map((item) => (
                  <span key={item} className="macro-contract-panel__chip macro-contract-panel__chip--forbidden">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {contract.chapterAnchors.length > 0 && (
            <div className="macro-contract-panel__block">
              <label>Chapter anchors</label>
              <ul className="macro-contract-panel__list">
                {contract.chapterAnchors.map((anchor) => (
                  <li key={anchor.id}>
                    <span>
                      Chuong {anchor.targetChapter} [{anchor.strictness}] - {anchor.requirementText}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {contract.emotionalPeak && (
            <div className="macro-contract-panel__footer">
              Cảm xúc đích: {contract.emotionalPeak}
            </div>
          )}
        </div>
      ) : (
        <div className="macro-contract-panel__empty">
          Chưa có contract có cấu trúc cho cột mốc này. Sau khi nhập nội dung, hãy bấm
          {' '}“Phân tích bằng AI” để AI tách mục tiêu, trạng thái đích và các giới hạn cho planner.
        </div>
      )}
    </div>
  );
});

export default MacroArcContractPanel;
