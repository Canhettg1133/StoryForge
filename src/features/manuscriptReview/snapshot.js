import { REVIEW_LIMITS } from './constants.js';

export function stableReviewJson(value) {
  return JSON.stringify(value, (_key, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item
  ));
}

export async function hashReviewValue(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Cần HTTPS hoặc localhost để tạo chữ ký bản thảo an toàn.');
  const text = typeof value === 'string' ? value : stableReviewJson(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]));

export function captureReviewContext({ project = {}, scene = {}, chapter = {} } = {}) {
  return JSON.parse(JSON.stringify({
    project: pick(project, ['ai_guidelines', 'prompt_templates', 'pov_mode', 'tone', 'genre_primary', 'writing_style', 'project_style_runtime_block', 'project_style_runtime_enabled', 'project_style_runtime_meta']),
    scene: pick(scene, ['title', 'summary', 'goal', 'conflict', 'outcome', 'purpose', 'must_happen', 'must_not_happen', 'pov_character_id', 'pacing', 'emotional_start', 'emotional_end']),
    chapter: pick(chapter, ['title', 'purpose']),
  }));
}

function readParagraphs(doc, selection = null) {
  const paragraphs = [];
  let sceneIndex = 0;
  doc.descendants((node, position) => {
    if (!node.isTextblock) return undefined;
    const scene_index = sceneIndex++;
    if (selection && (position + node.nodeSize - 1 <= selection.from || position + 1 >= selection.to)) return false;
    let text = '';
    const runs = [];
    node.descendants((child, offset) => {
      const value = child.isText ? child.text : child.type.name === 'hardBreak' ? '\n' : '';
      if (!value) return;
      const from = position + 1 + offset;
      const start = selection ? Math.max(0, selection.from - from) : 0;
      const end = selection ? Math.min(value.length, selection.to - from) : value.length;
      if (end <= start) return;
      runs.push({ offset: text.length, length: end - start, from: from + start });
      text += value.slice(start, end);
    });
    paragraphs.push({ id: `p${paragraphs.length + 1}`, scene_index, text, runs });
    return false;
  });
  return paragraphs;
}

export function getManuscriptSceneParagraphs(editor) {
  if (!editor?.state?.doc || editor.isDestroyed) throw new Error('Editor chưa sẵn sàng.');
  return readParagraphs(editor.state.doc).map((item) => item.text);
}

export function createManuscriptSnapshot(editor, { scope = 'scene', project = {}, scene = {}, chapter = {} } = {}) {
  if (!editor?.state?.doc || editor.isDestroyed) throw new Error('Editor chưa sẵn sàng.');
  if (!['selection', 'scene'].includes(scope)) throw new Error('Phạm vi phân tích không hợp lệ.');
  const { doc, selection } = editor.state;
  if (scope === 'selection' && (!selection || selection.empty)) throw new Error('Hãy bôi đen đoạn cần phân tích; vùng chọn hiện đang rỗng.');
  const paragraphs = readParagraphs(doc, scope === 'selection' ? selection : null);
  const text = paragraphs.map((item) => item.text).join('\n\n');
  if (!text.trim()) throw new Error('Chưa có nội dung để phân tích.');
  if (text.length > REVIEW_LIMITS.sourceCharacters) throw new Error('Bản đầu hỗ trợ tối đa 60.000 ký tự. Hãy chọn đoạn ngắn hơn.');
  return {
    project_id: project.id, scene_id: scene.id, chapter_id: scene.chapter_id || chapter.id,
    scope, text, paragraphs, document: doc,
    sceneParagraphs: scope === 'scene' ? paragraphs.map((item) => item.text) : getManuscriptSceneParagraphs(editor),
    context: captureReviewContext({ project, scene, chapter }),
  };
}

function positionAt(paragraph, offset, isEnd) {
  const runs = isEnd ? [...paragraph.runs].reverse() : paragraph.runs;
  const run = runs.find((item) => isEnd
    ? offset > item.offset && offset <= item.offset + item.length
    : offset >= item.offset && offset < item.offset + item.length);
  return run ? run.from + offset - run.offset : null;
}

function matchingOffsets(text, evidence) {
  if (!evidence.quote) return [];
  const matches = [];
  let index = text.indexOf(evidence.quote);
  while (index !== -1) {
    const end = index + evidence.quote.length;
    if ((!evidence.prefix || text.slice(Math.max(0, index - evidence.prefix.length), index) === evidence.prefix)
      && (!evidence.suffix || text.slice(end, end + evidence.suffix.length) === evidence.suffix)) matches.push(index);
    if (matches.length > 1) break;
    index = text.indexOf(evidence.quote, index + 1);
  }
  return matches;
}

function matchInParagraph(paragraph, evidence) {
  const matches = matchingOffsets(paragraph.text, evidence);
  if (matches.length !== 1) return null;
  const start = matches[0];
  const end = start + evidence.quote.length;
  const from = positionAt(paragraph, start, false);
  const to = positionAt(paragraph, end, true);
  if (from === null || to === null) return null;
  return { paragraph_id: paragraph.id, quote: evidence.quote, from, to,
    prefix: paragraph.text.slice(Math.max(0, start - 80), start), suffix: paragraph.text.slice(end, end + 80) };
}

export function resolveSnapshotEvidence(snapshot, evidence) {
  const paragraph = snapshot.paragraphs.find((item) => item.id === evidence.paragraph_id);
  const anchor = paragraph ? matchInParagraph(paragraph, evidence) : null;
  if (!anchor) return null;
  let occurrences = 0;
  for (const text of snapshot.sceneParagraphs || snapshot.paragraphs.map((item) => item.text)) {
    occurrences += matchingOffsets(text, anchor).length;
    if (occurrences > 1) break;
  }
  // App-owned identity, never an offset or ordinal supplied by the evaluator.
  return { ...anchor, scene_index: paragraph.scene_index, unique_in_scene: occurrences === 1 };
}

export async function findEvidenceInEditor(editor, evidence, { sceneSignature } = {}) {
  if (!editor?.state?.doc || editor.isDestroyed) return null;
  const doc = editor.state.doc;
  const paragraphs = readParagraphs(doc);
  const unchanged = sceneSignature && await hashReviewValue(paragraphs.map((item) => item.text)) === sceneSignature;
  if (editor.isDestroyed || editor.state.doc !== doc) return null;
  if (unchanged && Number.isInteger(evidence.scene_index)) {
    const paragraph = paragraphs[evidence.scene_index];
    return paragraph ? matchInParagraph(paragraph, evidence) : null;
  }
  // An originally duplicated quote cannot become a safe target just because its twin was deleted.
  if (!unchanged && evidence.unique_in_scene !== true) return null;
  let match = null;
  for (const paragraph of paragraphs) {
    const offsets = matchingOffsets(paragraph.text, evidence);
    if (offsets.length > 1 || (offsets.length && match)) return null;
    if (offsets.length) match = matchInParagraph(paragraph, evidence);
  }
  return match;
}
