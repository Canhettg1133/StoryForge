/**
 * StoryForge — Arc Generation Store (Phase 5)
 * 
 * Manages the entire auto-generation workflow:
 * Setup → Generate Outline → Batch Draft → Feedback Loop
 * 
 * Phase 9 additions:
 *   - currentMacroArcId / currentArcId: kết nối arc generation với đại cục
 *   - commitOutlineOnly / commitDraftsToProject: tạo arc record thực sự, gán arc_id cho chapters
 *   - generateMacroMilestones: AI gợi ý 5-8 cột mốc từ ý tưởng tác giả
 *   - saveMacroMilestones: lưu cột mốc đã duyệt vào DB
 *   - auditArcAlignment: kiểm tra độ lệch arc hiện tại so với đại cục
 */
import { create } from 'zustand';
import aiService from '../services/ai/client';
import { buildPrompt } from '../services/ai/promptBuilder';
import modelRouter, { TASK_TYPES } from '../services/ai/router';
import { gatherContext } from '../services/ai/contextEngine';
import db from '../services/db/database';
import useProjectStore from './projectStore';
import { parseAIJsonValue, isPlainObject } from '../utils/aiJson';
import { buildProseBuffer } from '../utils/proseBuffer';
import {
    buildMacroArcPersistenceSnapshot,
    compileMacroArcContract,
    getChapterAnchorsInRange,
    isLegacyChapterAnchorId,
    preserveChapterAnchorIds,
    validateDraftAgainstChapterAnchors,
    validateOutlineAgainstChapterAnchors,
    validateOutlineAgainstMacroArcContract,
} from '../services/ai/macroArcContract';

// Ensure router is injected (same pattern as aiStore.js)
aiService.setRouter(modelRouter);

function getNextOrderIndex(items) {
    return items.reduce((max, item) => {
        const order = Number.isFinite(item?.order_index) ? item.order_index : -1;
        return Math.max(max, order);
    }, -1) + 1;
}

function normalizeOutlineResult(parsed) {
    if (Array.isArray(parsed)) {
        return {
            arc_title: '',
            chapters: parsed.filter(isPlainObject),
        };
    }
    return isPlainObject(parsed) ? parsed : null;
}

function stripChapterPrefix(title) {
    if (!title) return '';
    return String(title)
        .replace(/^\s*(?:chuong|chương|chapter)\s*\d+\s*[:\-.\]]*\s*/iu, '')
        .trim();
}

function normalizeGeneratedChapterTitle(title, chapterNumber) {
    const cleanTitle = stripChapterPrefix(title);
    return cleanTitle
        ? `Chuong ${chapterNumber}: ${cleanTitle}`
        : `Chuong ${chapterNumber}`;
}

function normalizeGeneratedOutline(outline, startingChapterIndex) {
    if (!outline || !Array.isArray(outline.chapters)) return outline;
    return {
        ...outline,
        chapters: outline.chapters.map((chapter, index) => ({
            ...chapter,
            title: normalizeGeneratedChapterTitle(chapter?.title, startingChapterIndex + index + 1),
        })),
    };
}

function buildChapterBrief(chapter, meta, fallbackNumber) {
    const chapterNumber = Number.isFinite(chapter?.order_index) ? chapter.order_index + 1 : fallbackNumber;
    let purpose = chapter?.purpose || '';
    try {
        const parsed = JSON.parse(purpose);
        if (Array.isArray(parsed)) {
            purpose = parsed.join('; ');
        }
    } catch {
        // keep plain text purpose
    }
    return {
        chapterNumber,
        title: chapter?.title || `Chuong ${chapterNumber}`,
        summary: meta?.summary || chapter?.summary || '',
        purpose,
        status: chapter?.status || 'draft',
    };
}

async function loadExistingChapterBriefs(projectId) {
    const [chapters, metas] = await Promise.all([
        db.chapters.where('project_id').equals(projectId).sortBy('order_index'),
        db.chapterMeta.where('project_id').equals(projectId).toArray(),
    ]);

    return chapters.map((chapter, index) => {
        const meta = metas.find((item) => item.chapter_id === chapter.id);
        return buildChapterBrief(chapter, meta, index + 1);
    });
}

function buildPriorGeneratedBriefs(generatedOutline, upToIndex, startingChapterIndex = 0) {
    if (!generatedOutline?.chapters || upToIndex <= 0) return [];
    return generatedOutline.chapters.slice(0, upToIndex).map((chapter, index) => ({
        chapterNumber: startingChapterIndex + index + 1,
        title: chapter?.title || `Chuong ${startingChapterIndex + index + 1}`,
        summary: chapter?.summary || '',
        purpose: chapter?.purpose || (Array.isArray(chapter?.key_events) ? chapter.key_events.join('; ') : ''),
        status: 'planned',
    }));
}

export function normalizeMacroMilestoneItem(item, index = 0) {
    const snapshot = buildMacroArcPersistenceSnapshot({
        ...item,
        title: String(item?.title || '').trim(),
        description: String(item?.description || '').trim(),
        chapter_from: Number(item?.chapter_from) || 0,
        chapter_to: Number(item?.chapter_to) || 0,
        emotional_peak: String(item?.emotional_peak || '').trim(),
        contract_json: item?.contract_json || (item?.contract ? JSON.stringify(item.contract) : ''),
    });

    return {
        ...snapshot,
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index + 1,
    };
}

function normalizeMacroPlanningScope({
    planningScopeStart = 0,
    planningScopeEnd = 0,
    start = 0,
    end = 0,
    targetLength = 0,
}) {
    const rawStart = Number(planningScopeStart) || Number(start) || 0;
    const rawEnd = Number(planningScopeEnd) || Number(end) || 0;
    const safeTarget = Math.max(Number(targetLength) || 0, rawEnd, rawStart, 1);
    const normalizedStart = Math.min(safeTarget, Math.max(1, rawStart || 1));
    const normalizedEnd = Math.max(normalizedStart, Math.min(safeTarget, rawEnd || safeTarget));
    return { start: normalizedStart, end: normalizedEnd, span: normalizedEnd - normalizedStart + 1 };
}

function getDistributedScopeRange(scope, index, total) {
    if (!scope || !scope.span || total <= 0) {
        return { chapter_from: 0, chapter_to: 0 };
    }
    const startOffset = Math.floor((index * scope.span) / total);
    const endOffset = Math.max(startOffset, Math.floor((((index + 1) * scope.span) / total) - 1));
    return {
        chapter_from: scope.start + startOffset,
        chapter_to: Math.min(scope.end, scope.start + endOffset),
    };
}

function distributeChapterBlock(start, end, count) {
    const safeCount = Math.max(0, Number(count) || 0);
    if (safeCount === 0) return [];

    const safeStart = Number(start) || 0;
    const safeEnd = Number(end) || 0;
    if (safeEnd < safeStart) {
        return Array.from({ length: safeCount }, () => ({
            chapter_from: safeStart,
            chapter_to: safeStart,
        }));
    }

    const span = safeEnd - safeStart + 1;
    return Array.from({ length: safeCount }, (_, index) => {
        const startOffset = Math.floor((index * span) / safeCount);
        const endOffset = Math.max(startOffset, Math.floor((((index + 1) * span) / safeCount) - 1));
        return {
            chapter_from: safeStart + startOffset,
            chapter_to: Math.min(safeEnd, safeStart + endOffset),
        };
    });
}

function buildScopedMilestoneRanges(scope, manualPlans = [], total = 0) {
    if (!scope || !scope.span || total <= 0) return [];

    const ranges = Array.from({ length: total }, () => null);
    const fixedPlans = manualPlans
        .map((item, index) => (item && !item.isIncomplete ? { ...item, index } : null))
        .filter(Boolean)
        .sort((a, b) => a.index - b.index);

    if (fixedPlans.length === 0) return [];

    let previousFixedIndex = -1;
    let previousChapterTo = scope.start - 1;

    fixedPlans.forEach((fixedPlan) => {
        const autoBlockStart = previousFixedIndex + 1;
        const autoBlockCount = Math.max(0, fixedPlan.index - autoBlockStart);
        const autoRanges = distributeChapterBlock(previousChapterTo + 1, fixedPlan.chapter_from - 1, autoBlockCount);

        autoRanges.forEach((range, offset) => {
            ranges[autoBlockStart + offset] = range;
        });

        ranges[fixedPlan.index] = {
            chapter_from: fixedPlan.chapter_from,
            chapter_to: fixedPlan.chapter_to,
        };

        previousFixedIndex = fixedPlan.index;
        previousChapterTo = fixedPlan.chapter_to;
    });

    const trailingStart = previousFixedIndex + 1;
    const trailingCount = Math.max(0, total - trailingStart);
    const trailingRanges = distributeChapterBlock(previousChapterTo + 1, scope.end, trailingCount);

    trailingRanges.forEach((range, offset) => {
        ranges[trailingStart + offset] = range;
    });

    return ranges;
}

function normalizeManualMacroMilestonePlans(plans = [], scope = null) {
    if (!Array.isArray(plans) || !scope) return [];
    return plans.map((item) => {
        const from = Number(item?.chapter_from) || 0;
        const to = Number(item?.chapter_to) || 0;
        if (!from && !to) return null;
        if (!from || !to) {
            return {
                chapter_from: from || 0,
                chapter_to: to || 0,
                isIncomplete: true,
            };
        }
        const chapter_from = Math.min(scope.end, Math.max(scope.start, from));
        const chapter_to = Math.max(chapter_from, Math.min(scope.end, to));
        return {
            chapter_from,
            chapter_to,
            isIncomplete: false,
        };
    });
}

function normalizeMacroMilestonePayload(payload, options = {}) {
    const requestedMilestoneCount = Math.max(0, Number(options?.requestedMilestoneCount) || 0);
    const sourceMilestones = Array.isArray(payload?.milestones) ? payload.milestones : [];
    const milestones = requestedMilestoneCount > 0
        ? sourceMilestones.slice(0, requestedMilestoneCount)
        : sourceMilestones;
    const scope = options?.planningScope ? normalizeMacroPlanningScope(options.planningScope) : null;
    const manualPlans = normalizeManualMacroMilestonePlans(options?.macroMilestoneChapterPlans, scope);
    const scopedRanges = buildScopedMilestoneRanges(scope, manualPlans, milestones.length);
    const structuredChapterAnchors = normalizeStructuredChapterAnchorInput(options?.macroChapterAnchorInputs);
    return {
        milestones: milestones.map((item, index) => {
            const normalized = normalizeMacroMilestoneItem(item, index);
            if (!scope) {
                return attachStructuredAnchorsToMilestone(normalized, structuredChapterAnchors);
            }
            const fixedPlan = manualPlans[index] && !manualPlans[index]?.isIncomplete ? manualPlans[index] : null;
            const scopedRange = scopedRanges[index];
            const distributed = getDistributedScopeRange(scope, index, milestones.length);
            const rawFrom = fixedPlan?.chapter_from
                || scopedRange?.chapter_from
                || (Number(normalized.chapter_from) > 0 ? Number(normalized.chapter_from) : distributed.chapter_from);
            const rawTo = fixedPlan?.chapter_to
                || scopedRange?.chapter_to
                || (Number(normalized.chapter_to) > 0 ? Number(normalized.chapter_to) : distributed.chapter_to);
            const chapter_from = Math.min(scope.end, Math.max(scope.start, rawFrom || scope.start));
            const chapter_to = Math.max(
                chapter_from,
                Math.min(scope.end, Math.max(chapter_from, rawTo || chapter_from))
            );
            return attachStructuredAnchorsToMilestone({
                ...normalized,
                order: index + 1,
                chapter_from,
                chapter_to,
            }, structuredChapterAnchors);
        }),
    };
}

function normalizeMacroContractAnalysisPayload(payload, macroArc = {}) {
    const rawContract = isPlainObject(payload?.contract)
        ? payload.contract
        : isPlainObject(payload)
            ? payload
            : null;

    if (!rawContract) return null;

    const previousChapterAnchors = Array.isArray(macroArc?.chapter_anchors)
        ? macroArc.chapter_anchors
        : [];
    const hasExplicitChapterAnchors = Object.prototype.hasOwnProperty.call(rawContract, 'chapterAnchors')
        || Object.prototype.hasOwnProperty.call(rawContract, 'chapter_anchors');
    const nextChapterAnchorsCandidate = rawContract.chapterAnchors ?? rawContract.chapter_anchors;
    const rawChapterAnchors = hasExplicitChapterAnchors
        ? (
            Array.isArray(nextChapterAnchorsCandidate)
                && (nextChapterAnchorsCandidate.length > 0 || previousChapterAnchors.length === 0)
                ? nextChapterAnchorsCandidate
                : previousChapterAnchors
        )
        : previousChapterAnchors;
    const preservedChapterAnchors = preserveChapterAnchorIds(
        rawChapterAnchors,
        previousChapterAnchors,
    );
    const snapshot = buildMacroArcPersistenceSnapshot({
        ...macroArc,
        description: macroArc?.description || rawContract.narrative_summary || '',
        contract: rawContract,
        contract_json: typeof rawContract === 'string' ? rawContract : JSON.stringify(rawContract),
        chapter_anchors: preservedChapterAnchors,
    });
    if (!snapshot?.contract) return null;

    return {
        contract: snapshot.contract,
        contract_json: snapshot.contract_json,
        chapter_anchors: snapshot.chapter_anchors || [],
        warnings: Array.isArray(payload?.warnings) ? payload.warnings.filter(Boolean) : [],
    };
}

