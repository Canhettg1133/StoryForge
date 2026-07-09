// Facebook Group Lead Extractor Content Script
// Designed to be passive and human-behavior-safe
// Only reads publicly visible text content — no API calls, no form interactions
console.log("TravelLead Facebook Extractor Injected.");

let isScanning = false;
let scrollTimeout = null;
let observer = null;
let scrapedNumbers = new Set();
let pausedScrolling = false;
let expandedElements = new WeakSet();
let observedTextKeys = new Set();
let observedNetworkTextKeys = new Set();
let scanMetrics = createEmptyScanMetrics();
let lastScanReason = '';
let isContinuousScan = false;
let networkTextListenerInstalled = false;

const NETWORK_TEXT_MESSAGE_SOURCE = 'TRAVEL_LEAD_FB_NETWORK_TEXT';

const phoneEngine = globalThis.TravelLeadFbPhoneEngine;

function createEmptyScanMetrics() {
  return {
    postCount: 0,
    commentCount: 0,
    textNodeCount: 0,
    rawCandidateCount: 0,
    validPhoneCount: 0,
    rejectedCount: 0,
    expandedClickCount: 0,
    networkTextCount: 0,
    networkPhoneCount: 0,
  };
}

function resetScanSession() {
  scrapedNumbers.clear();
  observedTextKeys.clear();
  observedNetworkTextKeys.clear();
  expandedElements = new WeakSet();
  scanMetrics = createEmptyScanMetrics();
  lastScanReason = '';
}

function publishScanProgress(status, extra = {}) {
  chrome.runtime.sendMessage({
    action: "FB_SCAN_PROGRESS",
    status,
    currentUrl: window.location?.href || '',
    metrics: { ...scanMetrics },
    reason: lastScanReason,
    ...extra,
  });
}

// ===== PHONE NUMBER DETECTION =====
// Vietnamese phone carriers - only match valid mobile prefixes
// This avoids false positives from random number strings
const VN_MOBILE_PREFIXES = [
  // Viettel: 032-039, 086, 096, 097, 098
  '032','033','034','035','036','037','038','039','086','096','097','098',
  // Mobifone: 070, 076-079, 089, 090, 093
  '070','076','077','078','079','089','090','093',
  // Vinaphone: 081-085, 088, 091, 094
  '081','082','083','084','085','088','091','094',
  // Vietnamobile: 052, 056, 058
  '052','056','058',
  // Gmobile: 059
  '059',
  // Reddi: 055
  '055'
];

// Build a single regex pattern from all valid prefixes
// Matches: 0xx xxxx xxx, 0xx.xxxx.xxx, 0xx-xxxx-xxx, +84 xx xxxx xxx, 84xxxxxxxxx
// With flexible separators (space, dot, dash) between groups
const prefixPattern = VN_MOBILE_PREFIXES.map(p => p.substring(1)).join('|'); // Remove leading 0
const VN_PHONE_REGEX = new RegExp(
  `(?:(?:\\+84|84)(?:${prefixPattern})|0(?:${prefixPattern.replace(/^/gm, '')}))` +
  `[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{3,4}`,
  'g'
);

// Simpler fallback regex for common Vietnamese phone formats (made broader)
const VN_PHONE_SIMPLE = /(?:\+84|84|0)(3|5|7|8|9)[0-9][\s\.\-]*[0-9]{3}[\s\.\-]*[0-9]{4}/g;

// Common non-phone patterns to exclude (account numbers, dates, IDs, etc.)
const EXCLUDE_PATTERNS = [
  /\b\d{2}[\/\-]\d{2}[\/\-]\d{2,4}\b/, // Dates
  /STK|stk|Số TK|số tk|tài khoản/i,     // Bank account numbers
  /CCCD|cccd|CMND|cmnd/i,               // ID card numbers
  /mã đơn|order|booking|code/i,          // Order/booking codes
];

// Listen to commands from dashboard page via background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Facebook Script received message:", message);

  // Ping handler - lets background check if content script is alive
  if (message.action === "PING") {
    sendResponse({ success: true, ready: true });
    return true;
  }

  if (message.action === "START_FB_SCAN") {
    const requestedScrollCount = Number.parseInt(message.scrollCount, 10);
    startScanning(
      message.autoScroll,
      Number.isFinite(requestedScrollCount) ? requestedScrollCount : 20,
      message.continuousScan === true
    );
    sendResponse({ success: true, message: "Started scanning" });
  }
  else if (message.action === "STOP_FB_SCAN") {
    stopScanning();
    sendResponse({ success: true, message: "Stopped scanning" });
  }
  else if (message.action === "GET_SCAN_STATUS") {
    sendResponse({ isScanning, count: scrapedNumbers.size });
  }
  return true;
});

