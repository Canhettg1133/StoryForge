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
- Neu khong chac chan, giam confidence va ghi boundaryNote.
- Tong incident toi da: ${Math.max(1, Number(maxIncidents) || 120)}.
- Gioi han output: uu tien giu day du incidents[] truoc, rut gon note/evidence khi can.
- Neu bi gioi han output, dung meta.hasMore/meta.complete de phan manh output.

Schema output:
{
  "meta": {
    "part": 1,
    "hasMore": false,
    "complete": true
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
