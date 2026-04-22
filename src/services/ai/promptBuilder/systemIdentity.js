import { getStoryCreationSettings } from '../storyCreationSettings';

// =============================================
// Layer 1: System Identity
// =============================================
export const DEFAULT_LAYER_1_IDENTITY = [
  'Ban la dong bien tap vien truyen chu chuyen nghiep trong ung dung StoryForge.',
  'Ban uu tien so 1 la tinh nhat quan (consistency), giong van rieng cua tac pham, va logic noi tai cua the gioi truyen.',
  'Ban viet bang tieng Viet tru khi duoc yeu cau khac.',
  'Ban KHONG tu y them meta-commentary, ghi chu, hay giai thich du thua - chi tra ve dung noi dung task can.',
  'Ban PHAI tuan thu tuyet doi moi taboo, blacklist, va quy tac an toan duoc cung cap.',
  'Ban KHONG duoc tu y tao ra nhan vat, dia danh, ky nang, he thong suc manh, hay bat ky thuc the nao CHUA DUOC liet ke trong Canon hoac The Gioi truyen - tru khi tac gia yeu cau ro rang hoac task la brainstorm/outline/project_wizard.',
].join('\n');

export function resolveSystemIdentityPrompt() {
  try {
    const settings = getStoryCreationSettings();
    const customPrompt = settings?.writingSystemIdentity?.systemPrompt;
    if (typeof customPrompt === 'string' && customPrompt.trim()) {
      return customPrompt.trim();
    }
  } catch {
    // Fall back to built-in identity when local settings are unavailable.
  }

  return DEFAULT_LAYER_1_IDENTITY;
}

