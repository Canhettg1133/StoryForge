import 'fake-indexeddb/auto';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { webcrypto } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import db from '../../services/db/database.js';
import keyManager from '../../services/ai/keyManager.js';
import { updateCustomOpenAIProxyProfile, CUSTOM_PROXY_PROFILE_ID } from '../../services/ai/openAIProxyConfig.js';
import { createManuscriptSnapshot, findEvidenceInEditor } from '../../features/manuscriptReview/snapshot.js';
import { startManuscriptReview } from '../../features/manuscriptReview/service.js';
import { manuscriptReviewLiveCorpus } from '../fixtures/manuscriptReviewLiveCorpus.js';

// Opt-in only. Normal tests never contact a provider. Keep keys in the child process environment, not argv/files.
const enabled = process.env.SF_REVIEW_LIVE === '1';
it.skipIf(!enabled)('audits the real streaming review pipeline against an explicitly configured provider', async () => {
  const key = process.env.SF_REVIEW_LIVE_KEY;
  const baseUrl = process.env.SF_REVIEW_LIVE_URL;
  const model = process.env.SF_REVIEW_LIVE_MODEL;
  if (!key || !baseUrl || !model) throw new Error('Live review requires explicit URL, model and key environment variables.');
  const allowed = new URL(baseUrl);
  if (allowed.protocol !== 'https:' || allowed.username || allowed.password) throw new Error('Live review requires a credential-free HTTPS endpoint.');
  const nativeFetch = globalThis.fetch;
  const traces = [];
  const captures = [];
  const audit = { model, endpoint: `${allowed.origin}${allowed.pathname}`, started_at: new Date().toISOString(), samples: [], traces };
  const safe = (value) => String(value).replaceAll(key, '[REDACTED]');
  const tag = String(process.env.SF_REVIEW_LIVE_TAG || 'latest').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'latest';
  const folder = path.resolve('.codex-artifacts/manuscript-review-live');
  let handle;
  let editor;
  try {
    localStorage.clear(); vi.stubGlobal('crypto', webcrypto);
    updateCustomOpenAIProxyProfile({ baseUrl, defaultModel: model, models: [model], transport: 'direct' });
    keyManager.addKey('openai_proxy', key);
    vi.stubGlobal('fetch', async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== allowed.origin || url.pathname !== `${allowed.pathname.replace(/\/$/u, '')}/chat/completions`) throw new Error('Live audit blocked an unexpected network destination.');
      const payload = JSON.parse(init.body);
      if (payload.model !== model) throw new Error('Live audit blocked a model change.');
      const trace = { index: traces.length + 1, model: payload.model, stream: payload.stream, started: performance.now() };
      traces.push(trace);
      // Deliberately do not forward credentials to redirects, even during diagnostics.
      const response = await nativeFetch(input, { ...init, redirect: 'manual' });
      trace.status = response.status; trace.headersMs = Math.round(performance.now() - trace.started);
      trace.contentType = response.headers.get('content-type');
      trace.allowOrigin = response.headers.get('access-control-allow-origin');
      if (response.status >= 300 && response.status < 400) throw new Error('Live audit stopped at a redirect; no credentials were forwarded.');
      const reader = response.clone().body?.getReader();
      captures.push((async () => {
        const decoder = new TextDecoder(); let raw = '';
        try {
          while (reader) {
            const { value, done } = await reader.read(); if (done) break;
            raw += decoder.decode(value, { stream: true });
            if (raw.length > 128000) { void reader.cancel(); raw = raw.slice(0, 128000); break; }
          }
        } catch { /* Aborted provider streams are still useful bounded diagnostics. */ }
        trace.raw = safe(raw); trace.elapsedMs = Math.round(performance.now() - trace.started); delete trace.started;
      })());
      return response;
    });
    const requested = String(process.env.SF_REVIEW_LIVE_SAMPLES || '').split(',').filter(Boolean);
    const requestedModes = String(process.env.SF_REVIEW_LIVE_MODES || '').split(',').filter(Boolean);
    const liveModes = requestedModes.length ? requestedModes : ['adherence', 'literary', 'signals'];
    if (liveModes.some((mode) => !['adherence', 'literary', 'signals'].includes(mode))) throw new Error('Live review modes are invalid.');
    for (const sample of manuscriptReviewLiveCorpus.filter((item) => !requested.length || requested.includes(item.id))) {
      const scene = { id: 92001 + audit.samples.length, chapter_id: 93001 };
      editor = new Editor({ extensions: [StarterKit], content: { type: 'doc', content: sample.paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } });
      const snapshot = createManuscriptSnapshot(editor, { project: sample.project, scene });
      const started = performance.now(); const events = [];
      handle = startManuscriptReview({ snapshot, modes: liveModes, authorRequest: sample.authorRequest,
        route: { provider: 'openai_proxy', proxyProfileId: CUSTOM_PROXY_PROFILE_ID, model },
        onProgress: ({ mode, status, error }) => { events.push({ mode, status, error }); console.info('LIVE_REVIEW_PROGRESS', sample.id, mode, status, error ? safe(error) : ''); },
      });
      const outcome = await handle.done;
      const evidence = outcome.reports.flatMap((row) => [...row.result.findings.flatMap((item) => item.evidence), ...(row.result.criteria || row.result.scores || []).flatMap((item) => item.evidence)]
        .map((item) => ({ item, sceneSignature: row.scene_signature })));
      const resolved = await Promise.all(evidence.map(({ item, sceneSignature }) => findEvidenceInEditor(editor, item, { sceneSignature })));
      audit.samples.push({ id: sample.id, label: sample.label, words: snapshot.text.split(/\s+/u).length, characters: snapshot.text.length,
        elapsedMs: Math.round(performance.now() - started), events, ...outcome,
        navigation: { total: evidence.length, resolved: resolved.filter(Boolean).length },
        manuscriptUnchanged: editor.state.doc === snapshot.document,
      });
      expect(editor.state.doc).toBe(snapshot.document);
      expect(resolved.every(Boolean)).toBe(true);
      editor.destroy(); editor = null; handle = null;
      // Stop spending if the provider itself is unavailable; preserve the diagnostic rather than retrying silently.
      if (!outcome.reports.length) break;
    }
    expect(audit.samples.length).toBeGreaterThan(0);
    expect(audit.samples.flatMap((item) => Object.keys(item.errors))).toEqual([]);
  } finally {
    handle?.cancel(); editor?.destroy();
    await Promise.allSettled(captures);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${tag}.json`), safe(JSON.stringify(audit, null, 2)), 'utf8');
    console.info('LIVE_REVIEW_AUDIT', path.join(folder, `${tag}.json`));
    localStorage.clear(); vi.unstubAllGlobals();
  }
}, 1800000);
