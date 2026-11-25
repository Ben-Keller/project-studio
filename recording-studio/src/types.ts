export type WalkthroughAnchor =
  | 'center'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type WalkthroughActionType = 'scroll' | 'move' | 'hover' | 'click' | 'type' | 'circle' | 'tooltip' | 'wait' | 'state';

export type WalkthroughAppStateValue =
  | boolean
  | null
  | number
  | string
  | WalkthroughAppStateValue[]
  | { [key: string]: WalkthroughAppStateValue };

export interface WalkthroughAppState {
  [key: string]: WalkthroughAppStateValue | undefined;
  language?: string;
}

export interface WalkthroughAction {
  type: WalkthroughActionType;
  appState?: WalkthroughAppState;
  target?: string;
  targetPosition?: { x: number; y: number };
  x?: number;
  y?: number;
  scrollTop?: number;
  anchor?: WalkthroughAnchor;
  block?: ScrollLogicalPosition;
  offsetX?: number;
  offsetY?: number;
  durationMs?: number;
  pauseMs?: number;
  text?: string;
  clear?: boolean;
  enabled?: boolean;
  loops?: number;
  radius?: number;
  state?: WalkthroughStateSnapshot;
}

export interface WalkthroughElementState {
  checked?: boolean;
  expanded?: string | null;
  pressed?: string | null;
  selector: string;
  selected?: string | null;
  text?: string;
  value?: string;
}

export interface WalkthroughStateSnapshot {
  appState?: WalkthroughAppState;
  elements: WalkthroughElementState[];
  scrollTop: number;
  setupActions: WalkthroughAction[];
  tooltipEnabled: boolean;
}

export interface WalkthroughScene {
  id: string;
  caption: string;
  actions: WalkthroughAction[];
}

export interface WalkthroughCursorSettings {
  borderColor: string;
  clickColor: string;
  fillColor: string;
  opacity: number;
  outlineWidth: number;
  shadow: 'none' | 'soft' | 'strong';
  shape: 'arrow' | 'dot' | 'ring' | 'crosshair';
  size: number;
}

export interface WalkthroughExportFrame {
  deviceScaleFactor: number;
  viewport: {
    height: number;
    width: number;
  };
  zoom: number;
}

export interface WalkthroughPlan {
  title: string;
  description?: string;
  cursor?: WalkthroughCursorSettings;
  exportFrame?: WalkthroughExportFrame;
  defaults: {
    moveDurationMs: number;
    scrollDurationMs: number;
    pauseMs: number;
    circleRadius: number;
    circleDurationMs: number;
  };
  start: {
    x: number;
    y: number;
  };
  scenes: WalkthroughScene[];
}

export interface WalkthroughSavedRecording {
  actionCount: number;
  approvedAt?: string;
  createdAt: string;
  id: string;
  name: string;
  plan: WalkthroughPlan;
  updatedAt: string;
}

export interface WalkthroughPlayerOptions {
  active: boolean;
  onActionStart?: (actionIndex: number) => void;
  onComplete?: () => void;
  plan?: WalkthroughPlan;
  showCaptions?: boolean;
  speed?: number;
  startFrameIndex?: number;
  statusLabel?: string;
  strict?: boolean;
}

export type WalkthroughPreviewOptions = {
  startFrameIndex?: number;
};

export interface WalkthroughRecorderOptions {
  active: boolean;
  basePlan?: WalkthroughPlan;
  onPreviewPlan?: (plan: WalkthroughPlan, options?: WalkthroughPreviewOptions) => void;
  onStopPlayback?: () => void;
  playbackActive?: boolean;
  playbackActionIndex?: number;
  recordedFileName?: string;
}

export interface WalkthroughMountOptions {
  defaultPlan?: WalkthroughPlan;
  initialRecorderActive?: boolean;
  recordedFileName?: string;
  recorderShortcut?: boolean;
}
