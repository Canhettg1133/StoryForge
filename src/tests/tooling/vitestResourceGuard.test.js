/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireVitestRunLock } from '../../../scripts/vitest-resource-guard.mjs';
import vitestConfig from '../../../vitest.config.js';

const temporaryDirectories = [];

async function createLockPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'storyforge-vitest-guard-test-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'run.lock');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Vitest resource guard', () => {
  it('keeps the default test pool capped at two workers', () => {
    expect(vitestConfig.test.maxWorkers).toBe(2);
    expect(vitestConfig.test.minWorkers).toBe(1);
    expect(vitestConfig.test.globalSetup).toContain('./scripts/vitest-resource-guard.mjs');
  });

  it('rejects a second active test run and allows another run after release', async () => {
    const lockPath = await createLockPath();
    const firstRun = await acquireVitestRunLock({ lockPath });

    await expect(acquireVitestRunLock({ lockPath })).rejects.toMatchObject({
      code: 'STORYFORGE_TEST_RUN_ACTIVE',
    });

    await firstRun.release();
    const nextRun = await acquireVitestRunLock({ lockPath });
    await nextRun.release();
  });

  it('recovers a stale lock whose owner process is no longer active', async () => {
    const lockPath = await createLockPath();
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({
      pid: 2147483647,
      token: 'stale-token',
      startedAt: Date.now(),
    }));

    const run = await acquireVitestRunLock({ lockPath });

    expect(run.owner.pid).toBe(process.pid);
    await run.release();
  });
});
