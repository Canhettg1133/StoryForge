import { chromium } from 'playwright';

const url = process.env.STORYFORGE_TRANSLATOR_URL
  || 'http://127.0.0.1:4175/translator-runtime/index.html';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 360, height: 640 },
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInfo', { state: 'attached' });

  const fileCard = await page.evaluate(() => {
    const card = document.querySelector('#fileInfo');
    const details = card.querySelector('.file-details');
    const meta = card.querySelector('.file-meta');
    const name = card.querySelector('#fileName');
    const close = card.querySelector('[data-click-action="clearFile"]');

    card.style.display = 'flex';
    name.textContent = '科技：说好的渔民世家，你这是舰什么鬼？【不易整理请关注_CunWorkNotes]_translated_partial_664chunks.txt';

    const rect = element => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };

    return {
      viewportWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cardClientWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth,
      card: rect(card),
      details: rect(details),
      meta: rect(meta),
      name: rect(name),
      close: rect(close),
    };
  });

  const modalMeasurements = [];
  for (const height of [640, 520, 440]) {
    await page.setViewportSize({ width: 360, height });
    const measurement = await page.evaluate(() => {
      const modal = document.querySelector('#hanFileAudit');
      const layout = document.querySelector('#hanFileAuditLayout');
      const canvas = document.querySelector('#hanFileAuditIssueCanvas');
      modal.hidden = false;
      document.body.classList.add('han-file-audit-open');
      layout.hidden = false;

      document.querySelector('#hanFileAuditFileName').textContent = 'ban-dich-rat-dai-translated.txt • 3.6 MiB';
      document.querySelector('#hanFileAuditSummary').textContent = '30 Hán tự trong 20 chunk.';
      document.querySelector('#hanFileAuditMeta').textContent = '20 chunk còn cần xử lý • 985 chunk đã quét';
      document.querySelector('#hanFileAuditChunkTitle').textContent = 'Chunk 980';
      document.querySelector('#hanFileAuditChunkState').textContent = '1 Hán tự';
      document.querySelector('#hanFileAuditPosition').textContent = '10 / 20';
      document.querySelector('#hanFileAuditChunkText').textContent = 'Nội dung bản dịch còn một chữ 漢. '.repeat(18);
      document.querySelector('#correctOneHanFileBtn').disabled = false;
      document.querySelector('#previousHanFileIssueBtn').disabled = false;
      document.querySelector('#nextHanFileIssueBtn').disabled = false;

      canvas.innerHTML = '';
      for (const chunk of [985, 980, 975, 970]) {
        const row = document.createElement('button');
        row.className = 'han-file-audit__issue-row';
        row.innerHTML = `<strong>Chunk ${chunk}</strong><span>1 Hán tự</span>`;
        row.style.transform = `translateY(${canvas.children.length * 54}px)`;
        canvas.append(row);
      }
      canvas.style.height = '216px';

      const pick = selector => {
        const element = document.querySelector(selector);
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          bottom: value.bottom,
          left: value.left,
          right: value.right,
          width: value.width,
          height: value.height,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      };

      return {
        innerHeight: window.innerHeight,
        shell: pick('.han-file-audit__shell'),
        header: pick('.han-file-audit__header'),
        summary: pick('.han-file-audit__summary'),
        layout: pick('.han-file-audit__layout'),
        issues: pick('.han-file-audit__issues'),
        detail: pick('.han-file-audit__detail'),
        detailHeader: pick('.han-file-audit__detail > header'),
        text: pick('.han-file-audit__text'),
        nav: pick('.han-file-audit__nav'),
        footer: pick('.han-file-audit__footer'),
      };
    });
    modalMeasurements.push(measurement);
  }

  const fileCardOverflows = fileCard.close.right > fileCard.card.right + 0.5
    || fileCard.cardScrollWidth > fileCard.cardClientWidth + 1;
  const brokenModalHeights = modalMeasurements.filter(item => (
    item.layout.height < 150
    || item.nav.top < item.detailHeader.bottom - 0.5
    || item.nav.bottom > item.detail.bottom + 0.5
    || item.footer.bottom > item.shell.bottom + 0.5
    || item.text.clientHeight < 44
  ));

  console.log(JSON.stringify({
    fileCard,
    fileCardOverflows,
    modalMeasurements,
    brokenModalHeights: brokenModalHeights.map(item => item.innerHeight),
  }, null, 2));

  if (fileCardOverflows || brokenModalHeights.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
