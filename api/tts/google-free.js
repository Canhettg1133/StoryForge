import { createVercelHandler } from '../_lib/web.js';
import { createGoogleFreeTtsWebHandler } from '../_web/tts.js';

export { createGoogleFreeTtsWebHandler };

export function createGoogleFreeTtsHandler(options = {}) {
  return createVercelHandler(createGoogleFreeTtsWebHandler(options));
}

export default createGoogleFreeTtsHandler();
