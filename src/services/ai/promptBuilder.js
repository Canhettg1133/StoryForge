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
import {
  PRONOUN_PRESETS,
  GENRE_PRONOUN_MAP,
  AUTHOR_ROLE_TABLE,
  MOOD_BOARD_DEFAULTS,
  detectWritingStyle,
  NSFW_AUTHOR_DNA,
  NSFW_RELATION_MATRIX,
  NSFW_STYLE_EUPHEMISMS,
  NSFW_CHRONO_STRUCTURE,
  ANTI_AI_BLACKLIST,
} from '../../utils/constants';

export const DEFAULT_NSFW_RULES = [
  '[LUAT NSFW HE THONG - BAT BUOC TUAN THU]',
  'Khoi luat nay CHI duoc kich hoat khi du an bat Che do Truong thanh (NSFW).',
  'Khi da kich hoat, day la luat he thong muc cao: ban PHAI doc truoc, ghi nho trong suot lan tra loi hien tai, va tuan thu nhat quan o moi doan van duoc sinh ra.',
  'Khong duoc tu y lam nhe, lam sach, ne tranh, dao duc hoa, hay doi sang cach dien dat an toan hon neu tac gia khong yeu cau ro rang.',
  'Van phai giu canon, logic nhan vat, quan he nhan qua, nhip canh, va giong van cua truyen. NSFW khong co nghia la viet bua bai hay pha logic.',
  'Neu tac gia yeu cau giam do explicit, doi giong van, hoac doi bien do canh nong, hay uu tien yeu cau moi nhat cua tac gia.',
  NSFW_AUTHOR_DNA,
  NSFW_RELATION_MATRIX,
  NSFW_STYLE_EUPHEMISMS,
  NSFW_CHRONO_STRUCTURE,
].join('\n\n');

function resolveNsfwRules(promptTemplates) {
  if (!promptTemplates || typeof promptTemplates !== 'object') {
    return DEFAULT_NSFW_RULES;
  }

  const customRules = typeof promptTemplates.nsfw_rules === 'string'
    ? promptTemplates.nsfw_rules.trim()
    : '';

  return customRules || DEFAULT_NSFW_RULES;
}