let maxScrollCount = 20; // Configurable from dashboard

function startScanning(autoScroll = true, scrollCount = 20, continuousScan = false) {
  if (isScanning) return;
  isScanning = true;
  pausedScrolling = false;
  const parsedScrollCount = Number.parseInt(scrollCount, 10);
  isContinuousScan = continuousScan || parsedScrollCount <= 0;
  maxScrollCount = isContinuousScan ? Number.POSITIVE_INFINITY : (parsedScrollCount || 20);
  resetScanSession();

  console.log(`Facebook Scanning started. Mode: ${autoScroll ? 'Auto-scroll' : 'Passive'}, Max scrolls: ${isContinuousScan ? 'continuous' : maxScrollCount}`);
  publishScanProgress("STARTED", { message: "Bắt đầu quét Facebook." });
  installNetworkTextCapture();

  // 1. Expand visible post/comment text first, then scrape what is already visible.
  expandVisibleFacebookText();
  performScrape();

  // 2. Setup passive scanning: Listen to page modifications (as user scrolls or new posts load)
  // MutationObserver is 100% safe - it only observes DOM changes, no network requests
  setupMutationObserver();

  // 3. Human-like natural auto-scroll (only if requested)
  if (autoScroll) {
    // Start with a random initial delay (2-5 seconds) to seem natural
    const initialDelay = Math.floor(Math.random() * 3000) + 2000;
    scrollTimeout = setTimeout(() => {
      runHumanLikeScroll(0);
    }, initialDelay);
  }
}

function stopScanning() {
  if (!isScanning) return;
  isScanning = false;
  pausedScrolling = false;
  isContinuousScan = false;

  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  console.log("Facebook Scanning stopped. Total scraped:", scrapedNumbers.size);
  if (scrapedNumbers.size === 0 && !lastScanReason) {
    lastScanReason = "Không tìm thấy SĐT hợp lệ trong phần nội dung Facebook đã tải.";
  }
  publishScanProgress("DONE", { count: scrapedNumbers.size });

  // Notify background that scan finished
  chrome.runtime.sendMessage({
    action: "FB_SCAN_COMPLETED",
    count: scrapedNumbers.size,
    metrics: { ...scanMetrics },
    reason: lastScanReason,
  });
}

// Observe dynamic DOM changes (e.g. infinite scroll) and scrape automatically
function setupMutationObserver() {
  if (observer) observer.disconnect();

  let debounceTimeout = null;
  observer = new MutationObserver((mutations) => {
    if (!isScanning) return;

    // Only process if new nodes were actually added (not just attribute changes)
    const hasNewContent = mutations.some(m => m.addedNodes.length > 0);
    if (!hasNewContent) return;

    // Debounce: wait for DOM to settle before scraping
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      expandVisibleFacebookText();
      performScrape();
    }, 1500);
  });

  // Observe the main content area, not the entire body (reduces overhead)
  const feedContainer = document.querySelector('[role="main"]') ||
                        document.querySelector('[role="feed"]') ||
                        document.body;

  observer.observe(feedContainer, {
    childList: true,
    subtree: true
  });
}

function installNetworkTextCapture() {
  if (networkTextListenerInstalled || typeof window.addEventListener !== 'function') return;
  window.addEventListener('message', handleNetworkTextMessage);
  networkTextListenerInstalled = true;
}

