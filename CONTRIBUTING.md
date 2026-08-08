# Đóng góp cho StoryForge

Cảm ơn bạn muốn đóng góp cho StoryForge. Dự án ưu tiên các thay đổi nhỏ, có mục tiêu rõ ràng và giữ an toàn cho dữ liệu bản thảo của người dùng.

## Trước khi bắt đầu

- Tìm issue hoặc pull request hiện có để tránh làm trùng.
- Với thay đổi lớn, hãy mở issue mô tả vấn đề và hướng giải quyết trước khi viết code.
- Không đưa API key, token, dữ liệu người dùng, bản thảo riêng tư hoặc cấu hình production vào issue, log hay commit.

## Thiết lập local

Yêu cầu Node.js 18 trở lên và npm.

```bash
git clone https://github.com/Canhettg1133/StoryForge.git
cd StoryForge
npm install
npm run dev
```

Tạo file cấu hình local từ các file `.example` phù hợp. Không commit file `.env`, `.local` hoặc secret.

## Quy trình thay đổi

1. Tạo branch từ `main` với tên ngắn, mô tả đúng mục đích.
2. Chỉ sửa những file cần thiết cho issue.
3. Thêm hoặc cập nhật test khi thay đổi hành vi.
4. Chạy nhóm test nhỏ liên quan trước, sau đó chạy nhóm test cốt lõi.
5. Mô tả rõ thay đổi và cách đã kiểm tra trong pull request.

```bash
npm run test:core
```

Khi cần kiểm tra toàn bộ dự án:

```bash
npm test
npm run build
```

Không chạy hai lệnh Vitest cùng lúc, không bỏ giới hạn worker và không chạy test song song với production build.

## Pull request tốt cần có

- Một mục tiêu chính, diff vừa đủ để review.
- Issue liên quan nếu có.
- Test chứng minh hành vi mới hoặc lỗi đã được sửa.
- Ghi chú về rủi ro bảo mật, migration hoặc ảnh hưởng triển khai.
- Ảnh chụp trước/sau nếu thay đổi giao diện.

Các thay đổi không liên quan nên được tách thành pull request khác.

## Báo cáo bảo mật

Không đăng lỗ hổng hoặc dữ liệu nhạy cảm trong issue công khai. Hãy làm theo [SECURITY.md](./SECURITY.md).
