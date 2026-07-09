// Shared Facebook phone extraction engine.
// Exposes TravelLeadFbPhoneEngine on globalThis for Chrome content scripts and VM tests.
(function attachTravelLeadFbPhoneEngine(global) {
  const VN_MOBILE_PREFIXES = [
    '032', '033', '034', '035', '036', '037', '038', '039', '086', '096', '097', '098',
    '070', '076', '077', '078', '079', '089', '090', '093',
    '081', '082', '083', '084', '085', '088', '091', '094',
    '052', '056', '058',
    '059',
    '055',
  ];

  const candidateRegex = /(?:\+?84|0)(?:[\s.\-/,.]*\d){9}/g;

  function shouldSkipRawMatch(source, index, raw) {
    const previousChar = index > 0 ? source[index - 1] : '';
    const nextChar = source[index + raw.length] || '';
    return /\d/.test(previousChar) || /\d/.test(nextChar);
  }

  function normalizePhoneCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/[A-Za-z]/.test(raw)) return null;

    let digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+84')) {
      digits = `0${digits.slice(2)}`;
    } else if (digits.startsWith('84') && digits.length === 11) {
      digits = `0${digits.slice(2)}`;
    }

    if (digits.length !== 10 || !digits.startsWith('0')) return null;
    if (!VN_MOBILE_PREFIXES.includes(digits.slice(0, 3))) return null;
    return digits;
  }

  function extractPhoneCandidates(text) {
    const source = String(text || '');
    const seen = new Set();
    const candidates = [];
    const rejected = [];
    let match;

    candidateRegex.lastIndex = 0;
    while ((match = candidateRegex.exec(source)) !== null) {
      const raw = match[0];
      if (shouldSkipRawMatch(source, match.index, raw)) continue;
      const phone = normalizePhoneCandidate(raw);
      if (phone) {
        if (!seen.has(phone)) {
          seen.add(phone);
          candidates.push({
            raw,
            phone,
            confidence: 'high',
            index: match.index,
          });
        }
      } else {
        rejected.push({ raw, reason: 'Không phải số di động Việt Nam hợp lệ' });
      }
    }

    return candidates;
  }

  function analyzeTextForPhones(text) {
    const source = String(text || '');
    const rawMatches = [];
    const valid = [];
    const rejected = [];
    const seen = new Set();
    let match;

    candidateRegex.lastIndex = 0;
    while ((match = candidateRegex.exec(source)) !== null) {
      const raw = match[0];
      if (shouldSkipRawMatch(source, match.index, raw)) continue;
      rawMatches.push(raw);
      const phone = normalizePhoneCandidate(raw);
      if (!phone) {
        rejected.push({ raw, reason: 'Không phải số di động Việt Nam hợp lệ' });
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      valid.push({
        raw,
        phone,
        confidence: 'high',
        index: match.index,
      });
    }

    return { rawMatches, valid, rejected };
  }

  global.TravelLeadFbPhoneEngine = {
    VN_MOBILE_PREFIXES,
    normalizePhoneCandidate,
    extractPhoneCandidates,
    analyzeTextForPhones,
  };
})(globalThis);
