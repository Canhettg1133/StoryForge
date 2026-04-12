export const PRODUCT_SURFACE = {
  showLabs: import.meta.env.VITE_SHOW_LABS === 'true',
  showRoadmapPages: import.meta.env.VITE_SHOW_ROADMAP_PAGES === 'true',
  showJobUi: import.meta.env.VITE_SHOW_JOB_UI === 'true',
  enableCloudSync: import.meta.env.VITE_ENABLE_CLOUD_SYNC !== 'false',
};

export function shouldShowNavItem(item) {
  if (item.surface === 'lab' && !PRODUCT_SURFACE.showLabs) {
    return false;
  }

  if (item.surface === 'roadmap' && !PRODUCT_SURFACE.showRoadmapPages) {
    return false;
  }

  return true;
}
