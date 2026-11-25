import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resolveCursorSettings } from './cursorSettings';
import { StyleSheetManager } from 'styled-components';
import { getPlaybackCursorShape } from './cursorGeometry';
import { animate, throwIfAborted } from './playbackClock';
import { ViewportOverlay } from './ViewportOverlay';
import { CursorGraphic } from './CursorGraphic';
import {
  applyWalkthroughEmbeddedAppState,
  restoreWalkthroughTimelineBoundary,
} from './actionEffects';
import {
  clearWalkthroughHoverEffectsState,
  setWalkthroughHoverEffectsEnabled,
} from './hoverEffects';
import { WALKTHROUGH_EVENTS } from './config';
import {
  easeInOutCubic,
  easePointer,
  getMoveDuration,
  createDistancePath,
  getTypingDelays,
  getArcControls,
  getCircleSeed,
  getIrregularOvalPoint,
  interpolateCubicBezier,
  wait,
} from './motion';
import { plan as defaultPlan } from './plan';
import {
  Caption,
  ClickPulse,
  GlobalHoverEffectStyle,
  PlayerCursor,
  PlayerOverlay,
} from './styles';
import { restoreWalkthroughAppState } from './stateSnapshot';
import {
  dispatchHoverStartForAction,
  dispatchPointerEvent,
  focusElement,
  getActionPoint,
  getClickElement,
  getTargetElement,
  setNativeInputValue,
} from './targeting';
import type { WalkthroughAction, WalkthroughPlayerOptions } from './types';
import { flattenPlanFrames } from './workflow';

const HOVER_REINFORCE_DELAY_MS = 180;
const MIN_HOVER_DWELL_MS = 1400;
const COMPLETION_HOLD_MS = 2200;
const FINAL_HOVER_COMPLETION_HOLD_MS = 2600;

