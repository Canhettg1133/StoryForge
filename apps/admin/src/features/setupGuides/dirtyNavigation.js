export function canDiscardSetupGuideChanges({
  dirty,
  confirm = globalThis.confirm,
} = {}) {
  if (!dirty) return true;
  return confirm('Danh sách nút hướng dẫn chưa được lưu. Rời trang và bỏ thay đổi?') === true;
}


