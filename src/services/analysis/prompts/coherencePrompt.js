export function buildCoherencePrompt(payload = {}) {
  const incidentCount = Number(payload.incidentCount || 0);
  const eventCount = Number(payload.eventCount || 0);
  const locationCount = Number(payload.locationCount || 0);
  const summary = String(payload.summary || '').trim();

  return `
Nhiem vu: coherence pass cho ket qua incident-first.

Muc tieu:
1) Phat hien incident trung lap va de xuat merge.
2) Phat hien incident qua rong / gom 2 cum event khong lien thong.
3) Chuan hoa ten dia diem, ten nhan vat.
4) Kiem tra thu tu timeline va causal links.

Thong ke:
- incidents: ${incidentCount}
- events: ${eventCount}
- locations: ${locationCount}

Tom tat hien trang:
${summary}

Tra ve JSON gom:
{
  "mergeSuggestions": [],
  "splitSuggestions": [],
  "normalizationActions": [],
  "timelineFixes": []
}
`.trim();
}
