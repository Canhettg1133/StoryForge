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
    'Chế độ Trưởng thành đang BẬT: được phép xử lý nội dung người lớn khi tác giả hoặc cảnh hiện tại yêu cầu, nhưng không tự biến mọi cảnh thành 18+.',
    'Nếu yêu cầu hiện tại không phải cảnh thân mật, hãy viết như truyện bình thường và chỉ giữ continuity người lớn ở mức nền.',
    'Không tự ý làm nhẹ, né tránh, làm sạch, hay đạo đức hóa nội dung nếu tác giả không yêu cầu rõ ràng.',
  ].join('\n');
}

export const DEFAULT_NSFW_INTIMATE_PROMPT = [
  '[BỔ SUNG CHO CẢNH THÂN MẬT / NỘI DUNG 18+]',
  'Chỉ áp dụng phần này khi yêu cầu hoặc cảnh hiện tại thật sự đang viết cảnh thân mật/18+. Nếu cảnh chỉ là đối thoại, điều tra, chiến đấu, sinh hoạt hoặc bàn kế hoạch, hãy giữ nó là cảnh thường và không tự bẻ sang 18+.',
  'Nếu yêu cầu hiện tại đang viết cảnh thân mật, hãy xem đây là một cảnh trọng tâm có nhịp riêng, KHÔNG được lướt nhanh hay tóm tắt cho xong việc.',
  '1. Nhịp cảnh đi theo logic nhân vật và tone truyện: có thể chậm, dồn, ngập ngừng hoặc căng tùy tình huống; không áp một công thức nhịp cố định cho mọi cảnh.',
  '2. KHÔNG nhảy cóc trong cảnh. Mỗi chuyển biến thân mật phải có buildup, có phản ứng, có hệ quả ngay sau đó.',
  '3. Nhân vật không tự động sẵn sàng, không tự động dễ bị nhân vật chính cuốn đi; mức độ đáp lại phải đi từ tính cách, lịch sử quan hệ, ham muốn, nỗi sợ, ranh giới, địa vị, mục tiêu và hoàn cảnh trước mắt.',
  '4. Không dùng phản ứng cơ thể như một công tắc. Ham muốn, kích thích, do dự, né tránh hoặc đồng thuận phải có nguyên nhân đọc được trong cảnh; tránh lạm dụng mô tả ướt át/dịch thể khi chưa có tích lũy cảm xúc và thân thể đủ thuyết phục.',
  '5. Ưu tiên cân bằng các lớp quan trọng của cảnh: cảm xúc, quyền lực / thế chủ động, căng thẳng, và dư âm sau mỗi beat; lớp nào nổi hơn phải tùy nhân vật và mục tiêu cảnh.',
  '6. Sau mỗi đoạn thân mật, cho thấy sự đổi chuyển trong tâm lý, nhịp thở, thái độ, im lặng, nói chuyện, hoặc khoảng cách giữa hai bên. KHÔNG cắt ngang khi chưa có aftermath hợp lý.',
  '7. Nếu cảnh có tính chất bí mật, hãy duy trì áp lực bị phát hiện, dấu vết để lại, hệ quả xã hội, và nguy cơ bị lộ ở mức phù hợp với tone.',
  '8. Consent, boundary, intimacy progression, emotional aftermath và secrecy risk là continuity cứng. KHÔNG được viết mâu thuẫn với các ràng buộc đang có.',
  '9. Body/clothing/mark continuity phải nhất quán trong chính cảnh và với prose gần đây. Nếu trạng thái chưa đủ dữ liệu thì viết thận trọng, KHÔNG tự nhảy cóc phi lý.',
  '10. Trong cảnh 18+, ưu tiên "trải nghiệm đang diễn ra" hơn "kể lại sự việc". Độc giả phải cảm thấy cảnh đang mở ra theo thời gian thực, nhưng không kéo dài bằng lặp từ hoặc phóng đại sinh lý.',
  '11. NHẬN DIỆN NGỮ CẢNH TRƯỚC KHI VIẾT: Xác định thể loại, giọng điệu, nhịp độ câu chuyện, mức căng thẳng hiện tại TRƯỚC khi bắt đầu cảnh thân mật. Chỉ mô tả chi tiết nhạy cảm khi diễn ra tự nhiên theo mạch truyện và tính cách nhân vật.',
  '12. KIỂM TRA NHÂN VẬT: Trước cảnh thân mật, xác định trạng thái tâm lý hiện tại của từng nhân vật, mong muốn bề mặt vs nhu cầu sâu, điểm mù, và quỹ đạo phát triển. Nhân vật kín đáo phản ứng KHÁC nhân vật táo bạo ở cùng giai đoạn.',
  '13. VIẾT LIỀN MẠCH: Viết tiếp từ điểm kết thúc của "Ngữ cảnh trực tiếp". KHÔNG lặp lại đoạn cũ. KHÔNG tự ý tạo tiêu đề chương mới (ví dụ "Chương 2", "Chương tiếp theo"). KHÔNG tự ý tạo thêm nội dung ngoài yêu cầu của tác giả.',
  '14. KHÔNG tự ý kết thúc cảnh hay chuyển cảnh khi chưa hết nhịp xúc cảm. Nếu cần chuyển cảnh, phải có lý do tự nhiên và aftermath đầy đủ.',
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

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function isLikelyIntimateRequest(taskType, userPrompt, sceneText, selectedText) {
  if (!NSFW_WRITING_TASKS.has(taskType)) return false;

  const promptText = [userPrompt, selectedText, sceneText]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  const normalizedPromptText = normalizeForSearch(promptText);

  const intimateHints = [
    '18+', 'nsfw', 'canh 18', 'canh nong', 'than mat',
    'quan he', 'xac thit', 'an ai',
    'lam tinh', 'kieu dam', 'tinh duc',
    'sex', 'giuong chieu',
  ];

  if (intimateHints.some((hint) => normalizedPromptText.includes(hint))) {
    return true;
  }

  return false;
}

export function buildNsfwIntimateSystemLayer(taskType, {
  userPrompt = '',
  sceneText = '',
  selectedText = '',
  retrievalPacket = null,
  relationshipContextPacket = null,
  promptTemplates = {},
}) {
  if (!isLikelyIntimateRequest(taskType, userPrompt, sceneText, selectedText)) {
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
