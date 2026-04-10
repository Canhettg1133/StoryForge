export function buildProseBuffer(rawText, wordLimit = 150) {
  const plainText = String(rawText || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plainText) return '';

  const words = plainText.split(' ').filter(Boolean);
  return words.slice(-wordLimit).join(' ');
}
