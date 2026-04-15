/**
 * StoryForge - Prompt Builder v3 (Phase 4)
 *
 * Layer architecture:
 *   0.   Grand Strategy (Phase 9) — đại cục + hồi truyện hiện tại
 *        CHỈ inject cho writing tasks khi có dữ liệu macro arc / arc
 *   1.   System Identity
 *   2.   Task Instruction
 *   3.   Genre / AI Guidelines (editable, pre-filled from genre)
 *   4.   Canon Context (world profile, terms, locations, objects, canon facts)
 *   4.2  Chapter Outline (Phase 8) — nhiệm vụ chương hiện tại + fence chương sau
 *        CHỈ inject cho writing tasks
 *   4.5  Pacing Control
 *   5.   Character State (characters + pronouns + relationships + taboos)
 *   5.5  Bridge Memory (Phase 7) — prose buffer + emotional state từ chương trước
 *        CHỈ inject cho writing tasks: CONTINUE, EXPAND, REWRITE, SCENE_DRAFT, ARC_CHAPTER_DRAFT
 *   6.   Scene Contract (goal, conflict, must/must-not, pacing)
 *   7.   Style Pack (placeholder - Phase 5)
 *   8.   Output Format
 */

import { TASK_TYPES } from './router';
import { getStoryCreationSettings } from './storyCreationSettings';
import {
  PRONOUN_PRESETS,
  GENRE_PRONOUN_MAP,
  AUTHOR_ROLE_TABLE,
  MOOD_BOARD_DEFAULTS,
  detectWritingStyle,
  NSFW_ROOT_COMMAND,
  NSFW_AUTHOR_DNA,
  NSFW_RELATION_MATRIX,
  NSFW_LOGIC_TARGET,
  NSFW_CHRONO_STRUCTURE,
  ANTI_AI_BLACKLIST,
} from '../../utils/constants';

export const DEFAULT_NSFW_RULES = [
  NSFW_ROOT_COMMAND,
  NSFW_AUTHOR_DNA,
  NSFW_RELATION_MATRIX,
  NSFW_LOGIC_TARGET,
  NSFW_CHRONO_STRUCTURE,
].join('\n\n');

function resolveNsfwRules(promptTemplates) {
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

function buildNsfwUserAnchor() {
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
    '18+', 'nsfw', 'canh nong', 'cảnh nóng', 'than mat', 'thân mật',
    'quan he', 'quan hệ', 'xac thit', 'xác thịt', 'ân ái', 'an ai',
    'lam tinh', 'làm tình', 'kieu dam', 'khiêu dâm', 'tinh duc', 'tình dục',
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

function buildNsfwIntimateSystemLayer(taskType, {
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

// =============================================
// Layer 1: System Identity
// =============================================
export const DEFAULT_LAYER_1_IDENTITY = [
  'Ban la dong bien tap vien truyen chu chuyen nghiep trong ung dung StoryForge.',
  'Ban uu tien so 1 la tinh nhat quan (consistency), giong van rieng cua tac pham, va logic noi tai cua the gioi truyen.',
  'Ban viet bang tieng Viet tru khi duoc yeu cau khac.',
  'Ban KHONG tu y them meta-commentary, ghi chu, hay giai thich du thua - chi tra ve dung noi dung task can.',
  'Ban PHAI tuan thu tuyet doi moi taboo, blacklist, va quy tac an toan duoc cung cap.',
  'Ban KHONG duoc tu y tao ra nhan vat, dia danh, ky nang, he thong suc manh, hay bat ky thuc the nao CHUA DUOC liet ke trong Canon hoac The Gioi truyen — tru khi tac gia yeu cau ro rang hoac task la brainstorm/outline/project_wizard.',
].join('\n');

function resolveSystemIdentityPrompt() {
  try {
    const settings = getStoryCreationSettings();
    const customPrompt = settings?.writingSystemIdentity?.systemPrompt;
    if (typeof customPrompt === 'string' && customPrompt.trim()) {
      return customPrompt.trim();
    }
  } catch {
    // Fall back to built-in identity when local settings are unavailable.
  }

  return DEFAULT_LAYER_1_IDENTITY;
}

// =============================================
// Writing tasks — 3 mức injection
//
// FULL_WRITING: Author DNA đầy đủ + Style DNA + Mood Board + Priority Anchor
//   → AI tự do sáng tác, cần định hướng cảm xúc và vai trò đầy đủ
//
// STYLE_ONLY: Chỉ Style DNA + Mood Board + Priority Anchor nhẹ
//   → AI làm việc với text đã có, không được "kéo" cảm xúc theo hướng mới
//   → EXPAND: giữ nguyên hướng, chỉ làm phong phú
//   → REWRITE: giữ nguyên nội dung, chỉ nâng câu chữ
//
// Dùng chung cho Layer 0, 4.2, 5.5:
// =============================================
const WRITING_TASKS_FOR_BRIDGE = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT,
]);

// Full injection: AI tự do sáng tác từ đầu
const FULL_WRITING_TASKS = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT, // Re-enabled for high quality chat
]);

// Style-only injection: AI làm việc với text đã có
const STYLE_ONLY_TASKS = new Set([
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
]);

const WRITING_DISCIPLINE_TASKS = new Set([
  TASK_TYPES.CONTINUE,
  TASK_TYPES.SCENE_DRAFT,
  TASK_TYPES.ARC_CHAPTER_DRAFT,
  TASK_TYPES.FREE_PROMPT,
  TASK_TYPES.EXPAND,
  TASK_TYPES.REWRITE,
  TASK_TYPES.STYLE_WRITE,
]);

