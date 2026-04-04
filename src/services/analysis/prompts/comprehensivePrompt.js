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
    "setting": {},
    "powers": {},
    "magicSystem": {}
  },
  "characters": {
    "profiles": []
  },
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
    'Khi duoc yeu cau tiep tuc, chi tra ve phan JSON hop le tiep theo.',
    'Danh dau ro cac diem hiem/quan trong cao trong truong rarity va note.',
    'Quy tac L2 bat buoc: moi event phai co description ro rang, chapter (so nguyen >=1), severity (crucial|major|moderate|minor), emotionalIntensity (1-10), insertability (1-10).',
    'Khong tao event rong, event placeholder, event trung lap y nghia. Neu khong du du lieu thi bo qua event do.',
    'Dung dung 4 nhom su kien: majorEvents, minorEvents, plotTwists, cliffhangers; khong doi ten key.',
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
