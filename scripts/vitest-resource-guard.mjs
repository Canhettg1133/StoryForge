import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultLockPath() {
  const workspaceKey = createHash('sha256')
    .update(WORKSPACE_ROOT.toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `storyforge-vitest-${workspaceKey}.lock`);
}

function isProcessActive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readLockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function createLock(lockPath, owner) {
  await mkdir(lockPath);
  try {
    await writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(owner), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
}

export async function acquireVitestRunLock({
  lockPath = defaultLockPath(),
  now = Date.now(),
} = {}) {
  const owner = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: now,
    workspace: WORKSPACE_ROOT,
  };

  try {
    await createLock(lockPath, owner);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;

    let existingOwner = await readLockOwner(lockPath);
    if (!existingOwner) {
      await delay(100);
      existingOwner = await readLockOwner(lockPath);
    }

    const lockIsActive = isProcessActive(Number(existingOwner?.pid));
    if (lockIsActive) {
      const activeError = new Error(
        `Một lượt Vitest khác của StoryForge đang chạy (PID ${existingOwner.pid}). `
        + 'Hãy chờ lượt đó kết thúc thay vì chạy chồng.',
      );
      activeError.code = 'STORYFORGE_TEST_RUN_ACTIVE';
      throw activeError;
    }

    await rm(lockPath, { recursive: true, force: true });
    await createLock(lockPath, owner);
  }

  return {
    owner,
    async release() {
      const currentOwner = await readLockOwner(lockPath);
      if (currentOwner?.token === owner.token) {
        await rm(lockPath, { recursive: true, force: true });
      }
    },
  };
}

export default async function setupVitestResourceGuard() {
  const run = await acquireVitestRunLock();
  return async () => run.release();
}