function handleNetworkTextMessage(event) {
  if (!isScanning || !event || event.source !== window) return;
  const data = event.data || {};
  if (data.source !== NETWORK_TEXT_MESSAGE_SOURCE) return;

  const text = String(data.text || '');
  if (text.trim().length < 10) return;

  const key = `${data.url || ''}:${text.replace(/\s+/g, ' ').slice(0, 1200)}`;
  if (observedNetworkTextKeys.has(key)) return;
  observedNetworkTextKeys.add(key);

  const sourceName = extractPageTitle();
  const newLeads = [];
  const beforeCount = scrapedNumbers.size;

  scanMetrics.networkTextCount += 1;
  extractPhonesFromText(text, null, sourceName, newLeads, false);

  const newPhoneCount = scrapedNumbers.size - beforeCount;
  if (newPhoneCount > 0) {
    scanMetrics.networkPhoneCount += newPhoneCount;
  }

  if (newLeads.length > 0) {
    chrome.runtime.sendMessage({
      action: "NEW_FB_LEADS",
      leads: newLeads
    });
  }

  publishScanProgress("SCANNING", {
    count: scrapedNumbers.size,
    newCount: newLeads.length,
    message: newLeads.length > 0
      ? `Đã đọc thêm ${newLeads.length} SĐT từ dữ liệu comment Facebook vừa tải.`
      : 'Đã đọc dữ liệu comment Facebook vừa tải nhưng không có SĐT mới.',
  });
}

// Human-like scroll behavior with random variations
function runHumanLikeScroll(scrollCount) {
  if (!isScanning || pausedScrolling) return;

  // Sometimes pause scrolling (like a human reading a post) - 20% chance
  if (Math.random() < 0.2 && scrollCount > 2) {
    const readingPause = Math.floor(Math.random() * 5000) + 3000; // 3-8 second pause
    console.log(`Pausing to "read" for ${Math.round(readingPause/1000)}s...`);
    scrollTimeout = setTimeout(() => runHumanLikeScroll(scrollCount), readingPause);
    return;
  }

  // Scroll down a random human-like distance (between 300px and 800px)
  const scrollDistance = Math.floor(Math.random() * 500) + 300;
  window.scrollBy({
    top: scrollDistance,
    behavior: 'smooth'
  });
  expandVisibleFacebookText();

  console.log(`Scroll action #${scrollCount + 1}, distance: ${scrollDistance}px`);

  // Random delay between scrolls (3 to 8 seconds) - much more human-like
  const nextDelayMs = Math.floor(Math.random() * 5000) + 3000;

  scrollTimeout = setTimeout(() => {
    if ((!isContinuousScan && scrollCount >= maxScrollCount) || !isScanning) {
      // Auto-stop after configured scroll count
      console.log(`Auto-stop: max scroll count (${maxScrollCount}) reached`);
      stopScanning();
    } else {
      runHumanLikeScroll(scrollCount + 1);
    }
  }, nextDelayMs);
}

// ===== MAIN SCRAPING LOGIC =====
function performScrape() {
  if (!isScanning) return;
  if (!phoneEngine) {
    lastScanReason = "Thiếu engine bắt SĐT Facebook.";
    publishScanProgress("FAILED", { error: lastScanReason });
    return;
  }

  const sourceName = extractPageTitle();
  let newLeads = [];

  // Strategy 1: Scan Facebook post bodies and comments
  // Facebook renders user content in elements with dir="auto" attribute
  // Also look in article containers and comment sections
  const contentSelectors = [
    'div[dir="auto"]',           // Main post content and new FB text blocks
    'span[dir="auto"]',          // Inline content & comments
    'div[role="article"]',       // Full article containers
    '[role="dialog"] div[dir="auto"]',
    '[role="dialog"] span[dir="auto"]',
    'div[class*="comment"]',     // Comment sections
    'span[class*="comment"]',    // Comment text
    'div[data-ad-preview="message"]', // Expanded post text
    'img[alt]',                 // Facebook OCR text for images can live in alt
    '[aria-label*="Có thể là hình ảnh"]',
    '[aria-label*="May be an image"]',
    // Additional broad selectors for FB's dynamic classes
    'div.x11i5rnm.xat24cr',      // Common post body wrapper
    'div.x1lliihq',              // Common comment wrapper
    'div.x1iorvi4',              // Another common text wrapper
    '[class*="x11i5rnm"]'        // Broad match for FB text utility classes
  ];

  const processedTexts = new Set(); // Avoid counting the same visible text in one pass

  for (const selector of contentSelectors) {
    const elements = document.querySelectorAll(selector);

    for (const element of elements) {
      const text = getFacebookElementText(element);

      // Skip very short texts (unlikely to contain phone numbers)
      if (text.length < 10) continue;

      // We no longer strictly skip processed text because React reuses DOM nodes,
      // and checking substrings can sometimes incorrectly skip valid new text

      // Skip UI elements (navigation, menus, etc.)
      if (isUIElement(element)) continue;

      const textKey = text.replace(/\s+/g, ' ').trim().slice(0, 240);
      if (processedTexts.has(textKey)) continue;
      processedTexts.add(textKey);
      if (!observedTextKeys.has(textKey)) {
        observedTextKeys.add(textKey);
        scanMetrics.textNodeCount += 1;
        if (isPostLikeElement(element)) {
          scanMetrics.postCount += 1;
        } else if (isCommentLikeElement(element, text)) {
          scanMetrics.commentCount += 1;
        }
      }

      // Extract phone numbers
      extractPhonesFromText(text, element, sourceName, newLeads, true);
    }
  }

  // Strategy 2: Body text is a safety net for Facebook modal/body chunks.
  // Run it even if targeted nodes found some phones because one comment block
  // can contain many phones while React exposes only a partial text node.
  const bodyText = document.body.innerText || "";
  if (bodyText.trim().length >= 10) {
    extractPhonesFromText(bodyText, null, sourceName, newLeads, false);
  }

  if (scrapedNumbers.size === 0 && scanMetrics.rawCandidateCount === 0) {
    lastScanReason = "Không thấy chuỗi giống SĐT trong post/comment đã tải.";
  } else if (scrapedNumbers.size === 0 && scanMetrics.rawCandidateCount > 0) {
    lastScanReason = "Có chuỗi số nhưng không phải SĐT di động Việt Nam hợp lệ.";
  } else {
    lastScanReason = '';
  }

  // Push new leads to background to relay to the dashboard
  if (newLeads.length > 0) {
    console.log(`Scraped ${newLeads.length} new leads:`, newLeads.map(l => l.phone));
    chrome.runtime.sendMessage({
      action: "NEW_FB_LEADS",
      leads: newLeads
    });
  }

  publishScanProgress("SCANNING", {
    count: scrapedNumbers.size,
    newCount: newLeads.length,
  });
  recoverFromOpenDialog();
}

