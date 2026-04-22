import { TASK_TYPES } from '../router';

// =============================================
// Writing tasks use 3 injection modes:
//
// FULL_WRITING: full Author DNA + Style DNA + Mood Board + Priority Anchor.
// STYLE_ONLY: style guidance only, without changing story direction.
// Shared by Layer 0, 4.2, and 5.5.
// =============================================
export const WRITING_TASKS_FOR_BRIDGE = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT,
]);

// Full injection: AI is drafting fresh prose.
export const FULL_WRITING_TASKS = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT, // Re-enabled for high quality chat
]);

// Style-only injection: AI is revising existing prose.
export const STYLE_ONLY_TASKS = new Set([
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
]);

export const WRITING_DISCIPLINE_TASKS = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
  TASK_TYPES.STYLE_WRITE,
]);

export const DEFAULT_WRITING_DISCIPLINE_LAYER = [
  '[KY LUAT VIET TRUYEN]',
  '- Nhat quan quan trong hon cau chu hoa my.',
  '- Ton trong POV hien tai va gioi han thong tin cua tung nhan vat.',
  '- Ton trong logic cam xuc: khong duoc lam nhan vat out-of-character chi de tao hieu ung.',
  '- Khong retcon, khong tu y doi quan he, luat the gioi, moc thoi gian, hay muc suc manh neu task khong yeu cau ro rang.',
  '- Khong AI-sounding: tranh triet ly rong, tong ket dao ly, len lop, lap y, hoac van qua pho neu khong co can cu.',
  '- Moi doan viet ra phai co tac dung ro: day tinh tiet, dao sau cam xuc, khac hoa nhan vat, tang xung dot, hoac giai phong thong tin.',
].join('\n');

// =============================================
// FREE_PROMPT intent detection
// Writing requests -> full Author DNA + Style DNA injection
// Questions/chat -> lightweight (Canon + Characters only)
// =============================================
export function isWritingIntent(userPrompt) {
  if (!userPrompt) return true; // No prompt = likely continuation
  const lower = userPrompt.toLowerCase();
  // Question patterns -> not writing
  if (lower.includes('?')) return false;
  const chatPatterns = ['la gi', 'giai thich', 'tai sao', 'the nao', 'bao nhieu',
    'dat ten', 'goi y ten', 'liet ke', 'so sanh', 'phan tich', 'cho toi biet',
    'giup toi', 'hay cho', 'la sao', 'nhu the nao', 'o dau', 'khi nao'];
  if (chatPatterns.some(function(p) { return lower.includes(p); })) return false;
  // Default: treat as writing (over-inject is better than under-inject for creative tasks)
  return true;
}

