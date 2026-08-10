import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const baseUrl = String(process.env.CLOUD_SYNC_API_URL || '').trim().replace(/\/+$/, '');
const token = String(process.env.CLOUD_SYNC_TEST_ACCESS_TOKEN || '').trim();
const localLoad = process.argv.includes('--local-load');
const performanceMode = process.argv.includes('--performance');
const confirmGc = process.argv.includes('--confirm-gc');

if (!/^https:\/\//iu.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/iu.test(baseUrl)) {
  throw new Error('CLOUD_SYNC_API_URL must be HTTPS or an explicit localhost URL.');
}
if (!token) throw new Error('CLOUD_SYNC_TEST_ACCESS_TOKEN is required.');
if (localLoad && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/iu.test(baseUrl)) {
  throw new Error('--local-load refuses non-local URLs.');
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required with --confirm-gc.`);
  return value;
}

function readTokenSubject(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    const subject = String(payload?.sub || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(subject)) {
      throw new Error('invalid subject');
    }
    return subject;
  } catch {
    throw new Error('CLOUD_SYNC_TEST_ACCESS_TOKEN has no valid UUID subject.');
  }
}

const smokeUserId = confirmGc ? readTokenSubject(token) : '';
const r2Bucket = confirmGc
  ? String(process.env.CLOUD_SYNC_R2_BUCKET || 'storyforge-cloud-sync').trim()
  : '';
const gcClient = confirmGc ? new S3Client({
  region: 'auto',
  endpoint: `https://${requireEnv('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  },
}) : null;

async function waitForGc(objectKey) {
  if (!gcClient) return;
  const deadline = Date.now() + (11 * 60 * 1000);
  while (Date.now() < deadline) {
    try {
      await gcClient.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectKey }));
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error('Synthetic Cloud Sync object was not removed by GC within 11 minutes.');
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index] || 0;
}

function encodePayload(sizeBytes) {
  if (sizeBytes < 2) return new TextEncoder().encode('{}');
  return new TextEncoder().encode(`"${'x'.repeat(sizeBytes - 2)}"`);
}

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(5 * 60 * 1000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(`Cloud Sync HTTP ${response.status}`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response;
}

async function listSnapshots() {
  const startedAt = globalThis.performance.now();
  const response = await api('/cloud-sync/v1/snapshots');
  const payload = await response.json();
  for (const item of Array.isArray(payload.data) ? payload.data : []) {
    if (Object.hasOwn(item, 'objectKey')
      || Object.hasOwn(item, 'r2Etag')
      || Object.hasOwn(item, 'r2Version')) {
      throw new Error('Manifest list exposed internal R2 metadata.');
    }
  }
  return { durationMs: globalThis.performance.now() - startedAt, items: payload.data || [] };
}

async function roundTrip(sizeBytes) {
  const bytes = encodePayload(sizeBytes);
  const payloadSha256 = createHash('sha256').update(bytes).digest('hex');
  const writeId = randomUUID();
  const slug = `codex-smoke-${writeId}`;
  let snapshotId = null;
  let committed = false;
  const startedAt = globalThis.performance.now();
  try {
    const openResponse = await api('/cloud-sync/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writeId,
        scope: 'project',
        itemSlug: slug,
        itemTitle: 'Synthetic Cloud Sync smoke snapshot',
        payloadVersion: 1,
        sourceUpdatedAt: Date.now(),
        sizeBytes: bytes.byteLength,
        payloadSha256,
        metadata: { synthetic: true },
        expectedRevisionId: null,
      }),
    });
    const opened = (await openResponse.json()).data;
    snapshotId = opened.snapshotId;
    const uploadResponse = await api(`/cloud-sync/v1/uploads/${opened.uploadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const manifest = (await uploadResponse.json()).data;
    snapshotId = manifest.id;
    committed = true;

    const downloadResponse = await api(`/cloud-sync/v1/snapshots/${snapshotId}/content`);
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    const downloadedSha256 = createHash('sha256').update(downloaded).digest('hex');
    if (downloaded.byteLength !== bytes.byteLength || downloadedSha256 !== payloadSha256) {
      throw new Error('Synthetic Cloud Sync checksum mismatch.');
    }
    return globalThis.performance.now() - startedAt;
  } finally {
    if (snapshotId && committed) {
      await api(`/cloud-sync/v1/snapshots/${snapshotId}`, { method: 'DELETE' });
      const afterDelete = await listSnapshots();
      if (afterDelete.items.some((item) => item.id === snapshotId)) {
        throw new Error('Synthetic Cloud Sync snapshot still exists after delete.');
      }
      await waitForGc(
        `users/${smokeUserId}/snapshots/project/${snapshotId}/${payloadSha256}.json`,
      );
    }
  }
}

const health = await fetch(`${baseUrl}/cloud-sync/v1/health`, {
  signal: AbortSignal.timeout(20_000),
});
if (!health.ok) throw new Error(`Cloud Sync health failed with ${health.status}.`);

const listDurations = [];
const listRounds = performanceMode ? 20 : 1;
for (let index = 0; index < listRounds; index += 1) {
  const result = await listSnapshots();
  if (result.items.length > 200) throw new Error('Manifest list exceeded 200 items.');
  listDurations.push(result.durationMs);
}

const sizes = localLoad
  ? [1024, 1024 * 1024, 23_590_216, 64 * 1024 * 1024]
  : [1024 * 1024];
const transferDurations = [];
const transferRounds = performanceMode ? 5 : 1;
for (const size of sizes) {
  for (let index = 0; index < transferRounds; index += 1) {
    transferDurations.push({ sizeBytes: size, durationMs: await roundTrip(size) });
  }
}

const report = {
  list: {
    rounds: listDurations.length,
    p95Ms: percentile(listDurations, 95),
    pass: percentile(listDurations, 95) <= 750,
  },
  transfer: sizes.map((sizeBytes) => {
    const values = transferDurations
      .filter((item) => item.sizeBytes === sizeBytes)
      .map((item) => item.durationMs);
    return {
      sizeBytes,
      rounds: values.length,
      p95Ms: percentile(values, 95),
      pass: localLoad || sizeBytes !== 1024 * 1024 || percentile(values, 95) <= 5_000,
    };
  }),
};

process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.list.pass || report.transfer.some((item) => !item.pass)) process.exitCode = 1;
gcClient?.destroy();
