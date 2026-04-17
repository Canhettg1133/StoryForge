const STORAGE_KEY = 'sf-story-creation-settings';

const PROJECT_WIZARD_SYSTEM_PROMPT_LOCKED = `Tra ve CHINH XAC JSON format:
{
  "title": "Ten truyen chinh thuc",
  "title_options": ["Ten 1", "Ten 2", "Ten 3"],
  "premise": "Tom tat premise 2-3 cau",
  "world_profile": {
    "world_name": "Ten the gioi",
    "world_type": "Loai: tu tien / hien dai / sci-fi...",
    "world_scale": "Quy mo: 1 luc dia / nhieu gioi...",
    "world_era": "Thoi dai: thuong co / trung co / hien dai...",
    "world_rules": ["Quy tac 1", "Quy tac 2", "Quy tac 3"],
    "world_description": "Mo ta tong quan the gioi 2-3 cau"
  },
  "characters": [{"name": "...", "role": "protagonist|antagonist|supporting|mentor|minor", "appearance": "...", "personality": "...", "personality_tags": "tag1, tag2", "flaws": "diem yeu / khuyet diem luc dau", "goals": "...", "story_function": "vai tro trong cac chapter dau"}],
  "locations": [{"name": "...", "description": "...", "story_function": "dia diem nay dung de lam gi trong chapter dau"}],
  "objects": [{"name": "...", "description": "...", "owner": "...", "story_function": "chi them neu chapter dau that su can vat pham nay"}],
  "factions": [{"name": "...", "faction_type": "sect|kingdom|organization|other", "description": "...", "notes": "..."}],
  "terms": [{"name": "...", "definition": "...", "category": "magic|race|technology|other", "story_function": "thuat ngu nay anh huong gi toi chapter dau"}],
  "chapters": [{"title": "Chuong 1: ...", "purpose": "muc tieu ke chuyen cua chuong", "summary": "Tom tat noi dung chuong", "featured_characters": ["..."], "primary_location": "...", "thread_titles": ["..."], "key_events": ["neo noi bo neu can"], "required_factions": ["..."], "required_objects": ["..."]}],
  "plot_threads": [{"title": "...", "type": "main|subplot|character_arc|mystery|romance", "description": "mo ta tuyen truyen 1-2 cau", "state": "active", "opening_window": "xuat hien tu chuong nao", "anchor_chapters": ["Chuong 1", "Chuong 3"]}]
}

QUY TAC PHAN LOAI:
- "locations": chi la dia diem vat ly co the den duoc.
- "factions": tong mon, bang phai, vuong trieu, to chuc, the luc chinh tri.
- "terms": chi la khai niem tru tuong, he thong, chung toc, cong nghe.

QUY TAC TEN TRUYEN:
- "title" phai la ten day du, khong cat ngan tu premise.
- "title_options" phai co 3-5 phuong an du khac nhau, bam sat the loai va y tuong.

QUY TAC CHUONG VA ENTITY:
- "featured_characters", "primary_location", "thread_titles", "required_factions", "required_objects" trong tung chapter phai tham chieu toi entity/tuyen da tao o tren.
- Khong tao character/location/term chi duoc neu o codex ma khong lien he voi chapter.
- "objects" la field tuy chon, chi them neu chapter dau that su can va chapter outline co nhac den.
- Moi chapter phai co tien trien ro, nhung khong duoc nhoi qua nhieu bien co neu day moi la mo dau truyen.

Chi tra ve JSON, khong them gi khac.`;

