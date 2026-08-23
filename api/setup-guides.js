import { createVercelHandler } from './_lib/web.js';
import { createSetupGuidesWebHandler } from './_web/public-content.js';

export { createSetupGuidesWebHandler };

export function createSetupGuidesHandler(options = {}) {
  return createVercelHandler(createSetupGuidesWebHandler(options));
}

export default createSetupGuidesHandler();


