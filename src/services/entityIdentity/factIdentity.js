function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDiacritics(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(value) {
  return stripDiacritics(value)
    .replace(/[\u2018\u2019\u201c\u201d"'`()\[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCanonFactDescription(value) {
  return normalizeKey(value);
}

export function buildCanonFactSubjectScope(fact = {}) {
  const subjectType = cleanText(fact.subject_type || '');
  const subjectId = fact.subject_id ?? null;
  if (subjectType && subjectId != null) {
    return `${subjectType}:${subjectId}`;
  }
  const normalizedSubject = normalizeKey(
    fact.subject_name
    || fact.subjectName
    || fact.subject_text
    || fact.subjectText
    || fact.subject
    || '',
  );
  if (normalizedSubject) {
    return `text:${normalizedSubject}`;
  }
  return 'global';
}

export function buildCanonFactFingerprint(fact = {}) {
  const factType = cleanText(fact.fact_type || 'fact') || 'fact';
  const normalizedDescription = normalizeCanonFactDescription(
    fact.normalized_description || fact.description || fact.fact_description || '',
  );
  const subjectScope = cleanText(
    fact.subject_scope || buildCanonFactSubjectScope(fact),
  ) || 'global';
  return `${factType}|${normalizedDescription}|${subjectScope}`;
}

export function normalizeCanonFactRecord(fact = {}) {
  const normalizedDescription = normalizeCanonFactDescription(
    fact.description || fact.fact_description || '',
  );
  const subjectScope = buildCanonFactSubjectScope(fact);
  return {
    normalized_description: normalizedDescription,
    subject_scope: subjectScope,
    fact_fingerprint: buildCanonFactFingerprint({
      ...fact,
      normalized_description: normalizedDescription,
      subject_scope: subjectScope,
    }),
  };
}

export function resolveCanonFactRegistration(candidate = {}, factStates = []) {
  const normalized = normalizeCanonFactRecord({
    description: candidate.fact_description || candidate.description || candidate.summary || '',
    fact_type: candidate.fact_type || candidate.payload?.fact_type || 'fact',
    subject_type: candidate.subject_type || candidate.payload?.subject_type || '',
    subject_id: candidate.subject_id ?? candidate.payload?.subject_id ?? null,
    subject_name: candidate.subject_name || candidate.payload?.subject_name || '',
    subject_scope: candidate.subject_scope || candidate.payload?.subject_scope || '',
  });

  const existing = (Array.isArray(factStates) ? factStates : []).find((fact) => {
    const factNormalized = normalizeCanonFactRecord(fact);
    return factNormalized.fact_fingerprint === normalized.fact_fingerprint;
  }) || null;

  return {
    ...normalized,
    existingFact: existing,
  };
}
