import { performance } from 'node:perf_hooks';

/** Share reads; optional bounded TTL is intended for a single service instance. */
export class InFlightReads<T> {
  private readonly pending = new Map<string, Promise<T>>();
  private readonly cached = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 0,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (
      !Number.isFinite(ttlMs) ||
      ttlMs < 0 ||
      !Number.isInteger(maxEntries) ||
      maxEntries < 1
    ) {
      throw new Error('Invalid read cache bounds');
    }
  }

  run(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.cached.get(key);
    if (cached && cached.expiresAt > this.now())
      return Promise.resolve(cached.value);
    this.cached.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;

    const pending = Promise.resolve().then(read);
    this.pending.set(key, pending);
    const release = () => {
      // An invalidated old read must not remove a newer read for this key.
      if (this.pending.get(key) === pending) this.pending.delete(key);
    };
    void pending.then((value) => {
      if (this.pending.get(key) !== pending) return;
      release();
      if (this.ttlMs > 0) {
        if (this.cached.size >= this.maxEntries) {
          const oldest = this.cached.keys().next();
          if (!oldest.done) this.cached.delete(oldest.value);
        }
        this.cached.set(key, { value, expiresAt: this.now() + this.ttlMs });
      }
    }, release);
    return pending;
  }

  invalidate(key: string): void {
    this.pending.delete(key);
    this.cached.delete(key);
  }
}
