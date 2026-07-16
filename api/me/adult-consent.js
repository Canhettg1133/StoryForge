import { createVercelHandler } from '../_lib/web.js';
import { createAdultConsentWebHandler } from '../_web/access.js';

export { createAdultConsentWebHandler };

export default createVercelHandler(createAdultConsentWebHandler());
