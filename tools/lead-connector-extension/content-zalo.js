// Zalo Web Content Script Automation
console.log("TravelLead Zalo Web Automator Injected.");

// Signal to background that content script is ready
try {
  chrome.runtime.sendMessage({ action: "ZALO_CONTENT_READY" });
} catch (e) {
  // Background might not be listening for this yet, that's ok
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Zalo Content Script received action:", message);

  // Ping handler - lets background check if content script is alive
  if (message.action === "PING") {
    sendResponse({ success: true, ready: true });
    return true;
  }

  if (message.action === "AUTOMATE_SEND") {
    const lead = message.lead;
    if (lead && lead.phone) {
      automateZaloSend(lead);
    }
    sendResponse({ success: true, message: "Processing started" });
  }
  return true;
});

// Helper wait function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper: wait for an element to appear in DOM (with timeout)
function waitForElement(selectorFn, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const el = selectorFn();
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error("Timeout waiting for element"));
      }
    }, 300);
  });
}

// Helper: simulate human-like keyboard typing via KeyboardEvent dispatch
async function simulateTyping(element, text) {
  element.focus();
  for (let char of text) {
    // Use native input events that React/Zalo framework can capture
    const keyDownEvent = new KeyboardEvent('keydown', {
      key: char, code: `Key${char.toUpperCase()}`, keyCode: char.charCodeAt(0),
      which: char.charCodeAt(0), bubbles: true, cancelable: true
    });
    element.dispatchEvent(keyDownEvent);

    // Update value directly + dispatch input event
    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));

    const keyUpEvent = new KeyboardEvent('keyup', {
      key: char, code: `Key${char.toUpperCase()}`, keyCode: char.charCodeAt(0),
      which: char.charCodeAt(0), bubbles: true, cancelable: true
    });
    element.dispatchEvent(keyUpEvent);

    // Random delay between keystrokes to simulate human typing (made faster)
    await delay(5 + Math.random() * 15);
  }
}

function normalizePhoneForZalo(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) {
    return '0' + digits.slice(2);
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }
  return '';
}

function phoneTextMatches(text, targetPhone) {
  const normalizedTarget = normalizePhoneForZalo(targetPhone);
  if (!normalizedTarget) return false;

  const digits = String(text || '').replace(/\D/g, '');
  const countryCodeTarget = '84' + normalizedTarget.slice(1);
  return digits.includes(normalizedTarget) || digits.includes(countryCodeTarget);
}

function isVisibleElement(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function resolveClickableResult(element, searchInput) {
  const clickable = element.closest('[data-id], [class*="item"], [class*="Item"], [role="option"], [role="button"], div[tabindex]') || element;
  if (!clickable || clickable.contains(searchInput) || searchInput.contains(clickable)) {
    return null;
  }
  return isVisibleElement(clickable) ? clickable : null;
}

function findMatchingSearchResult(targetPhone, searchInput) {
  const searchResultSelectors = [
    '[data-id="div_SearchResult_Item"]',
    '[data-id="search_global_item"]',
    '.GlobalSearchItem',
    '.search-list__item',
    '.search-item',
    '.friend-item',
    '.conv-item',
    '.contact-item-inner',
    '[class*="search-result"]',
    '[class*="search_result"]',
    '[class*="SearchResult"]',
    '[class*="contact-list"] [class*="item"]',
    '[role="option"]',
    '[role="listitem"]',
    '[class*="result"] [class*="item"]',
    '[class*="list"] [class*="item"]:not([class*="nav"])'
  ];

  for (const selector of searchResultSelectors) {
    const candidates = document.querySelectorAll(selector);
    for (const candidate of candidates) {
      if (!phoneTextMatches(candidate.textContent, targetPhone)) continue;
      const clickable = resolveClickableResult(candidate, searchInput);
      if (clickable) return clickable;
    }
  }

  const fallbackScopes = document.querySelectorAll(
    '[role="listbox"], [class*="search"], [class*="Search"], [class*="result"], ' +
    '[class*="Result"], [class*="contact-list"], [data-id*="Search"], [data-id*="search"]'
  );

  for (const scope of fallbackScopes) {
    const textNodes = scope.querySelectorAll('div, span, p, [role="option"], [role="listitem"]');
    for (const element of textNodes) {
      if (!phoneTextMatches(element.textContent, targetPhone)) continue;
      const clickable = resolveClickableResult(element, searchInput);
      if (clickable) return clickable;
    }
  }

  return null;
}

function normalizeMessageText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMessageInputPlainText(element) {
  return element ? (element.innerText || element.textContent || '') : '';
}

function messageLooksInserted(actualText, expectedText) {
  const actual = normalizeMessageText(actualText);
  const expected = normalizeMessageText(expectedText);
  return !!expected && (actual === expected || actual.startsWith(expected));
}

function waitForMessageInputCleared(element, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const currentText = getMessageInputPlainText(element);
      if (normalizeMessageText(currentText).length === 0) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 250);
  });
}

