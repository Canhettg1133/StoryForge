/**
 * Adaptation Service - AI-powered adaptation suggestions
 * Suggests equivalent events from other fandoms, provides warnings and notes
 */

import aiService from '../ai/client.js';

const ADAPTATION_TROPE_MAPPINGS = [
  // HP → generic
  { hp: 'rival_meeting', label: 'Gặp đối thủ' },
  { hp: 'secret_relationship', label: 'Quan hệ bí mật' },
  { hp: 'training_arc', label: 'Arc luyện tập' },
  { hp: 'betrayal_reveal', label: 'Reveal phản bội' },
  { hp: 'first_kiss', label: 'Nụ hôn đầu' },
  { hp: 'forbidden_love', label: 'Tình yêu bị cấm' },
  { hp: 'hurt_comfort', label: 'Tổn thương và an ủi' },
  { hp: 'enemy_to_lover', label: 'Từ thù thành yêu' },
  { hp: 'time_skip', label: 'Nhảy thời gian' },
  { hp: 'final_battle', label: 'Trận chiến cuối' },
  { hp: 'mentor_death', label: 'Cái chết của người dẫn dắt' },
  { hp: 'power_revelation', label: 'Reveal sức mạnh' },
  { hp: 'group_formation', label: 'Hình thành nhóm' },
  { hp: 'road_trip', label: 'Hành trình đường dài' },
  { hp: 'fake_dating', label: 'Hẹn hò giả' },
  { hp: 'forced_proximity', label: 'Bị buộc ở gần nhau' },
];

const TROPES_BY_FANDOM = {
  harry_potter: ['rival_meeting', 'secret_relationship', 'mentor_death', 'enemy_to_lover', 'hurt_comfort', 'forbidden_love'],
  naruto: ['rival_encounter', 'hidden_feelings', 'mentor_death', 'rival_to_ally', 'hurt_comfort', 'training_arc', 'group_formation'],
  one_piece: ['nakama_formation', 'training_arc', 'final_battle', 'betrayal_reveal', 'power_revelation'],
  dragon_ball: ['training_arc', 'final_battle', 'mentor_death', 'power_revelation', 'transformation'],
  attack_on_titan: ['betrayal_reveal', 'final_battle', 'mentor_death', 'group_formation', 'enemy_to_lover'],
  demon_slayer: ['mentor_death', 'hurt_comfort', 'training_arc', 'final_battle', 'enemy_to_lover'],
  my_hero_academia: ['training_arc', 'group_formation', 'final_battle', 'rival_encounter', 'enemy_to_lover'],
 Attack_on_Titan: ['betrayal_reveal', 'final_battle', 'mentor_death', 'group_formation'],
  generic: ['rival_meeting', 'secret_relationship', 'training_arc', 'betrayal_reveal', 'first_kiss', 'forbidden_love', 'hurt_comfort', 'enemy_to_lover'],
};

/**
 * Build adaptation prompt for AI
 */
function buildAdaptationPrompt(event, targetFandom, sourceFandom = 'HP') {
  const tropeList = ADAPTATION_TROPE_MAPPINGS.map(t => `  - ${t.label} (${t.hp})`).join('\n');

  return `Bạn là chuyên gia kể chuyện hỗ trợ chuyển thể biến cố giữa các vũ trụ hư cấu/fandom khác nhau.

## Nhiệm vụ
Chuyển thể biến cố sau từ ${sourceFandom} sang ${targetFandom}.

## Biến cố nguồn
Mô tả: ${event.description || 'N/A'}
Mức độ: ${event.severity || 'unknown'}
Chương: ${event.chapter || 'unknown'}
Tag: ${(event.tags || []).join(', ') || 'none'}
Canon/Fanon: ${event.canonOrFanon?.type || 'canon'}
Cường độ cảm xúc: ${event.emotionalIntensity || 5}/10
Độ dễ chèn vào truyện: ${event.insertability || 5}/10
Nhân vật liên quan: ${(event.characters || []).join(', ') || 'unknown'}

## Trope tương đương đã biết
${tropeList}

## Định dạng đầu ra
Chỉ trả JSON hợp lệ, không thêm văn bản ngoài JSON:
{
  "equivalentEvent": "Mô tả biến cố tương đương trong vũ trụ ${targetFandom}",
  "equivalentChapter": "Chương/arc gần đúng nơi biến cố này xảy ra",
  "characterEquivalent": "Nhân vật tương ứng trong ${targetFandom}",
  "cautions": [
    "Cảnh báo 1 khi chuyển thể, ví dụ khác biệt tính cách nhân vật",
    "Cảnh báo 2"
  ],
  "adaptationNotes": [
    "Điều chỉnh quan trọng cần làm 1",
    "Điều chỉnh quan trọng cần làm 2"
  ],
  "similarityScore": 0.85,
  "intensityMatch": "${event.emotionalIntensity >= 7 ? 'high' : event.emotionalIntensity >= 4 ? 'medium' : 'low'}",
  "tropesMatched": ["trope1", "trope2"]
}

## Quy tắc
- Chỉ xuất JSON hợp lệ, không dùng markdown code block.
- Nếu không có biến cố tương đương, đặt equivalentEvent là null và giải thích lý do trong cautions/adaptationNotes.
- Phải nêu nhân vật tương ứng cụ thể, không chỉ nói chung chung kiểu nguyên mẫu nhân vật giống nhau.
- cautions phải là cảnh báo có thể hành động, không phải lời khuyên chung chung.
- similarityScore chạy từ 0.0 (không khớp) đến 1.0 (gần như giống hệt).`;
}

