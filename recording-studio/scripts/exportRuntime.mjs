export const installExportStabilityGuards = async (context) => {
  await context.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const isViteHmrSocket = (url, protocols) => {
      const protocolList = Array.isArray(protocols)
        ? protocols
        : [protocols].filter(Boolean);
      if (
        protocolList.some(
          (protocol) => String(protocol).toLowerCase() === 'vite-hmr'
        )
      )
        return true;
      try {
        const parsed = new URL(String(url), window.location.href);
        return (
          parsed.pathname.includes('/@vite') ||
          parsed.pathname.includes('vite-hmr')
        );
      } catch {
        return (
          String(url).includes('/@vite') || String(url).includes('vite-hmr')
        );
      }
    };

    class BlockedViteWebSocket extends EventTarget {
      static CONNECTING = NativeWebSocket.CONNECTING;

      static OPEN = NativeWebSocket.OPEN;

      static CLOSING = NativeWebSocket.CLOSING;

      static CLOSED = NativeWebSocket.CLOSED;

      binaryType = 'blob';

      bufferedAmount = 0;

      extensions = '';

      onclose = null;

      onerror = null;

      onmessage = null;

      onopen = null;

      protocol = '';

      readyState = NativeWebSocket.CONNECTING;

      url;

      constructor(url) {
        super();
        this.url = String(url);
        window.setTimeout(() => {
          // An inert open connection suppresses reloads without provoking Vite's
          // reconnect/error loop throughout the recording.
          this.readyState = NativeWebSocket.OPEN;
          const event = new Event('open');
          this.dispatchEvent(event);
          if (typeof this.onopen === 'function') this.onopen(event);
        }, 0);
      }

      close() {
        this.readyState = NativeWebSocket.CLOSED;
      }

      send() {}
    }

    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        if (isViteHmrSocket(args[0], args[1])) {
          console.warn(
            '[walkthrough-export] Blocked Vite HMR websocket during export.'
          );
          return new BlockedViteWebSocket(args[0]);
        }
        return Reflect.construct(Target, args);
      },
    });

    window.__moonshotWalkthroughExportStable = true;
  });
};

export const installPageTemporalSupersampling = async (page, timeScale) => {
  if (!Number.isFinite(timeScale) || timeScale <= 1) return;
  await page.evaluate((scale) => {
    const windowKey = '__moonshotWalkthroughTemporalSupersampling';
    const existing = window[windowKey];
    if (existing?.scale === scale) return;
    existing?.restore?.();

    const nativeDateNow = Date.now.bind(Date);
    const nativePerformanceNow = performance.now.bind(performance);
    const nativeRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const realStartedAt = nativePerformanceNow();
    const dateStartedAt = nativeDateNow();
    const adjustedAnimations = new WeakSet();
    let animationFrameId;
    let active = true;

    const scaledPerformanceNow = () =>
      realStartedAt + (nativePerformanceNow() - realStartedAt) / scale;
    const scaledDateNow = () =>
      Math.round(dateStartedAt + (nativeDateNow() - dateStartedAt) / scale);
    const getScaledDelay = (delay) => {
      const numericDelay = Number(delay);
      return Number.isFinite(numericDelay)
        ? Math.max(0, numericDelay * scale)
        : delay;
    };

    Date.now = scaledDateNow;
    try {
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: scaledPerformanceNow,
      });
    } catch {
      // Some browsers expose performance.now as non-configurable; rAF timestamps are still scaled below.
    }

    window.requestAnimationFrame = (callback) =>
      nativeRequestAnimationFrame(() => {
        callback(scaledPerformanceNow());
      });
    window.cancelAnimationFrame = nativeCancelAnimationFrame;
    window.setTimeout = (handler, delay, ...args) =>
      nativeSetTimeout(handler, getScaledDelay(delay), ...args);
    window.clearTimeout = nativeClearTimeout;
    window.setInterval = (handler, delay, ...args) =>
      nativeSetInterval(handler, getScaledDelay(delay), ...args);
    window.clearInterval = nativeClearInterval;

    const slowPageAnimations = () => {
      if (!active) return;
      document.getAnimations?.({ subtree: true })?.forEach((animation) => {
        if (adjustedAnimations.has(animation)) return;
        adjustedAnimations.add(animation);
        try {
          animation.updatePlaybackRate((animation.playbackRate || 1) / scale);
        } catch {
          // Keep export running even if a browser animation object rejects playback-rate updates.
        }
      });
      animationFrameId = nativeRequestAnimationFrame(slowPageAnimations);
    };
    slowPageAnimations();

    window[windowKey] = {
      nativeSetTimeout,
      restore: () => {
        active = false;
        if (animationFrameId) nativeCancelAnimationFrame(animationFrameId);
        Date.now = nativeDateNow;
        try {
          Object.defineProperty(performance, 'now', {
            configurable: true,
            value: nativePerformanceNow,
          });
        } catch {
          // Leave the browser default in place.
        }
        window.requestAnimationFrame = nativeRequestAnimationFrame;
        window.cancelAnimationFrame = nativeCancelAnimationFrame;
        window.setTimeout = nativeSetTimeout;
        window.clearTimeout = nativeClearTimeout;
        window.setInterval = nativeSetInterval;
        window.clearInterval = nativeClearInterval;
      },
      scale,
    };
    console.log(
      `[walkthrough-export] Temporal supersampling time scale ${scale}x installed.`
    );
  }, timeScale);
};
