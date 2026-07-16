import { createVercelHandler } from './_lib/web.js';
import { createLegacyCloudWebHandler } from './_web/cloud.js';

export { createLegacyCloudWebHandler };

export default createVercelHandler(createLegacyCloudWebHandler());
