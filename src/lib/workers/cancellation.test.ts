import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCancellationRegistry } from './cancellation';

afterEach(() => {
  vi.useRealTimers();
});

describe('cancellation registry', () => {
  it('consumes a cancellation exactly once', () => {
    vi.useFakeTimers();
    const registry = createCancellationRegistry(1000);
    registry.mark('job');
    expect(registry.has('job')).toBe(true);
    expect(registry.consume('job')).toBe(true);
    expect(registry.consume('job')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('expires cancellations that never receive a matching job', () => {
    vi.useFakeTimers();
    const registry = createCancellationRegistry(10);
    registry.mark('orphan');
    expect(registry.size).toBe(1);
    vi.advanceTimersByTime(11);
    expect(registry.has('orphan')).toBe(false);
    expect(registry.size).toBe(0);
  });
});
