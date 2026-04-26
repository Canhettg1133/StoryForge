import React from 'react';
import { ChevronRight } from 'lucide-react';
import { WORKFLOW_TABS } from '../labLiteUiHelpers.js';

export default function GuidedWorkspaceRail({ activeStep, stepStatuses, nextAction, onStepChange, onRunAction }) {
  return (
    <section className="lab-lite-guided-shell" data-testid="lab-lite-guided-workspace">
      <div className="lab-lite-workflow-rail" aria-label="Quy trình Lab Lite">
        {WORKFLOW_TABS.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`lab-lite-workflow-step ${activeStep === step.id ? 'is-active' : ''}`}
            onClick={() => onStepChange(step.id)}
          >
            <span>{step.label}</span>
            <small>{stepStatuses[step.id] || 'chưa bắt đầu'}</small>
          </button>
        ))}
      </div>
      <div className="lab-lite-next-action">
        <div>
          <strong>Việc tiếp theo</strong>
          <p>{nextAction.title}</p>
          <small>{nextAction.detail}</small>
        </div>
        <div className="lab-lite-actions lab-lite-actions--tight">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStepChange(nextAction.step)}>
            Mở bước này <ChevronRight size={14} />
          </button>
          {nextAction.action && nextAction.action !== 'open' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onRunAction(nextAction)}>
              Chạy bước đề xuất
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
