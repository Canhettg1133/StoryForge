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

function makeClassList() {
  const values = new Set();
  return {
    add(...items) {
      items.forEach((item) => values.add(item));
    },
    remove(...items) {
      items.forEach((item) => values.delete(item));
    },
    contains(item) {
      return values.has(item);
    },
    toString() {
      return [...values].join(' ');
    },
  };
}

function makeElement(initial = {}) {
  return {
    value: '',
    textContent: '',
    innerText: '',
    innerHTML: '',
    style: {},
    disabled: false,
    checked: false,
    className: '',
    classList: makeClassList(),
    appendChild() {},
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
}

function loadPhoneEngineContext() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(read('tools/lead-connector-extension/fb-phone-engine.js'), context, {
    filename: 'fb-phone-engine.js',
  });
  return context;
}

function createFacebookElement(text, options = {}) {
  return {
    textContent: text,
    innerText: text,
    role: options.role || '',
    ariaLabel: options.ariaLabel || '',
    alt: options.alt || '',
    title: options.title || '',
    clicked: 0,
    closed: false,
    click() {
      this.clicked += 1;
      if (typeof options.onClick === 'function') options.onClick();
    },
    closest(selector) {
      if (this.role === 'dialog' && selector.includes('[role="dialog"]')) return this;
      if (options.inDialog && selector.includes('[role="dialog"]')) return this;
      if ((this.role === 'article' || options.article) && selector.includes('div[role="article"]')) return this;
      if (this.role === 'navigation' && selector.includes('[role="navigation"]')) return this;
      return null;
    },
    querySelector(selector) {
      if (typeof options.querySelector === 'function') return options.querySelector(selector);
      return null;
    },
    getClientRects() {
      return this.closed ? [] : [1];
    },
    getAttribute(name) {
      if (name === 'aria-label') return this.ariaLabel;
      if (name === 'alt') return this.alt;
      if (name === 'title') return this.title;
      return this[name] || '';
    },
  };
}

function matchesDocumentControl(control, selector) {
  const ariaLabel = control.ariaLabel || (typeof control.getAttribute === 'function' ? control.getAttribute('aria-label') : '');
  if (!ariaLabel) return false;
  if (selector.includes('[role="button"][aria-label]')) return true;
  if (!selector.includes('aria-label')) return false;
  return selector.includes('Close') || selector.includes('Dong') || selector.includes('Đóng') || selector.includes(ariaLabel);
}

function loadFacebookContentContext({ contentElements = [], expandButtons = [], bodyText = '', documentControls = [] } = {}) {
  const sentMessages = [];
  const queryCounts = [];
  const timers = [];
  const dispatchedEvents = [];
  const windowListeners = new Map();
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.5;
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    Math: deterministicMath,
    WeakSet,
    Set,
    RegExp,
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(message) {
          sentMessages.push(message);
        },
      },
    },
    document: {
      title: 'Nhóm Du Lịch | Facebook',
      body: { innerText: bodyText },
      querySelector(selector) {
        if (selector === '[role="main"]' || selector === '[role="feed"]') return null;
        if (selector === '[role="dialog"]') {
          return contentElements.find((element) => element.role === 'dialog' && !element.closed) || null;
        }
        const documentControl = documentControls.find((control) => !control.closed && matchesDocumentControl(control, selector));
        if (documentControl) return documentControl;
        return null;
      },
      querySelectorAll(selector) {
        queryCounts.push(selector);
        if (selector.includes('aria-label')) {
          return documentControls.filter((control) => !control.closed && matchesDocumentControl(control, selector));
        }
        if (selector.includes('[role="button"]') || selector.includes('a[role="link"]')) {
          return expandButtons;
        }
        return contentElements;
      },
      dispatchEvent(event) {
        dispatchedEvents.push(event);
      },
    },
    window: {
      location: { href: 'https://www.facebook.com/groups/test' },
      addEventListener(type, fn) {
        const previous = windowListeners.get(type);
        windowListeners.set(type, previous ? (event) => {
          previous(event);
          fn(event);
        } : fn);
      },
      scrollBy() {},
      getComputedStyle() {
        return { display: 'block', visibility: 'visible' };
      },
      dispatchEvent(event) {
        dispatchedEvents.push(event);
      },
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    MutationObserver: class MutationObserver {
      observe() {}
      disconnect() {}
    },
    __sentMessages: sentMessages,
    __queryCounts: queryCounts,
    __timers: timers,
    __dispatchedEvents: dispatchedEvents,
    __windowListeners: windowListeners,
  };

  vm.createContext(context);
  vm.runInContext(read('tools/lead-connector-extension/fb-phone-engine.js'), context, {
    filename: 'fb-phone-engine.js',
  });
  vm.runInContext(read('tools/lead-connector-extension/content-facebook.js'), context, {
    filename: 'content-facebook.js',
  });
  return context;
}

