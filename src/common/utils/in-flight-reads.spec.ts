import { InFlightReads } from './in-flight-reads';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('InFlightReads', () => {
  it('shares only overlapping reads and fetches again after completion', async () => {
    const reads = new InFlightReads<string>();
    const first = deferred<string>();
    const load = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue('fresh');
    const a = reads.run('user', load);
    const b = reads.run('user', load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve('old');
    expect(await Promise.all([a, b])).toEqual(['old', 'old']);
    expect(await reads.run('user', load)).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not retain failed reads', async () => {
    const reads = new InFlightReads<string>();
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValue('recovered');
    await expect(reads.run('user', load)).rejects.toThrow('DB down');
    await expect(reads.run('user', load)).resolves.toBe('recovered');
  });

  it('invalidates an older read without letting its completion delete a newer read', async () => {
    const reads = new InFlightReads<string>();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const load = jest
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const oldRead = reads.run('user', load);
    reads.invalidate('user');
    const freshRead = reads.run('user', load);
    old.resolve('old role');
    await oldRead;
    expect(reads.run('user', load)).toBe(freshRead);
    fresh.resolve('new role');
    expect(await freshRead).toBe('new role');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches within TTL, expires, and never publishes an invalidated in-flight read', async () => {
    let now = 0;
    const reads = new InFlightReads<string>(2000, 10, () => now);
    const old = deferred<string>();
    const load = jest
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue('fresh');
    const first = reads.run('user', load);
    await Promise.resolve();
    reads.invalidate('user');
    old.resolve('old');
    await first;
    expect(await reads.run('user', load)).toBe('fresh');
    expect(await reads.run('user', load)).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(2);
    now = 2000;
    await reads.run('user', load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('evicts entries at the configured bound', async () => {
    const reads = new InFlightReads<string>(2000, 1, () => 0);
    const load = jest.fn((key: string) => Promise.resolve(key));
    await reads.run('one', () => load('one'));
    await reads.run('two', () => load('two'));
    await reads.run('one', () => load('one'));
    expect(load).toHaveBeenCalledTimes(3);
  });
});
