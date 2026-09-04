import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Key } from 'lucide-react';

import keyManager from '../../services/ai/keyManager.js';
import { PROVIDERS } from '../../services/ai/router.js';
import { KeySection } from '../../pages/Settings/Settings.jsx';

function setControlValue(control, value) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function KeySyncHarness() {
  const [revision, setRevision] = useState(0);
  return (
    <>
      {[1, 2, 3].map((copy) => (
        <KeySection
          key={copy}
          provider={PROVIDERS.OPENAI_PROXY}
          providerLabel={`Custom Proxy ${copy}`}
          icon={Key}
          refreshToken={revision}
          onKeysChange={() => setRevision((value) => value + 1)}
        />
      ))}
    </>
  );
}

describe('Settings duplicate key managers', () => {
  let container;
  let root;

  beforeEach(async () => {
    keyManager.replaceKeys(PROVIDERS.OPENAI_PROXY, []);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<KeySyncHarness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    keyManager.replaceKeys(PROVIDERS.OPENAI_PROXY, []);
  });

  it('synchronizes add, bulk import, and remove across all visible copies', async () => {
    const singleInputs = [...container.querySelectorAll('.key-single-input input')];
    await act(async () => {
      setControlValue(singleInputs[0], 'sk-custom-one');
    });
    await act(async () => container.querySelector('.key-single-input button').click());
    expect([...container.querySelectorAll('.key-section-count')].map((node) => node.textContent))
      .toEqual(['1 keys', '1 keys', '1 keys']);

    await act(async () => [...container.querySelectorAll('.key-toolbar button')]
      .find((button) => button.textContent.includes('Nhập nhiều')).click());
    const textarea = container.querySelector('.bulk-import-area textarea');
    await act(async () => {
      setControlValue(textarea, 'sk-custom-two\nsk-custom-three');
    });
    await act(async () => container.querySelector('.bulk-import-footer button').click());
    expect([...container.querySelectorAll('.key-section-count')].map((node) => node.textContent))
      .toEqual(['3 keys', '3 keys', '3 keys']);

    const secondRemove = container.querySelectorAll('.key-section')[1]
      .querySelector('button[aria-label="Xóa API key số 1"]');
    await act(async () => secondRemove.click());
    expect([...container.querySelectorAll('.key-section-count')].map((node) => node.textContent))
      .toEqual(['2 keys', '2 keys', '2 keys']);
  });
});
