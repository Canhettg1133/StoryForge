import { createVercelHandler } from '../_lib/web.js';
import { createEdgeTtsWebHandler } from '../_web/tts.js';

export { createEdgeTtsWebHandler };

export function createEdgeTtsHandler(options = {}) {
  return createVercelHandler(createEdgeTtsWebHandler(options));
}

export default createEdgeTtsHandler();
