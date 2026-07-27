export function canDiscardSecurePromptDraft({
  dirty,
  confirm = globalThis.confirm,
} = {}) {
  if (!dirty) return true;
  return confirm('Bản nháp Tối Thượng chưa được lưu. Rời trang và bỏ thay đổi?') === true;
}
