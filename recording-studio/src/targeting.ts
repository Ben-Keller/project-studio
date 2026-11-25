import { Point, round } from './motion';
import {
  clearWalkthroughHoverEffectsState,
  registerWalkthroughHoverTargets,
} from './hoverEffects';
import {
  WalkthroughAction,
  WalkthroughAnchor,
} from './types';

export const isRecorderElement = (element: EventTarget | null) => (
  element instanceof Element && Boolean(element.closest('[data-walkthrough-recorder]'))
);

export const resolveSelector = (target: string) => (
  target.startsWith('#') || target.startsWith('.') || target.startsWith('[')
    ? target
    : `[data-walkthrough-target="${target}"]`
);

export const getTargetElement = (target?: string) => {
  if (!target) return null;
  try {
    return document.querySelector(resolveSelector(target)) as HTMLElement | null;
  } catch {
    return null;
  }
};

export const getElementAtPoint = (point: Point) => document.elementFromPoint(point.x, point.y);

export const getClickElement = (action: WalkthroughAction, point: Point) => {
  const targetElement = getTargetElement(action.target);
  const pointElement = getElementAtPoint(point);
  if (!targetElement) return pointElement;
  if (!pointElement) return targetElement;
  if (targetElement === pointElement || targetElement.contains(pointElement)) {
    return pointElement;
  }
  return targetElement;
};

export const getHoverElements = (action: WalkthroughAction, point: Point) => {
  const targetElement = getTargetElement(action.target);
  const pointElement = getElementAtPoint(point);
  const elements: Element[] = [];
  const addElement = (element: Element | null) => {
    if (element && !elements.includes(element)) {
      elements.push(element);
    }
  };

  let current: Element | null = pointElement;
  while (current) {
    addElement(current);
    if (targetElement && current === targetElement) break;
    if (current instanceof HTMLElement && current.dataset.walkthroughTarget) break;
    current = current.parentElement;
  }
  addElement(targetElement);
  return elements;
};

export const getNamedTarget = (element: Element | null) => {
  const targetElement = element?.closest('[data-walkthrough-target]') as HTMLElement | null;
  if (targetElement?.dataset.walkthroughTarget) return targetElement.dataset.walkthroughTarget;
  const actionable = element?.closest('button,a,input,select,textarea,[role="button"],[role="tab"]') || element;
  if (!actionable || isRecorderElement(actionable)) return undefined;
  if (actionable.id) return `#${CSS.escape(actionable.id)}`;
  const testId = actionable.getAttribute('data-testid');
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const parts: string[] = [];
  let current: Element | null = actionable;
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement?.children || []).filter(child => child.tagName === current!.tagName);
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = current.parentElement;
  }
  return `[${'data-project-studio-document'}] > ${parts.join(' > ')}`;
};

export const getAnchorPoint = (rect: DOMRect, anchor: WalkthroughAnchor = 'center') => {
  const horizontal = anchor.includes('left') ? rect.left : anchor.includes('right') ? rect.right : rect.left + rect.width / 2;
  const vertical = anchor.includes('top') ? rect.top : anchor.includes('bottom') ? rect.bottom : rect.top + rect.height / 2;
  if (anchor === 'left') return { x: rect.left, y: rect.top + rect.height / 2 };
  if (anchor === 'right') return { x: rect.right, y: rect.top + rect.height / 2 };
  if (anchor === 'top') return { x: rect.left + rect.width / 2, y: rect.top };
  if (anchor === 'bottom') return { x: rect.left + rect.width / 2, y: rect.bottom };
  return { x: horizontal, y: vertical };
};

export const getActionPoint = (action: WalkthroughAction) => {
  const element = getTargetElement(action.target);
  if (element) {
    const rect = element.getBoundingClientRect();
    if (action.targetPosition) {
      return {
        x: rect.left + rect.width * action.targetPosition.x,
        y: rect.top + rect.height * action.targetPosition.y,
      };
    }
    const point = getAnchorPoint(rect, action.anchor);
    return {
      x: point.x + (action.offsetX || 0),
      y: point.y + (action.offsetY || 0),
    };
  }
  if (typeof action.x === 'number' && typeof action.y === 'number') {
    return {
      x: action.x + (action.target ? 0 : action.offsetX || 0),
      y: action.y + (action.target ? 0 : action.offsetY || 0),
    };
  }
  return undefined;
};

export const buildTargetedAction = (
  type: WalkthroughAction['type'],
  point: Point & { element: Element | null },
) => {
  const target = getNamedTarget(point.element);
  if (!target) {
    return {
      type,
      x: round(point.x),
      y: round(point.y),
    };
  }
  const targetElement = point.element?.closest('[data-walkthrough-target]') as HTMLElement | null;
  const rect = targetElement?.getBoundingClientRect();
  if (!rect) {
    return {
      type,
      target,
    };
  }
  return {
    type,
    target,
    targetPosition: rect.width && rect.height ? {
      x: (point.x - rect.left) / rect.width,
      y: (point.y - rect.top) / rect.height,
    } : undefined,
    x: round(point.x),
    y: round(point.y),
    offsetX: round(point.x - (rect.left + rect.width / 2)),
    offsetY: round(point.y - (rect.top + rect.height / 2)),
  };
};

export const focusElement = (element: Element) => {
  const focusable = element as Element & { focus?: (options?: FocusOptions) => void };
  if (typeof focusable.focus === 'function') focusable.focus({ preventScroll: true });
};

export const dispatchPointerEvent = (
  element: Element,
  eventName: string,
  point: Point,
  relatedTarget: EventTarget | null = document.body,
) => {
  const baseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    buttons: eventName.endsWith('down') ? 1 : 0,
    relatedTarget,
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

export const dispatchHoverStart = (element: Element, point: Point) => {
  ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove'].forEach((eventName) => {
    dispatchPointerEvent(element, eventName, point);
  });
  element.dispatchEvent(new CustomEvent('moonshot-walkthrough-hover', {
    bubbles: true,
    detail: {
      clientX: point.x,
      clientY: point.y,
    },
  }));
  focusElement(element);
};

export const dispatchHoverStartForAction = (action: WalkthroughAction, point: Point) => {
  clearWalkthroughHoverEffectsState({ disableEffects: false });
  const elements = getHoverElements(action, point);
  elements.forEach((element) => {
    dispatchHoverStart(element, point);
  });
  registerWalkthroughHoverTargets(elements, point);
  return elements.length > 0;
};

export const setNativeInputValue = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

export const getInputText = (element: EventTarget | null) => {
  if (element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement) {
    const textInputTypes = new Set([
      '',
      'date',
      'datetime-local',
      'email',
      'month',
      'number',
      'password',
      'search',
      'tel',
      'text',
      'time',
      'url',
      'week',
    ]);
    if (!textInputTypes.has(element.type)) return undefined;
    return element.value;
  }
  return undefined;
};
