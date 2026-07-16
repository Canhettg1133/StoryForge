export function shouldInjectVercelAnalytics(hostname, deploymentMode = '') {
  if (String(deploymentMode || '').trim().toLowerCase() === 'preview') return false;
  return String(hostname || '').trim().toLowerCase().endsWith('.vercel.app');
}
