// ===================================================================
// TravelLead Connect - Background Service Worker (Manifest V3)
// Uses chrome.storage.local to persist state across service worker restarts
// Uses chrome.alarms to keep the worker alive during active operations
// ===================================================================

// ===== STATE MANAGEMENT =====
// Manifest V3 service workers can be killed at any time.
// ALL state must be persisted to chrome.storage.local.

const DEFAULT_STATE = {
  queue: [],
  currentIndex: -1,
  isSending: false,
  awaitingLeadResult: false,
  nextRunAt: 0,
  leadDeadlineAt: 0,
  zaloTabId: null,
  delayMs: 10000,
  activeTab: true,
  // FB URL Queue
  fbUrlQueue: [],
  fbUrlQueueIndex: -1,
  fbUrlQueueRunning: false,
  fbUrlQueueSettings: { autoScroll: true, scrollCount: 20, pageDelay: 45, continuousScan: false },
  fbTabId: null,
  fbTotalLeads: 0
};

async function getState() {
  const result = await chrome.storage.local.get('leadConnectorState');
  return { ...DEFAULT_STATE, ...(result.leadConnectorState || {}) };
}

async function setState(updates) {
  const current = await getState();
  const newState = { ...current, ...updates };
  await chrome.storage.local.set({ leadConnectorState: newState });
  return newState;
}

// ===== KEEP-ALIVE ALARM =====
// Fires every 25 seconds to prevent the service worker from going idle
const KEEPALIVE_ALARM = 'keepalive';

function emptyFbMetrics() {
  return {
    postCount: 0,
    commentCount: 0,
    textNodeCount: 0,
    rawCandidateCount: 0,
    validPhoneCount: 0,
    rejectedCount: 0,
    expandedClickCount: 0,
  };
}

function selectBestFacebookTab(tabs) {
  return [...(tabs || [])].sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  })[0] || null;
}

async function ensureFacebookContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "PING" });
    return true;
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-facebook-network-hook.js'],
      world: 'MAIN'
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['fb-phone-engine.js', 'content-facebook.js']
    });
    await sleep(1000);
    await chrome.tabs.sendMessage(tabId, { action: "PING" });
    return true;
  }
}

function startKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // ~24 seconds
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    const state = await getState();
    // If nothing is active, stop the keepalive
    if (!state.isSending && !state.fbUrlQueueRunning) {
      stopKeepAlive();
    }
    if (state.isSending && state.awaitingLeadResult && state.leadDeadlineAt && Date.now() >= state.leadDeadlineAt) {
      const currentLead = state.queue[state.currentIndex];
      if (currentLead) {
        handleMessage({
          action: "LEAD_SENT_FAILED",
          phone: currentLead.phone,
          error: "Quá thời gian chờ (35s). Trang Zalo có thể đã bị treo, mất kết nối hoặc tự tải lại."
        });
      }
    } else if (state.isSending && !state.awaitingLeadResult && state.currentIndex >= 0) {
      if (!state.nextRunAt || Date.now() >= state.nextRunAt) {
        setTimeout(() => processNextInQueue(), 0);
      }
    }
    // The alarm handler itself keeps the worker alive
  }
});

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received:", message.action);

  // Wrap in async handler
  handleMessage(message, sender).then(response => {
    sendResponse(response);
  }).catch(err => {
    console.error("Background error:", err);
    sendResponse({ success: false, error: err.message });
  });

  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  const state = await getState();

  // ===== ZALO QUEUE COMMANDS =====
  if (message.action === "START_QUEUE") {
    await setState({
      queue: message.queue || [],
      delayMs: (message.delay || 10) * 1000,
      activeTab: message.activeTab !== false,
      currentIndex: 0,
      awaitingLeadResult: false,
      nextRunAt: Date.now(),
      leadDeadlineAt: 0,
      isSending: true
    });

    startKeepAlive();
    broadcastToDashboards({ action: "STATUS_UPDATE", isSending: true, currentIndex: 0, total: (message.queue || []).length });

    // Start processing after a tiny delay to let the state save
    setTimeout(() => processNextInQueue(), 100);
    return { success: true, message: "Queue started" };
  }

  else if (message.action === "STOP_QUEUE") {
    await setState({ isSending: false, currentIndex: -1, awaitingLeadResult: false, nextRunAt: 0, leadDeadlineAt: 0 });
    broadcastToDashboards({ action: "STATUS_UPDATE", isSending: false, message: "Đã dừng gửi tin!" });
    return { success: true };
  }

  else if (message.action === "GET_STATUS") {
    return { isSending: state.isSending, currentIndex: state.currentIndex, total: state.queue.length, queue: state.queue };
  }

  else if (message.action === "LEAD_SENT_SUCCESS") {
    if (currentTaskTimeout) clearTimeout(currentTaskTimeout);
    broadcastToDashboards({ action: "LEAD_COMPLETED", phone: message.phone, status: "SUCCESS" });

    const st = await getState();
    if (st.isSending) {
      const nextIndex = st.currentIndex + 1;
      await setState({ currentIndex: nextIndex, awaitingLeadResult: false, nextRunAt: Date.now() + st.delayMs, leadDeadlineAt: 0 });
      setTimeout(() => processNextInQueue(), st.delayMs);
    }
    return { success: true };
  }

  else if (message.action === "LEAD_SENT_FAILED") {
    if (currentTaskTimeout) clearTimeout(currentTaskTimeout);
    broadcastToDashboards({ action: "LEAD_COMPLETED", phone: message.phone, status: "FAILED", error: message.error });

    const st = await getState();
    if (st.isSending) {
      const nextIndex = st.currentIndex + 1;
      await setState({ currentIndex: nextIndex, awaitingLeadResult: false, nextRunAt: Date.now() + st.delayMs, leadDeadlineAt: 0 });
      setTimeout(() => processNextInQueue(), st.delayMs);
    }
    return { success: true };
  }

  // ===== FACEBOOK SINGLE-TAB COMMANDS =====
  else if (message.action === "START_FB_SCAN" || message.action === "STOP_FB_SCAN") {
    const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
    const targetTab = selectBestFacebookTab(tabs);
    if (targetTab) {
      try {
        const response = await chrome.tabs.sendMessage(targetTab.id, message);
        if (message.action === "START_FB_SCAN") {
          broadcastToDashboards({
            action: "FB_SCAN_PROGRESS",
            status: "SCANNING",
            currentUrl: targetTab.url || '',
            metrics: emptyFbMetrics(),
            message: "Đang quét tab Facebook đã chọn."
          });
        }
        return { ...(response || {}), tabId: targetTab.id, url: targetTab.url || '' };
      } catch (e) {
        return { success: false, error: "Lỗi kết nối với trang Facebook. Hãy reload tab Facebook rồi quét lại." };
      }
    } else {
      return { success: false, error: "Không tìm thấy tab Facebook đang mở. Hãy mở hội nhóm Facebook trước." };
    }
  }

  // ===== FACEBOOK URL QUEUE COMMANDS =====
  else if (message.action === "START_FB_URL_QUEUE") {
    await setState({
      fbUrlQueue: message.urls || [],
      fbUrlQueueIndex: 0,
      fbUrlQueueRunning: true,
      fbUrlQueueSettings: {
        autoScroll: message.autoScroll !== false,
        scrollCount: message.scrollCount || 20,
        pageDelay: message.pageDelay || 45,
        continuousScan: message.continuousScan === true
      },
      fbTotalLeads: 0
    });

    startKeepAlive();
    setTimeout(() => processFbUrlQueue(), 100);
    return { success: true, message: "FB URL queue started" };
  }

  else if (message.action === "STOP_FB_URL_QUEUE") {
    const st = await getState();
    await setState({ fbUrlQueueRunning: false, fbUrlQueueIndex: -1 });

    // Also stop scanning on the current FB tab
    if (st.fbTabId) {
      try {
        await chrome.tabs.sendMessage(st.fbTabId, { action: "STOP_FB_SCAN" });
      } catch (e) { /* tab may be closed */ }
    }
    return { success: true };
  }

  // ===== FACEBOOK LEAD RESULTS =====
  else if (message.action === "NEW_FB_LEADS") {
    const st = await getState();
    await setState({ fbTotalLeads: st.fbTotalLeads + (message.leads?.length || 0) });
    broadcastToDashboards({ action: "INCOMING_FB_LEADS", leads: message.leads });
    return { success: true };
  }

  else if (message.action === "FB_SCAN_PROGRESS") {
    broadcastToDashboards({
      action: "FB_SCAN_PROGRESS",
      status: message.status,
      currentUrl: message.currentUrl || '',
      metrics: message.metrics || emptyFbMetrics(),
      reason: message.reason || '',
      message: message.message || '',
      count: message.count || 0,
      newCount: message.newCount || 0
    });
    return { success: true };
  }

  else if (message.action === "FB_SCAN_COMPLETED") {
    // Single page scan completed — check if we're in URL queue mode
    const st = await getState();
    if (st.fbUrlQueueRunning) {
      // Move to next URL in queue after delay
      const nextIndex = st.fbUrlQueueIndex + 1;
      await setState({ fbUrlQueueIndex: nextIndex });

      if (nextIndex < st.fbUrlQueue.length) {
        // Notify dashboard about wait
        broadcastToDashboards({
          action: "FB_URL_QUEUE_PROGRESS",
          status: "WAITING",
          currentPage: nextIndex,
          totalPages: st.fbUrlQueue.length,
          delaySeconds: st.fbUrlQueueSettings.pageDelay,
          totalLeads: st.fbTotalLeads,
          metrics: message.metrics || emptyFbMetrics(),
          reason: message.reason || ''
        });

        // Wait before navigating to next page
        setTimeout(() => processFbUrlQueue(), st.fbUrlQueueSettings.pageDelay * 1000);
      } else {
        // All URLs done
        await setState({ fbUrlQueueRunning: false, fbUrlQueueIndex: -1 });
        broadcastToDashboards({
          action: "FB_URL_QUEUE_PROGRESS",
          status: "COMPLETED",
          totalPages: st.fbUrlQueue.length,
          totalLeads: st.fbTotalLeads,
          metrics: message.metrics || emptyFbMetrics(),
          reason: message.reason || ''
        });
      }
    } else {
      broadcastToDashboards({
        action: "FB_SCAN_FINISHED",
        count: message.count,
        metrics: message.metrics || emptyFbMetrics(),
        reason: message.reason || ''
      });
    }
    return { success: true };
  }

  return { success: false, error: "Unknown action" };
}