const OUTLINE_GENERATION_SYSTEM_PROMPT_LOCKED = `Tra ve CHINH XAC JSON:
{
  "chapters": [
    {
      "title":"...",
      "purpose":"muc tieu ke chuyen cua chuong 1-2 cau",
      "summary":"tom tat noi dung 2-3 cau",
      "act":1,
      "featured_characters":["..."],
      "primary_location":"...",
      "thread_titles":["..."]
    }
  ],
  "plot_threads": [
    {
      "title":"...",
      "type":"main|subplot|character_arc|mystery|romance",
      "description":"mo ta tuyen truyen 1-2 cau",
      "state":"active",
      "anchor_chapters":["Chuong 1","Chuong 3"]
    }
  ]
}

QUY TAC THEM:
- "featured_characters" phai la nhan vat thuc su tham gia hoac bi anh huong manh trong chuong.
- "primary_location" phai la dia diem chinh cua chuong.
- "thread_titles" phai tro toi cac plot thread thuc su duoc day trong chuong do.
- Neu chapter chua can dung toi mot thread lon, dung gan vao cho du so.
- Outline phai ro duong day tien trien, khong duoc toan chapter na na nhau.

Chi tra ve JSON.`;

const THREAD_SUGGESTION_SYSTEM_PROMPT_LOCKED = `Tra ve CHINH XAC JSON:
{"plot_threads": [{"title":"...","type":"main|subplot|character_arc|mystery|romance","description":"mo ta 1-2 cau"}]}`;

const STORY_CREATION_SYSTEM_PROMPT_PROTECTIONS = {
  projectWizard: {
    marker: 'Tra ve CHINH XAC JSON format:',
    lockedPrompt: PROJECT_WIZARD_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract duoc khoa',
    description: 'Schema nay luon duoc app ghep lai de tranh vo parser khi AI Wizard tra ket qua.',
  },
  outlineGeneration: {
    marker: 'Tra ve CHINH XAC JSON:',
    lockedPrompt: OUTLINE_GENERATION_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract duoc khoa',
    description: 'Outline Board van cho sua huong dan, nhung block output JSON nay la bat bien.',
  },
  threadSuggestion: {
    marker: 'Tra ve CHINH XAC JSON:',
    lockedPrompt: THREAD_SUGGESTION_SYSTEM_PROMPT_LOCKED,
    label: 'JSON contract duoc khoa',
    description: 'Phan output nay duoc khoa de luong goi y plot thread luon parse on dinh.',
  },
};

export const STORY_CREATION_PROMPT_GROUPS = [
  {
    key: 'writingSystemIdentity',
    label: 'He thong viet truyen',
    description: 'Dung cho system identity mac dinh cua engine viet truyen tren toan bo app.',
    systemHelp: 'Sua khi muon doi vai tro mac dinh, nguyen tac nen va cach AI tu xac dinh ban than khi xu ly cac tac vu viet truyen.',
    userHelp: '',
    variables: [],
    showUserPrompt: false,
  },
  {
    key: 'projectWizard',
    label: 'Khoi tao du an bang AI',
    description: 'Dung cho AI Wizard khi sinh blueprint truyen moi tu y tuong ban dau.',
    systemHelp: 'Sua khi muon ep AI tuan thu vai tro, logic tao blueprint, pacing, va do bam sat giua entity voi outline.',
    userHelp: 'Sua khi muon bo sung thong tin dau vao, huong dan ve y tuong, tone, cau truc, do dai mong muon.',
    variables: [
      'genre',
      'tone',
      'pov_label',
      'pronoun_label',
      'target_length_label',
      'ultimate_goal',
      'synopsis_line',
      'story_structure_line',
      'idea',
      'template_hint',
      'initial_chapter_count',
      'pacing_guidance',
    ],
  },
  {
    key: 'outlineGeneration',
    label: 'Tao outline khoi dau',
    description: 'Dung khi tao outline khoi dau hoac bo sung purpose/summary trong Outline Board.',
    systemHelp: 'Sua khi muon thay doi cach AI lap dan y, cach neo plot thread vao chapter, va logic outline.',
    userHelp: 'Sua khi muon doi cau lenh yeu cau AI tao outline hoac bo sung outline dang co.',
    variables: [
      'genre',
      'project_title',
      'project_description',
      'character_list',
      'location_list',
      'existing_outline',
      'outline_task_instruction',
      'outline_user_request',
    ],
  },
  {
    key: 'threadSuggestion',
    label: 'Goi y tuyen truyen',
    description: 'Dung khi goi y them plot thread moi dua tren synopsis va outline hien tai.',
    systemHelp: 'Sua khi muon ep AI phan tich sau hon, tranh lap, hoac uu tien mot loai thread cu the.',
    userHelp: 'Sua khi muon doi cach dat yeu cau phan tich va goi y tuyen truyen.',
    variables: [
      'project_title',
      'genre',
      'synopsis',
      'character_list',
      'chapter_list',
      'existing_threads',
      'hint_section',
      'thread_user_request',
    ],
  },
];

