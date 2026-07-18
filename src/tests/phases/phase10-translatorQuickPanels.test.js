import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readFunctionSource(file, functionName) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`Missing function ${functionName}`);

  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not read function ${functionName}`);
}

function createClassList() {
  const values = new Set();
  return {
    contains(name) { return values.has(name); },
    toggle(name, force) {
      if (force === false) values.delete(name);
      else if (force === true || !values.has(name)) values.add(name);
      else values.delete(name);
    },
  };
}

function loadQuickPanelRuntime() {
  const elements = {
    settingsHub: { style: { display: 'none' } },
    historyPanel: { style: { display: 'none' } },
    translationQueuePanel: { style: { display: 'none' } },
    toggleSettingsBtn: { classList: createClassList() },
    toggleHistoryBtn: { classList: createClassList() },
    toggleQueueBtn: { classList: createClassList() },
  };
  const context = {
    closeAllConfigGroups() {},
    renderTranslationQueue() {},
    updateSettingsAccordions() {},
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(selector) {
        return selector === '.history-panel-collapsible' ? elements.historyPanel : null;
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext([
    readFunctionSource('public/translator-runtime/js/ui/settings.js', 'toggleSettingsPanels'),
    readFunctionSource('public/translator-runtime/js/ui/settings.js', 'toggleHistoryPanel'),
    readFunctionSource('public/translator-runtime/js/ui/file-handler.js', 'toggleTranslationQueuePanel'),
  ].join('\n'), context);

  return { context, elements };
}

function expectOnlyPanel(elements, activePanel) {
  const panels = {
    settings: ['settingsHub', 'toggleSettingsBtn'],
    history: ['historyPanel', 'toggleHistoryBtn'],
    queue: ['translationQueuePanel', 'toggleQueueBtn'],
  };
  Object.entries(panels).forEach(([panel, [panelId, buttonId]]) => {
    const isActive = panel === activePanel;
    expect(elements[panelId].style.display).toBe(isActive ? '' : 'none');
    expect(elements[buttonId].classList.contains('is-active')).toBe(isActive);
  });
}

describe('translator quick panels', () => {
  it('keeps Settings, History, and Queue mutually exclusive while allowing the active panel to close', () => {
    const { context, elements } = loadQuickPanelRuntime();

    context.toggleSettingsPanels();
    expectOnlyPanel(elements, 'settings');

    context.toggleHistoryPanel();
    expectOnlyPanel(elements, 'history');

    context.toggleTranslationQueuePanel();
    expectOnlyPanel(elements, 'queue');

    context.toggleTranslationQueuePanel();
    expectOnlyPanel(elements, null);
  });
});