/**
 * Parse AI response into structured adaptation result
 */
function parseAdaptationResponse(text) {
  try {
    // Try to extract JSON from response
    let jsonStr = text;

    // Remove markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Try direct parse
    try {
      return JSON.parse(jsonStr.trim());
    } catch {
      // Try to find JSON object in text
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) {
        return JSON.parse(objMatch[0]);
      }
    }

    throw new Error('Could not parse JSON from response');
  } catch (err) {
    // Return raw text as equivalent
    return {
      equivalentEvent: text.substring(0, 300),
      equivalentChapter: null,
      characterEquivalent: null,
      cautions: ['Could not parse AI response'],
      adaptationNotes: [],
      similarityScore: 0,
      intensityMatch: 'unknown',
      tropesMatched: [],
      _raw: text,
    };
  }
}

/**
 * Adapt a single event to target fandom
 */
export async function adaptEvent(event, targetFandom, sourceFandom = 'HP') {
  const prompt = buildAdaptationPrompt(event, targetFandom, sourceFandom);

  try {
    const response = await aiService.send({
      taskType: 'ADAPT_EVENT',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      nsfwMode: true,
    });

    const result = await new Promise((resolve, reject) => {
      let fullText = '';

      response.onToken = (token) => {
        fullText += token;
      };

      response.onComplete = () => {
        resolve(fullText);
      };

      response.onError = (err) => {
        reject(err);
      };
    });

    return parseAdaptationResponse(result);
  } catch (err) {
    return {
      equivalentEvent: null,
      equivalentChapter: null,
      characterEquivalent: null,
      cautions: [`AI error: ${err.message}`],
      adaptationNotes: [],
      similarityScore: 0,
      intensityMatch: 'unknown',
      tropesMatched: [],
      error: err.message,
    };
  }
}

/**
 * Adapt multiple events to target fandom
 */
export async function adaptEvents(events, targetFandom, sourceFandom = 'HP', onProgress) {
  const results = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    try {
      const result = await adaptEvent(event, targetFandom, sourceFandom);
      results.push({
        event,
        adaptation: result,
        index: i,
      });

      onProgress?.({
        current: i + 1,
        total: events.length,
        event: event.description?.substring(0, 50),
        result,
      });

      // Small delay to avoid rate limiting
      if (i < events.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      results.push({
        event,
        adaptation: { error: err.message },
        index: i,
      });
    }
  }

  return results;
}

/**
 * Find trope equivalents between two fandoms
 */
export async function findTropeEquivalentsForFandom(sourceFandom, targetFandom) {
  const sourceTropes = TROPES_BY_FANDOM[sourceFandom.toLowerCase()] || TROPES_BY_FANDOM.generic;
  const targetTropes = TROPES_BY_FANDOM[targetFandom.toLowerCase()] || TROPES_BY_FANDOM.generic;

  const equivalents = [];

  for (const trope of sourceTropes) {
    const hpMapping = ADAPTATION_TROPE_MAPPINGS.find(m => m.hp === trope);
    equivalents.push({
      sourceTrope: hpMapping?.label || trope,
      sourceKey: trope,
      targetEquivalent: targetTropes.includes(trope) ? trope : null,
      targetFandom,
    });
  }

  return equivalents;
}

/**
 * Get available fandoms for cross-reference
 */
export function getAvailableFandoms() {
  return [
    { id: 'harry_potter', label: 'Harry Potter' },
    { id: 'naruto', label: 'Naruto' },
    { id: 'one_piece', label: 'One Piece' },
    { id: 'dragon_ball', label: 'Dragon Ball' },
    { id: 'attack_on_titan', label: 'Attack on Titan' },
    { id: 'demon_slayer', label: 'Demon Slayer' },
    { id: 'my_hero_academia', label: 'My Hero Academia' },
    { id: 'generic', label: 'Generic / Universal' },
  ];
}

/**
 * Suggest all tropes for a fandom
 */
export function getTropesForFandom(fandom) {
  const tropes = TROPES_BY_FANDOM[fandom.toLowerCase()] || TROPES_BY_FANDOM.generic;
  return tropes.map(key => {
    const mapping = ADAPTATION_TROPE_MAPPINGS.find(m => m.hp === key);
    return {
      key,
      label: mapping?.label || key,
    };
  });
}

/**
 * Build comparison summary for adaptation panel
 */
export function buildAdaptationSummary(results) {
  const total = results.length;
  const successful = results.filter(r => !r.adaptation.error && r.adaptation.equivalentEvent).length;
  const avgSimilarity = results
    .filter(r => r.adaptation.similarityScore > 0)
    .reduce((sum, r, _, arr) => sum + (r.adaptation.similarityScore || 0) / arr.length, 0);

  const allCautions = results.flatMap(r => r.adaptation.cautions || []);
  const cautionCounts = {};
  for (const c of allCautions) {
    cautionCounts[c] = (cautionCounts[c] || 0) + 1;
  }

  const topCautions = Object.entries(cautionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  return {
    total,
    successful,
    failed: total - successful,
    successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
    avgSimilarity: Math.round(avgSimilarity * 100) / 100,
    topCautions,
    highIntensityMatches: results.filter(r =>
      r.adaptation.intensityMatch === 'high' && r.adaptation.equivalentEvent
    ).length,
    mediumIntensityMatches: results.filter(r =>
      r.adaptation.intensityMatch === 'medium' && r.adaptation.equivalentEvent
    ).length,
    lowIntensityMatches: results.filter(r =>
      r.adaptation.intensityMatch === 'low' && r.adaptation.equivalentEvent
    ).length,
  };
}
