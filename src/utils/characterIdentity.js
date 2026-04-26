function cleanText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_IDENTITY_LABELS = [
  'nhan vat chinh',
  'nhan vat phu',
  'nhan vat',
  'main character',
  'lead character',
  'protagonist',
  'character',
  'main',
  'mc',
];

const AMBIGUOUS_SINGLE_TOKENS = new Set([
  'anh',
  'em',
  'chi',
  'co',
  'ong',
  'ba',
  'minh',
  'ta',
  'toi',
  'han',
  'nang',
  'chang',
  'ngai',
  'nam',
  'nu',
]);

function stripDiacritics(value = '') {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCharacterIdentityKey(value = '') {
  let key = stripDiacritics(value)
    .replace(/[\u2018\u2019\u201c\u201d"'`()\[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const label of GENERIC_IDENTITY_LABELS) {
    key = key.replace(new RegExp(`\\b${label}\\b`, 'g'), ' ');
  }

  return key.replace(/\s+/g, ' ').trim();
}

function compactKey(value = '') {
  return normalizeCharacterIdentityKey(value).replace(/\s+/g, '');
}

function nameTokens(value = '') {
  return normalizeCharacterIdentityKey(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function numericTokens(value = '') {
  return normalizeCharacterIdentityKey(value).match(/\d+/g) || [];
}

function numericIdentityCompatible(left = '', right = '') {
  const leftNumbers = numericTokens(left);
  const rightNumbers = numericTokens(right);
  if (leftNumbers.length === 0 && rightNumbers.length === 0) return true;
  if (leftNumbers.length !== rightNumbers.length) return false;
  return leftNumbers.every((token, index) => token === rightNumbers[index]);
}

function uniqueText(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = normalizeCharacterIdentityKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function editDistance(left = '', right = '') {
  const a = compactKey(left);
  const b = compactKey(right);
  if (!a || !b) return Math.max(a.length, b.length);
  const dp = Array.from({ length: a.length + 1 }, (_, row) => [row]);
  for (let col = 1; col <= b.length; col++) dp[0][col] = col;
  for (let row = 1; row <= a.length; row++) {
    for (let col = 1; col <= b.length; col++) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

export function characterNameSimilarity(left = '', right = '') {
  const leftKey = normalizeCharacterIdentityKey(left);
  const rightKey = normalizeCharacterIdentityKey(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey || compactKey(leftKey) === compactKey(rightKey)) return 1;

  const leftTokens = new Set(nameTokens(leftKey));
  const rightTokens = new Set(nameTokens(rightKey));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenScore = union > 0 ? intersection / union : 0;
  const numbersCompatible = numericIdentityCompatible(leftKey, rightKey);
  const subsetScore = numbersCompatible && intersection >= 2 && intersection === Math.min(leftTokens.size, rightTokens.size)
    ? 0.92
    : 0;

  const leftCompact = compactKey(leftKey);
  const rightCompact = compactKey(rightKey);
  const maxLength = Math.max(leftCompact.length, rightCompact.length);
  const editScore = numbersCompatible && maxLength >= 4
    ? 1 - (editDistance(leftCompact, rightCompact) / maxLength)
    : 0;

  return Math.max(tokenScore, subsetScore, editScore);
}

function getCharacterNameCandidates(character = {}) {
  return uniqueText([
    character.name,
    ...(Array.isArray(character.aliases) ? character.aliases : []),
  ]);
}

function singleTokenIdentityMatch(existingName = '', incomingName = '') {
  const existingTokens = nameTokens(existingName);
  const incomingTokens = nameTokens(incomingName);
  const shorter = existingTokens.length <= incomingTokens.length ? existingTokens : incomingTokens;
  const longer = existingTokens.length > incomingTokens.length ? existingTokens : incomingTokens;

  if (shorter.length !== 1 || longer.length < 2) return false;
  const token = shorter[0];
  if (token.length < 3 || AMBIGUOUS_SINGLE_TOKENS.has(token)) return false;
  return longer.includes(token);
}

export function findCharacterIdentityMatch(characters = [], incoming = {}) {
  const incomingNames = uniqueText([
    incoming.name,
    incoming.character_name,
    incoming.target_name,
    ...(Array.isArray(incoming.aliases) ? incoming.aliases : []),
  ]);
  if (incomingNames.length === 0) return null;

  let best = null;
  const singleTokenCandidates = new Map();

  for (const character of characters || []) {
    const existingNames = getCharacterNameCandidates(character);
    for (const incomingName of incomingNames) {
      for (const existingName of existingNames) {
        const score = characterNameSimilarity(existingName, incomingName);
        if (!best || score > best.score) {
          best = { character, score, incomingName, existingName };
        }
        if (singleTokenIdentityMatch(existingName, incomingName)) {
          singleTokenCandidates.set(character, {
            character,
            score: 0.84,
            incomingName,
            existingName,
          });
        }
      }
    }
  }

  if (best && best.score >= 0.86) return best;

  if (singleTokenCandidates.size === 1) {
    return [...singleTokenCandidates.values()][0];
  }

  return null;
}

export function mergeCharacterPatch(existing = {}, incoming = {}) {
  const patch = {};
  const aliases = uniqueText([
    ...(Array.isArray(existing.aliases) ? existing.aliases : []),
    incoming.name && normalizeCharacterIdentityKey(incoming.name) !== normalizeCharacterIdentityKey(existing.name)
      ? incoming.name
      : '',
    ...(Array.isArray(incoming.aliases) ? incoming.aliases : []),
  ]);
  if (JSON.stringify(existing.aliases || []) !== JSON.stringify(aliases)) {
    patch.aliases = aliases;
  }

  const fillIfBlank = [
    'appearance',
    'personality',
    'flaws',
    'personality_tags',
    'age',
    'pronouns_self',
    'pronouns_other',
    'speech_pattern',
    'current_status',
    'goals',
    'secrets',
    'notes',
    'story_function',
    'source_kind',
  ];
  for (const field of fillIfBlank) {
    if (!cleanText(existing[field]) && cleanText(incoming[field])) {
      patch[field] = incoming[field];
    }
  }

  const roleRank = { minor: 1, supporting: 2, mentor: 3, antagonist: 4, protagonist: 5 };
  const existingRole = cleanText(existing.role || 'supporting').toLowerCase();
  const incomingRole = cleanText(incoming.role || '').toLowerCase();
  if (incomingRole && (roleRank[incomingRole] || 0) > (roleRank[existingRole] || 0)) {
    patch.role = incomingRole;
  }

  if (incoming.source_chapter_id && !existing.source_chapter_id) {
    patch.source_chapter_id = incoming.source_chapter_id;
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = Date.now();
  }
  return patch;
}
