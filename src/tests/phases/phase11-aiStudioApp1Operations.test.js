import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildCodeAssistHeaders,
  isCloudCodePrivateApiDisabledError,
  isDoneOperationName,
  pickSelectedProjectId,
  selectDefaultCodeAssistTier,
  shouldPollOperation,
} from '../../../docs/ai-studio-relay-connector/App1.tsx';

describe('AI Studio App1 Service Usage operations', () => {
  it('does not commit the OAuth client secret literal in App1 source', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'docs/ai-studio-relay-connector/App1.tsx'),
      'utf8',
    );

    expect(source).not.toContain(['GOC', 'SPX'].join(''));
    expect(source).not.toMatch(/const\s+OAUTH_CLIENT_SECRET\s*=/);
    expect(source).toContain('OAUTH_CLIENT_SECRET_SESSION_KEY');
  });

  it('treats DONE_OPERATION as already completed instead of polling it', () => {
    expect(isDoneOperationName('operations/DONE_OPERATION')).toBe(true);
    expect(isDoneOperationName('projects/demo/operations/DONE_OPERATION')).toBe(true);
    expect(shouldPollOperation({ name: 'operations/DONE_OPERATION' })).toBe(false);
  });

  it('polls real long-running operation names that are not done', () => {
    expect(shouldPollOperation({ name: 'operations/acf.p2-1234567890-abcdef' })).toBe(true);
  });

  it('does not poll operation payloads that are already marked done', () => {
    expect(shouldPollOperation({ name: 'operations/acf.p2-1234567890-abcdef', done: true })).toBe(false);
  });

  it('selects the default Code Assist tier when onboarding is needed', () => {
    expect(selectDefaultCodeAssistTier([
      { id: 'legacy-tier', name: 'Legacy' },
      { id: 'standard-tier', name: 'Standard', isDefault: true },
    ])).toEqual({ id: 'standard-tier', name: 'Standard', isDefault: true });
  });

  it('falls back to the first allowed Code Assist tier when no default is marked', () => {
    expect(selectDefaultCodeAssistTier([
      { id: 'standard-tier', name: 'Standard' },
      { id: 'free-tier', name: 'Free' },
    ])).toEqual({ id: 'standard-tier', name: 'Standard' });
  });

  it('detects Cloud Code Private API disabled errors from Google', () => {
    expect(isCloudCodePrivateApiDisabledError(
      'Cloud Code Private API has not been used in project demo before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/cloudcode-pa.googleapis.com/overview?project=demo',
    )).toBe(true);
    expect(isCloudCodePrivateApiDisabledError('Gemini API quota exceeded')).toBe(false);
  });

  it('does not send X-Goog-User-Project to Cloud Code Private API calls', () => {
    expect(buildCodeAssistHeaders('token-123')).toEqual({
      Authorization: 'Bearer token-123',
      'Content-Type': 'application/json',
    });
    expect(buildCodeAssistHeaders('token-123')).not.toHaveProperty('X-Goog-User-Project');
  });

  it('keeps the newly created project selected after project refresh', () => {
    const projects = [
      { projectId: 'old-project', name: 'Old', lifecycleState: 'ACTIVE' },
      { projectId: 'new-project', name: 'New', lifecycleState: 'ACTIVE' },
    ];

    expect(pickSelectedProjectId(projects, 'new-project', 'old-project')).toBe('new-project');
    expect(pickSelectedProjectId(projects, 'missing-project', 'old-project')).toBe('old-project');
    expect(pickSelectedProjectId(projects, '', '')).toBe('old-project');
  });
});
