# 08 – Tech Stack & Build Timeline

## Tech Stack đề xuất

### Phương án A: Web App (khuyến nghị)

| Thành phần | Công nghệ | Ghi chú |
|-----------|-----------|---------|
| Frontend | **Vite + React** hoặc Next.js | Vite nhẹ hơn, Next.js có SSR |
| Editor | **Tiptap** | Rich text editor mạnh nhất, extensible |
| Lưu trữ | **IndexedDB** (data lớn) + **localStorage** (cài đặt) | Không cần backend DB |
| AI calls | Fetch → proxy URL, **ReadableStream** | Streaming realtime |
| Export | epub.js (EPUB), html-docx-js (DOCX), jspdf (PDF), Markdown, Plain text | Hỗ trợ Wattpad, AO3, Truyenfull, Tangthuvien |
| Deploy | Vercel / Netlify / self-host | |

### Phương án B: Desktop App

| Thành phần | Công nghệ |
|-----------|-----------|
| Framework | **Electron + React** hoặc **Tauri** (nhẹ hơn) |
| Editor | Tiptap (giống web) |
| Lợi thế | Lưu file trực tiếp, không CORS, chạy offline |

### Gọi Gemini qua proxy

```
Browser/App
  → POST {proxy_url}/v1/messages
  → Header: x-api-key: {selected_key}
  → Body: { model, messages, stream: true }
  → Proxy forward đến Gemini API
  → Response: ReadableStream text/event-stream
```

> Không cần backend riêng nếu proxy đã xử lý. App chỉ cần proxy URL + 6 key.

---

## Build Timeline

> 📌 Xem bảng roadmap chính thức tại [07-mvp-roadmap.md](./07-mvp-roadmap.md) — 6 tuần, 6 phase.

---

## Lưu ý dễ bỏ sót

| Điểm | Chi tiết |
|------|----------|
| **Tóm tắt chương tự động** | Khi chương "Hoàn thành" → Flash tạo ~200 từ tóm tắt → lưu metadata → là nguyên liệu Context Engine |
| **Giới hạn token** | Không inject toàn bộ Codex → chỉ nhân vật đang xuất hiện, thuật ngữ liên quan, tóm tắt ngắn |
| **Xưng hô tiếng Việt** | Trường "cách xưng hô" trong Codex không phải trang trí — phải inject vào prompt |
| **Streaming + Dừng** | User phải có nút Dừng để cancel AI viết sai hướng |
| **Quota sync** | Nếu nhiều tab → quota tracking lệch → lưu usage theo ngày (reset 07:00) hoặc track phía proxy |
