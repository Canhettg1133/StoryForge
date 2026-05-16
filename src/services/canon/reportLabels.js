const SEVERITY_TITLES = {
  error: 'Lỗi canon',
  warning: 'Cảnh báo canon',
  info: 'Thông tin canon',
};

const RULE_TITLE_PATTERNS = [
  [/ITEM|OBJECT/u, 'Vấn đề vật phẩm'],
  [/THREAD/u, 'Vấn đề tuyến truyện'],
  [/SECRET|FACT/u, 'Vấn đề bí mật/sự thật'],
  [/RELATIONSHIP|INTIMACY/u, 'Vấn đề quan hệ'],
  [/CHARACTER|SUBJECT|SCENE_CAST|LIVE_CANON/u, 'Vấn đề nhân vật'],
  [/LOCATION/u, 'Vấn đề địa điểm'],
  [/LOW_CONFIDENCE/u, 'Độ tin cậy thấp'],
  [/DUPLICATE/u, 'Dữ liệu bị lặp'],
  [/MISSING/u, 'Thiếu dữ liệu canon'],
  [/INVALID/u, 'Dữ liệu canon không hợp lệ'],
];

export function getCanonReportTitle(report = {}) {
  const ruleCode = String(report.rule_code || report.ruleCode || '').trim().toUpperCase();
  const matched = RULE_TITLE_PATTERNS.find(([pattern]) => pattern.test(ruleCode));
  if (matched) return matched[1];
  return SEVERITY_TITLES[report.severity] || 'Báo cáo canon';
}