async function automateZaloSend(lead) {
  console.log(`Starting automate Zalo send to: ${lead.phone} with message size ${lead.message?.length || 0}`);

  try {
    const targetPhone = normalizePhoneForZalo(lead.phone);
    const messageText = String(lead.message || '');
    if (!targetPhone) {
      throw new Error("Số điện thoại không hợp lệ, không gửi tự động.");
    }
    if (!messageText.trim()) {
      throw new Error("Nội dung tin nhắn trống, không gửi tự động.");
    }

    // ===== STEP 0: HANDLE ACTIVATION DIALOG =====
    // Zalo only allows 1 active tab. If this tab was inactive, it shows:
    // "Bạn đang mở Zalo trên một Tab khác hoặc không sử dụng Zalo quá lâu"
    // with a "Kích hoạt" button. We need to auto-click it.
    await handleActivationDialog();

    // ===== STEP 1: SEARCH FOR PHONE NUMBER =====
    // Zalo Web uses various search input selectors; try multiple approaches
    let searchInput = findSearchInput();

    if (!searchInput) {
      // Try clicking the search area first to reveal the input
      const searchArea = document.querySelector('[class*="search"]') ||
                         document.querySelector('[data-id="search"]');
      if (searchArea) {
        searchArea.click();
        await delay(500);
        searchInput = findSearchInput();
      }
    }

    if (!searchInput) {
      throw new Error("Không tìm thấy ô Tìm kiếm trên Zalo Web. Hãy chắc chắn bạn đã đăng nhập.");
    }

    // Clear and focus search input
    searchInput.focus();
    searchInput.click();
    await delay(300);

    // Clear existing search text
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(400);

    // Type phone number character by character (human-like)
    await simulateTyping(searchInput, targetPhone);

    // Trigger search
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for search results to appear (reduced)
    await delay(1200);

    // ===== STEP 2: CLICK ON MATCHING SEARCH RESULT =====
    let resultItem = findMatchingSearchResult(targetPhone, searchInput);
    if (!resultItem) {
      await delay(1500);
      resultItem = findMatchingSearchResult(targetPhone, searchInput);
    }

    if (!resultItem) {
      throw new Error(`Không tìm thấy kết quả Zalo khớp số ${targetPhone}. Đã dừng để tránh gửi nhầm.`);
    }

    resultItem.click();
    console.log(`Clicked verified Zalo search result for ${targetPhone}`);

    // Wait for chat window to fully load (reduced)
    await delay(1500);

    // ===== STEP 3: INPUT MESSAGE =====
    // Find the rich text input (message input area)
    let richInput = findMessageInput();

    if (!richInput) {
      // Chat may not have loaded - retry after extra wait
      await delay(2000);
      richInput = findMessageInput();
    }

    if (!richInput) {
      throw new Error("Không thể tìm thấy khung nhập tin nhắn! Có thể số điện thoại không tồn tại trên Zalo.");
    }

    // Close any open panels (sticker picker, emoji, file upload, etc.)
    closeAllOverlayPanels();
    await delay(300);

    // Focus message input
    richInput.focus();
    richInput.click();
    await delay(300);

    // Clear existing content cleanly
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await delay(200);

    // Method 1: The native paste approach (handles newlines perfectly in most rich editors)
    // This makes the text appear exactly as it does when a user copies & pastes
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', messageText);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    richInput.dispatchEvent(pasteEvent);

    await delay(300);

    // Fallback if the paste event was ignored by the browser/Zalo
    if ((richInput.textContent || '').trim().length === 0) {
      console.log("Paste event fallback to insertText...");
      document.execCommand('insertText', false, messageText);
    }

    // VERY IMPORTANT: Force Zalo's React state to update so the Send button appears
    richInput.dispatchEvent(new Event('input', { bubbles: true }));
    richInput.dispatchEvent(new Event('change', { bubbles: true }));

    const spaceDown = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
    richInput.dispatchEvent(spaceDown);
    document.execCommand('insertText', false, ' ');
    richInput.dispatchEvent(new Event('input', { bubbles: true }));
    const spaceUp = new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
    richInput.dispatchEvent(spaceUp);

    // Wait for Zalo's internal state to update and send button to become active
    await delay(800);

    // Verify message was actually inserted
    let currentContent = getMessageInputPlainText(richInput);
    if (!messageLooksInserted(currentContent, messageText)) {
      console.warn("Message input does not match expected content, retrying with insertText...");
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, messageText);
      richInput.dispatchEvent(new Event('input', { bubbles: true }));
      await delay(500);
      currentContent = getMessageInputPlainText(richInput);
    }

    if (!messageLooksInserted(currentContent, messageText)) {
      throw new Error("Nội dung trong ô chat không khớp nội dung cần gửi.");
    }

    // ===== STEP 4: SEND MESSAGE =====
    // IMPORTANT: Must avoid clicking sticker/emoji/file buttons!
    // Only click the actual SEND button for text messages

    let sent = false;

    // Strategy A: Find the exact send button using precise selectors
    // Avoid ANY selector that could match sticker/emoji/file buttons
    const sendButton = findSendButton();

    if (sendButton) {
      sendButton.click();
      console.log("Clicked send button successfully");
      sent = true;
    }

    // Strategy B: If no button found, use Enter key (most reliable for Zalo)
    if (!sent) {
      console.log("Send button not found, using Enter key to send");
      // Make sure richInput is focused
      richInput.focus();
      await delay(200);

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      });
      richInput.dispatchEvent(enterEvent);
      sent = true;
    }

    const sendConfirmed = await waitForMessageInputCleared(richInput);
    if (!sendConfirmed) {
      throw new Error("Không xác nhận được tin nhắn đã gửi: ô nhập vẫn còn nội dung.");
    }

    // Report success to background
    chrome.runtime.sendMessage({
      action: "LEAD_SENT_SUCCESS",
      phone: targetPhone
    });
    console.log(`Successfully sent message to ${targetPhone}`);

  } catch (error) {
    console.error("Automation error:", error.message);
    chrome.runtime.sendMessage({
      action: "LEAD_SENT_FAILED",
      phone: lead.phone,
      error: error.message
    });
  }
}

