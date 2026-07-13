import { getSupabaseAdminClient, getSupabaseAdminConfig } from './_lib/supabaseAdmin.js';
import { sendJson } from './_lib/http.js';
import {
  PROMPT_SETTINGS_DOMAINS,
  TRANSLATOR_PROMPT_KEYS,
  toPublicTranslatorPromptSettings,
} from '../packages/access/src/index.js';

async function fetchPromptSettingsFromSupabase() {
  if (!getSupabaseAdminConfig().configured) {
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('prompt_settings')
    .select('domain,key,content,enabled,revision')
    .eq('domain', PROMPT_SETTINGS_DOMAINS.TRANSLATOR)
    .eq('enabled', true)
    .in('key', TRANSLATOR_PROMPT_KEYS);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function createTranslatorPromptSettingsHandler({
  fetchPromptSettings = fetchPromptSettingsFromSupabase,
} = {}) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Phương thức yêu cầu không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const rows = await fetchPromptSettings();
      const publicPayload = toPublicTranslatorPromptSettings(rows);
      sendJson(res, 200, {
        ok: true,
        source: rows.length > 0 ? 'database' : 'fallback',
        ...publicPayload,
      });
    } catch {
      sendJson(res, 200, {
        ok: true,
        source: 'fallback',
        prompts: {},
        revision: 0,
      });
    }
  };
}

export default createTranslatorPromptSettingsHandler();