// ===== ZALO QUEUE PROCESSOR =====
let currentTaskTimeout = null;

async function processNextInQueue() {
  const state = await getState();

  if (!state.isSending) return;
  if (state.awaitingLeadResult) return;
  if (state.nextRunAt && Date.now() < state.nextRunAt) return;

  if (currentTaskTimeout) clearTimeout(currentTaskTimeout);

  if (state.currentIndex >= state.queue.length) {
    await setState({ isSending: false, currentIndex: -1, awaitingLeadResult: false, nextRunAt: 0, leadDeadlineAt: 0 });
    broadcastToDashboards({ action: "STATUS_UPDATE", isSending: false, message: "Đã gửi xong tất cả chiến dịch!" });
    stopKeepAlive();
    return;
  }

  const currentLead = state.queue[state.currentIndex];
  await setState({ awaitingLeadResult: true, nextRunAt: 0, leadDeadlineAt: Date.now() + 35000 });
  broadcastToDashboards({ action: "STATUS_UPDATE", isSending: true, currentIndex: state.currentIndex, total: state.queue.length });

  // Failsafe timeout: if Zalo tab crashes/reloads and never sends SUCCESS/FAILED
  currentTaskTimeout = setTimeout(() => {
    console.warn("Task timed out for lead", currentLead.phone);
    handleMessage({
      action: "LEAD_SENT_FAILED",
      phone: currentLead.phone,
      error: "Quá thời gian chờ (35s). Trang Zalo có thể đã bị treo, mất kết nối hoặc tự tải lại."
    });
  }, 35000);

  // Try to find and reuse existing Zalo tab
  try {
    const zaloTabs = await chrome.tabs.query({ url: ["https://chat.zalo.me/*", "https://zalo.me/*"] });

    if (zaloTabs.length > 0) {
      const tabId = zaloTabs[0].id;
      await setState({ zaloTabId: tabId });

      if (state.activeTab) {
        chrome.tabs.update(tabId, { active: true });
      }

      // Wait a moment, then send command
      setTimeout(() => sendToZaloTab(tabId, { action: "AUTOMATE_SEND", lead: currentLead }), 1500);
    } else {
      // No Zalo tab open — create one
      openNewZaloTab(currentLead, state.activeTab);
    }
  } catch (e) {
    console.error("Error finding Zalo tab:", e);
    openNewZaloTab(currentLead, state.activeTab);
  }
}