function normalizeStructuredChapterAnchorInput(chapterAnchors = []) {
    const snapshot = buildMacroArcPersistenceSnapshot({
        title: '',
        description: '',
        chapter_anchors: Array.isArray(chapterAnchors) ? chapterAnchors : [],
    });
    return snapshot?.chapter_anchors || [];
}

function mergeChapterAnchorLists(primary = [], secondary = []) {
    const seen = new Set();
    return [...(primary || []), ...(secondary || [])].filter((anchor) => {
        const id = String(anchor?.id || '').trim();
        const key = anchor?.sourceMacroArcId && isLegacyChapterAnchorId(id)
            ? `${anchor.sourceMacroArcId}:${id}`
            : (anchor?.sourceMacroArcId ? `${anchor.sourceMacroArcId}:${id}` : id);
        if (!id || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function attachStructuredAnchorsToMilestone(milestone, structuredChapterAnchors = []) {
    const normalized = normalizeMacroMilestoneItem(milestone);
    const milestoneAnchors = (structuredChapterAnchors || []).filter((anchor) => {
        const target = Number(anchor?.targetChapter) || 0;
        return target >= Number(normalized.chapter_from || 0) && target <= Number(normalized.chapter_to || 0);
    });
    if (milestoneAnchors.length === 0) return normalized;

    const snapshot = buildMacroArcPersistenceSnapshot({
        ...normalized,
        chapter_anchors: mergeChapterAnchorLists(normalized.chapter_anchors, milestoneAnchors),
    });

    return {
        ...normalized,
        chapter_anchors: snapshot?.chapter_anchors || [],
        contract_json: snapshot?.contract_json || normalized.contract_json,
    };
}

export function collectBatchChapterAnchors(macroArcs = [], chapterStart = 0, chapterEnd = chapterStart) {
    const start = Number(chapterStart) || 0;
    const end = Math.max(start, Number(chapterEnd) || start);
    return (Array.isArray(macroArcs) ? macroArcs : []).reduce((accumulator, item) => {
        const contract = compileMacroArcContract(item);
        const anchors = getChapterAnchorsInRange(contract, start, end).map((anchor) => ({
            ...anchor,
            sourceMacroArcId: item?.id || null,
            sourceMacroArcTitle: item?.title || '',
        }));
        return mergeChapterAnchorLists(accumulator, anchors);
    }, []);
}

function partitionDraftChapterAnchors(batchChapterAnchors = [], currentChapterNumber = 0) {
    const current = [];
    const future = [];
    (batchChapterAnchors || []).forEach((anchor) => {
        if (!anchor?.targetChapter) return;
        if (anchor.targetChapter === currentChapterNumber) current.push(anchor);
        else if (anchor.targetChapter > currentChapterNumber) future.push(anchor);
    });
    return { current, future };
}

async function upsertChapterMetaForGeneratedChapter({
    chapterId,
    projectId,
    summary = '',
    rawText = '',
}) {
    if (!chapterId || !projectId) return;

    const now = Date.now();
    const proseBuffer = rawText ? buildProseBuffer(rawText) : '';
    const existing = await db.chapterMeta.where('chapter_id').equals(chapterId).first();

    if (existing) {
        const updates = { summary, updated_at: now };
        if (proseBuffer) updates.last_prose_buffer = proseBuffer;
        await db.chapterMeta.update(existing.id, updates);
        return;
    }

    await db.chapterMeta.add({
        chapter_id: chapterId,
        project_id: projectId,
        summary,
        last_prose_buffer: proseBuffer,
        emotional_state: null,
        tension_level: null,
        created_at: now,
        updated_at: now,
    });
}

// ─── Helper: tạo arc record trong DB ───
// Dùng chung cho commitOutlineOnly và commitDraftsToProject
// Trả về arcId vừa tạo
async function createArcRecord({ projectId, macroArcId, arcTitle, arcGoal, chapterStart, chapterEnd }) {
    const existingArcs = await db.arcs.where('project_id').equals(projectId).toArray();
    const arcOrderIndex = getNextOrderIndex(existingArcs);

    const arcId = await db.arcs.add({
        project_id: projectId,
        macro_arc_id: macroArcId || null,
        order_index: arcOrderIndex,
        title: arcTitle || 'Arc mới',
        summary: arcGoal || '',
        goal: arcGoal || '',
        chapter_start: chapterStart,
        chapter_end: chapterEnd,
        status: 'planned',
        power_level_start: '',
        power_level_end: '',
    });

    return arcId;
}

function normalizePlanText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function recommendArcBatchCount(targetLength) {
    const numeric = Number(targetLength) || 0;
    if (numeric >= 800) return 2;
    if (numeric >= 300) return 3;
    return 5;
}

export function recommendDraftSelectionCount(targetLength, batchCount) {
    const numeric = Number(targetLength) || 0;
    if (numeric >= 800) return Math.min(1, Math.max(1, batchCount));
    if (numeric >= 300) return Math.min(2, Math.max(1, batchCount));
    return Math.max(1, batchCount);
}

export function buildDraftQueue(generatedOutline, selectedDraftIndexes = [], startingChapterIndex = 0) {
    const chapters = Array.isArray(generatedOutline?.chapters) ? generatedOutline.chapters : [];
    const selected = [...new Set((selectedDraftIndexes || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value < chapters.length))]
        .sort((left, right) => left - right);
    return selected.map((outlineIndex, queueIndex) => ({
        outlineIndex,
        queueIndex,
        chapterIndex: startingChapterIndex + outlineIndex,
        title: chapters[outlineIndex]?.title || `Chuong ${startingChapterIndex + outlineIndex + 1}`,
        content: '',
        wordCount: 0,
        status: 'pending',
        flagNote: '',
    }));
}

const SETUP_MARKER_REGEX = /(build up|setup|hau qua|consequence|chuan bi|tham do|mo man|do tham|dan duong|dieu tra|tim hieu|thu thap|quan sat|tap luyen|thu nghiem|len ke hoach|thuong luong|hoi phuc|xu ly du am|giai nen|thich nghi|giai doan chuyen tiep)/;
const HARD_RESOLUTION_REGEX = /(ket thuc|chung ket|giai quyet thread chinh|giai quyet dut diem|hoa giai dut diem|lat mat than phan|lo than phan|he lo bi mat lon|tiet lo bi mat lon|pha vo am muu|ha man)/;
const SOFT_RESOLUTION_REGEX = /(giai quyet|hoa giai|pha vo|he lo|tiet lo|midpoint|dot pha canh gioi|thang cap|phi thang|dao chieu|quyet dinh lon|lo manh moi lon|su that dan lo ra)/;

function getNormalizedChapterText(chapter = {}) {
    return normalizePlanText([
        chapter?.title,
        chapter?.summary,
        chapter?.purpose,
        Array.isArray(chapter?.key_events) ? chapter.key_events.join(' ') : '',
    ].filter(Boolean).join(' '));
}

function countPlanWords(value = '') {
    const text = normalizePlanText(value);
    return text ? text.split(' ').filter(Boolean).length : 0;
}

function hasReadablePlanBody(chapter = {}) {
    const purposeWords = countPlanWords(chapter?.purpose || '');
    const summaryWords = countPlanWords(chapter?.summary || '');
    const keyEventCount = Array.isArray(chapter?.key_events) ? chapter.key_events.length : 0;
    return purposeWords >= 4 && (summaryWords >= 8 || keyEventCount > 0);
}

function getResolutionSignal(chapter = {}) {
    const combinedText = getNormalizedChapterText(chapter);
    const hardMatches = combinedText.match(new RegExp(HARD_RESOLUTION_REGEX.source, 'g')) || [];
    const softMatches = combinedText.match(new RegExp(SOFT_RESOLUTION_REGEX.source, 'g')) || [];
    const hardCount = hardMatches.length;
    const softCount = softMatches.length;
    const score = (hardCount * 2) + softCount;

    return {
        combinedText,
        hardCount,
        softCount,
        score,
        isHard: hardCount > 0,
        isSoft: softCount > 0,
    };
}

function getSetupSignal(chapter = {}) {
    const combinedText = getNormalizedChapterText(chapter);
    const keyEventCount = Array.isArray(chapter?.key_events) ? chapter.key_events.length : 0;
    let score = 0;

    if (chapter?.pacing === 'slow') score += 2;
    if (SETUP_MARKER_REGEX.test(combinedText)) score += 2;
    if (String(chapter?.purpose || '').trim()) score += 1;
    if (keyEventCount > 0 && keyEventCount <= 2) score += 1;

    const resolutionSignal = getResolutionSignal(chapter);
    if (resolutionSignal.isHard) score -= 2;
    else if (resolutionSignal.isSoft) score -= 1;

    return {
        combinedText,
        score,
        isSetupLike: score >= 2,
    };
}

function getBeatMixStatus(chapters = []) {
    return chapters.some((chapter) => getSetupSignal(chapter).isSetupLike);
}

function hasValidMacroArcRange(macroArc = null) {
    const from = Number(macroArc?.chapter_from) || 0;
    const to = Number(macroArc?.chapter_to) || 0;
    return from > 0 && to >= from;
}

export function resolveBatchChapterWindow({
    currentChapterCount = 0,
    batchCount = 0,
    selectedMacroArc = null,
} = {}) {
    const currentCount = Math.max(0, Number(currentChapterCount) || 0);
    const requestedBatchCount = Math.max(1, Number(batchCount) || 1);
    const batchStartChapter = currentCount + 1;
    const macroStartChapter = Number(selectedMacroArc?.chapter_from) || 0;
    const macroEndChapter = Number(selectedMacroArc?.chapter_to) || 0;
    const hasSelectedMacroRange = hasValidMacroArcRange(selectedMacroArc);
    const batchStartsInsideMacro = hasSelectedMacroRange
        && batchStartChapter >= macroStartChapter
        && batchStartChapter <= macroEndChapter;
    const batchEndChapter = batchStartsInsideMacro
        ? Math.min(currentCount + requestedBatchCount, macroEndChapter)
        : (currentCount + requestedBatchCount);
    const effectiveBatchCount = Math.max(0, batchEndChapter - batchStartChapter + 1);

    return {
        currentCount,
        requestedBatchCount,
        batchStartChapter,
        batchEndChapter,
        effectiveBatchCount,
        macroStartChapter,
        macroEndChapter,
        hasSelectedMacroRange,
        batchStartsInsideMacro,
        isClampedToMacroRange: batchStartsInsideMacro && effectiveBatchCount < requestedBatchCount,
    };
}

export function buildStoryProgressBudget({
    targetLength = 0,
    currentChapterCount = 0,
    batchCount = 0,
    selectedMacroArc = null,
    milestones = [],
}) {
    const batchWindow = resolveBatchChapterWindow({
        currentChapterCount,
        batchCount,
        selectedMacroArc,
    });
    const safeBatchCount = Math.max(1, batchWindow.effectiveBatchCount || batchWindow.requestedBatchCount || 1);
    const currentCount = batchWindow.currentCount;
    const batchStartChapter = batchWindow.batchStartChapter;
    const batchEndChapter = batchWindow.batchEndChapter;
    const nextCount = Math.max(currentCount, batchEndChapter);
    const safeTarget = Math.max(Number(targetLength) || 0, batchEndChapter, 1);
    const fromPercent = Number(((currentCount / safeTarget) * 100).toFixed(1));
    const toPercent = Number(((nextCount / safeTarget) * 100).toFixed(1));
    const nextMilestone = Array.isArray(milestones)
        ? milestones.find((item) => Number(item?.percent) > fromPercent) || null
        : null;
    const remainingInMacro = selectedMacroArc?.chapter_to
        ? Math.max(0, Number(selectedMacroArc.chapter_to) - currentCount)
        : null;
    const macroStartChapter = batchWindow.macroStartChapter;
    const macroEndChapter = batchWindow.macroEndChapter;
    const macroSpan = macroStartChapter > 0 && macroEndChapter >= macroStartChapter
        ? (macroEndChapter - macroStartChapter + 1)
        : 0;
    const batchMacroStart = macroSpan > 0
        ? Math.max(batchStartChapter, macroStartChapter)
        : 0;
    const batchMacroEnd = macroSpan > 0
        ? Math.min(batchEndChapter, macroEndChapter)
        : 0;
    const batchMacroOverlapCount = macroSpan > 0 && batchMacroEnd >= batchMacroStart
        ? (batchMacroEnd - batchMacroStart + 1)
        : 0;
    const chaptersRemainingAfterBatchInMacro = macroSpan > 0
        ? Math.max(0, macroEndChapter - batchEndChapter)
        : null;
    const batchCoversFullMacro = macroSpan > 0 && batchMacroOverlapCount >= macroSpan;
    const batchReachesMacroEnd = macroSpan > 0 && batchEndChapter >= macroEndChapter;
    const macroCoveragePercent = macroSpan > 0
        ? Number(((batchMacroOverlapCount / macroSpan) * 100).toFixed(1))
        : 0;

    return {
        fromPercent,
        toPercent,
        currentChapterCount: currentCount,
        targetLength: safeTarget,
        batchCount: safeBatchCount,
        requestedBatchCount: batchWindow.requestedBatchCount,
        batchStartChapter,
        batchEndChapter,
        mainPlotMaxStep: 1,
        romanceMaxStep: 1,
        mysteryRevealAllowance: nextMilestone && Number(nextMilestone.percent) - fromPercent > 5 ? '0-1 minor reveal' : '1 minor reveal',
        powerProgressionCap: remainingInMacro != null && remainingInMacro <= safeBatchCount
            ? 'co the tang cap neu day la cuoi cot moc'
            : 'khong vuot tier lon trong batch nay',
        requiredBeatMix: 'at least one setup/build-up/consequence chapter',
        selectedMacroArc,
        nextMilestone,
        remainingInMacro,
        macroStartChapter,
        macroEndChapter,
        macroSpan,
        batchMacroStart,
        batchMacroEnd,
        batchMacroOverlapCount,
        chaptersRemainingAfterBatchInMacro,
        batchCoversFullMacro,
        batchReachesMacroEnd,
        macroCoveragePercent,
        batchStartsInsideMacro: batchWindow.batchStartsInsideMacro,
        isClampedToMacroRange: batchWindow.isClampedToMacroRange,
        macroProgressCap: !batchReachesMacroEnd && batchMacroOverlapCount > 0
            ? 'batch nay chi duoc day mot phan cot moc, khong duoc xem nhu da di tron cot moc'
            : 'batch nay co the cham moc ket thuc neu buildup da du',
    };
}

function detectMacroArcForChapter(macroArcs = [], nextChapterNumber = 1) {
    return macroArcs.find((item) => {
        const from = Number(item?.chapter_from) || 0;
        const to = Number(item?.chapter_to) || 0;
        if (from <= 0 || to < from) return false;
        return nextChapterNumber >= from && nextChapterNumber <= to;
    }) || null;
}

function detectMacroArcForBatch(macroArcs = [], batchStartChapter = 1, batchEndChapter = batchStartChapter) {
    const batchOwner = detectMacroArcForChapter(macroArcs, batchStartChapter);
    if (batchOwner) return batchOwner;

    let bestMatch = null;
    let bestOverlap = 0;
    for (const item of macroArcs) {
        const from = Number(item?.chapter_from) || 0;
        const to = Number(item?.chapter_to) || 0;
        if (!to || to < from) continue;
        const overlapStart = Math.max(batchStartChapter, from);
        const overlapEnd = Math.min(batchEndChapter, to);
        const overlap = overlapEnd >= overlapStart ? (overlapEnd - overlapStart + 1) : 0;
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestMatch = item;
        }
    }
    return bestMatch;
}

function hasThreadAnchor(chapter = {}) {
    if (Array.isArray(chapter?.thread_titles) && chapter.thread_titles.length > 0) return true;
    if (Array.isArray(chapter?.key_events) && chapter.key_events.length > 0) return true;
    if (hasReadablePlanBody(chapter)) return true;
    return false;
}

const OUTLINE_ISSUE_SOURCE_MAP = {
    padding: {
        inputKind: 'mixed',
        inputLabel: 'Noi dung dang thay + metadata',
        relevantFields: ['purpose', 'summary', 'thread_titles', 'key_events'],
        explanation: 'Loi nay thuong den tu purpose/summary ban dang thay, nhung cung co the do thread_titles hoac key_events dang thieu.',
    },
    repetitive: {
        inputKind: 'mixed',
        inputLabel: 'Noi dung dang thay + metadata',
        relevantFields: ['title', 'purpose', 'summary', 'key_events'],
        explanation: 'He thong doi chieu tieu de, purpose, summary va key_events giua cac chuong lien nhau.',
    },
    'too-fast': {
        inputKind: 'mixed',
        inputLabel: 'Noi dung dang thay + rang buoc he thong',
        relevantFields: ['purpose', 'summary', 'key_events', 'state_delta', 'arc_guard_note', 'storyProgressBudget'],
        explanation: 'Danh gia nay dua vao noi dung dang thay va rang buoc pacing/progress budget cua batch hien tai.',
    },
    'premature-resolution': {
        inputKind: 'mixed',
        inputLabel: 'Noi dung dang thay + rang buoc he thong',
        relevantFields: ['purpose', 'summary', 'key_events', 'state_delta', 'arc_guard_note', 'selectedMacroArc'],
        explanation: 'He thong dang doi chieu noi dung chuong voi pham vi macro arc va moc ket thuc hien tai.',
    },
    'chapter-out-of-range': {
        inputKind: 'system',
        inputLabel: 'Rang buoc he thong',
        relevantFields: ['selectedMacroArc.chapter_from', 'selectedMacroArc.chapter_to', 'startChapterNumber'],
        explanation: 'Loi nay den tu pham vi chapter cua macro arc/batch, khong phai chi do text chuong.',
    },
    'macro-drift': {
        inputKind: 'mixed',
        inputLabel: 'Noi dung dang thay + metadata dai cuc',
        relevantFields: ['purpose', 'summary', 'key_events', 'objective_refs', 'state_delta', 'arc_guard_note'],
        explanation: 'Validator dang so noi dung chuong voi objective/target state cua dai cuc.',
    },
    'macro-state-overshoot': {
        inputKind: 'metadata',
        inputLabel: 'Metadata/rang buoc dai cuc',
        relevantFields: ['state_delta', 'arc_guard_note', 'objective_refs', 'macroArcContract'],
        explanation: 'Loi nay thuong den tu state_delta, arc_guard_note hoac hop dong dai cuc, khong chi tu summary.',
    },
    'macro-forbidden-outcome': {
        inputKind: 'metadata',
        inputLabel: 'Metadata/rang buoc dai cuc',
        relevantFields: ['summary', 'key_events', 'macroArcContract.forbidden_outcomes'],
        explanation: 'He thong dang so noi dung outline voi forbidden_outcomes cua macro arc.',
    },
};

export function describeOutlineValidationIssue(issue = {}) {
    const code = String(issue?.code || '').trim().toLowerCase();
    if (OUTLINE_ISSUE_SOURCE_MAP[code]) {
        return {
            ...OUTLINE_ISSUE_SOURCE_MAP[code],
            code,
        };
    }

    if (code.includes('anchor-missing-ref') || code.includes('anchor-wrong-chapter')) {
        return {
            code,
            inputKind: 'metadata',
            inputLabel: 'Metadata anchor',
            relevantFields: ['anchor_refs'],
            explanation: 'Loi nay den tu anchor_refs va metadata chapter anchor, khong nam o text summary/purpose ban dang thay.',
        };
    }

    if (code.includes('anchor-missed') || code.includes('anchor-early')) {
        return {
            code,
            inputKind: 'mixed',
            inputLabel: 'Noi dung dang thay + metadata anchor',
            relevantFields: ['summary', 'purpose', 'key_events', 'anchor_refs'],
            explanation: 'Validator dang so text chuong voi chapter anchor va ca anchor_refs di kem.',
        };
    }

    if (code.includes('macro-')) {
        return {
            code,
            inputKind: 'metadata',
            inputLabel: 'Metadata dai cuc',
            relevantFields: ['objective_refs', 'state_delta', 'arc_guard_note', 'macroArcContract'],
            explanation: 'Loi nay den tu rang buoc macro arc va metadata di kem cua outline.',
        };
    }

    return {
        code,
        inputKind: 'visible',
        inputLabel: 'Noi dung dang thay',
        relevantFields: ['title', 'purpose', 'summary'],
        explanation: 'Loi nay chu yeu den tu cac field dang hien tren UI cua outline.',
    };
}

function annotateOutlineValidationIssue(issue = {}) {
    return {
        ...issue,
        ...describeOutlineValidationIssue(issue),
    };
}

function buildIssueSignature(issue = {}) {
    return [
        issue?.code || '',
        issue?.severity || '',
        Number.isInteger(issue?.chapterIndex) ? issue.chapterIndex : 'batch',
        issue?.anchorId || '',
        issue?.chapterTitle || '',
    ].join('|');
}

function buildOutlineComparisonSignature(outline = null) {
    const chapters = Array.isArray(outline?.chapters) ? outline.chapters : [];
    return JSON.stringify(chapters.map((chapter) => ({
        title: chapter?.title || '',
        purpose: chapter?.purpose || '',
        summary: chapter?.summary || '',
        key_events: Array.isArray(chapter?.key_events) ? chapter.key_events : [],
        objective_refs: Array.isArray(chapter?.objective_refs) ? chapter.objective_refs : [],
        anchor_refs: Array.isArray(chapter?.anchor_refs) ? chapter.anchor_refs : [],
        state_delta: chapter?.state_delta || '',
        arc_guard_note: chapter?.arc_guard_note || '',
        featured_characters: Array.isArray(chapter?.featured_characters) ? chapter.featured_characters : [],
        primary_location: chapter?.primary_location || '',
        thread_titles: Array.isArray(chapter?.thread_titles) ? chapter.thread_titles : [],
    })));
}

export function summarizeOutlineRevisionAssessment({
    beforeValidation = null,
    afterValidation = null,
    beforeOutline = null,
    afterOutline = null,
} = {}) {
    const beforeIssues = Array.isArray(beforeValidation?.issues) ? beforeValidation.issues : [];
    const afterIssues = Array.isArray(afterValidation?.issues) ? afterValidation.issues : [];
    const beforeBlockingIssueCount = beforeIssues.filter((issue) => issue?.severity === 'error').length;
    const afterBlockingIssueCount = afterIssues.filter((issue) => issue?.severity === 'error').length;
    const beforeIssueCount = beforeIssues.length;
    const afterIssueCount = afterIssues.length;

    const beforeSignatures = new Set(beforeIssues.map((issue) => buildIssueSignature(issue)));
    const afterSignatures = new Set(afterIssues.map((issue) => buildIssueSignature(issue)));
    const resolvedIssueCount = [...beforeSignatures].filter((signature) => !afterSignatures.has(signature)).length;
    const introducedIssueCount = [...afterSignatures].filter((signature) => !beforeSignatures.has(signature)).length;
    const contentChanged = buildOutlineComparisonSignature(beforeOutline) !== buildOutlineComparisonSignature(afterOutline);

    let status = 'unchanged';
    if (
        afterBlockingIssueCount < beforeBlockingIssueCount
        || (afterBlockingIssueCount === beforeBlockingIssueCount && afterIssueCount < beforeIssueCount)
    ) {
        status = 'improved';
    } else if (
        afterBlockingIssueCount > beforeBlockingIssueCount
        || (afterBlockingIssueCount === beforeBlockingIssueCount && afterIssueCount > beforeIssueCount)
    ) {
        status = 'worse';
    }

    return {
        status,
        contentChanged,
        beforeIssueCount,
        afterIssueCount,
        beforeBlockingIssueCount,
        afterBlockingIssueCount,
        resolvedIssueCount,
        introducedIssueCount,
        message: status === 'improved'
            ? `Outline sau revise giam tu ${beforeIssueCount} xuong ${afterIssueCount} loi (${beforeBlockingIssueCount} -> ${afterBlockingIssueCount} loi chan).`
            : status === 'worse'
                ? `Outline sau revise te hon: tu ${beforeIssueCount} thanh ${afterIssueCount} loi (${beforeBlockingIssueCount} -> ${afterBlockingIssueCount} loi chan).`
                : `Outline sau revise khong cai thien so loi (${beforeIssueCount} -> ${afterIssueCount}, loi chan ${beforeBlockingIssueCount} -> ${afterBlockingIssueCount}).`,
    };
}

export function validateGeneratedOutline(generatedOutline, {
    storyProgressBudget = null,
    selectedMacroArc = null,
    milestones = [],
    macroArcContract = null,
    batchChapterAnchors = [],
    startChapterNumber = 1,
} = {}) {
    const chapters = Array.isArray(generatedOutline?.chapters) ? generatedOutline.chapters : [];
    const issues = [];
    const effectiveMacroArcContract = macroArcContract || compileMacroArcContract(selectedMacroArc);
    const macroRangeIsValid = hasValidMacroArcRange(selectedMacroArc);
    const macroStartChapter = Number(selectedMacroArc?.chapter_from) || 0;
    const macroEndChapter = Number(selectedMacroArc?.chapter_to) || 0;
    const baseChapterNumber = Math.max(
        1,
        Number(startChapterNumber) || (Number(storyProgressBudget?.currentChapterCount || 0) + 1),
    );
    const beatMixSatisfied = getBeatMixStatus(chapters);
    const nextMilestone = storyProgressBudget?.nextMilestone
        || (Array.isArray(milestones) ? milestones.find((item) => Number(item?.percent) > Number(storyProgressBudget?.fromPercent || 0)) : null)
        || null;
    const chapterStepPercent = storyProgressBudget && chapters.length > 0
        ? (Number(storyProgressBudget.toPercent || 0) - Number(storyProgressBudget.fromPercent || 0)) / chapters.length
        : 0;

    for (let index = 0; index < chapters.length; index++) {
        const current = chapters[index] || {};
        const previous = chapters[index - 1] || null;
        const summaryText = normalizePlanText(current.summary || '');
        const purposeText = normalizePlanText(current.purpose || '');
        const combinedText = getNormalizedChapterText(current);
        const resolutionSignal = getResolutionSignal(current);
        const chapterAbsoluteNumber = baseChapterNumber + index;
        const chapterToPercent = Number(storyProgressBudget?.fromPercent || 0) + (chapterStepPercent * (index + 1));
        const remainingMacroAfterChapter = selectedMacroArc?.chapter_to
            ? Math.max(0, Number(selectedMacroArc.chapter_to) - chapterAbsoluteNumber)
            : null;
        const chapterPositionRatio = chapters.length > 1 ? index / (chapters.length - 1) : 1;
        const isNearMacroEnding = remainingMacroAfterChapter != null
            ? remainingMacroAfterChapter <= Math.max(1, chapters.length - index - 1)
            : false;
        const milestoneGap = nextMilestone ? Number(nextMilestone.percent) - chapterToPercent : null;
        const isNearMilestone = milestoneGap != null ? milestoneGap <= 2 : false;
        const isFarFromPlannedResolution = !isNearMacroEnding && !isNearMilestone;

        if (macroRangeIsValid && (chapterAbsoluteNumber < macroStartChapter || chapterAbsoluteNumber > macroEndChapter)) {
            issues.push({
                chapterIndex: index,
                chapterTitle: current.title || `Chuong ${chapterAbsoluteNumber}`,
                code: 'chapter-out-of-range',
                severity: 'error',
                message: `Chapter ${chapterAbsoluteNumber} nam ngoai range da chot cua macro arc "${selectedMacroArc?.title || ''}" (${macroStartChapter}-${macroEndChapter}).`,
            });
        }

        if (!hasReadablePlanBody(current) || !hasThreadAnchor(current)) {
            issues.push({
                chapterIndex: index,
                chapterTitle: current.title || `Chuong ${index + 1}`,
                code: 'padding',
                severity: 'warning',
                message: 'Chuong thieu muc tieu ro, summary qua mong, hoac khong co diem neo thread/su kien.',
            });
        }

        if (previous) {
            const previousCombined = normalizePlanText([
                previous.title,
                previous.summary,
                previous.purpose,
                Array.isArray(previous.key_events) ? previous.key_events.join(' ') : '',
            ].filter(Boolean).join(' '));
            if (
                combinedText
                && previousCombined
                && (
                    combinedText === previousCombined
                    || combinedText.includes(previousCombined)
                    || previousCombined.includes(combinedText)
                    || (summaryText && summaryText === normalizePlanText(previous.summary || ''))
                )
            ) {
                issues.push({
                    chapterIndex: index,
                    chapterTitle: current.title || `Chuong ${index + 1}`,
                    code: 'repetitive',
                    severity: 'warning',
                    message: 'Chapter nay lap y/purpose/summary qua sat voi chapter truoc.',
                });
            }
        }

        if (storyProgressBudget && resolutionSignal.score > 0 && isFarFromPlannedResolution) {
            const severity = (resolutionSignal.isHard && chapterPositionRatio < 0.7)
                ? 'error'
                : 'warning';
            if (severity) {
                issues.push({
                    chapterIndex: index,
                    chapterTitle: current.title || `Chuong ${index + 1}`,
                    code: 'too-fast',
                    severity,
                    message: severity === 'error'
                        ? 'Chapter co dau hieu day plot/reveal qua nhanh so voi budget tien do hien tai.'
                        : 'Chapter co tin hieu day plot/reveal nhanh hon muc an toan, nen giam toc hoac doi mot phan ket qua thanh buildup/manh moi.',
                });
            }
        }

        if (selectedMacroArc && selectedMacroArc.chapter_to && resolutionSignal.score > 0 && remainingMacroAfterChapter != null) {
            const severity = (resolutionSignal.isHard && remainingMacroAfterChapter > Math.max(2, chapters.length - index - 1))
                ? 'error'
                : (remainingMacroAfterChapter > Math.max(1, chapters.length - index - 1) ? 'warning' : null);
            if (severity) {
                issues.push({
                    chapterIndex: index,
                    chapterTitle: current.title || `Chuong ${index + 1}`,
                    code: 'premature-resolution',
                    severity,
                    message: severity === 'error'
                        ? `Chapter co dau hieu resolve som truoc khi ket thuc cot moc "${selectedMacroArc.title}".`
                        : `Chapter co tin hieu cham vao phan resolve cua cot moc "${selectedMacroArc.title}" hoi som; nen chuyen bot thanh buildup/manh moi.`,
                });
            }
        }
    }

    if (!beatMixSatisfied && chapters.length > 1) {
        issues.push({
            chapterIndex: null,
            chapterTitle: '',
            code: 'too-fast',
            severity: 'warning',
            message: 'Batch chua co chapter buildup/setup/consequence ro rang.',
        });
    }

    if (effectiveMacroArcContract) {
        issues.push(...validateOutlineAgainstMacroArcContract(generatedOutline, effectiveMacroArcContract, {
            startChapterNumber,
        }));
    }

    const selectedMacroArcId = selectedMacroArc?.id || null;
    const extraBatchAnchors = batchChapterAnchors.filter((anchor) => !effectiveMacroArcContract?.chapterAnchors?.some((item) => (
        anchor.sourceMacroArcId === selectedMacroArcId && item.id === anchor.id
    )));
    if (extraBatchAnchors.length > 0) {
        issues.push(...validateOutlineAgainstChapterAnchors(generatedOutline, extraBatchAnchors, {
            startChapterNumber,
        }));
    }

    const annotatedIssues = issues.map((issue) => annotateOutlineValidationIssue(issue));

    return {
        issues: annotatedIssues,
        hasBlockingIssues: annotatedIssues.some((issue) => issue.severity === 'error'),
    };
}

async function loadArcGenerationProjectState(projectId, currentChapterCount = 0) {
    const [project, macroArcs] = await Promise.all([
        db.projects.get(projectId),
        db.macro_arcs.where('project_id').equals(projectId).sortBy('order_index'),
    ]);
    let milestones = [];
    try {
        milestones = JSON.parse(project?.milestones || '[]');
    } catch {
        milestones = [];
    }
    const targetLength = Number(project?.target_length) || 0;
    const recommendedBatch = recommendArcBatchCount(targetLength);
    const nextChapterNumber = Math.max(1, Number(currentChapterCount) + 1);
    const normalizedMacroArcs = macroArcs.map((item, index) => normalizeMacroMilestoneItem({
        ...item,
        order: item?.order ?? item?.order_index ?? index + 1,
    }, index));
    const selectedMacroArc = detectMacroArcForBatch(
        normalizedMacroArcs,
        nextChapterNumber,
        nextChapterNumber + Math.max(0, recommendedBatch - 1),
    );

    return {
        project,
        targetLength,
        milestones,
        macroArcs: normalizedMacroArcs,
        recommendedBatch,
        selectedMacroArc,
    };
}

function getDefaultOutputMode(targetLength) {
    return 'outline_review';
}

function sanitizeSelectedDraftIndexes(selectedDraftIndexes = [], chapterCount = 0) {
    return [...new Set(
        (selectedDraftIndexes || [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < chapterCount),
    )].sort((left, right) => left - right);
}

function getDefaultSelectedDraftIndexes(targetLength, chapterCount) {
    const safeCount = Math.max(0, Number(chapterCount) || 0);
    const selectionCount = Math.min(
        safeCount,
        recommendDraftSelectionCount(targetLength, safeCount),
    );
    return Array.from({ length: selectionCount }, (_, index) => index);
}

function getSelectedMacroArcFromState(state) {
    const available = Array.isArray(state.availableMacroArcs) ? state.availableMacroArcs : [];
    const selectedId = state.selectedMacroArcId ?? state.currentMacroArcId ?? null;
    if (!selectedId) return null;
    return available.find((item) => item.id === selectedId) || null;
}

function buildOutlineDerivedState(
    state,
    outline,
    selectedDraftIndexes = state.selectedDraftIndexes,
    options = {},
) {
    const chapterCount = Array.isArray(outline?.chapters) ? outline.chapters.length : 0;
    const selectedMacroArc = getSelectedMacroArcFromState(state);
    const macroArcContract = compileMacroArcContract(selectedMacroArc);
    const startChapterNumber = Number(state.currentChapterCount || 0) + 1;
    const storyProgressBudget = buildStoryProgressBudget({
        targetLength: state.projectTargetLength,
        currentChapterCount: state.currentChapterCount,
        batchCount: chapterCount || state.arcChapterCount,
        selectedMacroArc,
        milestones: state.projectMilestones,
    });
    const batchChapterAnchors = collectBatchChapterAnchors(
        state.availableMacroArcs,
        storyProgressBudget.batchStartChapter,
        storyProgressBudget.batchEndChapter,
    );
    const outlineValidation = validateGeneratedOutline(outline, {
        storyProgressBudget,
        selectedMacroArc,
        milestones: state.projectMilestones,
        macroArcContract,
        batchChapterAnchors,
        startChapterNumber,
    });
    const normalizedSelection = sanitizeSelectedDraftIndexes(
        selectedDraftIndexes,
        chapterCount,
    );
    const shouldDefaultSelection = options.preferDefaultSelection || selectedDraftIndexes == null;
    const nextSelection = (normalizedSelection.length > 0 || !shouldDefaultSelection)
        ? normalizedSelection
        : getDefaultSelectedDraftIndexes(state.projectTargetLength, chapterCount);

    return {
        macroArcContract,
        batchChapterAnchors,
        storyProgressBudget,
        outlineValidation,
        selectedDraftIndexes: nextSelection,
    };
}

function normalizeGeneratedListField(value = []) {
    return Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
}

function buildGeneratedChapterPersistencePayload({
    projectId,
    arcId,
    orderIndex,
    chapter = {},
    status = 'outline',
    title = '',
    actualWordCount = 0,
}) {
    return {
        project_id: projectId,
        arc_id: arcId,
        order_index: orderIndex,
        title: title || chapter?.title || `Chuong ${orderIndex + 1}`,
        summary: chapter?.summary || '',
        purpose: chapter?.purpose || JSON.stringify(chapter?.key_events || []),
        status,
        word_count_target: 7000,
        actual_word_count: actualWordCount,
        featured_characters: normalizeGeneratedListField(chapter?.featured_characters),
        primary_location: String(chapter?.primary_location || '').trim(),
        thread_titles: normalizeGeneratedListField(chapter?.thread_titles),
        key_events: normalizeGeneratedListField(chapter?.key_events),
        required_factions: normalizeGeneratedListField(chapter?.required_factions),
        required_objects: normalizeGeneratedListField(chapter?.required_objects),
        required_terms: normalizeGeneratedListField(chapter?.required_terms),
    };
}

function buildGeneratedScenePersistencePayload({
    projectId,
    chapterId,
    status = 'outline',
    draftText = '',
}) {
    return {
        project_id: projectId,
        chapter_id: chapterId,
        order_index: 0,
        title: 'Canh 1',
        summary: '',
        pov_character_id: null,
        location_id: null,
        time_marker: '',
        goal: '',
        conflict: '',
        emotional_start: '',
        emotional_end: '',
        status,
        draft_text: draftText,
        final_text: '',
        must_happen: '[]',
        must_not_happen: '[]',
        pacing: '',
        characters_present: '[]',
    };
}

function buildGeneratedCommitPlan(generatedOutline, draftResults = []) {
    const chapters = Array.isArray(generatedOutline?.chapters) ? generatedOutline.chapters : [];
    const doneDraftMap = new Map(
        (draftResults || [])
            .filter((item) => item?.status === 'done' && item?.content)
            .map((item) => [Number(item.outlineIndex), item]),
    );

    return chapters.map((chapter, outlineIndex) => {
        const draft = doneDraftMap.get(outlineIndex) || null;
        const hasDraft = Boolean(draft?.content);
        return {
            outlineIndex,
            chapter,
            status: hasDraft ? 'draft' : 'outline',
            title: hasDraft ? (draft.title || chapter?.title || '') : (chapter?.title || ''),
            actualWordCount: hasDraft ? (draft.wordCount || 0) : 0,
            draftText: hasDraft ? draft.content : '',
        };
    });
}

function deriveOutlineCommitState(state, currentChapterCount) {
    return buildOutlineDerivedState(
        {
            ...state,
            currentChapterCount,
        },
        state.generatedOutline,
        state.selectedDraftIndexes,
        { preferDefaultSelection: false },
    );
}

const useArcGenStore = create((set, get) => ({
    // --- State ---
    // Bước 1: Thiết lập
    arcGoal: '',
    arcChapterCount: 5,
    arcPacing: 'medium',
    arcMode: 'guided',
    outputMode: 'outline_review',
    sessionProjectId: null,
    currentChapterCount: 0,
    projectTargetLength: 0,
    projectMilestones: [],
    recommendedBatchCount: 5,
    availableMacroArcs: [],
    selectedMacroArcId: null,

    // Phase 9: Liên kết với đại cục
    // currentMacroArcId: macro arc đang hoạt động (null = chưa có đại cục)
    // currentArcId: arc cụ thể đang viết (null = chưa tạo arc)
    currentMacroArcId: null,
    currentArcId: null,

    // Bước 2: Dàn ý đã sinh
    generatedOutline: null,
    outlineStatus: 'idle',
    outlineRevisionPrompt: '',
    outlineRevisionAssessment: null,
    outlineValidation: { issues: [], hasBlockingIssues: false },
    outlineSaveFeedback: null,
    storyProgressBudget: null,
    macroArcContract: null,
    batchChapterAnchors: [],
    outlineRequestToken: 0,

    // Bước 3: Đắp thịt
    draftStatus: 'idle',
    draftProgress: { current: 0, total: 0 },
    draftResults: [],
    selectedDraftIndexes: [],

    // Phase 9: Grand Strategy state
    isSuggestingMilestones: false,    // đang gọi AI gợi ý cột mốc
    isRevisingMilestones: false,
    macroMilestoneSuggestions: null,  // kết quả gợi ý chưa lưu { milestones: [...] }
    analyzingMacroContractKeys: {},
    isAuditingArc: false,             // đang kiểm tra độ lệch
    lastAuditResult: null,            // { aligned, drift_score, issues, suggestions }

    // --- Actions ---

    setArcConfig: (config) => set((state) => {
            const nextState = { ...config };
        if (Object.prototype.hasOwnProperty.call(config, 'selectedMacroArcId')
            && !Object.prototype.hasOwnProperty.call(config, 'currentMacroArcId')) {
            nextState.currentMacroArcId = config.selectedMacroArcId;
        }
        if (Object.prototype.hasOwnProperty.call(config, 'currentMacroArcId')
            && !Object.prototype.hasOwnProperty.call(config, 'selectedMacroArcId')) {
            nextState.selectedMacroArcId = config.currentMacroArcId;
        }
        if (Object.prototype.hasOwnProperty.call(config, 'arcChapterCount')) {
            const selectedMacroArc = getSelectedMacroArcFromState({ ...state, ...nextState })
                || detectMacroArcForBatch(
                    state.availableMacroArcs,
                    Number(state.currentChapterCount || 0) + 1,
                    Number(state.currentChapterCount || 0) + Math.max(1, Number(config.arcChapterCount) || 1),
                );
            if (!state.selectedMacroArcId && !state.currentMacroArcId && selectedMacroArc?.id) {
                nextState.selectedMacroArcId = selectedMacroArc.id;
                nextState.currentMacroArcId = selectedMacroArc.id;
            }
            nextState.storyProgressBudget = buildStoryProgressBudget({
                targetLength: state.projectTargetLength,
                currentChapterCount: state.currentChapterCount,
                batchCount: config.arcChapterCount,
                selectedMacroArc,
                milestones: state.projectMilestones,
            });
            nextState.macroArcContract = compileMacroArcContract(selectedMacroArc);
            nextState.batchChapterAnchors = collectBatchChapterAnchors(
                state.availableMacroArcs,
                nextState.storyProgressBudget.batchStartChapter,
                nextState.storyProgressBudget.batchEndChapter,
            );
        }
            if (Object.prototype.hasOwnProperty.call(config, 'selectedMacroArcId')
                || Object.prototype.hasOwnProperty.call(config, 'currentMacroArcId')) {
            const derived = buildOutlineDerivedState(
                { ...state, ...nextState },
                state.generatedOutline,
                state.selectedDraftIndexes,
            );
            nextState.macroArcContract = derived.macroArcContract;
            nextState.batchChapterAnchors = derived.batchChapterAnchors;
            nextState.storyProgressBudget = derived.storyProgressBudget;
            if (state.generatedOutline) {
                nextState.outlineValidation = derived.outlineValidation;
                nextState.selectedDraftIndexes = derived.selectedDraftIndexes;
                }
            }
            if (state.generatedOutline && (
                Object.prototype.hasOwnProperty.call(config, 'selectedMacroArcId')
                || Object.prototype.hasOwnProperty.call(config, 'currentMacroArcId')
                || Object.prototype.hasOwnProperty.call(config, 'arcChapterCount')
            )) {
                nextState.outlineRevisionAssessment = null;
                nextState.outlineSaveFeedback = null;
            }
        return nextState;
    }),

    initializeArcGeneration: async ({ projectId, currentChapterCount = 0 }) => {
        try {
            const {
                targetLength,
                milestones,
                macroArcs,
                recommendedBatch,
                selectedMacroArc,
            } = await loadArcGenerationProjectState(projectId, currentChapterCount);
            const initialStoryProgressBudget = buildStoryProgressBudget({
                targetLength,
                currentChapterCount,
                batchCount: recommendedBatch,
                selectedMacroArc,
                milestones,
            });
            set((state) => {
                const hasSessionState = state.sessionProjectId === projectId
                    && state.currentChapterCount === currentChapterCount
                    && (
                        state.draftStatus === 'drafting'
                        || state.outlineStatus === 'generating'
                        || state.outlineStatus === 'ready'
                        || state.draftStatus === 'done'
                        || !!state.generatedOutline
                        || (Array.isArray(state.draftResults) && state.draftResults.length > 0)
                    );

                if (hasSessionState) {
                    const preservedSelectedMacroArcId = state.selectedMacroArcId
                        && macroArcs.some((item) => item.id === state.selectedMacroArcId)
                            ? state.selectedMacroArcId
                            : (selectedMacroArc?.id || null);
                    const preservedCurrentMacroArcId = state.currentMacroArcId
                        && macroArcs.some((item) => item.id === state.currentMacroArcId)
                            ? state.currentMacroArcId
                            : preservedSelectedMacroArcId;
                    const activeMacroArc = macroArcs.find((item) => item.id === preservedCurrentMacroArcId)
                        || selectedMacroArc
                        || null;

                    return {
                        sessionProjectId: projectId,
                        projectTargetLength: targetLength,
                        projectMilestones: milestones,
                        recommendedBatchCount: recommendedBatch,
                        availableMacroArcs: macroArcs,
                        selectedMacroArcId: preservedSelectedMacroArcId,
                        currentMacroArcId: preservedCurrentMacroArcId,
                        macroArcContract: state.macroArcContract || compileMacroArcContract(activeMacroArc),
                        storyProgressBudget: state.storyProgressBudget || initialStoryProgressBudget,
                        batchChapterAnchors: (Array.isArray(state.batchChapterAnchors) && state.batchChapterAnchors.length > 0)
                            ? state.batchChapterAnchors
                            : collectBatchChapterAnchors(
                                macroArcs,
                                initialStoryProgressBudget.batchStartChapter,
                                initialStoryProgressBudget.batchEndChapter,
                            ),
                    };
                }

                return {
                    arcGoal: '',
                    arcChapterCount: recommendedBatch,
                    arcPacing: 'medium',
                    arcMode: 'guided',
                    outputMode: getDefaultOutputMode(targetLength),
                    sessionProjectId: projectId,
                    currentChapterCount,
                    projectTargetLength: targetLength,
                    projectMilestones: milestones,
                    recommendedBatchCount: recommendedBatch,
                    availableMacroArcs: macroArcs,
                    selectedMacroArcId: selectedMacroArc?.id || null,
                    currentMacroArcId: selectedMacroArc?.id || null,
                    currentArcId: null,
                    generatedOutline: null,
                    outlineStatus: 'idle',
                    outlineRevisionPrompt: '',
                    outlineRevisionAssessment: null,
                    outlineValidation: { issues: [], hasBlockingIssues: false },
                    outlineSaveFeedback: null,
                    storyProgressBudget: initialStoryProgressBudget,
                    macroArcContract: compileMacroArcContract(selectedMacroArc),
                    batchChapterAnchors: collectBatchChapterAnchors(
                        macroArcs,
                        initialStoryProgressBudget.batchStartChapter,
                        initialStoryProgressBudget.batchEndChapter,
                    ),
                    outlineRequestToken: 0,
                    draftStatus: 'idle',
                    draftProgress: { current: 0, total: 0 },
                    draftResults: [],
                    selectedDraftIndexes: [],
                };
            });
        } catch (error) {
            console.error('[ArcGen] initializeArcGeneration failed:', error);
        }
    },

    resetArc: () => set({
        arcGoal: '',
        arcChapterCount: 5,
        arcPacing: 'medium',
        arcMode: 'guided',
        outputMode: 'outline_review',
        sessionProjectId: null,
        currentChapterCount: 0,
        projectTargetLength: 0,
        projectMilestones: [],
        recommendedBatchCount: 5,
        availableMacroArcs: [],
        selectedMacroArcId: null,
        currentMacroArcId: null,
        currentArcId: null,
        generatedOutline: null,
        outlineStatus: 'idle',
        outlineRevisionPrompt: '',
        outlineRevisionAssessment: null,
        outlineValidation: { issues: [], hasBlockingIssues: false },
        outlineSaveFeedback: null,
        storyProgressBudget: null,
        macroArcContract: null,
        outlineRequestToken: 0,
        draftStatus: 'idle',
        draftProgress: { current: 0, total: 0 },
        draftResults: [],
        selectedDraftIndexes: [],
        isSuggestingMilestones: false,
        isRevisingMilestones: false,
        macroMilestoneSuggestions: null,
        isAuditingArc: false,
        lastAuditResult: null,
    }),

    recommendArcBatchCount: (targetLength) => recommendArcBatchCount(targetLength),
    buildStoryProgressBudget: (params) => buildStoryProgressBudget(params),
    validateGeneratedOutline: (outline, overrides = {}) => {
        const state = get();
        const selectedMacroArc = overrides.selectedMacroArc || getSelectedMacroArcFromState(state);
        return validateGeneratedOutline(outline, {
            storyProgressBudget: overrides.storyProgressBudget || state.storyProgressBudget,
            selectedMacroArc,
            milestones: overrides.milestones || state.projectMilestones,
            macroArcContract: overrides.macroArcContract || state.macroArcContract,
            batchChapterAnchors: overrides.batchChapterAnchors || state.batchChapterAnchors || [],
            startChapterNumber: overrides.startChapterNumber || (Number(state.currentChapterCount || 0) + 1),
        });
    },
    setSelectedDraftIndexes: (indexes) => set((state) => ({
        selectedDraftIndexes: sanitizeSelectedDraftIndexes(
            indexes,
            Array.isArray(state.generatedOutline?.chapters) ? state.generatedOutline.chapters.length : 0,
        ),
    })),
    toggleDraftIndex: (index) => set((state) => {
        const total = Array.isArray(state.generatedOutline?.chapters) ? state.generatedOutline.chapters.length : 0;
        const safeIndex = Number(index);
        if (!Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= total) return {};
        const next = new Set(state.selectedDraftIndexes || []);
        if (next.has(safeIndex)) next.delete(safeIndex);
        else next.add(safeIndex);
        return {
            selectedDraftIndexes: sanitizeSelectedDraftIndexes([...next], total),
        };
    }),

    // ═══════════════════════════════════════════
    // BƯỚC 2: Sinh Dàn Ý (Outline)
    // ═══════════════════════════════════════════
    generateOutline: async ({ projectId, chapterId, chapterIndex, genre }) => {
        let outlineRequestToken = 0;
        set((current) => {
            outlineRequestToken = Number(current.outlineRequestToken || 0) + 1;
            return {
                outlineStatus: 'generating',
                outlineRevisionAssessment: null,
                outlineValidation: { issues: [], hasBlockingIssues: false },
                outlineSaveFeedback: null,
                outlineRequestToken,
            };
        });
        try {
            const state = get();
            const existingChapterBriefs = await loadExistingChapterBriefs(projectId);
            const startingChapterIndex = Math.max(
                Number.isFinite(chapterIndex) ? chapterIndex : 0,
                existingChapterBriefs.length,
            );
            const ctx = await gatherContext({
                projectId,
                chapterId,
                chapterIndex: startingChapterIndex,
                sceneId: null,
                sceneText: '',
                genre,
            });
            const selectedMacroArc = getSelectedMacroArcFromState(state);
            const storyProgressBudget = buildStoryProgressBudget({
                targetLength: state.projectTargetLength || ctx.targetLength,
                currentChapterCount: startingChapterIndex,
                batchCount: state.arcChapterCount,
                selectedMacroArc,
                milestones: state.projectMilestones.length > 0 ? state.projectMilestones : ctx.milestones,
            });
            const effectiveMacroArcContract = compileMacroArcContract(selectedMacroArc || ctx.currentMacroArc, {
                allCharacters: ctx.allCharacters,
            });
            const batchChapterAnchors = collectBatchChapterAnchors(
                state.availableMacroArcs,
                storyProgressBudget.batchStartChapter,
                storyProgressBudget.batchEndChapter,
            );

            let finalGoal = state.arcGoal;
            if (state.arcMode === 'auto') {
                const plotThreads = await db.plotThreads.where('project_id').equals(projectId).toArray();
                const activeThreads = plotThreads.filter((item) => item.state === 'active');
                const canonFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();
                const activeFacts = canonFacts.filter((item) => item.status === 'active');
                let chosenThread = null;

                if (activeThreads.length > 0) {
                    const threadBeats = await db.threadBeats
                        .where('plot_thread_id').anyOf(activeThreads.map((item) => item.id)).toArray();
                    const threadWeights = activeThreads.map((thread) => {
                        const beats = threadBeats.filter((beat) => beat.plot_thread_id === thread.id);
                        const lastBeatSceneId = beats.length > 0 ? Math.max(...beats.map((beat) => beat.scene_id)) : 0;
                        return { thread, weight: Math.max(1, 100 - lastBeatSceneId) };
                    });
                    const totalWeight = threadWeights.reduce((sum, item) => sum + item.weight, 0);
                    let random = Math.random() * totalWeight;
                    for (const item of threadWeights) {
                        random -= item.weight;
                        if (random <= 0) {
                            chosenThread = item.thread;
                            break;
                        }
                    }
                    if (!chosenThread) chosenThread = threadWeights[threadWeights.length - 1]?.thread || null;
                }

                let chosenFact = null;
                if (activeFacts.length > 0) {
                    const relevantFacts = activeFacts.filter((item) => item.subject_type === 'character');
                    chosenFact = relevantFacts.length > 0
                        ? relevantFacts[Math.floor(Math.random() * relevantFacts.length)]
                        : activeFacts[Math.floor(Math.random() * activeFacts.length)];
                }

                finalGoal = 'Tao 3 huong di bat ngo cho batch chuong tiep theo nhung van giu dung budget tien do.';
                if (chosenThread) finalGoal += ' Tuyen can day tiep: "' + chosenThread.title + '".';
                if (chosenThread?.description) finalGoal += ' Mo ta tuyen: ' + chosenThread.description + '.';
                if (chosenFact) finalGoal += ' Su that lien quan: "' + chosenFact.description + '".';
            }

            const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
                ...ctx,
                userPrompt: finalGoal,
                chapterCount: storyProgressBudget.batchCount,
                arcPacing: state.arcPacing,
                startChapterNumber: startingChapterIndex + 1,
                existingChapterBriefs,
                currentMacroArc: selectedMacroArc || ctx.currentMacroArc,
                macroArcContract: effectiveMacroArcContract,
                batchChapterAnchors,
                milestones: state.projectMilestones.length > 0 ? state.projectMilestones : ctx.milestones,
                storyProgressBudget,
            });

            await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.ARC_OUTLINE,
                    messages,
                    stream: true,
                    onToken: () => { },
                    onComplete: (text) => {
                        if (get().outlineRequestToken !== outlineRequestToken) {
                            resolve();
                            return;
                        }
                        try {
                            const parsed = parseAIJsonValue(text);
                            const outline = normalizeGeneratedOutline(
                                normalizeOutlineResult(parsed),
                                startingChapterIndex,
                            );
                            if (!outline) throw new Error('Unexpected outline format');
                            const nextState = get();
                            const derived = buildOutlineDerivedState({
                                ...nextState,
                                currentChapterCount: startingChapterIndex,
                                storyProgressBudget,
                            }, outline, nextState.selectedDraftIndexes, { preferDefaultSelection: true });
                            set({
                                currentChapterCount: startingChapterIndex,
                                generatedOutline: outline,
                                outlineStatus: 'ready',
                                outlineRevisionAssessment: null,
                                macroArcContract: derived.macroArcContract,
                                batchChapterAnchors: derived.batchChapterAnchors,
                                storyProgressBudget: derived.storyProgressBudget,
                                outlineValidation: derived.outlineValidation,
                                outlineSaveFeedback: null,
                                selectedDraftIndexes: derived.selectedDraftIndexes,
                                draftStatus: 'idle',
                                draftProgress: { current: 0, total: 0 },
                                draftResults: [],
                            });
                        } catch (error) {
                            console.error('Failed to parse outline JSON:', error, text);
                            set({ outlineStatus: 'error' });
                        }
                        resolve();
                    },
                    onError: (error) => {
                        if (get().outlineRequestToken !== outlineRequestToken) {
                            resolve();
                            return;
                        }
                        console.error('Outline generation error:', error);
                        set({ outlineStatus: 'error' });
                        resolve();
                    },
                });
            });
        } catch (error) {
            console.error('generateOutline failed:', error);
            set({ outlineStatus: 'error' });
        }
    },

    reviseGeneratedOutline: async ({ projectId, chapterId, chapterIndex, genre, instruction }) => {
        const state = get();
        if (!state.generatedOutline?.chapters?.length) return false;
        const revisionInstruction = String(instruction ?? state.outlineRevisionPrompt ?? '').trim();
        if (!revisionInstruction) return false;

        const previousOutline = state.generatedOutline;
        const previousDerived = buildOutlineDerivedState(
            state,
            previousOutline,
            state.selectedDraftIndexes,
            { preferDefaultSelection: false },
        );

        let outlineRequestToken = 0;
        set((current) => {
            outlineRequestToken = Number(current.outlineRequestToken || 0) + 1;
            return {
                outlineStatus: 'generating',
                outlineRevisionPrompt: revisionInstruction,
                outlineRevisionAssessment: null,
                outlineValidation: { issues: [], hasBlockingIssues: false },
                outlineSaveFeedback: null,
                outlineRequestToken,
            };
        });
        try {
            const existingChapterBriefs = await loadExistingChapterBriefs(projectId);
            const startingChapterIndex = Math.max(
                Number.isFinite(chapterIndex) ? chapterIndex : 0,
                existingChapterBriefs.length,
            );
            const ctx = await gatherContext({
                projectId,
                chapterId,
                chapterIndex: startingChapterIndex,
                sceneId: null,
                sceneText: '',
                genre,
            });
            const selectedMacroArc = getSelectedMacroArcFromState(state);
            const storyProgressBudget = buildStoryProgressBudget({
                targetLength: state.projectTargetLength || ctx.targetLength,
                currentChapterCount: startingChapterIndex,
                batchCount: state.generatedOutline.chapters.length,
                selectedMacroArc,
                milestones: state.projectMilestones.length > 0 ? state.projectMilestones : ctx.milestones,
            });
            const effectiveMacroArcContract = compileMacroArcContract(selectedMacroArc || ctx.currentMacroArc, {
                allCharacters: ctx.allCharacters,
            });
            const batchChapterAnchors = collectBatchChapterAnchors(
                state.availableMacroArcs,
                storyProgressBudget.batchStartChapter,
                storyProgressBudget.batchEndChapter,
            );
            const messages = buildPrompt(TASK_TYPES.ARC_OUTLINE, {
                ...ctx,
                userPrompt: state.arcGoal,
                chapterCount: state.generatedOutline.chapters.length,
                arcPacing: state.arcPacing,
                startChapterNumber: startingChapterIndex + 1,
                existingChapterBriefs,
                currentMacroArc: selectedMacroArc || ctx.currentMacroArc,
                macroArcContract: effectiveMacroArcContract,
                batchChapterAnchors,
                milestones: state.projectMilestones.length > 0 ? state.projectMilestones : ctx.milestones,
                storyProgressBudget,
                generatedOutline: state.generatedOutline,
                outlineRevisionInstruction: revisionInstruction,
                validatorReports: state.outlineValidation?.issues || [],
            });

            await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.ARC_OUTLINE,
                    messages,
                    stream: true,
                    onToken: () => { },
                    onComplete: (text) => {
                        if (get().outlineRequestToken !== outlineRequestToken) {
                            resolve();
                            return;
                        }
                        try {
                            const parsed = parseAIJsonValue(text);
                            const outline = normalizeGeneratedOutline(
                                normalizeOutlineResult(parsed),
                                startingChapterIndex,
                            );
                            if (!outline) throw new Error('Unexpected outline format');
                            const nextState = get();
                            const derived = buildOutlineDerivedState({
                                ...nextState,
                                currentChapterCount: startingChapterIndex,
                                storyProgressBudget,
                            }, outline, nextState.selectedDraftIndexes, { preferDefaultSelection: true });
                            const revisionAssessment = summarizeOutlineRevisionAssessment({
                                beforeValidation: previousDerived.outlineValidation,
                                afterValidation: derived.outlineValidation,
                                beforeOutline: previousOutline,
                                afterOutline: outline,
                            });
                            set({
                                currentChapterCount: startingChapterIndex,
                                generatedOutline: outline,
                                outlineStatus: 'ready',
                                outlineRevisionPrompt: revisionAssessment.status === 'improved' ? '' : revisionInstruction,
                                outlineRevisionAssessment: revisionAssessment,
                                macroArcContract: derived.macroArcContract,
                                batchChapterAnchors: derived.batchChapterAnchors,
                                storyProgressBudget: derived.storyProgressBudget,
                                outlineValidation: derived.outlineValidation,
                                outlineSaveFeedback: null,
                                selectedDraftIndexes: derived.selectedDraftIndexes,
                            });
                        } catch (error) {
                            console.error('Failed to parse revised outline JSON:', error, text);
                            set({ outlineStatus: 'error' });
                        }
                        resolve();
                    },
                    onError: (error) => {
                        if (get().outlineRequestToken !== outlineRequestToken) {
                            resolve();
                            return;
                        }
                        console.error('Outline revision error:', error);
                        set({ outlineStatus: 'error' });
                        resolve();
                    },
                });
            });
            return {
                ok: true,
                status: 'revised',
                revisionAssessment: get().outlineRevisionAssessment,
            };
        } catch (error) {
            console.error('reviseGeneratedOutline failed:', error);
            set({ outlineStatus: 'error' });
            return { ok: false, status: 'error', error };
        }
    },

    updateOutlineChapter: (index, updates) => {
        const state = get();
        if (!state.generatedOutline?.chapters) return;
        const chapters = [...state.generatedOutline.chapters];
        chapters[index] = { ...chapters[index], ...updates };
        const generatedOutline = { ...state.generatedOutline, chapters };
        const derived = buildOutlineDerivedState(state, generatedOutline, state.selectedDraftIndexes);
        set({
            generatedOutline,
            outlineRevisionAssessment: null,
            macroArcContract: derived.macroArcContract,
            batchChapterAnchors: derived.batchChapterAnchors,
            storyProgressBudget: derived.storyProgressBudget,
            outlineValidation: derived.outlineValidation,
            outlineSaveFeedback: null,
            selectedDraftIndexes: derived.selectedDraftIndexes,
        });
    },

    removeOutlineChapter: (index) => {
        const state = get();
        if (!state.generatedOutline?.chapters) return;
        const chapters = state.generatedOutline.chapters.filter((_, chapterIndex) => chapterIndex !== index);
        const shiftedSelection = (state.selectedDraftIndexes || []).reduce((result, selectedIndex) => {
            if (selectedIndex === index) return result;
            result.push(selectedIndex > index ? selectedIndex - 1 : selectedIndex);
            return result;
        }, []);
        const generatedOutline = { ...state.generatedOutline, chapters };
        const derived = buildOutlineDerivedState(state, generatedOutline, shiftedSelection);
        set({
            generatedOutline,
            outlineRevisionAssessment: null,
            macroArcContract: derived.macroArcContract,
            batchChapterAnchors: derived.batchChapterAnchors,
            storyProgressBudget: derived.storyProgressBudget,
            outlineValidation: derived.outlineValidation,
            outlineSaveFeedback: null,
            selectedDraftIndexes: derived.selectedDraftIndexes,
        });
    },

    // ═══════════════════════════════════════════
    // BƯỚC 4: Đắp thịt (Batch Generation)
    // ═══════════════════════════════════════════
    startBatchDraft: async ({ projectId, genre, startingChapterIndex }) => {
        const state = get();
        if (!state.generatedOutline?.chapters?.length) return false;
        if (state.outlineValidation?.hasBlockingIssues) return false;

        const draftQueue = buildDraftQueue(
            state.generatedOutline,
            state.selectedDraftIndexes,
            startingChapterIndex,
        );
        if (draftQueue.length === 0) return false;

        const existingChapterBriefs = await loadExistingChapterBriefs(projectId);
        let generatedBridgeBuffer = '';
        set({
            draftStatus: 'drafting',
            draftProgress: { current: 0, total: draftQueue.length },
            draftResults: draftQueue,
        });

        for (let queueIndex = 0; queueIndex < draftQueue.length; queueIndex++) {
            const liveState = get();
            if (liveState.draftStatus === 'idle') break;

            const draftItem = liveState.draftResults[queueIndex];
            const outlineIndex = draftItem?.outlineIndex;
            const chapter = liveState.generatedOutline?.chapters?.[outlineIndex];
            if (!chapter) continue;

            try {
                const ctx = await gatherContext({
                    projectId,
                    chapterId: null,
                    chapterIndex: draftItem.chapterIndex,
                    sceneId: null,
                    sceneText: generatedBridgeBuffer,
                    genre,
                });
                const previousGeneratedSummary = outlineIndex > 0
                    ? (liveState.generatedOutline?.chapters?.[outlineIndex - 1]?.summary || '')
                    : '';
                const selectedMacroArc = getSelectedMacroArcFromState(liveState);
                const effectiveMacroArcContract = compileMacroArcContract(selectedMacroArc || ctx.currentMacroArc, {
                    allCharacters: ctx.allCharacters,
                });
                const chapterNumber = draftItem.chapterIndex + 1;
                const anchorGroups = partitionDraftChapterAnchors(
                    liveState.batchChapterAnchors,
                    chapterNumber,
                );
                let anchorReports = [];
                let finished = false;

                for (let attempt = 0; attempt < 2 && !finished; attempt += 1) {
                    const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
                        ...ctx,
                        previousSummary: previousGeneratedSummary || ctx.previousSummary,
                        bridgeBuffer: generatedBridgeBuffer || ctx.bridgeBuffer,
                        chapterOutlineTitle: chapter.title,
                        chapterOutlinePurpose: chapter.purpose || '',
                        chapterOutlineSummary: chapter.summary,
                        chapterOutlineEvents: chapter.key_events || [],
                        chapterOutlineObjectiveRefs: chapter.objective_refs || [],
                        chapterOutlineAnchorRefs: chapter.anchor_refs || [],
                        chapterOutlineStateDelta: chapter.state_delta || '',
                        chapterOutlineGuardrail: chapter.arc_guard_note || '',
                        startChapterNumber: chapterNumber,
                        existingChapterBriefs,
                        priorGeneratedChapterBriefs: buildPriorGeneratedBriefs(
                            liveState.generatedOutline,
                            outlineIndex,
                            startingChapterIndex,
                        ),
                        currentMacroArc: selectedMacroArc || ctx.currentMacroArc,
                        macroArcContract: effectiveMacroArcContract,
                        currentChapterAnchors: anchorGroups.current,
                        futureChapterAnchors: anchorGroups.future,
                        chapterAnchorValidationReports: anchorReports,
                        storyProgressBudget: liveState.storyProgressBudget,
                    });

                    const attemptResult = await new Promise((resolve) => {
                        aiService.send({
                            taskType: TASK_TYPES.ARC_CHAPTER_DRAFT,
                            messages,
                            stream: true,
                            onToken: () => { },
                            onComplete: (text) => resolve({ text }),
                            onError: (error) => resolve({ error }),
                        });
                    });

                    if (attemptResult.error) {
                        console.error(`Draft chapter ${outlineIndex} error:`, attemptResult.error);
                        set((current) => ({
                            draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                            draftResults: current.draftResults.map((item, index) => (
                                index === queueIndex
                                    ? { ...item, status: 'error' }
                                    : item
                            )),
                        }));
                        break;
                    }

                    const text = attemptResult.text || '';
                    const validationReports = validateDraftAgainstChapterAnchors(
                        { title: chapter.title, summary: chapter.summary, content: text },
                        [...anchorGroups.current, ...anchorGroups.future],
                        { currentChapterNumber: chapterNumber },
                    );
                    const blockingReports = validationReports.filter((report) => report.severity === 'error');

                    if (blockingReports.length > 0 && attempt === 0) {
                        anchorReports = blockingReports;
                        continue;
                    }

                    if (blockingReports.length > 0) {
                        set((current) => ({
                            draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                            draftResults: current.draftResults.map((item, index) => (
                                index === queueIndex
                                    ? { ...item, status: 'error', flagNote: blockingReports.map((report) => report.message).join(' | ') }
                                    : item
                            )),
                        }));
                        break;
                    }

                    const wordCount = text.split(/\s+/).filter(Boolean).length;
                    generatedBridgeBuffer = buildProseBuffer(text);
                    set((current) => ({
                        draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                        draftResults: current.draftResults.map((item, index) => (
                            index === queueIndex
                                ? { ...item, content: text, wordCount, status: 'done', flagNote: '' }
                                : item
                        )),
                    }));
                    finished = true;
                }
            } catch (error) {
                console.error(`Draft chapter ${outlineIndex} exception:`, error);
                set((current) => ({
                    draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                    draftResults: current.draftResults.map((item, index) => (
                        index === queueIndex
                            ? { ...item, status: 'error' }
                            : item
                    )),
                }));
            }
        }

        set((liveState) => (liveState.draftStatus === 'drafting' ? { draftStatus: 'done' } : {}));
        return true;
    },

    cancelDraft: () => set({ draftStatus: 'idle' }),

    // ═══════════════════════════════════════════
    // Lưu Dàn Ý Only (không đắp thịt)
    // Phase 9: Tạo arc record thực sự + gán arc_id cho chapters
    // ═══════════════════════════════════════════
    commitOutlineOnly: async (projectId, options = {}) => {
        const state = get();
        if (!state.generatedOutline?.chapters?.length) return false;
        const force = options?.force === true;

        const { chapters } = useProjectStore.getState();
        const baseIndex = getNextOrderIndex(chapters);
        const chapterCount = state.generatedOutline.chapters.length;
        const commitDerived = deriveOutlineCommitState(state, baseIndex);
        if (commitDerived.outlineValidation.hasBlockingIssues) {
            const feedback = {
                ok: false,
                status: 'blocked',
                forced: false,
                blockingIssueCount: commitDerived.outlineValidation.issues.filter((issue) => issue.severity === 'error').length,
                message: 'Dan y van con loi blocking. Neu ban chi muon luu outline de sua tiep, hay dung hanh dong "Luu dan y bat chap".',
            };
            set({
                outlineValidation: commitDerived.outlineValidation,
                storyProgressBudget: commitDerived.storyProgressBudget,
                batchChapterAnchors: commitDerived.batchChapterAnchors,
                macroArcContract: commitDerived.macroArcContract,
                outlineSaveFeedback: feedback,
            });
            if (!force) return feedback;
        }

        // Phase 9: Tạo arc record trước, lấy arcId để gán cho chapters
        const arcId = await createArcRecord({
            projectId,
            macroArcId: state.selectedMacroArcId || state.currentMacroArcId,
            arcTitle: state.generatedOutline.arc_title || state.arcGoal || 'Arc moi',
            arcGoal: state.arcGoal,
            chapterStart: baseIndex + 1,
            chapterEnd: baseIndex + chapterCount,
        });

        // Lưu arcId vào store để UI có thể tham chiếu
        set({ currentArcId: arcId });

        for (let i = 0; i < chapterCount; i++) {
            const ch = state.generatedOutline.chapters[i];
            const chapterId = await db.chapters.add({
                project_id: projectId,
                arc_id: arcId,        // Phase 9: gán đúng arc_id thay vì null
                order_index: baseIndex + i,
                title: ch.title,
                summary: ch.summary || '',
                purpose: ch.purpose || JSON.stringify(ch.key_events || []),
                status: 'outline',
                word_count_target: 7000,
                actual_word_count: 0,
            });

            await db.scenes.add({
                project_id: projectId,
                chapter_id: chapterId,
                order_index: 0,
                title: 'Canh 1',
                summary: '',
                pov_character_id: null,
                location_id: null,
                time_marker: '',
                goal: '',
                conflict: '',
                emotional_start: '',
                emotional_end: '',
                status: 'outline',
                draft_text: '',
                final_text: '',
            });

            await upsertChapterMetaForGeneratedChapter({
                chapterId,
                projectId,
                summary: ch.summary || '',
            });
        }

        await db.projects.update(projectId, {
            updated_at: Date.now(),
            cloud_pending_local_fork_until_change: 0,
        });
        await useProjectStore.getState().loadProject(projectId);
        const feedback = {
            ok: true,
            status: 'saved',
            forced: commitDerived.outlineValidation.hasBlockingIssues && force,
            blockingIssueCount: commitDerived.outlineValidation.issues.filter((issue) => issue.severity === 'error').length,
            message: commitDerived.outlineValidation.hasBlockingIssues && force
                ? 'Da luu outline du con loi blocking. Ban co the mo lai de sua tiep.'
                : 'Da luu outline vao truyen.',
        };
        set({
            outlineValidation: commitDerived.outlineValidation,
            storyProgressBudget: commitDerived.storyProgressBudget,
            batchChapterAnchors: commitDerived.batchChapterAnchors,
            macroArcContract: commitDerived.macroArcContract,
            outlineSaveFeedback: feedback,
        });
        return feedback;
    },

    // ═══════════════════════════════════════════
    // Lưu kết quả vào Database
    // Phase 9: Tạo arc record thực sự + gán arc_id cho chapters
    // ═══════════════════════════════════════════
    commitDraftsToProject: async (projectId) => {
        const state = get();
        const { chapters } = useProjectStore.getState();
        const baseIndex = getNextOrderIndex(chapters);

        const doneDrafts = state.draftResults.filter((item) => item.status === 'done' && item.content);
        if (doneDrafts.length === 0) return false;

        // Phase 9: Tạo arc record trước, lấy arcId để gán cho chapters
        const arcId = await createArcRecord({
            projectId,
            macroArcId: state.selectedMacroArcId || state.currentMacroArcId,
            arcTitle: state.generatedOutline?.arc_title || state.arcGoal || 'Arc moi',
            arcGoal: state.arcGoal,
            chapterStart: baseIndex + 1,
            chapterEnd: baseIndex + doneDrafts.length,
        });

        // Lưu arcId vào store để UI có thể tham chiếu
        set({ currentArcId: arcId });

        let createdCount = 0;

        for (let di = 0; di < doneDrafts.length; di++) {
            const draft = doneDrafts[di];
            const outlineChapter = state.generatedOutline?.chapters?.[draft.outlineIndex] || null;

            const chapterId = await db.chapters.add({
                project_id: projectId,
                arc_id: arcId,        // Phase 9: gán đúng arc_id thay vì null
                order_index: baseIndex + createdCount,
                title: draft.title,
                summary: outlineChapter?.summary || '',
                purpose: outlineChapter?.purpose || '',
                status: 'draft',
                word_count_target: 7000,
                actual_word_count: draft.wordCount,
            });
            createdCount++;

            await db.scenes.add({
                project_id: projectId,
                chapter_id: chapterId,
                order_index: 0,
                title: 'Canh 1',
                summary: '',
                pov_character_id: null,
                location_id: null,
                time_marker: '',
                goal: '',
                conflict: '',
                emotional_start: '',
                emotional_end: '',
                status: 'draft',
                draft_text: draft.content,
                final_text: '',
            });

            await upsertChapterMetaForGeneratedChapter({
                chapterId,
                projectId,
                summary: outlineChapter?.summary || '',
                rawText: draft.content,
            });
        }

        await db.projects.update(projectId, {
            updated_at: Date.now(),
            cloud_pending_local_fork_until_change: 0,
        });
        await useProjectStore.getState().loadProject(projectId);
        return true;
    },

    // ═══════════════════════════════════════════
    // PHASE 3: Feedback Loop
    // ═══════════════════════════════════════════
    flagChapter: (index, note) => {
        set(state => ({
            draftResults: state.draftResults.map((r, i) => {
                if (i !== index) return r;
                // If note is empty/falsy, unflag (revert to done)
                if (!note) return { ...r, status: 'done', flagNote: '' };
                return { ...r, status: 'flagged', flagNote: note };
            }),
        }));
    },

    regenerateFromIndex: async ({ projectId, genre, fromIndex, startingChapterIndex }) => {
        const state = get();
        if (!state.generatedOutline?.chapters?.length) return false;
        if (!state.draftResults?.[fromIndex]) return false;

        const existingChapterBriefs = await loadExistingChapterBriefs(projectId);

        set((current) => ({
            draftStatus: 'drafting',
            draftProgress: { current: fromIndex, total: current.draftResults.length },
            draftResults: current.draftResults.map((item, itemIndex) => (
                itemIndex >= fromIndex
                    ? { ...item, content: '', wordCount: 0, status: 'pending' }
                    : item
            )),
        }));

        let regeneratedBridgeBuffer = '';

        for (let queueIndex = fromIndex; queueIndex < get().draftResults.length; queueIndex++) {
            const liveState = get();
            if (liveState.draftStatus === 'idle') break;

            const draftItem = liveState.draftResults[queueIndex];
            const outlineIndex = draftItem?.outlineIndex;
            const ch = liveState.generatedOutline?.chapters?.[outlineIndex];
            if (!draftItem || !ch) continue;

            // Lấy nội dung các chương trước đã OK làm context
            const currentResults = liveState.draftResults;
            const previousContent = currentResults
                .filter((item, itemIndex) => itemIndex < queueIndex && item.status === 'done')
                .map((item) => item.content)
                .join('\n\n');

            try {
                const ctx = await gatherContext({
                    projectId,
                    chapterId: null,
                    chapterIndex: draftItem.chapterIndex ?? (startingChapterIndex + outlineIndex),
                    sceneId: null,
                    sceneText: previousContent.slice(-3000),
                    genre,
                });

                const flagNote = draftItem.flagNote || '';
                const previousGeneratedSummary = outlineIndex > 0
                    ? (liveState.generatedOutline?.chapters?.[outlineIndex - 1]?.summary || '')
                    : '';
                const previousBridgeBuffer = regeneratedBridgeBuffer
                    || buildProseBuffer(previousContent)
                    || ctx.bridgeBuffer;
                const selectedMacroArc = getSelectedMacroArcFromState(liveState);
                const effectiveMacroArcContract = compileMacroArcContract(selectedMacroArc || ctx.currentMacroArc, {
                    allCharacters: ctx.allCharacters,
                });
                const chapterNumber = (draftItem.chapterIndex ?? (startingChapterIndex + outlineIndex)) + 1;
                const anchorGroups = partitionDraftChapterAnchors(
                    liveState.batchChapterAnchors,
                    chapterNumber,
                );
                let anchorReports = [];
                let finished = false;

                for (let attempt = 0; attempt < 2 && !finished; attempt += 1) {
                    const messages = buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
                        ...ctx,
                        previousSummary: previousGeneratedSummary || ctx.previousSummary,
                        bridgeBuffer: previousBridgeBuffer,
                        chapterOutlineTitle: ch.title,
                        chapterOutlinePurpose: ch.purpose || '',
                        chapterOutlineSummary: ch.summary + (flagNote ? '. GHI CHU SUA DOI: ' + flagNote : ''),
                        chapterOutlineEvents: ch.key_events || [],
                        chapterOutlineObjectiveRefs: ch.objective_refs || [],
                        chapterOutlineAnchorRefs: ch.anchor_refs || [],
                        chapterOutlineStateDelta: ch.state_delta || '',
                        chapterOutlineGuardrail: ch.arc_guard_note || '',
                        startChapterNumber: chapterNumber,
                        existingChapterBriefs,
                        priorGeneratedChapterBriefs: buildPriorGeneratedBriefs(
                            liveState.generatedOutline,
                            outlineIndex,
                            startingChapterIndex,
                        ),
                        currentMacroArc: selectedMacroArc || ctx.currentMacroArc,
                        macroArcContract: effectiveMacroArcContract,
                        currentChapterAnchors: anchorGroups.current,
                        futureChapterAnchors: anchorGroups.future,
                        chapterAnchorValidationReports: anchorReports,
                        storyProgressBudget: liveState.storyProgressBudget,
                    });

                    const attemptResult = await new Promise((resolve) => {
                        aiService.send({
                            taskType: TASK_TYPES.ARC_CHAPTER_DRAFT,
                            messages,
                            stream: true,
                            onToken: () => { },
                            onComplete: (text) => resolve({ text }),
                            onError: (error) => resolve({ error }),
                        });
                    });

                    if (attemptResult.error) {
                        console.error(`Regen chapter ${outlineIndex} error:`, attemptResult.error);
                        set((current) => ({
                            draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                            draftResults: current.draftResults.map((item, itemIndex) =>
                                itemIndex === queueIndex ? { ...item, status: 'error' } : item
                            ),
                        }));
                        break;
                    }

                    const text = attemptResult.text || '';
                    const validationReports = validateDraftAgainstChapterAnchors(
                        { title: ch.title, summary: ch.summary, content: text },
                        [...anchorGroups.current, ...anchorGroups.future],
                        { currentChapterNumber: chapterNumber },
                    );
                    const blockingReports = validationReports.filter((report) => report.severity === 'error');

                    if (blockingReports.length > 0 && attempt === 0) {
                        anchorReports = blockingReports;
                        continue;
                    }

                    if (blockingReports.length > 0) {
                        set((current) => ({
                            draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                            draftResults: current.draftResults.map((item, itemIndex) =>
                                itemIndex === queueIndex
                                    ? { ...item, status: 'error', flagNote: blockingReports.map((report) => report.message).join(' | ') }
                                    : item
                            ),
                        }));
                        break;
                    }

                    const wordCount = text.split(/\s+/).filter(Boolean).length;
                    regeneratedBridgeBuffer = buildProseBuffer(text);
                    set((current) => ({
                        draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                        draftResults: current.draftResults.map((item, itemIndex) =>
                            itemIndex === queueIndex ? { ...item, content: text, wordCount, status: 'done', flagNote: '' } : item
                        ),
                    }));
                    finished = true;
                }
            } catch (error) {
                console.error(`Regen chapter ${outlineIndex} exception:`, error);
                set((current) => ({
                    draftProgress: { ...current.draftProgress, current: queueIndex + 1 },
                    draftResults: current.draftResults.map((item, itemIndex) =>
                        itemIndex === queueIndex ? { ...item, status: 'error' } : item
                    ),
                }));
            }
        }

        set((live) => {
            if (live.draftStatus === 'drafting') return { draftStatus: 'done' };
            return {};
        });
        return true;
    },

    // ═══════════════════════════════════════════
    // Phase 9: Grand Strategy Actions
    // ═══════════════════════════════════════════

    /**
     * AI gợi ý 5-8 cột mốc lớn cho toàn bộ truyện.
     * Kết quả lưu vào `macroMilestoneSuggestions` để tác giả duyệt.
     * Tác giả duyệt xong → gọi `saveMacroMilestones` để lưu vào DB.
     *
     * @param {object} params
     * @param {number} params.projectId
     * @param {string} params.authorIdea   - Ý tưởng tổng thể của tác giả (vài câu)
     * @param {string} params.genre
     */
    generateMacroMilestones: async ({
        projectId,
        authorIdea,
        genre,
        milestoneCount = 0,
        requirements = '',
        planningScopeStart = 0,
        planningScopeEnd = 0,
        macroMilestoneChapterPlans = [],
        macroChapterAnchorInputs = [],
    }) => {
        set({ isSuggestingMilestones: true, macroMilestoneSuggestions: null });

        try {
            const project = await db.projects.get(projectId);
            const targetLength = project?.target_length || 0;
            const ultimateGoal = project?.ultimate_goal || '';
            const planningScope = normalizeMacroPlanningScope({
                planningScopeStart,
                planningScopeEnd,
                targetLength,
            });
            let promptTemplates = {};
            if (project?.prompt_templates) {
                try { promptTemplates = JSON.parse(project.prompt_templates); } catch { }
            }

            const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
                projectTitle: project?.title || '',
                genre,
                authorIdea,
                userPrompt: authorIdea,
                targetLength,
                ultimateGoal,
                promptTemplates,
                macroMilestoneCount: milestoneCount,
                macroMilestoneRequirements: requirements,
                planningScopeStart: planningScope.start,
                planningScopeEnd: planningScope.end,
                macroMilestoneChapterPlans,
                macroChapterAnchorInputs,
            });

            await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.GENERATE_MACRO_MILESTONES,
                    messages,
                    stream: false,
                    onComplete: (text) => {
                        try {
                            const parsed = parseAIJsonValue(text);
                            if (!isPlainObject(parsed) || !Array.isArray(parsed.milestones)) {
                                throw new Error('Invalid milestones format');
                            }
                            set({
                                macroMilestoneSuggestions: normalizeMacroMilestonePayload(parsed, {
                                    planningScope,
                                macroMilestoneChapterPlans,
                                requestedMilestoneCount: milestoneCount,
                                macroChapterAnchorInputs,
                            }),
                                isSuggestingMilestones: false,
                            });
                        } catch (e) {
                            console.error('[ArcGen] Failed to parse milestones:', e, text);
                            set({ isSuggestingMilestones: false });
                        }
                        resolve();
                    },
                    onError: (err) => {
                        console.error('[ArcGen] generateMacroMilestones error:', err);
                        set({ isSuggestingMilestones: false });
                        resolve();
                    },
                });
            });
        } catch (err) {
            console.error('[ArcGen] generateMacroMilestones failed:', err);
            set({ isSuggestingMilestones: false });
        }
    },

    reviseMacroMilestones: async ({
        projectId,
        authorIdea,
        genre,
        existingMilestones = [],
        milestoneCount = 0,
        requirements = '',
        planningScopeStart = 0,
        planningScopeEnd = 0,
        macroMilestoneChapterPlans = [],
        macroChapterAnchorInputs = [],
    }) => {
        set({ isRevisingMilestones: true });

        try {
            const project = await db.projects.get(projectId);
            const targetLength = project?.target_length || 0;
            const ultimateGoal = project?.ultimate_goal || '';
            const planningScope = normalizeMacroPlanningScope({
                planningScopeStart,
                planningScopeEnd,
                targetLength,
            });
            let promptTemplates = {};
            if (project?.prompt_templates) {
                try { promptTemplates = JSON.parse(project.prompt_templates); } catch { }
            }

            const messages = buildPrompt(TASK_TYPES.GENERATE_MACRO_MILESTONES, {
                projectTitle: project?.title || '',
                genre,
                authorIdea,
                userPrompt: authorIdea,
                targetLength,
                ultimateGoal,
                promptTemplates,
                existingMacroMilestones: existingMilestones,
                macroRevisionInstruction: authorIdea,
                macroMilestoneCount: milestoneCount,
                macroMilestoneRequirements: requirements,
                planningScopeStart: planningScope.start,
                planningScopeEnd: planningScope.end,
                macroMilestoneChapterPlans,
                macroChapterAnchorInputs,
            });

            await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.GENERATE_MACRO_MILESTONES,
                    messages,
                    stream: false,
                    onComplete: (text) => {
                        try {
                            const parsed = parseAIJsonValue(text);
                            if (!isPlainObject(parsed) || !Array.isArray(parsed.milestones)) {
                                throw new Error('Invalid milestones format');
                            }
                            set({
                                macroMilestoneSuggestions: normalizeMacroMilestonePayload(parsed, {
                                    planningScope,
                                macroMilestoneChapterPlans,
                                requestedMilestoneCount: milestoneCount,
                                macroChapterAnchorInputs,
                            }),
                                isRevisingMilestones: false,
                            });
                        } catch (e) {
                            console.error('[ArcGen] Failed to parse revised milestones:', e, text);
                            set({ isRevisingMilestones: false });
                        }
                        resolve();
                    },
                    onError: (err) => {
                        console.error('[ArcGen] reviseMacroMilestones error:', err);
                        set({ isRevisingMilestones: false });
                        resolve();
                    },
                });
            });
        } catch (err) {
            console.error('[ArcGen] reviseMacroMilestones failed:', err);
            set({ isRevisingMilestones: false });
        }
    },

    analyzeMacroContract: async ({ projectId, macroArc, key = 'default' }) => {
        set((state) => ({
            analyzingMacroContractKeys: {
                ...state.analyzingMacroContractKeys,
                [key]: true,
            },
        }));

        try {
            const project = await db.projects.get(projectId);
            let promptTemplates = {};
            if (project?.prompt_templates) {
                try { promptTemplates = JSON.parse(project.prompt_templates); } catch { }
            }

            const messages = buildPrompt(TASK_TYPES.ANALYZE_MACRO_CONTRACT, {
                projectTitle: project?.title || '',
                genre: project?.genre_primary || '',
                ultimateGoal: project?.ultimate_goal || '',
                promptTemplates,
                currentMacroArc: macroArc,
                userPrompt: macroArc?.description || '',
            });

            return await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.ANALYZE_MACRO_CONTRACT,
                    messages,
                    stream: false,
                    onComplete: (text) => {
                        try {
                            const parsed = parseAIJsonValue(text);
                            const normalized = normalizeMacroContractAnalysisPayload(parsed, macroArc);
                            if (!normalized) {
                                throw new Error('Invalid macro contract analysis format');
                            }
                            resolve(normalized);
                        } catch (e) {
                            console.error('[ArcGen] Failed to parse macro contract analysis:', e, text);
                            resolve(null);
                        } finally {
                            set((state) => ({
                                analyzingMacroContractKeys: {
                                    ...state.analyzingMacroContractKeys,
                                    [key]: false,
                                },
                            }));
                        }
                    },
                    onError: (err) => {
                        console.error('[ArcGen] analyzeMacroContract error:', err);
                        set((state) => ({
                            analyzingMacroContractKeys: {
                                ...state.analyzingMacroContractKeys,
                                [key]: false,
                            },
                        }));
                        resolve(null);
                    },
                });
            });
        } catch (err) {
            console.error('[ArcGen] analyzeMacroContract failed:', err);
            set((state) => ({
                analyzingMacroContractKeys: {
                    ...state.analyzingMacroContractKeys,
                    [key]: false,
                },
            }));
            return null;
        }
    },

    /**
     * Lưu các cột mốc đã tác giả duyệt vào DB (bảng macro_arcs).
     * Gọi sau khi tác giả review `macroMilestoneSuggestions` và confirm.
     *
     * @param {number} projectId
     * @param {Array}  milestones - mảng đã chỉnh sửa từ macroMilestoneSuggestions
     * @returns {Promise<number[]>} mảng các id vừa tạo
     */
    saveMacroMilestones: async (projectId, milestones) => {
        if (!milestones || milestones.length === 0) return [];

        const createdIds = [];
        for (let i = 0; i < milestones.length; i++) {
            const m = normalizeMacroMilestoneItem(milestones[i], i);
            const id = await db.macro_arcs.add({
                project_id: projectId,
                order_index: i,
                title: m.title || '',
                description: m.description || '',
                chapter_from: m.chapter_from || 0,
                chapter_to: m.chapter_to || 0,
                emotional_peak: m.emotional_peak || '',
                chapter_anchors: m.chapter_anchors || [],
                contract_json: m.contract_json || '',
            });
            createdIds.push(id);
        }

        // Xóa suggestions khỏi store sau khi đã lưu
        set({ macroMilestoneSuggestions: null });
        return createdIds;
    },

    /**
     * Kiểm tra độ lệch của arc đang viết so với đại cục.
     * Nên gọi sau mỗi 10 chương hoàn thành.
     * Kết quả lưu vào `lastAuditResult`.
     *
     * @param {object} params
     * @param {number} params.projectId
     * @param {string} params.genre
     * @param {number} params.currentChapterIndex - index chương hiện tại
     */
    auditArcAlignment: async ({ projectId, genre, currentChapterIndex }) => {
        set({ isAuditingArc: true, lastAuditResult: null });

        try {
            const project = await db.projects.get(projectId);
            const ultimateGoal = project?.ultimate_goal || '';
            const targetLength = project?.target_length || 0;

            // Lấy 10 chapter summary gần nhất
            const allChapters = await db.chapters
                .where('project_id').equals(projectId)
                .sortBy('order_index');
            const recentChapters = allChapters
                .filter(c => c.order_index <= currentChapterIndex)
                .slice(-10);
            const recentMetas = await Promise.all(
                recentChapters.map(c =>
                    db.chapterMeta.where('chapter_id').equals(c.id).first()
                )
            );
            const recentSummaries = recentChapters.map((c, i) => ({
                title: c.title,
                summary: recentMetas[i]?.summary || c.summary || '',
            }));

            // Lấy macro arc và arc hiện tại
            const { currentMacroArcId, currentArcId } = get();
            let macroArcInfo = null;
            let currentArcInfo = null;

            if (currentMacroArcId) {
                try { macroArcInfo = await db.macro_arcs.get(currentMacroArcId); } catch { }
            }
            if (currentArcId) {
                try { currentArcInfo = await db.arcs.get(currentArcId); } catch { }
            }

            let promptTemplates = {};
            if (project?.prompt_templates) {
                try { promptTemplates = JSON.parse(project.prompt_templates); } catch { }
            }

            const messages = buildPrompt(TASK_TYPES.AUDIT_ARC_ALIGNMENT, {
                projectTitle: project?.title || '',
                genre,
                targetLength,
                ultimateGoal,
                currentChapterIndex,
                currentArc: currentArcInfo,
                currentMacroArc: macroArcInfo,
                recentChapterSummaries: recentSummaries,
                promptTemplates,
            });

            await new Promise((resolve) => {
                aiService.send({
                    taskType: TASK_TYPES.AUDIT_ARC_ALIGNMENT,
                    messages,
                    stream: false,
                    onComplete: (text) => {
                        try {
                            const parsed = parseAIJsonValue(text);
                            if (!isPlainObject(parsed)) throw new Error('Invalid audit format');
                            set({ lastAuditResult: parsed, isAuditingArc: false });
                        } catch (e) {
                            console.error('[ArcGen] Failed to parse audit result:', e, text);
                            set({ isAuditingArc: false });
                        }
                        resolve();
                    },
                    onError: (err) => {
                        console.error('[ArcGen] auditArcAlignment error:', err);
                        set({ isAuditingArc: false });
                        resolve();
                    },
                });
            });
        } catch (err) {
            console.error('[ArcGen] auditArcAlignment failed:', err);
            set({ isAuditingArc: false });
        }
    },
}));

export default useArcGenStore;
