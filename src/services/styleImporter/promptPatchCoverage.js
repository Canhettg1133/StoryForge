import { normalizeTargetPromptKey } from './patchApplier.js';

const STYLE_TEXT_FIELDS = [
  'narrative_voice',
  'sentence_rhythm',
  'pov_and_pronouns',
  'description_density',
  'dialogue_style',
  'action_scene_style',
  'inner_monologue_style',
];

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function hasList(value) {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

function hasAnyStyleData(stylePack = {}) {
  return STYLE_TEXT_FIELDS.some((field) => hasText(stylePack[field]))
    || hasList(stylePack.pacing_rules)
    || hasList(stylePack.must_preserve)
    || hasList(stylePack.must_avoid);
}

function hasChapterStructureData(stylePack = {}) {
  return hasText(stylePack.chapter_opening_pattern)
    || hasText(stylePack.chapter_ending_pattern)
    || hasList(stylePack.pacing_rules);
}

function hasContinuityData(stylePack = {}) {
  return hasList(stylePack.continuity_rules);
}

function normalizeStylePack(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function collectTargets(patches = []) {
  return new Set((patches || [])
    .map((patch) => normalizeTargetPromptKey(patch?.target_prompt || patch?.targetPrompt || patch?.target || ''))
    .filter(Boolean));
}

function makeItem({ target, label, required, covered, reason }) {
  return {
    target,
    label,
    required: Boolean(required),
    covered: Boolean(covered),
    reason,
  };
}

export function buildPromptPatchCoverage({ patches = [], stylePack = {} } = {}) {
  const safeStylePack = normalizeStylePack(stylePack);
  const targets = collectTargets(patches);
  const styleData = hasAnyStyleData(safeStylePack);
  const chapterStructureData = hasChapterStructureData(safeStylePack);
  const continuityData = hasContinuityData(safeStylePack);
  const directWritingCovered = ['continue', 'scene_draft', 'arc_chapter_draft']
    .some((target) => targets.has(target));

  const items = [
    makeItem({
      target: 'style_dna',
      label: 'DNA văn phong',
      required: styleData,
      covered: targets.has('style_dna'),
      reason: 'Nơi chính để lưu giọng kể, POV, nhịp câu, thoại, nội tâm và scene grammar.',
    }),
    makeItem({
      target: 'constitution',
      label: 'Luật cốt lõi',
      required: continuityData || hasList(safeStylePack.must_preserve),
      covered: targets.has('constitution'),
      reason: 'Dùng cho rule cứng xuyên suốt, không copy canon của tác phẩm mẫu.',
    }),
    makeItem({
      target: 'ai_guidelines',
      label: 'Chỉ dẫn truyện',
      required: styleData,
      covered: targets.has('ai_guidelines'),
      reason: 'Tóm tắt định hướng ngắn, được inject sớm trước nhiệm vụ viết.',
    }),
    makeItem({
      target: 'outline',
      label: 'Dàn ý chương',
      required: chapterStructureData,
      covered: targets.has('outline'),
      reason: 'Cần nhận pacing, mở/kết chương, hook và vòng lặp chương.',
    }),
    makeItem({
      target: 'arc_outline',
      label: 'Dàn ý arc',
      required: chapterStructureData,
      covered: targets.has('arc_outline'),
      reason: 'Cần nhận nhịp arc và phân bổ cấu trúc chương dài hạn.',
    }),
    makeItem({
      target: 'qa_check',
      label: 'QA sau viết',
      required: styleData || chapterStructureData,
      covered: targets.has('qa_check'),
      reason: 'Bắt lỗi sai POV, lệch giọng, generic, pacing sai và thiếu hook.',
    }),
    makeItem({
      target: 'continuity_check',
      label: 'Kiểm continuity',
      required: continuityData,
      covered: targets.has('continuity_check'),
      reason: 'Chỉ kiểm các rule timeline/world-rule/tài nguyên đã thuộc project.',
    }),
    makeItem({
      target: 'free_prompt',
      label: 'Ô yêu cầu tự do',
      required: styleData,
      covered: targets.has('free_prompt'),
      reason: 'Luồng viết/chỉnh tự do cần bridge ngắn tới Style DNA và luật project.',
    }),
    makeItem({
      target: 'direct_writing',
      label: 'Prompt viết trực tiếp',
      required: false,
      covered: directWritingCovered,
      reason: 'Chỉ nên là bridge ngắn cho continue/scene_draft/arc_chapter_draft.',
    }),
  ];

  return {
    items,
    patchedTargets: [...targets],
    missingRequiredCount: items.filter((item) => item.required && !item.covered).length,
  };
}
