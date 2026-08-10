import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';
import { runCloudSyncBackfill } from './cloud-sync-r2-backfill-lib.mjs';

const { Client } = pg;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function checksumBase64ToHex(value) {
  if (!value) return '';
  return Buffer.from(String(value), 'base64').toString('hex');
}

const dryRun = process.argv.includes('--dry-run');
const checkpointPath = path.resolve(
  readArg('--checkpoint') || '.cloud-sync-r2-backfill.checkpoint.json',
);
const maxRowsArg = Number(readArg('--max-rows') || Number.POSITIVE_INFINITY);
const maxRows = Number.isFinite(maxRowsArg) && maxRowsArg > 0
  ? Math.trunc(maxRowsArg)
  : Number.POSITIVE_INFINITY;

const databaseUrl = requireEnv('CLOUD_SYNC_MIGRATION_DATABASE_URL');
const accountId = dryRun ? String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() : requireEnv('CLOUDFLARE_ACCOUNT_ID');
const bucket = String(process.env.CLOUD_SYNC_R2_BUCKET || 'storyforge-cloud-sync').trim();
const database = new Client({ connectionString: databaseUrl });
let s3 = null;

if (!dryRun) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function readCheckpoint() {
  if (!process.argv.includes('--resume')) return null;
  try {
    return JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveCheckpoint(value) {
  const temporaryPath = `${checkpointPath}.next`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, checkpointPath);
}

const databaseAdapter = {
  async fetchNext(afterId) {
    const result = await database.query(
      `select l.id, l.user_id, l.scope, l.item_slug, l.item_title, l.payload_text,
              l.payload_version, l.source_updated_at, l.size_bytes, l.metadata,
              l.created_at, l.updated_at, m.id as manifest_id
       from public.cloud_snapshots l
       left join public.cloud_snapshot_manifests m
         on m.user_id = l.user_id and m.scope = l.scope and m.item_slug = l.item_slug
       where ($1::uuid is null or l.id > $1::uuid)
       order by l.id
       limit 1`,
      [afterId],
    );
    return result.rows[0] || null;
  },
  async commitManifest({ row, objectKey, sizeBytes, payloadSha256 }) {
    const result = await database.query(
      `select public.cloud_sync_backfill_manifest(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13
      ) as value`,
      [
        row.user_id,
        row.manifest_id || row.id,
        row.scope,
        row.item_slug,
        row.item_title,
        row.payload_version,
        Number(row.source_updated_at || 0),
        sizeBytes,
        payloadSha256,
        JSON.stringify(row.metadata || {}),
        objectKey,
        row.created_at,
        row.updated_at,
      ],
    );
    return result.rows[0]?.value || null;
  },
};

const objectStore = dryRun ? {
  head: async () => null,
  put: async () => { throw new Error('Dry-run attempted an R2 write.'); },
  delete: async () => { throw new Error('Dry-run attempted an R2 delete.'); },
} : {
  async head(key) {
    try {
      const result = await s3.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
      return {
        sizeBytes: Number(result.ContentLength || 0),
        payloadSha256: checksumBase64ToHex(result.ChecksumSHA256)
          || String(result.Metadata?.['payload-sha256'] || '').toLowerCase(),
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
      throw error;
    }
  },
  async put(key, bytes, { sizeBytes, payloadSha256 }) {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentLength: sizeBytes,
      ContentType: 'application/json; charset=utf-8',
      ContentMD5: createHash('md5').update(bytes).digest('base64'),
      Metadata: { 'payload-sha256': payloadSha256 },
      IfNoneMatch: '*',
    }));
  },
  async delete(key) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};

try {
  await database.connect();
  const report = await runCloudSyncBackfill({
    database: databaseAdapter,
    objectStore,
    dryRun,
    checkpoint: await readCheckpoint(),
    saveCheckpoint,
    maxRows,
  });
  process.stdout.write(`${JSON.stringify({ dryRun, bucket, ...report })}\n`);
} finally {
  await database.end();
  s3?.destroy();
}
