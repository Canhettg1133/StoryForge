import { createVercelHandler } from './_lib/web.js';
import { createVipPageContentWebHandler } from './_web/public-content.js';

export { createVipPageContentWebHandler };

export function createVipPageContentHandler(options = {}) {
  return createVercelHandler(createVipPageContentWebHandler(options));
}

export default createVipPageContentHandler();
