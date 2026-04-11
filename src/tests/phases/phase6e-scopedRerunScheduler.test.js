import { describe, expect, it } from 'vitest';
import { buildNarrativeExecutionPlan } from '../../services/analysis/v3/scheduler.js';
import { buildScopedRerunJobPlan } from '../../services/analysis/v3/rerunJobPlanner.js';
import { buildScopedRerunPreview } from '../../services/analysis/v3/scopedRerun.js';

describe('Phase 6E - Scoped Rerun Scheduler', () => {
  it('builds multi-key incident execution plan with worker pool lanes', () => {
    const plan = buildNarrativeExecutionPlan({
      phase: 'incident',
      keyCount: 3,
      incidentIds: ['inc-1', 'inc-2'],
    });

    expect(plan.policy).toBe('multi_key_dynamic_pool');
    expect(plan.lanes).toHaveLength(3);
    expect(plan.steps.map((step) => step.id)).toContain('phase_b_workers');
  });

  it('builds rerun preview with scoped invalidation set', () => {
    const preview = buildScopedRerunPreview({
      artifact: { rerunManifest: { scopes: {} } },
      phase: 'window',
      windowIds: ['window_01'],
      reason: 'Boundary ambiguity',
    });

    expect(preview.rerunRequest.windowIds).toEqual(['window_01']);
    expect(preview.invalidation.passIds).toContain('pass_a');
    expect(preview.invalidation.passIds).toContain('pass_g');
    expect(preview.executionPlan.steps[0].id).toBe('load_scope');
  });

  it('builds decomposed job plan with reducer, workers, graph and review jobs', () => {
    const plan = buildScopedRerunJobPlan({
      artifact: {
        analysisWindows: [
          { windowId: 'window_01' },
          { windowId: 'window_02' },
        ],
        incidents: [
          { id: 'inc-1', lineage: { supporting_window_ids: ['window_01'] } },
          { id: 'inc-2', lineage: { supporting_window_ids: ['window_02'] } },
        ],
      },
      corpusId: 'corpus-1',
      analysisId: 'analysis-1',
      phase: 'window',
      windowIds: ['window_01'],
    });

    expect(plan.jobs.map((job) => job.type)).toContain('analysis_window');
    expect(plan.jobs.map((job) => job.type)).toContain('incident_reducer');
    expect(plan.jobs.map((job) => job.type)).toContain('incident_worker');
    expect(plan.jobs.at(-1).type).toBe('review_intelligence');
  });
});
