(function (ns) {
    'use strict';
    let lastPaint = -Infinity;
    let lastSignature = '';
    const labels = { ready: 'Sẵn sàng', wave: 'Chờ đợt mới', rpm: 'Hết RPM', cooldown: 'Cooldown',
        stagger: 'Chờ mở key', paused: 'Tạm dừng', disabled: 'Key không khả dụng' };
    ns.renderStatus = state => {
        const panel = document.getElementById('aiStudioKeyStatus');
        if (!panel) return;
        const signature = JSON.stringify([state.inFlight, state.paused, state.keys.map(key => [key.used, key.retries, key.reason])]);
        if (Date.now() - lastPaint < 1000 && signature === lastSignature) return;
        lastPaint = Date.now(); lastSignature = signature; panel.hidden = false;
        const heading = document.createElement('h3');
        heading.textContent = `AI Studio · ${state.inFlight}/${state.parallel} request đang chạy`;
        const list = document.createElement('ul');
        state.keys.forEach(key => {
            const row = document.createElement('li');
            const fields = [`Key ${key.keyIndex + 1}`, `${key.inFlight}/${key.limit} đang chạy`,
                `${key.used}/${key.rpm} RPM`, `${key.retries} retry chờ`,
                `${labels[key.reason]}${key.waitMs > 0 ? ` · ${Math.ceil(key.waitMs / 1000)}s` : ''}`];
            fields.forEach((text, index) => {
                const part = document.createElement(index === 0 ? 'strong' : 'span');
                part.textContent = text; row.appendChild(part);
            });
            list.appendChild(row);
        });
        panel.replaceChildren(heading, list);
    };
    ns.finishStatus = () => {
        const panel = document.getElementById('aiStudioKeyStatus');
        if (panel) { panel.hidden = true; panel.replaceChildren(); }
        lastPaint = -Infinity; lastSignature = '';
    };
})(globalThis.AiStudioScheduler);