async function loadBackgroundAndSend(message, tabs, options = {}) {
  let listener;
  const sentMessages = [];
  const queryCalls = [];
  const tabUpdates = [];
  const createdTabs = [];
  const executedScripts = [];
  const timers = [];
  const tabUpdatedListeners = [];
  const storage = options.initialState ? { leadConnectorState: options.initialState } : {};
  const mutableTabs = [...tabs];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    chrome: {
      alarms: {
        create() {},
        clear() {},
        onAlarm: { addListener() {} },
      },
      runtime: {
        lastError: null,
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
        sendMessage() {},
      },
      storage: {
        local: {
          async get(key) {
            return { [key]: storage[key] };
          },
          async set(value) {
            Object.assign(storage, value);
          },
        },
      },
      scripting: {
        async executeScript(details) {
          executedScripts.push(details);
          if (typeof options.onExecuteScript === 'function') options.onExecuteScript(details);
          return [];
        },
      },
      tabs: {
        async query(queryInfo) {
          queryCalls.push(queryInfo);
          if (queryInfo.active) return mutableTabs.filter((tab) => tab.active);
          return mutableTabs;
        },
        async get(tabId) {
          const tab = mutableTabs.find((item) => item.id === tabId);
          if (!tab) throw new Error('No tab');
          return tab;
        },
        async create(createInfo) {
          createdTabs.push(createInfo);
          const tab = { id: options.createdTabId || 909, url: createInfo.url, active: !!createInfo.active, lastAccessed: 1 };
          mutableTabs.push(tab);
          return tab;
        },
        async update(tabId, updateInfo) {
          tabUpdates.push({ tabId, updateInfo });
          const tab = mutableTabs.find((item) => item.id === tabId);
          if (tab) Object.assign(tab, updateInfo);
          return tab || { id: tabId, ...updateInfo };
        },
        async sendMessage(tabId, payload) {
          sentMessages.push({ tabId, payload });
          if (typeof options.onSendMessage === 'function') {
            return options.onSendMessage(tabId, payload, sentMessages.length);
          }
          return { success: true };
        },
        onUpdated: {
          addListener(fn) {
            tabUpdatedListeners.push(fn);
            const tab = mutableTabs.at(-1);
            if (tab) fn(tab.id, { status: 'complete' });
          },
          removeListener(fn) {
            const index = tabUpdatedListeners.indexOf(fn);
            if (index >= 0) tabUpdatedListeners.splice(index, 1);
          },
        },
      },
    },
    __sentMessages: sentMessages,
    __queryCalls: queryCalls,
    __tabUpdates: tabUpdates,
    __createdTabs: createdTabs,
    __executedScripts: executedScripts,
    __timers: timers,
    __storage: storage,
  };

  vm.createContext(context);
  vm.runInContext(read('tools/lead-connector-extension/background.js'), context, {
    filename: 'background.js',
  });

  const response = await new Promise((resolve) => {
    listener(message, null, resolve);
  });

  return { response, sentMessages, queryCalls, tabUpdates, createdTabs, executedScripts, timers, storage, context };
}

async function drainTimers(timers, limit = 50) {
  let count = 0;
  let idleRounds = 0;
  while (count < limit) {
    if (timers.length === 0) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      idleRounds += 1;
      if (idleRounds >= 10 && timers.length === 0) break;
      continue;
    }
    idleRounds = 0;
    count += 1;
    const fn = timers.shift();
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.catch(() => {});
    }
    await Promise.resolve();
  }
  await Promise.resolve();
  await Promise.resolve();
}