function getFacebookElementText(element) {
  if (!element) return '';
  const parts = [
    element.textContent || '',
    element.innerText || '',
  ];

  if (typeof element.getAttribute === 'function') {
    parts.push(element.getAttribute('alt') || '');
    parts.push(element.getAttribute('aria-label') || '');
    parts.push(element.getAttribute('title') || '');
  }

  return [...new Set(parts.map(part => String(part || '').trim()).filter(Boolean))].join('\n');
}

function extractPhonesFromText(text, element, sourceName, newLeads, hasContext) {
  const analysis = phoneEngine.analyzeTextForPhones(text);
  const allMatches = analysis.valid;
  scanMetrics.rawCandidateCount += analysis.rawMatches.length;
  scanMetrics.rejectedCount += analysis.rejected.length;

  if (allMatches.length === 0) return;

  // Removed strict exclusion patterns here because they were too aggressive
  // and often blocked valid phone numbers that happened to be near dates.

  // Find author name from the closest post container
  let authorName = "Đối tác FB";
  if (element) {
    authorName = findAuthorName(element) || "Đối tác FB";
  }

  for (const match of allMatches) {
    const cleanPhone = match.phone;
    if (cleanPhone && !scrapedNumbers.has(cleanPhone)) {
      scrapedNumbers.add(cleanPhone);
      scanMetrics.validPhoneCount = scrapedNumbers.size;

      // Generate a context snippet around the phone number
      const index = match.index >= 0 ? match.index : text.indexOf(match.raw);
      const snippet = text.substring(
        Math.max(0, index - 50),
        Math.min(text.length, index + match.raw.length + 50) // Reduced length to fit better
      ).replace(/\s+/g, ' ').trim();

      newLeads.push({
        phone: cleanPhone,
        name: authorName,
        source: sourceName,
        note: `FB: ${snippet.substring(0, 120)}...`
      });
    }
  }
}

function findAuthorName(element) {
  // Navigate up to find the post/article container
  const article = element.closest('div[role="article"]') ||
                  element.closest('div[role="feed"] > div') ||
                  element.closest('[class*="userContent"]');

  if (!article) return null;

  // Look for author name in common Facebook patterns
  const authorSelectors = [
    'strong a',                       // Classic FB post header
    'h3 a',                           // Group post header
    'a[role="link"] strong',          // New FB design
    'span[class*="author"] a',        // Author section
    'a[class*="profileLink"]',        // Profile link
    'h2 a',                           // Another header pattern
    // First <a> with a <strong> inside the first header-like element
    ':scope > div:first-child a strong',
  ];

  for (const selector of authorSelectors) {
    const authorEl = article.querySelector(selector);
    if (authorEl && authorEl.innerText) {
      const name = authorEl.innerText.split('\n')[0].trim();
      // Validate: name should be reasonable (2-50 chars, no URLs)
      if (name.length >= 2 && name.length <= 50 && !name.includes('http')) {
        return name;
      }
    }
  }

  return null;
}

