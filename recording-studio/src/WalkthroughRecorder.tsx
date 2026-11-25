import { DEFAULT_EXPORT_RESOLUTION, EXPORT_RESOLUTION_OPTIONS } from '../shared/exportSettings.mjs';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Circle,
  FileDown,
  Hand,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  ScrollText,
  Settings,
} from 'lucide-react';
import {
  CURSOR_SHADOW_OPTIONS,
  CURSOR_SHAPE_OPTIONS,
  loadCursorSettings,
  saveCursorSettings,
} from './cursorSettings';
import { CursorGraphic } from './CursorGraphic';
import { getDocumentZoom } from './ViewportOverlay';
import {
  restoreWalkthroughSnapshotBoundary,
  restoreWalkthroughTimelineBoundary,
} from './actionEffects';
import {
  DEFAULT_WALKTHROUGH_EXPORT_FPS,
  DEFAULT_WALKTHROUGH_EXPORT_QUALITY,
  WALKTHROUGH_EXPORT_FPS_OPTIONS,
  WALKTHROUGH_EXPORT_LANGUAGES,
  WALKTHROUGH_EXPORT_QUALITY_OPTIONS,
  WALKTHROUGH_EVENTS,
} from './config';
import {
  cancelWalkthroughExportJob,
  checkWalkthroughExportService,
  createWalkthroughExportJob,
  getWalkthroughExportJob,
  type WalkthroughExportJob,
} from './exportService';
import {
  clearWalkthroughHoverEffectsState,
  setWalkthroughHoverEffectsEnabled,
} from './hoverEffects';
import {
  clamp,
  getCircleRadiusForLevel,
  round,
} from './motion';
import { plan as defaultBasePlan } from './plan';
import {
  createWalkthroughStateSnapshot,
  compactActionSnapshots,
  captureWalkthroughAppState,
  ensureActionStateSnapshots,
  getActionStateBaseline,
} from './stateSnapshot';
import {
  RecorderActionBadge,
  RecorderActionBody,
  RecorderActionControlButton,
  RecorderActionControls,
  RecorderActionIndex,
  RecorderActionLog,
  RecorderActionLogItem,
  RecorderActionMeta,
  RecorderActionText,
  ButtonRow,
  DragDropHalo,
  DragGhost,
  RecorderButton,
  RecorderBackButton,
  RecorderCircleButton,
  RecorderCircleDragButton,
  RecorderCirclePicker,
  RecorderCircleSizeButton,
  RecorderCircleSizeHandle,
  RecorderCircleSizeMenu,
  RecorderConfirmation,
  RecorderControlGrid,
  RecorderColorInput,
  RecorderCursorPreview,
  RecorderCursorPreviewOverlay,
  RecorderExportArea,
  RecorderExportBackdrop,
  RecorderExportHeaderRow,
  RecorderExportLanguageButton,
  RecorderExportLanguageGrid,
  RecorderExportModal,
  RecorderExportOptionRow,
  RecorderExportProgressCard,
  RecorderExportProgressFill,
  RecorderExportProgressTrack,
  RecorderField,
  RecorderFieldValue,
  RecorderHeader,
  RecorderHeaderActions,
  RecorderHeaderLeft,
  RecorderHeaderMenuButton,
  RecorderHeaderMenuPopover,
  RecorderHeaderMenuWrap,
  RecorderHelp,
  RecorderInlineForm,
  RecorderLibraryHeader,
  RecorderLibraryDeleteButton,
  RecorderLibraryItem,
  RecorderLibraryList,
  RecorderLibraryMeta,
  RecorderLibraryTitle,
  RecorderPanel,
  RecorderAddButton,
  RecorderPlayButton,
  RecorderPrimaryAction,
  RecorderRecordButton,
  RecorderRangeInput,
  RecorderSectionTitle,
  RecorderSelect,
  RecorderStatePill,
  RecorderTextInput,
  RecorderTimelineHint,
  RecorderTimelineHeader,
  RecorderTitle,
  RecorderToolDock,
} from './styles';
import {
  deleteSavedRecording,
  loadSavedRecordings,
  refreshRecordingLibrary,
  savePreviewPlan,
  saveRecording,
} from './storage';
import { runtimeConfig } from './runtime';
import {
  buildTargetedAction,
  getActionPoint,
  getInputText,
  getNamedTarget,
  getTargetElement,
  isRecorderElement,
} from './targeting';
import {
  type WalkthroughAction,
  type WalkthroughAppState,
  type WalkthroughCursorSettings,
  type WalkthroughExportFrame,
  type WalkthroughPlan,
  type WalkthroughRecorderOptions,
  type WalkthroughSavedRecording,
  type WalkthroughStateSnapshot,
} from './types';
import {
  formatRecordingDate,
  getActionLogEntry,
  getRecordingSignature,
} from './workflow';

type LocationTool = {
  label: string;
  options?: Partial<WalkthroughAction>;
  type: 'hover' | 'circle';
};

type RecorderView = 'library' | 'recording';
type RecorderMode = 'paused' | 'recording';

const CIRCLE_SIZE_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];
const CIRCLE_SIZE_MENU_RADIUS_REM = 2.45;
const CIRCLE_SIZE_MENU_DELAY_MS = 130;
const CIRCLE_SIZE_MENU_CLOSE_DELAY_MS = 220;
const START_STATE_INDEX = -1;
const DEFAULT_EXPORT_FRAME: WalkthroughExportFrame = {
  deviceScaleFactor: 1,
  viewport: {
    height: 956,
    width: 1470,
  },
  zoom: 1,
};
const DEFAULT_RECORDING_NAME = 'Recording';

type DragPoint = {
  targetLabel: string;
  valid: boolean;
  x: number;
  y: number;
};

type DropFeedback = {
  id: number;
  x: number;
  y: number;
};

const getClickActionSignature = (action: WalkthroughAction) => JSON.stringify({
  offsetX: action.offsetX,
  offsetY: action.offsetY,
  target: action.target,
  x: action.x,
  y: action.y,
});

const getAppStateSignature = (appState?: WalkthroughAppState) => JSON.stringify(appState || {});

const normalizeExportFrame = (frame?: Partial<WalkthroughExportFrame>): WalkthroughExportFrame => ({
  deviceScaleFactor: clamp(Number(frame?.deviceScaleFactor ?? DEFAULT_EXPORT_FRAME.deviceScaleFactor), 1, 3),
  viewport: {
    height: Math.round(clamp(Number(frame?.viewport?.height ?? DEFAULT_EXPORT_FRAME.viewport.height), 480, 2160)),
    width: Math.round(clamp(Number(frame?.viewport?.width ?? DEFAULT_EXPORT_FRAME.viewport.width), 640, 3840)),
  },
  zoom: Number(clamp(Number(frame?.zoom ?? DEFAULT_EXPORT_FRAME.zoom), 0.5, 1.5).toFixed(2)),
});

const getCurrentExportFrame = (): WalkthroughExportFrame => {
  if (typeof window === 'undefined') return DEFAULT_EXPORT_FRAME;
  const documentElement = document.documentElement;
  const viewportWidth = window.innerWidth
    || documentElement?.clientWidth
    || window.visualViewport?.width
    || DEFAULT_EXPORT_FRAME.viewport.width;
  const viewportHeight = window.innerHeight
    || documentElement?.clientHeight
    || window.visualViewport?.height
    || DEFAULT_EXPORT_FRAME.viewport.height;
  return normalizeExportFrame({
    deviceScaleFactor: window.devicePixelRatio || DEFAULT_EXPORT_FRAME.deviceScaleFactor,
    viewport: {
      height: viewportHeight,
      width: viewportWidth,
    },
    zoom: getDocumentZoom(),
  });
};

const getPanelRecordingTitle = (name: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) return DEFAULT_RECORDING_NAME;
  return trimmedName.replace(/^Recorded walkthrough/i, 'Recording');
};

const getLastTooltipEnabled = (actions: WalkthroughAction[]) => {
  const lastTooltipAction = [...actions].reverse().find((action) => action.type === 'tooltip');
  return lastTooltipAction ? lastTooltipAction.enabled !== false : true;
};

const isTimelineAction = (action: WalkthroughAction) => action.type !== 'state' && action.type !== 'wait';

// Existing recordings may contain explicit waits and state transitions. Editing
// must preserve those steps and their timing, even if live capture omits them.
const normalizeTimelineActions = compactActionSnapshots;

const getDragTargetLabel = (element: Element | null) => {
  if (!element) return 'Drop on the page';
  if (isRecorderElement(element)) return 'Drop outside panel';
  const namedTarget = getNamedTarget(element);
  if (namedTarget) return namedTarget;
  const text = element.textContent?.trim().replace(/\s+/g, ' ');
  if (text) return text.length > 24 ? `${text.slice(0, 21)}...` : text;
  return element.tagName.toLowerCase();
};

const clampActionIndex = (index: number, actionCount: number) => (
  Math.max(START_STATE_INDEX, Math.min(index, actionCount - 1))
);

