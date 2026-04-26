export const PRODUCT_SURFACE = {
  showLabs: import.meta.env.VITE_SHOW_LABS === 'true',
  showLabLite: import.meta.env.VITE_SHOW_LAB_LITE !== 'false',
  showRoadmapPages: import.meta.env.VITE_SHOW_ROADMAP_PAGES === 'true',
  showJobUi: import.meta.env.VITE_SHOW_JOB_UI === 'true',
  enableCloudSync: import.meta.env.VITE_ENABLE_CLOUD_SYNC !== 'false',
};

export function shouldShowNavItem(item) {
  if (item.id === 'cloud-sync' && !PRODUCT_SURFACE.enableCloudSync) {
    return false;
  }

  if ((item.id === 'lab-lite' || item.surface === 'lab-lite') && !PRODUCT_SURFACE.showLabLite) {
    return false;
  }

  if (item.surface === 'lab' && !PRODUCT_SURFACE.showLabs) {
    return false;
  }

  if (item.surface === 'roadmap' && !PRODUCT_SURFACE.showRoadmapPages) {
    return false;
  }

  return true;
}
