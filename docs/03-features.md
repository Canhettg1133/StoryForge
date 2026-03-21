# 03 – Tính năng bổ sung

Các tính năng không bắt buộc MVP nhưng nếu có sẽ làm app vượt lên rõ rệt.

---

## 3.1 Scene Contract
Lớp trung gian giữa outline và viết cảnh.

**Mỗi cảnh có:** POV, mục tiêu, xung đột chính, cảm xúc đầu/cuối, điều bắt buộc xảy ra, điều cấm tiết lộ, ai/vật có mặt, nhịp cảnh, độ dài, mức thoại/hành động/nội tâm

> AI đỡ lan man, người viết đỡ "generate mù".

---

## 3.2 Character State Engine
Lưu **trạng thái động** theo thời gian: sức khỏe, chấn thương, cảm xúc, mục tiêu, mức tin tưởng, bí mật, vật đang cầm, vị trí.

**Ngăn lỗi:** đang bị thương mà hành động bình thường, vừa cãi nhau xong cư xử sai logic, mất đồ rồi vẫn dùng.

---

## 3.3 Plot Thread Tracker
Theo dõi các tuyến: mystery, romance, revenge, family secret, political, prophecy...

**Trạng thái:** `seeded` → `building` → `dormant` → `active` → `payoff` → `broken`

**App nhắc:** clue chưa quay lại, romance mất dấu 7 chương, reveal quá sớm, tuyến phụ bị bỏ quên.

---

## 3.4 Timeline Simulator
Kiểm: ngày đêm, thời lượng di chuyển, song song tuyến, tuổi nhân vật, thời gian hồi phục, mùa/thời tiết.

**Bắt lỗi:** sáng HN trưa Huế vô lý, vết thương hồi quá nhanh, nhân vật xuất hiện hai nơi cùng lúc.

---

## 3.5 Relationship Heatmap
Theo dõi: yêu, ghét, sợ, nghi ngờ, nợ, phụ thuộc, kính trọng, phản bội. Hiển thị thay đổi theo chương/arc.

> Rất hợp cho ngôn tình, drama, cung đấu, fantasy ensemble cast.

---

## 3.6 Secret Visibility
Mỗi bí mật: ai biết, ai nghi, ai đoán sai, ai không biết, độc giả biết chưa, nhân vật nào chưa được phép biết.

> Vàng cho trinh thám, drama, twist-heavy stories.

---

## 3.7 Trope Manager
Chọn & theo dõi trope: enemies to lovers, found family, chosen one, slow burn, locked room mystery, revenge arc, mentor death, hidden identity...

> Theo dõi trope đang phát triển tốt hay hỏng nhịp.

---

## 3.8 Research Vault
Lưu nguồn tham khảo: note, link, đoạn trích, world inspiration, quy tắc y học/vũ khí/luật/văn hóa. Kết nối với scene, world fact, character background.

---

## 3.9 Beta Reader Layer *(sau này)*
Gửi bản beta, comment theo đoạn, đánh dấu đoạn chậm/khó hiểu/hay, reaction heatmap.
