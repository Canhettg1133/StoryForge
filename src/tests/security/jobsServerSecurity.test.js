import { describe, expect, it } from 'vitest';

import { JOB_CONFIG } from '../../services/jobs/config.js';
import {
  isJobOriginAllowed,
  validateJobServerSecurity,
} from '../../services/jobs/server.js';

describe('jobs local backend security', () => {
  it('defaults to localhost-only bind and explicit local CORS origins', () => {
    expect(JOB_CONFIG.BIND_HOST).toBe('127.0.0.1');
    expect(JOB_CONFIG.ALLOWED_ORIGINS).toContain('http://localhost:5173');
    expect(JOB_CONFIG.ALLOWED_ORIGINS).not.toContain('*');
    expect(isJobOriginAllowed('', JOB_CONFIG.ALLOWED_ORIGINS)).toBe(true);
    expect(isJobOriginAllowed('http://localhost:5173', JOB_CONFIG.ALLOWED_ORIGINS)).toBe(true);
    expect(isJobOriginAllowed('https://evil.example', JOB_CONFIG.ALLOWED_ORIGINS)).toBe(false);
  });

  it('rejects exposed bind hosts unless token and origin allowlist are configured', () => {
    expect(() => validateJobServerSecurity({
      host: '0.0.0.0',
      apiToken: '',
      allowedOriginsConfigured: true,
    })).toThrow('JOB_API_TOKEN');

    expect(() => validateJobServerSecurity({
      host: '0.0.0.0',
      apiToken: 'job-token',
      allowedOriginsConfigured: false,
    })).toThrow('JOB_ALLOWED_ORIGINS');

    expect(() => validateJobServerSecurity({
      host: '0.0.0.0',
      apiToken: 'job-token',
      allowedOriginsConfigured: true,
    })).not.toThrow();
  });
});
