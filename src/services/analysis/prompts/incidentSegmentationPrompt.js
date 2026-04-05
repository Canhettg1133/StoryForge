export function buildSegmentationPrompt(context = {}, options = {}) {
  const chapterCount = Number(options.chapterCount || 0);
  const mode = String(options.mode || 'balanced');
  const text = String(context.text || '').trim();

  return `
Ban la chuyen gia phan tich truyen.
Nhiem vu: xac dinh cac INCIDENT cap cao trong bo truyen.

Quy tac:
- Incident la don vi cot truyen lon (khong phai moi event nho).
- Phan loai: major_plot_point | subplot | pov_thread.
- Boundary bat buoc dung chapter index (0-based), khong dung offset ky tu.
- Moi incident can co: title, type, startChapter, endChapter, confidence, evidence.
- Neu boundary mo ho, dat uncertainStart hoac uncertainEnd va ghi boundaryNote.

Output JSON:
{
  "incidents": [
    {
      "title": "...",
      "type": "major_plot_point|subplot|pov_thread",
      "startChapter": 0,
      "endChapter": 3,
      "confidence": 0.82,
      "uncertainStart": false,
      "uncertainEnd": false,
      "boundaryNote": "...",
      "evidence": ["..."],
      "description": "..."
    }
  ]
}

Mode: ${mode}
Tong so chapter: ${chapterCount}
Context:
${text}
`.trim();
}
