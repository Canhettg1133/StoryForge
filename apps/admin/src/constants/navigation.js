import {
  Activity,
  Bell,
  BookOpen,
  Database,
  FileClock,
  Gauge,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

export const NAV_GROUPS = [
  {
    label: 'Vận hành',
    items: [
      { id: 'overview', label: 'Tổng quan', icon: Gauge },
      { id: 'users', label: 'Người dùng', icon: Users },
    ],
  },
  {
    label: 'Gói & quyền',
    items: [
      { id: 'vip', label: 'Gói VIP', icon: Sparkles },
      { id: 'features', label: 'Tính năng trong gói', icon: SlidersHorizontal },
      { id: 'consent', label: 'Điều khoản 18+', icon: ShieldCheck },
    ],
  },
  {
    label: 'Nội dung hệ thống',
    items: [
      { id: 'announcement', label: 'Thông báo', icon: Bell },
      { id: 'story-mirror', label: 'Kho truyện', icon: BookOpen },
    ],
  },
  {
    label: 'Giám sát',
    items: [
      { id: 'audit', label: 'Nhật ký quản trị', icon: FileClock },
      { id: 'vip-ranking', label: 'Xếp hạng VIP', icon: Trophy },
      { id: 'usage', label: 'Hoạt động người dùng', icon: Activity },
      { id: 'advanced', label: 'Nâng cao', icon: Database },
    ],
  },
];

const VIEW_TITLES = new Map(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item.label])),
);

export function getAdminViewTitle(viewId) {
  return VIEW_TITLES.get(viewId) || 'StoryForge qu?n tr?';
}
