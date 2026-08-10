import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildCloudExportManifest,
  readCloudImportManifestFromFile,
  validateCloudExportManifest,
} from '../../services/cloud/cloudBackupService.js';

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111';

function snapshot(overrides = {}) {
  return {
    id: SNAPSHOT_ID,
    scope: 'project',
    itemSlug: 'project-1',
    itemTitle: 'Project 1',
    payloadText: '{"project":1}',
    payloadVersion: 8,
    sourceUpdatedAt: 1,
    sizeBytes: 13,
    metadata: {},
    payloadSha256: 'e2a37efc87b327439b5c3dc324366fa72470c0997b45819f5b4ec8be57c8e138',
    revisionId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('Cloud Sync service R2 integration contracts', () => {
  it('keeps auto-sync and Settings refresh on one combined manifest list', () => {
    const autoSync = readFileSync(
      resolve(process.cwd(), 'src/services/cloud/cloudAutoSyncService.js'),
      'utf8',
    );
    const settings = readFileSync(
      resolve(process.cwd(), 'src/pages/Settings/CloudSyncSection.jsx'),
      'utf8',
    );
    const publicService = readFileSync(
      resolve(process.cwd(), 'src/services/cloud/cloudSyncService.js'),
      'utf8',
    );

    expect(autoSync).toContain('listCloudBackups()');
    expect(autoSync).not.toMatch(/listProjectBackups\(\)|listChatBackups\(\)|listPromptBackups\(\)/u);
    expect(settings).toContain('const items = await listCloudBackups();');
    expect(settings).not.toMatch(/await Promise\.all\(\[\s*listProjectBackups/u);
    expect(settings).not.toContain("from '../../services/cloud/cloudBackupService.js'");
    expect(publicService).toMatch(/export \{[^}]*listCloudBackups/su);
  });

  it('keeps ZIP v2 payload outside manifest while JSON remains self-contained', () => {
    const zipManifest = buildCloudExportManifest([snapshot()], { includePayload: false });
    const jsonManifest = buildCloudExportManifest([snapshot()], { includePayload: true });

    expect(zipManifest._storyforge_version).toBe(2);
    expect(zipManifest.snapshots[0].payload_path).toBe(`snapshots/${SNAPSHOT_ID}.json`);
    expect(zipManifest.snapshots[0]).not.toHaveProperty('payload_text');
    expect(jsonManifest.snapshots[0].payload_text).toBe('{"project":1}');
  });

  it('reads ZIP v2 payload paths and continues accepting legacy JSON manifests', async () => {
    const zipManifest = buildCloudExportManifest([snapshot()], { includePayload: false });
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(zipManifest));
    zip.file(`snapshots/${SNAPSHOT_ID}.json`, snapshot().payloadText);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([bytes], 'cloud.zip', { type: 'application/zip' });

    const hydrated = await readCloudImportManifestFromFile(file);
    expect(hydrated.snapshots[0].payload_text).toBe(snapshot().payloadText);
    expect(validateCloudExportManifest(hydrated)).toHaveLength(1);

    const legacy = {
      _storyforge_version: 1,
      _cloud_export_scope: 'all_snapshots',
      snapshots: [{
        scope: 'chat',
        item_slug: 'chat-1',
        item_title: 'Chat 1',
        payload_text: '{}',
        payload_version: 1,
        source_updated_at: 1,
        size_bytes: 2,
        metadata: {},
      }],
    };
    expect(validateCloudExportManifest(legacy)[0]).toMatchObject({
      scope: 'chat',
      itemSlug: 'chat-1',
      payloadText: '{}',
    });
  });

  it('rejects duplicate ZIP v2 payload paths before importing content', async () => {
    const zipManifest = buildCloudExportManifest([
      snapshot(),
      snapshot({ scope: 'chat', itemSlug: 'chat-1' }),
    ], { includePayload: false });
    zipManifest.snapshots[1].payload_path = zipManifest.snapshots[0].payload_path;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(zipManifest));
    zip.file(`snapshots/${SNAPSHOT_ID}.json`, snapshot().payloadText);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([bytes], 'cloud.zip', { type: 'application/zip' });

    await expect(readCloudImportManifestFromFile(file))
      .rejects.toThrow('đường dẫn snapshot bị trùng');
  });

  it('rejects a ZIP v2 payload path that does not match its snapshot id', async () => {
    const zipManifest = buildCloudExportManifest([snapshot()], { includePayload: false });
    const wrongId = '33333333-3333-4333-8333-333333333333';
    zipManifest.snapshots[0].payload_path = `snapshots/${wrongId}.json`;
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(zipManifest));
    zip.file(`snapshots/${wrongId}.json`, snapshot().payloadText);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([bytes], 'cloud.zip', { type: 'application/zip' });

    await expect(readCloudImportManifestFromFile(file))
      .rejects.toThrow('đường dẫn snapshot không hợp lệ');
  });

  it('rejects a ZIP v2 payload that does not match its manifest checksum', async () => {
    const zipManifest = buildCloudExportManifest([snapshot()], { includePayload: false });
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(zipManifest));
    zip.file(`snapshots/${SNAPSHOT_ID}.json`, '{"corrupt":true}');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([bytes], 'cloud.zip', { type: 'application/zip' });

    await expect(readCloudImportManifestFromFile(file))
      .rejects.toThrow('snapshot sai checksum');
  });
});
