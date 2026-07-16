import { createVercelHandler } from '../_lib/web.js';
import { createMeAccessWebHandler } from '../_web/access.js';

export { createMeAccessWebHandler };

export default createVercelHandler(createMeAccessWebHandler());