export const DEFAULT_STORY_CREATION_SETTINGS = {
  writingSystemIdentity: {
    systemPrompt: `Ban la dong bien tap vien truyen chu chuyen nghiep trong ung dung StoryForge.
Ban uu tien so 1 la tinh nhat quan (consistency), giong van rieng cua tac pham, va logic noi tai cua the gioi truyen.
Mac dinh, ban viet bang tieng Viet tru khi duoc yeu cau khac.
Ban KHONG tu y them meta-commentary, ghi chu, hay giai thich du thua - chi tra ve dung noi dung task can.
Ban PHAI tuan thu tuyet doi moi taboo, blacklist, va quy tac an toan duoc cung cap.
Ban KHONG duoc tu y bo sung canon, nhan vat, dia danh, vat pham, ky nang, hay luat the gioi moi neu task hien tai khong cho phep sang tao mo rong ro rang.`,
    userPromptTemplate: ``,
  },
  projectWizard: {
    systemPrompt: `Ban la tro ly khoi tao du an truyen cho StoryForge.
Nhiem vu cua ban la tao mot blueprint ban dau cho du an, vua du de tac gia bat dau viet, nhung KHONG duoc sinh ra codex dep ma vo dung.

NGUYEN TAC BAT BUOC:
- So chapter trong "chapters" PHAI dung bang {{initial_chapter_count}}.
- Moi entity duoc tao ra phai co chuc nang ro trong phan chapter dau; neu khong can cho {{initial_chapter_count}} chapter dau thi KHONG tao.
- Nhan vat, dia diem, thuat ngu, va plot thread phai bam sat premise va phai duoc nhac den trong chapter outline.
- Nhac lai it nhung huu dung tot hon nhieu nhung roi rac.
- Nhip truyen phai phu hop voi do dai muc tieu va khong duoc tang toc qua tay trong giai doan mo dau.{{pacing_guidance}}`,
    userPromptTemplate: `The loai: {{genre}}
Tone: {{tone}}
Goc nhin: {{pov_label}}
Xung ho: {{pronoun_label}}
Do dai du kien: {{target_length_label}}
So chuong khoi dau: {{initial_chapter_count}}
Dich den toi thuong: {{ultimate_goal}}
{{synopsis_line}}{{story_structure_line}}Y tuong: {{idea}}{{template_hint}}`,
  },
  outlineGeneration: {
    systemPrompt: `Ban la tro ly lap outline truyen cho StoryForge.
Ban duoc phep sang tao trong pham vi outline, nhung phai giu outline co muc dich, co nhip, va bam sat du an.

NGUYEN TAC BAT BUOC:
- Moi chapter phai co "purpose" ro rang, khong duoc la chapter de day so.
- Moi plot thread phai co diem neo cu the trong it nhat mot chapter.
- Character usage va location usage phai ro, khong duoc mo ho.
- Khong duoc tang toc nhip qua tay o giai doan mo dau; khong nhoi qua nhieu bien co vao mot chapter.
- Khong duoc tao thread lon nhung khong co chapter nao gan vao.

Thong tin truyen:
- Ten: {{project_title}}
- Mo ta: {{project_description}}
- Nhan vat: {{character_list}}
- Dia diem: {{location_list}}
- Outline hien tai: {{existing_outline}}

{{outline_task_instruction}}`,
    userPromptTemplate: `{{outline_user_request}}`,
  },
  threadSuggestion: {
    systemPrompt: `Ban la tro ly phan tich cot truyen cho ung dung StoryForge.

Thong tin truyen:
- Ten: {{project_title}}
- The loai: {{genre}}
- Cot truyen: {{synopsis}}
- Nhan vat: {{character_list}}
- Outline chuong:
{{chapter_list}}

CAC TUYEN TRUYEN DA CO (khong duoc lap lai):
{{existing_threads}}
{{hint_section}}Nhiem vu: Doc toan bo thong tin tren, phan tich cac khoang trong chua duoc khai thac, va de xuat them 2-3 Plot Thread moi de cau chuyen them chieu sau.
- KHONG lap lai bat ky tuyen truyuyen da co.
- CHI goi y cac tuyen co tinh buoc ngoat, anh huong vi mo den nhieu chuong.
- KHONG tao tuyen truyen nho lat vat.`,
    userPromptTemplate: `{{thread_user_request}}`,
  },
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_STORY_CREATION_SETTINGS));
}

