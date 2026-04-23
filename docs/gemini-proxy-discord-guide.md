# Setup Gemini Proxy cho StoryForge

Mục tiêu: add CLI/Antigravity -> có quota -> tạo 3 key -> dán vào StoryForge.

## 1. Add CLI

Vào https://ag.beijixingxing.com/dashboard và đăng nhập.

Nếu quota = 0 thì chưa tạo key. Mở **CLI** -> **Get Credential** -> **Obtain via Google OAuth authorization**.

Đăng nhập đúng tài khoản Google muốn add. Login xong copy **nguyên callback URL**, không copy mỗi code. Quay lại dashboard, dán vào **Paste Callback URL**, bấm **Submit to Get Credential**.

Add thành công CLI hoặc Antigravity là đủ. Sau đó kiểm tra quota.

## 2. Lỗi Project not found / GOOGLE_CLOUD_PROJECT

Lỗi này thường nằm ở Gemini CLI/OAuth/Google Cloud, không phải StoryForge.

Checklist: đúng tài khoản Google -> gỡ quyền cũ tại https://myaccount.google.com/permissions -> nếu Google yêu cầu project thì tạo/chọn project tại https://console.cloud.google.com/projectcreate -> copy đúng **Project ID** -> bật Gemini for Google Cloud API tại https://console.cloud.google.com/apis/library/cloudaicompanion.googleapis.com -> chờ vài phút -> lấy callback mới rồi submit lại.

Nếu chạy Gemini CLI local trên Windows PowerShell: set `$env:GOOGLE_CLOUD_PROJECT="your-project-id"` và `$env:GOOGLE_CLOUD_PROJECT_ID="your-project-id"`, rồi chạy `gemini`.

## 3. Dán key vào StoryForge

Khi dashboard đã có quota, vào **Key Management** -> **Create API Key**. Nên tạo **3 key** để StoryForge xoay vòng ổn định hơn. Không gửi key công khai lên Discord.

Trong StoryForge: **Settings / Cài đặt** -> **API Keys** -> **Gemini Proxy**.

Dán 3 key, chọn provider **Gemini Proxy**, giữ Proxy URL `/api/proxy`, chọn chất lượng **Cân bằng**, rồi bấm **Test**.

Nếu vẫn lỗi: kiểm tra key thiếu ký tự, đúng khu Gemini Proxy, đúng provider. Nếu dịch bị dừng, giảm số luồng hoặc thêm key.
