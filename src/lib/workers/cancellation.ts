type CancelTimer = ReturnType<typeof setTimeout>;

export interface CancellationRegistry {
  mark: (id: string) => void;
  has: (id: string) => boolean;
  consume: (id: string) => boolean;
  clear: () => void;
  readonly size: number;
}

export function createCancellationRegistry(ttlMs = 60_000): CancellationRegistry {
  const timers = new Map<string, CancelTimer>();

  const clearTimer = (id: string): void => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };

  return {
    mark(id) {
      clearTimer(id);
      timers.set(id, setTimeout(() => timers.delete(id), ttlMs));
    },
    has(id) {
      return timers.has(id);
    },
    consume(id) {
      const cancelled = timers.has(id);
      clearTimer(id);
      return cancelled;
    },
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    get size() {
      return timers.size;
    },
  };
}
