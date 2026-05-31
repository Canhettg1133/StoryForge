-- StoryForge Admin default catalog, features and plan-feature mapping.
-- Safe to re-run: rows are upserted by plan key / feature key / (plan, feature_key).

insert into public.storyforge_plan_catalog (key, name, description, enabled, sort_order, updated_at)
values
  ('free', 'Miễn phí', 'Gói mặc định cho người dùng mới, đủ để dùng các luồng viết cơ bản và Cloud Sync giới hạn.', true, 10, now()),
  ('vip', 'VIP', 'Gói trả phí chính: mở batch generation, giới hạn AI cao hơn, thêm công cụ canon và phân tích.', true, 20, now()),
  ('pro', 'Pro', 'Gói nâng cao cho người viết dùng thường xuyên, giới hạn lớn hơn VIP và mở toàn bộ lab chính.', true, 30, now()),
  ('enterprise', 'Doanh nghiệp', 'Gói tuỳ chỉnh cho nhóm/tổ chức, giới hạn cao nhất và ưu tiên hỗ trợ.', true, 40, now())
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.storyforge_features (key, name, description, category, enabled, requires_plan, updated_at)
values
  ('ai_writer', 'AI viết truyện', 'Gọi AI cho viết tiếp, viết lại, mở rộng và xử lý prompt trong editor.', 'writing', true, null, now()),
  ('ai_rewrite', 'Viết lại nâng cao', 'Các tác vụ rewrite/expand/continue có context và guardrail tốt hơn.', 'writing', true, null, now()),
  ('batch_generation', 'Sinh chương hàng loạt', 'Tạo nhiều chương hoặc nhiều đoạn theo batch cho dự án dài.', 'writing', true, 'vip', now()),
  ('canon_tools', 'Canon và bối cảnh nâng cao', 'Quản lý nhân vật, địa điểm, vật phẩm, fact và đồng bộ canon khi viết.', 'canon', true, 'vip', now()),
  ('relationship_map', 'Bản đồ quan hệ', 'Theo dõi quan hệ nhân vật, trạng thái phân tích và đề xuất cập nhật.', 'canon', true, 'vip', now()),
  ('cloud_sync', 'Cloud Sync', 'Đồng bộ snapshot dự án qua endpoint cloud của StoryForge.', 'cloud', true, null, now()),
  ('project_export', 'Xuất bản thảo', 'Xuất dự án ra các định dạng phục vụ lưu trữ hoặc biên tập.', 'export', true, null, now()),
  ('ai_studio_relay', 'AI Studio Relay', 'Kết nối AI Studio qua Worker relay riêng.', 'ai', true, null, now()),
  ('lab_lite', 'Lab Lite', 'Pipeline phân tích nhẹ cho corpus/canon pack khi cần kiểm tra nhanh.', 'lab', true, 'vip', now()),
  ('corpus_lab', 'Corpus Lab', 'Phân tích corpus sâu, viewer và materialization flow.', 'lab', true, 'pro', now()),
  ('priority_support', 'Hỗ trợ ưu tiên', 'Ưu tiên xử lý sự cố và cấu hình deploy cho tài khoản trả phí.', 'support', true, 'pro', now())
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  enabled = excluded.enabled,
  requires_plan = excluded.requires_plan,
  updated_at = now();

