insert into public.plans(key, name, description, sort_order)
values
  ('free', 'Miễn phí', 'Gói mặc định cho tài khoản mới.', 10),
  ('vip', 'VIP', 'Mở khóa dịch truyện, Chat AI, provider nâng cao và chế độ 18+ sau khi đủ điều kiện.', 20),
  ('lifetime', 'Lifetime', 'Quyền VIP trọn đời cho tài khoản được cấp thủ công.', 30)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

insert into public.features(key, name, description, category, active)
values
  ('translator.access', 'Dịch truyện', 'Cho phép chạy pipeline dịch truyện trong StoryForge.', 'translator', true),
  ('ai_chat.access', 'Chat AI', 'Cho phép dùng Chat AI của dự án và chat tự do.', 'ai', true),
  ('content.adult_mode', 'Chế độ 18+', 'Cho phép bật nội dung 18+ sau khi xác nhận tuổi và đồng ý điều khoản.', 'content', true),
  ('provider.ag_proxy', 'Gemini Proxy AG', 'Cho phép dùng Gemini Proxy AG qua backend được kiểm quyền.', 'provider', true),
  ('provider.ai_studio_relay', 'AI Studio Relay', 'Cho phép tạo room AI Studio Relay.', 'provider', true),
  ('provider.gemini_direct', 'Gemini Direct', 'Cho phép dùng Gemini Direct qua API key AI Studio.', 'provider', true),
  ('provider.custom_proxy', 'Custom Proxy', 'Cho phép dùng custom OpenAI-compatible proxy trong app.', 'provider', true),
  ('translator.parallel_high', 'Request song song cao', 'Cho phép dùng mức request song song cao trong dịch truyện.', 'translator', true),
  ('translator.bulk_keys', 'Nhập nhiều API key', 'Cho phép nhập/xuất nhiều API key trong trang cài đặt.', 'translator', true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  updated_at = now();

with plan_map as (
  select id, key from public.plans where key in ('vip', 'lifetime')
),
feature_map as (
  select key from public.features
  where key in (
    'translator.access',
    'ai_chat.access',
    'content.adult_mode',
    'provider.ag_proxy',
    'provider.ai_studio_relay',
    'provider.gemini_direct',
    'provider.custom_proxy',
    'translator.parallel_high',
    'translator.bulk_keys'
  )
)
insert into public.plan_features(plan_id, feature_key, enabled)
select plan_map.id, feature_map.key, true
from plan_map
cross join feature_map
on conflict (plan_id, feature_key) do update set
  enabled = excluded.enabled,
  updated_at = now();

insert into public.consent_versions(key, version, title, body, active)
values (
  'adult_terms',
  '2026-05',
  'Điều khoản nội dung 18+',
  'Tôi xác nhận mình đủ tuổi theo pháp luật nơi cư trú và hiểu rằng chế độ 18+ chỉ dành cho nội dung hư cấu trong phạm vi sử dụng hợp pháp.',
  true
)
on conflict (key, version) do update set
  title = excluded.title,
  body = excluded.body,
  active = true;