function stripProtectedSystemPrompt(groupKey, value) {
  const protection = STORY_CREATION_SYSTEM_PROMPT_PROTECTIONS[groupKey];
  const raw = String(value || '').trim();
  if (!protection || !raw) return raw;

  const marker = String(protection.marker || '').trim().toLowerCase();
  const markerIndex = marker ? raw.toLowerCase().indexOf(marker) : -1;
  if (markerIndex >= 0) {
    return raw.slice(0, markerIndex).trimEnd();
  }

  const lockedPrompt = String(protection.lockedPrompt || '').trim();
  if (lockedPrompt && raw.endsWith(lockedPrompt)) {
    return raw.slice(0, raw.length - lockedPrompt.length).trimEnd();
  }

  return raw;
}

export function getStoryCreationSystemPromptProtection(groupKey) {
  return STORY_CREATION_SYSTEM_PROMPT_PROTECTIONS[groupKey] || null;
}

export function composeStoryCreationSystemPrompt(groupKey, editablePrompt) {
  const basePrompt = stripProtectedSystemPrompt(groupKey, editablePrompt);
  const protection = getStoryCreationSystemPromptProtection(groupKey);
  if (!protection?.lockedPrompt) {
    return basePrompt;
  }

  return [basePrompt, protection.lockedPrompt.trim()]
    .filter(Boolean)
    .join('\n\n');
}

function normalizeSettings(input) {
  const defaults = cloneDefaults();
  const raw = input && typeof input === 'object' ? input : {};

  for (const group of STORY_CREATION_PROMPT_GROUPS) {
    const current = raw[group.key] && typeof raw[group.key] === 'object' ? raw[group.key] : {};
    defaults[group.key] = {
      systemPrompt: typeof current.systemPrompt === 'string'
        ? stripProtectedSystemPrompt(group.key, current.systemPrompt)
        : defaults[group.key].systemPrompt,
      userPromptTemplate: typeof current.userPromptTemplate === 'string'
        ? current.userPromptTemplate
        : defaults[group.key].userPromptTemplate,
    };
  }

  return defaults;
}

export function getStoryCreationSettings() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return cloneDefaults();
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(saved ? JSON.parse(saved) : null);
  } catch {
    return cloneDefaults();
  }
}

export function saveStoryCreationSettings(nextSettings) {
  const merged = normalizeSettings(nextSettings);
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}

export function resetStoryCreationSettings() {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
  return cloneDefaults();
}

export function resetStoryCreationGroup(groupKey) {
  const current = getStoryCreationSettings();
  const defaults = cloneDefaults();
  if (!defaults[groupKey]) return current;
  const next = { ...current, [groupKey]: defaults[groupKey] };
  return saveStoryCreationSettings(next);
}

export function renderStoryCreationTemplate(template, variables = {}) {
  return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = variables[key];
    return value === null || value === undefined ? '' : String(value);
  });
}