// Check if an element is part of the UI (navigation, menus) rather than user content
function isUIElement(element) {
  const parent = element.closest('[role="navigation"], [role="banner"], [role="menu"], header, nav');
  return !!parent;
}

function isPostLikeElement(element) {
  return !!(element && typeof element.closest === 'function' && element.closest('div[role="article"]'));
}

function isCommentLikeElement(element, text = '') {
  if (!element) return false;
  if (isPostLikeElement(element)) return false;
  const lowered = String(text || element.textContent || '').toLowerCase();
  if (lowered.includes('bình luận') || lowered.includes('comment') || lowered.includes('reply') || lowered.includes('phản hồi')) {
    return true;
  }
  if (element.role === 'dialog') return true;
  if (typeof element.closest !== 'function') return false;
  return !!element.closest('[aria-label*="Comment"], [aria-label*="Bình luận"], [role="dialog"], div[class*="comment"], span[class*="comment"]');
}

function isElementVisible(element) {
  if (!element) return false;
  const rects = typeof element.getClientRects === 'function' ? element.getClientRects() : [];
  const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element) : null;
  return rects.length > 0 && (!style || (style.display !== 'none' && style.visibility !== 'hidden'));
}

function recoverFromOpenDialog() {
  if (!isScanning) return;
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog || !isElementVisible(dialog)) return;

  pausedScrolling = true;
  const closedByButton = closeFacebookDialog(dialog);
  const delayMs = closedByButton ? 800 : 10000;

  setTimeout(() => {
    if (!closedByButton && isElementVisible(dialog)) {
      dispatchEscapeKey();
    }
    pausedScrolling = false;
    publishScanProgress("RECOVERING_DIALOG", {
      message: "Đang khôi phục sau khi mở bình luận Facebook.",
    });
  }, delayMs);
}

function closeFacebookDialog(dialog) {
  const dialogCloseSelectors = [
    '[aria-label="Đóng"]',
    '[aria-label*="Đóng"]',
    '[aria-label="Close"]',
    '[aria-label*="Close"]',
    '[aria-label="Dong"]',
    '[aria-label*="Dong"]',
    '[role="button"][aria-label]',
  ];
  const documentCloseSelectors = dialogCloseSelectors.filter((selector) => selector !== '[role="button"][aria-label]');

  const closeButton =
    findCloseButtonInRoot(dialog, dialogCloseSelectors, dialog) ||
    findCloseButtonInRoot(document, documentCloseSelectors, dialog);

  if (!closeButton) return false;

  try {
    closeButton.click();
    return true;
  } catch (error) {
    console.warn('Không thể đóng hộp bình luận Facebook bằng nút đóng:', error);
  }

  return false;
}

function findCloseButtonInRoot(root, selectors, dialog) {
  if (!root) return null;

  for (const selector of selectors) {
    const candidates = getSelectorCandidates(root, selector);
    for (const candidate of candidates) {
      if (!candidate || !isElementVisible(candidate)) continue;
      if (root === document && !isLikelyDialogCloseButton(candidate, dialog)) continue;
      return candidate;
    }
  }

  return null;
}

function getSelectorCandidates(root, selector) {
  if (typeof root.querySelectorAll === 'function') {
    return Array.from(root.querySelectorAll(selector));
  }
  if (typeof root.querySelector === 'function') {
    const candidate = root.querySelector(selector);
    return candidate ? [candidate] : [];
  }
  return [];
}

function isLikelyDialogCloseButton(button, dialog) {
  const label = String(
    (typeof button.getAttribute === 'function' && button.getAttribute('aria-label')) ||
    button.ariaLabel ||
    button.textContent ||
    ''
  ).toLowerCase();

  if (!label.includes('close') && !label.includes('dong') && !label.includes('đóng')) {
    return false;
  }

  if (typeof dialog.contains === 'function' && dialog.contains(button)) return true;
  if (typeof dialog.getBoundingClientRect !== 'function' || typeof button.getBoundingClientRect !== 'function') {
    return true;
  }

  const dialogRect = dialog.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  if (!dialogRect || !buttonRect) return true;

  return (
    buttonRect.left >= dialogRect.left - 40 &&
    buttonRect.right <= dialogRect.right + 40 &&
    buttonRect.top >= dialogRect.top - 40 &&
    buttonRect.bottom <= dialogRect.bottom + 120
  );
}

