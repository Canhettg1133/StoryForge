import { describe, expect, it } from 'vitest';
import {
  buildSceneMirrorEvent,
  normalizeMirrorText,
} from '../../services/storyMirror/payloadBuilder.js';

describe('story mirror payload builder', () => {
  it('stores only the latest scene text and falls back to final_text when draft_text is blank', async () => {
    const event = await buildSceneMirrorEvent({
      project: {
        id: 11,
        title: 'Dự án thử',
        genre_primary: 'fantasy',
        status: 'active',
        updated_at: 1700000000000,
      },
      chapter: {
        id: 22,
        title: 'Chương 1',
        order_index: 0,
        status: 'draft',
      },
      scene: {
        id: 33,
        title: 'Cảnh mở đầu',
        order_index: 0,
        status: 'draft',
        draft_text: '   ',
        final_text: '<p>Bản cuối</p>',
        updated_at: 1700000000001,
      },
    });

    expect(event.resourceType).toBe('scene.upsert');
    expect(event.project).toMatchObject({
      clientProjectId: '11',
      title: 'Dự án thử',
    });
    expect(event.chapter).toMatchObject({
      clientChapterId: '22',
      title: 'Chương 1',
    });
    expect(event.scene).toMatchObject({
      clientSceneId: '33',
      title: 'Cảnh mở đầu',
      content: '<p>Bản cuối</p>',
    });
    expect(event.scene.contentHash).toMatch(/^sha256:/u);
    expect(JSON.stringify(event)).not.toContain('prompt');
    expect(JSON.stringify(event)).not.toContain('translated');
  });

  it('normalizes empty editor HTML without deleting real Vietnamese content', () => {
    expect(normalizeMirrorText('<p><br></p>', 'Bản dự phòng')).toBe('Bản dự phòng');
    expect(normalizeMirrorText('<p>Tiếng Việt có dấu</p>', '')).toBe('<p>Tiếng Việt có dấu</p>');
  });
});