function openNewZaloTab(lead, isActive) {
  chrome.tabs.create({ url: "https://chat.zalo.me/", active: isActive }, (tab) => {
    setState({ zaloTabId: tab.id });

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Wait for Zalo to fully initialize (WebSocket, UI, possible activation dialog)
        setTimeout(() => {
          sendToZaloTab(tab.id, { action: "AUTOMATE_SEND", lead: lead });
        }, 8000);
      }
    });
  });
}

function sendToZaloTab(tabId, message, retryCount = 0) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(`sendToZaloTab error (attempt ${retryCount + 1}):`, chrome.runtime.lastError.message);
      if (retryCount < 4) {
        // Retry with increasing delay: 2s, 4s, 6s, 8s
        setTimeout(() => sendToZaloTab(tabId, message, retryCount + 1), 2000 * (retryCount + 1));
      } else {
        // Give up — report failure for this lead
        if (message.lead) {
          chrome.runtime.sendMessage({
            action: "LEAD_SENT_FAILED",
            phone: message.lead.phone,
            error: "Không thể kết nối với trang Zalo. Content script chưa sẵn sàng."
          });
        }
      }
    }
  });
}

// ===== FACEBOOK URL QUEUE PROCESSOR =====
async function processFbUrlQueue() {
  const state = await getState();

  if (!state.fbUrlQueueRunning) return;
  if (state.fbUrlQueueIndex >= state.fbUrlQueue.length) {
    await setState({ fbUrlQueueRunning: false, fbUrlQueueIndex: -1 });
    broadcastToDashboards({
      action: "FB_URL_QUEUE_PROGRESS",
      status: "COMPLETED",
      totalPages: state.fbUrlQueue.length,
      totalLeads: state.fbTotalLeads,
      metrics: emptyFbMetrics()
    });
    stopKeepAlive();
    return;
  }

  const currentUrl = state.fbUrlQueue[state.fbUrlQueueIndex];

  // Notify dashboard
  broadcastToDashboards({
    action: "FB_URL_QUEUE_PROGRESS",
    status: "NAVIGATING",
    currentPage: state.fbUrlQueueIndex + 1,
    totalPages: state.fbUrlQueue.length,
    currentUrl: currentUrl,
    totalLeads: state.fbTotalLeads
  });

  // Check if we already have an FB tab open, or create one
  let fbTabId = null;

  if (state.fbTabId) {
    try {
      await chrome.tabs.get(state.fbTabId);
      // Tab exists — navigate it to the new URL
      await chrome.tabs.update(state.fbTabId, { url: currentUrl, active: true });
      fbTabId = state.fbTabId;
    } catch (e) {
      // Tab was closed
      fbTabId = null;
    }
  }

  if (!fbTabId) {
    // Create a new tab for FB scanning
    const tab = await chrome.tabs.create({ url: currentUrl, active: true });
    fbTabId = tab.id;
    await setState({ fbTabId: fbTabId });
  }

  // Wait for page to load
  await waitForTabComplete(fbTabId);
  broadcastToDashboards({
    action: "FB_URL_QUEUE_PROGRESS",
    status: "LOADED",
    currentPage: state.fbUrlQueueIndex + 1,
    totalPages: state.fbUrlQueue.length,
    currentUrl: currentUrl,
    totalLeads: state.fbTotalLeads,
    metrics: emptyFbMetrics()
  });

  // Give extra time for Facebook's dynamic content to render
  await sleep(5000);

  // Notify dashboard: scanning
  broadcastToDashboards({
    action: "FB_URL_QUEUE_PROGRESS",
    status: "SCANNING",
    currentPage: state.fbUrlQueueIndex + 1,
    totalPages: state.fbUrlQueue.length,
    currentUrl: currentUrl,
    totalLeads: state.fbTotalLeads,
    metrics: emptyFbMetrics()
  });

  // Send scan command to the FB tab content script
  try {
    await ensureFacebookContentScript(fbTabId);
    await chrome.tabs.sendMessage(fbTabId, {
      action: "START_FB_SCAN",
      autoScroll: state.fbUrlQueueSettings.autoScroll,
      scrollCount: state.fbUrlQueueSettings.scrollCount,
      continuousScan: state.fbUrlQueueSettings.continuousScan === true
    });
  } catch (e) {
    console.warn("Could not send scan command to FB tab, injecting script...", e);
    // Content script might not be loaded — try injecting it
    try {
      await ensureFacebookContentScript(fbTabId);
      await chrome.tabs.sendMessage(fbTabId, {
        action: "START_FB_SCAN",
        autoScroll: state.fbUrlQueueSettings.autoScroll,
        scrollCount: state.fbUrlQueueSettings.scrollCount,
        continuousScan: state.fbUrlQueueSettings.continuousScan === true
      });
    } catch (e2) {
      console.error("Failed to inject FB script:", e2);
      broadcastToDashboards({
        action: "FB_URL_QUEUE_PROGRESS",
        status: "FAILED",
        currentPage: state.fbUrlQueueIndex + 1,
        totalPages: state.fbUrlQueue.length,
        currentUrl: currentUrl,
        totalLeads: state.fbTotalLeads,
        metrics: emptyFbMetrics(),
        reason: "Không thể kết nối content script Facebook."
      });
      // Skip this URL — move to next
      handleMessage({
        action: "FB_SCAN_COMPLETED",
        count: 0,
        metrics: emptyFbMetrics(),
        reason: "Không thể kết nối content script Facebook."
      }, null);
    }
  }

  // The content script will send FB_SCAN_COMPLETED when done,
  // which triggers the handleMessage handler to advance the queue
}

// ===== UTILITY FUNCTIONS =====
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Safety timeout: don't wait forever
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function broadcastToDashboards(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.url && tab.url.includes("zalo-lead-connector.html")) {
        chrome.tabs.sendMessage(tab.id, message, () => {
          if (chrome.runtime.lastError) {} // Ignore errors
        });
      }
    });
  });
}

// ===== RECOVERY ON STARTUP =====
// When the service worker restarts, check if we were in the middle of something
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.isSending && state.currentIndex >= 0) {
    console.log("Service worker restarted — resuming Zalo queue from index", state.currentIndex);
    startKeepAlive();
    setTimeout(() => processNextInQueue(), 3000);
  }
  if (state.fbUrlQueueRunning && state.fbUrlQueueIndex >= 0) {
    console.log("Service worker restarted — resuming FB URL queue from index", state.fbUrlQueueIndex);
    startKeepAlive();
    setTimeout(() => processFbUrlQueue(), 3000);
  }
});

// Also check on install/update
chrome.runtime.onInstalled.addListener(async () => {
  // Reset any stale running state on fresh install
  await setState({ isSending: false, fbUrlQueueRunning: false });
  console.log("TravelLead Connect extension installed/updated.");
});