function loadDashboardBridgeContext() {
  const dispatchedEvents = [];
  const listeners = new Map();
  const context = {
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    document: {
      documentElement: { setAttribute() {} },
    },
    window: {
      location: { pathname: '/zalo-lead-connector.html' },
      addEventListener(type, fn) {
        const previous = listeners.get(type);
        listeners.set(type, previous ? (event) => {
          previous(event);
          fn(event);
        } : fn);
      },
      dispatchEvent(event) {
        dispatchedEvents.push(event);
      },
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage(data, callback) {
          callback({ success: false, error: 'Không tìm thấy tab Facebook đang active.' });
        },
      },
    },
    __listeners: listeners,
    __dispatchedEvents: dispatchedEvents,
  };

  vm.createContext(context);
  vm.runInContext(read('tools/lead-connector-extension/content-dashboard.js'), context, {
    filename: 'content-dashboard.js',
  });
  return context;
}

function loadDashboardContext() {
  const listeners = new Map();
  const dispatchedEvents = [];
  const elements = new Map([
    ['toast', makeElement()],
    ['toast-message', makeElement()],
    ['fb-scan-status-container', makeElement()],
    ['fb-scan-status-text', makeElement()],
    ['fb-scan-count', makeElement()],
    ['fb-scan-current-url', makeElement()],
    ['fb-scan-post-count', makeElement()],
    ['fb-scan-comment-count', makeElement()],
    ['fb-scan-candidate-count', makeElement()],
    ['fb-scan-valid-count', makeElement()],
    ['fb-scan-rejected-count', makeElement()],
    ['fb-scan-duplicate-count', makeElement()],
    ['fb-scan-last-error', makeElement()],
    ['btn-start-fb-scan', makeElement()],
    ['btn-stop-fb-scan', makeElement()],
    ['fb-autoscroll', makeElement({ checked: true })],
    ['fb-continuous-scan', makeElement({ checked: true })],
    ['fb-scroll-count', makeElement({ value: '20' })],
    ['fb-page-delay', makeElement({ value: '45' })],
  ]);
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    Promise,
    setTimeout() {},
    clearTimeout() {},
    confirm: () => true,
    alert() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      documentElement: { getAttribute: () => null, setAttribute() {} },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
      querySelectorAll: () => [],
      createElement: () => makeElement(),
    },
    window: {
      addEventListener(type, fn) {
        const previous = listeners.get(type);
        listeners.set(type, previous ? (event) => {
          previous(event);
          fn(event);
        } : fn);
      },
      dispatchEvent(event) {
        dispatchedEvents.push(event);
      },
      open() {},
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    __listeners: listeners,
    __elements: elements,
    __dispatchedEvents: dispatchedEvents,
    __toasts: [],
  };

  vm.createContext(context);
  vm.runInContext(extractDashboardScript(), context, {
    filename: 'zalo-lead-connector.html',
  });
  vm.runInContext(`
    renderAll = () => {};
    renderStats = () => {};
    saveToLocalStorage = () => {};
    showToast = (message, type = "success") => {
      globalThis.__toasts.push({ message, type });
    };
  `, context);
  return context;
}

