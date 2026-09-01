import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { runtime } from './harness.js';
let r;
afterEach(async () => { document.body.innerHTML = ''; await r?.close(); });
function setup(saved = {parallelCount:'12'}) {
    r = runtime();
    document.body.innerHTML = '<input id="parallelCount" value="12" max="30"><input id="rpmPerKey" value="15"><input type="checkbox" id="aiStudioSchedulerToggle"><p id="aiStudioSchedulerLimit"></p>';
    r.context.document = document;
    r.load('js/features/ai-studio-scheduler/settings-view.js');
    r.ns.loadConfig(saved); r.ns.refreshSettings();
}
describe('AI Studio opt-in settings', () => {
    it('defaults off and keeps the legacy parallel value', () => {
        setup(); expect(r.ns.isEnabled()).toBe(false);
        expect(document.getElementById('parallelCount').max).toBe('30');
        expect(r.ns.settingsPayload().parallelCount).toBe('12');
    });
    it('keeps the enhanced value separate through OFF and provider switches', () => {
        setup(); r.ns.setEnabled(true);
        const input = document.getElementById('parallelCount'); input.value = '60';
        expect(input.max).toBe('60');
        expect(r.ns.settingsPayload()).toMatchObject({parallelCount:'12',aiStudioScheduler:{enabled:true,parallelCount:60}});
        vm.runInContext('useProxy = true',r.context); r.ns.refreshSettings();
        expect(input.value).toBe('12'); expect(input.max).toBe('30');
        vm.runInContext('useProxy = false',r.context); r.ns.refreshSettings(); expect(input.value).toBe('60');
        r.ns.setEnabled(false); expect(input.value).toBe('12');
    });
    it('restores saved opt-in config and rejects changes during an active run', () => {
        setup({parallelCount:'8',aiStudioScheduler:{enabled:true,parallelCount:60}});
        vm.runInContext('isTranslating = true',r.context); r.ns.refreshSettings();
        r.ns.setEnabled(false); expect(r.ns.isEnabled()).toBe(true);
        expect(document.getElementById('aiStudioSchedulerToggle').disabled).toBe(true);
    });
});
