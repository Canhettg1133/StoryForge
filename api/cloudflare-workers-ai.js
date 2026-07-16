import { createVercelHandler } from './_lib/web.js';
import { createCloudflareWorkersAIWebHandler } from './_web/cloudflare-workers-ai.js';

export { createCloudflareWorkersAIWebHandler };

export const config = {
  maxDuration: 300,
};

export function createCloudflareWorkersAIHandler(options = {}) {
  return createVercelHandler(createCloudflareWorkersAIWebHandler(options));
}

export default createCloudflareWorkersAIHandler();
