function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function buildDeepIncidentPassPrompt(incident = {}, options = {}) {
  const chapterCount = Math.max(1, Number(options.chapterCount) || 1);
  const eventBudget = Math.max(4, Number(options.eventBudget) || 24);

  const title = String(incident.title || '').trim();
  const incidentType = String(incident.type || 'subplot').trim() || 'subplot';
  const chapterStart = Number.isFinite(Number(incident.chapterStart))
    ? Number(incident.chapterStart)
    : 1;
  const chapterEnd = Number.isFinite(Number(incident.chapterEnd))
    ? Number(incident.chapterEnd)
    : chapterStart;
  const confidence = Number.isFinite(Number(incident.confidence))
    ? Number(incident.confidence).toFixed(2)
    : '0.65';
  const tags = toArray(incident.tags).map((item) => String(item || '').trim()).filter(Boolean);
  const evidence = toArray(incident.evidence).map((item) => String(item || '').trim()).filter(Boolean);

  return `
Ban la chuyen gia phan tich su kien lon trong truyen.
Nhiem vu: phan tich SAU mot incident da duoc xac dinh, va tra output co cau truc.

Incident:
- id: ${String(incident.id || '').trim()}
- title: ${title}
- type: ${incidentType}
- chapter range: ${chapterStart} -> ${chapterEnd} (1-based)
- confidence: ${confidence}
- tags: ${tags.join(', ')}
- evidence: ${evidence.join(' | ')}

Yeu cau bat buoc:
- CHI tra ve JSON hop le, khong markdown.
- Noi dung doc duoc boi con nguoi phai la tieng Viet.
- Tap trung vao dien bien chi tiet cua incident nay, khong mo rong sang incident khac qua nhieu.
- events[] chi chua event co y nghia dien bien (bo event vo thuong vo phat).
- chapter trong events/timeline phai la 1-based (1..${chapterCount}).
- Khong tao event trung lap y nghia.
- Trich mention theo bang chung co that; neu khong chac chan thi bo qua.
- style_evidence chi la quan sat ngan gon co bang chung, khong viet thanh bai binh van dai.
- Gioi han toi da ${eventBudget} events.

Schema output:
{
  "incident": {
    "description": "",
    "why": "",
    "preconditions": [],
    "progression": [],
    "turning_points": [],
    "climax": "",
    "outcome": "",
    "consequences": [],
    "evidence_refs": []
  },
  "events": [
    {
      "id": "evt_...",
      "description": "",
      "chapter": 1,
      "position": "beginning|middle|end",
      "severity": "crucial|major|moderate|minor",
      "eventType": "major|minor|twist|cliffhanger",
      "emotionalIntensity": 7,
      "insertability": 6,
      "characters": [],
      "tags": [],
      "locationName": "",
      "evidenceSnippet": "",
      "evidence": []
    }
  ],
  "locations": [
    {
      "name": "",
      "description": "",
      "aliases": [],
      "timeline": [
        {
          "eventId": "evt_...",
          "chapter": 1,
          "summary": ""
        }
      ]
    }
  ],
  "mentions": {
    "characters": [
      {
        "name": "",
        "roleHint": "",
        "eventIds": [],
        "chapters": [],
        "evidence": []
      }
    ],
    "objects": [
      {
        "name": "",
        "ownerHint": "",
        "kind": "",
        "eventIds": [],
        "chapters": [],
        "evidence": []
      }
    ],
    "terms": [
      {
        "name": "",
        "category": "",
        "definitionHint": "",
        "eventIds": [],
        "chapters": [],
        "evidence": []
      }
    ],
    "relationships": [
      {
        "source": "",
        "target": "",
        "type": "allies|enemies|romantic|family|neutral",
        "eventIds": [],
        "chapters": [],
        "evidence": []
      }
    ]
  },
  "style_evidence": {
    "observations": [
      {
        "chapter": 1,
        "eventId": "evt_...",
        "signalType": "dialogue_density|description_density|action_density|tone|pov|tense|motif|rhythm",
        "observation": "",
        "evidence": ""
      }
    ]
  }
}
`.trim();
}

export default {
  buildDeepIncidentPassPrompt,
};
