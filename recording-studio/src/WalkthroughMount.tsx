import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  WALKTHROUGH_EVENTS,
  WALKTHROUGH_LOCALHOST_HOSTS,
} from './config';
import { plan as builtInPlan } from './plan';
import { loadPreviewPlan } from './storage';
import { WalkthroughPlayer } from './WalkthroughPlayer';
import { WalkthroughRecorder } from './WalkthroughRecorder';
import type {
  WalkthroughMountOptions,
  WalkthroughPlan,
} from './types';

type PlaybackRequest = {
  id: number;
  plan: WalkthroughPlan;
  showCaptions: boolean;
  speed: number;
  startFrameIndex: number;
  strict: boolean;
};

type WalkthroughStartDetail = {
  plan?: WalkthroughPlan;
  showCaptions?: boolean;
  speed?: number;
  strict?: boolean;
};

export const WalkthroughMount = ({
  defaultPlan,
  initialRecorderActive = false,
  recordedFileName,
  recorderShortcut = true,
}: WalkthroughMountOptions) => {
  const activeDefaultPlan = defaultPlan || builtInPlan;
  const [recorderActive, setRecorderActive] = useState(initialRecorderActive);
  const [playbackRequest, setPlaybackRequest] = useState<PlaybackRequest | undefined>(undefined);
  const [playbackActionIndex, setPlaybackActionIndex] = useState<number | undefined>(undefined);

  const startPlayback = useCallback((plan: WalkthroughPlan, options: Partial<Omit<PlaybackRequest, 'id' | 'plan'>> & { keepRecorderOpen?: boolean } = {}) => {
    setRecorderActive(Boolean(options.keepRecorderOpen));
    setPlaybackActionIndex((options.startFrameIndex ?? 0) - 1);
    setPlaybackRequest({
      id: Date.now(),
      plan,
      showCaptions: options.showCaptions ?? true,
      speed: options.speed ?? 1,
      startFrameIndex: options.startFrameIndex ?? 0,
      strict: options.strict ?? true,
    });
  }, []);

  const closePlayback = useCallback(() => {
    setPlaybackRequest(undefined);
    setPlaybackActionIndex(undefined);
    setRecorderActive(true);
  }, []);

  const completePlayback = useCallback(() => {
    setPlaybackRequest(undefined);
  }, []);

  const previewPlan = useCallback((plan: WalkthroughPlan, options?: { startFrameIndex?: number }) => {
    startPlayback(plan, {
      keepRecorderOpen: true,
      startFrameIndex: options?.startFrameIndex ?? 0,
      strict: true,
    });
  }, [startPlayback]);

  useEffect(() => {
    if (!recorderShortcut || typeof window === 'undefined') return undefined;
    if (!WALKTHROUGH_LOCALHOST_HOSTS.has(window.location.hostname)) return undefined;

    const handleRecorderShortcut = (event: KeyboardEvent) => {
      if (
        event.ctrlKey
        && event.key.toLowerCase() === 'r'
      ) {
        event.preventDefault();
        setPlaybackRequest(undefined);
        setPlaybackActionIndex(undefined);
        setRecorderActive(true);
      }
    };

    window.addEventListener('keydown', handleRecorderShortcut);
    return () => {
      window.removeEventListener('keydown', handleRecorderShortcut);
    };
  }, [recorderShortcut]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<WalkthroughStartDetail>).detail || {};
      const plan = detail.plan || loadPreviewPlan() || activeDefaultPlan;
      startPlayback(plan, {
        showCaptions: detail.showCaptions,
        speed: detail.speed,
        strict: detail.strict,
      });
    };
    window.addEventListener(WALKTHROUGH_EVENTS.start, handleStart);
    (window as Window & { __moonshotWalkthroughReady?: boolean }).__moonshotWalkthroughReady = true;
    window.dispatchEvent(new CustomEvent(WALKTHROUGH_EVENTS.ready));
    return () => {
      window.removeEventListener(WALKTHROUGH_EVENTS.start, handleStart);
    };
  }, [activeDefaultPlan, startPlayback]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleOpenRecorder = () => {
      setPlaybackRequest(undefined);
      setPlaybackActionIndex(undefined);
      setRecorderActive(true);
    };
    window.addEventListener(WALKTHROUGH_EVENTS.openRecorder, handleOpenRecorder);
    return () => {
      window.removeEventListener(WALKTHROUGH_EVENTS.openRecorder, handleOpenRecorder);
    };
  }, []);

  return (
    <>
      {playbackRequest ? (
        <WalkthroughPlayer
          key={playbackRequest.id}
          active
          onActionStart={setPlaybackActionIndex}
          onComplete={completePlayback}
          plan={playbackRequest.plan}
          showCaptions={playbackRequest.showCaptions}
          startFrameIndex={playbackRequest.startFrameIndex}
          strict={playbackRequest.strict}
          speed={playbackRequest.speed}
        />
      ) : null}
      <WalkthroughRecorder
        active={recorderActive}
        basePlan={activeDefaultPlan}
        onPreviewPlan={previewPlan}
        onStopPlayback={closePlayback}
        playbackActionIndex={playbackActionIndex}
        playbackActive={Boolean(playbackRequest)}
        recordedFileName={recordedFileName}
      />
    </>
  );
};
