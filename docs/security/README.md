# StoryForge Security Hardening Baseline

Tài liệu này là checklist vận hành cho các lớp bảo mật không nên nằm trong
frontend. UI có thể ẩn nút để cải thiện trải nghiệm, nhưng quyền thật phải do
backend/API/database enforce.

## Risk register hiện tại

| Risk | Severity | Trạng thái | Control |
| --- | --- | --- | --- |
| User-controlled metadata tự khai role admin | Critical | Mitigated in code | Chỉ tin `profiles.system_role` và admin-set `app_metadata`; profile mới là `user`. |
| Secret trong ảnh/docs/repo | Critical | Mitigated in repo, needs external rotation | Thay ảnh bằng key giả, untrack DB local, rotate key thật, purge history nếu repo đã push. |
| XSS translator runtime lấy token | High | Mitigated in priority sinks | Escape upstream model/content/error/key; không expose bearer token trên `window`. |
| Cloudflare cover relay bypass VIP | High | Mitigated | `/api/cloudflare-workers-ai` yêu cầu bearer token + `project.cover_generation`. |
| Story Mirror bypass VIP | High | Mitigated | Worker resolve entitlement server-side, cache catalog 5 phút, user snapshot 120 giây theo `access_versions`. |
| Local jobs backend exposed | Medium | Mitigated | Mặc định bind `127.0.0.1`; remote bind bắt buộc token + origin allowlist. |

## NIST SSDF SP 800-218 mapping

| SSDF practice | StoryForge control |
| --- | --- |
| PO.1 Define security requirements | Feature gates documented in access catalog and migrations. |
| PO.3 Implement supporting toolchains | `npm audit --omit=dev`, targeted Vitest contracts, build gate. |
| PS.1 Protect code from unauthorized access | Secret rotation/history purge runbook; no real keys in docs/assets. |
| PS.2 Archive and protect releases | Deploy docs list required migrations and production headers. |
| PW.4 Reuse existing, well-secured software | Supabase/Vercel managed TLS/at-rest controls; pg parameter binding. |
| PW.5 Create source code by adhering to secure coding practices | Server-side auth gates; sanitized public errors; upload multipart limits. |
| RV.1 Identify vulnerabilities | Security tests for admin metadata, relay gates, Story Mirror gates, XSS sinks. |
| RV.2 Assess, prioritize, and remediate | Risk register severity/order above. |

## NIST CSF 2.0 mapping

| CSF function | StoryForge activity |
| --- | --- |
| Govern | Risk register, deploy checklist, WAF runbook. |
| Identify | Access catalog, dependency audit, tracked-secret scan. |
| Protect | Server-side gates, HSTS/CSP, generic errors, local-only jobs, upload limits. |
| Detect | Audit logs for admin role/plan mutations; WAF/security event monitoring. |
| Respond | Secret rotation and history purge runbook. |
| Recover | Restore from clean history/deploy; reissue keys; verify audit/build gates. |

## Dependency cadence

- Weekly: run `npm audit --omit=dev`.
- Monthly: update non-breaking security patches.
- Immediate: patch critical/high vulnerabilities in runtime dependencies.
- Before deploy: run targeted security tests and `npm run build`.
