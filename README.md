# 🚀 StoryForge AI — Hệ Thống Hỗ Trợ Sáng Tác Tiểu Thuyết Thế Hệ Mới

StoryForge là một ứng dụng hỗ trợ viết truyện (Novel Authoring Tool) chuyên sâu, được thiết kế để giải quyết các vấn đề lớn nhất của việc sáng tác bằng AI: **mất trí nhớ (memory loss)**, **văn phong máy móc (AI clichés)**, và **thiếu tính nhất quán (continuity)**.

Dự án không chỉ là một trình soạn thảo, mà là một **AI Copilot** có khả năng hiểu sâu về cấu trúc, nhân vật và phong cách riêng của từng tác giả.

---

## 🔥 Tính năng Độc bản (Core Innovations)

### 1. Hệ thống Prompt 10 Lớp (10-Layer Prompt Architecture)
StoryForge sử dụng kiến trúc prompt phức tạp để kiểm soát LLM một cách tuyệt đối:
*   **Double Sandwich Anchor**: Đặt "Grand Strategy" ở đầu và "Priority Anchor" ở cuối user content để LLM không bao giờ lạc hướng.
*   **Layer 1.5 Constitution**: Thiết lập các nguyên tắc sáng tác bất biến (Constitution) của riêng bạn.
*   **Layer 7 Style DNA**: Định nghĩa văn phong (Hán Việt/Thuần Việt) với các quy tắc về nhịp điệu và từ vựng.
*   **Anti-AI Blacklist**: Loại bỏ hơn 100+ từ vựng AI hay dùng, ép AI viết một cách tự nhiên hơn.

### 2. Kỹ thuật Bridge Memory (Continuity Engine)
Giải quyết vấn đề AI "quên" những gì vừa xảy ra:
*   **Emotional State**: Lưu trữ trạng thái cảm xúc của cảnh trước.
*   **Prose Buffer**: Gửi 1-2 câu cuối của cảnh trước vào AI để đảm bảo nhịp văn nối tiếp mượt mà.
*   **Summary Chain**: Tự động tóm tắt chương cũ để làm input cho chương mới.

### 3. Đại Chiến Lược (Grand Strategy)
Hệ thống quản lý cốt truyện 4 cấp độ:
*   **Macro Arc**: Tầm nhìn dài hạn cho toàn bộ tác phẩm.
*   **Arc**: Các giai đoạn lớn trong truyện.
*   **Chapter Outline**: Dàn ý chi tiết cho từng chương.
*   **Scene Contract**: Hợp đồng cho từng cảnh (Mục tiêu, Xung đột, Pacing).

### 4. AI Codex (World Building)
Tự động quản lý kho dữ liệu về thế giới:
*   **Nhân vật**: Voice DNA (giọng nói riêng), ngoại hình, tính cách, quan hệ.
*   **Địa điểm/Vật phẩm**: Lưu trữ thông tin chi tiết để tránh mâu thuẫn.
*   **Auto-Extraction**: AI tự động trích xuất nhân vật/địa danh mới sau mỗi chương để cập nhật vào Codex.

---

## 🛠️ Công Nghệ Sử Dụng

*   **Frontend**: React + Vite + Lucide Icons.
*   **Styling**: Vanilla CSS (tối ưu tính linh hoạt và aesthetics).
*   **Database**: **Dexie.js (IndexedDB)** — Toàn bộ dữ liệu nằm trên trình duyệt của bạn (Full Local, bảo mật tuyệt đối).
*   **AI Backend**: 
    *   Hỗ trợ **Ollama** (chạy Local).
    *   Hỗ trợ **Gemini AI** (Proxy & Direct).
    *   Hỗ trợ **OpenAI/Claude** (Optional).
*   **Editor**: Tiptap Editor (Custom extensions for Chapter/Word Count).

---

## 📝 Novel Writer Skills — Nâng Tầm Văn Phong

StoryForge tích hợp framework "Novel Writer Skills" để đảm bảo chất lượng văn chương:
*   ✅ **Anti-AI Blacklist**: Chặn các cụm từ sáo rỗng như "cảm nhận được", "ánh mắt sâu thẳm", "tia sáng lóe qua".
*   ✅ **Paragraphing Rules**: Quy tắc 30-50% đoạn là câu đơn, độ dài đoạn 80-100 chữ để tạo nhịp thở cho văn xuôi.
*   ✅ **Concrete vs Abstract**: Ép AI cụ thể hóa hành động thay vì dùng tính từ trừu tượng.
*   ✅ **Character Voice**: Mỗi nhân vật có một "khẩu ngữ" và cách nói đặc trưng riêng.

---

## 🚀 Cài Đặt & Phát Triển

Dự án yêu cầu **Node.js 18+**.

1. **Clone repository**:
   ```bash
   git clone https://github.com/Canhettg1133/StoryForge.git
   cd StoryForge
   ```

2. **Cài đặt dependencies**:
   ```bash
   npm install
   ```

3. **Cấu hình môi trường**:
   - Copy `.env.example` thành `.env`.
   - Nhập API Key (Gemini) hoặc URL Ollama của bạn.

4. **Chạy Locally**:
   ```bash
   npm run dev
   ```

5. **Build cho Production**:
   ```bash
   npm run build
   ```

---

## 🎯 Lộ trình Phát triển (Roadmap)

*   [ ] **AI Editor Assistant**: AI tự động phát hiện lỗi logic khi tác giả viết.
*   [ ] **Timeline Visualization**: Bản đồ thời gian cho các sự kiện của nhân vật.
*   [ ] **Multi-POV Sync**: Đồng bộ hóa quan hệ nhân vật giữa các góc nhìn khác nhau.
*   [ ] **AI Copilot Mode**: Chế độ AI hỗ trợ viết từng đoạn thô rồi duyệt.

---

## 🛡️ Bảo mật Dữ liệu

Dữ liệu truyện của bạn là **TÀI SẢN DUY NHẤT** của bạn. StoryForge lưu trữ mọi thứ trong `IndexedDB` cục bộ trên thiết bị của bạn. Không có dữ liệu nào được tải lên máy chủ của chúng tôi (ngoại trừ Prompt gửi tới nhà cung cấp AI bạn chọn).

---

*Phát triển với ❤️ cho cộng đồng tác giả tâm huyết.*
