/**
 * StoryForge - Prompt Builder v3 (Phase 4)
 *
 * 8-layer prompt architecture:
 *   1. System Identity
 *   2. Task Instruction
 *   3. Genre / AI Guidelines (editable, pre-filled from genre)
 *   4. Canon Context (world profile, terms, locations, objects, canon facts)
 *   5. Character State (characters + pronouns + relationships + taboos)
 *   6. Scene Contract (goal, conflict, must/must-not, pacing)
 *   7. Style Pack (placeholder - Phase 5)
 *   8. Output Format
 */

import { TASK_TYPES } from './router';
import { PRONOUN_PRESETS, GENRE_PRONOUN_MAP } from '../../utils/constants';

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
// Layer 2: Task Instructions
// =============================================
const TASK_INSTRUCTIONS = {
  [TASK_TYPES.CONTINUE]: 'Viet tiep doan van, giu nguyen giong van va nhip ke. Viet khoang 200-400 tu.',
  [TASK_TYPES.REWRITE]: 'Viet lai doan van, cai thien van phong nhung giu nguyen noi dung va y nghia. Lam cho no tu nhien hon, giau cam xuc hon.',
  [TASK_TYPES.EXPAND]: 'Mo rong doan van, them chi tiet mieu ta, cam xuc, va hanh dong. Giu nguyen giong van.',
  [TASK_TYPES.BRAINSTORM]: 'Brainstorm y tuong sang tao, dua ra nhieu huong khac nhau.',
  [TASK_TYPES.OUTLINE]: 'Tao outline cau truc ro rang, logic.',
  [TASK_TYPES.PLOT_SUGGEST]: 'Goi y 3 huong plot co the xay ra tiep theo. Moi huong gom: tom tat, xung dot, va dieu gi se thay doi.',
  [TASK_TYPES.SUMMARIZE]: 'Tom tat noi dung trong khoang 150-200 tu, giu cac su kien chinh, thay doi quan trong, va trang thai nhan vat.',
  [TASK_TYPES.EXTRACT_TERMS]: 'Trich xuat: 1) Ten nhan vat (va vai tro), 2) Dia danh, 3) Vat pham quan trong, 4) Thuat ngu the gioi truyen. Tra ve dang danh sach.',
  [TASK_TYPES.SCENE_DRAFT]: 'Viet ban nhap canh, khoang 800-1200 tu.',
  [TASK_TYPES.FREE_PROMPT]: '',
  [TASK_TYPES.CHAPTER_SUMMARY]: 'Tom tat chuong nay trong khoang 150-200 tu. Bao gom: su kien chinh, thay doi quan trong, nhan vat xuat hien, va trang thai ket thuc. Chi tra ve tom tat, khong them tieu de hay ghi chu.',
  [TASK_TYPES.FEEDBACK_EXTRACT]: [
    'Phan tich doan van va trich xuat thong tin moi duoi dang JSON. Tra ve CHINH XAC format nay:',
    '{',
    '  "characters": [{"name": "...", "role": "...", "appearance": "...", "personality": "..."}],',
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
    '  "characters": [{"name": "...", "role": "protagonist|antagonist|supporting|mentor|minor", "appearance": "mo ta ngan", "personality": "mo ta ngan", "goals": "muc tieu"}],',
    '  "locations": [{"name": "...", "description": "mo ta ngan"}],',
    '  "terms": [{"name": "...", "definition": "...", "category": "magic|organization|race|technology|other"}],',
    '  "chapters": [{"title": "Chuong 1: ...", "summary": "Tom tat noi dung chuong"}]',
    '}',
    'Tao 3-5 nhan vat, 3-5 dia diem, 3-5 thuat ngu, va 8-12 chuong. Chi tra ve JSON.',
  ].join('\n'),
};

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
    povMode = '',
    synopsis = '',
    storyStructure = '',
    pronounStyle = null,
  } = context;

  const systemParts = [];

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
  const taskInstruction = TASK_INSTRUCTIONS[taskType];
  if (taskInstruction) {
    systemParts.push('\n[NHIEM VU]\n' + taskInstruction);
  }

  // -- Layer 3: Genre / AI Guidelines --
  const genreKey = genre ? genre.toLowerCase().replace(/\s+/g, '_') : '';
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
      wpText += '\nQuy tac cot loi:\n' + worldProfile.rules.map(function(r) { return '* ' + r; }).join('\n');
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
    const locInfo = locations.map(function(l) {
      return '- ' + l.name + (l.description ? ': ' + l.description : '');
    }).join('\n');
    canonContextParts.push('Dia danh xuat hien:\n' + locInfo);
  }

  if (objects.length > 0) {
    const objInfo = objects.map(function(o) {
      return '- ' + o.name + (o.description ? ': ' + o.description : '');
    }).join('\n');
    canonContextParts.push('Vat pham:\n' + objInfo);
  }

  if (worldTerms.length > 0) {
    const termInfo = worldTerms.map(function(t) {
      return '- ' + t.name + (t.definition ? ': ' + t.definition : '');
    }).join('\n');
    canonContextParts.push('Thuat ngu the gioi:\n' + termInfo);
  }

  if (canonContextParts.length > 0) {
    systemParts.push('\n[BOI CANH TRUYEN]\n' + canonContextParts.join('\n\n'));
  }

  // -- Layer 5: Character State --
  if (characters.length > 0) {
    const charInfo = characters.map(function(c) {
      const parts = ['- ' + c.name + ' (' + (c.role || 'nhan vat') + ')'];
      if (c.pronouns_self) parts.push('  Xung: "' + c.pronouns_self + '"' + (c.pronouns_other ? ', goi nguoi: "' + c.pronouns_other + '"' : ''));
      if (c.appearance) parts.push('  Ngoai hinh: ' + c.appearance);
      if (c.personality) parts.push('  Tinh cach: ' + c.personality);
      return parts.join('\n');
    }).join('\n');
    systemParts.push('\n[NHAN VAT XUAT HIEN]\n' + charInfo);
  }

  // Relationships (Phase 4)
  if (relationships.length > 0) {
    const relInfo = relationships.map(function(r) {
      return '- ' + r.charA + ' <-> ' + r.charB + ': ' + r.label + (r.description ? ' (' + r.description + ')' : '');
    }).join('\n');
    systemParts.push('\n[QUAN HE NHAN VAT]\n' + relInfo);
  }

  // Taboos - tone adjusted by ai_strictness
  if (taboos.length > 0) {
    const tabooPrefix = aiStrictness === 'strict' ? 'TUYET DOI KHONG' :
                        aiStrictness === 'relaxed' ? 'Nen tranh' : 'Khong nen';
    const tabooLines = taboos.map(function(t) {
      const who = t.characterName || 'Tat ca nhan vat';
      return tabooPrefix + ': ' + who + ' - ' + t.description;
    }).join('\n');
    const tabooHeader = aiStrictness === 'strict' ? 'CAM KY - VI PHAM LA LOI NGHIEM TRONG' :
                        aiStrictness === 'relaxed' ? 'LUU Y - NEN TRANH' : 'CAM KY';
    systemParts.push('\n[' + tabooHeader + ']\n' + tabooLines);
  }

  // -- Layer 6: Scene Contract (Phase 4) --
  const contractParts = [];
  if (sceneContract.goal) contractParts.push('Muc tieu: ' + sceneContract.goal);
  if (sceneContract.conflict) contractParts.push('Xung dot: ' + sceneContract.conflict);
  if (sceneContract.emotional_start || sceneContract.emotional_end) {
    contractParts.push('Cam xuc: ' + (sceneContract.emotional_start || '?') + ' -> ' + (sceneContract.emotional_end || '?'));
  }
  if (sceneContract.must_happen && sceneContract.must_happen.length > 0) {
    contractParts.push('BAT BUOC xay ra:\n' + sceneContract.must_happen.map(function(m) { return '[v] ' + m; }).join('\n'));
  }
  if (sceneContract.must_not_happen && sceneContract.must_not_happen.length > 0) {
    contractParts.push('CAM xay ra:\n' + sceneContract.must_not_happen.map(function(m) { return '[x] ' + m; }).join('\n'));
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
    const facts = canonFacts.filter(function(f) { return f.status === 'active' && f.fact_type === 'fact'; });
    const secrets = canonFacts.filter(function(f) { return f.status === 'active' && f.fact_type === 'secret'; });
    const rules = canonFacts.filter(function(f) { return f.status === 'active' && f.fact_type === 'rule'; });
    const cParts = [];
    if (facts.length > 0) cParts.push('Su that:\n' + facts.map(function(f) { return '- ' + f.description; }).join('\n'));
    if (rules.length > 0) cParts.push('Quy tac:\n' + rules.map(function(f) { return '- ' + f.description; }).join('\n'));
    if (secrets.length > 0) cParts.push('BI MAT - CHUA TIET LO:\n' + secrets.map(function(f) { return '[x] ' + f.description; }).join('\n'));
    if (cParts.length > 0) systemParts.push('\n[CANON TRUYEN]\n' + cParts.join('\n\n'));
  }

  // -- Layer 7: Style Pack (Phase 5 placeholder) --

  // -- Layer 8: Output Format --
  if (taskType === TASK_TYPES.EXTRACT_TERMS || taskType === TASK_TYPES.FEEDBACK_EXTRACT) {
    systemParts.push('\n[OUTPUT FORMAT]\nTra ve dang danh sach hoac JSON nhu yeu cau. Khong them markdown formatting.');
  } else if (taskType === TASK_TYPES.SUMMARIZE || taskType === TASK_TYPES.CHAPTER_SUMMARY) {
    systemParts.push('\n[OUTPUT FORMAT]\nTra ve tom tat dang doan van. Khong them tieu de hay bullet points.');
  } else {
    systemParts.push('\n[OUTPUT FORMAT]\nTra ve prose tieng Viet. Khong them tieu de, ghi chu, hay giai thich.');
  }

  // =============================================
  // Build user message
  // =============================================
  let userContent = '';

  switch (taskType) {
    case TASK_TYPES.CONTINUE:
      userContent = 'Viet tiep:\n\n' + (sceneText || selectedText || '');
      break;

    case TASK_TYPES.REWRITE:
      userContent = 'Viet lai doan sau:\n\n---\n' + (selectedText || sceneText || '') + '\n---';
      break;

    case TASK_TYPES.EXPAND:
      userContent = 'Mo rong doan sau:\n\n---\n' + (selectedText || '') + '\n---';
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
        : 'Viet ban nhap cho canh "' + (sceneTitle || 'chua dat ten') + '", khoang 800-1200 tu.';
      break;

    case TASK_TYPES.FREE_PROMPT:
      userContent = userPrompt || '';
      if (sceneText) {
        userContent += '\n\n[Noi dung canh hien tai:]\n' + sceneText;
      }
      break;

    default:
      userContent = userPrompt || 'Hay giup toi voi tac pham nay.';
  }

  return [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'user', content: userContent },
  ];
}

export default { buildPrompt };
