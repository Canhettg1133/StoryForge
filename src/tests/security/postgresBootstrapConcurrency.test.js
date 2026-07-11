import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Postgres bootstrap concurrency', () => {
  it('serializes schema bootstrap across backend processes', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/storage/postgres/bootstrap.js'),
      'utf8',
    );

    expect(source).toContain('withPostgresTransaction');
    expect(source).toContain('pg_advisory_xact_lock($1::bigint)');
    expect(source.indexOf('pg_advisory_xact_lock')).toBeLessThan(source.indexOf('client.query(BOOTSTRAP_SQL)'));
  });
});
