import { afterEach, describe, expect, it } from 'vitest';
import useCodexJobStore from '../../stores/codexJobStore.js';

describe('Codex job UI store resilience', () => {
  afterEach(() => {
    useCodexJobStore.setState({
      jobs: [],
      loading: false,
      errorCode: '',
    });
  });

  it('fails closed when IndexedDB is unavailable instead of leaking an unhandled rejection', async () => {
    const jobs = await useCodexJobStore.getState().loadJobs(987654321);

    expect(jobs).toEqual([]);
    expect(useCodexJobStore.getState()).toMatchObject({
      jobs: [],
      loading: false,
      errorCode: 'CODEX_JOB_STORE_UNAVAILABLE',
    });
  });
});
