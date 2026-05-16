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
  '[KỶ LUẬT VIẾT TRUYỆN]',
  '- Nhất quán quan trọng hơn câu chữ hoa mỹ.',
  '- Tôn trọng POV hiện tại và giới hạn thông tin của từng nhân vật.',
  '- Tôn trọng logic cảm xúc: không được làm nhân vật out-of-character chỉ để tạo hiệu ứng.',
  '- Không retcon, không tự ý đổi quan hệ, luật thế giới, mốc thời gian, hay mức sức mạnh nếu task không yêu cầu rõ ràng.',
  '- BẮT BUỘC tôn trọng logic nhân quả: timeline/đếm ngược, án phạt/giam giữ, thương tích, lộ tu vi/bảo vật/năng lực, và phản ứng của nhân vật phụ/phía đối địch phải có hệ quả hợp lý.',
  '- Không AI-sounding: tránh triết lý rỗng, tổng kết đạo lý, lên lớp, lặp ý, hoặc văn quá phô nếu không có căn cứ.',
  '- Mỗi đoạn viết ra phải có tác dụng rõ: đẩy tình tiết, đào sâu cảm xúc, khắc họa nhân vật, tăng xung đột, hoặc giải phóng thông tin.',
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
