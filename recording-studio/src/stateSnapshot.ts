import {
  WalkthroughAction,
  WalkthroughAppState,
  WalkthroughElementState,
  WalkthroughStateSnapshot,
} from './types';
import { isRecorderElement, setNativeInputValue } from './targeting';
import { throwIfAborted, wait } from './playbackClock';
import './runtime';

declare global {
  interface Window {
    __moonshotWalkthroughState?: {
      applyState: (state: WalkthroughAppState) => void | Promise<void>;
      getState: () => WalkthroughAppState;
    };
  }
}

const getScopedPath = (root: Element, element: Element) => {
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const tagName = current.tagName.toLowerCase();
    const currentTagName = current.tagName;
    const parent: Element | null = current.parentElement;
    if (!parent) return undefined;
    const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === currentTagName);
    const index = sameTagSiblings.indexOf(current);
    path.unshift(`${tagName}:nth-of-type(${index + 1})`);
    current = parent;
  }
  return path.length ? path.join(' > ') : undefined;
};

const getSelectorForElement = (element: Element) => {
  if (element instanceof HTMLElement && element.dataset.walkthroughTarget) {
    return `[data-walkthrough-target="${element.dataset.walkthroughTarget}"]`;
  }
  const targetParent = element.closest('[data-walkthrough-target]') as HTMLElement | null;
  if (targetParent?.dataset.walkthroughTarget) {
    if (targetParent === element) {
      return `[data-walkthrough-target="${targetParent.dataset.walkthroughTarget}"]`;
    }
    const scopedPath = getScopedPath(targetParent, element);
    return scopedPath ? `[data-walkthrough-target="${targetParent.dataset.walkthroughTarget}"] > ${scopedPath}` : undefined;
  }
  if (element.id) return `#${CSS.escape(element.id)}`;
  const name = element.getAttribute('name');
  if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  return undefined;
};

const setNullableAttribute = (element: Element, attribute: string, value?: string | null) => {
  if (value === null || typeof value === 'undefined') {
    element.removeAttribute(attribute);
    return;
  }
  element.setAttribute(attribute, value);
};

const isLanguageControlSelector = (selector: string) => (
  selector === '#language-select'
  || selector === '#mobile-language-select'
  || selector.includes('[data-walkthrough-target="dashboard-language"] > select')
);

const removeLanguageFromAppState = (appState?: WalkthroughAppState) => {
  if (!appState) return undefined;
  const { language: _language, ...portableState } = JSON.parse(JSON.stringify(appState)) as WalkthroughAppState;
  return portableState;
};

export const stripActionState = (action: WalkthroughAction): WalkthroughAction => {
  const { state, ...rest } = action;
  return rest;
};

export const stripActionStates = (actions: WalkthroughAction[]) => actions.map(stripActionState);

export const captureWalkthroughAppState = (): WalkthroughAppState | undefined => {
  if (typeof window === 'undefined') return undefined;
  const state = (window.__projectStudioAdapter || window.__moonshotWalkthroughState)?.getState?.() as WalkthroughAppState | undefined;
  if (!state) return undefined;
  return removeLanguageFromAppState(state);
};

export const restoreWalkthroughAppState = async (appState?: WalkthroughAppState, signal?: AbortSignal) => {
  throwIfAborted(signal);
  if (!appState || typeof window === 'undefined') return;
  const portableState = removeLanguageFromAppState(appState);
  if (portableState && Object.keys(portableState).length) {
    await (window.__projectStudioAdapter || window.__moonshotWalkthroughState)?.applyState?.(portableState);
  }
  await wait(80, signal || new AbortController().signal);
};

export const createWalkthroughStateSnapshot = (
  _setupActions: WalkthroughAction[],
  tooltipEnabled: boolean,
  scrollTop = typeof window === 'undefined' ? 0 : window.scrollY,
): WalkthroughStateSnapshot => ({
  appState: captureWalkthroughAppState(),
  elements: captureWalkthroughElementState(),
  scrollTop: Math.round(scrollTop),
  setupActions: [],
  tooltipEnabled,
});

export const ensureActionStateSnapshots = (
  actions: WalkthroughAction[],
  fallbackTooltipEnabled = true,
  baselineSnapshot?: WalkthroughStateSnapshot,
) => actions.map((action, index) => {
  const state = (index === 0 && baselineSnapshot)
    ? baselineSnapshot
    : action.state || createWalkthroughStateSnapshot(actions.slice(0, index), fallbackTooltipEnabled);
  return {
    ...action,
    state: {
      ...state,
      setupActions: [],
    },
  };
});

// Timeline restoration derives preceding actions from the current order. Saving
// that prefix inside every step made recordings grow quadratically and go stale
// when edited. Keep the legacy field empty for format compatibility.
export const compactActionSnapshots = (actions: WalkthroughAction[]) => actions.map((action) => (
  action.state ? { ...action, state: { ...action.state, setupActions: [] } } : action
));

export const getActionStateBaseline = (actions: WalkthroughAction[], fallbackIndex = 0) => (
  actions.find((action) => action.state)?.state || actions[fallbackIndex]?.state
);

export const getCurrentSetupActionsForIndex = (actions: WalkthroughAction[], index: number) => (
  stripActionStates(actions.slice(0, Math.max(0, index)))
);

export const captureWalkthroughElementState = (): WalkthroughElementState[] => {
  if (typeof document === 'undefined') return [];
  const elements = Array.from(document.querySelectorAll([
    '[data-walkthrough-target]',
    'input',
    'select',
    'textarea',
    '[aria-selected="true"]',
    '[aria-pressed="true"]',
    '[aria-expanded]',
  ].join(',')));

  const seen = new Set<string>();
  return elements.flatMap((element) => {
    if (isRecorderElement(element)) return [];
    if (element instanceof HTMLInputElement && element.type === 'password') return [];
    const selector = getSelectorForElement(element);
    if (!selector || seen.has(selector)) return [];
    if (isLanguageControlSelector(selector)) return [];
    seen.add(selector);
    const state: WalkthroughElementState = {
      expanded: element.getAttribute('aria-expanded'),
      pressed: element.getAttribute('aria-pressed'),
      selected: element.getAttribute('aria-selected'),
      selector,
      text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120),
    };
    if (element instanceof HTMLInputElement) {
      state.checked = element.checked;
      state.value = element.value;
    }
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      state.value = element.value;
    }
    return [state];
  });
};

export const restoreWalkthroughElementState = (snapshot?: WalkthroughStateSnapshot) => {
  if (!snapshot || typeof document === 'undefined') return;
  snapshot.elements.forEach((item) => {
    if (isLanguageControlSelector(item.selector)) return;
    const element = document.querySelector(item.selector);
    if (!element) return;
    if (element instanceof HTMLInputElement) {
      if (typeof item.checked === 'boolean') element.checked = item.checked;
      if (typeof item.value === 'string') setNativeInputValue(element, item.value);
      return;
    }
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (typeof item.value === 'string') setNativeInputValue(element, item.value);
      return;
    }
    setNullableAttribute(element, 'aria-expanded', item.expanded);
    setNullableAttribute(element, 'aria-pressed', item.pressed);
    setNullableAttribute(element, 'aria-selected', item.selected);
  });
};

export const restoreWalkthroughStateSnapshot = async (snapshot?: WalkthroughStateSnapshot, signal?: AbortSignal) => {
  if (!snapshot) return;
  await restoreWalkthroughAppState(snapshot.appState, signal);
  throwIfAborted(signal);
  restoreWalkthroughElementState(snapshot);
};
