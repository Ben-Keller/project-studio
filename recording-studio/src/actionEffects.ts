import {
  type Point,
  wait,
} from './motion';
import {
  getActionStateBaseline,
  getCurrentSetupActionsForIndex,
  restoreWalkthroughAppState,
  restoreWalkthroughStateSnapshot,
  stripActionState,
} from './stateSnapshot';
import {
  dispatchHoverStartForAction,
  dispatchPointerEvent,
  focusElement,
  getActionPoint,
  getClickElement,
  getTargetElement,
  setNativeInputValue,
} from './targeting';
import { type WalkthroughAction } from './types';
import { throwIfAborted } from './playbackClock';

type PointerUpdate = {
  action: WalkthroughAction;
  element: Element | null;
  point: Point;
};

type ActionEffectOptions = {
  clickDelayMs?: number;
  getTooltipEnabled?: () => boolean;
  onPointerChange?: (update: PointerUpdate) => void;
  setTooltipEnabled?: (enabled: boolean) => void;
  signal?: AbortSignal;
};

type TimelineRestoreOptions = ActionEffectOptions & {
  actions: WalkthroughAction[];
  baselineSnapshot?: WalkthroughAction['state'];
  includeActionEnd?: boolean;
  index: number;
};

const delay = (durationMs: number, signal?: AbortSignal) => (
  signal
    ? wait(durationMs, signal)
    : new Promise<void>((resolve) => {
      window.setTimeout(resolve, durationMs);
    })
);

const updatePointer = (
  action: WalkthroughAction,
  point: Point | undefined,
  onPointerChange?: ActionEffectOptions['onPointerChange'],
) => {
  if (!point || !onPointerChange) return;
  onPointerChange({
    action,
    element: typeof document !== 'undefined' ? document.elementFromPoint(point.x, point.y) : null,
    point,
  });
};

export const applyWalkthroughEmbeddedAppState = async (action: WalkthroughAction, signal?: AbortSignal) => {
  throwIfAborted(signal);
  if (action.type !== 'state' && action.appState) {
    await restoreWalkthroughAppState(action.appState, signal);
    return true;
  }
  return false;
};

export const applyWalkthroughSetupAction = async (
  actionWithState: WalkthroughAction,
  options: ActionEffectOptions = {},
) => {
  throwIfAborted(options.signal);
  const action = stripActionState(actionWithState);

  if (action.type === 'wait' || action.type === 'move' || action.type === 'hover' || action.type === 'circle') {
    return false;
  }

  if (action.type === 'state') {
    await restoreWalkthroughAppState(action.appState, options.signal);
    return true;
  }

  if (action.type === 'scroll') {
    if (typeof action.scrollTop === 'number') {
      window.scrollTo(0, Math.max(0, action.scrollTop));
    }
    await applyWalkthroughEmbeddedAppState(action, options.signal);
    return true;
  }

  if (action.type === 'tooltip') {
    options.setTooltipEnabled?.(action.enabled !== false);
    await applyWalkthroughEmbeddedAppState(action, options.signal);
    return true;
  }

  if (action.type === 'type') {
    const element = getTargetElement(action.target) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!element) return false;
    setNativeInputValue(element, (action.clear ? '' : element.value) + (action.text || ''));
    await delay(35, options.signal);
    await applyWalkthroughEmbeddedAppState(action, options.signal);
    return true;
  }

  if (action.type === 'click') {
    const point = getActionPoint(action);
    if (!point) return false;
    const element = getClickElement(action, point);
    if (!element) return false;
    focusElement(element);
    dispatchPointerEvent(element, 'pointerdown', point);
    dispatchPointerEvent(element, 'mousedown', point);
    dispatchPointerEvent(element, 'pointerup', point);
    dispatchPointerEvent(element, 'mouseup', point);
    dispatchPointerEvent(element, 'click', point);
    updatePointer(action, point, options.onPointerChange);
    await delay(options.clickDelayMs ?? 60, options.signal);
    await applyWalkthroughEmbeddedAppState(action, options.signal);
    return true;
  }

  return false;
};

export const applyWalkthroughActionEndState = async (
  action: WalkthroughAction,
  options: ActionEffectOptions = {},
) => {
  if (action.type === 'hover') {
    const point = getActionPoint(action);
    await applyWalkthroughEmbeddedAppState(action, options.signal);
    updatePointer(action, point, options.onPointerChange);
    if (point && options.getTooltipEnabled?.()) {
      dispatchHoverStartForAction(action, point);
    }
    return Boolean(point);
  }

  if (action.type === 'circle' || action.type === 'move') {
    const point = getActionPoint(action);
    updatePointer(action, point, options.onPointerChange);
    await applyWalkthroughEmbeddedAppState(action, options.signal);
    return Boolean(point);
  }

  return applyWalkthroughSetupAction(action, options);
};

export const restoreWalkthroughSnapshotBoundary = async (
  snapshot: WalkthroughAction['state'],
  options: ActionEffectOptions = {},
) => {
  if (!snapshot) return false;
  throwIfAborted(options.signal);
  options.setTooltipEnabled?.(snapshot.tooltipEnabled);
  await restoreWalkthroughStateSnapshot(snapshot, options.signal);
  throwIfAborted(options.signal);
  window.scrollTo(0, Math.max(0, snapshot.scrollTop));
  return true;
};

export const restoreWalkthroughTimelineBoundary = async ({
  actions,
  baselineSnapshot,
  includeActionEnd = false,
  index,
  ...options
}: TimelineRestoreOptions) => {
  const action = actions[index];
  const snapshot = action?.state;
  const boundarySnapshot = baselineSnapshot || getActionStateBaseline(actions, index) || snapshot;

  await restoreWalkthroughSnapshotBoundary(boundarySnapshot, options);

  const setupActions = getCurrentSetupActionsForIndex(actions, index);
  for (const setupAction of setupActions) {
    if (options.signal?.aborted) return false;
    await applyWalkthroughSetupAction(setupAction, options);
  }

  if (includeActionEnd && action) {
    await applyWalkthroughActionEndState(action, options);
  }

  return true;
};
