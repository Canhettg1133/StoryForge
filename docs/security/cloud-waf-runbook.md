# Cloud WAF, DDoS, And Bot Protection Runbook

Configure these controls in Vercel/Cloudflare. Do not challenge static assets
or the app shell by default; that changes UX and can break legitimate sessions.

## Rate-limit candidates

| Route | Suggested control |
| --- | --- |
| `/api/openai-proxy` | Per-IP and per-user token rate limit; block malformed JSON bursts. |
| `/api/translator-openai-proxy` | Per-IP and per-user token rate limit; stricter on streaming abuse. |
| `/api/cloudflare-workers-ai` | Per-IP and per-user token rate limit; require auth before upstream key use. |
| `/api/me/*` | Moderate per-IP limit; do not challenge normal logged-in refresh traffic. |
| Admin API Worker | Exact origin allowlist, WAF managed rules, stricter rate limits on mutations. |
| Story Mirror Worker | Exact origin allowlist, batch size limit, rate limit `/events/batch` and project delete. |

## Bot policy

- Challenge abnormal traffic to API routes only.
- Do not challenge `/`, `/assets/*`, `/translator-runtime/*`, fonts, images, or app shell routes unless under active attack.
- Block obvious bad automation: missing user agent, invalid method bursts, path traversal probes, SQLi/XSS scanner signatures.
- Keep allowlist for trusted admin IPs only if operationally stable.

## DDoS policy

- Enable provider-managed DDoS protection.
- Keep API timeouts bounded.
- Prefer fail-closed auth before expensive upstream calls.
- Monitor request rate, 4xx/5xx spikes, upstream token spend, and Supabase request volume.

## Verification

After changing WAF rules:

1. Login as normal user and load the app.
2. Verify `/api/me/access` succeeds.
3. Verify VIP-only routes return `403` for free user and pass for VIP/lifetime.
4. Verify admin origin works and non-allowlisted origin fails.
5. Verify static app shell and translator runtime are not challenged.
