# 01 – Tổng quan dự án

## Tại sao cần app này?

Tác giả viết truyện dài đều gặp một vấn đề giống nhau: AI rất giỏi viết từng đoạn ngắn, nhưng không nhớ gì về những gì đã xảy ra ở chương trước. Nhân vật đổi tính cách, địa danh sai tên, bí mật bị tiết lộ nhầm chương — những lỗi này xuất hiện liên tục vì AI không có ngữ cảnh.

App này giải quyết đúng vấn đề đó. Không phải "một cửa sổ chat thêm vào editor". Mà là một workspace nơi AI luôn biết mình đang viết câu chuyện nào, nhân vật nào đang xuất hiện, và điều gì *chưa được phép* xảy ra ở chương hiện tại.

---

## Dự án này là gì

Một **hệ điều hành dành cho người viết truyện chữ**, có AI làm đồng biên tập, đồng triển khai bản nháp, và bộ nhớ truyện để giữ canon, giọng văn, logic và tiến trình sáng tác.

**Đúng hướng:**
- Quản lý dự án truyện dài, hỗ trợ nhiều thể loại
- Giữ logic thế giới truyện + giọng văn
- Hỗ trợ viết/sửa/rà/kiểm/phát triển tác phẩm lâu dài

**KHÔNG phải:**
- ❌ Chatbot viết truyện / Playground prompt → generate
- ❌ Editor chung chung kiểu Google Docs + nút AI
- ❌ AI viết truyện tự động / Novel generator

---

## Luận điểm sản phẩm

> **AI không phải lõi. Lõi là hệ thống truyện.**

AI chỉ có giá trị khi đặt lên trên: project structure, canon, memory, style, timeline, plot threads, workflow viết cảnh. Nếu không → chỉ là `editor + chatbot`.

---

## Đối tượng người dùng

### Nhóm chính
- Người viết tiểu thuyết / truyện dài nhiều chương / web novel / fanfic dài
- Đa thể loại: fantasy, tiên hiệp, ngôn tình, trinh thám, kinh dị, sci-fi, drama, slice of life

### Nhóm phụ
- Writer dùng AI brainstorm/outline/rewrite
- Người mới cần công cụ dẫn dắt quy trình
- Người có truyện cũ muốn AI học giọng của họ
- Team nhỏ 2–3 người đồng viết

### Không nhắm tới
- Người chỉ muốn "prompt ra truyện"
- Người viết content ngắn / marketing copy
- Người chỉ cần chatbot văn chương

---

## 6 vấn đề cốt lõi cần giải quyết

| # | Vấn đề | Chi tiết |
|---|--------|----------|
| 1 | Viết dài thì dễ loạn | Quên tình tiết, timeline, nhân vật biết sai, lore mâu thuẫn |
| 2 | AI không giữ được truyện | Lạc giọng, mất continuity, quên state/bí mật |
| 3 | App quản lý chỉ mạnh quản lý | Có chapter/note/card nhưng AI không hiểu tác phẩm |
| 4 | App AI chỉ mạnh generate | Không có hệ thống dự án, bộ nhớ, biên tập |
| 5 | Cần hơn viết nháp | Cần outline, giữ giọng, sửa văn, kiểm pacing/logic, plot thread |
| 6 | Không hiểu thể loại | Fantasy cần worldbuilding, trinh thám cần clue, ngôn tình cần beat... |

---

## Định vị & Tên

- **Tên:** StoryForge
- **Định vị:** Story OS for Novelists
- **Gợi ý:** rèn tác phẩm, đúc truyện, tạo và hoàn thiện dần

> Không định vị là "AI viết truyện" → tránh kỳ vọng sai (bấm nút ra chương, dùng rồi bỏ).  
> Định vị "Story OS" → người dùng lưu dự án, xây thế giới, nuôi nhân vật, giữ mạch → dùng lâu dài.

---

## USP – 5 điểm khác biệt thật sự

| # | USP | Mô tả |
|---|-----|-------|
| 1 | **Canon-first AI Writing** | AI luôn bị ràng buộc bởi bộ luật truyện |
| 2 | **Scene-based Writing Workflow** | Mọi thứ đi qua outline + scene contract |
| 3 | **Style Continuity** | AI học giọng chính người dùng |
| 4 | **Genre-aware** | Mỗi thể loại có workflow/prompt riêng |
| 5 | **Revision & QA as core** | Sửa truyện là tính năng lõi, không phải phụ |

---

## Đặc trưng cho thị trường Việt Nam 🇻🇳

### Cách xưng hô
Không có app nước ngoài nào xử lý được vấn đề này đúng cách. Tiếng Việt có hàng chục cặp xưng hô khác nhau tùy quan hệ, tuổi tác, bối cảnh. App lưu cách xưng hô của từng nhân vật trong Codex và inject vào mỗi prompt — AI sẽ không bao giờ để Minh bỗng dưng xưng "tôi" thay vì "ta".

### Thể loại nội địa
Genre Pack sẽ bao gồm các thể loại đặc trưng của thị trường truyện Việt: xuyên không, trọng sinh, đô thị dị năng, võ hiệp, cổ đại ngôn tình. Không chỉ copy preset từ app nước ngoài.

### Nền tảng xuất bản
Export format tối ưu cho các nền tảng Việt Nam phổ biến: Wattpad, Truyenfull, Tangthuvien, và các trang tự xuất bản.

---

## Tầm nhìn

Nơi người viết có thể: bắt đầu từ ý tưởng mơ hồ → xây thế giới truyện → viết từng cảnh/chương với AI hỗ trợ → giữ canon và giọng văn ổn định → hoàn thiện tác phẩm đến mức xuất bản.
