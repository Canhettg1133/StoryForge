export const EMPTY_DATA = {
  overview: null,
  users: [],
  catalog: [],
  audit: [],
  usage: [],
  features: [],
  planFeatures: [],
  consent: [],
  announcement: null,
  setupGuides: null,
};

export const DEFAULT_USAGE_PAGE_SIZE = 100;
export const DEFAULT_VIP_RANKING_LIMIT = 20;

export const EMPTY_USAGE_PAGINATION = {
  page: 1,
  pageSize: DEFAULT_USAGE_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export const EMPTY_USAGE_PAGE_CURSORS = { 1: '' };

export const DEFAULT_USAGE_FILTERS = {
  q: '',
  provider: 'all',
  status: 'all',
};

export const DEFAULT_VIP_RANKING_FILTERS = {
  range: '30d',
  from: '',
  to: '',
  task: 'all',
  plan: 'vip_lifetime',
  provider: 'all',
  status: 'all',
  q: '',
  limit: DEFAULT_VIP_RANKING_LIMIT,
};

export const EMPTY_VIP_RANKING = {
  items: [],
  summary: {
    totalUsers: 0,
    totalCount: 0,
    eventCount: 0,
    okCount: 0,
    issueCount: 0,
    lastUsedAt: null,
  },
  filters: DEFAULT_VIP_RANKING_FILTERS,
};

export const RANKING_RANGE_OPTIONS = [
  { value: '24h', label: '24 giờ qua' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'all', label: 'Tất cả' },
  { value: 'custom', label: 'Tùy chỉnh' },
];

export const RANKING_TASK_OPTIONS = [
  { value: 'all', label: 'Tất cả việc' },
  { value: 'writing', label: 'Viết truyện' },
  { value: 'translation', label: 'Dịch truyện' },
  { value: 'story_chat', label: 'Chat truyện' },
  { value: 'free_chat', label: 'Chat tự do' },
  { value: 'planning', label: 'Lên kế hoạch' },
  { value: 'analysis', label: 'Phân tích' },
  { value: 'image_generation', label: 'Tạo ảnh' },
];

export const RANKING_PLAN_OPTIONS = [
  { value: 'vip_lifetime', label: 'VIP + trọn đời' },
  { value: 'vip', label: 'Chỉ VIP' },
  { value: 'lifetime', label: 'Chỉ trọn đời' },
];

export const RANKING_LIMIT_OPTIONS = [10, 20, 50];

export const DEFAULT_PLAN_FORM = {
  planKey: 'vip',
  status: 'active',
  startsAt: '',
  expiresAt: '',
};

export const DEFAULT_OVERRIDE_FORM = {
  featureKey: '',
  enabled: true,
  reason: '',
  expiresAt: '',
};
