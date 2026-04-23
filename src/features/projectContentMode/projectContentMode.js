export const PROJECT_CONTENT_MODES = {
  SAFE: 'safe',
  NSFW: 'nsfw',
  ENI: 'eni',
};

export const PROJECT_CONTENT_MODE_OPTIONS = [
  {
    value: PROJECT_CONTENT_MODES.SAFE,
    label: 'Thường',
    description: 'Dùng chế độ an toàn mặc định cho truyện thường.',
  },
  {
    value: PROJECT_CONTENT_MODES.NSFW,
    label: '18+',
    description: 'Mở chế độ người lớn cho truyện 18+ và dark fantasy.',
  },
  {
    value: PROJECT_CONTENT_MODES.ENI,
    label: 'ENI',
    description: 'Dùng ENI cho case cực mạnh, đồng thời bật luôn 18+.',
  },
];

export function resolveProjectContentMode(project = {}) {
  if (project?.super_nsfw_mode) return PROJECT_CONTENT_MODES.ENI;
  if (project?.nsfw_mode) return PROJECT_CONTENT_MODES.NSFW;
  return PROJECT_CONTENT_MODES.SAFE;
}

export function buildProjectContentModePatch(mode) {
  if (mode === PROJECT_CONTENT_MODES.ENI) {
    return {
      nsfw_mode: true,
      super_nsfw_mode: true,
    };
  }

  if (mode === PROJECT_CONTENT_MODES.NSFW) {
    return {
      nsfw_mode: true,
      super_nsfw_mode: false,
    };
  }

  return {
    nsfw_mode: false,
    super_nsfw_mode: false,
  };
}

export function getProjectContentModeMeta(mode) {
  return PROJECT_CONTENT_MODE_OPTIONS.find((option) => option.value === mode)
    || PROJECT_CONTENT_MODE_OPTIONS[0];
}

export function buildProjectContentModeAiOptions(project, baseOptions = {}) {
  const patch = buildProjectContentModePatch(resolveProjectContentMode(project));
  return {
    ...baseOptions,
    nsfwMode: patch.nsfw_mode,
    superNsfwMode: patch.super_nsfw_mode,
  };
}
