export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripCodeFences(text) {
  return String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

function findJsonStart(text) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      return i;
    }
  }
  return -1;
}

function isMatchingPair(openChar, closeChar) {
  return (openChar === '{' && closeChar === '}') || (openChar === '[' && closeChar === ']');
}

function findJsonEnd(text, startIdx) {
  const stack = [text[startIdx]];
  let inString = false;
  let isEscaped = false;

  for (let i = startIdx + 1; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === '\\') {
        isEscaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      const openChar = stack[stack.length - 1];
      if (!isMatchingPair(openChar, char)) {
        throw new Error('Malformed JSON response');
      }

      stack.pop();
      if (stack.length === 0) {
        return i;
      }
    }
  }

  return -1;
}

export function parseAIJsonValue(text) {
  const cleaned = stripCodeFences(text);
  const startIdx = findJsonStart(cleaned);

  if (startIdx === -1) {
    throw new Error('No JSON found');
  }

  const endIdx = findJsonEnd(cleaned, startIdx);
  if (endIdx === -1) {
    throw new Error('Incomplete JSON');
  }

  return JSON.parse(cleaned.slice(startIdx, endIdx + 1));
}