export const WalkthroughPlayer = (props: WalkthroughPlayerOptions) => {
  const {
    active,
    onActionStart,
    onComplete,
    plan: customPlan,
    showCaptions = true,
    speed = 1,
    startFrameIndex = 0,
    strict = false,
  } = props;
  const playbackPlan = customPlan || defaultPlan;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const [cursor, setCursor] = useState({
    clicking: false,
    pointer: false,
    visible: false,
    x: playbackPlan.start.x,
    y: playbackPlan.start.y,
  });
  const cursorSettings = useMemo(
    () => resolveCursorSettings(playbackPlan.cursor),
    [playbackPlan.cursor]
  );
  const [caption, setCaption] = useState('');
  const [clickPulse, setClickPulse] = useState<
    { id: number; x: number; y: number } | undefined
  >(undefined);
  const cursorElementRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef(cursor);
  const clickPulseIdRef = useRef(0);
  const hoverEffectsEnabledRef = useRef(true);

  const scaleDuration = useMemo(
    () => (durationMs: number) => Math.max(0, durationMs) / safeSpeed,
    [safeSpeed]
  );

  const writeCursorElementStyle = useCallback(
    (nextCursor: typeof cursor) => {
      const element = cursorElementRef.current;
      if (!element) return;
      element.style.setProperty('--walkthrough-cursor-x', `${nextCursor.x}px`);
      element.style.setProperty('--walkthrough-cursor-y', `${nextCursor.y}px`);
      element.style.opacity = nextCursor.visible
        ? String(cursorSettings.opacity)
        : '0';
    },
    [cursorSettings.opacity]
  );

  useLayoutEffect(() => {
    writeCursorElementStyle(cursorRef.current);
  });

  useEffect(() => {
    if (!active) return undefined;

    const controller = new AbortController();
    const { signal } = controller;
    const playbackToken = Symbol('walkthrough-playback');
    const playbackWindow = window as Window & {
      __moonshotWalkthroughPlaybackToken?: symbol;
    };
    playbackWindow.__moonshotWalkthroughPlaybackToken = playbackToken;
    const isCurrentPlayback = () =>
      !signal.aborted &&
      playbackWindow.__moonshotWalkthroughPlaybackToken === playbackToken;
    let errorEmitted = false;
    hoverEffectsEnabledRef.current = true;
    setWalkthroughHoverEffectsEnabled(true);

    const frames = flattenPlanFrames(playbackPlan);

    const getCursorStartPoint = (action?: WalkthroughAction) => {
      if (
        !action ||
        action.type === 'scroll' ||
        action.type === 'wait' ||
        action.type === 'tooltip' ||
        action.type === 'state'
      ) {
        return {
          x: cursorRef.current.visible
            ? cursorRef.current.x
            : playbackPlan.start.x,
          y: cursorRef.current.visible
            ? cursorRef.current.y
            : playbackPlan.start.y,
        };
      }
      return getActionPoint(action);
    };

    const emitWalkthroughError = (
      message: string,
      action?: WalkthroughAction
    ) => {
      if (!errorEmitted) {
        errorEmitted = true;
        window.dispatchEvent(
          new CustomEvent(WALKTHROUGH_EVENTS.error, {
            detail: {
              action,
              message,
            },
          })
        );
      }
    };

    const failAction = (message: string, action?: WalkthroughAction) => {
      emitWalkthroughError(message, action);
      if (strict) {
        throw new Error(message);
      }
    };

    const syncCursor = (nextCursor: typeof cursor, _followHover = true) => {
      const previousCursor = cursorRef.current;
      const nextResolvedCursor = {
        ...nextCursor,
        pointer: false,
      };
      cursorRef.current = nextResolvedCursor;
      writeCursorElementStyle(nextResolvedCursor);
      if (
        !cursorElementRef.current ||
        previousCursor.clicking !== nextResolvedCursor.clicking ||
        previousCursor.pointer !== nextResolvedCursor.pointer ||
        previousCursor.visible !== nextResolvedCursor.visible
      ) {
        setCursor(nextResolvedCursor);
      }
    };

    const animateCursorTo = async (
      x: number,
      y: number,
      durationMs?: number,
      mode: 'arc' | 'direct' = 'arc'
    ) => {
      const start = cursorRef.current;
      const end = { x, y };
      const { controlA, controlB } = getArcControls(start, end);
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const duration = getMoveDuration(distance, playbackPlan.defaults.moveDurationMs, durationMs) / safeSpeed;
      const path = createDistancePath(Array.from({ length: 41 }, (_, i) =>
        interpolateCubicBezier(start, controlA, controlB, end, i / 40)));
      if (distance < 0.5 && durationMs === undefined) {
        syncCursor({ ...cursorRef.current, x, y, visible: true });
        return;
      }
      await animate(
        duration,
        (progress) => {
          const eased = easePointer(progress);
          const point =
            mode === 'direct'
              ? {
                  x: start.x + (end.x - start.x) * eased,
                  y: start.y + (end.y - start.y) * eased,
                }
              : path.at(eased);
          syncCursor({
            clicking: false,
            pointer: false,
            visible: true,
            x: point.x,
            y: point.y,
          });
        },
        signal
      );
    };

    const getBoundedScrollTop = (targetTop: number) => {
      const maxScrollTop = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight
      );
      return Math.max(0, Math.min(targetTop, maxScrollTop));
    };

    const animateScrollTo = async (
      rawTargetTop: number,
      durationMs = playbackPlan.defaults.scrollDurationMs
    ) => {
      const targetTop = getBoundedScrollTop(rawTargetTop);
      const startTop = window.scrollY;
      const delta = targetTop - startTop;
      if (Math.abs(delta) < 1) return;

      // Native scrolling preserves sticky/fixed elements and target geometry.
      const root = document.documentElement;
      const previousBehavior = root.style.getPropertyValue('scroll-behavior');
      const previousPriority =
        root.style.getPropertyPriority('scroll-behavior');
      root.style.setProperty('scroll-behavior', 'auto', 'important');
      try {
        await animate(
          scaleDuration(durationMs),
          (progress) => {
            window.scrollTo(0, startTop + delta * easeInOutCubic(progress));
          },
          signal
        );
      } finally {
        if (previousBehavior)
          root.style.setProperty(
            'scroll-behavior',
            previousBehavior,
            previousPriority
          );
        else root.style.removeProperty('scroll-behavior');
      }
    };

    const restoreStateForFrame = async (frameIndex: number) => {
      const frame = frames[frameIndex];
      if (!frame || !isCurrentPlayback()) return;
      clearWalkthroughHoverEffectsState({ disableEffects: false });
      const actions = frames.map((item) => item.action);
      await restoreWalkthroughTimelineBoundary({
        actions,
        index: frameIndex,
        setTooltipEnabled: (enabled) => {
          hoverEffectsEnabledRef.current = enabled;
          setWalkthroughHoverEffectsEnabled(enabled);
        },
        signal,
      });
      if (!isCurrentPlayback()) return;
      await wait(100, signal);
    };

    const runAction = async (action: WalkthroughAction) => {
      throwIfAborted(signal);
      const pauseMs = action.pauseMs ?? playbackPlan.defaults.pauseMs;
      if (action.type !== 'hover') {
        clearWalkthroughHoverEffectsState({ disableEffects: false });
      }

      if (action.type === 'wait') {
        await wait(scaleDuration(action.durationMs ?? pauseMs), signal);
        await applyWalkthroughEmbeddedAppState(action, signal);
        return;
      }

      if (action.type === 'scroll') {
        if (!isCurrentPlayback()) return;
        if (typeof action.scrollTop === 'number') {
          await animateScrollTo(
            Math.max(0, action.scrollTop),
            action.durationMs
          );
          await applyWalkthroughEmbeddedAppState(action, signal);
          await wait(scaleDuration(pauseMs), signal);
          return;
        }
        const element = getTargetElement(action.target);
        if (!element) {
          failAction(
            `Missing walkthrough target "${
              action.target || '(none)'
            }" for scroll action.`,
            action
          );
          return;
        }
        const rect = element.getBoundingClientRect();
        const absoluteTop = rect.top + window.scrollY;
        const block = action.block || 'center';
        const viewportOffset =
          block === 'start'
            ? 24
            : block === 'end'
            ? window.innerHeight - rect.height - 24
            : (window.innerHeight - rect.height) / 2;
        await animateScrollTo(
          Math.max(0, absoluteTop - viewportOffset + (action.offsetY || 0)),
          action.durationMs
        );
        await applyWalkthroughEmbeddedAppState(action, signal);
        await wait(scaleDuration(pauseMs), signal);
        return;
      }

      if (action.type === 'tooltip') {
        const enabled = action.enabled !== false;
        hoverEffectsEnabledRef.current = enabled;
        setWalkthroughHoverEffectsEnabled(enabled);
        await applyWalkthroughEmbeddedAppState(action, signal);
        await wait(scaleDuration(pauseMs), signal);
        return;
      }

      if (action.type === 'state') {
        await restoreWalkthroughAppState(action.appState, signal);
        await wait(scaleDuration(pauseMs), signal);
        return;
      }

      const point = getActionPoint(action);
      if (!point) {
        if (action.type === 'hover' || action.type === 'circle') {
          console.warn(
            `Skipped unresolved walkthrough ${action.type} action.`,
            action
          );
          await applyWalkthroughEmbeddedAppState(action, signal);
          await wait(scaleDuration(pauseMs), signal);
          return;
        }
        failAction(
          `Could not resolve walkthrough point for ${action.type} action.`,
          action
        );
        return;
      }

      if (action.type === 'circle') {
        const radius = action.radius ?? playbackPlan.defaults.circleRadius;
        const seed = getCircleSeed(point, radius);
        const loops = action.loops ?? 1;
        const start = { x: cursorRef.current.x, y: cursorRef.current.y };
        const angle = Math.atan2(start.y - point.y, start.x - point.x);
        const entry = getIrregularOvalPoint(point, radius, angle, seed);
        const sample = getIrregularOvalPoint(point, radius, angle + 0.01, seed);
        const tangentLength = Math.hypot(sample.x - entry.x, sample.y - entry.y) || 1;
        const tangent = { x: (sample.x - entry.x) / tangentLength, y: (sample.y - entry.y) / tangentLength };
        const direction = (entry.x - start.x) * tangent.x + (entry.y - start.y) * tangent.y >= 0 ? 1 : -1;
        const approachDistance = Math.hypot(entry.x - start.x, entry.y - start.y);
        const handle = Math.min(radius * 0.6, approachDistance * 0.3);
        const { controlA } = getArcControls(start, entry);
        const controlB = { x: entry.x - tangent.x * direction * handle, y: entry.y - tangent.y * direction * handle };
        const points = Array.from({ length: 33 }, (_, i) => interpolateCubicBezier(start, controlA, controlB, entry, i / 32));
        const samples = Math.max(96, Math.min(2048, Math.ceil(loops * 128)));
        for (let i = 1; i <= samples; i += 1) {
          points.push(getIrregularOvalPoint(point, radius, angle + direction * i / samples * Math.PI * 2 * loops, seed));
        }
        const path = createDistancePath(points);
        // One continuous path avoids an acceleration reset at the circle entrance.
        const duration = (action.durationMs ?? Math.max(playbackPlan.defaults.circleDurationMs, path.length / 0.45)) / safeSpeed;
        await animate(duration, progress => {
          const position = path.at(easePointer(progress));
          syncCursor({ clicking: false, pointer: false, visible: true, ...position }, false);
        }, signal);
        await applyWalkthroughEmbeddedAppState(action, signal);
        await wait(scaleDuration(pauseMs), signal);
        return;
      }

      await animateCursorTo(point.x, point.y, action.type === 'type' ? undefined : action.durationMs);
      throwIfAborted(signal);

      if (action.type === 'hover') {
        const dwellMs = action.pauseMs ?? Math.max(pauseMs, MIN_HOVER_DWELL_MS);
        const reinforceMs = hoverEffectsEnabledRef.current ? Math.min(HOVER_REINFORCE_DELAY_MS, dwellMs) : 0;
        await applyWalkthroughEmbeddedAppState(action, signal);
        if (hoverEffectsEnabledRef.current) {
          dispatchHoverStartForAction(action, point);
          await wait(scaleDuration(reinforceMs), signal);
          if (!isCurrentPlayback()) return;
          dispatchHoverStartForAction(action, point);
        }
        await wait(
          scaleDuration(
            Math.max(0, dwellMs - reinforceMs)
          ),
          signal
        );
        return;
      }

      if (action.type === 'click') {
        const settlingMs = Math.min(70, Math.max(0, pauseMs) * 0.3);
        await wait(settlingMs / safeSpeed, signal);
        const element = getClickElement(action, point);
        if (element) {
          clickPulseIdRef.current += 1;
          setClickPulse({
            id: clickPulseIdRef.current,
            x: point.x,
            y: point.y,
          });
          syncCursor({
            ...cursorRef.current,
            clicking: true,
            visible: true,
            x: point.x,
            y: point.y,
          });
          focusElement(element);
          dispatchPointerEvent(element, 'pointerdown', point);
          dispatchPointerEvent(element, 'mousedown', point);
          await wait(scaleDuration(100), signal);
          dispatchPointerEvent(element, 'pointerup', point);
          dispatchPointerEvent(element, 'mouseup', point);
          dispatchPointerEvent(element, 'click', point);
          syncCursor({
            ...cursorRef.current,
            clicking: false,
            visible: true,
            x: point.x,
            y: point.y,
          });
        } else {
          failAction(
            `Missing walkthrough target "${
              action.target || '(none)'
            }" for click action.`,
            action
          );
        }
        await applyWalkthroughEmbeddedAppState(action, signal);
        await wait(Math.max(0, pauseMs - settlingMs) / safeSpeed, signal);
        return;
      }

      if (action.type === 'type') {
        const element = getTargetElement(action.target) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (!element) {
          failAction(
            `Missing walkthrough target "${
              action.target || '(none)'
            }" for type action.`,
            action
          );
          return;
        }
        element.focus();
        const originalValue = action.clear ? '' : element.value || '';
        if (action.clear) setNativeInputValue(element, '');
        const text = action.text || '';
        const duration = scaleDuration(
          action.durationMs ?? Math.max(800, Array.from(text).length * 45)
        );
        const delays = getTypingDelays(text, duration);
        let characterIndex = 0;
        let value = originalValue;
        for (const character of text) {
          if (signal.aborted) return;
          value += character;
          setNativeInputValue(element, value);
          await wait(delays[characterIndex++], signal);
        }
        await applyWalkthroughEmbeddedAppState(action, signal);
        await wait(scaleDuration(pauseMs), signal);
      }
    };

    const runPlan = async () => {
      try {
        let frameIndex = frames.length
          ? Math.max(0, Math.min(startFrameIndex, frames.length - 1))
          : 0;
        await restoreStateForFrame(frameIndex);
        if (!isCurrentPlayback()) return;
        const initialPoint = getCursorStartPoint(frames[frameIndex]?.action);
        syncCursor({
          clicking: false,
          pointer: false,
          visible: false,
          x: initialPoint?.x ?? playbackPlan.start.x,
          y: initialPoint?.y ?? playbackPlan.start.y,
        });
        onActionStart?.(frameIndex - 1);
        await wait(scaleDuration(320), signal);
        if (!isCurrentPlayback()) return;
        while (frameIndex < frames.length) {
          if (!isCurrentPlayback()) break;
          const frame = frames[frameIndex];
          if (!frame) break;
          onActionStart?.(frame.frameIndex);
          setCaption(frame.sceneCaption);
          await runAction(frame.action);
          if (!isCurrentPlayback()) break;
          frameIndex += 1;
        }
        if (isCurrentPlayback()) {
          const finalAction = frames[frames.length - 1]?.action;
          await wait(
            scaleDuration(
              finalAction?.type === 'hover'
                ? FINAL_HOVER_COMPLETION_HOLD_MS
                : COMPLETION_HOLD_MS
            ),
            signal
          );
          if (!isCurrentPlayback()) return;
          syncCursor({ ...cursorRef.current, visible: false });
          window.dispatchEvent(new CustomEvent(WALKTHROUGH_EVENTS.complete));
          onComplete?.();
        }
      } catch (error) {
        if (!signal.aborted && !errorEmitted) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown walkthrough playback error.';
          emitWalkthroughError(message);
        }
      }
    };

    runPlan();

    return () => {
      controller.abort();
      if (playbackWindow.__moonshotWalkthroughPlaybackToken === playbackToken) {
        clearWalkthroughHoverEffectsState();
        syncCursor({ ...cursorRef.current, visible: false });
        setClickPulse(undefined);
      }
    };
  }, [
    active,
    onActionStart,
    onComplete,
    playbackPlan,
    scaleDuration,
    startFrameIndex,
    strict,
    writeCursorElementStyle,
  ]);

  if (!active) return null;

  const playbackCursorShape = getPlaybackCursorShape(
    cursorSettings.shape,
    cursor.pointer
  );

  return (
    <ViewportOverlay>
      <PlayerOverlay aria-hidden='true'>
        <StyleSheetManager target={document.head}><GlobalHoverEffectStyle /></StyleSheetManager>
        {clickPulse ? (
          <ClickPulse
            key={clickPulse.id}
            $active
            $color={cursorSettings.clickColor}
            $x={clickPulse.x}
            $y={clickPulse.y}
          />
        ) : null}
        <PlayerCursor
          data-walkthrough-cursor={playbackCursorShape}
          $clicking={cursor.clicking}
          $opacity={cursorSettings.opacity}
          $shadow={cursorSettings.shadow}
          $shape={playbackCursorShape}
          $size={cursorSettings.size}
          $visible={cursor.visible}
          $x={cursor.x}
          $y={cursor.y}
          ref={cursorElementRef}
        >
          <CursorGraphic
            borderColor={cursorSettings.borderColor}
            fillColor={cursorSettings.fillColor}
            outlineWidth={cursorSettings.outlineWidth}
            shape={playbackCursorShape}
          />
        </PlayerCursor>
        {showCaptions && caption ? <Caption>{caption}</Caption> : null}
      </PlayerOverlay>
    </ViewportOverlay>
  );
};
