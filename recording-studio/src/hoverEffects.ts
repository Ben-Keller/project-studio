type HoverPoint = {
  x: number;
  y: number;
};

type ActiveHoverTarget = {
  element: Element;
  point: HoverPoint;
};

type ClearHoverEffectsOptions = {
  disableEffects?: boolean;
};

export const WALKTHROUGH_HOVER_CLEAR_EVENT = 'moonshot-walkthrough-hover-clear';

let activeHoverTargets: ActiveHoverTarget[] = [];

export const setWalkthroughHoverEffectsEnabled = (enabled: boolean) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.walkthroughHoverEffects = enabled ? 'enabled' : 'disabled';
};

const dispatchPointerEndEvent = (
  element: Element,
  eventName: string,
  point: HoverPoint,
) => {
  const baseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    relatedTarget: document.body,
    view: window,
  };
  if (eventName.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
    element.dispatchEvent(new PointerEvent(eventName, {
      ...baseInit,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    }));
    return;
  }
  element.dispatchEvent(new MouseEvent(eventName, baseInit));
};

export const registerWalkthroughHoverTargets = (
  elements: Element[],
  point: HoverPoint,
) => {
  const seen = new Set<Element>();
  activeHoverTargets = elements
    .filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return true;
    })
    .map((element) => ({
      element,
      point,
    }));
};

export const clearWalkthroughHoverEffectsState = (options: ClearHoverEffectsOptions = {}) => {
  if (typeof document === 'undefined') return;
  const { disableEffects = true } = options;
  const targets = activeHoverTargets;
  activeHoverTargets = [];
  targets.forEach(({ element, point }) => {
    if (!element.isConnected) return;
    ['pointerout', 'mouseout', 'pointerleave', 'mouseleave'].forEach((eventName) => {
      dispatchPointerEndEvent(element, eventName, point);
    });
    element.dispatchEvent(new CustomEvent(WALKTHROUGH_HOVER_CLEAR_EVENT, {
      bubbles: true,
    }));
  });
  document.dispatchEvent(new CustomEvent(WALKTHROUGH_HOVER_CLEAR_EVENT));
  if (disableEffects) {
    delete document.documentElement.dataset.walkthroughHoverEffects;
  }
};