const getCircleSizeMenuOffset = (index: number) => {
  const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / CIRCLE_SIZE_LEVELS.length);
  return {
    x: Number((Math.cos(angle) * CIRCLE_SIZE_MENU_RADIUS_REM).toFixed(2)),
    y: Number((Math.sin(angle) * CIRCLE_SIZE_MENU_RADIUS_REM).toFixed(2)),
  };
};

export const WalkthroughRecorder = ({
  active,
  basePlan = defaultBasePlan,
  onPreviewPlan,
  onStopPlayback,
  playbackActionIndex,
  playbackActive = false,
}: WalkthroughRecorderOptions) => {
  const [actions, setActions] = useState<WalkthroughAction[]>([]);
  const [status, setStatus] = useState('Recorder ready.');
  const [confirmation, setConfirmation] = useState('');
  const [dragTool, setDragTool] = useState<LocationTool | null>(null);
  const [dragPoint, setDragPoint] = useState<DragPoint>({
    targetLabel: 'Pick a page point',
    valid: false,
    x: 0,
    y: 0,
  });
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | undefined>(undefined);
  const [circleSizeMenuVisible, setCircleSizeMenuVisible] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 16, y: 16 });
  const [recorderView, setRecorderView] = useState<RecorderView>('library');
  const [recorderMode, setRecorderMode] = useState<RecorderMode>('paused');
  const [cursorSettings, setCursorSettings] = useState(loadCursorSettings);
  const [exportFrame, setExportFrame] = useState<WalkthroughExportFrame>(() => getCurrentExportFrame());
  const [cursorSettingsOpen, setCursorSettingsOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportStartError, setExportStartError] = useState('');
  const [recordingName, setRecordingName] = useState(DEFAULT_RECORDING_NAME);
  const [savedRecordings, setSavedRecordings] = useState<WalkthroughSavedRecording[]>(loadSavedRecordings);
  const [activeSavedRecordingId, setActiveSavedRecordingId] = useState<string | undefined>(undefined);
  const [savedSignature, setSavedSignature] = useState('');
  const [exportLanguages, setExportLanguages] = useState<string[]>([runtimeConfig()?.language || 'en']);
  const [exportResolution, setExportResolution] = useState(DEFAULT_EXPORT_RESOLUTION);
  const [exportFps, setExportFps] = useState(DEFAULT_WALKTHROUGH_EXPORT_FPS);
  const [exportQuality, setExportQuality] = useState<string>(DEFAULT_WALKTHROUGH_EXPORT_QUALITY);
  const [exportServiceAvailable, setExportServiceAvailable] = useState(false);
  const [exportServiceMessage, setExportServiceMessage] = useState('Checking browser export...');
  const [activeExportJob, setActiveExportJob] = useState<WalkthroughExportJob | undefined>(undefined);
  const [selectedActionIndex, setSelectedActionIndex] = useState(START_STATE_INDEX);
  const actionLogRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<WalkthroughAction[]>([]);
  const confirmationTimerRef = useRef<number | undefined>(undefined);
  const circleSizeMenuTimerRef = useRef<number | undefined>(undefined);
  const cursorSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const dragToolRef = useRef<LocationTool | null>(null);
  const dropFeedbackIdRef = useRef(0);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const lastClickRef = useRef<{ at: number; signature: string } | undefined>(undefined);
  const lastRecordedAtRef = useRef<number>(typeof window === 'undefined' ? 0 : window.performance.now());
  const panelDragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanelX: number;
    startPanelY: number;
  } | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; element: Element | null }>({
    element: null,
    x: basePlan.start.x,
    y: basePlan.start.y,
  });
  const scrollTimerRef = useRef<number | undefined>(undefined);
  const pendingScrollTopRef = useRef<number | undefined>(undefined);
  const inputTimerRef = useRef<number | undefined>(undefined);
  const pendingInputRef = useRef<{ element: Element; text: string } | undefined>(undefined);
  const autoSaveTimerRef = useRef<number | undefined>(undefined);
  const recorderModeRef = useRef<RecorderMode>('paused');
  const restoringStateRef = useRef(false);
  const resumeFrameIndexRef = useRef<number | undefined>(undefined);
  const selectedActionIndexRef = useRef(START_STATE_INDEX);
  const suppressNextClickRef = useRef(false);
  const timelineBaselineRef = useRef<WalkthroughStateSnapshot | undefined>(undefined);
  const lastAppStateSignatureRef = useRef('');
  const tooltipEnabledRef = useRef(false);
  const previousActionCountRef = useRef(0);
  const currentSignature = useMemo(
    () => getRecordingSignature(actions, cursorSettings, exportFrame, recordingName),
    [actions, cursorSettings, exportFrame, recordingName],
  );
  const exportLanguageProgress = useMemo(() => {
    if (!activeExportJob) return {};
    const jobLanguages = activeExportJob.languages.length ? activeExportJob.languages : exportLanguages;
    const totalLanguages = Math.max(1, jobLanguages.length);
    const completedUnits = activeExportJob.status === 'completed'
      ? totalLanguages
      : Math.min(
        totalLanguages,
        Math.max(
          activeExportJob.completedLanguages,
          (activeExportJob.progress / 100) * totalLanguages,
        ),
      );
    return jobLanguages.reduce<Record<string, number>>((progressByLanguage, language, index) => {
      progressByLanguage[language] = clamp((completedUnits - index) * 100, 0, 100);
      return progressByLanguage;
    }, {});
  }, [activeExportJob, exportLanguages]);
  const exportInProgress = activeExportJob?.status === 'queued' || activeExportJob?.status === 'running';
  const exportCompleted = activeExportJob?.status === 'completed';
  const exportCompletedPath = exportCompleted
    ? activeExportJob?.outputPath || activeExportJob?.outputDir
    : '';
  const activeActionIndex = playbackActive && typeof playbackActionIndex === 'number'
    ? clampActionIndex(playbackActionIndex, actions.length)
    : selectedActionIndex;
  const selectActionIndex = useCallback((index: number) => {
    const nextIndex = clampActionIndex(index, actionsRef.current.length);
    selectedActionIndexRef.current = nextIndex;
    setSelectedActionIndex(nextIndex);
  }, []);

  const updateActions = useCallback((nextActions: WalkthroughAction[]) => {
    const normalizedActions = normalizeTimelineActions(nextActions);
    actionsRef.current = normalizedActions;
    setActions(normalizedActions);
    const nextIndex = clampActionIndex(selectedActionIndexRef.current, normalizedActions.length);
    selectedActionIndexRef.current = nextIndex;
    setSelectedActionIndex(nextIndex);
  }, []);

  const updateActionAppState = useCallback((appState: WalkthroughAppState) => {
    const currentActions = actionsRef.current;
    let targetIndex = selectedActionIndexRef.current >= 0
      ? selectedActionIndexRef.current
      : currentActions.length - 1;
    while (targetIndex >= 0 && !isTimelineAction(currentActions[targetIndex])) {
      targetIndex -= 1;
    }
    if (targetIndex < 0) {
      const baseline = timelineBaselineRef.current || createWalkthroughStateSnapshot([], tooltipEnabledRef.current);
      timelineBaselineRef.current = {
        ...baseline,
        appState,
      };
      return;
    }
    const nextActions = currentActions.map((action, index) => (
      index === targetIndex
        ? {
          ...action,
          appState,
        }
        : action
    ));
    updateActions(nextActions);
  }, [updateActions]);

  const updateRecorderMode = useCallback((mode: RecorderMode) => {
    recorderModeRef.current = mode;
    setRecorderMode(mode);
  }, []);

  const showConfirmation = useCallback((message: string, durationMs = 1250) => {
    setConfirmation(message);
    if (confirmationTimerRef.current) window.clearTimeout(confirmationTimerRef.current);
    confirmationTimerRef.current = window.setTimeout(() => {
      setConfirmation('');
      confirmationTimerRef.current = undefined;
    }, durationMs);
  }, []);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const recordings = await refreshRecordingLibrary();
        if (!disposed) setSavedRecordings(recordings);
      } catch (error) {
        if (!disposed) setStatus(`Could not refresh recording history: ${String(error)}`);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(WALKTHROUGH_EVENTS.openRecorder, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(WALKTHROUGH_EVENTS.openRecorder, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [active]);

  useEffect(() => {
    dragToolRef.current = dragTool;
  }, [dragTool]);

  useEffect(() => {
    recorderModeRef.current = recorderMode;
  }, [recorderMode]);

  useEffect(() => {
    if (playbackActive && recorderModeRef.current === 'recording') {
      updateRecorderMode('paused');
    }
  }, [playbackActive, updateRecorderMode]);

  useEffect(() => {
    if (typeof playbackActionIndex !== 'number') return;
    const nextIndex = clampActionIndex(playbackActionIndex, actionsRef.current.length);
    selectedActionIndexRef.current = nextIndex;
    setSelectedActionIndex(nextIndex);
  }, [playbackActionIndex]);

  useEffect(() => {
    if (recorderView !== 'recording') return;
    const container = actionLogRef.current;
    const activeItem = container?.querySelector<HTMLElement>('[data-walkthrough-action-active="true"]');
    if (!container || !activeItem) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeItem.getBoundingClientRect();
    const targetTop = container.scrollTop
      + (activeRect.top - containerRect.top)
      - Math.max(8, (container.clientHeight - activeRect.height) * 0.28);
    container.scrollTo({
      behavior: playbackActive ? 'smooth' : 'auto',
      top: Math.max(0, targetTop),
    });
  }, [activeActionIndex, playbackActive, recorderView]);

  useEffect(() => {
    if (actions.length > previousActionCountRef.current) {
      actionLogRef.current?.scrollTo({
        behavior: 'smooth',
        top: actionLogRef.current.scrollHeight,
      });
    }
    previousActionCountRef.current = actions.length;
  }, [actions.length]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let checking = false;
    const checkExportService = async () => {
      if (checking || cancelled) return;
      checking = true;
      try {
        const result = await checkWalkthroughExportService();
        if (cancelled) return;
        setExportServiceAvailable(Boolean(result.ok));
        setExportServiceMessage('');
      } catch {
        if (cancelled) return;
        setExportServiceAvailable(false);
        setExportServiceMessage('Browser export is not connected to the local video exporter.');
      } finally { checking = false; }
    };
    checkExportService();
    const interval = window.setInterval(checkExportService, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active]);

  useEffect(() => {
    if (!activeExportJob || !['queued', 'running'].includes(activeExportJob.status)) return undefined;
    let cancelled = false;
    let polling = false;
    const jobId = activeExportJob.id;
    const interval = window.setInterval(async () => {
      if (polling || cancelled) return;
      polling = true;
      try {
        const nextJob = await getWalkthroughExportJob(jobId);
        if (!cancelled) {
          setActiveExportJob(nextJob);
          if (nextJob.status === 'completed') {
            const outputPath = nextJob.outputPath || nextJob.outputDir;
            setStatus(`Export complete: ${outputPath}`);
          }
          if (nextJob.status === 'failed') setStatus(`Export failed: ${nextJob.error || 'Unknown error.'}`);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Could not update export progress.');
        }
      } finally { polling = false; }
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeExportJob?.id, activeExportJob?.status]);

  useEffect(() => {
    if (!active || recorderView !== 'recording' || !cursorSettingsOpen) return undefined;
    const handleOutsidePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cursorSettingsMenuRef.current?.contains(target)) return;
      setCursorSettingsOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [active, cursorSettingsOpen, recorderView]);

  const updateCursorSetting = useCallback(<Key extends keyof WalkthroughCursorSettings>(
    key: Key,
    value: WalkthroughCursorSettings[Key],
  ) => {
    setCursorSettings((current) => {
      const next = {
        ...current,
        [key]: value,
      };
      saveCursorSettings(next);
      return next;
    });
  }, []);

  const addAction = useCallback((action: WalkthroughAction, label?: string) => {
    const now = window.performance.now();
    const elapsed = now - lastRecordedAtRef.current;
    const durationMs = action.durationMs
      ?? (action.type === 'circle' ? basePlan.defaults.circleDurationMs : clamp(elapsed * 0.36, 360, 1050));
    const pauseMs = action.pauseMs
      ?? (action.type === 'circle' ? 950 : clamp(elapsed - durationMs, 700, 2400));
    const insertAt = actionsRef.current.length
      ? Math.min(selectedActionIndexRef.current + 1, actionsRef.current.length)
      : 0;
    const nextAction = {
      ...action,
      durationMs: round(durationMs),
      pauseMs: round(pauseMs),
      state: action.state || createWalkthroughStateSnapshot(
        actionsRef.current.slice(0, insertAt),
        tooltipEnabledRef.current,
      ),
    };
    if (!timelineBaselineRef.current) {
      timelineBaselineRef.current = nextAction.state;
    }
    const nextActions = [
      ...actionsRef.current.slice(0, insertAt),
      nextAction,
      ...actionsRef.current.slice(insertAt),
    ];
    updateActions(nextActions);
    selectActionIndex(insertAt);
    lastRecordedAtRef.current = now;
    const message = label || `Recorded ${action.type}.`;
    setStatus(message);
    showConfirmation(message);
  }, [basePlan.defaults.circleDurationMs, selectActionIndex, showConfirmation, updateActions]);

  useEffect(() => {
    if (!active) return undefined;
    const handleAppStateChange = (event: Event) => {
      if (recorderView !== 'recording' || recorderModeRef.current !== 'recording') return;
      if (playbackActive || restoringStateRef.current) return;
      const appState = (event as CustomEvent<WalkthroughAppState>).detail;
      const signature = getAppStateSignature(appState);
      if (!appState || signature === lastAppStateSignatureRef.current) return;
      lastAppStateSignatureRef.current = signature;
      updateActionAppState(appState);
    };
    window.addEventListener(WALKTHROUGH_EVENTS.appStateChange, handleAppStateChange);
    return () => {
      window.removeEventListener(WALKTHROUGH_EVENTS.appStateChange, handleAppStateChange);
    };
  }, [active, playbackActive, recorderView, updateActionAppState]);

  const flushPendingInput = useCallback(() => {
    if (inputTimerRef.current) {
      window.clearTimeout(inputTimerRef.current);
      inputTimerRef.current = undefined;
    }
    const pending = pendingInputRef.current;
    if (!pending) return;
    pendingInputRef.current = undefined;
    const target = getNamedTarget(pending.element);
    if (!target) return;
    addAction({
      clear: true,
      target,
      text: pending.text,
      type: 'type',
    }, `Recorded typing into ${target}.`);
  }, [addAction]);

  const flushPendingScroll = useCallback(() => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = undefined;
    }
    const scrollTop = pendingScrollTopRef.current;
    pendingScrollTopRef.current = undefined;
    if (typeof scrollTop !== 'number') return;
    const currentActions = actionsRef.current;
    const previous = currentActions[currentActions.length - 1];
    if (previous?.type === 'scroll' && Math.abs((previous.scrollTop || 0) - scrollTop) < 24) return;
    addAction({
      durationMs: 850,
      pauseMs: 950,
      scrollTop: round(scrollTop),
      type: 'scroll',
    }, `Recorded scroll to ${round(scrollTop)}px.`);
  }, [addAction]);

  const addLocationActionAtPoint = useCallback((tool: LocationTool, point: { x: number; y: number; element: Element | null }) => {
    flushPendingInput();
    flushPendingScroll();
    if (isRecorderElement(point.element)) {
      showConfirmation('Drop on the page, not the recorder panel.');
      return;
    }
    const targetedAction = buildTargetedAction(tool.type, point);
    const coordinateFallback = tool.type === 'hover' || tool.type === 'circle'
      ? {
        x: round(point.x),
        y: round(point.y),
      }
      : {};
    addAction({
      ...targetedAction,
      ...coordinateFallback,
      ...tool.options,
    }, tool.options?.radius ? `Recorded ${tool.type} radius ${tool.options.radius}.` : `Recorded ${tool.type}.`);
  }, [addAction, flushPendingInput, flushPendingScroll, showConfirmation]);

  const addManualAction = useCallback((type: 'hover' | 'circle', options: Partial<WalkthroughAction> = {}) => {
    addLocationActionAtPoint(
      {
        label: options.radius ? `Circle ${options.radius}` : type,
        options,
        type,
      },
      lastPointerRef.current,
    );
  }, [addLocationActionAtPoint]);

  const addTooltipToggle = useCallback(() => {
    flushPendingInput();
    flushPendingScroll();
    const enabled = !tooltipEnabledRef.current;
    tooltipEnabledRef.current = enabled;
    setWalkthroughHoverEffectsEnabled(enabled);
    addAction({
      enabled,
      pauseMs: enabled ? 900 : 450,
      type: 'tooltip',
    }, `Recorded hover effects ${enabled ? 'enabled' : 'disabled'}.`);
  }, [addAction, flushPendingInput, flushPendingScroll]);

  const addScrollMarker = useCallback(() => {
    flushPendingInput();
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = undefined;
    }
    pendingScrollTopRef.current = undefined;
    addAction({
      durationMs: 800,
      pauseMs: 950,
      scrollTop: round(window.scrollY),
      type: 'scroll',
    }, `Recorded scroll marker at ${round(window.scrollY)}px.`);
  }, [addAction, flushPendingInput]);

  const hideCircleSizeMenu = useCallback((delay = true) => {
    if (circleSizeMenuTimerRef.current) {
      window.clearTimeout(circleSizeMenuTimerRef.current);
      circleSizeMenuTimerRef.current = undefined;
    }
    if (!delay) {
      setCircleSizeMenuVisible(false);
      return;
    }
    circleSizeMenuTimerRef.current = window.setTimeout(() => {
      circleSizeMenuTimerRef.current = undefined;
      setCircleSizeMenuVisible(false);
    }, CIRCLE_SIZE_MENU_CLOSE_DELAY_MS);
  }, []);

  const queueCircleSizeMenu = useCallback(() => {
    if (recorderView !== 'recording' || playbackActive) return;
    if (circleSizeMenuTimerRef.current) {
      window.clearTimeout(circleSizeMenuTimerRef.current);
      circleSizeMenuTimerRef.current = undefined;
    }
    circleSizeMenuTimerRef.current = window.setTimeout(() => {
      circleSizeMenuTimerRef.current = undefined;
      if (!playbackActive && recorderView === 'recording') {
        setCircleSizeMenuVisible(true);
      }
    }, CIRCLE_SIZE_MENU_DELAY_MS);
  }, [playbackActive, recorderView]);

  const startLocationToolDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, tool: LocationTool) => {
    event.preventDefault();
    event.stopPropagation();
    if (recorderView !== 'recording' || playbackActive) return;
    hideCircleSizeMenu(false);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    setDragTool(tool);
    setDragPoint({
      targetLabel: getDragTargetLabel(element),
      valid: Boolean(element && !isRecorderElement(element)),
      x: event.clientX,
      y: event.clientY,
    });
    showConfirmation(`Drag ${tool.label} onto the page.`);
  }, [hideCircleSizeMenu, playbackActive, recorderView, showConfirmation]);

  const startPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    panelDragRef.current = {
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startPanelX: panelPosition.x,
      startPanelY: panelPosition.y,
    };
  }, [panelPosition.x, panelPosition.y]);

  useEffect(() => {
    if (recorderView !== 'recording' || playbackActive) {
      hideCircleSizeMenu(false);
    }
  }, [hideCircleSizeMenu, playbackActive, recorderView]);

  const generatedPlan = useMemo<WalkthroughPlan>(() => ({
    cursor: cursorSettings,
    defaults: basePlan.defaults,
    description: 'Generated with the Walkthrough Studio. Review captions and targets before final playback.',
    exportFrame,
    scenes: [
      {
        actions,
        caption: '',
        id: 'recording',
      },
    ],
    start: {
      x: round(lastPointerRef.current.x || basePlan.start.x),
      y: round(lastPointerRef.current.y || basePlan.start.y),
    },
    title: DEFAULT_RECORDING_NAME,
  }), [actions, basePlan, cursorSettings, exportFrame]);

	  const getCurrentPlan = useCallback(() => ({
	    ...generatedPlan,
	    scenes: [{
	      ...generatedPlan.scenes[0],
	      actions: ensureActionStateSnapshots(
          normalizeTimelineActions(actionsRef.current),
          tooltipEnabledRef.current,
          timelineBaselineRef.current,
        ),
	    }],
	  }), [generatedPlan]);

  const openPreviewPlan = useCallback((plan: WalkthroughPlan, options?: { startFrameIndex?: number }) => {
    savePreviewPlan(plan);
    onPreviewPlan?.(plan, options);
  }, [onPreviewPlan]);

  const getNamedCurrentPlan = useCallback((name: string) => {
    const trimmedName = name.trim() || DEFAULT_RECORDING_NAME;
    return {
      ...getCurrentPlan(),
      description: 'Saved from the walkthrough recorder library. Review captions and targets before final playback.',
      title: trimmedName,
    };
  }, [getCurrentPlan]);

  const previewPlanFrom = useCallback((startFrameIndex = 0) => {
    flushPendingInput();
    flushPendingScroll();
    openPreviewPlan(getNamedCurrentPlan(recordingName), { startFrameIndex });
    setStatus(startFrameIndex > 0 ? `Watching draft from action ${startFrameIndex + 1}.` : 'Watching draft from the beginning.');
  }, [flushPendingInput, flushPendingScroll, getNamedCurrentPlan, openPreviewPlan, recordingName]);

  const handlePlayPause = useCallback(() => {
    if (playbackActive) {
      resumeFrameIndexRef.current = Math.max(0, playbackActionIndex ?? 0);
      onStopPlayback?.();
      clearWalkthroughHoverEffectsState();
      updateRecorderMode('paused');
      setStatus('Paused playback.');
      return;
    }
    if (!actionsRef.current.length) {
      setStatus('No recorded actions yet.');
      return;
    }
    updateRecorderMode('paused');
    const nextIndex = resumeFrameIndexRef.current ?? selectedActionIndexRef.current + 1;
    resumeFrameIndexRef.current = undefined;
    previewPlanFrom(nextIndex < actionsRef.current.length ? nextIndex : 0);
  }, [onStopPlayback, playbackActionIndex, playbackActive, previewPlanFrom, updateRecorderMode]);

  const toggleRecordMode = useCallback(() => {
    if (playbackActive) {
      onStopPlayback?.();
      clearWalkthroughHoverEffectsState();
    }
    if (recorderModeRef.current === 'recording') {
      flushPendingInput();
      flushPendingScroll();
      updateRecorderMode('paused');
      setStatus('Recording paused.');
      return;
    }
    updateRecorderMode('recording');
    lastRecordedAtRef.current = window.performance.now();
    setStatus('Recording from current state.');
  }, [flushPendingInput, flushPendingScroll, onStopPlayback, playbackActive, updateRecorderMode]);

  const updateLastPointer = useCallback((point: { x: number; y: number }) => {
    lastPointerRef.current = {
      element: typeof document !== 'undefined' ? document.elementFromPoint(point.x, point.y) : null,
      x: point.x,
      y: point.y,
    };
  }, []);

  const updateTooltipEnabled = useCallback((enabled: boolean) => {
    tooltipEnabledRef.current = enabled;
    setWalkthroughHoverEffectsEnabled(enabled);
  }, []);

  const restoreInitialState = useCallback(async () => {
    resumeFrameIndexRef.current = undefined;
    if (playbackActive) onStopPlayback?.();
    clearWalkthroughHoverEffectsState();
    updateRecorderMode('paused');
    selectActionIndex(START_STATE_INDEX);
    setDragTool(null);
    restoringStateRef.current = true;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
    pendingScrollTopRef.current = undefined;
    pendingInputRef.current = undefined;
    try {
      const snapshot = timelineBaselineRef.current
        || getActionStateBaseline(actionsRef.current, 0)
        || createWalkthroughStateSnapshot([], tooltipEnabledRef.current);
      await restoreWalkthroughSnapshotBoundary(snapshot, {
        setTooltipEnabled: updateTooltipEnabled,
      });
      setStatus('Paused at starting state.');
    } finally {
      window.setTimeout(() => {
        restoringStateRef.current = false;
      }, 0);
    }
  }, [onStopPlayback, playbackActive, selectActionIndex, updateRecorderMode, updateTooltipEnabled]);

  const restoreActionStateAtIndex = useCallback(async (index: number) => {
    resumeFrameIndexRef.current = undefined;
    const action = actionsRef.current[index];
    if (!action) return;
    if (playbackActive) onStopPlayback?.();
    clearWalkthroughHoverEffectsState();
    updateRecorderMode('paused');
    selectActionIndex(index);
    setDragTool(null);
    restoringStateRef.current = true;
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
    pendingScrollTopRef.current = undefined;
    pendingInputRef.current = undefined;
    try {
      await restoreWalkthroughTimelineBoundary({
        actions: actionsRef.current,
        baselineSnapshot: timelineBaselineRef.current,
        getTooltipEnabled: () => tooltipEnabledRef.current,
        includeActionEnd: true,
        index,
        onPointerChange: ({ point }) => updateLastPointer(point),
        setTooltipEnabled: updateTooltipEnabled,
      });
      setStatus(`Paused at action ${index + 1}.`);
    } finally {
      window.setTimeout(() => {
        restoringStateRef.current = false;
      }, 0);
    }
  }, [onStopPlayback, playbackActive, selectActionIndex, updateLastPointer, updateRecorderMode, updateTooltipEnabled]);

  const savingRef = useRef<Promise<WalkthroughSavedRecording | undefined>>();
  const saveCurrentRecording = useCallback((options: { announce?: boolean; forceNew?: boolean } = {}) => {
    if (savingRef.current) return savingRef.current;
    const operation = async () => {
    flushPendingInput();
    flushPendingScroll();
    const nextExportFrame = normalizeExportFrame(exportFrame);
    const planToSave = {
      ...getNamedCurrentPlan(recordingName),
      exportFrame: nextExportFrame,
    };
    setExportFrame(nextExportFrame);
    const signatureToSave = getRecordingSignature(actionsRef.current, cursorSettings, nextExportFrame, recordingName);
    const savedRecording = await saveRecording(
      planToSave,
      recordingName,
      options.forceNew ? undefined : activeSavedRecordingId,
    );
    if (!savedRecording) {
      setStatus('Could not save recording in this browser.');
      return;
    }
    setSavedRecordings(loadSavedRecordings());
    setActiveSavedRecordingId(savedRecording.id);
    setRecordingName(current => current === recordingName ? savedRecording.name : current);
    // Compare against the draft that was saved. Serialization can normalize its
    // snapshots; comparing that output to the draft would retrigger autosave.
    setSavedSignature(signatureToSave);
    const message = options.forceNew ? `Saved new recording: ${savedRecording.name}.` : `Saved recording: ${savedRecording.name}.`;
    setStatus(message);
    if (options.announce) showConfirmation('Recording saved.');
    return savedRecording;
    };
    savingRef.current = operation().catch((error) => {
      setStatus(`Recording not saved: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }).finally(() => { savingRef.current = undefined; });
    return savingRef.current;
  }, [
    activeSavedRecordingId,
    cursorSettings,
    exportFrame,
    flushPendingInput,
    flushPendingScroll,
    getNamedCurrentPlan,
    recordingName,
    showConfirmation,
  ]);

  useEffect(() => {
    if (!active || recorderView !== 'recording' || (actions.length === 0 && !activeSavedRecordingId)) return undefined;
    if (currentSignature === savedSignature) return undefined;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = undefined;
      saveCurrentRecording();
    }, 650);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = undefined;
      }
    };
  }, [
    active,
    activeSavedRecordingId,
    actions.length,
    currentSignature,
    recorderView,
    saveCurrentRecording,
    savedSignature,
  ]);

  const startNewRecording = useCallback(() => {
    resumeFrameIndexRef.current = undefined;
    updateActions([]);
    setActiveSavedRecordingId(undefined);
    setRecordingName(`Recording ${savedRecordings.length + 1}`);
    setSavedSignature('');
    setExportFrame(getCurrentExportFrame());
    setActiveExportJob(undefined);
    setCursorSettingsOpen(false);
    setExportMenuOpen(false);
    lastClickRef.current = undefined;
    tooltipEnabledRef.current = true;
    setWalkthroughHoverEffectsEnabled(true);
    timelineBaselineRef.current = createWalkthroughStateSnapshot([], tooltipEnabledRef.current);
    lastAppStateSignatureRef.current = getAppStateSignature(captureWalkthroughAppState());
    lastRecordedAtRef.current = window.performance.now();
    lastClickRef.current = undefined;
    setRecorderView('recording');
    updateRecorderMode('paused');
    setStatus('Recording paused.');
    showConfirmation('New recording ready.');
  }, [savedRecordings.length, showConfirmation, updateActions, updateRecorderMode]);

  const returnToOverview = useCallback(async () => {
    const savedNow = (actionsRef.current.length > 0 || activeSavedRecordingId) ? await saveCurrentRecording() : undefined;
    if ((actionsRef.current.length > 0 || activeSavedRecordingId) && !savedNow) return;
    const savedRecording = savedNow || (activeSavedRecordingId
      ? savedRecordings.find((recording) => recording.id === activeSavedRecordingId)
      : undefined);
    updateActions([]);
    timelineBaselineRef.current = savedRecording
      ? getActionStateBaseline(savedRecording.plan.scenes.flatMap((scene) => scene.actions))
      : undefined;
    if (savedRecording) {
      setActiveSavedRecordingId(savedRecording.id);
      setRecordingName(savedRecording.name);
      setSavedSignature(getRecordingSignature(
        savedRecording.plan.scenes.flatMap((scene) => scene.actions),
        savedRecording.plan.cursor || cursorSettings,
        normalizeExportFrame(savedRecording.plan.exportFrame || exportFrame),
        savedRecording.name,
      ));
      setExportFrame(normalizeExportFrame(savedRecording.plan.exportFrame || exportFrame));
    } else {
      setActiveSavedRecordingId(undefined);
      setRecordingName(DEFAULT_RECORDING_NAME);
      setSavedSignature('');
    }
    setRecorderView('library');
    setCursorSettingsOpen(false);
    setExportMenuOpen(false);
    updateRecorderMode('paused');
    setStatus(savedRecording ? `Returned to overview: ${savedRecording.name}.` : 'Returned to recordings overview.');
  }, [activeSavedRecordingId, cursorSettings, exportFrame, saveCurrentRecording, savedRecordings, updateActions, updateRecorderMode]);

  const loadRecordingIntoEditor = useCallback((recording: WalkthroughSavedRecording) => {
    const recordedActions = normalizeTimelineActions(recording.plan.scenes.flatMap((scene) => scene.actions));
    const nextActions = ensureActionStateSnapshots(
      recordedActions,
      getLastTooltipEnabled(recordedActions),
    );
    timelineBaselineRef.current = getActionStateBaseline(nextActions);
    updateActions(nextActions);
    selectActionIndex(START_STATE_INDEX);
    if (recording.plan.cursor) {
      setCursorSettings(recording.plan.cursor);
      saveCursorSettings(recording.plan.cursor);
    }
    if (recording.plan.start) {
      lastPointerRef.current = {
        element: null,
        x: recording.plan.start.x,
        y: recording.plan.start.y,
      };
    }
    const nextExportFrame = normalizeExportFrame(recording.plan.exportFrame || getCurrentExportFrame());
    setExportFrame(nextExportFrame);
    tooltipEnabledRef.current = getLastTooltipEnabled(nextActions);
    setWalkthroughHoverEffectsEnabled(tooltipEnabledRef.current);
    setActiveSavedRecordingId(recording.id);
    setRecordingName(recording.name);
    setSavedSignature(getRecordingSignature(nextActions, recording.plan.cursor || cursorSettings, nextExportFrame, recording.name));
    setCursorSettingsOpen(false);
    setExportMenuOpen(false);
    lastAppStateSignatureRef.current = getAppStateSignature(captureWalkthroughAppState());
    lastRecordedAtRef.current = window.performance.now();
    setRecorderView('recording');
    updateRecorderMode('paused');
    void restoreInitialState();
    setStatus(`Loaded recording: ${recording.name}.`);
  }, [cursorSettings, restoreInitialState, selectActionIndex, updateActions, updateRecorderMode]);

  const openedInitialRecording = useRef(false);
  useEffect(() => {
    const id = runtimeConfig()?.recordingId;
    if (!active || openedInitialRecording.current || !id) return;
    openedInitialRecording.current = true;
    const recording = savedRecordings.find(item => item.id === id);
    if (recording) loadRecordingIntoEditor(recording);
    else setStatus('The requested recording no longer exists.');
  }, [active, savedRecordings, loadRecordingIntoEditor]);

  const toggleExportLanguage = useCallback((language: string) => {
    setExportLanguages((current) => {
      if (current.includes(language)) {
        const next = current.filter((item) => item !== language);
        return next.length ? next : current;
      }
      return [...current, language];
    });
  }, []);

  const exportCurrentRecording = useCallback(async () => {
    setExportStartError('');
    if (actionsRef.current.length === 0) {
      setStatus('Record at least one action before exporting.');
      return;
    }
    if (!exportServiceAvailable) {
      setStatus('Browser export is not connected to the local video exporter.');
      return;
    }
    try {
      const savedRecording = await saveCurrentRecording();
      if (!savedRecording) return;
      const plan = savedRecording?.plan || getNamedCurrentPlan(recordingName);
      const name = savedRecording?.name || recordingName;
      const job = await createWalkthroughExportJob(plan, name, exportLanguages, {
        fps: exportFps,
        quality: exportQuality,
        resolution: exportResolution,
      });
      setActiveExportJob(job);
      setStatus(`Started export for ${exportLanguages.join(', ').toUpperCase()}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start export.';
      setExportStartError(message);
      setStatus(message);
      showConfirmation('Export could not start. See the explanation in the export dialog.');
    }
  }, [
    exportLanguages,
    exportFps,
    exportQuality,
    exportResolution,
    exportServiceAvailable,
    getNamedCurrentPlan,
    recordingName,
    saveCurrentRecording,
    showConfirmation,
  ]);

  const cancelActiveExport = useCallback(async () => {
    const job = activeExportJob;
    if (!job || !['queued', 'running'].includes(job.status)) {
      setExportMenuOpen(false);
      return;
    }
    try {
      await cancelWalkthroughExportJob(job.id);
      setStatus('Export canceled.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not cancel export.');
    } finally {
      setActiveExportJob(undefined);
      setExportMenuOpen(false);
    }
  }, [activeExportJob]);

  const finishCompletedExport = useCallback(() => {
    const completedPath = activeExportJob?.outputPath || activeExportJob?.outputDir;
    setActiveExportJob(undefined);
    setExportMenuOpen(false);
    if (completedPath) {
      setStatus(`Export complete: ${completedPath}`);
    }
  }, [activeExportJob?.outputDir, activeExportJob?.outputPath]);

  const deleteRecordingFromLibrary = useCallback(async (recording: WalkthroughSavedRecording) => {
    if (!window.confirm(`Delete saved recording "${recording.name}"?`)) return;
    let nextRecordings;
    try { nextRecordings = await deleteSavedRecording(recording.id); }
    catch (error) { setStatus(`Could not delete: ${String(error)}`); return; }
    setSavedRecordings(nextRecordings);
    if (activeSavedRecordingId === recording.id) {
      setActiveSavedRecordingId(undefined);
      setSavedSignature('');
    }
    const message = `Deleted saved recording: ${recording.name}.`;
    setStatus(message);
    showConfirmation('Recording deleted.');
  }, [activeSavedRecordingId, showConfirmation]);

  const deleteActionAtIndex = useCallback((index: number) => {
    if (index < 0 || index >= actionsRef.current.length) return;
    const nextActions = actionsRef.current.filter((_, actionIndex) => actionIndex !== index);
    tooltipEnabledRef.current = getLastTooltipEnabled(nextActions);
    setWalkthroughHoverEffectsEnabled(tooltipEnabledRef.current);
    updateActions(nextActions);
    selectActionIndex(nextActions.length ? Math.max(0, Math.min(index, nextActions.length - 1)) : 0);
    const message = `Deleted action ${index + 1}.`;
    setStatus(message);
    showConfirmation(message);
  }, [selectActionIndex, showConfirmation, updateActions]);

  useEffect(() => {
    if (!active) return undefined;
    if (recorderView === 'recording') {
      tooltipEnabledRef.current = true;
      setWalkthroughHoverEffectsEnabled(true);
    }

    const recordPointer = (event: PointerEvent) => {
      if (recorderView !== 'recording' || playbackActive) return;
      if (restoringStateRef.current) return;
      if (dragToolRef.current || panelDragRef.current) return;
      if (isRecorderElement(event.target)) return;
      lastPointerRef.current = {
        element: event.target instanceof Element ? event.target : null,
        x: event.clientX,
        y: event.clientY,
      };
    };

    const recordClick = (event: MouseEvent) => {
      if (recorderView !== 'recording' || playbackActive) return;
      if (recorderModeRef.current !== 'recording' || restoringStateRef.current) return;
      if (!event.isTrusted || event.detail > 1) return;
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (isRecorderElement(event.target)) return;
      flushPendingInput();
      flushPendingScroll();
      const point = {
        element: event.target instanceof Element ? event.target : null,
        x: event.clientX,
        y: event.clientY,
      };
      const clickAction = buildTargetedAction('click', point);
      const signature = getClickActionSignature(clickAction);
      const now = window.performance.now();
      if (
        lastClickRef.current?.signature === signature
        && now - lastClickRef.current.at < 450
      ) {
        return;
      }
      lastClickRef.current = { at: now, signature };
      addAction(clickAction, 'Recorded click.');
    };

    const recordScroll = () => {
      if (recorderView !== 'recording' || playbackActive) return;
      if (recorderModeRef.current !== 'recording' || restoringStateRef.current) return;
      pendingScrollTopRef.current = window.scrollY;
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(flushPendingScroll, 360);
    };

    const recordInput = (event: Event) => {
      if (recorderView !== 'recording' || playbackActive) return;
      if (recorderModeRef.current !== 'recording' || restoringStateRef.current) return;
      if (isRecorderElement(event.target)) return;
      if (!event.isTrusted) return;
      const text = getInputText(event.target);
      if (typeof text !== 'string') return;
      const element = event.target instanceof Element ? event.target : undefined;
      if (element instanceof HTMLInputElement && element.type === 'password') return;
      if (!element || !getNamedTarget(element)) return;
      pendingInputRef.current = { element, text };
      if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
      inputTimerRef.current = window.setTimeout(flushPendingInput, 700);
    };

    const recordShortcut = (event: KeyboardEvent) => {
      if (recorderView !== 'recording' || playbackActive) return;
      if (restoringStateRef.current) return;
      if (isRecorderElement(event.target)) return;
      if (event.key.toLowerCase() === 's' && event.shiftKey) {
        event.preventDefault();
        addScrollMarker();
      }
      if (event.key.toLowerCase() === 'h' && event.shiftKey) {
        addManualAction('hover');
      }
      if (event.key.toLowerCase() === 'c' && event.shiftKey) {
        addManualAction('circle');
      }
      if (/^[1-9]$/.test(event.key) && event.shiftKey) {
        event.preventDefault();
        const level = Number(event.key);
        addManualAction('circle', { radius: getCircleRadiusForLevel(level) });
      }
      if (event.key.toLowerCase() === 't' && event.shiftKey) {
        addTooltipToggle();
      }
    };

    const handleGlobalPointerMove = (event: PointerEvent) => {
      if (recorderView === 'recording' && !playbackActive && dragToolRef.current) {
        event.preventDefault();
        const element = document.elementFromPoint(event.clientX, event.clientY);
        setDragPoint({
          targetLabel: getDragTargetLabel(element),
          valid: Boolean(element && !isRecorderElement(element)),
          x: event.clientX,
          y: event.clientY,
        });
      }
      const panelDrag = panelDragRef.current;
      if (panelDrag) {
        event.preventDefault();
        setPanelPosition({
          x: clamp(panelDrag.startPanelX + event.clientX - panelDrag.startMouseX, 8, window.innerWidth - 96),
          y: clamp(panelDrag.startPanelY + event.clientY - panelDrag.startMouseY, 8, window.innerHeight - 64),
        });
      }
    };

    const handleGlobalPointerUp = (event: PointerEvent) => {
      const activeTool = dragToolRef.current;
      if (recorderView === 'recording' && !playbackActive && activeTool) {
        event.preventDefault();
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const validDrop = Boolean(element && !isRecorderElement(element));
        setDragTool(null);
        if (!validDrop) {
          showConfirmation('Drop on the page, not the recorder panel.');
          return;
        }
        dropFeedbackIdRef.current += 1;
        setDropFeedback({
          id: dropFeedbackIdRef.current,
          x: event.clientX,
          y: event.clientY,
        });
        addLocationActionAtPoint(activeTool, {
          element,
          x: event.clientX,
          y: event.clientY,
        });
      }
      if (panelDragRef.current) {
        event.preventDefault();
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
        panelDragRef.current = null;
      }
    };

    document.addEventListener('pointermove', recordPointer, true);
    document.addEventListener('pointermove', handleGlobalPointerMove, true);
    document.addEventListener('pointerup', handleGlobalPointerUp, true);
    document.addEventListener('click', recordClick, true);
    document.addEventListener('input', recordInput, true);
    document.addEventListener('keydown', recordShortcut, true);
    window.addEventListener('scroll', recordScroll, { passive: true });

    return () => {
      document.removeEventListener('pointermove', recordPointer, true);
      document.removeEventListener('pointermove', handleGlobalPointerMove, true);
      document.removeEventListener('pointerup', handleGlobalPointerUp, true);
      document.removeEventListener('click', recordClick, true);
      document.removeEventListener('input', recordInput, true);
      document.removeEventListener('keydown', recordShortcut, true);
      window.removeEventListener('scroll', recordScroll);
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      if (inputTimerRef.current) window.clearTimeout(inputTimerRef.current);
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      if (confirmationTimerRef.current) window.clearTimeout(confirmationTimerRef.current);
      if (circleSizeMenuTimerRef.current) window.clearTimeout(circleSizeMenuTimerRef.current);
      clearWalkthroughHoverEffectsState();
    };
  }, [
    active,
    addAction,
    addLocationActionAtPoint,
    addManualAction,
    addScrollMarker,
    addTooltipToggle,
    flushPendingInput,
    flushPendingScroll,
    playbackActive,
    recorderView,
    showConfirmation,
  ]);

  if (!active) return null;

  const panelMode = playbackActive ? 'playing' : recorderMode;

  return (
    <>
      <RecorderConfirmation $visible={Boolean(confirmation)}>{confirmation}</RecorderConfirmation>
      <DragGhost
        $valid={dragPoint.valid}
        $visible={Boolean(dragTool)}
        $x={dragPoint.x}
        $y={dragPoint.y}
      >
        {dragTool ? `${dragTool.label} -> ${dragPoint.targetLabel}` : ''}
      </DragGhost>
      {dropFeedback ? (
        <DragDropHalo
          key={dropFeedback.id}
          $visible
          $x={dropFeedback.x}
          $y={dropFeedback.y}
        />
      ) : null}
      {recorderView === 'recording' && cursorSettingsOpen ? (
        <RecorderCursorPreviewOverlay aria-hidden='true' data-walkthrough-cursor-preview='true'>
          <RecorderCursorPreview
            $opacity={cursorSettings.opacity}
            $shadow={cursorSettings.shadow}
            $shape={cursorSettings.shape}
            $size={cursorSettings.size}
          >
            <CursorGraphic
              borderColor={cursorSettings.borderColor}
              fillColor={cursorSettings.fillColor}
              outlineWidth={cursorSettings.outlineWidth}
              shape={cursorSettings.shape}
            />
          </RecorderCursorPreview>
        </RecorderCursorPreviewOverlay>
      ) : null}
      <RecorderPanel data-walkthrough-recorder='true' $x={panelPosition.x} $y={panelPosition.y}>
        {/(not saved|could not|failed|no longer exists)/i.test(status) ? <div role='alert' style={{ padding: 12, color: '#a12828', background: '#fff0ee' }}>{status}</div> : null}
        <RecorderHeader onPointerDown={startPanelDrag}>
          <RecorderHeaderLeft>
            {recorderView === 'recording' ? (
              <RecorderBackButton
                aria-label='Back to overview'
                title='Back to overview'
                type='button'
                onClick={returnToOverview}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <ArrowLeft aria-hidden='true' />
              </RecorderBackButton>
            ) : null}
            <RecorderTitle $prominent={recorderView === 'library'}>
              {recorderView === 'recording' ? getPanelRecordingTitle(recordingName) : 'Studio'}
              {recorderView === 'recording' ? (
                <RecorderStatePill>{panelMode}</RecorderStatePill>
              ) : null}
            </RecorderTitle>
          </RecorderHeaderLeft>
          {recorderView === 'library' ? (
            <RecorderHeaderActions onPointerDown={(event) => event.stopPropagation()}>
              <RecorderAddButton
                aria-label='Record new'
                title='Record new'
                type='button'
                onClick={startNewRecording}
              >
                <Plus aria-hidden='true' />
              </RecorderAddButton>
            </RecorderHeaderActions>
          ) : null}
          {recorderView === 'recording' ? (
            <RecorderHeaderActions onPointerDown={(event) => event.stopPropagation()}>
              <RecorderHeaderMenuWrap ref={cursorSettingsMenuRef}>
                <RecorderHeaderMenuButton
                  $active={cursorSettingsOpen}
                  aria-expanded={cursorSettingsOpen}
                  aria-label='Cursor settings'
                  title='Cursor settings'
                  type='button'
                  onClick={() => {
                    if (exportCompleted) return;
                    setCursorSettingsOpen((current) => !current);
                    setExportMenuOpen(false);
                  }}
                >
                  <Settings aria-hidden='true' />
                </RecorderHeaderMenuButton>
                {cursorSettingsOpen ? (
                  <RecorderHeaderMenuPopover>
                    <RecorderControlGrid>
                      <RecorderField>
                        Shape
                        <RecorderSelect
                          value={cursorSettings.shape}
                          onChange={(event) => updateCursorSetting('shape', event.target.value as WalkthroughCursorSettings['shape'])}
                        >
                          {CURSOR_SHAPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </RecorderSelect>
                      </RecorderField>
                      <RecorderField>
                        Shadow
                        <RecorderSelect
                          value={cursorSettings.shadow}
                          onChange={(event) => updateCursorSetting('shadow', event.target.value as WalkthroughCursorSettings['shadow'])}
                        >
                          {CURSOR_SHADOW_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </RecorderSelect>
                      </RecorderField>
                      <RecorderField>
                        Size
                        <RecorderFieldValue>{cursorSettings.size}px</RecorderFieldValue>
                        <RecorderRangeInput
                          max='128'
                          min='24'
                          step='1'
                          type='range'
                          value={cursorSettings.size}
                          onChange={(event) => updateCursorSetting('size', Number(event.target.value))}
                        />
                      </RecorderField>
                      <RecorderField>
                        Opacity
                        <RecorderFieldValue>{Math.round(cursorSettings.opacity * 100)}%</RecorderFieldValue>
                        <RecorderRangeInput
                          max='100'
                          min='20'
                          step='1'
                          type='range'
                          value={Math.round(cursorSettings.opacity * 100)}
                          onChange={(event) => updateCursorSetting('opacity', Number(event.target.value) / 100)}
                        />
                      </RecorderField>
                      <RecorderField>
                        Fill color
                        <RecorderColorInput
                          aria-label='Cursor fill color'
                          type='color'
                          value={cursorSettings.fillColor}
                          onChange={(event) => updateCursorSetting('fillColor', event.target.value)}
                        />
                      </RecorderField>
                      <RecorderField>
                        Outline color
                        <RecorderColorInput
                          aria-label='Cursor outline color'
                          type='color'
                          value={cursorSettings.borderColor}
                          onChange={(event) => updateCursorSetting('borderColor', event.target.value)}
                        />
                      </RecorderField>
                      <RecorderField>
                        Outline thickness
                        <RecorderFieldValue>{cursorSettings.outlineWidth}%</RecorderFieldValue>
                        <RecorderRangeInput
                          max='12'
                          min='0'
                          step='1'
                          type='range'
                          value={cursorSettings.outlineWidth}
                          onChange={(event) => updateCursorSetting('outlineWidth', Number(event.target.value))}
                        />
                      </RecorderField>
                      <RecorderField>
                        Click pulse
                        <RecorderColorInput
                          aria-label='Click pulse color'
                          type='color'
                          value={cursorSettings.clickColor}
                          onChange={(event) => updateCursorSetting('clickColor', event.target.value)}
                        />
                      </RecorderField>
                    </RecorderControlGrid>
                  </RecorderHeaderMenuPopover>
                ) : null}
              </RecorderHeaderMenuWrap>
              <RecorderHeaderMenuWrap ref={exportMenuRef}>
                <RecorderHeaderMenuButton
                  $active={exportMenuOpen}
                  aria-expanded={exportMenuOpen}
                  aria-label='Export'
                  disabled={runtimeConfig()?.videoExportEnabled === false}
                  title='Export'
                  type='button'
                  onClick={() => {
                    if (exportCompleted && exportMenuOpen) return;
                    setExportMenuOpen((current) => !current);
                    setCursorSettingsOpen(false);
                  }}
                >
                  <FileDown aria-hidden='true' />
                </RecorderHeaderMenuButton>
                {exportMenuOpen ? (
                  <RecorderExportBackdrop
                    role='presentation'
                    onClick={() => {
                      if (exportCompleted) return;
                      if (exportInProgress) {
                        void cancelActiveExport();
                        return;
                      }
                      setExportMenuOpen(false);
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <RecorderExportModal
                      role='dialog'
                      aria-modal='true'
                      aria-label='Export recording'
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <RecorderExportArea>
                        <RecorderExportHeaderRow>
                          <RecorderExportLanguageGrid aria-label='Export languages'>
                            {(runtimeConfig()?.languages || [...WALKTHROUGH_EXPORT_LANGUAGES]).map((language) => {
                              const languageProgress = exportLanguageProgress[language] || 0;
                              return (
                                <RecorderExportLanguageButton
                                  key={language}
                                  $active={exportLanguages.includes(language)}
                                  $exporting={exportInProgress && languageProgress > 0 && languageProgress < 100}
                                  $progress={languageProgress}
                                  disabled={exportInProgress || exportCompleted}
                                  type='button'
                                  onClick={() => toggleExportLanguage(language)}
                                >
                                  {language}
                                </RecorderExportLanguageButton>
                              );
                            })}
                          </RecorderExportLanguageGrid>
                          {!exportCompleted ? (
                            <RecorderPrimaryAction
                              disabled={actions.length === 0 || !exportServiceAvailable || exportInProgress}
                              type='button'
                              onClick={exportCurrentRecording}
                            >
                              Export
                            </RecorderPrimaryAction>
                          ) : null}
                        </RecorderExportHeaderRow>
                        <RecorderExportOptionRow>
                          <RecorderField>
                            Resolution
                            <RecorderSelect value={exportResolution}
                              disabled={exportInProgress || exportCompleted}
                              onChange={event => setExportResolution(event.target.value)}>
                              {EXPORT_RESOLUTION_OPTIONS.map(value => <option key={value} value={value}>{value === '4k' ? '4K' : value}</option>)}
                            </RecorderSelect>
                          </RecorderField>
                          <RecorderField>
                            FPS
                            <RecorderSelect
                              disabled={exportInProgress || exportCompleted}
                              value={exportFps}
                              onChange={(event) => setExportFps(Number(event.target.value))}
                            >
                              {WALKTHROUGH_EXPORT_FPS_OPTIONS.map((fps) => (
                                <option key={fps} value={fps}>
                                  {fps}
                                </option>
                              ))}
                            </RecorderSelect>
                          </RecorderField>
                          <RecorderField>
                            Quality
                            <RecorderSelect
                              disabled={exportInProgress || exportCompleted}
                              value={exportQuality}
                              onChange={(event) => setExportQuality(event.target.value)}
                            >
                              {WALKTHROUGH_EXPORT_QUALITY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </RecorderSelect>
                          </RecorderField>
                        </RecorderExportOptionRow>
                      {exportStartError ? (
                        <RecorderHelp role='alert' style={{ color: '#9f2424', whiteSpace: 'normal' }}>
                          {exportStartError}
                        </RecorderHelp>
                      ) : null}
                      {exportServiceMessage ? (
                        <RecorderLibraryMeta>{exportServiceMessage}</RecorderLibraryMeta>
                      ) : null}
                      {activeExportJob ? (
                        <RecorderExportProgressCard>
                          <RecorderLibraryTitle>
                            {activeExportJob.status === 'running'
                              ? ({ setup: 'Preparing browser', playback: 'Capturing recording', encode: 'Encoding video', finalizing: 'Finalizing video' }[activeExportJob.phase || ''] || 'Exporting')
                              : `Export ${activeExportJob.status}`}
                            {activeExportJob.currentLanguage ? ` - ${activeExportJob.currentLanguage.toUpperCase()}` : ''}
                          </RecorderLibraryTitle>
                          <RecorderExportProgressTrack>
                            <RecorderExportProgressFill $progress={activeExportJob.progress} />
                          </RecorderExportProgressTrack>
                          <RecorderLibraryMeta>
                            {activeExportJob.progress}% overall{activeExportJob.progressEstimated && activeExportJob.status === 'running' ? ' (estimated)' : ''}
                            {activeExportJob.phase === 'encode' && activeExportJob.encoding ? (
                              <span> · {activeExportJob.encoding.frames.toLocaleString()} / {activeExportJob.encoding.totalFrames.toLocaleString()} frames
                                {activeExportJob.encoding.encoder === 'h264_videotoolbox' ? ' · Apple hardware' : ' · Software encoder'}
                              </span>
                            ) : null}
                          </RecorderLibraryMeta>
                          {exportCompleted ? (
                            <>
                              <RecorderLibraryMeta>
                                Export complete. Output:
                                {' '}
                                {exportCompletedPath}
                              </RecorderLibraryMeta>
                              <ButtonRow>
                                <RecorderPrimaryAction
                                  type='button'
                                  onClick={finishCompletedExport}
                                >
                                  Done
                                </RecorderPrimaryAction>
                              </ButtonRow>
                            </>
                          ) : null}
                          {activeExportJob.error ? (
                            <RecorderLibraryMeta>Error: {activeExportJob.error}</RecorderLibraryMeta>
                          ) : null}
                          </RecorderExportProgressCard>
                        ) : null}
                      </RecorderExportArea>
                    </RecorderExportModal>
                  </RecorderExportBackdrop>
                ) : null}
              </RecorderHeaderMenuWrap>
            </RecorderHeaderActions>
          ) : null}
        </RecorderHeader>
        {recorderView === 'library' ? (
          <>
            <RecorderLibraryHeader>
              <RecorderSectionTitle>Recordings</RecorderSectionTitle>
            </RecorderLibraryHeader>
            {savedRecordings.length === 0 ? (
              <RecorderHelp>No recordings yet.</RecorderHelp>
            ) : (
              <RecorderLibraryList>
                {savedRecordings.map((recording) => {
                  return (
                    <RecorderLibraryItem
                      key={recording.id}
                      role='button'
                      tabIndex={0}
                      title='Open recording'
                      onClick={() => loadRecordingIntoEditor(recording)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          loadRecordingIntoEditor(recording);
                        }
                      }}
                    >
                      <div>
                        <RecorderLibraryTitle>{recording.name}</RecorderLibraryTitle>
                        <RecorderLibraryMeta>
                          {formatRecordingDate(recording.updatedAt)} - {recording.actionCount} actions
                        </RecorderLibraryMeta>
                      </div>
                      <RecorderLibraryDeleteButton
                        aria-label={`Delete ${recording.name}`}
                        title='Delete'
                        type='button'
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteRecordingFromLibrary(recording);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      />
                    </RecorderLibraryItem>
                  );
                })}
              </RecorderLibraryList>
            )}
          </>
        ) : (
          <>
        <RecorderInlineForm>
          <RecorderTextInput
            aria-label='Recording name'
            placeholder='Recording name'
            type='text'
            value={recordingName}
            onChange={(event) => setRecordingName(event.target.value)}
          />
          <RecorderPlayButton
            aria-label={playbackActive ? 'Pause playback' : 'Play recording'}
            disabled={!playbackActive && actions.length === 0}
            title={playbackActive ? 'Pause playback' : 'Play recording'}
            type='button'
            onClick={handlePlayPause}
          >
            {playbackActive ? <Pause aria-hidden='true' /> : <Play aria-hidden='true' />}
          </RecorderPlayButton>
          <RecorderRecordButton
            aria-label={panelMode === 'recording' ? 'Stop recording' : 'Record from current state'}
            aria-pressed={panelMode === 'recording'}
            title={panelMode === 'recording' ? 'Stop recording' : 'Record from current state'}
            type='button'
            onClick={toggleRecordMode}
          />
        </RecorderInlineForm>
        <RecorderToolDock aria-label='Recording tools'>
          <RecorderCircleButton
            aria-label='Mark current scroll position'
            disabled={panelMode === 'playing'}
            title='Mark current scroll position'
            type='button'
            onClick={addScrollMarker}
          >
            <ScrollText aria-hidden='true' />
          </RecorderCircleButton>
          <RecorderCircleButton
            aria-label='Toggle hover effects'
            disabled={panelMode === 'playing'}
            title='Toggle hover effects'
            type='button'
            onClick={addTooltipToggle}
          >
            <MessageSquareText aria-hidden='true' />
          </RecorderCircleButton>
          <RecorderCircleDragButton
            aria-label='Drag hover target'
            disabled={panelMode === 'playing'}
            title='Drag hover target'
            type='button'
            onPointerDown={(event) => startLocationToolDrag(event, { label: 'Hover', type: 'hover' })}
          >
            <Hand aria-hidden='true' />
          </RecorderCircleDragButton>
          <RecorderCirclePicker
            onBlur={(event) => {
              const nextTarget = event.relatedTarget;
              if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                hideCircleSizeMenu();
              }
            }}
            onPointerLeave={() => hideCircleSizeMenu()}
          >
            <RecorderCircleDragButton
              aria-label='Drag default circle target'
              disabled={panelMode === 'playing'}
              title='Drag default circle target'
              type='button'
              onPointerDown={(event) => startLocationToolDrag(event, { label: 'Circle', type: 'circle' })}
            >
              <Circle aria-hidden='true' />
            </RecorderCircleDragButton>
            <RecorderCircleSizeHandle
              aria-expanded={circleSizeMenuVisible}
              aria-haspopup='menu'
              aria-label='Open circle size picker'
              disabled={panelMode === 'playing'}
              title='Circle sizes'
              type='button'
              onClick={() => {
                if (circleSizeMenuVisible) {
                  hideCircleSizeMenu(false);
                  return;
                }
                queueCircleSizeMenu();
              }}
              onFocus={queueCircleSizeMenu}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={queueCircleSizeMenu}
            >
              <ChevronRight aria-hidden='true' />
            </RecorderCircleSizeHandle>
            <RecorderCircleSizeMenu
              $visible={circleSizeMenuVisible}
              aria-hidden={!circleSizeMenuVisible}
              onPointerEnter={queueCircleSizeMenu}
              onPointerLeave={() => hideCircleSizeMenu()}
            >
              {CIRCLE_SIZE_LEVELS.map((level, index) => {
                const offset = getCircleSizeMenuOffset(index);
                return (
                  <RecorderCircleSizeButton
                    key={level}
                    $x={offset.x}
                    $y={offset.y}
                    disabled={panelMode === 'playing'}
                    tabIndex={circleSizeMenuVisible ? 0 : -1}
                    title={`Drag circle size ${level}`}
                    type='button'
                    onPointerDown={(event) => startLocationToolDrag(event, {
                      label: `Circle ${level}`,
                      options: { radius: getCircleRadiusForLevel(level) },
                      type: 'circle',
                    })}
                  >
                    {level}
                  </RecorderCircleSizeButton>
                );
              })}
            </RecorderCircleSizeMenu>
          </RecorderCirclePicker>
        </RecorderToolDock>
        <RecorderTimelineHeader>
          <RecorderSectionTitle>Action timeline</RecorderSectionTitle>
          <RecorderTimelineHint>{actions.length + 1} states</RecorderTimelineHint>
        </RecorderTimelineHeader>
        <RecorderActionLog ref={actionLogRef}>
          <RecorderActionLogItem
            key='start-state'
            $active={activeActionIndex === START_STATE_INDEX}
            data-walkthrough-action-active={activeActionIndex === START_STATE_INDEX ? 'true' : undefined}
            data-walkthrough-action-index={START_STATE_INDEX}
            role='button'
            tabIndex={0}
            onClick={() => {
              restoreInitialState();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                restoreInitialState();
              }
            }}
          >
            <RecorderActionIndex>1</RecorderActionIndex>
            <RecorderActionBody>
              <RecorderActionText>
                <RecorderActionBadge>state</RecorderActionBadge>
                {' '}
                Starting state
              </RecorderActionText>
              <RecorderActionMeta>Initial screen condition before action 1</RecorderActionMeta>
            </RecorderActionBody>
            <RecorderActionControls />
          </RecorderActionLogItem>
          {actions.map((action, index) => {
            const entry = getActionLogEntry(action);
            return (
              <RecorderActionLogItem
                key={`${action.type}-${index}-${entry.meta}`}
                $active={index === activeActionIndex}
                data-walkthrough-action-active={index === activeActionIndex ? 'true' : undefined}
                data-walkthrough-action-index={index}
                role='button'
                tabIndex={0}
                onClick={() => {
                  restoreActionStateAtIndex(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    restoreActionStateAtIndex(index);
                  }
                }}
              >
                <RecorderActionIndex>{index + 2}</RecorderActionIndex>
                <RecorderActionBody>
                  <RecorderActionText>
                    <RecorderActionBadge>{action.type}</RecorderActionBadge>
                    {' '}
                    {entry.title}
                  </RecorderActionText>
                  <RecorderActionMeta>{entry.meta}</RecorderActionMeta>
                </RecorderActionBody>
                <RecorderActionControls>
                  <RecorderActionControlButton
                    aria-label={`Delete action ${index + 2}`}
                    data-danger='true'
                    title='Delete'
                    type='button'
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteActionAtIndex(index);
                    }}
                  >
                  </RecorderActionControlButton>
                </RecorderActionControls>
              </RecorderActionLogItem>
            );
          })}
        </RecorderActionLog>
        {actions.length === 0 ? (
          <RecorderHelp>No recorded actions yet.</RecorderHelp>
        ) : null}
          </>
        )}
      </RecorderPanel>
    </>
  );
};
