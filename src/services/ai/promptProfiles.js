export const PROMPT_PROFILE_VERSIONS = {
  LEGACY: 'legacy',
  TAG_FIRST_V2: 'tag_first_v2',
};

export function normalizePromptProfileVersion(value, fallback = PROMPT_PROFILE_VERSIONS.TAG_FIRST_V2) {
  if (value === PROMPT_PROFILE_VERSIONS.LEGACY || value === PROMPT_PROFILE_VERSIONS.TAG_FIRST_V2) {
    return value;
  }
  return fallback;
}

export function resolvePromptProfileVersion(project = {}) {
  return normalizePromptProfileVersion(project?.prompt_profile_version, PROMPT_PROFILE_VERSIONS.LEGACY);
}
