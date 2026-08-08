# Chính sách bảo mật

StoryForge xử lý bản thảo chưa công bố, file người dùng, đồng bộ cloud tùy chọn và các tuyến proxy AI. Báo cáo bảo mật có trách nhiệm giúp bảo vệ người viết và dữ liệu của họ.

## Phiên bản được hỗ trợ

Nhánh `main` và bản phát hành mới nhất nhận các bản sửa bảo mật. Các branch cũ hoặc bản triển khai do bên thứ ba tự duy trì không được hỗ trợ chính thức.

## Báo cáo lỗ hổng

Hãy dùng **Report a vulnerability** trong tab **Security** của repository để gửi báo cáo riêng tư:

https://github.com/Canhettg1133/StoryForge/security/advisories/new

Không mở issue công khai cho lỗ hổng chưa được khắc phục.

Báo cáo hữu ích nên có:

- Thành phần hoặc URL bị ảnh hưởng.
- Các bước tái hiện tối thiểu.
- Tác động có thể xảy ra.
- Bằng chứng đã được loại bỏ token, cookie, bản thảo và thông tin cá nhân.
- Gợi ý khắc phục nếu có.

## Phạm vi ưu tiên

- Xác thực, phân quyền và gói VIP.
- Upload, parse, export và xử lý file.
- Cloud sync, snapshot và dữ liệu bản thảo.
- AI proxy, redirect, rate limit và quản lý secret.
- Injection, XSS, SSRF hoặc truy cập dữ liệu chéo tài khoản.

Không kiểm thử trên tài khoản, repository, dữ liệu hoặc hệ thống production mà bạn không sở hữu hay chưa được cho phép. Không thực hiện phá hoại dữ liệu, gây gián đoạn dịch vụ hoặc truy xuất bản thảo của người khác.
