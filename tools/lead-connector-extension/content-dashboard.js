// Bridge between Web Dashboard and Extension Background
console.log("TravelLead Connect Dashboard Bridge Injected.");

function isLeadConnectorDashboardPage() {
  const pathname = (window.location?.pathname || '').toLowerCase();
  return pathname.endsWith('/zalo-lead-connector.html') || pathname.endsWith('\\zalo-lead-connector.html');
}

const isDashboardPage = isLeadConnectorDashboardPage();

if (isDashboardPage) {
  // Let the page know that the extension is active and installed!
  document.documentElement.setAttribute('data-lead-connector-extension', 'installed');
  window.dispatchEvent(new CustomEvent('LEAD_CONNECTOR_EXTENSION_READY'));
}

// Listen to messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isDashboardPage) {
    sendResponse({ success: false, error: "Not the lead connector dashboard" });
    return true;
  }

  console.log("Dashboard Content Script received message:", message);

  // Forward to Dashboard Web Page
  window.dispatchEvent(new CustomEvent('LEAD_CONNECTOR_FROM_EXT', { detail: message }));
  sendResponse({ success: true });
  return true;
});

// Listen to custom events dispatched by the Web Dashboard page
window.addEventListener('LEAD_CONNECTOR_TO_EXT', (event) => {
  if (!isDashboardPage) return;

  const data = event.detail;
  console.log("Dashboard Page sent action to Extension:", data);

  if (data && data.action) {
    chrome.runtime.sendMessage(data, (response) => {
      console.log("Background response:", response);
      if (chrome.runtime.lastError) {
        window.dispatchEvent(new CustomEvent('LEAD_CONNECTOR_FROM_EXT', {
          detail: {
            action: "EXTENSION_COMMAND_FAILED",
            requestAction: data.action,
            error: chrome.runtime.lastError.message || "Extension không phản hồi."
          }
        }));
        return;
      }
      if (response && response.success === false) {
        window.dispatchEvent(new CustomEvent('LEAD_CONNECTOR_FROM_EXT', {
          detail: {
            action: "EXTENSION_COMMAND_FAILED",
            requestAction: data.action,
            error: response.error || "Lệnh extension thất bại."
          }
        }));
      }
    });
  }
});
