// A single cancellation contract for timers and animation frames. Aborting rejects
// the awaiting action, so it cannot dispatch a click or apply state after pause.
export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Playback stopped', 'AbortError');
};

export const wait = (durationMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Playback stopped', 'AbortError'));
      return;
    }
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Playback stopped', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, Math.max(0, durationMs));
    signal.addEventListener('abort', abort, { once: true });
  });

export const animate = (
  durationMs: number,
  update: (progress: number, elapsedMs: number) => void,
  signal: AbortSignal
) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Playback stopped', 'AbortError'));
      return;
    }
    const duration = Math.max(0, durationMs);
    const startedAt = performance.now();
    let frameId: number;
    const abort = () => {
      window.cancelAnimationFrame(frameId);
      reject(new DOMException('Playback stopped', 'AbortError'));
    };
    const frame = (now: number) => {
      try {
        const elapsed = Math.max(0, now - startedAt);
        const progress = duration ? Math.min(1, elapsed / duration) : 1;
        update(progress, Math.min(elapsed, duration));
        if (progress < 1) {
          frameId = window.requestAnimationFrame(frame);
        } else {
          signal.removeEventListener('abort', abort);
          resolve();
        }
      } catch (error) {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    frameId = window.requestAnimationFrame(frame);
  });
