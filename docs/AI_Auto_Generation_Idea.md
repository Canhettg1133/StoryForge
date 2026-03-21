# Chiến Lược Sinh Truyện Dài Kỳ Bằng AI (Long-form Novel Generation Strategy)

Được đúc kết từ quá trình phân tích tính năng của dự án StoryForge, tài liệu này lưu trữ ý tưởng thiết kế luồng (flow) cho tính năng "AI Nghĩ Chương Tiếp Theo" nhằm giải quyết bài toán viết truyện mạng dài hàng trăm, hàng ngàn chương.

## Vấn đề chí mạng của AI: "Hội Chứng Chốt Đơn Sớm" (Premature Resolution)
Các mô hình AI hiện nay (kể cả những model xịn nhất) khi được yêu cầu tạo nhiều chương truyện cùng lúc, thường có xu hướng đẩy nhanh tiến độ cốt truyện, vội vã đưa ra Boss cuối hoặc giải quyết xung đột chính để kết thúc truyện.
*Hậu quả:* Nếu dự tính viết truyện 500 chương mà bấm nút "Tự động tạo 20 chương", AI có thể kết thúc truyện ở chương 15.

---

## Các Giải Pháp Thiết Kế & Luồng Tính Năng (Proposed Flow)

### 1. Cài đặt Dự án (Project Creation Layer)
Bổ sung 3 trường thông tin vào Setting của Project để ràng buộc nhận thức AI ngay từ đầu:
- **Độ dài dự kiến (Target Length):** Phân loại độ dài (VD: Truyện ngắn 30-50, Truyện vừa 100-200, Trường thiên 500+).
- **Đích đến tối thượng (The Ultimate Goal):** Mục tiêu cuối cùng của toàn bộ truyện (VD: "Đạt tới Cảnh giới Thần Tôn", "Trả thù lật đổ gia tộc X").
- **Các Cột mốc lớn (Major Milestones):** Danh sách 5-10 sự kiện quan trọng phân bổ theo % tiến trình, giúp AI hiểu nhịp độ toàn bộ truyện (VD: "25% — Main đạt cảnh giới Trúc Cơ", "50% — Main khám phá bí mật thân thế", "90% — Trận chiến cuối cùng").

👉 **Cách nhúng vào Prompt (quan trọng):** KHÔNG dùng số chương tuyệt đối (AI không hiểu "chương 490" theo nghĩa toàn cục). Thay vào đó, hệ thống tự động tính và nhúng **tỷ lệ phần trăm tiến trình**:
> *"Truyện hiện đang ở 10% tiến độ (chương 50/500). Nhân vật chỉ mới chạm tới 10% sức mạnh đỉnh cao. Cột mốc tiếp theo ở 25%. Cấm vượt quá 15% trong đợt tạo này."*

### 2. Tư duy sinh truyện theo "Quyển/Hồi" (Arc-based Generation)
Không cho phép AI sinh lơ lửng ngẫu nhiên 20 chương. Mọi đợt "sinh hàng loạt" đều phải thuộc về một Story Arc.
- **Bước 1 — Thiết lập Arc Goal.** Khi tác giả bấm "Tạo 20 chương", hệ thống yêu cầu xác định:
  - Mục tiêu của 20 chương này (VD: "Main đi vào Bí cảnh, gặp sư phụ mới").
  - Nhịp độ (Pacing): Khởi đầu chậm / Căng thẳng dần / Cao trào cuối arc.
- **Bước 2 — AI Generate Outline (Sinh Dàn Ý trước, CHƯA VIẾT CHỮ).** AI tạo ra 20 đầu mục (Gồm Tên chương + 2-3 dòng tóm tắt). Prompt ngầm yêu cầu AI: *"Chỉ tạo khó khăn nhỏ, cày cấp, mở rộng quan hệ. Không đụng đến tuyến chính. Không giải quyết bất kỳ Plot Thread nào trừ khi được chỉ định rõ."*
- **Bước 3 — Tác giả Duyệt & Tinh chỉnh.** Tác giả kiểm tra 20 dòng tóm tắt này trên giao diện, có thể sửa lại những chỗ AI đi sai hướng trước khi chốt.
- **Bước 4 — Batch Generation (Đắp thịt).** Sau khi dàn ý được chốt, hệ thống gọi API (chạy song song nhiều keys nếu có) để viết chi tiết nội dung 7000 từ/chương bám sát đúng từng dòng tóm tắt.

