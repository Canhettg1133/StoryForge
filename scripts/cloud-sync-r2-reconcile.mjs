import { createHash } from 'node:crypto';
import process from 'node:process';
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';

const { Client } = pg;

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function checksumBase64ToHex(value) {
  return value ? Buffer.from(String(value), 'base64').toString('hex') : '';
}

const database = new Client({ connectionString: requireEnv('CLOUD_SYNC_MIGRATION_DATABASE_URL') });
const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
const bucket = String(process.env.CLOUD_SYNC_R2_BUCKET || 'storyforge-cloud-sync').trim();
const expectedMinimumUsers = Number(process.env.CLOUD_SYNC_EXPECTED_MIN_USERS || 56);
const expectedScopeCount = Number(process.env.CLOUD_SYNC_EXPECTED_SCOPE_COUNT || 3);
if (!Number.isSafeInteger(expectedMinimumUsers) || expectedMinimumUsers < 1
  || !Number.isSafeInteger(expectedScopeCount) || expectedScopeCount < 1) {
  throw new Error('Cloud Sync reconciliation expectations are invalid.');
}
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  },
});

async function one(sql, values = []) {
  const result = await database.query(sql, values);
  return result.rows[0] || {};
}

async function listR2Totals() {
  let continuationToken;
  let count = 0;
  let bytes = 0;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'users/',
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents || []) {
      count += 1;
      bytes += Number(object.Size || 0);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return { count, bytes };
}

async function verifyManifestObjects() {
  const result = await database.query(
    `select object_key, size_bytes, payload_sha256
     from public.cloud_snapshot_manifests
     order by id`,
  );
  let mismatches = 0;
  for (const manifest of result.rows) {
    try {
      const head = await s3.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: manifest.object_key,
      }));
      const checksum = checksumBase64ToHex(head.ChecksumSHA256)
        || String(head.Metadata?.['payload-sha256'] || '').toLowerCase();
      if (Number(head.ContentLength || 0) !== Number(manifest.size_bytes)
        || checksum !== manifest.payload_sha256) {
        mismatches += 1;
      }
    } catch {
      mismatches += 1;
    }
  }
  return mismatches;
}

async function reconcileLegacyRows() {
  let afterId = null;
  const result = {
    identities: 0,
    manifests: 0,
    tombstones: 0,
    mismatches: 0,
  };
  while (true) {
    const query = await database.query(
      `select l.id, l.payload_text, l.updated_at,
              m.size_bytes as manifest_size_bytes, m.payload_sha256 as manifest_sha256,
              t.deleted_at as tombstone_deleted_at
       from public.cloud_snapshots l
       left join public.cloud_snapshot_manifests m
         on m.user_id = l.user_id and m.scope = l.scope and m.item_slug = l.item_slug
       left join public.cloud_snapshot_tombstones t
         on t.user_id = l.user_id and t.scope = l.scope and t.item_slug = l.item_slug
       where ($1::uuid is null or l.id > $1::uuid)
       order by l.id
       limit 1`,
      [afterId],
    );
    const row = query.rows[0];
    if (!row) break;
    result.identities += 1;
    const bytes = Buffer.from(String(row.payload_text || ''), 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifestMatches = Number(row.manifest_size_bytes) === bytes.byteLength
      && row.manifest_sha256 === sha256;
    const tombstoneWins = row.tombstone_deleted_at
      && new Date(row.tombstone_deleted_at).getTime() >= new Date(row.updated_at).getTime();
    if (manifestMatches) result.manifests += 1;
    else if (tombstoneWins) result.tombstones += 1;
    else result.mismatches += 1;
    afterId = row.id;
  }
  return result;
}

try {
  await database.connect();
  const metrics = await one(`
    select
      pg_database_size(current_database())::bigint as database_bytes,
      (select count(*) from public.cloud_snapshot_manifests)::bigint as manifest_count,
      (select coalesce(sum(size_bytes), 0) from public.cloud_snapshot_manifests)::bigint as manifest_bytes,
      (select count(*) from public.cloud_snapshot_uploads where status = 'pending')::bigint as pending_count,
      (select count(*) from public.cloud_snapshot_object_gc where status <> 'completed')::bigint as gc_backlog,
      (select count(distinct user_id) from public.cloud_snapshot_manifests)::bigint as manifest_users,
      (select count(distinct scope) from public.cloud_snapshot_manifests)::bigint as manifest_scopes
  `);
  const legacy = await reconcileLegacyRows();
  const r2 = await listR2Totals();
  const r2IntegrityMismatches = await verifyManifestObjects();
  const report = {
    databaseBytes: Number(metrics.database_bytes),
    manifestCount: Number(metrics.manifest_count),
    manifestBytes: Number(metrics.manifest_bytes),
    pendingCount: Number(metrics.pending_count),
    gcBacklog: Number(metrics.gc_backlog),
    manifestUsers: Number(metrics.manifest_users),
    manifestScopes: Number(metrics.manifest_scopes),
    legacy,
    r2,
    r2IntegrityMismatches,
    expectedMinimumUsers,
    expectedScopeCount,
  };
  report.pass = report.databaseBytes < 475 * 1024 * 1024
    && report.pendingCount === 0
    && report.gcBacklog === 0
    && report.legacy.mismatches === 0
    && report.manifestCount === report.r2.count
    && report.manifestBytes === report.r2.bytes
    && report.r2IntegrityMismatches === 0
    && report.manifestUsers >= expectedMinimumUsers
    && report.manifestScopes === expectedScopeCount;
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await database.end();
  s3.destroy();
}
