export const PRODUCT_SURFACE = {
  showLabs: false,
  showRoadmapPages: false,
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
