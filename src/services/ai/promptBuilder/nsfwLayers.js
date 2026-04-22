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
    '[LUAT NSFW BO SUNG CUA DU AN]',
    'Cac luat duoi day la phan bo sung, duoc doc SAU rule goc mac dinh va khong duoc lam mat hieu luc cua rule goc.',
    customRules,
  ].join('\n\n');
}

export function buildNsfwUserAnchor() {
  return [
    '[NHAC LAI UU TIEN NSFW]',
    'Che do Truong thanh dang BAT. Hay tuan thu tuyet doi block luat NSFW trong system prompt cho toan bo cau tra loi nay.',
    'Khong tu y lam nhe, ne tranh, lam sach, hay dao duc hoa noi dung neu tac gia khong yeu cau ro rang.',
  ].join('\n');
}

export const DEFAULT_NSFW_INTIMATE_PROMPT = [
  '[BO SUNG CHO CANH THAN MAT / NOI DUNG 18+]',
  'Neu yeu cau hien tai dang viet canh than mat, hay xem day la mot canh trong tam co nhip rieng, KHONG duoc luot nhanh hay tom tat cho xong viec.',
  '1. Nhip canh phai CHAM va lien tuc: trien khai theo tung beat nho, tung chuyen bien nho, tung thay doi trong cam xuc va quyen luc giua cac nhan vat.',
  '2. KHONG nhay coc trong canh. Moi chuyen bien than mat phai co buildup, co phan ung, co he qua ngay sau do.',
  '3. KHONG viet kieu tong ket nhu "roi ho quan he voi nhau" hoac luoc canh bang vai cau ngan. Neu canh da bat dau, phai day no den het nhiep xuc cam cua canh.',
  '4. Luon uu tien 4 lop cung luc: cam xuc, quyen luc / the chu dong, cang thang, va du am sau moi beat.',
  '5. Sau moi doan than mat, phai cho thay su doi chuyen trong tam ly, nhip tho, thai do, im lang, noi chuyen, hoac khoang cach giua hai ben. KHONG cat ngang khi chua co aftermath.',
  '6. Neu canh co tinh chat bi mat, hay duy tri ap luc lo bi phat hien, dau vet de lai, he qua xa hoi, va nguy co bi lo.',
  '7. Consent, boundary, intimacy progression, emotional aftermath va secrecy risk la continuity cung. KHONG duoc viet mau thuan voi cac rang buoc dang co.',
  '8. Body/clothing/mark continuity phai nhat quan trong chinh canh va voi prose gan day. Neu trang thai chua du du lieu thi viet than trong, KHONG tu nhay coc phi ly.',
  '9. Trong canh 18+, uu tien "trai nghiem dang dien ra" hon "ke lai su viec". Doc gia phai cam thay canh dang mo ra theo thoi gian thuc.',
].join('\n');

const NSFW_WRITING_TASKS = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.REWRITE,
  TASK_TYPES.EXPAND,
]);

function isLikelyIntimateRequest(taskType, userPrompt, sceneText, selectedText, retrievalPacket) {
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

  const relationshipStates = Array.isArray(retrievalPacket?.relevantRelationshipStates)
    ? retrievalPacket.relevantRelationshipStates
    : [];

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
  promptTemplates = {},
}) {
  if (!isLikelyIntimateRequest(taskType, userPrompt, sceneText, selectedText, retrievalPacket)) {
    return '';
  }

  const basePrompt = typeof promptTemplates?.nsfw_intimate_prompt === 'string'
    && promptTemplates.nsfw_intimate_prompt.trim()
    ? promptTemplates.nsfw_intimate_prompt.trim()
    : DEFAULT_NSFW_INTIMATE_PROMPT;
  const lines = [basePrompt];

  const relationshipStates = Array.isArray(retrievalPacket?.relevantRelationshipStates)
    ? retrievalPacket.relevantRelationshipStates
    : [];

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
    lines.push('[CONTINUITY THAN MAT DANG CO HIEU LUC]');
    sensitiveStates.forEach((state) => {
      const bits = [];
      bits.push('cap #' + state.character_a_id + ' & #' + state.character_b_id);
      if (state.intimacy_level && state.intimacy_level !== 'none') bits.push('than_mat=' + state.intimacy_level);
      if (state.consent_state && state.consent_state !== 'unknown') bits.push('dong_thuan=' + state.consent_state);
      if (state.secrecy_state) bits.push('bi_mat=' + state.secrecy_state);
      if (state.emotional_aftermath) bits.push('du_am=' + state.emotional_aftermath);
      lines.push('- ' + bits.join(' | '));
    });
  }

  return lines.join('\n');
}

