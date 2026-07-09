function updateUI() {
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (response) => {
    if (chrome.runtime.lastError) return;

    const statusVal = document.getElementById("status-val");
    const statusDesc = document.getElementById("status-desc");
    const actionBtn = document.getElementById("action-btn");

    if (response && response.isSending) {
      statusVal.textContent = "Đang gửi...";
      statusVal.style.color = "#34d399";
      statusDesc.textContent = `Tiến trình: ${response.currentIndex + 1}/${response.total} đối tác.`;

      actionBtn.style.display = "block";
      actionBtn.textContent = "Dừng chiến dịch";
      actionBtn.className = "btn btn-danger";
    } else {
      statusVal.textContent = "Đang chờ...";
      statusVal.style.color = "#22d3ee";
      statusDesc.textContent = "Hãy bắt đầu chiến dịch trên trang Web Dashboard.";
      actionBtn.style.display = "none";
    }
  });
}

document.getElementById("action-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "STOP_QUEUE" }, (response) => {
    updateUI();
  });
});

// Update UI initially and setup polling interval
updateUI();
setInterval(updateUI, 1000);