### 3. Vũ Khí Tối Thượng: Tính năng "CẤM KỴ" (Taboo System)
Tận dụng tính năng `Taboos` có sẵn trong Bách Khoa Toàn Thư (`codexStore`) làm vòng kim cô kiềm chế AI:
- Chủ động cung cấp cho tác giả tính năng tạo Taboo có thời hạn khi chuẩn bị tạo chương.
- *Ví dụ:*
  - Taboo 1: "Cấm Main lộ thân phận thật với cô gái A" (Hết hạn ở chương 200).
  - Taboo 2: "Cấm Main giết phản diện B, phản diện B luôn phải đào tẩu thành công" (Hết hạn ở chương 150).
  - Taboo 3: "Cấm Main bay lượn hoặc dùng phép thuật level Nguyên Anh, hiện tại chỉ ở level Trúc Cơ" (Hết hạn ở chương 100).
- 👉 Đây là chốt chặn để câu giờ (stretch pacing), ép AI phải tư duy quanh co và viết dài hơn, xử lý triệt để việc AI đốt cháy giai đoạn.

### 4. Ý tưởng UI: Chế độ "Bán Tự Động" & "Đột Phá"
Tại màn hình Bảng Dàn Ý (OutlineBoard), cung cấp 2 chế độ tạo chương tiếp theo:
- **Chế độ Bán tự động (Guided):** Tác giả nhập một câu ngắn bé tí (VD: "Nay cho main đi đấu giá gặp rắc rối"). AI kết hợp câu này + StoryBible → Dàn ý 5 cảnh chi tiết rõ ràng.
- **Chế độ Đột phá (Auto Brainstorm/Twist):** Tác giả cạn kiệt ý tưởng, chỉ cần bấm 1 nút.
  - *Thuật toán ngầm (Weighted Random — không phải random thuần):*
    - Ưu tiên `Plot Thread` nào **lâu nhất chưa được nhắc tới** → Trọng số cao hơn.
    - Ưu tiên `Canon Fact` nào **liên quan đến nhân vật đang hoạt động** trong chương gần nhất → Ưu tiên chọn.
    - Kèm theo `Tóm tắt chương trước` làm ngữ cảnh.
  - *Kết quả:* AI nghĩ ra 3 hướng đi giật gân, lật bàn (plot twist). Tác giả ưng hướng nào thì bấm dấu (+) để convert luôn thành Dàn ý hoàn chỉnh đưa vào cây truyện.
  - *Lưu ý:* Tránh bốc ngẫu nhiên thuần túy vì có thể ghép ra combo vô nghĩa (VD: Canon Fact "Thế giới có 5 đại lục" + Plot Thread "Mối tình tay ba" → ép ghép gượng gạo).

### 5. Vòng Phản Hồi Sau Khi Tạo (Feedback Loop — Batch Correction)
Sau khi AI đắp thịt xong 20 chương, tác giả đọc lại và phát hiện sai sót. Cần có cơ chế sửa chữa hiệu quả thay vì xóa hết làm lại:
- **Đánh dấu chương sai (Flag & Regenerate):** Tác giả đánh dấu "Chương 12 đi sai hướng" trên giao diện. Có thể ghi thêm ghi chú sửa đổi (VD: "Đừng cho main thắng trận này, cho main thua để tạo động lực tu luyện").
- **Re-generate từ điểm sai (Cascade Re-gen):** Hệ thống tự động re-generate lại **từ chương 12 trở đi** (12→20), dựa trên bản sửa của tác giả + dàn ý gốc đã chỉnh. Các chương 1→11 vẫn giữ nguyên, tiết kiệm thời gian và token.
- **So sánh phiên bản (Diff View):** Sau khi re-generate, hiển thị bản cũ vs bản mới song song để tác giả đối chiếu trước khi chấp nhận.

---
*Tài liệu ý tưởng v2 — Cập nhật lần cuối: 2026-03-22*