function dispatchEscapeKey() {
  for (const type of ['keydown', 'keyup']) {
    const event = new KeyboardEvent(type, {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
    });
    document.dispatchEvent(event);
    if (document.body && typeof document.body.dispatchEvent === 'function') {
      document.body.dispatchEvent(event);
    }
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(event);
    }
  }
}

function expandVisibleFacebookText() {
  const controls = document.querySelectorAll('[role="button"], a[role="link"], span[dir="auto"]');
  let clicked = 0;

  for (const control of controls) {
    if (clicked >= 5) break;
    if (expandedElements.has(control)) continue;
    const text = String(control.innerText || control.textContent || '').trim().toLowerCase();
    if (!text) continue;
    if (!isFacebookExpansionControlText(text)) continue;
    if (!isElementVisible(control)) continue;

    try {
      expandedElements.add(control);
      control.click();
      clicked += 1;
    } catch (error) {
      console.warn('Không thể bấm nút mở rộng bình luận Facebook:', error);
    }
  }

  if (clicked > 0) {
    scanMetrics.expandedClickCount += clicked;
    publishScanProgress("EXPANDING_COMMENTS", {
      message: `Đã bấm ${clicked} nút mở rộng bài viết/bình luận.`,
    });
  }
}

function isFacebookExpansionControlText(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;

  const directLabels = [
    'xem thêm',
    'xem thêm bình luận',
    'xem thêm phản hồi',
    'xem phản hồi',
    'xem các bình luận trước',
    'tất cả bình luận',
    'see more',
    'view more comments',
    'view replies',
    'view previous comments',
    'all comments',
  ];
  if (directLabels.some((label) => value.includes(label))) return true;

  return /\b\d+[\s.,]*(bình luận|comments?|comment|phản hồi|replies|reply)\b/i.test(value);
}

// Check if text contains travel/business-related keywords (increases confidence)
function isRelevantContext(text) {
  const lowerText = text.toLowerCase();
  const travelKeywords = [
    'tour', 'du lịch', 'travel', 'đại lý', 'khách sạn', 'hotel', 'booking',
    'phú quốc', 'đà nẵng', 'nha trang', 'sapa', 'hạ long', 'đà lạt', 'huế',
    'vé máy bay', 'land tour', 'combo', 'resort', 'visa', 'passport',
    'liên hệ', 'hotline', 'zalo', 'sdt', 'số điện thoại', 'điện thoại',
    'whatsapp', 'tel', 'phone', 'call', 'gọi ngay', 'inbox',
    'giá tốt', 'giá rẻ', 'khuyến mãi', 'ưu đãi', 'giảm giá',
    'đối tác', 'hợp tác', 'cộng tác', 'tuyển',
    'nhóm', 'group', 'land', 'outbound', 'inbound'
  ];
  return travelKeywords.some(keyword => lowerText.includes(keyword));
}

function extractPageTitle() {
  // Extract a clean source name from the page title
  let title = document.title || "Facebook";
  // Remove common Facebook suffixes
  title = title.replace(/\s*[\|·\-]\s*Facebook$/gi, '').trim();
  title = title.replace(/^\(\d+\)\s*/, '').trim(); // Remove notification count
  return title || "Facebook Group";
}

function cleanAndNormalizePhone(match) {
  // Remove spaces, dots, hyphens, keep numbers and plus
  const clean = match.replace(/[^0-9+]/g, '');
  let normalized = clean;

  if (clean.startsWith('+84')) {
    normalized = '0' + clean.slice(3);
  } else if (clean.startsWith('84') && clean.length > 9) {
    normalized = '0' + clean.slice(2);
  }

  // Ensure it's a valid 10 digit Vietnamese phone number
  if (normalized.length === 10 && normalized.startsWith('0')) {
    // Double-check against valid prefix list
    const prefix = normalized.substring(0, 3);
    if (VN_MOBILE_PREFIXES.includes(prefix)) {
      return normalized;
    }
  }
  return null;
}
