# Chat Tối Thượng: cấu hình và rollout

## Secret bắt buộc

Tạo một khóa AES-256 dưới dạng Base64 từ đúng 32 byte ngẫu nhiên. Không dùng mật khẩu
do con người tự đặt và không commit giá trị thật.

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Cấu hình cùng một giá trị tại:

- StoryForge Cloudflare Worker: `SUPREME_PROMPT_ENCRYPTION_KEY_V1`.
- Vercel runtime: `SUPREME_PROMPT_ENCRYPTION_KEY_V1`.
- Admin API Worker: `SUPREME_PROMPT_ENCRYPTION_KEY_V1`.

Tại cả ba runtime, đặt `SUPREME_PROMPT_ACTIVE_KEY_VERSION=1`. Không đặt khóa trong
biến `VITE_*`, Pages build variables hoặc source frontend.

## Trình tự rollout

1. Cấu hình secret ở cả ba runtime và xác minh không runtime nào thiếu khóa.
2. Chạy migration `docs/supabase-access-control/016_secure_supreme_chat.sql`.
   Sau migration, cấu hình một lịch chạy tin cậy mỗi ngày để service role gọi
   `cleanup_supreme_chat_rate_limits`; không gọi RPC dọn dẹp này từ trình duyệt.
3. Deploy Admin API Worker, sau đó deploy Admin UI.
4. Owner mở `Prompt hệ thống → Chat Tối Thượng`, lưu nháp và xuất bản.
5. Deploy StoryForge API cho Vercel và Cloudflare.
6. Giữ `ai_chat.supreme` chưa cấp cho plan; chỉ cấp override cho tài khoản thử nghiệm.
7. Kiểm tra text, lịch sử, từng loại tài liệu, ảnh AG và đọc kỹ toàn bộ tệp.
8. Chạy các ca prompt injection ở user text, tệp và ảnh.
9. Theo dõi mã lỗi, tỷ lệ chặn, độ trễ và payload bị từ chối vì dung lượng.
10. Chỉ cấp feature cho plan sau khi cả Vercel và Cloudflare đạt cùng kết quả.

## Giới hạn ảnh theo runtime

- Cloudflare Worker và môi trường local cho phép gửi ảnh Tối Thượng qua AG Proxy trong
  các giới hạn 4 ảnh/lượt, 8 MB/ảnh và 12 MB tổng context.
- Vercel Functions chỉ cho request tối đa 4,5 MB, thấp hơn payload Base64 đã công bố.
  Vì vậy ảnh Tối Thượng bị khóa ở cả giao diện và backend khi runtime là Vercel.
- Text, lịch sử và nội dung tài liệu đã trích xuất vẫn hoạt động trên Vercel.
- Không bật lại ảnh trên Vercel cho tới khi có đường upload nhị phân an toàn, có xác
  thực và đã qua kiểm thử. Không tăng giới hạn giả hoặc âm thầm cắt payload.

Tài liệu giới hạn chính thức:

- https://vercel.com/docs/functions/limitations
- https://developers.cloudflare.com/workers/platform/limits/

## Xoay khóa

1. Thêm secret `SUPREME_PROMPT_ENCRYPTION_KEY_V2` vào cả ba runtime.
2. Đặt `SUPREME_PROMPT_ACTIVE_KEY_VERSION=2`.
3. Owner lưu một draft mới rồi xuất bản.
4. Giữ V1 để đọc hoặc rollback các revision cũ.
5. Chỉ xóa V1 khi mọi revision cần giữ đã dùng khóa mới.

## Xử lý sự cố

- Tắt runtime bằng nút `Tắt Tối Thượng`; không xóa revision và không fallback sang Free.
- Dùng `requestId` cùng metadata usage/audit để điều tra; log không có prompt, key hay nội dung tệp.
- Rollback revision nếu sự cố do nội dung prompt.
- Nếu lỗi chỉ ở ảnh hoặc đọc tệp, tạm ngừng luồng đó trước khi mở lại feature.
