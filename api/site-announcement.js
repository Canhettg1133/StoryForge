import { createVercelHandler } from './_lib/web.js';
import { createSiteAnnouncementWebHandler } from './_web/public-content.js';

export { createSiteAnnouncementWebHandler };

export function createSiteAnnouncementHandler(options = {}) {
  return createVercelHandler(createSiteAnnouncementWebHandler(options));
}

export default createSiteAnnouncementHandler();
