export function buildGlobalIncidentPassPrompt({
  chapterCount = 0,
  maxIncidents = 120,
  outputBudget = 65000,
} = {}) {
  return `
Ban la chuyen gia bien tap cot truyen cap cao.
Nhiem vu: doc TOAN BO corpus va trich xuat INCIDENT LON (khong tra event nho).

Muc tieu:
- Chi lay incident cap cao, co dau - cuoi ro rang.
- Moi incident phai tra loi duoc: vi sao quan trong, xay ra o dau, khoang chapter nao.
- Uu tien su kien "xuong song" cua truyen: khoi dau, bien co lon, re nhanh, doi huong, dinh diem, ket qua.

Quy tac bat buoc:
- CHI tra ve JSON hop le, khong markdown, khong code fence.
- Noi dung doc duoc boi con nguoi phai la tieng Viet.
- chapterStart/chapterEnd la so nguyen 1-based (1..${Math.max(1, Number(chapterCount) || 1)}).
- Khong tao incident placeholder, khong lap lai y nghia.
- Incident chi duoc promote len cap nay khi co thay doi ben vung ve muc tieu, luat choi, khong gian, nhom hoac phase truyen.
- Khong dua puzzle don le, canh gay soc, reveal ngan han, combat don le len incidents[] neu no nam trong mot incident lon hon.
- Neu khong chac chan, giam confidence va ghi boundaryNote.
- Tong incident toi da: ${Math.max(1, Number(maxIncidents) || 120)}.
- Dong thoi tra ve world_seed va style_seed o muc TOM TAT; khong co gang exhaustive.
- Gioi han output: uu tien giu day du incidents[] truoc, sau do den world_seed, style_seed; rut gon note/evidence khi can.
- Neu bi gioi han output, dung meta.hasMore/meta.complete de phan manh output.

Schema output:
{
  "meta": {
    "part": 1,
    "hasMore": false,
    "complete": true,
    "resumeFrom": ""
  },
  "world_seed": {
    "world_name": "",
    "world_type": "",
    "world_rules": [],
    "primary_locations": [],
    "dominant_forces": [],
    "world_description": ""
  },
  "style_seed": {
    "pov": "",
    "tense": "",
    "register": "",
    "tone": [],
    "dialogue_density": "low|medium|high",
    "description_density": "low|medium|high",
    "action_density": "low|medium|high",
    "style_signals": [],
    "motifs": []
  },
  "incidents": [
    {
      "id": "inc_...",
      "title": "",
      "type": "major_plot_point|subplot|pov_thread",
      "chapterStart": 1,
      "chapterEnd": 1,
      "confidence": 0.8,
      "description": "",
      "why": "",
      "anchorEventDescription": "",
      "locationHint": "",
      "tags": [],
      "boundaryNote": "",
      "evidence": []
    }
  ]
}

Output budget tham khao: ~${Math.max(1000, Number(outputBudget) || 65000)} tokens.
`.trim();
}

export default {
  buildGlobalIncidentPassPrompt,
};
