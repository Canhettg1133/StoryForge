import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractDashboardScript() {
  const html = read('zalo-lead-connector.html');
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  if (!match) throw new Error('Cannot find dashboard inline script');
  return match[1];
}

function makeElement(initial = {}) {
  const element = {
    value: '',
    textContent: '',
    innerText: '',
    innerHTML: '',
    style: {},
    disabled: false,
    checked: false,
    className: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener() {},
    click() {},
    focus() {},
    getAttribute(name) {
      return this[name] || '';
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    ...initial,
  };
  element.classList = {
    add(...classes) {
      const current = new Set(String(element.className || '').split(/\s+/).filter(Boolean));
      classes.forEach((className) => current.add(className));
      element.className = Array.from(current).join(' ');
    },
    remove(...classes) {
      const removeSet = new Set(classes);
      element.className = String(element.className || '')
        .split(/\s+/)
        .filter((className) => className && !removeSet.has(className))
        .join(' ');
    },
    contains(className) {
      return String(element.className || '').split(/\s+/).includes(className);
    },
  };
  return element;
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function loadDashboardContext(fetchImpl, options = {}) {
  const storage = options.storage || makeStorage();
  const elements = new Map([
    ['raw-text-input', makeElement()],
    ['default-source', makeElement({ value: 'Facebook Group' })],
    ['default-name', makeElement({ value: 'Partner' })],
    ['toast', makeElement()],
    ['toast-message', makeElement()],
    ['template-text', makeElement({ value: 'Chao {ten}\nSDT {sdt}' })],
    ['campaign-target-type', makeElement({ value: 'LIMIT' })],
    ['campaign-limit-val', makeElement({ value: '15' })],
    ['campaign-delay', makeElement({ value: '0' })],
    ['campaign-silent', makeElement({ checked: true })],
    ['zalo-login-qr-panel', makeElement()],
    ['zalo-login-qr-img', makeElement()],
    ['zalo-login-status', makeElement()],
    ['zalo-login-account', makeElement()],
    ['zalo-login-account-name', makeElement()],
    ['zalo-login-account-id', makeElement()],
    ['btn-zalo-login-qr', makeElement()],
    ['receipt-modal', makeElement({ className: 'hidden' })],
    ['receipt-modal-img', makeElement()],
    ['receipt-modal-title', makeElement()],
    ['receipt-modal-status', makeElement()],
    ['receipt-modal-open-link', makeElement()],
    ['template-selector', makeElement({ value: 'intro_tour' })],
    ['char-counter', makeElement()],
    ['storage-status', makeElement()],
    ['stat-total', makeElement()],
    ['stat-sent', makeElement()],
    ['stat-new', makeElement()],
    ['stat-sent-percent', makeElement()],
    ['progress-percent-label', makeElement()],
    ['progress-bar', makeElement()],
    ['lead-rows', makeElement()],
    ['empty-state', makeElement()],
    ['btn-mark-copied-sent', makeElement({ disabled: true })],
    ['mark-copied-sent-label', makeElement()],
    ['select-all', makeElement()],
    ['filter-status', makeElement({ value: 'ALL' })],
    ['filter-source', makeElement({ value: 'ALL' })],
    ['search-input', makeElement()],
  ]);
  const events = [];
  const clipboardWrites = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    Promise,
    setTimeout(fn) {
      if (typeof fn === 'function') fn();
      return 1;
    },
    clearTimeout() {},
    confirm: () => true,
    alert() {},
    fetch: fetchImpl,
    Response,
    localStorage: storage,
    document: {
      documentElement: {
        getAttribute: () => null,
        setAttribute() {},
      },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
      querySelectorAll: () => [],
      createElement: () => makeElement(),
    },
    window: {
      addEventListener() {},
      dispatchEvent(event) {
        events.push(event.detail || event);
      },
      open() {},
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    navigator: { clipboard: { writeText: (text) => {
      clipboardWrites.push(text);
      return Promise.resolve();
    } } },
    __elements: elements,
    __events: events,
    __toasts: [],
    __clipboardWrites: clipboardWrites,
  };

  vm.createContext(context);
  vm.runInContext(extractDashboardScript(), context, {
    filename: 'zalo-lead-connector.html',
  });
  const overrides = [
    'showToast = (message, type = "success") => { globalThis.__toasts.push({ message, type }); };',
  ];
  if (!options.preserveRender) {
    overrides.push('renderAll = () => {};');
    overrides.push('renderStats = () => {};');
  }
  if (!options.preservePersistence) {
    overrides.push('saveToLocalStorage = () => {};');
  }
  vm.runInContext(overrides.join('\n'), context);
  return context;
}

describe('Zalo dashboard local API contracts', () => {
  it('sends a single lead through the local OpenZCA queue API', async () => {
    const calls = [];
    const context = loadDashboardContext(async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, queue: { running: true, items: [] } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    });

    vm.runInContext(`
      leads = [{ id: 'lead_1', name: 'Lan', phone: '0912 345 678', source: 'FB Tour', status: 'NEW', note: '' }];
    `, context);

    await vm.runInContext(`connectZalo('lead_1')`, context);

    expect(calls[0].url).toBe('http://127.0.0.1:11452/api/zalo/queue/start');
    expect(JSON.parse(calls[0].options.body)).toEqual({
      delaySec: 0,
      queue: [
        {
          id: 'lead_1',
          name: 'Lan',
          phone: '0912345678',
          source: 'FB Tour',
          message: 'Chao Lan\nSDT 0912345678',
        },
      ],
    });
    expect(context.__events).toHaveLength(0);
  });

  it('does not mark failed local queue results as contacted', () => {
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    });

    vm.runInContext(`
      leads = [{ id: 'lead_1', name: 'Lan', phone: '0912345678', source: 'FB Tour', status: 'NEW', note: '' }];
      applyZaloLocalQueueResults({
        items: [{ id: 'lead_1', phone: '0912345678', status: 'FAILED', error: 'Không tìm thấy user' }]
      });
    `, context);

    expect(vm.runInContext('leads[0].status', context)).toBe('DECLINED');
    expect(vm.runInContext('leads[0].note', context)).toMatch(/Không tìm thấy user/);
  });

  it('loads a QR image into the dashboard login panel', async () => {
    const calls = [];
    const context = loadDashboardContext(async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        ok: true,
        qrDataUrl: 'data:image/png;base64,QUJD',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await vm.runInContext('requestZaloLoginQr()', context);

    expect(calls[0].url).toBe('http://127.0.0.1:11452/api/zalo/auth/login-qr');
    expect(calls[0].options.method).toBe('POST');
    expect(context.__elements.get('zalo-login-qr-img').src).toBe('data:image/png;base64,QUJD');
    expect(context.__elements.get('zalo-login-status').textContent).toMatch(/quét qr/i);
  });

  it('shows the currently logged-in Zalo account in the login panel', () => {
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    });

    vm.runInContext(`
      updateZaloLoginPanel({
        auth: {
          loggedIn: true,
          profile: 'default',
          userId: '124136449945644070',
          displayName: 'Trần Văn Đạt'
        },
        queue: { running: false }
      });
    `, context);

    expect(context.__elements.get('zalo-login-status').textContent).toContain('Trần Văn Đạt');
    expect(context.__elements.get('zalo-login-account-name').textContent).toBe('Trần Văn Đạt');
    expect(context.__elements.get('zalo-login-account-id').textContent).toContain('124136449945644070');
  });

  it('persists edited message templates to localStorage', () => {
    const storage = makeStorage();
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    }, { storage, preservePersistence: true });

    vm.runInContext(`
      loadFromLocalStorage();
      activeTemplateId = 'intro_tour';
      document.getElementById('template-text').value = 'Chào {ten}, mẫu đã lưu mới.';
      saveTemplate();
    `, context);

    const savedTemplates = JSON.parse(storage.getItem('travel_templates'));
    expect(savedTemplates.intro_tour.text).toBe('Chào {ten}, mẫu đã lưu mới.');
    expect(savedTemplates.intro_tour.updatedAt).toBeTruthy();
  });

  it('marks successful Zalo sends with CONTACTED status and sentAt timestamp', () => {
    const storage = makeStorage();
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    }, { storage, preservePersistence: true });

    vm.runInContext(`
      leads = [{ id: 'lead_1', name: 'Lan', phone: '0912345678', source: 'FB Tour', status: 'NEW', note: '' }];
      applyZaloLocalQueueResults({
        items: [{
          id: 'lead_1',
          phone: '0912345678',
          status: 'SUCCESS',
          receiptPath: '2026-06-29/receipt.png',
          receiptUrl: '/receipts/2026-06-29/receipt.png',
          zaloName: 'Lan Tour Zalo',
          receiptCreatedAt: '2026-06-29T10:00:00.000Z',
          receiptKind: 'zalo-demo-render',
          receiptError: ''
        }]
      });
    `, context);

    expect(vm.runInContext('leads[0].status', context)).toBe('CONTACTED');
    expect(vm.runInContext('Boolean(leads[0].sentAt)', context)).toBe(true);
    expect(vm.runInContext('leads[0].receiptUrl', context)).toBe('/receipts/2026-06-29/receipt.png');
    expect(vm.runInContext('leads[0].zaloName', context)).toBe('Lan Tour Zalo');
    const savedLeads = JSON.parse(storage.getItem('travel_leads'));
    expect(savedLeads[0].sentAt).toBeTruthy();
    expect(savedLeads[0].zaloName).toBe('Lan Tour Zalo');
    expect(savedLeads[0].receiptPath).toBe('2026-06-29/receipt.png');
    expect(savedLeads[0].receiptKind).toBe('zalo-demo-render');
  });

  it('renders a demo receipt image action for contacted leads with receiptUrl', () => {
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    }, { preserveRender: true });

    vm.runInContext(`
      leads = [{
        id: 'lead_1',
        name: 'Lan',
        phone: '0912345678',
        source: 'FB Tour',
        status: 'CONTACTED',
        note: '',
        sentAt: '2026-06-29T10:00:00.000Z',
        zaloName: 'Lan Tour Zalo',
        receiptUrl: '/receipts/2026-06-29/receipt.png',
        receiptKind: 'zalo-demo-render'
      }];
      renderLeadTable();
    `, context);

    const row = context.__elements.get('lead-rows').children[0];
    expect(row.innerHTML).toContain('Đã gửi Zalo');
    expect(row.innerHTML).toContain('Có ảnh demo');
    expect(row.innerHTML).toContain('Ảnh demo');
    expect(row.innerHTML).toContain('/receipts/2026-06-29/receipt.png');
    expect(row.innerHTML).toContain('data-lead-name="Lan Tour Zalo"');
  });

  it('opens receipt images in an in-page preview modal', () => {
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    });

    vm.runInContext(`
      openReceiptImage('/receipts/2026-06-29/receipt.png', 'Lan Tour');
    `, context);

    expect(context.__elements.get('receipt-modal').classList.contains('hidden')).toBe(false);
    expect(context.__elements.get('receipt-modal-img').src).toBe('http://127.0.0.1:11452/receipts/2026-06-29/receipt.png');
    expect(context.__elements.get('receipt-modal-open-link').href).toBe('http://127.0.0.1:11452/receipts/2026-06-29/receipt.png');
    expect(context.__elements.get('receipt-modal-title').textContent).toContain('Lan Tour');
    expect(context.__elements.get('receipt-modal-status').textContent).toContain('Ảnh demo');

    vm.runInContext('closeReceiptModal()', context);
    expect(context.__elements.get('receipt-modal').classList.contains('hidden')).toBe(true);
  });

  it('copies the next 15 unsent leads with phone numbers separated by =====', async () => {
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    });

    vm.runInContext(`
      leads = Array.from({ length: 18 }, (_, index) => ({
        id: 'lead_' + index,
        name: 'Đối tác ' + index,
        phone: '09123456' + String(index).padStart(2, '0'),
        source: 'Nhóm FB',
        status: index === 2 ? 'CONTACTED' : 'NEW',
        note: ''
      }));
      copyNextUnsentLeads();
    `, context);

    await Promise.resolve();
    const copied = context.__clipboardWrites[0];
    expect(copied).toContain('Tên: Đối tác 0');
    expect(copied).toContain('SĐT: 0912345600');
    expect(copied).not.toContain('Đối tác 2');
    expect(copied.split('\n=====\n')).toHaveLength(15);
    expect(context.__toasts.at(-1).message).toContain('Đã copy 15 đối tác chưa gửi');
  });

  it('does not copy leads that were manually marked as sent from the status dropdown', async () => {
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    });

    vm.runInContext(`
      leads = [
        { id: 'manual', name: 'Đã chỉnh tay', phone: '0912345600', source: 'Nhóm FB', status: 'NEW', note: '' },
        { id: 'old_label', name: 'Dữ liệu cũ', phone: '0912345601', source: 'Nhóm FB', status: 'ĐÃ GỬI', note: '' },
        { id: 'has_sent_at', name: 'Có giờ gửi', phone: '0912345602', source: 'Nhóm FB', status: 'NEW', sentAt: '2026-06-29T10:00:00.000Z', note: '' },
        { id: 'new_1', name: 'Chưa gửi 1', phone: '0912345603', source: 'Nhóm FB', status: 'NEW', note: '' },
        { id: 'new_2', name: 'Chưa gửi 2', phone: '0912345604', source: 'Nhóm FB', status: 'NEW', note: '' }
      ];
      updateLeadField('manual', 'status', 'CONTACTED');
      copyNextUnsentLeads();
    `, context);

    await Promise.resolve();
    const copied = context.__clipboardWrites[0];
    expect(copied).not.toContain('Đã chỉnh tay');
    expect(copied).not.toContain('Dữ liệu cũ');
    expect(copied).not.toContain('Có giờ gửi');
    expect(copied).toContain('Chưa gửi 1');
    expect(copied).toContain('Chưa gửi 2');
    expect(copied.split('\n=====\n')).toHaveLength(2);
  });

  it('marks exactly the last copied unsent lead batch as contacted', async () => {
    const storage = makeStorage();
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    }, { storage, preservePersistence: true });

    vm.runInContext(`
      leads = Array.from({ length: 18 }, (_, index) => ({
        id: 'lead_' + index,
        name: 'Đối tác ' + index,
        phone: '09123456' + String(index).padStart(2, '0'),
        source: 'Nhóm FB',
        status: index === 2 ? 'CONTACTED' : 'NEW',
        note: ''
      }));
      copyNextUnsentLeads();
    `, context);

    await Promise.resolve();
    expect(context.__elements.get('btn-mark-copied-sent').disabled).toBe(false);
    expect(context.__elements.get('mark-copied-sent-label').textContent).toContain('15');

    vm.runInContext('markLastCopiedUnsentLeadsAsContacted()', context);

    const markedIds = vm.runInContext(`
      leads.filter(lead => lead.status === 'CONTACTED').map(lead => lead.id)
    `, context);
    expect(markedIds).toEqual([
      'lead_0',
      'lead_1',
      'lead_2',
      'lead_3',
      'lead_4',
      'lead_5',
      'lead_6',
      'lead_7',
      'lead_8',
      'lead_9',
      'lead_10',
      'lead_11',
      'lead_12',
      'lead_13',
      'lead_14',
      'lead_15',
    ]);
    expect(vm.runInContext('leads[16].status', context)).toBe('NEW');
    expect(vm.runInContext('Boolean(leads[0].sentAt)', context)).toBe(true);
    expect(vm.runInContext('leads[0].note', context)).toContain('Đánh dấu đã gửi sau khi copy batch');
    expect(JSON.parse(storage.getItem('travel_leads'))[0].status).toBe('CONTACTED');
    expect(context.__elements.get('btn-mark-copied-sent').disabled).toBe(true);
    expect(context.__toasts.at(-1).message).toContain('Đã đánh dấu 15 đối tác vừa copy là đã gửi');
  });

  it('does not expose the old Zalo Web receipt controls', () => {
    const html = read('zalo-lead-connector.html');
    expect(html).not.toContain('MỞ ZALO WEB');
    expect(html).not.toContain('/api/zalo-web/open');
    expect(html).toContain('Ảnh demo');
  });

  it('defaults limited auto campaigns to 15 unsent leads', async () => {
    const calls = [];
    const context = loadDashboardContext(async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, queue: { running: true, items: [] } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    });

    vm.runInContext(`
      leads = [
        { id: 'sent', name: 'Da gui', phone: '0912345678', source: 'FB', status: 'CONTACTED', note: '' },
        ...Array.from({ length: 20 }, (_, index) => ({
          id: 'new_' + index,
          name: 'Lead ' + index,
          phone: '091' + String(1000000 + index).padStart(7, '0'),
          source: 'FB',
          status: 'NEW',
          note: ''
        }))
      ];
      document.getElementById('campaign-target-type').value = 'LIMIT';
    `, context);

    await vm.runInContext('startAutoCampaign()', context);

    const body = JSON.parse(calls[0].options.body);
    expect(body.queue).toHaveLength(15);
    expect(body.queue.map((item) => item.id)).toEqual(Array.from({ length: 15 }, (_, index) => 'new_' + index));
  });

  it('skips already contacted leads in limited auto campaigns', async () => {
    const calls = [];
    const context = loadDashboardContext(async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, queue: { running: true, items: [] } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    });

    vm.runInContext(`
      leads = [
        { id: 'sent', name: 'Da gui', phone: '0912345678', source: 'FB', status: 'CONTACTED', note: '' },
        { id: 'new', name: 'Chua gui', phone: '0987654321', source: 'FB', status: 'NEW', note: '' }
      ];
      document.getElementById('campaign-target-type').value = 'LIMIT';
      document.getElementById('campaign-limit-val').value = '2';
    `, context);

    await vm.runInContext('startAutoCampaign()', context);

    const body = JSON.parse(calls[0].options.body);
    expect(body.queue.map((item) => item.id)).toEqual(['new']);
  });

  it('restores missing leads from the latest local backup without duplicating current leads', () => {
    const storage = makeStorage({
      travel_leads_backup: JSON.stringify({
        savedAt: '2026-06-29T00:00:00.000Z',
        leads: [
          { id: 'old_1', name: 'Cu', phone: '0912345678', source: 'FB', status: 'NEW', note: '' },
          { id: 'old_2', name: 'Can khoi phuc', phone: '0987654321', source: 'FB', status: 'NEW', note: '' },
        ],
        templates: {},
      }),
    });
    const context = loadDashboardContext(async () => {
      throw new Error('not used');
    }, { storage, preservePersistence: true });

    vm.runInContext(`
      leads = [{ id: 'current', name: 'Dang co', phone: '0912345678', source: 'FB', status: 'NEW', note: '' }];
      restoreLatestBackup();
    `, context);

    expect(vm.runInContext('leads.map((lead) => lead.phone)', context)).toEqual(['0912345678', '0987654321']);
    expect(context.__toasts.at(-1)?.message).toContain('Khôi phục thêm 1 đối tác');
  });
});