describe('Facebook lead scanner contracts', () => {
  it('loads the Facebook network hook in the page main world before DOM scraping', () => {
    const manifest = JSON.parse(read('tools/lead-connector-extension/manifest.json'));
    const hookScript = manifest.content_scripts.find((entry) => entry.js?.includes('content-facebook-network-hook.js'));

    expect(hookScript).toMatchObject({
      matches: ['https://*.facebook.com/*'],
      js: ['content-facebook-network-hook.js'],
      world: 'MAIN',
      run_at: 'document_start',
    });
  });

  it('normalizes common Vietnamese phone formats from Facebook text', () => {
    const context = loadPhoneEngineContext();
    const phones = vm.runInContext(`
      [
        '0912345678',
        '0912 345 678',
        '0912.345.678',
        '0912-345-678',
        '+84 912 345 678',
        '84 912 345 678'
      ].map((sample) => TravelLeadFbPhoneEngine.extractPhoneCandidates('Liên hệ ' + sample)[0]?.phone)
    `, context);

    expect(phones).toEqual([
      '0912345678',
      '0912345678',
      '0912345678',
      '0912345678',
      '0912345678',
      '0912345678',
    ]);
  });

  it('does not auto-accept ambiguous OCR-like phone text', () => {
    const context = loadPhoneEngineContext();
    const phones = vm.runInContext(`
      [
        'Gọi O912345678',
        'Gọi 09I2345678'
      ].flatMap((sample) => TravelLeadFbPhoneEngine.extractPhoneCandidates(sample).map((item) => item.phone))
    `, context);

    expect(phones).toEqual([]);
  });

  it('does not merge adjacent phone numbers from one Facebook text block', () => {
    const context = loadPhoneEngineContext();
    const phones = vm.runInContext(`
      TravelLeadFbPhoneEngine
        .extractPhoneCandidates('IB 0918323901 0987654321')
        .map((item) => item.phone)
    `, context);

    expect(phones).toEqual(['0918323901', '0987654321']);
  });

  it('accepts comma-separated phone numbers used in Facebook comments', () => {
    const context = loadPhoneEngineContext();
    const phones = vm.runInContext(`
      TravelLeadFbPhoneEngine
        .extractPhoneCandidates('SĐT: 0918,323,901')
        .map((item) => item.phone)
    `, context);

    expect(phones).toEqual(['0918323901']);
  });

  it('extracts many valid phones from a real Facebook travel comment thread', () => {
    const context = loadPhoneEngineContext();
    const phones = vm.runInContext(`
      TravelLeadFbPhoneEngine
        .extractPhoneCandidates(\`
          Lh :fb hoặc zalo hoặc sdt 0766675826
          ib ạ 033.79.68.252 /0397730553
          Contact: 0785952297 (zalo)
          Có thể là hình ảnh về văn bản cho biết 'Tourist Car ... hotline: 0905710109 4-7 chỗ ...'
          Ib mình nha 0788676758 xe vf8 ạ
          SDT 0789 168 194
          Ngày 1 : 700k
          Ngày 2 : 1250k ạ
          Liên hệ e nhé 0357805939
          43H-143.45
          LH: 0931 937 943
        \`)
        .map((item) => item.phone)
    `, context);

    expect(phones).toEqual([
      '0766675826',
      '0337968252',
      '0397730553',
      '0785952297',
      '0905710109',
      '0788676758',
      '0789168194',
      '0357805939',
      '0931937943',
    ]);
  });

  it('scrapes phone numbers from comments inside Facebook dialog containers', () => {
    const dialogComment = createFacebookElement('Mình còn slot, Zalo 0912 345 678 nhé', { role: 'dialog' });
    const context = loadFacebookContentContext({ contentElements: [dialogComment] });

    vm.runInContext('startScanning(false, 5)', context);

    const leadsMessage = context.__sentMessages.find((message) => message.action === 'NEW_FB_LEADS');
    expect(leadsMessage?.leads.map((lead) => lead.phone)).toEqual(['0912345678']);
  });

  it('uses visible body text as a safety net even after targeted nodes find some phones', () => {
    const firstComment = createFacebookElement('Lh zalo 0766675826');
    const context = loadFacebookContentContext({
      contentElements: [firstComment],
      bodyText: [
        'Lh zalo 0766675826',
        'ib ạ 033.79.68.252 /0397730553',
        'SDT 0789 168 194',
        'LH: 0931 937 943',
      ].join('\n'),
    });

    vm.runInContext('startScanning(false, 5)', context);

    const leadsMessage = context.__sentMessages.find((message) => message.action === 'NEW_FB_LEADS');
    expect(leadsMessage?.leads.map((lead) => lead.phone)).toEqual([
      '0766675826',
      '0337968252',
      '0397730553',
      '0789168194',
      '0931937943',
    ]);
  });

  it('scrapes phone numbers from Facebook image OCR alt text', () => {
    const imageOcr = createFacebookElement('', {
      alt: "Có thể là hình ảnh về văn bản cho biết 'hotline: 0905710109 4-7 chỗ'",
    });
    const context = loadFacebookContentContext({ contentElements: [imageOcr] });

    vm.runInContext('startScanning(false, 5)', context);

    const leadsMessage = context.__sentMessages.find((message) => message.action === 'NEW_FB_LEADS');
    expect(leadsMessage?.leads.map((lead) => lead.phone)).toEqual(['0905710109']);
  });

  it('extracts phone numbers from Facebook GraphQL/XHR text loaded by the page', () => {
    const context = loadFacebookContentContext();

    vm.runInContext('startScanning(false, 5)', context);
    const messageHandler = context.__windowListeners.get('message');
    messageHandler({
      source: context.window,
      data: {
        source: 'TRAVEL_LEAD_FB_NETWORK_TEXT',
        url: 'https://www.facebook.com/api/graphql/',
        text: JSON.stringify({
          comments: [
            { body: { text: 'Em co xe 7 cho, zalo 0912 345 678 nhe' } },
            { body: { text: 'Lien he 0987.654.321 de bao gia' } },
          ],
        }),
      },
    });

    const leadsMessages = context.__sentMessages.filter((message) => message.action === 'NEW_FB_LEADS');
    expect(leadsMessages.at(-1)?.leads.map((lead) => lead.phone)).toEqual([
      '0912345678',
      '0987654321',
    ]);
    expect(vm.runInContext('scanMetrics.networkTextCount', context)).toBeGreaterThan(0);
    expect(vm.runInContext('scanMetrics.networkPhoneCount', context)).toBe(2);
  });

  it('clicks visible Facebook comment expansion controls before scraping', () => {
    const expandButton = createFacebookElement('Xem thêm bình luận');
    const context = loadFacebookContentContext({ expandButtons: [expandButton] });

    vm.runInContext('startScanning(false, 5)', context);

    expect(expandButton.clicked).toBeGreaterThan(0);
    expect(context.__sentMessages.some((message) => message.action === 'FB_SCAN_PROGRESS' && message.status === 'EXPANDING_COMMENTS')).toBe(true);
  });

  it('clicks Facebook comment-count controls to open comment threads', () => {
    const commentCountButton = createFacebookElement('35 bình luận');
    const englishCommentCountButton = createFacebookElement('12 comments');
    const plainCommentAction = createFacebookElement('Bình luận');
    const context = loadFacebookContentContext({
      expandButtons: [commentCountButton, englishCommentCountButton, plainCommentAction],
    });

    vm.runInContext('startScanning(false, 5)', context);

    expect(commentCountButton.clicked).toBeGreaterThan(0);
    expect(englishCommentCountButton.clicked).toBeGreaterThan(0);
    expect(plainCommentAction.clicked).toBe(0);
  });

  it('scans and closes Facebook comment dialogs after expanding comments', async () => {
    let dialog;
    const closeButton = createFacebookElement('Dong', {
      ariaLabel: 'Dong',
      onClick() {
        dialog.closed = true;
      },
    });
    dialog = createFacebookElement('Khach can tour, Zalo 0912 345 678 nhe', {
      role: 'dialog',
      querySelector(selector) {
        if (selector.includes('aria-label')) return closeButton;
        return null;
      },
    });
    const expandButton = createFacebookElement('Xem them binh luan');
    const context = loadFacebookContentContext({ contentElements: [dialog], expandButtons: [expandButton] });

    vm.runInContext('startScanning(false, 5)', context);
    await drainTimers(context.__timers);

    const leadsMessage = context.__sentMessages.find((message) => message.action === 'NEW_FB_LEADS');
    expect(leadsMessage?.leads.map((lead) => lead.phone)).toEqual(['0912345678']);
    expect(dialog.closed).toBe(true);
    expect(vm.runInContext('isScanning', context)).toBe(true);
  });

  it('closes Facebook dialogs when the close button is rendered outside the dialog subtree', async () => {
    let dialog;
    const externalCloseButton = createFacebookElement('Close', {
      ariaLabel: 'Close',
      onClick() {
        dialog.closed = true;
      },
    });
    dialog = createFacebookElement('Khach can xe, Zalo 0912 345 678 nhe', { role: 'dialog' });
    const context = loadFacebookContentContext({
      contentElements: [dialog],
      documentControls: [externalCloseButton],
    });

    vm.runInContext('startScanning(false, 5)', context);
    await drainTimers(context.__timers);

    expect(dialog.closed).toBe(true);
    expect(externalCloseButton.clicked).toBeGreaterThan(0);
    expect(vm.runInContext('isScanning', context)).toBe(true);
  });

  it('counts Facebook post articles inside dialogs as posts instead of comments', () => {
    const dialog = createFacebookElement('Hop thoai bai viet', { role: 'dialog' });
    const postArticle = createFacebookElement('Bai viet can xe Da Nang, lien he 0912 345 678', {
      role: 'article',
      inDialog: true,
    });
    const context = loadFacebookContentContext({ contentElements: [dialog, postArticle] });

    vm.runInContext('startScanning(false, 5)', context);

    expect(vm.runInContext('scanMetrics.postCount', context)).toBeGreaterThan(0);
  });

  it('recovers scanning when Facebook dialog cannot be closed by button', async () => {
    const dialog = createFacebookElement('Khong co so moi trong dialog', { role: 'dialog' });
    const expandButton = createFacebookElement('View more comments');
    const context = loadFacebookContentContext({ contentElements: [dialog], expandButtons: [expandButton] });

    vm.runInContext('startScanning(false, 5)', context);
    await drainTimers(context.__timers);

    expect(vm.runInContext('isScanning', context)).toBe(true);
    expect(context.__dispatchedEvents.some((event) => event.type === 'keydown' && event.key === 'Escape')).toBe(true);
    expect(context.__sentMessages.some((message) => message.action === 'FB_SCAN_PROGRESS' && message.status === 'RECOVERING_DIALOG')).toBe(true);
  });

  it('keeps scanning when continuous Facebook mode is enabled', () => {
    const context = loadFacebookContentContext();

    vm.runInContext('startScanning(false, 0); runHumanLikeScroll(999);', context);
    context.__timers.at(-1)();

    expect(vm.runInContext('isScanning', context)).toBe(true);
    expect(context.__sentMessages.some((message) => message.action === 'FB_SCAN_COMPLETED')).toBe(false);
  });

  it('sends current-tab scans to the active Facebook tab instead of the first tab', async () => {
    const inactiveTab = { id: 101, active: false, lastAccessed: 20, url: 'https://www.facebook.com/groups/old' };
    const activeTab = { id: 202, active: true, lastAccessed: 10, url: 'https://www.facebook.com/groups/current' };

    const { sentMessages } = await loadBackgroundAndSend(
      { action: 'START_FB_SCAN', autoScroll: true, scrollCount: 10 },
      [inactiveTab, activeTab],
    );

    expect(sentMessages[0]).toMatchObject({
      tabId: 202,
      payload: { action: 'START_FB_SCAN', autoScroll: true, scrollCount: 10 },
    });
  });

  it('opens Facebook URL queue worker tabs as active so comments render reliably', async () => {
    const { createdTabs, timers } = await loadBackgroundAndSend(
      { action: 'START_FB_URL_QUEUE', urls: ['https://www.facebook.com/groups/tour'], autoScroll: true, scrollCount: 5, pageDelay: 20 },
      [],
    );

    await drainTimers(timers);

    expect(createdTabs[0]).toMatchObject({
      url: 'https://www.facebook.com/groups/tour',
      active: true,
    });
  });

  it('keeps reused Facebook URL queue tabs active when navigating to the next link', async () => {
    const { tabUpdates, timers } = await loadBackgroundAndSend(
      { action: 'START_FB_URL_QUEUE', urls: ['https://www.facebook.com/groups/next'], autoScroll: true, scrollCount: 5, pageDelay: 20 },
      [{ id: 808, url: 'https://www.facebook.com/groups/old', active: false }],
      {
        initialState: {
          fbTabId: 808,
          fbUrlQueue: [],
          fbUrlQueueIndex: -1,
          fbUrlQueueRunning: false,
        },
      },
    );

    await drainTimers(timers);

    expect(tabUpdates[0]).toMatchObject({
      tabId: 808,
      updateInfo: {
        url: 'https://www.facebook.com/groups/next',
        active: true,
      },
    });
  });

  it('pings and injects Facebook content scripts before starting URL queue scans', async () => {
    let injected = false;
    const { sentMessages, executedScripts, timers } = await loadBackgroundAndSend(
      { action: 'START_FB_URL_QUEUE', urls: ['https://www.facebook.com/groups/tour'], autoScroll: true, scrollCount: 5, pageDelay: 20 },
      [],
      {
        onSendMessage(_tabId, payload) {
          if (payload.action === 'PING' && !injected) throw new Error('Receiving end does not exist.');
          return { success: true };
        },
        onExecuteScript() {
          injected = true;
        },
      },
    );

    await drainTimers(timers);

    expect(sentMessages.map((item) => item.payload.action)).toContain('PING');
    expect(executedScripts[0]).toMatchObject({
      files: ['content-facebook-network-hook.js'],
      world: 'MAIN',
    });
    expect(executedScripts[1]?.files).toEqual(['fb-phone-engine.js', 'content-facebook.js']);
    expect(sentMessages.at(-1)?.payload).toMatchObject({ action: 'START_FB_SCAN' });
  });

  it('forwards extension command failures back to the dashboard page', () => {
    const context = loadDashboardBridgeContext();
    const outbound = context.__listeners.get('LEAD_CONNECTOR_TO_EXT');

    outbound({ detail: { action: 'START_FB_SCAN' } });

    const failureEvent = context.__dispatchedEvents.find(
      (event) => event.type === 'LEAD_CONNECTOR_FROM_EXT' && event.detail?.action === 'EXTENSION_COMMAND_FAILED',
    );
    expect(failureEvent?.detail).toMatchObject({
      requestAction: 'START_FB_SCAN',
      error: 'Không tìm thấy tab Facebook đang active.',
    });
  });

  it('renders Facebook scan metrics and Vietnamese failure status in the dashboard', () => {
    const context = loadDashboardContext();
    const handler = context.__listeners.get('LEAD_CONNECTOR_FROM_EXT');

    handler({
      detail: {
        action: 'FB_SCAN_PROGRESS',
        status: 'SCANNING',
        currentUrl: 'https://www.facebook.com/groups/tour',
        metrics: {
          postCount: 7,
          commentCount: 19,
          rawCandidateCount: 5,
          validPhoneCount: 3,
          rejectedCount: 2,
        },
      },
    });

    expect(context.__elements.get('fb-scan-post-count').textContent).toBe('7');
    expect(context.__elements.get('fb-scan-comment-count').textContent).toBe('19');
    expect(context.__elements.get('fb-scan-valid-count').textContent).toBe('3');
    expect(context.__elements.get('fb-scan-current-url').textContent).toContain('/groups/tour');

    handler({
      detail: {
        action: 'EXTENSION_COMMAND_FAILED',
        requestAction: 'START_FB_SCAN',
        error: 'Không tìm thấy tab Facebook đang active.',
      },
    });

    expect(context.__elements.get('fb-scan-status-text').textContent).toContain('Lỗi');
    expect(context.__elements.get('fb-scan-last-error').textContent).toContain('Không tìm thấy tab Facebook');
    expect(context.__toasts.at(-1)).toMatchObject({ type: 'error' });
  });
  it('reports duplicate Facebook leads instead of silently skipping them', () => {
    const context = loadDashboardContext();
    const handler = context.__listeners.get('LEAD_CONNECTOR_FROM_EXT');
    vm.runInContext(`
      leads = [{
        id: 'existing',
        name: 'Da co',
        phone: '0912345678',
        source: 'Facebook',
        status: 'NEW',
        note: 'FB: old',
        createdAt: new Date().toISOString()
      }];
    `, context);

    handler({
      detail: {
        action: 'INCOMING_FB_LEADS',
        leads: [
          { name: 'Trung', phone: '0912345678', source: 'Facebook', note: 'FB: duplicate' },
          { name: 'Moi', phone: '0987654321', source: 'Facebook', note: 'FB: new' },
        ],
      },
    });

    const phones = vm.runInContext('leads.map((lead) => lead.phone)', context);
    expect(phones).toEqual(['0912345678', '0987654321']);
    expect(context.__elements.get('fb-scan-duplicate-count').textContent).toBe('1');
    expect(context.__toasts.at(-1)?.message).toContain('bỏ qua 1 số trùng');
  });

  it('starts Facebook scans in continuous mode by default', () => {
    const context = loadDashboardContext();

    vm.runInContext('isExtensionInstalled = true; fbScanMode = "CURRENT"; startFbScan();', context);

    const scanEvent = context.__dispatchedEvents.find(
      (event) => event.type === 'LEAD_CONNECTOR_TO_EXT' && event.detail?.action === 'START_FB_SCAN',
    );
    expect(scanEvent?.detail).toMatchObject({
      autoScroll: true,
      continuousScan: true,
      scrollCount: 0,
    });
  });
});
