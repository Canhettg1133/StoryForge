# StoryForge Cloudflare Migration Handoff

## Điểm khôi phục

- Worktree migration: `D:\StoryForge-cloudflare`
- Branch: `codex/cloudflare-migration`
- Baseline SHA: `05b6a64c0ac55348b7fccf67803aee3fbdfed221`
- Worktree gốc `D:\StoryForge` không được stash, reset hoặc sửa các thay đổi đang có.
- Vercel tiếp tục là phương án dự phòng; không xóa `vercel.json`, Vercel Functions hoặc Analytics.

## Môi trường mục tiêu

- Production: `https://storyforge-web.canhettg113.workers.dev`
- Preview: `https://storyforge-web-preview.canhettg113.workers.dev`
- Preview dùng production Supabase để đọc quyền thật nhưng khóa Cloud Sync, Auto Sync, Story Mirror, usage logging và adult-consent writes.

## Cấu hình local

1. Tạo `.env.cloudflare.preview.local` hoặc `.env.cloudflare.production.local` từ file example tương ứng.
2. Tạo `.dev.vars` từ `.dev.vars.example` để chạy Worker local với `SUPABASE_SERVICE_ROLE_KEY`.
3. Không commit các file `.local`, `.dev.vars` hoặc giá trị service-role key.

## Lệnh kiểm tra

```powershell
npm run test:cloudflare-runtime
npm test
npm run build:cloudflare:preview
npm run worker:user:dry-run:preview
npm run worker:user:dry-run:production
npm run worker:admin:dry-run
npm run worker:relay:dry-run
npm run worker:story-mirror:dry-run
```

## Việc ngoài hệ thống còn phải xác nhận trước deploy

- Đặt `SUPABASE_SERVICE_ROLE_KEY` bằng `wrangler secret put` riêng cho preview và production.
- Supabase OAuth redirect allowlist đã có cả hai Workers URL; vẫn cần kiểm thử đăng nhập thật từ preview để xác nhận callback quay về đúng origin.
- Deploy lại AI Studio Relay sau khi kiểm tra hai origin Cloudflare trong CORS.
- Deploy lại Story Mirror sau khi kiểm tra production Cloudflare origin; preview vẫn tắt Story Mirror.
- Dùng Site Announcement để nhắc người dùng backup và export/copy API key trước khi đổi URL chính.
- Chỉ push branch và deploy preview sau khi local acceptance pass; chưa deploy production trước khi preview đạt cổng kiểm thử.

## Rollback

- Trước merge: bỏ worktree/branch migration; worktree gốc không bị ảnh hưởng.
- Preview lỗi: rollback version preview hoặc không promote.
- Production lỗi: đổi Site Announcement/link về Vercel và rollback Worker version.
- Sau merge: revert từng commit migration nhỏ; Vercel dual-runtime vẫn tiếp tục hoạt động.

## Trạng thái triển khai preview

- Preview đang chạy tại `https://storyforge-web-preview.canhettg113.workers.dev`.
- Acceptance tự động gần nhất ngày 17/07/2026: full suite `1524 passed`, `4 skipped`, `0 failed`; workerd `5/5`; auth/VIP `17/17`; preview/production user Worker dry-run, Admin secure build, Admin API Worker, AI Studio Relay và Story Mirror dry-run đều pass; `npm audit` có `0` vulnerability.
- Preview current version: `da9c24e1-f647-4974-a8f6-04ed6eec0b38`; rollback version: `937d78fc-06ca-4460-bf01-45b90835ca27`.
- Preview hiện chứa commit local `a7444a4` và regression tests `67c2516`; branch vẫn chưa push.
- Preview có secret `SUPABASE_SERVICE_ROLE_KEY`; production user Worker chưa được deploy.
- AI Studio Relay current version: `0df9c409-3ae9-4aa9-a951-301a4055d51b`; rollback version: `e16c93b9-eed1-4aba-bd76-231e723bf11b`.
- Story Mirror current version: `7571693f-1d6b-4c2e-80fa-46405812650d`; rollback version: `f539e523-ad55-44c4-a53b-53f176e5cbf3`.
- Live CORS preflight pass cho hai origin Cloudflare, `story-forge-virid.vercel.app` và Story Mirror production origin.
- Live preview sau deploy trả SPA/deep-link `200`; `/api`, `/api?x=1` và unknown API đều JSON `404`; `/api/cloud` JSON `410`; unauthenticated `/api/me/access` JSON `401`; HTML/API giữ `no-store` và asset hash giữ cache một năm `immutable`.
- Cloudflare median cold LCP trong ba lượt là `6.264s`; Vercel median là `6.416s`. Cloudflare không regression, nhưng cả hai chưa đạt mục tiêu tuyệt đối `2.5s` do baseline tải Translator runtime trên Dashboard.
- Batch NDJSON hiện tôn trọng backpressure; Vercel adapter chờ Node `drain`; production usage logging chỉ bắt đầu sau khi sáu upstream batch slot đã hoàn tất nên không tạo kết nối outbound thứ bảy.
- Audit Supabase đối chiếu `origin/main` xác nhận không tăng số query/write theo mỗi request: cache catalog `5` phút và user snapshot `2` phút giữ nguyên, nhiều feature dùng một access resolution, batch `30` chỉ insert một `usage_events` với `count=30`, preview không ghi usage/profile/Free plan.
- Ngày 17/07/2026, Supabase OAuth redirect allowlist đã thêm `https://storyforge-web-preview.canhettg113.workers.dev` và `https://storyforge-web.canhettg113.workers.dev` (tổng 11 URL). Site URL vẫn giữ `https://story-forge-kohl.vercel.app` làm fallback; client tiếp tục gửi origin khởi tạo để `kohl`, `virid` và Cloudflare quay về đúng chính web đăng nhập.
- Targeted auth tests đạt `17/17`. Chưa chạy acceptance đăng nhập production account hoặc disposable provider key trên preview.
- Không push branch, không deploy user Worker production và không đổi Site Announcement trước khi các cổng còn thiếu được xác nhận.
