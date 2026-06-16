const DEFAULT_PRICE_LABEL = '50.000đ';

const FIELD_LIMITS = Object.freeze({
  title: 80,
  priceLabel: 32,
  introText: 320,
  supportText: 220,
  signedInVipText: 160,
  signedInFreeText: 180,
  signedOutText: 180,
  paymentNotice: 220,
});

function cleanText(value, fallback, maxLength) {
  const text = String(value ?? '').trim();
  const safe = text || fallback;
  return safe.length > maxLength ? safe.slice(0, maxLength).trim() : safe;
}

export function createDefaultVipPageContent(priceLabel = DEFAULT_PRICE_LABEL) {
  const safePrice = cleanText(priceLabel, DEFAULT_PRICE_LABEL, FIELD_LIMITS.priceLabel);
  return {
    title: 'Tài khoản & VIP StoryForge',
    priceLabel: safePrice,
    introText: `Do lượng người dùng tăng khá nhanh, chi phí duy trì web hiện tại không còn đủ để admin cấp VIP miễn phí như trước. Vì vậy VIP sẽ chuyển sang mức ${safePrice} để tiếp tục duy trì StoryForge ổn định hơn.`,
    supportText: 'Ủng hộ dự án, vào server Discord hoặc nhắn admin khi cần hỗ trợ tài khoản và VIP.',
    signedInVipText: 'Tài khoản của bạn đã có VIP.',
    signedInFreeText: 'Copy email bên dưới rồi gửi admin để kích hoạt VIP.',
    signedOutText: 'Đăng nhập Google để lấy email gửi admin mua và kích hoạt VIP.',
    paymentNotice: `VIP ${safePrice}. Sau khi thanh toán, admin sẽ kích hoạt VIP theo đúng email Google đã đăng nhập.`,
  };
}

export const DEFAULT_VIP_PAGE_CONTENT = Object.freeze(createDefaultVipPageContent());

export const VIP_PAGE_CONTENT_FIELDS = Object.freeze(Object.keys(FIELD_LIMITS));

export function normalizeVipPageContent(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const priceLabel = cleanText(source.priceLabel, DEFAULT_PRICE_LABEL, FIELD_LIMITS.priceLabel);
  const fallback = createDefaultVipPageContent(priceLabel);

  return VIP_PAGE_CONTENT_FIELDS.reduce((content, field) => {
    content[field] = cleanText(source[field], fallback[field], FIELD_LIMITS[field]);
    return content;
  }, {});
}

export function getVipPageContentFromPlan(plan = {}) {
  return normalizeVipPageContent(plan?.metadata?.vipPage);
}
