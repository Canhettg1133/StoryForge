export function buildConsistencyCheckPrompt(payload = {}) {
  const incidentCount = Number(payload.incidentCount || 0);
  const eventCount = Number(payload.eventCount || 0);
  const locationCount = Number(payload.locationCount || 0);
  const context = String(payload.context || '').trim();

  return `
Ban la he thong kiem tra consistency cho truyen.

Can detect cac nhom loi:
- timeline_inversion
- state_contradiction
- impossible_co_location
- missing_prerequisite
- duplicate_anchors_conflict
- pov_continuity_break
- entity_collision
- span_anomaly
- evidence_mismatch

Thong ke:
- incidents: ${incidentCount}
- events: ${eventCount}
- locations: ${locationCount}

Context:
${context}

Output JSON:
{
  "risks": [
    {
      "type": "",
      "severity": "hard|medium|soft",
      "description": "",
      "chapterStart": 1,
      "chapterEnd": 1,
      "involvedIncidents": [],
      "involvedEvents": [],
      "involvedLocations": [],
      "evidence": []
    }
  ]
}
`.trim();
}