insert into public.storyforge_plan_features (plan, feature_key, enabled, limits, updated_at)
values
  ('free', 'ai_writer', true, '{"daily_ai_requests": 30, "max_context_tokens": 12000}'::jsonb, now()),
  ('free', 'ai_rewrite', true, '{"daily_rewrite_requests": 15}'::jsonb, now()),
  ('free', 'batch_generation', false, '{}'::jsonb, now()),
  ('free', 'canon_tools', true, '{"max_entities": 80}'::jsonb, now()),
  ('free', 'relationship_map', false, '{}'::jsonb, now()),
  ('free', 'cloud_sync', true, '{"max_projects": 3, "snapshot_bytes": 4000000}'::jsonb, now()),
  ('free', 'project_export', true, '{"formats": ["txt", "json"]}'::jsonb, now()),
  ('free', 'ai_studio_relay', true, '{"connector_rooms": 1}'::jsonb, now()),
  ('free', 'lab_lite', false, '{}'::jsonb, now()),
  ('free', 'corpus_lab', false, '{}'::jsonb, now()),
  ('free', 'priority_support', false, '{}'::jsonb, now()),

  ('vip', 'ai_writer', true, '{"daily_ai_requests": 300, "max_context_tokens": 50000}'::jsonb, now()),
  ('vip', 'ai_rewrite', true, '{"daily_rewrite_requests": 160}'::jsonb, now()),
  ('vip', 'batch_generation', true, '{"max_batch_chapters": 20}'::jsonb, now()),
  ('vip', 'canon_tools', true, '{"max_entities": 1000}'::jsonb, now()),
  ('vip', 'relationship_map', true, '{"max_relationships": 1200}'::jsonb, now()),
  ('vip', 'cloud_sync', true, '{"max_projects": 25, "snapshot_bytes": 4000000}'::jsonb, now()),
  ('vip', 'project_export', true, '{"formats": ["txt", "json", "docx", "epub"]}'::jsonb, now()),
  ('vip', 'ai_studio_relay', true, '{"connector_rooms": 5}'::jsonb, now()),
  ('vip', 'lab_lite', true, '{"monthly_jobs": 100}'::jsonb, now()),
  ('vip', 'corpus_lab', false, '{}'::jsonb, now()),
  ('vip', 'priority_support', false, '{}'::jsonb, now()),

  ('pro', 'ai_writer', true, '{"daily_ai_requests": 1000, "max_context_tokens": 100000}'::jsonb, now()),
  ('pro', 'ai_rewrite', true, '{"daily_rewrite_requests": 600}'::jsonb, now()),
  ('pro', 'batch_generation', true, '{"max_batch_chapters": 60}'::jsonb, now()),
  ('pro', 'canon_tools', true, '{"max_entities": 5000}'::jsonb, now()),
  ('pro', 'relationship_map', true, '{"max_relationships": 5000}'::jsonb, now()),
  ('pro', 'cloud_sync', true, '{"max_projects": 100, "snapshot_bytes": 4000000}'::jsonb, now()),
  ('pro', 'project_export', true, '{"formats": ["txt", "json", "docx", "epub"]}'::jsonb, now()),
  ('pro', 'ai_studio_relay', true, '{"connector_rooms": 20}'::jsonb, now()),
  ('pro', 'lab_lite', true, '{"monthly_jobs": 500}'::jsonb, now()),
  ('pro', 'corpus_lab', true, '{"monthly_jobs": 100}'::jsonb, now()),
  ('pro', 'priority_support', true, '{"response": "standard"}'::jsonb, now()),

  ('enterprise', 'ai_writer', true, '{"daily_ai_requests": 5000, "max_context_tokens": 200000}'::jsonb, now()),
  ('enterprise', 'ai_rewrite', true, '{"daily_rewrite_requests": 3000}'::jsonb, now()),
  ('enterprise', 'batch_generation', true, '{"max_batch_chapters": 200}'::jsonb, now()),
  ('enterprise', 'canon_tools', true, '{"max_entities": 25000}'::jsonb, now()),
  ('enterprise', 'relationship_map', true, '{"max_relationships": 25000}'::jsonb, now()),
  ('enterprise', 'cloud_sync', true, '{"max_projects": 1000, "snapshot_bytes": 4000000}'::jsonb, now()),
  ('enterprise', 'project_export', true, '{"formats": ["txt", "json", "docx", "epub"]}'::jsonb, now()),
  ('enterprise', 'ai_studio_relay', true, '{"connector_rooms": 100}'::jsonb, now()),
  ('enterprise', 'lab_lite', true, '{"monthly_jobs": 5000}'::jsonb, now()),
  ('enterprise', 'corpus_lab', true, '{"monthly_jobs": 1000}'::jsonb, now()),
  ('enterprise', 'priority_support', true, '{"response": "priority"}'::jsonb, now())
on conflict (plan, feature_key) do update set
  enabled = excluded.enabled,
  limits = excluded.limits,
  updated_at = now();
