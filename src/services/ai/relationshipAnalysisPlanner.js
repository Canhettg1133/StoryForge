import { buildCanonContentSignature } from '../canon/utils';

export const RELATIONSHIP_ANALYSIS_MAX_ESTIMATED_INPUT_TOKENS = 100000;
export const RELATIONSHIP_ANALYSIS_SHARED_OVERHEAD_TOKENS = 2400;
const CHAPTER_OVERHEAD_TOKENS = 220;

export function stripHtmlForRelationshipAnalysis(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function estimateRelationshipAnalysisTokens(value = '') {
  return Math.ceil(String(value || '').length / 3);
}

export function buildRelationshipAnalysisSignature(text = '') {
  return buildCanonContentSignature(stripHtmlForRelationshipAnalysis(text));
}

export function buildRelationshipAnalysisChapterText(scenes = []) {
  return [...(scenes || [])]
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || (a.id || 0) - (b.id || 0))
    .map((scene, index) => {
      const text = stripHtmlForRelationshipAnalysis(scene.draft_text || scene.final_text || '');
      if (!text) return '';
      const title = stripHtmlForRelationshipAnalysis(scene.title || `Cảnh ${index + 1}`);
      return `[Cảnh ${index + 1}: ${title}]\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function normalizeId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function buildMetaByChapterId(chapterMetas = []) {
  return new Map((chapterMetas || []).map((meta) => [normalizeId(meta.chapter_id), meta]));
}

function buildPendingCountByChapterId(pendingSuggestions = []) {
  const counts = new Map();
  (pendingSuggestions || []).forEach((suggestion) => {
    if (suggestion?.status !== 'pending' || suggestion?.type !== 'relationship_update') return;
    const chapterId = normalizeId(suggestion.source_chapter_id);
    counts.set(chapterId, (counts.get(chapterId) || 0) + 1);
  });
  return counts;
}

export function getRelationshipAnalysisStatus({ text = '', signature = '', meta = null } = {}) {
  if (!stripHtmlForRelationshipAnalysis(text)) return 'empty';
  if (!meta?.relationship_analysis_signature) return 'unanalyzed';
  if (meta.relationship_analysis_signature !== signature) return 'stale';
  if (meta.relationship_analysis_status === 'failed') return 'failed';
  return 'analyzed';
}

function statusNeedsAnalysis(status) {
  return ['unanalyzed', 'stale', 'failed'].includes(status);
}

export function buildRelationshipAnalysisChapterPlans({
  chapters = [],
  scenesByChapterId = new Map(),
  chapterMetas = [],
  pendingSuggestions = [],
} = {}) {
  const metaByChapterId = buildMetaByChapterId(chapterMetas);
  const pendingCountByChapterId = buildPendingCountByChapterId(pendingSuggestions);

  return [...(chapters || [])]
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || (a.id || 0) - (b.id || 0))
    .map((chapter, index) => {
      const chapterId = normalizeId(chapter.id);
      const scenes = scenesByChapterId.get(chapterId) || scenesByChapterId.get(String(chapterId)) || [];
      const text = buildRelationshipAnalysisChapterText(scenes);
      const signature = buildRelationshipAnalysisSignature(text);
      const meta = metaByChapterId.get(chapterId) || null;
      const status = getRelationshipAnalysisStatus({ text, signature, meta });
      return {
        chapterId,
        chapterTitle: chapter.title || `Chương ${index + 1}`,
        orderIndex: chapter.order_index ?? index,
        scenes,
        text,
        signature,
        status,
        pendingSuggestionCount: pendingCountByChapterId.get(chapterId) || 0,
        meta,
      };
    });
}

function splitChapterPlanIntoItems(chapterPlan, maxEstimatedInputTokens, sharedContextTokens) {
  const budget = Math.max(1, maxEstimatedInputTokens - sharedContextTokens);
  const fullTokens = estimateRelationshipAnalysisTokens(chapterPlan.text) + CHAPTER_OVERHEAD_TOKENS;
  if (fullTokens <= budget) {
    return [{
      ...chapterPlan,
      partIndex: 1,
      partCount: 1,
      estimatedInputTokens: fullTokens,
    }];
  }

  const sceneBlocks = [...(chapterPlan.scenes || [])]
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || (a.id || 0) - (b.id || 0))
    .map((scene, index) => {
      const text = stripHtmlForRelationshipAnalysis(scene.draft_text || scene.final_text || '');
      if (!text) return null;
      const title = stripHtmlForRelationshipAnalysis(scene.title || `Cảnh ${index + 1}`);
      const block = `[Cảnh ${index + 1}: ${title}]\n${text}`;
      return {
        block,
        tokens: estimateRelationshipAnalysisTokens(block) + CHAPTER_OVERHEAD_TOKENS,
      };
    })
    .filter(Boolean);

  const groups = [];
  let currentBlocks = [];
  let currentTokens = CHAPTER_OVERHEAD_TOKENS;
  for (const sceneBlock of sceneBlocks) {
    if (sceneBlock.tokens > budget) {
      return [{
        ...chapterPlan,
        partIndex: 1,
        partCount: 1,
        tooLarge: true,
        tooLargeReason: 'Một cảnh vượt ngân sách 100k estimated input tokens.',
        estimatedInputTokens: sceneBlock.tokens,
      }];
    }
    if (currentBlocks.length > 0 && currentTokens + sceneBlock.tokens > budget) {
      groups.push({ blocks: currentBlocks, tokens: currentTokens });
      currentBlocks = [];
      currentTokens = CHAPTER_OVERHEAD_TOKENS;
    }
    currentBlocks.push(sceneBlock.block);
    currentTokens += sceneBlock.tokens;
  }
  if (currentBlocks.length > 0) groups.push({ blocks: currentBlocks, tokens: currentTokens });

  return groups.map((group, index) => ({
    ...chapterPlan,
    text: group.blocks.join('\n\n'),
    partIndex: index + 1,
    partCount: groups.length,
    estimatedInputTokens: group.tokens,
  }));
}

export function planRelationshipAnalysisBatches({
  chapters = [],
  scenesByChapterId = new Map(),
  chapterMetas = [],
  pendingSuggestions = [],
  forceChapterIds = [],
  maxEstimatedInputTokens = RELATIONSHIP_ANALYSIS_MAX_ESTIMATED_INPUT_TOKENS,
  sharedContextChars = 0,
} = {}) {
  const forceIds = new Set((forceChapterIds || []).map(normalizeId));
  const sharedContextTokens = RELATIONSHIP_ANALYSIS_SHARED_OVERHEAD_TOKENS
    + Math.ceil(Math.max(0, sharedContextChars) / 3);
  const chapterPlans = buildRelationshipAnalysisChapterPlans({
    chapters,
    scenesByChapterId,
    chapterMetas,
    pendingSuggestions,
  });
  const requestedPlans = chapterPlans.filter((plan) => {
    if (plan.status === 'empty') return false;
    return forceIds.has(plan.chapterId) || statusNeedsAnalysis(plan.status);
  });

  const oversizedItems = [];
  const requestItems = [];
  requestedPlans.forEach((plan) => {
    const items = splitChapterPlanIntoItems(plan, maxEstimatedInputTokens, sharedContextTokens);
    items.forEach((item) => {
      if (item.tooLarge) oversizedItems.push(item);
      else requestItems.push(item);
    });
  });

  const batches = [];
  requestItems.forEach((item) => {
    const itemTokens = item.estimatedInputTokens || estimateRelationshipAnalysisTokens(item.text);
    const lastBatch = batches[batches.length - 1] || null;
    if (
      lastBatch
      && lastBatch.estimatedInputTokens + itemTokens <= maxEstimatedInputTokens
    ) {
      lastBatch.items.push(item);
      lastBatch.estimatedInputTokens += itemTokens;
      return;
    }
    batches.push({
      items: [item],
      estimatedInputTokens: sharedContextTokens + itemTokens,
    });
  });

  return {
    chapterPlans,
    requestedPlans,
    batches,
    oversizedItems,
    maxEstimatedInputTokens,
  };
}

export default {
  RELATIONSHIP_ANALYSIS_MAX_ESTIMATED_INPUT_TOKENS,
  buildRelationshipAnalysisChapterPlans,
  buildRelationshipAnalysisChapterText,
  buildRelationshipAnalysisSignature,
  estimateRelationshipAnalysisTokens,
  getRelationshipAnalysisStatus,
  planRelationshipAnalysisBatches,
  stripHtmlForRelationshipAnalysis,
};
