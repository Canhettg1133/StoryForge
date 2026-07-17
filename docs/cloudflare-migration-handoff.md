# StoryForge Cloudflare Migration Handoff

## Điểm khôi phục

- Worktree migration: `D:\StoryForge-cloudflare`
- Branch: `codex/cloudflare-migration`
- Baseline SHA: `05b6a64c0ac55348b7fccf67803aee3fbdfed221`
- Worktree gốc `D:\StoryForge` không được stash, reset hoặc sửa các thay đổi đang có.
- Vercel tiếp tục là phương án dự phòng; không xóa `vercel.json`, Vercel Functions hoặc Analytics.

## Môi trường mục tiêu

- Workers.dev chính: `https://storyforge.canhettg113.workers.dev`
- Full-mode fallback: `https://storyforge-web-preview.canhettg113.workers.dev`
- Slot dự phòng chưa deploy: `https://storyforge-web.canhettg113.workers.dev`
- Worker chính và fallback đều chạy `production` mode; Cloud Sync, Auto Sync, Story Mirror, usage logging và adult-consent writes đã bật.

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

## Việc còn cần kiểm thử thủ công

- Đăng nhập thật từ Worker chính để xác nhận Google/Supabase callback quay về đúng origin mới và tài khoản/VIP hiển thị đúng.
- Kiểm thử model, chat, viết truyện và batch bằng API key dùng một lần; không gửi key qua chat hoặc lưu key trên server.
- Dùng Site Announcement để nhắc người dùng backup và export/copy API key trước khi đổi URL chính.

## Rollback

- Trước merge: bỏ worktree/branch migration; worktree gốc không bị ảnh hưởng.
- Preview lỗi: rollback version preview hoặc không promote.
- Production lỗi: đổi Site Announcement/link về Vercel và rollback Worker version.
- Sau merge: revert từng commit migration nhỏ; Vercel dual-runtime vẫn tiếp tục hoạt động.

## Trạng thái triển khai Cloudflare

- Worker chính đang chạy tại `https://storyforge.canhettg113.workers.dev`; URL cũ `https://storyforge-web-preview.canhettg113.workers.dev` vẫn hoạt động làm fallback.
- Acceptance tự động gần nhất ngày 17/07/2026: full suite `1525 passed`, `4 skipped`, `0 failed`; workerd `5/5`; OAuth/config `21/21`; preview/production user Worker dry-run, Admin API Worker, AI Studio Relay và Story Mirror dry-run đều pass; `npm audit` có `0` vulnerability.
- Worker chính version: `28385873-bca2-4872-b68d-57beb6e48e9c`; fallback version: `5cbd6554-1705-4295-9a42-1a89541d4567`; rollback read-only version: `da9c24e1-f647-4974-a8f6-04ed6eec0b38`.
- Worker chính có secret `SUPABASE_SERVICE_ROLE_KEY`; slot `storyforge-web` vẫn chưa deploy.
- AI Studio Relay current version: `d6eaf9fe-bcf8-4b8c-bdd4-9032cd1a3ec3`; previous version: `0df9c409-3ae9-4aa9-a951-301a4055d51b`.
- Story Mirror current version: `2e218af8-5453-4263-aeca-b4204a80fe03`; previous version: `6f2c8374-b234-410d-b3ba-61e11fa332b9`.
- Live CORS preflight trả đúng origin mới trên AI Studio Relay và Story Mirror; các origin Vercel và Workers.dev cũ vẫn nằm trong allowlist để rollback.
- Live Worker chính trả SPA/deep-link `200`; `/api` và `/api?x=1` JSON `404`; `/api/cloud` JSON `410`; unauthenticated `/api/me/access` và `/api/me/adult-consent` JSON `401`; HTML/API giữ `no-store`, asset hash cache một năm `immutable`, security headers vẫn có trên SPA.
- Secure bundle không có preview banner; build production bật Cloud Sync, Auto Sync và Story Mirror.
- Cloudflare median cold LCP trong ba lượt là `6.264s`; Vercel median là `6.416s`. Cloudflare không regression, nhưng cả hai chưa đạt mục tiêu tuyệt đối `2.5s` do baseline tải Translator runtime trên Dashboard.
- Batch NDJSON hiện tôn trọng backpressure; Vercel adapter chờ Node `drain`; production usage logging chỉ bắt đầu sau khi sáu upstream batch slot đã hoàn tất nên không tạo kết nối outbound thứ bảy.
- Audit Supabase đối chiếu `origin/main` xác nhận không tăng số query/write theo mỗi request: cache catalog `5` phút và user snapshot `2` phút giữ nguyên, nhiều feature dùng một access resolution, batch `30` chỉ insert một `usage_events` với `count=30`. Full-mode Worker hiện ghi dữ liệu theo đúng policy production.
- Ngày 17/07/2026, Supabase OAuth redirect allowlist đã có `https://storyforge.canhettg113.workers.dev` (tổng 12 URL). Site URL vẫn giữ `https://story-forge-kohl.vercel.app` làm fallback; client gửi origin khởi tạo nên `kohl`, `virid` và Worker mới quay về đúng chính web bắt đầu đăng nhập.
- Contract OAuth/config đạt `21/21`. Chưa chạy acceptance đăng nhập production account hoặc disposable provider key trên Worker mới.
- Commit contract là `9c167c3`; commit cấu hình/deploy là `cb3d0ae`; branch vẫn chưa push và Site Announcement chưa đổi.
- Cloudflare account hiện không có active DNS zone. Không đổi account workers.dev subdomain vì thao tác đó ảnh hưởng đồng thời User Worker, Admin API, AI Studio Relay và Story Mirror. Domain lâu dài cần đăng ký/thêm một custom domain rồi gắn trực tiếp vào User Worker.
