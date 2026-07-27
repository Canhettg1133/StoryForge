import { createVercelHandler } from './_lib/web.js';
import {
  createSupremeChatCapabilitiesWebHandler,
  runtimeSupportsSupremeImages,
} from './_web/supreme-chat-capabilities.js';

export {
  createSupremeChatCapabilitiesWebHandler,
  runtimeSupportsSupremeImages,
};

export default createVercelHandler(createSupremeChatCapabilitiesWebHandler());
