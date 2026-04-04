import { normalizeForSearch } from '../utils/textUtils.js';

const KNOWN_FANDOMS = {
  naruto: {
    label: 'Naruto',
    aliases: ['Naruto', 'Naruto Shippuden', 'Boruto'],
    patterns: [
      /\buzumaki\s+naruto\b/g,
      /\bsasuke\b/g,
      /\bkakashi\b/g,
      /\bsakura\b/g,
      /\bkonoha\b/g,
      /\bchakra\b/g,
      /\bjutsu\b/g,
    ],
  },
  harry_potter: {
    label: 'Harry Potter',
    aliases: ['Harry Potter', 'HP', 'Wizarding World'],
    patterns: [
      /\bharry\s+potter\b/g,
      /\bvoldemort\b/g,
      /\bhogwarts\b/g,
      /\bmuggle\b/g,
      /\bquidditch\b/g,
      /\bazkaban\b/g,
    ],
  },
  one_piece: {
    label: 'One Piece',
    aliases: ['One Piece', 'OP'],
    patterns: [
      /\bluffy\b/g,
      /\bzoro\b/g,
      /\bsanji\b/g,
      /\bwhitebeard\b/g,
      /\bdevil\s+fruit\b/g,
      /\byonko\b/g,
      /\bmarineford\b/g,
    ],
  },
  dragon_ball: {
    label: 'Dragon Ball',
    aliases: ['Dragon Ball', 'DBZ', 'Dragon Ball Super'],
    patterns: [
      /\bgoku\b/g,
      /\bvegeta\b/g,
      /\bkamehameha\b/g,
      /\bsuper\s+saiyan\b/g,
      /\bfrieza\b/g,
      /\bki\b/g,
    ],
  },
  marvel: {
    label: 'Marvel',
    aliases: ['Marvel', 'MCU', 'Marvel Cinematic Universe'],
    patterns: [
      /\bavengers?\b/g,
      /\biron\s+man\b/g,
      /\bthor\b/g,
      /\bhulk\b/g,
      /\bspider\s*man\b/g,
      /\bshield\b/g,
    ],
  },
  dc: {
    label: 'DC',
    aliases: ['DC', 'DC Comics', 'DCEU'],
    patterns: [
      /\bbatman\b/g,
      /\bsuperman\b/g,
      /\bwonder\s+woman\b/g,
      /\bmetropolis\b/g,
      /\bgotham\b/g,
      /\bjustice\s+league\b/g,
    ],
  },
  attack_on_titan: {
    label: 'Attack on Titan',
    aliases: ['Attack on Titan', 'Shingeki no Kyojin', 'AoT'],
    patterns: [
      /\beren\b/g,
      /\bmikasa\b/g,
      /\barmin\b/g,
      /\bscout\s+regiment\b/g,
      /\btitan\b/g,
      /\bwall\s+(maria|rose|sina)\b/g,
    ],
  },
  my_hero_academia: {
    label: 'My Hero Academia',
    aliases: ['My Hero Academia', 'MHA', 'BNHA'],
    patterns: [
      /\bmidoriya\b/g,
      /\ball\s+might\b/g,
      /\bquirk\b/g,
      /\bua\s+high\b/g,
      /\bbakugo\b/g,
      /\btodoroki\b/g,
    ],
  },
  demon_slayer: {
    label: 'Demon Slayer',
    aliases: ['Demon Slayer', 'Kimetsu no Yaiba', 'KnY'],
    patterns: [
      /\btanjiro\b/g,
      /\bnezuko\b/g,
      /\bmuzan\b/g,
      /\bhashira\b/g,
      /\bbreathing\s+style\b/g,
      /\bnichirin\b/g,
    ],
  },
  genshin_impact: {
    label: 'Genshin Impact',
    aliases: ['Genshin Impact', 'Genshin'],
    patterns: [
      /\bteyvat\b/g,
      /\barchon\b/g,
      /\bvision\b/g,
      /\bfatui\b/g,
      /\btraveler\b/g,
      /\bpaimon\b/g,
    ],
  },
};

function countPatternHits(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function scoreFandom(text, fandom) {
  const matchedPatterns = [];
  let totalHits = 0;

  for (const pattern of fandom.patterns) {
    const hits = countPatternHits(text, pattern);
    if (hits > 0) {
      matchedPatterns.push({ pattern: pattern.source, hits });
      totalHits += hits;
    }
  }

  if (matchedPatterns.length === 0) {
    return null;
  }

  const coverage = matchedPatterns.length / fandom.patterns.length;
  const density = Math.min(1, totalHits / (matchedPatterns.length * 3));
  const confidence = Number((coverage * 0.65 + density * 0.35).toFixed(2));

  return {
    score: totalHits,
    matchedPatterns,
    confidence,
  };
}

export function detectFandom(text = '', options = {}) {
  const {
    minMatches = 2,
    minConfidence = 0.2,
  } = options;

  const normalizedText = normalizeForSearch(text);
  if (!normalizedText) {
    return [];
  }

  const results = [];

  for (const [key, fandom] of Object.entries(KNOWN_FANDOMS)) {
    const score = scoreFandom(normalizedText, fandom);
    if (!score) {
      continue;
    }

    if (score.matchedPatterns.length < minMatches || score.confidence < minConfidence) {
      continue;
    }

    results.push({
      key,
      label: fandom.label,
      aliases: fandom.aliases,
      score: score.score,
      confidence: score.confidence,
      matchedPatterns: score.matchedPatterns,
      matchedCount: score.matchedPatterns.length,
      totalPatternCount: fandom.patterns.length,
    });
  }

  return results.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.score - a.score;
  });
}

export function getFandomSuggestion(text = '', options = {}) {
  const detected = detectFandom(text, options);
  if (detected.length === 0) {
    return null;
  }

  return {
    fandom: detected[0].key,
    label: detected[0].label,
    confidence: detected[0].confidence,
    score: detected[0].score,
    alternatives: detected.slice(1, 4),
  };
}

export { KNOWN_FANDOMS };