// =============================================
// Layer 1: System Identity
// =============================================
const LAYER_1_IDENTITY = [
  'Ban la dong bien tap vien truyen chu chuyen nghiep trong ung dung StoryForge.',
  'Ban luon uu tien tinh nhat quan (consistency), giong van rieng cua tac pham, va tuan theo moi quy tac the gioi truyen.',
  'Ban viet bang tieng Viet tru khi duoc yeu cau khac.',
  'Ban KHONG tu y them phan giai thich, ghi chu, hay meta-commentary - chi tra ve ket qua yeu cau.',
  'Ban PHAI tuan thu tuyet doi moi cam ky (taboo) duoc liet ke.',
  'Ban KHONG duoc tu y tao ra nhan vat, dia danh, ky nang, he thong suc manh, hay bat ky thuc the nao CHUA DUOC liet ke trong Canon hoac The Gioi truyen — tru khi tac gia yeu cau ro rang hoac task la brainstorm/outline/project_wizard.',
].join('\n');

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
export const TASK_INSTRUCTIONS = {
  [TASK_TYPES.CONTINUE]: 'Viet tiep doan van, giu nguyen giong van va nhip ke. Hay mieu ta that chi tiet tung hanh dong, tam ly, canh vat, doi thoai. Viet DAI va CHI TIET, muc tieu 2000-4000 tu de dong gop vao muc tieu chuong truyen 7000 tu. KHONG viet ngan, KHONG luoc bo, KHONG tom tat. KHONG duoc nhay thoi gian (time skip) — moi su kien phai dien ra LIEN TUC tu vi tri cuoi cung, cam viet kieu "Ba ngay sau...", "Mot thoi gian troi qua...", "Khong lau sau...". Neu can chuyen canh, hay ket thuc canh hien tai bang cliffhanger roi mo canh moi tu nhien.',
  [TASK_TYPES.REWRITE]: 'Viet lai doan van, cai thien van phong nhung GIU NGUYEN noi dung, cot truyen va y nghia. Lam cho no tu nhien hon, giau cam xuc hon, nhip dieu tot hon. GIU do dai TUONG DUONG doan goc (cho phep dai hon 20-50% de them mieu ta cam xuc va chi tiet ngu giac). TUYET DOI KHONG tu y them su kien moi, nhan vat moi, dia danh moi, hay thay doi dien bien — chi nang cap cau van, nhip dieu, va chieu sau cam xuc.',
  [TASK_TYPES.EXPAND]: 'Mo rong doan van GAP 3-5 LAN do dai goc. Giu nguyen giong van va mach truyen. Them vao: mieu ta ngu giac (nhin/nghe/ngui/cham/vi), noi tam nhan vat, doi thoai tu nhien, va hanh dong cham (slow motion). KHONG duoc them su kien moi hay thay doi cot truyen — chi lam PHONG PHU nhung gi da co. Dao sau vao tam ly nhan vat (ho nghi gi, so gi, muon gi trong khoang khac do), boi canh (am thanh, mui, anh sang, nhiet do), va tung cu dong nho.',
  [TASK_TYPES.BRAINSTORM]: [
    'Brainstorm 5 y tuong KHAC BIET cho tinh huong dang xet. Moi y tuong gom:',
    '1. Tom tat huong di (2-3 cau)',
    '2. Xung dot chinh se la gi — nhan vat doi mat voi thach thuc/mat mat gi',
    '3. Nhan vat nao bi anh huong nhieu nhat va thay doi nhu the nao',
    '4. Diem hay: tai sao huong nay hap dan doc gia',
    '5. Rui ro: diem nao co the bi nhat/chen ep neu khong xu ly tot',
    '',
    'Sap xep tu AN TOAN nhat (theo logic truyen) den TAO BAO nhat (bat ngo nhung van hop ly).',
    'KHONG chon y tuong chung chung kieu "nhan vat manh len". Moi y tuong phai co XUNG DOT that su va HE QUA ro rang.',
  ].join('\n'),
  [TASK_TYPES.OUTLINE]: [
    'Tao outline CHI TIET 5-8 diem chinh cho chuong/phan tiep theo. Moi diem bao gom:',
    '- Su kien/hanh dong CU THE (khong chung chung kieu "nhan vat chien dau" — ma phai la "nhan vat bi don vao the ket, phai chon giua mat mang hoac phan boi...")',
    '- Cam xuc nhan vat chuyen bien nhu the nao qua su kien do',
    '- Lien ket voi tuyen truyen nao dang mo (neu co)',
    '',
    'Outline phai co 3 phan:',
    '- HOOK: diem cuon hut o dau — doc gia doc dong dau tien phai muon doc tiep',
    '- ESCALATION: tang dan cang thang va do phuc tap qua tung diem',
    '- CLIFFHANGER: ket mo bang cau hoi/tinh huong khien doc gia khong the ngu duoc',
  ].join('\n'),
  [TASK_TYPES.PLOT_SUGGEST]: 'Goi y 3 huong plot co the xay ra tiep theo. Moi huong gom: tom tat, xung dot, va dieu gi se thay doi.',
  [TASK_TYPES.SUMMARIZE]: 'Tom tat noi dung trong khoang 150-200 tu, giu cac su kien chinh, thay doi quan trong, va trang thai nhan vat.',
  [TASK_TYPES.EXTRACT_TERMS]: 'Trich xuat: 1) Ten nhan vat (va vai tro), 2) Dia danh, 3) Vat pham quan trong, 4) Thuat ngu the gioi truyen. Tra ve dang danh sach.',
  [TASK_TYPES.SCENE_DRAFT]: 'Viet ban nhap canh nay, mo ta sau vao tung cu chi tam ly. Viet khoang 2000-4000 tu/lan sinh de dong gop vao muc tieu chuong truyen tong cong 7000 tu. CANG DAI CANG TOT.',
  [TASK_TYPES.CHECK_CONFLICT]: [
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
  ].join('\n'),
  [TASK_TYPES.FREE_PROMPT]: 'Thuc hien yeu cau cua tac gia. Neu duoc yeu cau viet noi dung truyen, hay viet CUC KY CHI TIET: mieu ta hanh dong, tam ly, doi thoai, canh vat. Muc tieu toi thieu 5000-7000 tu cho ca chuong. Moi phan tra ve phai dai it nhat 3000-4000 tu.',
  [TASK_TYPES.CHAPTER_SUMMARY]: 'Tom tat chuong nay trong khoang 150-200 tu. Bao gom: su kien chinh, thay doi quan trong, nhan vat xuat hien, va trang thai ket thuc. Chi tra ve tom tat, khong them tieu de hay ghi chu.',
  [TASK_TYPES.FEEDBACK_EXTRACT]: [
    'Phan tich doan van va trich xuat thong tin moi duoi dang JSON. Tra ve CHINH XAC format nay:',
    '{',
    '  "characters": [{"name": "...", "role": "...", "appearance": "...", "personality": "...", "personality_tags": "tag1, tag2", "flaws": "diem yeu / khuyet diem"}],',
    '  "locations": [{"name": "...", "description": "..."}],',
    '  "terms": [{"name": "...", "definition": "...", "category": "..."}],',
    '  "objects": [{"name": "...", "description": "...", "owner": "..."}]',
    '}',
    'Chi liet ke thong tin MOI xuat hien. Neu khong co gi moi, tra ve mang rong. Chi tra ve JSON, khong them gi khac.',
  ].join('\n'),
  [TASK_TYPES.AI_GENERATE_ENTITY]: '',
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
  [TASK_TYPES.SUGGEST_UPDATES]: [
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
  ].join('\n'),

  [TASK_TYPES.ARC_OUTLINE]: [
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
  ].join('\n'),

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
  } = context;

  // Resolve writing style: context > auto-detect từ genre
  const genreKey = genre ? genre.toLowerCase().replace(/\s+/g, '_') : '';
  const resolvedWritingStyle = writingStyle || detectWritingStyle(genreKey || '');
  const systemParts = [];

  // FREE_PROMPT: skip heavy writing layers for questions/chat
  const skipWritingLayers = taskType === TASK_TYPES.FREE_PROMPT && !isWritingIntent(userPrompt);

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
  if (nsfwMode) {
    systemParts.push(resolveNsfwRules(promptTemplates));
  }

  // -- Layer 1: System Identity --
  systemParts.push(LAYER_1_IDENTITY);

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

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userContent },
  ];
}

export default { buildPrompt };
