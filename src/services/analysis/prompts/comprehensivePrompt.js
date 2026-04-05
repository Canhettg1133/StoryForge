const BASE_SCHEMA = `{
  "meta": {
    "part": 1,
    "hasMore": false,
    "complete": true,
    "coveredLayers": ["l1", "l2", "l3", "l4", "l5", "l6"]
  },
  "structural": {
    "characters": [],
    "ships": [],
    "tropes": [],
    "metadata": {}
  },
  "events": {
    "majorEvents": [],
    "minorEvents": [],
    "plotTwists": [],
    "cliffhangers": []
  },
  "worldbuilding": {
    "setting": {
      "worldName": "",
      "worldType": "",
      "worldScale": "",
      "worldEra": "",
      "rules": [],
      "description": ""
    },
    "powers": {},
    "magicSystem": {},
    "locations": [],
    "objects": [],
    "terms": []
  },
  "characters": {
    "profiles": []
  },
  "locations": [],
  "objects": [],
  "terms": [],
  "relationships": {
    "ships": [],
    "plotHoles": [],
    "unresolvedThreads": []
  },
  "craft": {
    "style": {},
    "emotional": {},
    "pacing": {},
    "dialogueTechniques": {}
  },
  "summary": {
    "rarityScore": 0,
    "keyTakeaways": [],
    "mostInsertableEvents": [],
    "mostInsertableCharacters": [],
    "warnings": [],
    "genre": "",
    "targetAudience": ""
  }
}`;

const LAYER_GUIDE = {
  l1: 'L1 structural: characters/ships/tropes/metadata.',
  l2: 'L2 events: major events, minor events, twists, cliffhangers.',
  l3: 'L3 worldbuilding: setting, power systems, lore rules.',
  l4: 'L4 characters: personality, motivation, arc progression.',
  l5: 'L5 relationships: ship dynamics, unresolved threads, plot holes.',
  l6: 'L6 craft: style, pacing, emotional patterns, dialogue techniques.',
};

export function buildComprehensivePrompt({ layers = [] } = {}) {
  const selectedLayers = Array.isArray(layers) && layers.length > 0
    ? layers
    : ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

  const layerNotes = selectedLayers
    .map((layer) => LAYER_GUIDE[layer])
    .filter(Boolean)
    .join('\n');

  return [
    'Ban la engine phan tich truyen chuyen nghiep.',
    'Phan tich toan bo corpus trong mot lan theo day du context va CHI tra ve JSON.',
    'Khong duoc tra ve markdown, giai thich van xuoi, hay code fence.',
    'Moi noi dung doc duoc boi con nguoi (title, description, note, summary,...) BAT BUOC bang tieng Viet.',
    'Key cua schema phai giu dung tieng Anh nhu mau JSON.',
    'Neu bi gioi han do dai, dat meta.hasMore=true va meta.complete=false.',
    // [FIX] Thêm: rule ưu tiên layer khi bị giới hạn token output
    'Neu bi gioi han token output, uu tien layer theo thu tu: L2 > L3 > L4 > L1 > L5 > L6. Giu du lieu quan trong cua layer uu tien cao truoc; duoc phep bo rut gon hoac bo qua hoan toan L5 va L6 khi output sap day.',
    'Khi duoc yeu cau tiep tuc, chi tra ve phan JSON hop le tiep theo.',
    'Danh dau ro cac diem hiem/quan trong cao trong truong rarity va note.',
    'Quy tac L2 bat buoc: moi event phai co description ro rang, chapter (so nguyen >=1), severity (crucial|major|moderate|minor), emotionalIntensity (1-10), insertability (1-10).',
    'Moi event can co id de cac thuc the khac lien ket timeline theo event id.',
    'Khong tao event rong, event placeholder, event trung lap y nghia. Neu khong du du lieu thi bo qua event do.',
    'Dung dung 4 nhom su kien: majorEvents, minorEvents, plotTwists, cliffhangers; khong doi ten key.',
    'Quy tac world/knowledge bat buoc:',
    '- worldbuilding.setting phai co: worldName, worldType, worldScale, worldEra, rules[], description.',
    '- locations chi gom DIA DIEM VAT LY co the den duoc. Khong dua to chuc/tong mon/khai niem vao locations.',
    '- Moi location phai co: name, description, aliases[], chapterStart, chapterEnd, timeline[].',
    // [FIX] Thêm: rule chống rác location - bắt buộc có nội dung thực
    '- Location BAT BUOC phai co description tu 20 ky tu tro len HOAC co it nhat 1 phan tu trong timeline[]. Location chi co ten ma description rong va timeline rong thi KHONG dua vao output.',
    '- Khong dua ho ten nhan vat, ten to chuc, ten the luc chinh tri, ten khai niem truu tuong vao mang locations. Chi dia diem vat ly co the di chuyen den duoc.',
    '- timeline[] cua location/object/term dung schema: { eventId, chapter, summary }.',
    '- characters.profiles moi item phai co: name, role, appearance, personality, personalityTags, flaws, goals, secrets, timeline[].',
    '- objects moi item phai co: name, owner, description, properties, timeline[].',
    '- terms moi item phai co: name, category, definition, timeline[].',
    '- Neu khong chac chan mot thuc the, bo qua. Khong du doan ten dia diem mo ho.',
    '',
    `Run these layers:\n${layerNotes}`,
    '',
    'Tra ve JSON theo schema nay (duoc phep bo sung gia tri phong phu hon):',
    BASE_SCHEMA,
  ].join('\n');
}

export default {
  buildComprehensivePrompt,
};