// ===== HELPER FUNCTIONS =====

function findSearchInput() {
  // Try multiple selectors for Zalo's search input
  const selectors = [
    '#contact-search-input',
    'input[placeholder*="Tìm kiếm"]',
    'input[placeholder*="tìm kiếm"]',
    'input[placeholder*="Search"]',
    'input[type="text"][class*="search"]',
    'input[class*="search-input"]',
    'input[class*="Search"]',
    '[class*="search-box"] input',
    '[class*="search-bar"] input',
    '[data-translate-inner="STR_SEARCH"]',
    // Generic fallback: first visible text input at the top of the page
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  // Last resort: find any visible input at the top of the page
  const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
  for (const input of allInputs) {
    const rect = input.getBoundingClientRect();
    // Search input is typically at the top and visible
    if (rect.top < 200 && rect.width > 100 && rect.height > 0) {
      return input;
    }
  }

  return null;
}

function findMessageInput() {
  const selectors = [
    '#rich-input',
    '[contenteditable="true"][class*="input"]',
    '[contenteditable="true"][class*="chat"]',
    '[contenteditable="true"][class*="editor"]',
    '.input-chat',
    '[class*="chat-input"] [contenteditable="true"]',
    '[class*="chatInput"] [contenteditable="true"]',
    '[data-testid="message-input"]',
    // Generic but targeted: contenteditable near bottom of chat area
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  // Fallback: find contenteditable elements and pick the one that looks like a message input
  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of editables) {
    const rect = el.getBoundingClientRect();
    // Message input is typically at the bottom of the page and reasonably wide
    if (rect.bottom > window.innerHeight * 0.5 && rect.width > 200) {
      return el;
    }
  }

  return null;
}

function findSendButton() {
  // CRITICAL: Must ONLY match the text send button, NOT sticker/emoji/file buttons
  // Zalo's send button typically:
  // - Has exact title="Gửi" (NOT title="Gửi nhãn dán" or title="Gửi file")
  // - Has aria-label="Send" or aria-label="Gửi"
  // - Is a button/div near the message input area
  // - Often has a paper plane or arrow icon

  // 1. Try data-testid or data-id first (most stable)
  let btn = document.querySelector('[data-testid="chat-input-send-btn"], [data-id="btn_send"]');
  if (btn) return btn;

  // 2. Try class-based selectors for the actual send button
  btn = document.querySelector('.icon-send, .btn-send:not([class*="sticker"]):not([class*="emoji"]):not([class*="file"])');
  if (btn) return btn;

  btn = document.querySelector('.chat-input__send-btn');
  if (btn) return btn;

  btn = document.querySelector('[class*="send-btn"]:not([class*="sticker"]):not([class*="emoji"])');
  if (btn) return btn;

  // 3. Try exact title/aria-label match (EXACT match only, not partial!)
  // This prevents matching "Gửi nhãn dán", "Gửi file", "Gửi ảnh", etc.
  const allButtons = document.querySelectorAll('button, [role="button"], div[class*="btn"]');
  for (const b of allButtons) {
    const title = (b.getAttribute('title') || '').trim();
    const ariaLabel = (b.getAttribute('aria-label') || '').trim();

    // EXACT match only: title must be exactly "Gửi" or "Send"
    if (title === 'Gửi' || title === 'Send' || ariaLabel === 'Gửi' || ariaLabel === 'Send') {
      // Additional check: make sure this is near the message input area (bottom of page)
      const rect = b.getBoundingClientRect();
      if (rect.bottom > window.innerHeight * 0.4) {
        return b;
      }
    }
  }

  // 4. Try finding by SVG icon: send buttons usually have a paper-plane/arrow SVG
  const svgButtons = document.querySelectorAll('button svg, [role="button"] svg, [class*="btn"] svg');
  for (const svg of svgButtons) {
    const parent = svg.closest('button, [role="button"], [class*="btn"]');
    if (!parent) continue;

    const parentClasses = (parent.className || '').toLowerCase();
    const parentTitle = (parent.getAttribute('title') || '').toLowerCase();

    // Skip sticker, emoji, file, image, video buttons
    if (parentClasses.includes('sticker') || parentClasses.includes('emoji') ||
        parentClasses.includes('file') || parentClasses.includes('image') ||
        parentClasses.includes('video') || parentClasses.includes('gif') ||
        parentClasses.includes('attach') || parentClasses.includes('photo') ||
        parentTitle.includes('nhãn dán') || parentTitle.includes('sticker') ||
        parentTitle.includes('file') || parentTitle.includes('ảnh') ||
        parentTitle.includes('biểu tượng') || parentTitle.includes('emoji')) {
      continue;
    }

    // Check if this SVG's parent is near the input area
    const rect = parent.getBoundingClientRect();
    if (rect.bottom > window.innerHeight * 0.5 && rect.width < 80) {
      return parent;
    }
  }

  return null;
}

function closeAllOverlayPanels() {
  // Close sticker picker
  const stickerCloseSelectors = [
    '.sticker-picker__close',
    '.sticker-close-btn',
    '[class*="sticker"] [class*="close"]',
    '[class*="sticker-picker"] [class*="close"]'
  ];
  stickerCloseSelectors.forEach(sel => {
    const btn = document.querySelector(sel);
    if (btn) btn.click();
  });

  // Close emoji picker
  const emojiCloseSelectors = [
    '.emoji-picker__close',
    '[class*="emoji"] [class*="close"]',
    '[class*="emoji-picker"] [class*="close"]'
  ];
  emojiCloseSelectors.forEach(sel => {
    const btn = document.querySelector(sel);
    if (btn) btn.click();
  });

  // Close any popup/overlay
  const overlayClose = document.querySelector('.popup-close, [class*="overlay"] [class*="close"]');
  if (overlayClose) overlayClose.click();

  // Press Escape to close any open modal/panel
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
    bubbles: true, cancelable: true
  }));
}

