import { TASK_TYPES } from '../router';
import {
  NSFW_ROOT_COMMAND,
  NSFW_AUTHOR_DNA,
  NSFW_RELATION_MATRIX,
  NSFW_LOGIC_TARGET,
  NSFW_CHRONO_STRUCTURE,
} from '../../../utils/constants';

export const DEFAULT_NSFW_RULES = [
  NSFW_ROOT_COMMAND,
  NSFW_AUTHOR_DNA,
  NSFW_RELATION_MATRIX,
  NSFW_LOGIC_TARGET,
  NSFW_CHRONO_STRUCTURE,
].join('\n\n');

export function resolveNsfwRules(promptTemplates) {
  if (!promptTemplates || typeof promptTemplates !== 'object') {
    return DEFAULT_NSFW_RULES;
  }

  const baseRules = typeof promptTemplates.nsfw_system_prompt === 'string'
    && promptTemplates.nsfw_system_prompt.trim()
    ? promptTemplates.nsfw_system_prompt.trim()
    : DEFAULT_NSFW_RULES;

  const customRules = typeof promptTemplates.nsfw_rules === 'string'
    ? promptTemplates.nsfw_rules.trim()
    : '';

  if (!customRules) {
    return baseRules;
  }

  return [
    baseRules,
    '[LUẬT NSFW BỔ SUNG CỦA DỰ ÁN]',
    'Các luật dưới đây là phần bổ sung, được đọc SAU rule gốc mặc định và không được làm mất hiệu lực của rule gốc.',
    customRules,
  ].join('\n\n');
}

export function buildNsfwUserAnchor() {
  return [
    '[NHẮC LẠI ƯU TIÊN NSFW]',
    'Chế độ Trưởng thành đang BẬT. Hãy tuân thủ tuyệt đối block luật NSFW trong system prompt cho toàn bộ câu trả lời này.',
    'Không tự ý làm nhẹ, né tránh, làm sạch, hay đạo đức hóa nội dung nếu tác giả không yêu cầu rõ ràng.',
  ].join('\n');
}

export const DEFAULT_NSFW_INTIMATE_PROMPT = [
  '[BỔ SUNG CHO CẢNH THÂN MẬT / NỘI DUNG 18+]',
  'Nếu yêu cầu hiện tại đang viết cảnh thân mật, hãy xem đây là một cảnh trọng tâm có nhịp riêng, KHÔNG được lướt nhanh hay tóm tắt cho xong việc.',
  '1. Nhịp cảnh phải CHẬM và liên tục: triển khai theo từng beat nhỏ, từng chuyển biến nhỏ, từng thay đổi trong cảm xúc và quyền lực giữa các nhân vật.',
  '2. KHÔNG nhảy cóc trong cảnh. Mỗi chuyển biến thân mật phải có buildup, có phản ứng, có hệ quả ngay sau đó.',
  '3. KHÔNG viết kiểu tổng kết như "rồi họ quan hệ với nhau" hoặc lược cảnh bằng vài câu ngắn. Nếu cảnh đã bắt đầu, phải đẩy nó đến hết nhịp xúc cảm của cảnh.',
  '4. Luôn ưu tiên 4 lớp cùng lúc: cảm xúc, quyền lực / thế chủ động, căng thẳng, và dư âm sau mỗi beat.',
  '5. Sau mỗi đoạn thân mật, phải cho thấy sự đổi chuyển trong tâm lý, nhịp thở, thái độ, im lặng, nói chuyện, hoặc khoảng cách giữa hai bên. KHÔNG cắt ngang khi chưa có aftermath.',
  '6. Nếu cảnh có tính chất bí mật, hãy duy trì áp lực lộ bị phát hiện, dấu vết để lại, hệ quả xã hội, và nguy cơ bị lộ.',
  '7. Consent, boundary, intimacy progression, emotional aftermath và secrecy risk là continuity cứng. KHÔNG được viết mâu thuẫn với các ràng buộc đang có.',
  '8. Body/clothing/mark continuity phải nhất quán trong chính cảnh và với prose gần đây. Nếu trạng thái chưa đủ dữ liệu thì viết thận trọng, KHÔNG tự nhảy cóc phi lý.',
  '9. Trong cảnh 18+, ưu tiên "trải nghiệm đang diễn ra" hơn "kể lại sự việc". Độc giả phải cảm thấy cảnh đang mở ra theo thời gian thực.',
  '10. NHẬN DIỆN NGỮ CẢNH TRƯỚC KHI VIẾT: Xác định thể loại, giọng điệu, nhịp độ câu chuyện, mức căng thẳng hiện tại TRƯỚC khi bắt đầu cảnh thân mật. Chỉ mô tả chi tiết nhạy cảm khi diễn ra tự nhiên theo mạch truyện và tính cách nhân vật.',
  '11. KIỂM TRA NHÂN VẬT: Trước cảnh thân mật, xác định: trạng thái tâm lý hiện tại của từng nhân vật, mong muốn bề mặt vs nhu cầu sâu, điểm mù, và quỹ đạo phát triển. Nhân vật kín đáo phản ứng KHÁC nhân vật táo bạo ở cùng giai đoạn.',
  '12. VIẾT LIỀN MẠCH: Viết tiếp từ điểm kết thúc của "Ngữ cảnh trực tiếp". KHÔNG lặp lại đoạn cũ. KHÔNG tự ý tạo tiêu đề chương mới (ví dụ "Chương 2", "Chương tiếp theo"). KHÔNG tự ý tạo thêm nội dung ngoài yêu cầu của tác giả.',
  '13. KHÔNG tự ý kết thúc cảnh hay chuyển cảnh khi chưa hết nhịp xúc cảm. Nếu cần chuyển cảnh, phải có lý do tự nhiên và aftermath đầy đủ.',
].join('\n');

