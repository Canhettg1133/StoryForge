import { createVercelHandler } from './_lib/web.js';
import { createTranslatorPromptSettingsWebHandler } from './_web/public-content.js';

export { createTranslatorPromptSettingsWebHandler };

export function createTranslatorPromptSettingsHandler(options = {}) {
  return createVercelHandler(createTranslatorPromptSettingsWebHandler(options));
}

export default createTranslatorPromptSettingsHandler();
