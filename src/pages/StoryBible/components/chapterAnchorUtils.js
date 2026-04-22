function toCleanString(value = '') {
  return String(value || '').replace(/\r/g, '');
}

export function normalizeChapterAnchorCharacterKey(value = '') {
  return toCleanString(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function uniqueCharacterValues(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeChapterAnchorCharacterKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseChapterAnchorFocusCharacters(value = '') {
  return uniqueCharacterValues(
    toCleanString(value)
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function splitChapterAnchorFocusInput(value = '') {
  const source = toCleanString(value);
  const committedValues = [];
  let current = '';

  for (const char of source) {
    if (char === ',' || char === '\n') {
      const nextValue = current.trim();
      if (nextValue) committedValues.push(nextValue);
      current = '';
      continue;
    }
    current += char;
  }

  return {
    committedValues: uniqueCharacterValues(committedValues),
    remainder: current,
  };
}

export function splitChapterAnchorRequirementLines(value = '') {
  return toCleanString(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function canonicalizeChapterAnchorCharacter(value = '', allCharacters = []) {
  const key = normalizeChapterAnchorCharacterKey(value);
  if (!key) return '';
  const matched = (Array.isArray(allCharacters) ? allCharacters : [])
    .map((item) => String(item || '').trim())
    .find((item) => normalizeChapterAnchorCharacterKey(item) === key);
  return matched || String(value || '').trim();
}

export function mergeChapterAnchorCharacters(currentValues = [], incomingValues = [], allCharacters = []) {
  return uniqueCharacterValues([
    ...(Array.isArray(currentValues) ? currentValues : []),
    ...(Array.isArray(incomingValues) ? incomingValues : []),
  ].map((item) => canonicalizeChapterAnchorCharacter(item, allCharacters)).filter(Boolean));
}

export function isKnownChapterAnchorCharacter(value = '', allCharacters = []) {
  const key = normalizeChapterAnchorCharacterKey(value);
  if (!key) return false;
  return (Array.isArray(allCharacters) ? allCharacters : [])
    .some((item) => normalizeChapterAnchorCharacterKey(item) === key);
}
