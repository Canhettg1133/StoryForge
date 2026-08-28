// Only renders redacted journal entries; never reads the active provider or key list.
function escapeTranslatorKeyUsageHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

function formatTranslatorKeyUsageIdentity(entry) {
    const providers = { gemini_direct: 'Gemini', ag_proxy: 'AG Proxy', custom_proxy: 'Custom Proxy', ollama: 'Ollama' };
    const provider = providers[entry.provider] || entry.provider;
    const key = entry.keyless ? 'Không dùng key' : `Key ${entry.keyIndex === null ? '?' : entry.keyIndex + 1}${entry.keySuffix ? ` · …${entry.keySuffix}` : ''}`;
    return `${provider} · ${key}`;
}

function getTranslatorChunkKeyBadge(chunkIndex) {
    const usage = getTranslatorChunkKeyUsage(chunkIndex);
    const entries = usage?.attempts || [];
    const last = entries[entries.length - 1];
    const label = !last ? '—' : last.keyless ? 'Không dùng key' : `Key ${last.keyIndex === null ? '?' : last.keyIndex + 1}`;
    // Golden-angle hues give each key number a stable color without a short repeating palette.
    const hue = last && !last.keyless && last.keyIndex !== null ? ((210 + last.keyIndex * 137.508) % 360).toFixed(3) : null;
    return {
        label,
        color: hue === null ? '' : `hsl(${hue} 72% var(--chunk-key-lightness))`,
        ariaLabel: `Chunk ${chunkIndex + 1}. ${last ? `Lần gọi gần nhất: ${formatTranslatorKeyUsageIdentity(last)}` : 'Chưa ghi nhận key'}. Xem nhật ký gọi API`,
    };
}

function renderTranslatorChunkKeyBadge(chunkIndex) {
    const badge = getTranslatorChunkKeyBadge(chunkIndex);
    return `<button type="button" class="chunk-key-usage__badge" data-click-action="viewChunkDetail" data-stop-propagation="true" data-chunk-index="${chunkIndex}"${badge.color ? ` style="--chunk-key-color: ${badge.color}"` : ''} aria-label="${escapeTranslatorKeyUsageHtml(badge.ariaLabel)}">${escapeTranslatorKeyUsageHtml(badge.label)}</button>`;
}

function refreshTranslatorChunkKeyBadge(chunkIndex) {
    const row = document.getElementById(`chunk-row-${chunkIndex}`);
    const badge = row?.querySelector('.chunk-key-usage__badge');
    if (!badge) return;
    const presentation = getTranslatorChunkKeyBadge(chunkIndex);
    badge.textContent = presentation.label;
    badge.setAttribute('aria-label', presentation.ariaLabel);
    if (presentation.color) badge.style.setProperty('--chunk-key-color', presentation.color);
    else badge.style.removeProperty('--chunk-key-color');
}

function buildTranslatorChunkKeyDetailContent(chunkIndex) {
    const usage = getTranslatorChunkKeyUsage(chunkIndex);
    const entries = usage?.attempts || [];
    if (!entries.length) return '<h4>Key đã gọi cho chunk</h4><p>Chưa có nhật ký gọi API cho chunk này. Bản lưu cũ không được tự gán key.</p>';
    const statuses = { pending: 'Đang gọi', responded: 'Có phản hồi', failed: 'Lỗi', cancelled: 'Đã hủy', retried: 'Gọi lại', interrupted: 'Chưa rõ kết quả' };
    const kinds = { main: 'Dịch', retry: 'Thử lại', manual_retry: 'Dịch lại', split_retry: 'Chia nhỏ' };
    return `<h4>Key đã gọi cho chunk</h4>
        <p>Số key theo danh sách lúc gửi. Gồm cả lần lỗi và dịch lại; “Có phản hồi” không thay thế trạng thái kiểm tra bản dịch. Sửa thủ công không tạo lần gọi API.</p>
        ${usage.omitted ? `<p>Hiển thị ${entries.length} lần gần nhất; ${usage.omitted} lần cũ hơn đã lược bớt.</p>` : ''}
        <ol class="chunk-key-usage__attempts" start="${usage.omitted + 1}">${entries.map((entry) => `<li>
            <span class="chunk-key-usage__identity">${escapeTranslatorKeyUsageHtml(formatTranslatorKeyUsageIdentity(entry))}</span>
            <span class="chunk-key-usage__state">${statuses[entry.status]} · ${kinds[entry.kind]}${entry.partIndex !== null ? ` · Phần ${entry.partIndex + 1}` : ''}</span>
            ${entry.model ? `<span class="chunk-key-usage__model">${escapeTranslatorKeyUsageHtml(entry.model)}</span>` : ''}
        </li>`).join('')}</ol>`;
}

function renderTranslatorChunkKeyDetail(chunkIndex) {
    return `<section class="chunk-key-usage__detail" data-key-usage-chunk="${chunkIndex}">${buildTranslatorChunkKeyDetailContent(chunkIndex)}</section>`;
}

function refreshTranslatorChunkKeyDetail(chunkIndex) {
    const detail = typeof document !== 'undefined' ? document.querySelector(`[data-key-usage-chunk="${chunkIndex}"]`) : null;
    if (detail) detail.innerHTML = buildTranslatorChunkKeyDetailContent(chunkIndex);
}