const DEFAULT_WRITING_DISCIPLINE_LAYER = [
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
// Writing requests → full Author DNA + Style DNA injection
// Questions/chat → lightweight (Canon + Characters only)
// =============================================
function isWritingIntent(userPrompt) {
  if (!userPrompt) return true; // No prompt = likely continuation
  const lower = userPrompt.toLowerCase();
  // Question patterns → NOT writing
  if (lower.includes('?')) return false;
  const chatPatterns = ['la gi', 'giai thich', 'tai sao', 'the nao', 'bao nhieu',
    'dat ten', 'goi y ten', 'liet ke', 'so sanh', 'phan tich', 'cho toi biet',
    'giup toi', 'hay cho', 'la sao', 'nhu the nao', 'o dau', 'khi nao'];
  if (chatPatterns.some(function(p) { return lower.includes(p); })) return false;
  // Default: treat as writing (over-inject is better than under-inject for creative tasks)
  return true;
}

// =============================================
// Layer 2: Task Instructions
// =============================================
const PLANNING_AND_CANON_TASK_PREFIX = [
  'Ban la tro ly AI chuyen xu ly planning, canon va kiem tra logic cho StoryForge.',
  'Tra loi truc tiep, day du, chi tiet va bam dung nhiem vu duoc giao.',
  'Khong them loi mo dau, khong vong vo, khong them canh bao hay giai thich du thua neu khong duoc yeu cau.',
  'Uu tien toi da: dung nhiem vu, dung dinh dang dau ra, dung canon va co the dung lai ket qua trong he thong.',
  'Neu du lieu chua du, hay tra loi than trong va chi neu gia dinh khi thuc su can.',
].join('\n');

function withPlanningAndCanonPrefix(instruction) {
  return [PLANNING_AND_CANON_TASK_PREFIX, instruction].join('\n\n');
}

export const TASK_INSTRUCTIONS = {
  [TASK_TYPES.CONTINUE]: 'Viet tiep doan van, giu nguyen giong van va nhip ke. Hay mieu ta that chi tiet tung hanh dong, tam ly, canh vat, doi thoai. Viet DAI va CHI TIET, muc tieu 2000-4000 tu de dong gop vao muc tieu chuong truyen 7000 tu. KHONG viet ngan, KHONG luoc bo, KHONG tom tat. KHONG duoc nhay thoi gian (time skip) — moi su kien phai dien ra LIEN TUC tu vi tri cuoi cung, cam viet kieu "Ba ngay sau...", "Mot thoi gian troi qua...", "Khong lau sau...". Neu can chuyen canh, hay ket thuc canh hien tai bang cliffhanger roi mo canh moi tu nhien.',
  [TASK_TYPES.REWRITE]: 'Viet lai doan van, cai thien van phong nhung GIU NGUYEN noi dung, cot truyen va y nghia. Lam cho no tu nhien hon, giau cam xuc hon, nhip dieu tot hon. GIU do dai TUONG DUONG doan goc (cho phep dai hon 20-50% de them mieu ta cam xuc va chi tiet ngu giac). TUYET DOI KHONG tu y them su kien moi, nhan vat moi, dia danh moi, hay thay doi dien bien — chi nang cap cau van, nhip dieu, va chieu sau cam xuc.',
  [TASK_TYPES.EXPAND]: 'Mo rong doan van GAP 3-5 LAN do dai goc. Giu nguyen giong van va mach truyen. Them vao: mieu ta ngu giac (nhin/nghe/ngui/cham/vi), noi tam nhan vat, doi thoai tu nhien, va hanh dong cham (slow motion). KHONG duoc them su kien moi hay thay doi cot truyen — chi lam PHONG PHU nhung gi da co. Dao sau vao tam ly nhan vat (ho nghi gi, so gi, muon gi trong khoang khac do), boi canh (am thanh, mui, anh sang, nhiet do), va tung cu dong nho.',
  [TASK_TYPES.BRAINSTORM]: withPlanningAndCanonPrefix([
    'Brainstorm 5 y tuong KHAC BIET cho tinh huong dang xet. Moi y tuong gom:',
    '1. Tom tat huong di (2-3 cau)',
    '2. Xung dot chinh se la gi — nhan vat doi mat voi thach thuc/mat mat gi',
    '3. Nhan vat nao bi anh huong nhieu nhat va thay doi nhu the nao',
    '4. Diem hay: tai sao huong nay hap dan doc gia',
    '5. Rui ro: diem nao co the bi nhat/chen ep neu khong xu ly tot',
    '',
    'Sap xep tu AN TOAN nhat (theo logic truyen) den TAO BAO nhat (bat ngo nhung van hop ly).',
    'KHONG chon y tuong chung chung kieu "nhan vat manh len". Moi y tuong phai co XUNG DOT that su va HE QUA ro rang.',
  ].join('\n')),
  [TASK_TYPES.OUTLINE]: withPlanningAndCanonPrefix([
    'Tao outline CHI TIET 5-8 diem chinh cho chuong/phan tiep theo. Moi diem bao gom:',
    '- Su kien/hanh dong CU THE (khong chung chung kieu "nhan vat chien dau" — ma phai la "nhan vat bi don vao the ket, phai chon giua mat mang hoac phan boi...")',
    '- Cam xuc nhan vat chuyen bien nhu the nao qua su kien do',
    '- Lien ket voi tuyen truyen nao dang mo (neu co)',
    '',
    'Outline phai co 3 phan:',
    '- HOOK: diem cuon hut o dau — doc gia doc dong dau tien phai muon doc tiep',
    '- ESCALATION: tang dan cang thang va do phuc tap qua tung diem',
    '- CLIFFHANGER: ket mo bang cau hoi/tinh huong khien doc gia khong the ngu duoc',
  ].join('\n')),
  [TASK_TYPES.PLOT_SUGGEST]: withPlanningAndCanonPrefix('Goi y 3 huong plot co the xay ra tiep theo. Moi huong gom: tom tat, xung dot, va dieu gi se thay doi.'),
  [TASK_TYPES.SUMMARIZE]: 'Tom tat noi dung trong khoang 150-200 tu, giu cac su kien chinh, thay doi quan trong, va trang thai nhan vat.',
  [TASK_TYPES.EXTRACT_TERMS]: 'Trich xuat: 1) Ten nhan vat (va vai tro), 2) Dia danh, 3) Vat pham quan trong, 4) Thuat ngu the gioi truyen. Tra ve dang danh sach.',
  [TASK_TYPES.SCENE_DRAFT]: 'Viet ban nhap canh nay, mo ta sau vao tung cu chi tam ly. Viet khoang 2000-4000 tu/lan sinh de dong gop vao muc tieu chuong truyen tong cong 7000 tu. CANG DAI CANG TOT.',
  [TASK_TYPES.CHECK_CONFLICT]: withPlanningAndCanonPrefix([
    'Phan tich noi dung chuong/canh de tim ra Mau Thuan (Conflict) so voi Su That Canon, Trang Thai Nhan Vat, va Thong Tin The Gioi.',
    'Chi chi ra nhung mau thuan ro rang voi cac thong tin duoc cung cap, KHONG bat be nhung tieu tiet khong quan trong.',
    '',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "conflicts": [',
    '    {',
    '      "type": "canon_conflict | character_conflict | timeline_conflict",',
    '      "severity": "high | medium | low",',
    '      "description": "Mo ta chi tiet mau thuan bang tieng Viet",',
    '      "suggestion": "Goi y cach sua (Neu co)"',
    '    }',
    '  ]',
    '}',
    '',
    'Neu khong phat hien mau thuan nao, tra ve: {"conflicts": []}',
    'Chi tra ve JSON, KHONG tra ve bat ky ki tu la nao khac, KHONG dung markdown code blocks.',
  ].join('\n')),
  [TASK_TYPES.CONTINUITY_CHECK]: withPlanningAndCanonPrefix([
    'Kiem tra tinh nhat quan cua noi dung voi canon, logic nhan vat, trinh tu su kien va rang buoc the gioi.',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "issues": [',
    '    {',
    '      "type": "canon|character|timeline|item|relationship|world_rule",',
    '      "severity": "high|medium|low",',
    '      "description": "Mo ta van de bang tieng Viet",',
    '      "suggestion": "Neu co, de xuat cach sua ngan gon"',
    '    }',
    '  ]',
    '}',
    'Neu khong co van de, tra ve {"issues":[]}. Chi tra ve JSON.',
  ].join('\n')),
  [TASK_TYPES.FREE_PROMPT]: 'Thuc hien yeu cau cua tac gia. Neu duoc yeu cau viet noi dung truyen, hay viet CUC KY CHI TIET: mieu ta hanh dong, tam ly, doi thoai, canh vat. Muc tieu toi thieu 5000-7000 tu cho ca chuong. Moi phan tra ve phai dai it nhat 3000-4000 tu.',
  [TASK_TYPES.CHAPTER_SUMMARY]: 'Tom tat chuong nay trong khoang 150-200 tu. Bao gom: su kien chinh, thay doi quan trong, nhan vat xuat hien, va trang thai ket thuc. Chi tra ve tom tat, khong them tieu de hay ghi chu.',
  [TASK_TYPES.FEEDBACK_EXTRACT]: withPlanningAndCanonPrefix([
    'Phan tich doan van va trich xuat thong tin moi duoi dang JSON. Tra ve CHINH XAC format nay:',
    '{',
    '  "characters": [{"name": "...", "role": "...", "appearance": "...", "personality": "...", "personality_tags": "tag1, tag2", "flaws": "diem yeu / khuyet diem"}],',
    '  "locations": [{"name": "...", "description": "..."}],',
    '  "terms": [{"name": "...", "definition": "...", "category": "..."}],',
    '  "objects": [{"name": "...", "description": "...", "owner": "..."}]',
    '}',
    'Chi liet ke thong tin MOI xuat hien. Neu khong co gi moi, tra ve mang rong. Chi tra ve JSON, khong them gi khac.',
  ].join('\n')),
  [TASK_TYPES.STYLE_ANALYZE]: [
    'Phan tich van phong cua doan van duoc cung cap.',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "tone": "giong dieu chinh",',
    '  "pacing": "slow|medium|fast",',
    '  "voice": "dac diem giong ke chuyen",',
    '  "strengths": ["diem manh 1", "diem manh 2"],',
    '  "watchouts": ["diem can de y 1", "diem can de y 2"],',
    '  "style_notes": ["ghi chu van phong 1", "ghi chu van phong 2"]',
    '}',
    'Chi tra ve JSON.',
  ].join('\n'),
  [TASK_TYPES.STYLE_WRITE]: [
    'Viet noi dung moi theo van phong mau duoc cung cap.',
    'Giu nhat quan ve giong ke, nhac cau, muc do mieu ta va sac thai cam xuc.',
    'Neu co yeu cau cua tac gia, uu tien yeu cau do nhung van bam sat van phong mau.',
    'Chi tra ve noi dung can viet, khong them giai thich.',
  ].join('\n'),
  [TASK_TYPES.QA_CHECK]: [
    'Ra soat chat luong doan van/chuong ve logic, dien dat, pacing, lap y, va loi de doc.',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "issues": [',
    '    {',
    '      "type": "logic|canon|clarity|style|pacing|grammar",',
    '      "severity": "high|medium|low",',
    '      "description": "Van de cu the",',
    '      "suggestion": "Cach sua ngan gon"',
    '    }',
    '  ]',
    '}',
    'Neu on, tra ve {"issues":[]}. Chi tra ve JSON.',
  ].join('\n'),
  [TASK_TYPES.AI_GENERATE_ENTITY]: [
    'Tao thuc the moi cho du an dua tren yeu cau cua tac gia va boi canh hien co.',
    'Chi tao nhung gi PHU HOP voi the loai, canon, va muc dich cot truyen.',
    'Tra ve CHINH XAC JSON theo schema duoc chi ro trong user prompt. Khong them bat ky text nao ngoai JSON.',
    'Khong duoc tao trung ten, trung vai tro, hay mot thuc the "dep de co" nhung khong dong gop gi cho truyen.',
  ].join('\n'),
  [TASK_TYPES.PROJECT_WIZARD]: [
    'Dua tren the loai va y tuong, tao blueprint cho du an truyen. Tra ve CHINH XAC JSON format:',
    '{',
    '  "premise": "Tom tat premise 2-3 cau",',
    '  "characters": [{"name": "...", "role": "protagonist|antagonist|supporting|mentor|minor", "appearance": "mo ta ngan", "personality": "mo ta ngan", "personality_tags": "tag1, tag2", "flaws": "diem yeu / khuyet diem", "goals": "muc tieu"}],',
    '  "locations": [{"name": "...", "description": "mo ta ngan"}],',
    '  "terms": [{"name": "...", "definition": "...", "category": "magic|organization|race|technology|other"}],',
    '  "chapters": [{"title": "Chuong 1: ...", "summary": "Tom tat noi dung chuong"}]',
    '}',
    'Tao 3-5 nhan vat, 3-5 dia diem, 3-5 thuat ngu, va 8-12 chuong. Chi tra ve JSON.',
  ].join('\n'),

  // Phase A — Suggestion Inbox
  [TASK_TYPES.SUGGEST_UPDATES]: withPlanningAndCanonPrefix([
    'Phan tich noi dung chuong va so sanh voi trang thai hien tai cua cac nhan vat + su that canon hien co.',
    'De xuat nhung THAY DOI MOI xay ra trong chuong nay. Chi de xuat khi co bang chung ro rang trong van ban.',
    '',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "character_updates": [',
    '    {',
    '      "character_name": "Ten nhan vat",',
    '      "old_status": "Trang thai cu (hoac rong neu chua co)",',
    '      "new_status": "Trang thai moi sau chuong nay",',
    '      "reasoning": "Ly do thay doi (1 cau ngan)"',
    '    }',
    '  ],',
    '  "new_canon_facts": [',
    '    {',
    '      "description": "Mo ta su that / bi mat / quy tac",',
    '      "fact_type": "fact | secret | rule",',
    '      "reasoning": "Tai sao day la su that quan trong (1 cau ngan)"',
    '    }',
    '  ]',
    '}',
    '',
    'Quy tac:',
    '- CHI de xuat thay doi trang thai khi co su kien RO RANG (bi thuong, chuyen dia diem, thay doi cam xuc lon, nhan duoc vat pham, mat mat...).',
    '- CHI de xuat canon fact MOI chua co trong danh sach hien tai.',
    '- KHONG de xuat nhung dieu da biet hoac qua hien nhien.',
    '- Moi de xuat phai co reasoning cu the.',
    '- Neu khong co gi moi, tra ve mang rong.',
    '- Chi tra ve JSON, KHONG them gi khac.',
  ].join('\n')),

  [TASK_TYPES.CANON_EXTRACT_OPS]: withPlanningAndCanonPrefix([
    'Phan tich noi dung chuong va trich xuat CAC THAY DOI CANON co bang chung ro rang duoi dang JSON typed operations.',
    'Chi trich xuat khi su kien thuc su xay ra trong van ban. KHONG doan, KHONG suy dien xa.',
    'Neu khong map chac chan duoc vao nhan vat, dia diem, tuyen truyen hoac bi mat da co san, THI BO QUA op do.',
    'Chi tra ve op khi confidence toi thieu 0.55. Neu mo ho, KHONG tra ve.',
    'Khong lap lai cung mot thay doi canon bang nhieu op giong nhau trong cung mot chapter.',
    'Voi canh nguoi lon / noi dung truong thanh, CHI trich xuat HE QUA canon ro rang: thay doi quan he, bi mat bi lo, doi muc tieu, doi trang thai, vat/luat/su that moi. KHONG suy dien them tinh tiet neu van ban khong noi ro.',
    'Chi dung cac op_type sau:',
    '- CHARACTER_STATUS_CHANGED',
    '- CHARACTER_LOCATION_CHANGED',
    '- CHARACTER_RESCUED',
    '- CHARACTER_DIED',
    '- SECRET_REVEALED',
    '- GOAL_CHANGED',
    '- ALLEGIANCE_CHANGED',
    '- THREAD_OPENED',
    '- THREAD_PROGRESS',
    '- THREAD_RESOLVED',
    '- FACT_REGISTERED',
    '- OBJECT_STATUS_CHANGED',
    '- OBJECT_TRANSFERRED',
    '- OBJECT_CONSUMED',
    '- RELATIONSHIP_STATUS_CHANGED',
    '- RELATIONSHIP_SECRET_CHANGED',
    '- INTIMACY_LEVEL_CHANGED',
    '',
    'Tra ve CHINH XAC JSON format:',
    '{',
    '  "ops": [',
    '    {',
    '      "op_type": "CHARACTER_DIED",',
    '      "scene_index": 1,',
    '      "subject_name": "Ten nhan vat",',
    '      "target_name": "",',
    '      "location_name": "",',
    '      "thread_title": "",',
    '      "fact_description": "",',
    '      "object_name": "",',
    '      "summary": "Tom tat thay doi canon trong 1 cau ngan",',
    '      "confidence": 0.0,',
    '      "evidence": "Trich dan ngan tu van ban lam bang chung",',
    '      "payload": {}',
    '    }',
    '  ]',
    '}',
    '',
    'Quy tac:',
    '- scene_index la so thu tu canh trong danh sach canh duoc cung cap.',
    '- confidence trong khoang 0 den 1.',
    '- Op doi vi tri phai co location_name ro rang.',
    '- Op thread phai dung dung thread_title da co san.',
    '- Op SECRET_REVEALED phai chi vao mot secret da co trong canonFacts.',
    '- Op FACT_REGISTERED chi dung cho su that/quy tac/bi mat MOI, mo ta ngan gon, cu the.',
    '- Op vat pham phai co object_name ro rang.',
    '- Op quan he/than mat phai map duoc ca subject_name va target_name.',
    '- KHONG tao op neu bang chung yeu.',
    '- KHONG tra ve bat ky text nao ngoai JSON.',
  ].join('\n')),

  [TASK_TYPES.CANON_REPAIR]: withPlanningAndCanonPrefix([
    'Sua lai noi dung chuong de loai bo cac loi continuity duoc liet ke.',
    'GIU toi da noi dung goc, chi sua nhung cho can sua de pass validator.',
    'Khong them mo ta meta, khong liet ke buoc, chi tra ve ban van da sua.',
  ].join('\n')),

  [TASK_TYPES.ARC_OUTLINE]: withPlanningAndCanonPrefix([
    'Tao dan y chi tiet cho mot dot chuong moi (Story Arc).',
    'Dua tren muc tieu cua Arc, tom tat chuong truoc, va cac tuyen truyen dang mo,',
    'tao ra danh sach cac chuong voi tieu de va tom tat ngan (2-3 cau).',
    '',
    'QUY TAC NGHIEM NGAT:',
    '- KHONG giai quyet bat ky tuyen truyen CHINH nao tru khi duoc chi dinh ro.',
    '- KHONG de nhan vat dat duoc muc tieu cuoi cung cua truyen.',
    '- Moi chuong phai co xung dot nho hoac kham pha moi de duy tri su hap dan.',
    '- Nhip do theo chi dinh cua tac gia (cham/trung binh/nhanh).',
    '- Tang dan do phuc tap va cang thang theo tien trinh Arc.',
    '- BAT BUOC tiep noi truc tiep sau chapter hien co; KHONG duoc reset ve Chuong 1.',
    '- KHONG lap lai su kien, thong tin tiet lo, xung dot, hay ket qua da xay ra trong cac chuong da co.',
    '- Moi chuong moi phai day cau chuyen tien len it nhat 1 thay doi moi, 1 he qua moi, hoac 1 quyet dinh moi.',
    '',
    'Tra ve CHINH XAC JSON format:',
    '{',
    '  "arc_title": "Ten Arc/Quyen",',
    '  "chapters": [',
    '    {',
    '      "title": "Chuong X: Tieu de",',
    '      "summary": "Tom tat 2-3 cau ve noi dung chuong",',
    '      "key_events": ["Su kien 1", "Su kien 2"],',
    '      "pacing": "slow|medium|fast"',
    '    }',
    '  ]',
    '}',
    'Chi tra ve JSON, KHONG them gi khac.',
  ].join('\n')),

  [TASK_TYPES.ARC_CHAPTER_DRAFT]: [
    'Viet noi dung chi tiet cho DUNG 1 chuong dua tren dan y da cho.',
    'Bam sat tom tat va su kien chinh cua chuong nay.',
    'Viet cuc ky chi tiet: hanh dong, tam ly, doi thoai, mieu ta canh vat.',
    'Muc tieu: 5000-7000 tu.',
    'KHONG tu y them su kien ngoai dan y.',
    'KHONG duoc viet lai thanh canh chinh nhung gi da xay ra o cac chuong truoc; chi duoc nhac lai rat ngan neu can.',
    'Moi canh phai la he qua tiep noi tu chuong truoc va day tinh hinh sang trang thai moi.',
    'Chi tra ve noi dung chuong, KHONG them tieu de hay ghi chu.',
  ].join('\n'),
  [TASK_TYPES.GENERATE_MACRO_MILESTONES]: withPlanningAndCanonPrefix([
    'Hoach dinh 5-8 cot moc dai cuc cho toan bo truyen, moi cot moc la mot diem ngoat LON cua hanh trinh.',
    'Can phan bo hop ly theo tong do dai du kien, co leo thang, khung hoang, dao chieu va tra gia ro rang.',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "milestones": [',
    '    {',
    '      "order": 1,',
    '      "title": "Ten cot moc",',
    '      "description": "Mo ta 2-3 cau",',
    '      "chapter_from": 1,',
    '      "chapter_to": 80,',
    '      "emotional_peak": "Cam xuc can dat"',
    '    }',
    '  ]',
    '}',
    'Chi tra ve JSON.',
  ].join('\n')),
  [TASK_TYPES.AUDIT_ARC_ALIGNMENT]: withPlanningAndCanonPrefix([
    'Kiem tra do lech giua nhung chuong gan day va dai cuc/arc hien tai.',
    'Chi ra do lech cu the, khong noi chung chung.',
    'Tra ve CHINH XAC JSON format sau:',
    '{',
    '  "aligned": true,',
    '  "drift_score": 0,',
    '  "issues": ["Van de 1"],',
    '  "suggestions": ["De xuat 1"],',
    '  "current_position": "Tom ta vi tri hien tai cua truyen trong 1 cau"',
    '}',
    'Chi tra ve JSON.',
  ].join('\n')),
};

// =============================================
// Layer 0: Grand Strategy (Phase 9)
// Inject trước tất cả các layer khác để AI luôn
// "nhìn thấy bản đồ" trước khi bắt đầu viết.
//
// Lý do đặt Layer 0 (trước Layer 1):
//   LLM chú ý nhiều nhất vào đầu và cuối prompt.
//   Grand Strategy ở đầu = AI không bao giờ "quên" đại cục dù context dài.
//
// Chỉ inject khi:
//   1. Là writing task
//   2. Có ít nhất một trong: currentArc hoặc currentMacroArc
// =============================================

/**
 * Build Layer 0 — Grand Strategy & Pacing (merged).
 * Combines old Layer 0 (Grand Strategy) + old Layer 4.5 (Pacing Control)
 * into a single unified layer. Deduplicates "don't resolve early" constraints.
 *
 * Triggers when any of these exist: macroArc, arc, or pacing info.
 *
 * @param {string}      taskType
 * @param {object|null} currentMacroArc
 * @param {object|null} currentArc
 * @param {string}      ultimateGoal
 * @param {number}      targetLength
 * @param {number}      currentChapterIndex
 * @param {Array}       milestones
 * @returns {string}
 */
function buildGrandStrategyLayer(
  taskType,
  currentMacroArc,
  currentArc,
  ultimateGoal,
  targetLength,
  currentChapterIndex,
  milestones
) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  var hasArcInfo = currentMacroArc || currentArc;
  var hasPacingInfo = targetLength > 0 && ultimateGoal;
  if (!hasArcInfo && !hasPacingInfo) return '';

  var parts = [];

  // Progress overview (merged from old Layer 4.5)
  if (hasPacingInfo) {
    var progressPercent = Math.round((currentChapterIndex / targetLength) * 100);
    var progressLines = [];
    progressLines.push('Truyen du kien dai ' + targetLength + ' chuong. Hien tai: chuong ' + (currentChapterIndex + 1) + ' (' + progressPercent + '%).');
    if (milestones && milestones.length > 0) {
      var nextMs = milestones.find(function(m) { return m.percent > progressPercent; });
      if (nextMs) {
        progressLines.push('Cot moc ke tiep (' + nextMs.percent + '%): "' + nextMs.description + '".');
      }
    }
    parts.push('[TIEN DO]\n' + progressLines.join('\n'));
  }

  // Macro Arc
  if (currentMacroArc) {
    var macroLines = [];
    macroLines.push('Cot moc lon hien tai: ' + currentMacroArc.title);
    if (currentMacroArc.description) {
      macroLines.push('Mo ta: ' + currentMacroArc.description);
    }
    if (currentMacroArc.chapter_from && currentMacroArc.chapter_to) {
      macroLines.push('Pham vi: Chuong ' + currentMacroArc.chapter_from + ' den Chuong ' + currentMacroArc.chapter_to);
    }
    if (currentMacroArc.emotional_peak) {
      macroLines.push('Cam xuc can dat khi ket thuc: ' + currentMacroArc.emotional_peak);
    }
    parts.push('[COT MOC LON]\n' + macroLines.join('\n'));
  }

  // Arc
  if (currentArc) {
    var arcLines = [];
    arcLines.push('Hoi truyen hien tai: ' + (currentArc.title || '(chua dat ten)'));
    if (currentArc.goal) {
      arcLines.push('Muc tieu hoi nay: ' + currentArc.goal);
    }
    if (currentArc.chapter_start && currentArc.chapter_end) {
      arcLines.push('Pham vi: Chuong ' + currentArc.chapter_start + ' den Chuong ' + currentArc.chapter_end);
    }
    if (currentArc.power_level_start || currentArc.power_level_end) {
      arcLines.push('Cap do suc manh: ' + (currentArc.power_level_start || '?') + ' \u2192 ' + (currentArc.power_level_end || '?'));
    }
    parts.push('[HOI TRUYEN HIEN TAI]\n' + arcLines.join('\n'));
  }

  // Unified constraints (single source of truth — NO duplication)
  var constraints = [];
  if (currentMacroArc && currentMacroArc.chapter_to && targetLength > 0) {
    var remainingInMacro = currentMacroArc.chapter_to - (currentChapterIndex + 1);
    if (remainingInMacro > 0) {
      constraints.push('Con ' + remainingInMacro + ' chuong nua moi ket thuc cot moc "' + currentMacroArc.title + '".');
    }
  }
  if (currentArc && currentArc.chapter_end) {
    var remainingInArc = currentArc.chapter_end - (currentChapterIndex + 1);
    if (remainingInArc > 0) {
      constraints.push('Con ' + remainingInArc + ' chuong nua moi ket thuc hoi nay.');
    }
  }
  if (ultimateGoal) {
    constraints.push('Muc tieu cuoi cung cua bo truyen: "' + ultimateGoal + '" \u2014 chua den luc dat duoc.');
  }

  if (constraints.length > 0) {
    parts.push('[RANG BUOC TIEN DO]\n' + constraints.map(function(c) { return '- ' + c; }).join('\n'));
  }

  if (parts.length === 0) return '';

  return '[CHIEN LUOC & TIEN DO]\n' + parts.join('\n\n');
}

// =============================================
// Layer 4.2: Chapter Outline (Phase 8)
// =============================================

/**
 * Build Layer 4.2 — Chapter Outline Context.
 * Chỉ inject cho writing tasks.
 */
function buildChapterOutlineLayer(taskType, currentChapterOutline, upcomingChapters) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
  if (!currentChapterOutline && (!upcomingChapters || upcomingChapters.length === 0)) return '';

  const parts = [];

  if (currentChapterOutline && (currentChapterOutline.title || currentChapterOutline.summary)) {
    const cur = [];
    if (currentChapterOutline.title) cur.push('Tieu de: ' + currentChapterOutline.title);
    if (currentChapterOutline.summary) cur.push('Noi dung can viet: ' + currentChapterOutline.summary);
    if (currentChapterOutline.keyEvents && currentChapterOutline.keyEvents.length > 0) {
      cur.push(
        'Su kien bat buoc xay ra:\n' +
        currentChapterOutline.keyEvents.map(function (e) { return '- ' + e; }).join('\n')
      );
    }
    parts.push('[NHIEM VU CHUONG NAY - BAM SAT, KHONG LAC SANG CHUONG KHAC]\n' + cur.join('\n'));
  }

  if (upcomingChapters && upcomingChapters.length > 0) {
    const fence = upcomingChapters
      .map(function (c, i) {
        return '- Chuong tiep theo ' + (i + 1) + ': "' + c.title + '"' + (c.summary ? ' — ' + c.summary : '');
      })
      .join('\n');
    parts.push('[CAC CHUONG TIEP THEO - TUYET DOI KHONG VIET TRUOC NOI DUNG NAY]\n' + fence);
  }

  if (parts.length === 0) return '';
  return '\n[DAN Y TRUYEN]\n' + parts.join('\n\n');
}

function formatChapterBriefList(briefs, options) {
  const list = Array.isArray(briefs) ? briefs.filter(Boolean) : [];
  if (list.length === 0) return '';
  const limit = options?.limit || list.length;
  const header = options?.header || '';
  const lines = list.slice(-limit).map(function (item, index) {
    const chapterNumber = Number.isFinite(Number(item.chapterNumber))
      ? Number(item.chapterNumber)
      : index + 1;
    const title = item.title || ('Chuong ' + chapterNumber);
    const summary = item.summary || item.purpose || '(chua co tom tat)';
    return chapterNumber + '. ' + title + ' - ' + summary;
  });
  return header ? header + '\n' + lines.join('\n') : lines.join('\n');
}

// =============================================
// Layer 5.5: Bridge Memory (Phase 7)
// =============================================

/**
 * Build Layer 5.5 Bridge Memory block.
 * Trả về string rỗng nếu không có dữ liệu hoặc task không phải writing task.
 */
function buildBridgeMemoryLayer(taskType, bridgeBuffer, emotionalState, tensionLevel) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
  if (!bridgeBuffer && !emotionalState) return '';

  const parts = [];

  if (bridgeBuffer) {
    parts.push(
      'Doan van ket thuc chuong truoc (viet tiep TU DAY, KHONG lap lai, KHONG mo dau lai tu dau):\n' +
      '"""\n' + bridgeBuffer + '\n"""'
    );
  }

  if (emotionalState) {
    const stateParts = [];
    if (emotionalState.mood) stateParts.push('Trang thai cam xuc: ' + emotionalState.mood);
    if (emotionalState.activeConflict) stateParts.push('Xung dot dang mo: ' + emotionalState.activeConflict);
    if (emotionalState.lastAction) stateParts.push('Hanh dong cuoi: ' + emotionalState.lastAction);
    if (tensionLevel != null) stateParts.push('Muc do cang thang: ' + tensionLevel + '/10');
    if (stateParts.length > 0) {
      parts.push('Trang thai nhan vat khi ket thuc chuong truoc:\n' + stateParts.join('\n'));
    }
  }

  if (parts.length === 0) return '';

  return '\n[DIEM NOI MACH TRUYEN - BAT BUOC DOC TRUOC KHI VIET]\n' + parts.join('\n\n');
}


// =============================================
// Layer 0.5: Author DNA
//
// Inject TRƯỚC System Identity để AI internalize role
// trước khi đọc bất kỳ instruction nào.
//
// - FULL_WRITING tasks: đầy đủ (role + triết lý + mục tiêu cảm xúc)
// - STYLE_ONLY tasks: chỉ role + triết lý (không có emotional goals vì
//   AI đang làm việc với text có sẵn, không được thay đổi hướng cảm xúc)
// =============================================

/**
 * Lấy role theo giai đoạn chương.
 */
function getAuthorRole(writingStyle, chapterIndex, targetLength) {
  const roles = AUTHOR_ROLE_TABLE[writingStyle] || AUTHOR_ROLE_TABLE['thuan_viet'];
  const pct = targetLength > 0 ? (chapterIndex / targetLength) * 100 : 50;
  if (pct <= 20) return roles[0];
  if (pct <= 70) return roles[1];
  if (pct <= 90) return roles[2];
  return roles[3];
}

/**
 * Build Layer 0.5 — Author DNA.
 * @param {string} taskType
 * @param {string} writingStyle - 'han_viet' | 'thuan_viet'
 * @param {number} chapterIndex
 * @param {number} targetLength
 * @param {object|null} currentChapterOutline
 * @param {object|null} currentMacroArc
 * @returns {string}
 */
function buildAuthorDNALayer(taskType, writingStyle, chapterIndex, targetLength, currentChapterOutline, currentMacroArc) {
  const isFullWriting = FULL_WRITING_TASKS.has(taskType);
  const isStyleOnly = STYLE_ONLY_TASKS.has(taskType);
  if (!isFullWriting && !isStyleOnly) return '';

  const role = getAuthorRole(writingStyle || 'thuan_viet', chapterIndex, targetLength);
  const lines = [];

  lines.push('[LINH HON TAC GIA]');
  lines.push('');
  lines.push('VAI TRO CUA BAN: Ban la ' + role + '.');
  lines.push('');
  lines.push('TRIET LY VIET (BAT BUOC INTERNALIZE):');
  lines.push('1. Viet bang cam xuc, khong phai thong tin.');
  lines.push('   SAI: "Canh gioi han dot pha len Truc Co ky."');
  lines.push('   DUNG: "Linh hai trong nguoi han bot nhien vo vun — roi tai sinh, manh liet hon gap boi."');
  lines.push('2. Moi canh PHAI thay doi trang thai nhan vat. Truoc canh: nhan vat muon/so/nghi gi? Sau canh: con nguyen ven khong?');
  lines.push('3. Doc gia CAM truoc, HIEU sau. Khong bao gio giai thich truoc khi de doc gia trai nghiem.');
  lines.push('4. Moi cau phai "lam mot viec": mo ta, day chuyen, tiet lo, HOAC gay cam xuc. Cau khong lam duoc gi → cat.');

  // Chỉ thêm emotional goals cho FULL_WRITING tasks
  if (isFullWriting) {
    lines.push('');
    lines.push('MUC TIEU CAM XUC CHUONG NAY:');

    const hookEmotion = currentChapterOutline?.summary
      ? 'Cuon hut doc gia ngay lap tuc qua: ' + currentChapterOutline.summary.substring(0, 80)
      : 'Tao hook manh me ngay dong dau tien — doc gia phai muon doc tiep';
    const peakEmotion = currentMacroArc?.emotional_peak
      ? currentMacroArc.emotional_peak
      : 'Day len muc cam xuc cao nhat co the trong canh nay';
    const cliffhanger = 'De lai it nhat mot cau hoi chua duoc tra loi — doc gia phai muon sang chuong sau';

    lines.push('- DAU CHUONG (hook): ' + hookEmotion);
    lines.push('- DINH DIEM (peak): ' + peakEmotion);
    lines.push('- CUOI CHUONG (cliffhanger): ' + cliffhanger);
  } else {
    // STYLE_ONLY: nhắc nhở không thay đổi hướng
    lines.push('');
    lines.push('LUU Y QUAN TRONG (STYLE_ONLY MODE):');
    lines.push('Ban dang lam viec voi text DA CO SAN. KHONG duoc thay doi huong cam xuc hay cot truyen.');
    lines.push('Chi nang cap van phong, nhip dieu, tu ngu theo Style DNA ben duoi.');
  }

  return lines.join('\n');
}

// =============================================
// Layer 7: Style DNA
//
// Thay thế placeholder "Style Pack" cũ.
// Hai bộ hoàn toàn khác nhau: Hán Việt và Thuần Việt.
// Inject cho tất cả writing tasks (FULL + STYLE_ONLY).
// =============================================

/**
 * Build Layer 7 — Style DNA.
 * @param {string} taskType
 * @param {string} writingStyle - 'han_viet' | 'thuan_viet'
 * @returns {string}
 */
function buildStyleDNALayer(taskType, writingStyle) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  if (writingStyle === 'han_viet') {
    return `
[VAN PHONG DNA - HAN VIET / SANGTACVIET STYLE]

1. TU DIEN BAT BUOC DUNG — KHONG DUOC THUAN VIET HOA:
Xung ho: nguoi, han, nang, lao, tieu tu, dao huu, huynh, de, ty, muoi, lao phu
Trang thai: bang bac, lanh mang, tham thuy, u am, hung hon, kinh nguoi, uy ap
Hanh dong: thi trien, van chuyen, dot pha, ngung ket, tan loan, thu liem, tung hoanh
Tu luyen: linh khi, dan dien, kinh mach, canh gioi, thien tu, linh hai, thien hoa
Cam thach: van phan, thien ha vo dich, kinh thien dong dia, khung bo, bat kha tu nghi
Cam xuc: lanh nhan bang quan, khe nhech moi, anh mat ben nhu kiem

2. CAU TRUC CAU DAC TRUNG (DAO NGU TRUNG QUOC):
DUNG: "Han anh mat ben trong loe len mot tia lanh mang."
SAI:  "Trong mat han loe len anh nhin lanh le."
DUNG: "Linh khi bang bac, han ngoi ket gia, tam than sac ben nhu kiem."
SAI:  "Han ngoi ket gia, linh khi toa ra va tam than rat sac ben."
DUNG: "Dao huu nay... thuc su khien lao kinh so."
SAI:  "Nguoi nay thuc su khien ong ta so hai."

3. NHIP DIEU THEO TINH HUONG:
Hanh dong nhanh: cau 5-8 chu, lien tiep, moi cau = 1 hanh dong ro rang.
  VD: "Han xuat thu. Kiem quang loe len. Dich nhan chua kip phan ung."
Cam xuc / noi tam: cau dai, nhieu menh de, cham rai suy tu.
  VD: "Han dung do, nhin vao hu khong ma trong long lai day len mot cam giac ky la..."
Cao trao CONG THUC: 3 cau ngan → 1 cau dai bung no.
  VD: "Linh khi rung chuyen. Dai dia run ray. Khong gian meo mo. Va roi — trong tieng gao thet kinh thien cua thien dia, canh gioi han vo toang!"

4. CONG THUC SANG DIEM (BAT BUOC NAM VUNG):
Va mat (humiliation → reversal):
  Setup: ke dich kieu ngao + cong khai si nhuc truoc dong nguoi.
  Twist: nhan vat chinh tiet lo bi an / suc manh that su.
  Payoff: 1 cau thoai ngan, lanh, chinh xac den tan nhan.
  Phan ung: dam dong kinh ngac → im lang → xon xao.
Dot pha canh gioi:
  Giai doan 1: co the dau don / linh hai sap vo.
  Giai doan 2: diem bung vo — mo ta vat ly cuc ky chi tiet.
  Giai doan 3: su yen tinh sau bao — nhan vat nhan ra minh da khac.
Tiet lo bi mat: de doc gia nhan ra TRUOC nhan vat (dramatic irony) HOAC cung luc (shock).

5. CAM KY TUYET DOI:
- KHONG giai thich he thong nhu nguoi dan truyen: "Truc Co ky la canh gioi thu 2..."
- KHONG de nhan vat binh than truoc dieu phi thuong
- KHONG ket thuc canh ma khong co he qua cam xuc
- KHONG dung ngoac don () tru mau sac pham cap: (luc), (lam), (tu), (hoang), (xich), (chanh), (hac), (bach), (thai sac)
- KHONG viet "Han nghi:" — thay bang gian tiep noi tam`;
  }

  // Thuần Việt
  return `
[VAN PHONG DNA - THUAN VIET]

1. NGUYEN TAC GOC:
Moi thu phai nghe nhu nguoi Viet thuc su nghi va cam.
Khong cung nhac, khong dich may, khong Han hoa.
Tu nao nguoi binh thuong khong noi → thay bang tu tu nhien hon.

2. NHIP DIEU VA CAU TRUC:
Hanh dong: cau ngan, dong tu manh, KHONG trang tu thua.
  DUNG: "Anh chay. Tim dap loan. Hoi tho can."
  SAI:  "Anh vo cung voi va chay rat nhanh."
Noi tam: cau dai hon, chay tu nhien nhu dong y thuc.
  DUNG: "Co khong hieu tai sao minh lai dung lai o day — chi biet rang neu buoc them mot buoc nua, co dieu gi do se vinh vien thay doi."
Doi thoai: ngan, that, co tinh cach tung nguoi — khong ai noi dai hon 2 cau neu khong can.

3. MOI TRUONG VA GIAC QUAN:
Mo ta = 5 giac quan, KHONG phai buc tranh.
Mui, am thanh, ket cau, nhiet do TRUOC ve ngoai.
  DUNG: "Khong khi am va tanh cua mua sap den"
  SAI:  "Bau troi xam xit"
Chi tiet cu the > tong quat:
  DUNG: "Cai ban go som bong tron son o goc trai"
  SAI:  "Can phong cu ky"

4. XU LY CAM XUC:
KHONG bao gio viet cam xuc truc tiep: "Co rat buon."
THAY BANG hanh dong the hien cam xuc:
  "Co ngoi xuong san. Khong khoc. Chi nhin vao buc tuong trang cho den khi mat mo di."
Cung bac cam xuc = thay doi vat ly: nhip tho, nhiet do, trong luong co the.

5. CAM KY:
- KHONG dung: nguoi, han (→ anh ay, ong ta, y, ga...), nang (→ co ay, chi ay)
- KHONG cau truc dao ngu kieu Trung Quoc
- KHONG ket thuc canh bang tong ket nhu nguoi ke chuyen
- KHONG mieu ta cam xuc bang tinh tu: "buon", "vui", "so" — chi hanh dong`;
}

/**
 * Pick random N entries từ array (Fisher-Yates partial shuffle).
 * Không mutate array gốc.
 */
function pickRandom(arr, n) {
  if (!arr || arr.length === 0) return [];
  const copy = arr.slice();
  const count = Math.min(n, copy.length);
  for (let i = copy.length - 1; i > copy.length - 1 - count && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(-count);
}

/**
 * Build Anti-AI Blacklist block.
 * Random pick 12 entries mỗi lần từ pool (style-specific + common).
 * Giữ prompt fresh, AI không "nhờn".
 */
function buildAntiAIBlock(writingStyle) {
  const styleEntries = ANTI_AI_BLACKLIST[writingStyle] || ANTI_AI_BLACKLIST.thuan_viet;
  const commonEntries = ANTI_AI_BLACKLIST.common || [];
  const pool = [...styleEntries, ...commonEntries];
  const picked = pickRandom(pool, 12);
  if (picked.length === 0) return '';

  const lines = ['\n[CHONG VAN PHONG AI — TU/CUM CAM DUNG]'];
  lines.push('Cac cum tu sau la DAU HIEU AI — KHONG DUOC DUNG:');
  picked.forEach(e => lines.push('  X "' + e.bad + '"  →  V ' + e.good));
  lines.push('Neu thay minh sap viet bat ky cum nao o tren → dung lai, viet cach khac.');
  return lines.join('\n');
}

// =============================================
// Layer 7.5: Mood Board
//
// Inject 2-3 câu mẫu thể hiện đúng giọng văn cần đạt.
// Ưu tiên: câu hay nhất từ bridgeBuffer của tác giả (họ đã viết gì thì tiếp tục đúng tone đó).
// Fallback: MOOD_BOARD_DEFAULTS theo genre.
// =============================================

/**
 * Trích câu có nhịp điệu tốt nhất từ buffer làm mood sample.
 * Scoring: độ phức tạp dấu câu (rhythm) > độ dài thô.
 * Câu dài nhất KHÔNG nhất thiết là câu hay nhất.
 */
function extractMoodSamples(text, maxSamples) {
  if (!text || text.length < 30) return [];
  var sentences = text
    .replace(/<[^>]*>/g, ' ')
    .split(/(?<=[.!?…])\s+|(?<=—)\s*/)
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s.length > 30 && s.length < 300; });

  if (sentences.length === 0) return [];

  // Multi-factor scoring: rhythm > length
  var scored = sentences.map(function(s) {
    var score = 0;
    // Punctuation diversity = rhythm complexity (commas, dashes, semicolons)
    var punctCount = (s.match(/[,;:\u2014\u2013\u2026]/g) || []).length;
    score += punctCount * 15;
    // Moderate length is ideal (80-200 chars)
    if (s.length >= 80 && s.length <= 200) score += 20;
    else if (s.length > 200) score += 5;
    else score += 2;
    // Penalize dialogue (starts with quote marks) — dialogue is not a good mood sample
    if (/^[\u201C\u201D"'\u2018\u2019\u00AB\u00BB\u2015\u2014\u2013-]/.test(s)) score -= 30;
    // Penalize very short sentences (likely stage directions)
    if (s.length < 50) score -= 10;
    // Bonus for sensory/emotional words (Vietnamese)
    var sensory = ['nghe', 'nhin', 'mui', 'nong', 'lanh', 'am', 'toi', 'sang', 'run', 'dau', 'tho'];
    sensory.forEach(function(w) { if (s.toLowerCase().includes(w)) score += 5; });
    return { text: s, score: score };
  });

  return scored
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, maxSamples)
    .map(function(item) { return item.text; });
}

/**
 * Build Layer 7.5 — Mood Board.
 * @param {string} taskType
 * @param {string} genreKey
 * @param {string} bridgeBuffer - văn bản chương trước
 * @param {string} selectedText - text được chọn (cho EXPAND/REWRITE)
 * @returns {string}
 */
function buildMoodBoardLayer(taskType, genreKey, bridgeBuffer, selectedText) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  const sourceText = FULL_WRITING_TASKS.has(taskType)
    ? bridgeBuffer
    : (selectedText || bridgeBuffer); // EXPAND/REWRITE dùng text đang xử lý

  const authorSamples = extractMoodSamples(sourceText, 2);
  const defaultSamples = (MOOD_BOARD_DEFAULTS[genreKey] || MOOD_BOARD_DEFAULTS['do_thi'] || []).slice(0, 2);

  // Ưu tiên câu của tác giả, fallback sang defaults
  // [FIX] Nếu sourceText có nội dung nhưng không đạt chuẩn (VD < 30 ký tự),
  // KHÔNG ĐƯỢC ép dùng defaults vì sẽ kéo lệch tone. Chỉ dùng defaults khi text trắng tinh.
  const samples = authorSamples.length >= 1
    ? authorSamples.slice(0, 2)
    : ((!sourceText || sourceText.trim() === '') ? defaultSamples : []);

  if (samples.length === 0) return '';

  const lines = ['[MAU VAN PHONG - DOC VA CAM NHAN TRUOC KHI VIET]'];
  lines.push('Day la giong van va nhip dieu can dat — hoc phong cach, KHONG copy tu ngu:');
  lines.push('');
  samples.forEach(s => lines.push('• "' + s.replace(/"/g, '\"') + '"'));
  lines.push('');
  lines.push('Viet theo CAM GIAC nay. Khong copy tu ngu, chi can nhip dieu tuong tu.');
  return lines.join('\n');
}

// =============================================
// Layer 9: Priority Anchor (Double Sandwich)
//
// Đặt ở CUỐI userContent — LLM chú ý đầu và cuối nhất.
// Grand Strategy ở đầu + Priority Anchor ở cuối = double anchor.
//
// Khác nhau giữa FULL và STYLE:
// - FULL: checklist 3 câu hỏi tự kiểm để định hướng generation
// - STYLE: nhắc nhở không thay đổi nội dung
// =============================================

/**
 * Build Layer 9 — Priority Anchor.
 * Append vào cuối userContent, không phải systemParts.
 * @param {string} taskType
 * @param {string} userPrompt
 * @returns {string}
 */
function buildPriorityAnchorLayer(taskType, userPrompt) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';

  const instruction = (userPrompt || '').trim();
  const isFullWriting = FULL_WRITING_TASKS.has(taskType);

  const lines = ['---'];
  lines.push('[NHIEM VU TOI THUONG - UU TIEN CAO NHAT]');

  if (instruction) {
    lines.push('>>> ' + instruction + ' <<<');
  } else {
    lines.push(isFullWriting
      ? '>>> Viet tiep tu diem nay, giu nguyen mach truyen va day manh cam xuc <<< '
      : '>>> Nang cap van phong theo Style DNA, giu nguyen noi dung va cam xuc goc <<<');
  }

  if (isFullWriting) {
    lines.push('');
    lines.push('DAM BAO 3 DIEU SAU THE HIEN RO TRONG BAI VIET:');
    lines.push('- Dong dau tien phai tao cam xuc manh, cuon doc gia vao ngay lap tuc.');
    lines.push('- Nhan vat chinh phai THAY DOI qua canh nay (cam xuc, nhan thuc, hoac vi the).');
    lines.push('- Cuoi canh de lai tinh huong mo hoac cau hoi khien doc gia muon sang chuong tiep.');
    lines.push('');
    lines.push('CU THE HOA — KHONG VIET TRUU TUONG:');
    lines.push('- Thoi gian: KHONG "gan day", "lau lam" → viet "3 ngay truoc", "nua thang", "tu sang den gio"');
    lines.push('- So luong: KHONG "nhieu nguoi" → viet "nam ba nguoi", "ca tram ke", "vai chuc ten"');
    lines.push('- Cam giac: KHONG "rat dau", "vo cung lo lang" → viet hanh dong: "han cong nguoi lai", "tay nam chat den trang bech"');
    lines.push('- Canh vat: KHONG "can phong rat lon" → viet 1 chi tiet: "tran nha cao gap 3 lan nguoi dung", "vach da am am nuoc"');
  } else {
    // EXPAND / REWRITE
    lines.push('');
    lines.push('Giu nguyen su kien, huong di, va cam xuc goc cua doan van.');
    lines.push('Chi nang cap: nhip dieu cau, tu ngu, cau truc theo Style DNA da cho.');
  }

  return lines.join('\n');
}

// =============================================
// Layer 3: Genre Constraints
// =============================================
export const GENRE_CONSTRAINTS = {
  tien_hiep: 'The loai: Tien hiep. Tuan thu nghiem ngat he thong canh gioi. Dot pha phai co tich luy. Chien dau theo suc manh canh gioi. Ngon tu co kinh khi tuong tac giua tu si.',
  huyen_huyen: 'The loai: Huyen huyen. The gioi tu do nhung PHAI nhat quan. Da chung toc/he thong phai tuong tac logic. Cap bac suc manh phai duoc ton trong.',
  fantasy: 'The loai: Fantasy phuong Tay. Phep thuat co quy tac va hau qua. Khong de nhan vat dot ngot manh vo ly. Moi phep thuat co cai gia.',
  he_thong: 'The loai: He thong/LitRPG. Moi so lieu (level, skill, stats) phai nhat quan. Level up phai hop ly. Skill moi phai duoc giai thich nguon goc.',
  mat_the: 'The loai: Mat the. Tai nguyen PHAI khan hiem. Sinh ton la cot loi. Suc manh co cai gia. Bau khong khi luon cang thang.',
  ngon_tinh_cd: 'The loai: Ngon tinh co dai. Xung ho phai dung thoi dai va giai cap. Cam xuc the hien qua hanh dong nho, anh mat, cu chi. Nhip tinh cam cham, tinh te.',
  mystery: 'The loai: Trinh tham. Quan ly manh moi can than: ai biet gi, ai khong biet gi. Khong tiet lo thong tin chua den luc.',
  romance: 'The loai: Ngon tinh. Cam xuc nhan vat phai chan thuc, tu nhien. Nhip tinh cam khong qua nhanh hay cham.',
  horror: 'The loai: Kinh di. Tension tang dan. Phan biet kinh di tam ly vs gore. Setup phai co payoff. Khong giai thich qua nhieu.',
  scifi: 'The loai: Sci-fi. Giu logic cong nghe nhat quan. Moi cong nghe co he qua xa hoi.',
  vo_hiep: 'The loai: Vo hiep. Tuan thu he thong vo cong, phan biet noi cong/ngoai cong. Giang ho co quy tac rieng.',
  co_dai: 'The loai: Co dai. Tuan thu phong tuc, cau truc xa hoi phong kien. Ngon tu mang sac thai co kinh.',
  xuyen_khong: 'The loai: Xuyen khong. Nhan vat xuyen khong co kien thuc hien dai nhung phai can than khi dung.',
  trong_sinh: 'The loai: Trong sinh. Nhan vat biet truoc tuong lai nhung phai tu nhien khi su dung kien thuc do. Thay doi lich su co he qua.',
  do_thi: 'The loai: Do thi. Boi canh hien dai, ngon ngu tu nhien, doi thuong.',
};

// =============================================
// Main: buildPrompt
// =============================================
export function buildPrompt(taskType, context = {}) {
  const {
    projectId = null,
    chapterId = null,
    selectedText,
    sceneText,
    sceneTitle,
    chapterTitle,
    projectTitle,
    genre,
    userPrompt,
    previousSummary,
    // Phase 3
    characters = [],
    locations = [],
    worldTerms = [],
    objects = [],
    taboos = [],
    worldProfile = {},
    // Phase 4
    aiGuidelines = '',
    aiStrictness = 'balanced',
    relationships = [],
    sceneContract = {},
    canonFacts = [],
    plotThreads = [],
    povMode = '',
    synopsis = '',
    storyStructure = '',
    pronounStyle = null,
    // Phase 5
    targetLength = 0,
    targetLengthType = 'unset',
    ultimateGoal = '',
    milestones = [],
    currentChapterIndex = 0,
    // Phase 7: Bridge Memory
    bridgeBuffer = '',
    previousEmotionalState = null,
    tensionLevel = null,
    // Phase 8: Chapter Outline Context
    currentChapterOutline = null,
    upcomingChapters = [],
    startChapterNumber = 1,
    existingChapterBriefs = [],
    priorGeneratedChapterBriefs = [],
    // Phase 9: Grand Strategy
    currentArc = null,
    currentMacroArc = null,
    // Soul Injection
    writingStyle = '',
    // Custom overrides 
    promptTemplates = {},
    nsfwMode = false,
    superNsfwMode = false,
    sceneList = [],
    validatorReports = [],
    retrievalPacket = null,
    entityType = '',
    batchCount = 0,
    entityContextText = '',
    recentChapterSummaries = [],
    authorIdea = '',
  } = context;

  // Resolve writing style: context > auto-detect từ genre
  const genreKey = genre ? genre.toLowerCase().replace(/\s+/g, '_') : '';
  const resolvedWritingStyle = writingStyle || detectWritingStyle(genreKey || '');
  const systemParts = [];

  // FREE_PROMPT: skip heavy writing layers for questions/chat
  const freePromptInProject = taskType === TASK_TYPES.FREE_PROMPT && !!(projectId || chapterId);
  const skipWritingLayers = taskType === TASK_TYPES.FREE_PROMPT && !freePromptInProject && !isWritingIntent(userPrompt);

  // -- Layer 0: Grand Strategy & Pacing (merged) --
  // Đặt trước Layer 1 để AI luôn thấy đại cục đầu tiên
  const grandStrategyLayer = buildGrandStrategyLayer(
    taskType,
    currentMacroArc,
    currentArc,
    ultimateGoal,
    targetLength,
    currentChapterIndex,
    milestones
  );
  if (grandStrategyLayer && !skipWritingLayers) {
    systemParts.push(grandStrategyLayer);
  }

  // -- Layer 0.5: Author DNA --
  // Inject trước Layer 1 để AI internalize role và triết lý viết
  // TRƯỚC KHI đọc bất kỳ instruction hay context nào
  const authorDNALayer = buildAuthorDNALayer(
    taskType,
    resolvedWritingStyle,
    currentChapterIndex,
    targetLength,
    currentChapterOutline,
    currentMacroArc
  );
  if (authorDNALayer && !skipWritingLayers) {
    systemParts.push(authorDNALayer);
  }

  // Inject NSFW rules at high priority when mature mode is enabled.
  if (nsfwMode || superNsfwMode) {
    systemParts.push(resolveNsfwRules(promptTemplates));
    const nsfwIntimateLayer = buildNsfwIntimateSystemLayer(taskType, {
      userPrompt,
      sceneText,
      selectedText,
      retrievalPacket,
      promptTemplates,
    });
    if (nsfwIntimateLayer) {
      systemParts.push(nsfwIntimateLayer);
    }
  }

  // -- Layer 1: System Identity --
  systemParts.push(resolveSystemIdentityPrompt());

  if (WRITING_DISCIPLINE_TASKS.has(taskType) && !skipWritingLayers) {
    systemParts.push(DEFAULT_WRITING_DISCIPLINE_LAYER);
  }

  // Project info with POV
  const povLabel = { first: 'Ngoi 1', third_limited: 'Ngoi 3 han che', third_omni: 'Ngoi 3 toan tri', multi_pov: 'Da goc nhin' };
  const projectInfo = ['Truyen: ' + (projectTitle || 'Chua dat ten')];
  if (genre) projectInfo.push('The loai: ' + genre);
  if (povMode) projectInfo.push('Goc nhin: ' + (povLabel[povMode] || povMode));
  systemParts.push('\n[' + projectInfo.join(' - ') + ']');

  if (chapterTitle) systemParts.push('[Chuong hien tai: ' + chapterTitle + ']');
  if (sceneTitle) systemParts.push('[Canh hien tai: ' + sceneTitle + ']');

  // POV instruction
  if (povMode === 'first') {
    systemParts.push('[GOC NHIN]: Viet ngoi thu nhat (toi/ta). Chi mo ta nhung gi nhan vat POV thay, nghe, cam nhan. KHONG viet suy nghi nhan vat khac.');
  } else if (povMode === 'third_limited') {
    systemParts.push('[GOC NHIN]: Viet ngoi thu ba han che. Theo sat 1 nhan vat moi canh - chi biet suy nghi/cam xuc cua nhan vat do.');
  } else if (povMode === 'third_omni') {
    systemParts.push('[GOC NHIN]: Viet ngoi thu ba toan tri. Co the vao tam tri moi nhan vat.');
  } else if (povMode === 'multi_pov') {
    systemParts.push('[GOC NHIN]: Da goc nhin - moi canh/chuong theo 1 nhan vat. Giu nhat quan trong cung 1 canh.');
  }

  // -- Layer 1.5: Writing Constitution (nguyen tac sang tac) --
  // Di chuyen tu Layer 3 len day — LLM chu y dau prompt nhat.
  // Dung strictness de frame: strict = khong the vi pham, relaxed = goi y.
  if (aiGuidelines) {
    const principleHeader = aiStrictness === 'strict'
      ? 'NGUYEN TAC SANG TAC — TUYET DOI TUAN THU'
      : aiStrictness === 'relaxed'
        ? 'GOI Y SANG TAC'
        : 'NGUYEN TAC SANG TAC';
    systemParts.push('\n[' + principleHeader + ']\n' + aiGuidelines);
  }

  // -- Layer 2: Task Instruction --
  const taskInstruction = promptTemplates[taskType] || TASK_INSTRUCTIONS[taskType];
  if (taskInstruction) {
    systemParts.push('\n[NHIEM VU]\n' + taskInstruction);
  }

  // -- Layer 3: Genre Constraints --
  // LUON inject genre constraint khi co — khong bi if/else voi aiGuidelines nua.
  // aiGuidelines (Constitution) la nguyen tac CUA TAC GIA.
  // Genre constraint la quy tac CUA THE LOAI. Hai thu khac nhau, can ca hai.
  {
    const genreConstraint = GENRE_CONSTRAINTS[genreKey];
    if (genreConstraint) {
      systemParts.push('\n[THE LOAI]\n' + genreConstraint);
    }
  }

  // Synopsis
  if (synopsis) {
    systemParts.push('\n[COT TRUYEN CHINH]\n' + synopsis);
  }

  // Story structure
  const structureHints = {
    three_act: 'Cau truc 3 Hoi: Hoi 1 thiet lap, Hoi 2 xung dot leo thang, Hoi 3 giai quyet.',
    hero_journey: 'Hanh trinh Anh hung: The gioi binh thuong > Loi keu goi > Thu thach > Mat mat > Chien thang > Tro ve.',
    isekai_system: 'Isekai/He Thong: Thuc tinh he thong > Kham pha > Farm/grind > Build the luc > Dinh cao.',
    slice_of_life: 'Lat cat cuoc song: Tap trung nhan vat va cam xuc.',
    mystery: 'Trinh tham: Vu an > Manh moi > Tinh nghi > Twist > Su that.',
  };
  if (storyStructure && structureHints[storyStructure]) {
    systemParts.push('[CAU TRUC TRUYEN]: ' + structureHints[storyStructure]);
  }

  // Pronoun style
  if (pronounStyle && pronounStyle.default_self) {
    systemParts.push('[XUNG HO MAC DINH - ' + pronounStyle.label + ']: Tu xung "' + pronounStyle.default_self + '", goi nguoi "' + pronounStyle.default_other + '". Tuan theo xung ho rieng cua tung nhan vat neu co.');
  } else {
    const pronounPresetKey = GENRE_PRONOUN_MAP[genreKey];
    const pronounPreset = pronounPresetKey ? PRONOUN_PRESETS[pronounPresetKey] : null;
    if (pronounPreset) {
      systemParts.push('[XUNG HO MAC DINH - ' + pronounPreset.label + ']: Tu xung "' + pronounPreset.default_self + '", goi nguoi "' + pronounPreset.default_other + '". Tuan theo xung ho rieng cua tung nhan vat neu co.');
    }
  }

  // -- Layer 4: Canon Context --
  const canonContextParts = [];

  // World Profile
  if (worldProfile.name || worldProfile.description || (worldProfile.rules && worldProfile.rules.length > 0)) {
    let wpText = 'The gioi: ' + (worldProfile.name || 'Chua dat ten');
    if (worldProfile.type) wpText += ' - Loai: ' + worldProfile.type;
    if (worldProfile.scale) wpText += ' - Quy mo: ' + worldProfile.scale;
    if (worldProfile.era) wpText += ' - Thoi dai: ' + worldProfile.era;
    if (worldProfile.rules && worldProfile.rules.length > 0) {
      wpText += '\nQuy tac cot loi:\n' + worldProfile.rules.map(function (r) { return '* ' + r; }).join('\n');
    }
    if (worldProfile.description) {
      wpText += '\nMo ta: ' + worldProfile.description;
    }
    canonContextParts.push(wpText);
  }

  if (previousSummary) {
    canonContextParts.push('Tom tat chuong truoc:\n' + previousSummary);
  }

  if (locations.length > 0) {
    const locInfo = locations.map(function (l) {
      return '- ' + l.name + (l.description ? ': ' + l.description : '');
    }).join('\n');
    canonContextParts.push('Dia danh xuat hien:\n' + locInfo);
  }

  if (objects.length > 0) {
    const objInfo = objects.map(function (o) {
      return '- ' + o.name + (o.description ? ': ' + o.description : '');
    }).join('\n');
    canonContextParts.push('Vat pham:\n' + objInfo);
  }

  if (worldTerms.length > 0) {
    const termInfo = worldTerms.map(function (t) {
      return '- ' + t.name + (t.definition ? ': ' + t.definition : '');
    }).join('\n');
    canonContextParts.push('Thuat ngu the gioi:\n' + termInfo);
  }

  if (canonContextParts.length > 0) {
    systemParts.push('\n[BOI CANH TRUYEN]\n' + canonContextParts.join('\n\n'));
  }

  // -- Layer 4.2: Chapter Outline Context (Phase 8) --
  const chapterOutlineLayer = buildChapterOutlineLayer(taskType, currentChapterOutline, upcomingChapters);
  if (chapterOutlineLayer && !skipWritingLayers) {
    systemParts.push(chapterOutlineLayer);
  }

  // [Layer 4.5 removed — merged into Grand Strategy (Layer 0)]

  // -- Layer 5: Character State (token budget: max 15) --
  var cappedCharacters = characters.slice(0, 15);
  if (cappedCharacters.length > 0) {
    const charInfo = cappedCharacters.map(function (c) {
      const parts = ['- ' + c.name + ' (' + (c.role || 'nhan vat') + ')'];
      if (c.pronouns_self) parts.push('  Xung: "' + c.pronouns_self + '"' + (c.pronouns_other ? ', goi nguoi: "' + c.pronouns_other + '"' : ''));
      if (c.appearance) parts.push('  Ngoai hinh: ' + c.appearance);
      if (c.personality_tags) parts.push('  Tags: ' + c.personality_tags);
      if (c.personality) parts.push('  Tinh cach: ' + c.personality);
      if (c.flaws) parts.push('  Diem yeu: ' + c.flaws);
      if (c.speech_pattern) parts.push('  Giong noi: ' + c.speech_pattern);
      if (c.current_status) parts.push('  Trang thai hien tai: ' + c.current_status);
      return parts.join('\n');
    }).join('\n');
    systemParts.push('\n[NHAN VAT XUAT HIEN]\n' + charInfo);
  }

  // Relationships (Phase 4)
  if (relationships.length > 0) {
    const relInfo = relationships.map(function (r) {
      return '- ' + r.charA + ' <-> ' + r.charB + ': ' + r.label + (r.description ? ' (' + r.description + ')' : '');
    }).join('\n');
    systemParts.push('\n[QUAN HE NHAN VAT]\n' + relInfo);
  }

  // Taboos - tone adjusted by ai_strictness
  if (taboos.length > 0) {
    const tabooPrefix = aiStrictness === 'strict' ? 'TUYET DOI KHONG' :
      aiStrictness === 'relaxed' ? 'Nen tranh' : 'Khong nen';
    const tabooLines = taboos.map(function (t) {
      const who = t.characterName || 'Tat ca nhan vat';
      return tabooPrefix + ': ' + who + ' - ' + t.description;
    }).join('\n');
    const tabooHeader = aiStrictness === 'strict' ? 'CAM KY - VI PHAM LA LOI NGHIEM TRONG' :
      aiStrictness === 'relaxed' ? 'LUU Y - NEN TRANH' : 'CAM KY';
    systemParts.push('\n[' + tabooHeader + ']\n' + tabooLines);
  }

  // -- Layer 5.5: Bridge Memory (Phase 7) --
  const bridgeLayer = buildBridgeMemoryLayer(taskType, bridgeBuffer, previousEmotionalState, tensionLevel);
  if (bridgeLayer && !skipWritingLayers) {
    systemParts.push(bridgeLayer);
  }

  // -- Layer 6: Scene Contract (Phase 4) --
  const contractParts = [];
  if (sceneContract.goal) contractParts.push('Muc tieu: ' + sceneContract.goal);
  if (sceneContract.conflict) contractParts.push('Xung dot: ' + sceneContract.conflict);
  if (sceneContract.emotional_start || sceneContract.emotional_end) {
    contractParts.push('Cam xuc: ' + (sceneContract.emotional_start || '?') + ' -> ' + (sceneContract.emotional_end || '?'));
  }
  if (sceneContract.must_happen && sceneContract.must_happen.length > 0) {
    contractParts.push('BAT BUOC xay ra:\n' + sceneContract.must_happen.map(function (m) { return '[v] ' + m; }).join('\n'));
  }
  if (sceneContract.must_not_happen && sceneContract.must_not_happen.length > 0) {
    contractParts.push('CAM xay ra:\n' + sceneContract.must_not_happen.map(function (m) { return '[x] ' + m; }).join('\n'));
  }
  if (sceneContract.pacing) {
    const pacingMap = { slow: 'Cham - mieu ta chi tiet', medium: 'Trung binh', fast: 'Nhanh - hanh dong lien tuc' };
    contractParts.push('Nhip: ' + (pacingMap[sceneContract.pacing] || sceneContract.pacing));
  }
  if (contractParts.length > 0) {
    const contractHeader = aiStrictness === 'strict' ? 'HOP DONG CANH - BAT BUOC TUAN THU' :
      aiStrictness === 'relaxed' ? 'GOI Y CHO CANH' : 'HOP DONG CANH';
    systemParts.push('\n[' + contractHeader + ']\n' + contractParts.join('\n'));
  }

  // Canon Facts (Phase 4)
  if (canonFacts.length > 0) {
    const facts = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'fact'; });
    const secrets = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'secret'; });
    const rules = canonFacts.filter(function (f) { return f.status === 'active' && f.fact_type === 'rule'; });
    const cParts = [];
    if (facts.length > 0) cParts.push('Su that:\n' + facts.map(function (f) { return '- ' + f.description; }).join('\n'));
    if (rules.length > 0) cParts.push('Quy tac:\n' + rules.map(function (f) { return '- ' + f.description; }).join('\n'));
    if (secrets.length > 0) cParts.push('BI MAT - CHUA TIET LO:\n' + secrets.map(function (f) { return '[x] ' + f.description; }).join('\n'));
    if (cParts.length > 0) systemParts.push('\n[CANON TRUYEN]\n' + cParts.join('\n\n'));
  }

  if (retrievalPacket && (retrievalPacket.relevantEntityStates?.length > 0 || retrievalPacket.activeThreadStates?.length > 0)) {
    const canonBits = [];
    if (retrievalPacket.relevantEntityStates?.length > 0) {
      canonBits.push('Trang thai canon hien tai:\n' + retrievalPacket.relevantEntityStates.map(function (state) {
        const summaryParts = [];
        if (state.alive_status === 'dead') summaryParts.push('da chet');
        else if (state.alive_status === 'alive') summaryParts.push('con song');
        if (state.rescued) summaryParts.push('da duoc cuu');
        if (state.current_location_name) summaryParts.push('o ' + state.current_location_name);
        if (state.allegiance) summaryParts.push('phe ' + state.allegiance);
        if (Array.isArray(state.goals_active) && state.goals_active.length > 0) summaryParts.push('muc tieu: ' + state.goals_active.join(', '));
        return '- Entity #' + state.entity_id + ': ' + summaryParts.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.activeThreadStates?.length > 0) {
      canonBits.push('Thread dang mo:\n' + retrievalPacket.activeThreadStates.map(function (threadState) {
        return '- Thread #' + threadState.thread_id + ' [' + (threadState.state || 'active') + ']: ' + (threadState.summary || '');
      }).join('\n'));
    }
    if (retrievalPacket.relevantItemStates?.length > 0) {
      canonBits.push('Vat pham / tai nguyen lien quan:\n' + retrievalPacket.relevantItemStates.map(function (state) {
        const itemBits = [];
        itemBits.push('trang thai: ' + (state.availability || 'available'));
        if (state.owner_character_id) itemBits.push('chu so huu #' + state.owner_character_id);
        if (state.current_location_name) itemBits.push('o ' + state.current_location_name);
        if (state.is_consumed) itemBits.push('da dung het');
        if (state.is_damaged) itemBits.push('da hu hong');
        if (state.summary) itemBits.push(state.summary);
        return '- Vat pham #' + state.object_id + ': ' + itemBits.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.relevantRelationshipStates?.length > 0) {
      canonBits.push('Quan he / do than mat lien quan:\n' + retrievalPacket.relevantRelationshipStates.map(function (state) {
        const relBits = [];
        if (state.relationship_type) relBits.push('quan he: ' + state.relationship_type);
        if (state.intimacy_level && state.intimacy_level !== 'none') relBits.push('than mat: ' + state.intimacy_level);
        if (state.secrecy_state) relBits.push('bi mat: ' + state.secrecy_state);
        if (state.consent_state && state.consent_state !== 'unknown') relBits.push('dong thuan: ' + state.consent_state);
        if (state.emotional_aftermath) relBits.push('du am cam xuc: ' + state.emotional_aftermath);
        if (state.summary) relBits.push(state.summary);
        return '- Cap #' + state.character_a_id + ' & #' + state.character_b_id + ': ' + relBits.join(' | ');
      }).join('\n'));
    }
    if (retrievalPacket.criticalConstraints) {
      const constraints = [];
      if (retrievalPacket.criticalConstraints.deadCharacters?.length > 0) {
        constraints.push('Nhan vat da chet: ' + retrievalPacket.criticalConstraints.deadCharacters.map(function (id) { return '#' + id; }).join(', '));
      }
      if (retrievalPacket.criticalConstraints.unavailableItems?.length > 0) {
        constraints.push('Vat pham khong con dung duoc: ' + retrievalPacket.criticalConstraints.unavailableItems.map(function (item) {
          return (item.object_name || ('#' + item.object_id)) + ' (' + item.availability + ')';
        }).join(', '));
      }
      if (retrievalPacket.criticalConstraints.relationshipConstraints?.length > 0) {
        constraints.push('Rang buoc quan he gan day:\n' + retrievalPacket.criticalConstraints.relationshipConstraints.map(function (item) {
          const bits = [];
          if (item.intimacy_level && item.intimacy_level !== 'none') bits.push('than mat=' + item.intimacy_level);
          if (item.secrecy_state) bits.push('bi mat=' + item.secrecy_state);
          if (item.consent_state && item.consent_state !== 'unknown') bits.push('dong thuan=' + item.consent_state);
          if (item.emotional_aftermath) bits.push('du am=' + item.emotional_aftermath);
          return '- ' + item.pair_key + ': ' + bits.join(' | ');
        }).join('\n'));
      }
      if (constraints.length > 0) {
        canonBits.push('Rang buoc cung:\n' + constraints.join('\n'));
      }
    }
    if (retrievalPacket.relevantEvidence?.length > 0) {
      canonBits.push('Bang chung lien quan:\n' + retrievalPacket.relevantEvidence.map(function (item) {
        return '- ' + (item.summary || item.evidence_text || item.target_type || 'Bang chung');
      }).join('\n'));
    }
    if (canonBits.length > 0) {
      systemParts.push('\n[CANON ENGINE]\n' + canonBits.join('\n\n'));
    }
  }

  if (retrievalPacket?.recentChapterMemory?.length > 0 && WRITING_TASKS_FOR_BRIDGE.has(taskType) && !skipWritingLayers) {
    const memoryBlock = retrievalPacket.recentChapterMemory
      .map(function (item) {
        const parts = [];
        parts.push('[' + (item.chapter_title || ('Chuong ' + (item.chapter_order + 1))) + ']');
        if (item.summary) parts.push('Tom tat: ' + item.summary);
        if (item.bridge_buffer) parts.push('Nhip van noi tiep: ' + item.bridge_buffer);
        if (item.emotional_state?.mood || item.emotional_state?.activeConflict || item.emotional_state?.lastAction) {
          parts.push('Du am cam xuc: ' + JSON.stringify(item.emotional_state));
        }
        if (item.events?.length > 0) {
          parts.push('Su kien then chot:\n' + item.events.map(function (event) {
            return '- ' + (event.summary || event.op_type || 'Su kien');
          }).join('\n'));
        }
        if (item.prose) parts.push('Van ban chuong:\n' + item.prose);
        return parts.join('\n');
      })
      .join('\n\n-----\n\n');
    systemParts.push(`\n[BO NHO ${retrievalPacket.recentChapterMemory.length} CHUONG GAN NHAT]\n${memoryBlock}`);
  }

  // -- Layer 6.5: Plot Threads --
  if (plotThreads.length > 0) {
    var cappedThreads = plotThreads.slice(0, 10);
    const threadInfo = cappedThreads.map(function (pt) {
      const typeMap = { main: 'Tuyen Chinh', subplot: 'Tuyen Phu', character_arc: 'Phat Trien Nhan Vat', mystery: 'Bi An', romance: 'Tinh Cam' };
      const ptType = typeMap[pt.type] || 'Tuyen Truyen';
      const mark = pt.is_focus_in_scene ? '[TIEU DIEM CANH] ' : '';
      return '- ' + mark + '[' + ptType + '] ' + pt.title + (pt.description ? ': ' + pt.description : '');
    }).join('\n');
    systemParts.push('\n[CAC TUYEN TRUYEN DANG MO]\n' + threadInfo);
  }

  // -- Layer 7: Style DNA --
  const styleDNALayer = buildStyleDNALayer(taskType, resolvedWritingStyle);
  if (styleDNALayer && !skipWritingLayers) {
    systemParts.push(styleDNALayer);
    // Anti-AI Blacklist — append vào cùng block với Style DNA
    const antiAIBlock = buildAntiAIBlock(resolvedWritingStyle);
    if (antiAIBlock) systemParts.push(antiAIBlock);
  }

  // -- Layer 7.5: Mood Board --
  const moodBoardLayer = buildMoodBoardLayer(
    taskType,
    genreKey,
    bridgeBuffer,
    selectedText || ''
  );
  if (moodBoardLayer && !skipWritingLayers) {
    systemParts.push(moodBoardLayer);
  }

  // -- Layer 10: Length & Rhythm Anchor (reframed: positive > negative) --
  if (WRITING_TASKS_FOR_BRIDGE.has(taskType) && !skipWritingLayers) {
    systemParts.push('\n[DO DAI VA NHIP DO]\n' + [
      '1. Phat trien day du moi canh truoc khi chuyen tiep — moi hanh dong nho duoc mieu ta 3-5 cau, tao hinh anh song dong.',
      '2. Suy nghi noi tam duoc dao sau it nhat 1 doan van day du.',
      '3. Huong toi 2000-4000 tu moi lan sinh, dong gop vao muc tieu 7000 tu cho CA CHUONG (khong phai 1 lan).',
      '4. Duy tri nhip ke lien tuc — moi cau day chuyen tiep sang cau sau tu nhien.',
      '5. Neu gan het do dai output: dung lai o diem kich tinh, de ngo cho phan tiep. Tot hon la de doc gia them muon doc tiep hon la cuong ket thuc.',
      '6. CAU TRUC DOAN VAN: 30-50% doan nen la doan 1-2 cau. Thong tin quan trong tach rieng thanh doan ngan. KHONG viet khoi van dai 5-6 cau lien tuc.',
      '7. MOI DOAN toi da 80-100 tu. Doan dai hon → tach thanh 2. Doc gia Viet doc nhanh, doan ngan de theo doi.',
      '8. NHIP THO: Xen ke doan ngan (1-2 cau) va doan dai (3-4 cau) — nhu nhip tho van xuoi. Tranh viet deu deu cung nhip.',
    ].join('\n'));
  }

  // =============================================
  // Build user message
  // =============================================
  let userContent = '';

  switch (taskType) {
    case TASK_TYPES.CONTINUE:
      userContent = 'Viet tiep:\n\n' + (sceneText || selectedText || '');
      if (userPrompt) userContent += '\n\n[HUONG DAN CUA TAC GIA]: ' + userPrompt;
      break;

    case TASK_TYPES.REWRITE:
      userContent = 'Viet lai doan sau:\n\n---\n' + (selectedText || sceneText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[HUONG DAN CUA TAC GIA]: ' + userPrompt;
      break;

    case TASK_TYPES.EXPAND:
      userContent = 'Mo rong doan sau:\n\n---\n' + (selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[HUONG DAN CUA TAC GIA]: ' + userPrompt;
      break;

    case TASK_TYPES.BRAINSTORM:
      userContent = userPrompt
        ? 'Brainstorm: ' + userPrompt
        : 'Goi y 5 huong phat trien tiep theo cho canh/chuong hien tai.\n\nNoi dung hien tai:\n' + (sceneText || '(chua co noi dung)');
      break;

    case TASK_TYPES.OUTLINE:
      userContent = userPrompt
        ? 'Tao outline: ' + userPrompt
        : 'Tao outline 5-8 diem cho chuong tiep theo.\n\n' + (sceneText || '');
      break;

    case TASK_TYPES.PLOT_SUGGEST:
      userContent = 'Noi dung hien tai:\n' + (sceneText || '');
      break;

    case TASK_TYPES.SUMMARIZE:
    case TASK_TYPES.CHAPTER_SUMMARY:
      userContent = sceneText || selectedText || '';
      break;

    case TASK_TYPES.EXTRACT_TERMS:
    case TASK_TYPES.FEEDBACK_EXTRACT:
      userContent = '---\n' + (sceneText || selectedText || '') + '\n---';
      break;

    case TASK_TYPES.CONTINUITY_CHECK:
    case TASK_TYPES.QA_CHECK:
      userContent = '[NOI DUNG CAN RA SOAT]\n---\n' + (sceneText || selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[UU TIEN CUA TAC GIA]\n' + userPrompt;
      break;

    case TASK_TYPES.STYLE_ANALYZE:
      userContent = '[VAN BAN MAU CAN PHAN TICH]\n---\n' + (sceneText || selectedText || '') + '\n---';
      if (userPrompt) userContent += '\n\n[LUU Y CUA TAC GIA]\n' + userPrompt;
      break;

    case TASK_TYPES.STYLE_WRITE:
      userContent = '';
      if (selectedText || sceneText) {
        userContent += '[VAN PHONG MAU]\n---\n' + (selectedText || sceneText || '') + '\n---\n\n';
      }
      userContent += '[YEU CAU NOI DUNG MOI]\n' + (userPrompt || 'Hay viet mot doan moi theo van phong mau.');
      break;

    case TASK_TYPES.AI_GENERATE_ENTITY: {
      const targetType = entityType || 'character';
      const isBatchMode = Number(batchCount) > 1;
      const count = Math.max(1, Number(batchCount) || 1);
      const labelMap = {
        character: 'nhan vat',
        location: 'dia diem',
        object: 'vat pham',
        term: 'thuat ngu',
      };
      const schemaMap = {
        character: '{"name":"Ten nhan vat","role":"protagonist|antagonist|supporting|mentor|minor","appearance":"Mo ta 2-3 cau","personality":"Mo ta 2-3 cau","personality_tags":"tag1, tag2","flaws":"Diem yeu/khuyet diem","goals":"Muc tieu","secrets":"Bi mat neu co","notes":"Vai tro trong cot truyen"}',
        location: '{"name":"Ten dia diem","description":"Mo ta 2-3 cau","details":"Chi tiet bo sung, kien truc, bi mat..."}',
        object: '{"name":"Ten vat pham","description":"Mo ta 2-3 cau","properties":"Cong dung, thuoc tinh, han che","owner":"Ten chu so huu neu co"}',
        term: '{"name":"Ten thuat ngu","definition":"Dinh nghia 3-5 cau","category":"magic|organization|race|technology|concept|culture|other"}',
      };
      const singularSchema = schemaMap[targetType] || schemaMap.character;
      const outputSchema = isBatchMode
        ? '{ "items": [' + singularSchema + '] }'
        : singularSchema;

      userContent = '[LOAI THUC THE]\n' + (labelMap[targetType] || targetType);
      userContent += '\n\n[SO LUONG]\n' + (isBatchMode ? count + ' muc' : '1 muc');
      if (projectTitle) userContent += '\n\n[TEN TRUYEN]\n' + projectTitle;
      if (entityContextText) userContent += '\n\n[BOI CANH HIEN CO]\n' + entityContextText;
      userContent += '\n\n[YEU CAU CUA TAC GIA]\n' + (userPrompt || 'Hay tao mot muc phu hop voi du an nay.');
      userContent += '\n\n[OUTPUT JSON BAT BUOC]\n' + outputSchema;
      break;
    }

    case TASK_TYPES.SCENE_DRAFT:
      userContent = userPrompt
        ? userPrompt
        : 'Viet ban nhap cuc ky chi tiet va dai cho canh "' + (sceneTitle || 'chua dat ten') + '", muc tieu la 1500-2500 tu de huong toi chuan muc 1 chuong dai 7000 tu.';
      break;

    case TASK_TYPES.ARC_OUTLINE: {
      const arcParts = [];
      if (userPrompt) arcParts.push('Muc tieu Arc: ' + userPrompt);
      arcParts.push('Chuong moi phai bat dau tu: Chuong ' + startChapterNumber);
      arcParts.push('So luong chuong can tao: ' + (context.chapterCount || 10));
      if (context.arcPacing) {
        const pacingDesc = { slow: 'Cham - xay dung, kham pha', medium: 'Trung binh', fast: 'Nhanh - hanh dong, cao trao' };
        arcParts.push('Nhip do: ' + (pacingDesc[context.arcPacing] || context.arcPacing));
      }
      if (previousSummary) arcParts.push('\nTom tat chuong truoc:\n' + previousSummary);
      const existingBriefText = formatChapterBriefList(existingChapterBriefs, {
        header: '[CAC CHUONG DA CO - KHONG DUOC LAP LAI]',
        limit: 12,
      });
      if (existingBriefText) arcParts.push(existingBriefText);
      userContent = arcParts.join('\n');
      break;
    }

    case TASK_TYPES.ARC_CHAPTER_DRAFT: {
      userContent = '[DAN Y CHUONG]\n';
      userContent += 'So chuong thuc te: ' + startChapterNumber + '\n';
      userContent += 'Tieu de: ' + (context.chapterOutlineTitle || '') + '\n';
      userContent += 'Tom tat: ' + (context.chapterOutlineSummary || '') + '\n';
      if (context.chapterOutlineEvents) {
        userContent += 'Su kien chinh:\n' + context.chapterOutlineEvents.map(e => '- ' + e).join('\n');
      }
      const existingBriefText = formatChapterBriefList(existingChapterBriefs, {
        header: '\n[CAC CHUONG DA CO - CHI NHAC LAI NGAN GON, KHONG VIET LAI]',
        limit: 10,
      });
      if (existingBriefText) userContent += '\n' + existingBriefText;
      const priorGeneratedText = formatChapterBriefList(priorGeneratedChapterBriefs, {
        header: '\n[CAC CHUONG MOI DA DUOC LEN DAN Y TRUOC CHUONG NAY]',
        limit: 6,
      });
      if (priorGeneratedText) userContent += '\n' + priorGeneratedText;
      break;
    }

    case TASK_TYPES.FREE_PROMPT:
      userContent = userPrompt || '';
      if (sceneText) {
        userContent += '\n\n[Noi dung canh hien tai:]\n' + sceneText;
      }
      break;

    case TASK_TYPES.SUGGEST_UPDATES: {
      const charStatuses = characters.map(function (c) {
        return '- ' + c.name + ': ' + (c.current_status || '(chua co trang thai)');
      }).join('\n');
      const existingFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');

      userContent = '[TRANG THAI HIEN TAI CUA NHAN VAT]\n' + (charStatuses || '(chua co nhan vat)');
      userContent += '\n\n[CANON FACTS HIEN CO]\n' + (existingFacts || '(chua co)');
      userContent += '\n\n[NOI DUNG CHUONG]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CHECK_CONFLICT: {
      const charStatuses = characters.map(function (c) {
        return '- ' + c.name + ': ' + (c.current_status || '(chua co trang thai)');
      }).join('\n');
      const existingFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');

      userContent = '[TRANG THAI NHAN VAT DE KIEM TRA]\n' + (charStatuses || '(chua co nhan vat)');
      userContent += '\n\n[CANON FACTS DE KIEM TRA]\n' + (existingFacts || '(chua co)');
      userContent += '\n\n[NOI DUNG CANH/CHUONG CAN KIEM TRA MAU THUAN]\n---\n' + (sceneText || selectedText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CANON_EXTRACT_OPS: {
      const knownCharacters = characters.map(function (c) {
        return '- ' + c.name + (c.current_status ? ': ' + c.current_status : '');
      }).join('\n');
      const knownThreads = plotThreads.map(function (pt) {
        return '- ' + pt.title + ' [' + (pt.state || 'active') + ']';
      }).join('\n');
      const knownFacts = canonFacts
        .filter(function (f) { return f.status === 'active'; })
        .map(function (f) { return '- [' + f.fact_type + '] ' + f.description; })
        .join('\n');
      const sceneTextList = (sceneList || []).map(function (scene) {
        return '[' + scene.index + '] ' + scene.title + '\n' + scene.text;
      }).join('\n\n');

      userContent = '[NHAN VAT DA BIET]\n' + (knownCharacters || '(khong co)');
      userContent += '\n\n[THREAD DA BIET]\n' + (knownThreads || '(khong co)');
      userContent += '\n\n[CANON FACTS DA BIET]\n' + (knownFacts || '(khong co)');
      userContent += '\n\n[DANH SACH CANH]\n' + (sceneTextList || '(khong co)');
      userContent += '\n\n[TOAN BO CHUONG]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.CANON_REPAIR: {
      const reportLines = (validatorReports || []).map(function (report, index) {
        return (index + 1) + '. [' + (report.rule_code || report.severity || 'report') + '] ' + report.message;
      }).join('\n');
      userContent = '[LOI CONTINUITY CAN SUA]\n' + (reportLines || '(khong co)');
      userContent += '\n\n[NOI DUNG CHUONG HIEN TAI]\n---\n' + (sceneText || '') + '\n---';
      break;
    }

    case TASK_TYPES.GENERATE_MACRO_MILESTONES: {
      userContent = '[Y TUONG TAC GIA]\n' + (authorIdea || userPrompt || '(Chua co y tuong cu the)');
      if (projectTitle) userContent += '\n\n[TEN TRUYEN]\n' + projectTitle;
      if (genre) userContent += '\n\n[THE LOAI]\n' + genre;
      if (targetLength > 0) userContent += '\n\n[DO DAI DU KIEN]\n' + targetLength + ' chuong';
      if (ultimateGoal) userContent += '\n\n[MUC TIEU CUOI CUNG]\n' + ultimateGoal;
      break;
    }

    case TASK_TYPES.AUDIT_ARC_ALIGNMENT: {
      const summaryText = Array.isArray(recentChapterSummaries) && recentChapterSummaries.length > 0
        ? recentChapterSummaries.map(function (item, index) {
          return (index + 1) + '. ' + (item.title || ('Chuong ' + (index + 1))) + ': ' + (item.summary || '(chua co tom tat)');
        }).join('\n')
        : '(Chua co chuong gan day)';
      userContent = '[CAC CHUONG GAN DAY]\n' + summaryText;
      if (ultimateGoal) userContent += '\n\n[DAI CUC]\n' + ultimateGoal;
      if (currentMacroArc?.title) {
        userContent += '\n\n[COT MOC DAI CUC HIEN TAI]\n' + currentMacroArc.title;
        if (currentMacroArc.description) userContent += '\n' + currentMacroArc.description;
      }
      if (currentArc?.title || currentArc?.goal) {
        userContent += '\n\n[ARC HIEN TAI]\n';
        if (currentArc.title) userContent += 'Ten arc: ' + currentArc.title;
        if (currentArc.goal) userContent += (currentArc.title ? '\n' : '') + 'Muc tieu arc: ' + currentArc.goal;
      }
      if (Number.isFinite(Number(currentChapterIndex))) {
        userContent += '\n\n[VI TRI HIEN TAI]\nChuong ' + (Number(currentChapterIndex) + 1);
      }
      break;
    }

    default:
      userContent = userPrompt || 'Hay giup toi voi tac pham nay.';
  }

  // -- Layer 9: Priority Anchor --
  // Append vào CUỐI userContent (không phải systemParts)
  // Double sandwich: Grand Strategy ở đầu + Priority Anchor ở cuối
  const priorityAnchor = buildPriorityAnchorLayer(taskType, userPrompt);
  if (priorityAnchor && !skipWritingLayers) {
    userContent += priorityAnchor;
  }

  if (nsfwMode || superNsfwMode) {
    userContent += '\n\n' + buildNsfwUserAnchor();
  }

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userContent },
  ];
}

export default { buildPrompt };
