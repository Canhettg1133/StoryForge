import { checkConsistency } from '../consistency/consistencyChecker.js';
import { analyzeIncidents } from './deepIncidentAnalysis.js';
import { refineBoundaries } from './boundaryRefine.js';
import { coherencePass } from './coherencePass.js';
import { globalSegmentation } from './globalSegmentation.js';
import { buildReviewQueue } from './reviewQueueBuilder.js';
import { getRunMode } from './modes.js';
import { scoreItems } from './scoringEngine.js';

export class IncidentAnalyzer {
  constructor(corpusId, options = {}) {
    this.corpusId = corpusId;
    this.options = {
      mode: options.mode || 'balanced',
      ...options,
    };
    this.modeConfig = getRunMode(this.options.mode);
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : (() => {});
    this.progress = { phase: 'idle', progress: 0, message: '' };
  }

  emitProgress(phase, progress, message) {
    this.progress = { phase, progress, message };
    this.onProgress(this.progress);
  }

  run(payload = {}) {
    const startedAt = Date.now();
    const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
    const inputEvents = Array.isArray(payload?.events) ? payload.events : [];
    const inputLocations = Array.isArray(payload?.locations) ? payload.locations : [];
    const inputIncidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
    const inputConsistencyRisks = Array.isArray(payload?.consistencyRisks)
      ? payload.consistencyRisks
      : [];

    this.emitProgress('segmentation', 0.1, 'Running incident segmentation');
    const segmented = globalSegmentation({
      chapters,
      incidents: inputIncidents,
      events: inputEvents,
    }, {
      mode: this.modeConfig.id,
      minConfidence: this.options.minConfidence,
    });

    this.emitProgress('boundary_refine', 0.25, 'Refining incident boundaries');
    const refinedIncidents = this.modeConfig.boundaryRefine
      ? refineBoundaries(segmented.incidents, chapters, {
        overlapThreshold: this.modeConfig.overlapThreshold,
        bm25Threshold: this.modeConfig.bm25Refinement ? 0.45 : 0.4,
      })
      : segmented.incidents;

    this.emitProgress('deep_analysis', 0.45, 'Analyzing events per incident');
    const deep = analyzeIncidents(refinedIncidents, {
      chapters,
      events: inputEvents,
      locations: inputLocations,
    }, this.options);

    this.emitProgress('consistency_check', 0.62, 'Checking consistency risks');
    const detectedRisks = checkConsistency(deep.incidents, deep.events, deep.locations, this.options);
    const consistencyRisks = dedupeRisks([...inputConsistencyRisks, ...detectedRisks]);

    this.emitProgress('coherence', 0.78, 'Applying global coherence pass');
    const coherent = coherencePass(deep.incidents, deep.events, deep.locations, {
      mode: this.modeConfig.coherencePass,
      autoMergeThreshold: this.modeConfig.autoMergeThreshold,
      suggestMergeThreshold: this.modeConfig.suggestMergeThreshold,
    });

    this.emitProgress('scoring', 0.9, 'Scoring incidents/events/locations');
    const scored = scoreItems(
      coherent.incidents,
      coherent.events,
      coherent.locations,
      consistencyRisks,
    );

    const reviewQueue = this.modeConfig.reviewQueueBuild
      ? buildReviewQueue(
        scored.scoredIncidents,
        scored.scoredEvents,
        scored.scoredLocations,
        consistencyRisks,
        {
          corpusId: this.corpusId,
          analysisId: this.options.analysisId,
        },
      )
      : [];

    this.emitProgress('completed', 1, 'Incident-first pipeline completed');

    return {
      success: true,
      mode: this.modeConfig.id,
      incidents: scored.scoredIncidents,
      events: scored.scoredEvents,
      locations: scored.scoredLocations,
      consistencyRisks,
      reviewQueue,
      changes: coherent.changes,
      processingTime: Date.now() - startedAt,
    };
  }
}

export function runIncidentAnalysis(corpusId, payload = {}, options = {}) {
  const analyzer = new IncidentAnalyzer(corpusId, options);
  return analyzer.run(payload);
}

function dedupeRisks(risks = []) {
  const seen = new Set();
  const deduped = [];

  for (const risk of risks || []) {
    if (!risk) continue;
    const signature = [
      risk.type,
      risk.severity,
      [...new Set(risk.involvedIncidents || [])].sort().join(','),
      [...new Set(risk.involvedEvents || [])].sort().join(','),
      [...new Set(risk.involvedLocations || [])].sort().join(','),
      risk.description,
    ].join('|');

    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(risk);
  }

  return deduped;
}
