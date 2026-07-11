import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLOUD_IMPORT_LIMITS,
  CLOUD_SNAPSHOT_LIMITS,
  validateCloudImportItems,
  validateCloudSnapshotInput,
} from '../../services/cloud/cloudBackupService.js';

describe('Cloud Sync snapshot limits', () => {
  it('counts UTF-8 bytes and rejects payloads over 64 MiB', () => {
    expect(() => validateCloudSnapshotInput({
      itemSlug: 'project-1',
      itemTitle: 'Project',
      payloadText: 'ổ'.repeat((CLOUD_SNAPSHOT_LIMITS.payloadBytes / 2) + 1),
      metadata: {},
    })).toThrowError(expect.objectContaining({ code: 'CLOUD_SNAPSHOT_PAYLOAD_TOO_LARGE' }));
  });

  it('rejects an oversized title and metadata before upload', () => {
    expect(() => validateCloudSnapshotInput({
      itemSlug: 'project-1',
      itemTitle: 'x'.repeat(CLOUD_SNAPSHOT_LIMITS.titleCharacters + 1),
      payloadText: '{}',
      metadata: {},
    })).toThrowError(expect.objectContaining({ code: 'CLOUD_SNAPSHOT_TITLE_TOO_LONG' }));

    expect(() => validateCloudSnapshotInput({
      itemSlug: 'project-1',
      itemTitle: 'Project',
      payloadText: '{}',
      metadata: { value: 'x'.repeat(CLOUD_SNAPSHOT_LIMITS.metadataBytes) },
    })).toThrowError(expect.objectContaining({ code: 'CLOUD_SNAPSHOT_METADATA_TOO_LARGE' }));
  });

  it('validates the whole import and recomputes size_bytes', () => {
    const rows = validateCloudImportItems([{
      scope: 'project',
      itemSlug: 'project-1',
      itemTitle: 'Project',
      payloadText: 'ổ',
      sizeBytes: 1,
      metadata: {},
    }]);

    expect(rows[0].sizeBytes).toBe(new TextEncoder().encode('ổ').length);
    expect(CLOUD_IMPORT_LIMITS.itemCount).toBe(250);
    expect(CLOUD_IMPORT_LIMITS.totalPayloadBytes).toBe(512 * 1024 * 1024);
  });

  it('normalizes database scalar fields before the first import request', () => {
    const [row] = validateCloudImportItems([{
      scope: 'project',
      itemSlug: 'project-1',
      itemTitle: 'Project',
      payloadText: '{}',
      payloadVersion: 'not-a-number',
      sourceUpdatedAt: Number.POSITIVE_INFINITY,
      updatedAt: 'not-a-date',
      metadata: {},
    }]);

    expect(row.payloadVersion).toBe(1);
    expect(row.sourceUpdatedAt).toBe(0);
    expect(row.updatedAt).toBeNull();
  });

  it('keeps matching database constraints out of the aggregate write path', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'docs/supabase-access-control/011_cloud_snapshot_guardrails.sql'),
      'utf8',
    );
    expect(migration).toContain('octet_length(payload_text) <= 67108864');
    expect(migration).toContain('char_length(item_slug) <= 256');
    expect(migration).toContain('char_length(item_title) <= 256');
    expect(migration).toContain('octet_length(metadata::text) <= 65536');
    expect(migration).toContain('size_bytes = octet_length(payload_text)');
    expect(migration).not.toMatch(/create\s+trigger/iu);
  });
});
