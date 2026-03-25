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
  NSFW_CHRONO_STRUCTURE
} from '../../utils/constants';

// =============================================
// Layer 1: System Identity
// =============================================
const LAYER_1_IDENTITY = [
  'Ban la dong bien tap vien truyen chu chuyen nghiep trong ung dung StoryForge.',
  'Ban luon uu tien tinh nhat quan (consistency), giong van rieng cua tac pham, va tuan theo moi quy tac the gioi truyen.',
  'Ban viet bang tieng Viet tru khi duoc yeu cau khac.',
  'Ban KHONG tu y them phan giai thich, ghi chu, hay meta-commentary - chi tra ve ket qua yeu cau.',
  'Ban PHAI tuan thu tuyet doi moi cam ky (taboo) duoc liet ke.',
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
// Layer 2: Task Instructions
// =============================================
export const TASK_INSTRUCTIONS = {
  [TASK_TYPES.CONTINUE]: 'Viet tiep doan van, giu nguyen giong van va nhip ke. Hay mieu ta that chi tiet tung hanh dong, tam ly, canh vat, doi thoai. Viet DAI va CHI TIET, muc tieu 2000-4000 tu de dong gop vao muc tieu chuong truyen 7000 tu. KHONG viet ngan, KHONG luoc bo, KHONG tom tat.',
  [TASK_TYPES.REWRITE]: 'Viet lai doan van, cai thien van phong nhung giu nguyen noi dung va y nghia. Lam cho no tu nhien hon, giau cam xuc hon. Muc tieu tra ve tu 5000-7000 tu.',
  [TASK_TYPES.EXPAND]: 'Mo rong doan van, them chi tiet mieu ta, cam xuc, doi thoai, va hanh dong. Giu nguyen giong van. Viet CUC KY CHI TIET va DAI, muc tieu cot loi doan van duoc mo rong ra phai dai 7000 tu. Mieu ta dao sau vao tam ly nhan vat, boi canh, va tung hanh dong nho.',
  [TASK_TYPES.BRAINSTORM]: 'Brainstorm y tuong sang tao, dua ra nhieu huong khac nhau.',
  [TASK_TYPES.OUTLINE]: 'Tao outline cau truc ro rang, logic.',
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
 * Build Layer 0 — Grand Strategy.
 *
 * @param {string}      taskType
 * @param {object|null} currentMacroArc - record từ bảng macro_arcs
 * @param {object|null} currentArc      - record từ bảng arcs
 * @param {string}      ultimateGoal    - mục tiêu tổng thể từ project
 * @param {number}      targetLength    - tổng số chương dự kiến
 * @param {number}      currentChapterIndex
 * @returns {string}
 */
function buildGrandStrategyLayer(
  taskType,
  currentMacroArc,
  currentArc,
  ultimateGoal,
  targetLength,
  currentChapterIndex
) {
  if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
  if (!currentMacroArc && !currentArc) return '';

  const parts = [];

  // Phần 1: Cột mốc lớn (Macro Arc)
  if (currentMacroArc) {
    const macroLines = [];
    macroLines.push('Cot moc lon hien tai: ' + currentMacroArc.title);
    if (currentMacroArc.description) {
      macroLines.push('Mo ta: ' + currentMacroArc.description);
    }
    if (currentMacroArc.chapter_from && currentMacroArc.chapter_to) {
      macroLines.push(
        'Pham vi: Chuong ' + currentMacroArc.chapter_from +
        ' den Chuong ' + currentMacroArc.chapter_to
      );
    }
    if (currentMacroArc.emotional_peak) {
      macroLines.push('Cam xuc doc gia can dat khi ket thuc cot moc nay: ' + currentMacroArc.emotional_peak);
    }
    parts.push('[COT MOC LON]\n' + macroLines.join('\n'));
  }

  // Phần 2: Hồi truyện hiện tại (Arc)
  if (currentArc) {
    const arcLines = [];
    arcLines.push('Hoi truyen hien tai: ' + (currentArc.title || '(chua dat ten)'));
    if (currentArc.goal) {
      arcLines.push('Muc tieu hoi nay: ' + currentArc.goal);
    }
    if (currentArc.chapter_start && currentArc.chapter_end) {
      arcLines.push(
        'Pham vi: Chuong ' + currentArc.chapter_start +
        ' den Chuong ' + currentArc.chapter_end
      );
    }
    if (currentArc.power_level_start || currentArc.power_level_end) {
      arcLines.push(
        'Cap do suc manh trong hoi nay: ' +
        (currentArc.power_level_start || '?') + ' → ' +
        (currentArc.power_level_end || '?')
      );
    }
    parts.push('[HOI TRUYEN HIEN TAI]\n' + arcLines.join('\n'));
  }

  // Phần 3: Ràng buộc tuyệt đối
  const constraints = [];
  if (currentMacroArc?.chapter_to && targetLength > 0) {
    const remainingInMacro = currentMacroArc.chapter_to - (currentChapterIndex + 1);
    if (remainingInMacro > 0) {
      constraints.push(
        'Con ' + remainingInMacro + ' chuong nua moi ket thuc cot moc "' +
        currentMacroArc.title + '" — KHONG duoc giai quyet som.'
      );
    }
  }
  if (currentArc?.chapter_end) {
    const remainingInArc = currentArc.chapter_end - (currentChapterIndex + 1);
    if (remainingInArc > 0) {
      constraints.push(
        'Con ' + remainingInArc + ' chuong nua moi ket thuc hoi nay — ' +
        'KHONG duoc de nhan vat dat muc tieu hoi qua som.'
      );
    }
  }
  if (ultimateGoal) {
    constraints.push('Muc tieu CUOI CUNG cua ca bo truyen: "' + ultimateGoal + '" — TUYET DOI CHUA duoc dat den.');
  }

  if (constraints.length > 0) {
    parts.push('[RANG BUOC TUYET DOI - KHONG DUOC VI PHAM]\n' + constraints.map(function (c) { return '- ' + c; }).join('\n'));
  }

  if (parts.length === 0) return '';

  return '[CHIEN LUOC TONG THE - DAI CUC]\n' + parts.join('\n\n');
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

// =============================================
// Layer 7.5: Mood Board
//
// Inject 2-3 câu mẫu thể hiện đúng giọng văn cần đạt.
// Ưu tiên: câu hay nhất từ bridgeBuffer của tác giả (họ đã viết gì thì tiếp tục đúng tone đó).
// Fallback: MOOD_BOARD_DEFAULTS theo genre.
// =============================================

/**
 * Trích 1-2 câu dài nhất từ buffer làm mood sample.
 * Proxy đơn giản: câu dài = câu có nhiều thông tin và nhịp điệu.
 */
function extractMoodSamples(text, maxSamples) {
  if (!text || text.length < 30) return [];
  // Split theo dấu chấm / ! / ? / —
  const sentences = text
    .replace(/<[^>]*>/g, ' ')
    .split(/(?<=[.!?…])\s+|(?<=—)\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 30 && s.length < 300);

  // Lấy câu dài nhất (nhịp điệu thường tốt hơn)
  return sentences
    .sort((a, b) => b.length - a.length)
    .slice(0, maxSamples);
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
    lines.push('TRUOC KHI VIET, TU HOI TRONG 3 GIAY:');
    lines.push('1. Cam xuc doc gia khi doc DONG DAU TIEN chuong nay la gi?');
    lines.push('2. Nhan vat chinh thay doi nhu the nao khi KET THUC canh nay?');
    lines.push('3. Cau hoi nao doc gia se MANG SANG chuong tiep theo?');
    lines.push('Viet sao cho 3 cau hoi nay deu co cau tra loi RO RANG trong noi dung.');
    lines.push('KHONG can tra loi cac cau hoi nay — chi dam bao bai viet tra loi duoc chung.');
  } else {
    // EXPAND / REWRITE
    lines.push('');
    lines.push('RANG BUOC: KHONG thay doi su kien, huong di, hoac cam xuc goc cua doan van.');
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

  // -- Layer 0: Grand Strategy (Phase 9) --
  // Đặt trước Layer 1 để AI luôn thấy đại cục đầu tiên
  const grandStrategyLayer = buildGrandStrategyLayer(
    taskType,
    currentMacroArc,
    currentArc,
    ultimateGoal,
    targetLength,
    currentChapterIndex
  );
  if (grandStrategyLayer) {
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
  if (authorDNALayer) {
    systemParts.push(authorDNALayer);
  }

  // Inject Psychological Override if NSFW Mode is ON
  if (nsfwMode) {
    systemParts.push(NSFW_AUTHOR_DNA);
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

  // -- Layer 2: Task Instruction --
  const taskInstruction = promptTemplates[taskType] || TASK_INSTRUCTIONS[taskType];
  if (taskInstruction) {
    systemParts.push('\n[NHIEM VU]\n' + taskInstruction);
  }

  // -- Layer 3: Genre / AI Guidelines --
  if (aiGuidelines) {
    systemParts.push('\n[CHI DAN TAC GIA]\n' + aiGuidelines);
  } else {
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
  if (chapterOutlineLayer) {
    systemParts.push(chapterOutlineLayer);
  }

  // -- Layer 4.5: Pacing Control (AI Auto Generation) --
  // Lưu ý: Khi đã có Grand Strategy (Layer 0), Layer 4.5 đóng vai trò bổ sung
  // thông tin tiến độ số liệu (%), còn Grand Strategy cung cấp ngữ cảnh định tính.
  if (targetLength > 0 && ultimateGoal) {
    const progressPercent = Math.round((currentChapterIndex / targetLength) * 100);
    const pacingParts = [];
    pacingParts.push(`Truyen nay du kien dai ${targetLength} chuong. Hien tai dang o chuong ${currentChapterIndex + 1} (${progressPercent}% tien do).`);
    pacingParts.push(`Muc tieu cuoi cung cua toan bo truyen: "${ultimateGoal}".`);
    pacingParts.push(`TUYET DOI KHONG de nhan vat dat duoc muc tieu nay trong dot sinh nay.`);

    // Tìm milestone tiếp theo
    if (milestones.length > 0) {
      const nextMilestone = milestones.find(m => m.percent > progressPercent);
      if (nextMilestone) {
        pacingParts.push(`Cot moc ke tiep o ${nextMilestone.percent}%: "${nextMilestone.description}". Chua duoc phep vuot qua cot moc nay trong dot sinh nay.`);
      }
    }

    systemParts.push('\n[KIEM SOAT TIEN DO TRUYEN]\n' + pacingParts.join('\n'));
  }

  // -- Layer 5: Character State --
  if (characters.length > 0) {
    const charInfo = characters.map(function (c) {
      const parts = ['- ' + c.name + ' (' + (c.role || 'nhan vat') + ')'];
      if (c.pronouns_self) parts.push('  Xung: "' + c.pronouns_self + '"' + (c.pronouns_other ? ', goi nguoi: "' + c.pronouns_other + '"' : ''));
      if (c.appearance) parts.push('  Ngoai hinh: ' + c.appearance);
      if (c.personality_tags) parts.push('  Tags: ' + c.personality_tags);
      if (c.personality) parts.push('  Tinh cach: ' + c.personality);
      if (c.flaws) parts.push('  Diem yeu: ' + c.flaws);
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
  if (bridgeLayer) {
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
    const threadInfo = plotThreads.map(function (pt) {
      const typeMap = { main: 'Tuyen Chinh', subplot: 'Tuyen Phu', character_arc: 'Phat Trien Nhan Vat', mystery: 'Bi An', romance: 'Tinh Cam' };
      const ptType = typeMap[pt.type] || 'Tuyen Truyen';
      const mark = pt.is_focus_in_scene ? '[TIEU DIEM CANH] ' : '';
      return '- ' + mark + '[' + ptType + '] ' + pt.title + (pt.description ? ': ' + pt.description : '');
    }).join('\n');
    systemParts.push('\n[CAC TUYEN TRUYEN DANG MO (ACTIVE PLOT THREADS)]\n' + threadInfo + '\nLuu y: Duy tri hoac phat trien nhung mach truyen nay neu phu hop. Dac biet chu tam vao cac TIEU DIEM CANH.');
  }

  // -- Layer 7: Style DNA --
  // Thay thế Style Pack placeholder. Inject cho tất cả writing tasks.
  const styleDNALayer = buildStyleDNALayer(taskType, resolvedWritingStyle);
  if (styleDNALayer) {
    systemParts.push(styleDNALayer);
  }

  // -- Layer 7.5: Mood Board --
  // Câu mẫu giọng văn — từ bridgeBuffer của tác giả hoặc genre defaults
  const moodBoardLayer = buildMoodBoardLayer(
    taskType,
    genreKey,
    bridgeBuffer,
    selectedText || ''
  );
  if (moodBoardLayer) {
    systemParts.push(moodBoardLayer);
  }

  // -- Layer 8 (New): Content Boundary & NSFW OVERRIDE
  if (nsfwMode && !superNsfwMode) {
    systemParts.push('\n' + NSFW_RELATION_MATRIX);
    systemParts.push('\n' + NSFW_STYLE_EUPHEMISMS);
    systemParts.push('\n' + NSFW_CHRONO_STRUCTURE);
  }

  // -- Layer 10 (Critical): Length Anchor --
  if (WRITING_TASKS_FOR_BRIDGE.has(taskType)) {
    systemParts.push('\n[LUU Y QUAN TRONG VE DO DAI]\n' + [
      '1. KHONG duoc ket thuc canh hay chuong qua som.',
      '2. Moi hanh dong nho phai duoc mieu ta bang it nhat 3-5 cau van.',
      '3. Moi suy nghi noi tam phai duoc dao sau it nhat 1 doan van.',
      '4. Muc tieu cua ban la viet cang dai cang tot, huong toi con so 7000 tu.',
      '5. Tuyet doi KHONG tom tat dien bien nhanh.',
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
      arcParts.push('So luong chuong can tao: ' + (context.chapterCount || 10));
      if (context.arcPacing) {
        const pacingDesc = { slow: 'Cham - xay dung, kham pha', medium: 'Trung binh', fast: 'Nhanh - hanh dong, cao trao' };
        arcParts.push('Nhip do: ' + (pacingDesc[context.arcPacing] || context.arcPacing));
      }
      if (previousSummary) arcParts.push('\nTom tat chuong truoc:\n' + previousSummary);
      userContent = arcParts.join('\n');
      break;
    }

    case TASK_TYPES.ARC_CHAPTER_DRAFT: {
      userContent = '[DAN Y CHUONG]\n';
      userContent += 'Tieu de: ' + (context.chapterOutlineTitle || '') + '\n';
      userContent += 'Tom tat: ' + (context.chapterOutlineSummary || '') + '\n';
      if (context.chapterOutlineEvents) {
        userContent += 'Su kien chinh:\n' + context.chapterOutlineEvents.map(e => '- ' + e).join('\n');
      }
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
  if (priorityAnchor) {
    userContent += priorityAnchor;
  }

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userContent },
  ];
}

export default { buildPrompt };
