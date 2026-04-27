export function buildIncidentAnalysisPrompt(incident = {}, context = {}) {
  const title = String(incident.title || '').trim();
  const type = String(incident.type || 'subplot');
  const startChapter = incident.startChapter ?? incident.chapterStart ?? incident.chapterStartIndex ?? '?';
  const endChapter = incident.endChapter ?? incident.chapterEnd ?? incident.chapterEndIndex ?? '?';
  const confidence = Number(incident.confidence ?? 0).toFixed(2);
  const text = String(context.text || '').trim();

  return `
Ban dang phan tich mot incident cu the.

Incident:
- title: ${title}
- type: ${type}
- chapter range: ${startChapter} -> ${endChapter}
- confidence: ${confidence}

Yeu cau:
- Trich xuat events ben trong incident.
- Trich xuat locations lien quan.
- Tao causal links (causes / causedBy).
- Moi event can co chapter 1-based, severity, confidence va evidence.

Output JSON:
{
  "events": [
    {
      "id": "evt_...",
      "title": "",
      "description": "",
      "chapter": 1,
      "severity": "crucial|major|moderate|minor",
      "confidence": 0.7,
      "tags": [],
      "characters": [],
      "evidence": [],
      "causesEventIds": [],
      "causedByEventIds": []
    }
  ],
  "locations": [
    {
      "id": "loc_...",
      "name": "",
      "aliases": [],
      "eventIds": [],
      "confidence": 0.7,
      "importance": 0.7,
      "evidence": []
    }
  ],
  "climaxAnchor": { "eventId": "", "description": "" }
}

Context:
${text}
`.trim();
}
