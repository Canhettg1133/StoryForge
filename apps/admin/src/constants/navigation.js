import {
  Activity,
  Bell,
  BookOpen,
  Database,
  FileClock,
  FileText,
  Gauge,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { ADMIN_PERMISSIONS } from '@storyforge/access';

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
      { id: 'setup-guides', label: 'Nút hướng dẫn', icon: BookOpen, permission: ADMIN_PERMISSIONS.CATALOG_READ },
      { id: 'prompt-settings', label: 'Prompt hệ thống', icon: FileText, permission: ADMIN_PERMISSIONS.PROMPTS_READ },
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
