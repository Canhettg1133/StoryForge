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
- Thêm hai Workers URL vào Supabase OAuth redirect allowlist.
- Deploy lại AI Studio Relay sau khi kiểm tra hai origin Cloudflare trong CORS.
- Deploy lại Story Mirror sau khi kiểm tra production Cloudflare origin; preview vẫn tắt Story Mirror.
- Dùng Site Announcement để nhắc người dùng backup và export/copy API key trước khi đổi URL chính.
- Chỉ push branch và deploy preview sau khi local acceptance pass; chưa deploy production trước khi preview đạt cổng kiểm thử.

## Rollback

- Trước merge: bỏ worktree/branch migration; worktree gốc không bị ảnh hưởng.
- Preview lỗi: rollback version preview hoặc không promote.
- Production lỗi: đổi Site Announcement/link về Vercel và rollback Worker version.
- Sau merge: revert từng commit migration nhỏ; Vercel dual-runtime vẫn tiếp tục hoạt động.
