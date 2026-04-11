export function buildKnowledgeExtractionPrompt({ eventCount = 0 } = {}) {
  return `
Ban la chuyen gia bien tap tri thuc truyen.
Nhiem vu: chuan hoa bo tri thuc the gioi tu du lieu phan tich su kien.

Quy tac bat buoc:
- CHI tra ve JSON hop le, khong markdown, khong code fence.
- Noi dung doc duoc boi con nguoi phai la tieng Viet.
- Su dung world_seed, entity_mentions va style_seed trong context nhu goi y co can cu, nhung khong duoc chep may moc.
- locations chi la DIA DIEM VAT LY co the den duoc. Khong dua to chuc/khai niem vao locations.
- terms la khai niem/he thong/thuat ngu. objects la vat pham huu hinh.
- Moi timeline item dung schema: { eventId, chapter, summary }.
- eventId trong timeline phai tham chieu den event co trong context.
- Neu khong chac chan thi de rong [] thay vi doan.
- Uu tien recall de khong bo sot thuc the da duoc nhac den nhieu lan trong entity_mentions.
- Khong them thuc the moi neu context khong co bang chung.

Output JSON schema:
{
  "world_profile": {
    "world_name": "",
    "world_type": "",
    "world_scale": "",
    "world_era": "",
    "world_rules": [],
    "world_description": ""
  },
  "characters": [
    {
      "name": "",
      "role": "protagonist|antagonist|supporting|mentor|minor",
      "appearance": "",
      "personality": "",
      "personality_tags": [],
      "flaws": "",
      "goals": "",
      "secrets": "",
      "timeline": []
    }
  ],
  "locations": [
    {
      "name": "",
      "description": "",
      "aliases": [],
      "timeline": []
    }
  ],
  "objects": [
    {
      "name": "",
      "owner": "",
      "description": "",
      "properties": "",
      "timeline": []
    }
  ],
  "terms": [
    {
      "name": "",
      "category": "magic|organization|race|technology|concept|culture|other",
      "definition": "",
      "timeline": []
    }
  ]
}

Context co tong cong ${Number(eventCount) || 0} events.
`.trim();
}

export default {
  buildKnowledgeExtractionPrompt,
};