const NSFW_WRITING_TASKS = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.REWRITE,
  TASK_TYPES.EXPAND,
]);

function relationshipStatesFromPacket(relationshipContextPacket) {
  return [
    ...(relationshipContextPacket?.mustIncludeEdges || []),
    ...(relationshipContextPacket?.supportingEdges || []),
  ].map((edge) => ({
    character_a_id: edge.characterAId,
    character_b_id: edge.characterBId,
    intimacy_level: edge.intimacyLevel,
    consent_state: edge.consentState,
    secrecy_state: edge.secrecyState,
    emotional_aftermath: edge.emotionalAftermath,
  }));
}

function isLikelyIntimateRequest(taskType, userPrompt, sceneText, selectedText, retrievalPacket, relationshipContextPacket) {
  if (!NSFW_WRITING_TASKS.has(taskType)) return false;

  const promptText = [userPrompt, selectedText, sceneText]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const intimateHints = [
    '18+', 'nsfw', 'canh nong', 'than mat',
    'quan he', 'xac thit', 'an ai',
    'lam tinh', 'kieu dam', 'tinh duc',
  ];

  if (intimateHints.some((hint) => promptText.includes(hint))) {
    return true;
  }

  const packetStates = relationshipStatesFromPacket(relationshipContextPacket);
  const relationshipStates = packetStates.length > 0
    ? packetStates
    : (Array.isArray(retrievalPacket?.relevantRelationshipStates)
      ? retrievalPacket.relevantRelationshipStates
      : []);

  return relationshipStates.some((state) =>
    ['medium', 'high'].includes(String(state.intimacy_level || '').toLowerCase())
    || String(state.secrecy_state || '').toLowerCase() !== 'public'
    || !!String(state.emotional_aftermath || '').trim()
  );
}

export function buildNsfwIntimateSystemLayer(taskType, {
  userPrompt = '',
  sceneText = '',
  selectedText = '',
  retrievalPacket = null,
  relationshipContextPacket = null,
  promptTemplates = {},
}) {
  if (!isLikelyIntimateRequest(taskType, userPrompt, sceneText, selectedText, retrievalPacket, relationshipContextPacket)) {
    return '';
  }

  const basePrompt = typeof promptTemplates?.nsfw_intimate_prompt === 'string'
    && promptTemplates.nsfw_intimate_prompt.trim()
    ? promptTemplates.nsfw_intimate_prompt.trim()
    : DEFAULT_NSFW_INTIMATE_PROMPT;
  const lines = [basePrompt];

  const packetStates = relationshipStatesFromPacket(relationshipContextPacket);
  const relationshipStates = packetStates.length > 0
    ? packetStates
    : (Array.isArray(retrievalPacket?.relevantRelationshipStates)
      ? retrievalPacket.relevantRelationshipStates
      : []);

  const sensitiveStates = relationshipStates
    .filter((state) =>
      ['medium', 'high'].includes(String(state.intimacy_level || '').toLowerCase())
      || String(state.secrecy_state || '').toLowerCase() !== 'public'
      || !!String(state.emotional_aftermath || '').trim()
      || String(state.consent_state || '').toLowerCase() !== 'unknown'
    )
    .slice(0, 5);

  if (sensitiveStates.length > 0) {
    lines.push('');
    lines.push('[CONTINUITY THÂN MẬT ĐANG CÓ HIỆU LỰC]');
    sensitiveStates.forEach((state) => {
      const bits = [];
      bits.push('cặp #' + state.character_a_id + ' & #' + state.character_b_id);
      if (state.intimacy_level && state.intimacy_level !== 'none') bits.push('thân_mật=' + state.intimacy_level);
      if (state.consent_state && state.consent_state !== 'unknown') bits.push('đồng_thuận=' + state.consent_state);
      if (state.secrecy_state) bits.push('bí_mật=' + state.secrecy_state);
      if (state.emotional_aftermath) bits.push('dư_âm=' + state.emotional_aftermath);
      lines.push('- ' + bits.join(' | '));
    });
  }

  return lines.join('\n');
}
