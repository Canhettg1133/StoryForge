import { createVercelHandler } from './_lib/web.js';
import {
  createSupremeChatHandler,
  createSupremeChatWebHandler,
} from './_web/supreme-chat.js';

export { createSupremeChatHandler, createSupremeChatWebHandler };

export const config = {
  maxDuration: 300,
};

export default createVercelHandler(createSupremeChatWebHandler());