// ===== ACTIVATION DIALOG HANDLER =====
// Zalo Web shows a dialog when the tab was inactive or another tab is active:
// "Bạn đang mở Zalo trên một Tab khác hoặc không sử dụng Zalo quá lâu"
// Button text: "Kích hoạt"
async function handleActivationDialog() {
  // Strategy 1: Find by button text "Kích hoạt"
  let activateBtn = findActivateButton();

  if (activateBtn) {
    console.log("Found Zalo activation dialog! Clicking 'Kích hoạt'...");
    activateBtn.click();

    // Wait for Zalo to re-initialize after activation
    // The page may reload or reinitialize its WebSocket connection
    await delay(5000);

    // Check if another activation dialog appeared (sometimes it requires retry)
    activateBtn = findActivateButton();
    if (activateBtn) {
      console.log("Activation dialog appeared again, clicking once more...");
      activateBtn.click();
      await delay(5000);
    }

    console.log("Activation completed, proceeding...");
  } else {
    console.log("No activation dialog detected, Zalo is ready.");
  }
}

function findActivateButton() {
  // Method 1: Search all buttons/links for exact text "Kích hoạt"
  const allButtons = document.querySelectorAll('button, a, [role="button"], div[class*="btn"]');
  for (const btn of allButtons) {
    const text = (btn.textContent || btn.innerText || '').trim();
    if (text === 'Kích hoạt' || text === 'Kích Hoạt' || text === 'KÍCH HOẠT') {
      return btn;
    }
  }

  // Method 2: Check for the dialog by its message content
  const bodyText = document.body?.innerText || '';
  if (bodyText.includes('đang mở Zalo trên một Tab khác') ||
      bodyText.includes('không sử dụng Zalo quá lâu') ||
      bodyText.includes('Nhấn kích hoạt')) {
    // Dialog exists but button not found by text — try finding by structure
    // The button is typically a blue/primary styled button inside a modal/dialog
    const dialogBtns = document.querySelectorAll(
      '[class*="modal"] button, [class*="dialog"] button, [class*="popup"] button, ' +
      '[class*="Modal"] button, [class*="Dialog"] button, [class*="Popup"] button, ' +
      '[class*="overlay"] button'
    );
    for (const btn of dialogBtns) {
      const style = window.getComputedStyle(btn);
      // Look for the primary/blue styled button
      if (style.backgroundColor.includes('rgb(0') || // Blue-ish
          btn.className.includes('primary') ||
          btn.className.includes('btn-primary') ||
          btn.className.includes('active')) {
        return btn;
      }
    }

    // Last resort: find ANY clickable button inside what looks like a modal
    if (dialogBtns.length > 0) {
      return dialogBtns[dialogBtns.length - 1]; // Usually the action button is last
    }
  }

  return null;
}

// ===== AUTO-ACTIVATION ON PAGE LOAD =====
// Also monitor for the activation dialog appearing at any time
// (e.g., when the tab regains focus after being idle)
function setupActivationWatcher() {
  const observer = new MutationObserver((mutations) => {
    // Check if activation dialog just appeared
    const btn = findActivateButton();
    if (btn) {
      console.log("Activation dialog detected by watcher! Auto-clicking...");
      btn.click();
    }
  });

  // Start observing, but only if we're on the right page
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Also check immediately on script load
  setTimeout(() => {
    const btn = findActivateButton();
    if (btn) {
      console.log("Activation dialog found on page load! Auto-clicking...");
      btn.click();
    }
  }, 2000);
}

// Start the watcher when the page loads
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setupActivationWatcher();
} else {
  window.addEventListener('DOMContentLoaded', setupActivationWatcher);
}
