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
  if (!match) {
    throw new Error('Cannot find dashboard inline script');
  }
  return match[1];
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
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      },
    },
    appendChild() {},
    click() {},
    focus() {},
    ...initial,
  };
}

function loadDashboardContext() {
  const elements = new Map([
    ['raw-text-input', makeElement()],
    ['default-source', makeElement({ value: 'Facebook Group' })],
    ['default-name', makeElement({ value: 'Partner' })],
    ['toast', makeElement()],
    ['toast-message', makeElement()],
  ]);

  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    setTimeout() {},
    clearTimeout() {},
    confirm: () => true,
    alert() {},
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    document: {
      documentElement: {
        getAttribute: () => null,
        setAttribute() {},
      },
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, makeElement());
        }
        return elements.get(id);
      },
      querySelectorAll: () => [],
      createElement: () => makeElement(),
    },
    window: {
      addEventListener() {},
      dispatchEvent() {},
      open() {},
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    __elements: elements,
    __toasts: [],
  };

  vm.createContext(context);
  vm.runInContext(extractDashboardScript(), context, {
    filename: 'zalo-lead-connector.html',
  });
  vm.runInContext(`
    renderAll = () => {};
    saveToLocalStorage = () => {};
    showToast = (message, type = "success") => {
      globalThis.__toasts.push({ message, type });
    };
  `, context);

  return context;
}

describe('Zalo lead connector contracts', () => {
  it('extracts only valid Vietnamese mobile numbers from pasted dashboard text', () => {
    const context = loadDashboardContext();
    context.__elements.get('raw-text-input').value = [
      'Ma don hang 0123456789 khong phai so di dong hop le.',
      'Lien he Zalo 0912 345 678 de tu van.',
    ].join('\n');

    vm.runInContext('processExtraction()', context);

    expect(vm.runInContext('leads.map((lead) => lead.phone)', context)).toEqual([
      '0912345678',
    ]);
  });

  it('compiles the selected message template exactly for the target lead', () => {
    const context = loadDashboardContext();

    const compiled = vm.runInContext(`
      compileTemplate(
        "Chao {ten}\\nSDT: {sdt}\\nNguon: {nguon}\\nGhi chu: {ghichu}",
        { name: "Lan", phone: "0912345678", source: "FB Tour", note: "uu tien" }
      )
    `, context);

    expect(compiled).toBe('Chao Lan\nSDT: 0912345678\nNguon: FB Tour\nGhi chu: uu tien');
  });

  it('does not click the first generic Zalo search result without matching the target phone', () => {
    const source = read('tools/lead-connector-extension/content-zalo.js');

    expect(source).not.toMatch(
      /for\s*\(const selector of searchResultSelectors\)\s*\{[\s\S]*?document\.querySelector\(selector\)[\s\S]*?resultItem\.click\(\)/,
    );
  });

  it('keeps Zalo message insertion self-contained', () => {
    const source = read('tools/lead-connector-extension/content-zalo.js');

    expect(source).not.toContain('richInput.innerHTML = formattedMessage');
  });

  it('does not report Zalo send success from a fixed wait alone', () => {
    const source = read('tools/lead-connector-extension/content-zalo.js');

    expect(source).not.toMatch(
      /await delay\(2000\);[\s\S]{0,240}action: "LEAD_SENT_SUCCESS"/,
    );
    expect(source).toContain('waitForMessageInputCleared(richInput)');
  });

  it('limits dashboard extension bridge access to the lead connector page', () => {
    const manifest = read('tools/lead-connector-extension/manifest.json');
    const dashboardBridge = read('tools/lead-connector-extension/content-dashboard.js');
    const background = read('tools/lead-connector-extension/background.js');

    expect(manifest).not.toContain('"file:///*"');
    expect(manifest).not.toContain('"http://localhost/*"');
    expect(manifest).not.toContain('"http://127.0.0.1/*"');
    expect(manifest).toContain('zalo-lead-connector.html');
    expect(dashboardBridge).toContain('isLeadConnectorDashboardPage');
    expect(dashboardBridge).toContain('if (!isDashboardPage) return;');
    expect(background).not.toContain('tab.url.includes("localhost")');
  });

  it('persists Zalo queue timing state so MV3 worker wakeups can resume safely', () => {
    const background = read('tools/lead-connector-extension/background.js');

    expect(background).toContain('awaitingLeadResult');
    expect(background).toContain('nextRunAt');
    expect(background).toContain('leadDeadlineAt');
    expect(background).toContain('Date.now() >= state.nextRunAt');
    expect(background).toContain('Date.now() >= state.leadDeadlineAt');
  });
});
