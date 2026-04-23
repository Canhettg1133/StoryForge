export const CONTENT_MODE_QUICK_ACTION_ID = 'content-mode';

export function getWriterQuickActionOrder(isMobileLayout = false) {
  if (isMobileLayout) {
    return [
      'continue',
      'rewrite',
      'expand',
      'plot',
      'outline',
      'extract',
      CONTENT_MODE_QUICK_ACTION_ID,
      'conflict',
    ];
  }

  return [
    'continue',
    'rewrite',
    'expand',
    'plot',
    CONTENT_MODE_QUICK_ACTION_ID,
    'outline',
    'extract',
    'conflict',
  ];
}
