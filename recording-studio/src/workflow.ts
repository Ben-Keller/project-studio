import { round } from './motion';
import {
  WalkthroughAction,
  WalkthroughCursorSettings,
  WalkthroughPlan,
  WalkthroughSavedRecording,
} from './types';

export const truncateWorkflowText = (value: string, maxLength = 58) => (
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
);

export const getActionLocationLabel = (action: WalkthroughAction) => {
  if (action.target) return action.target;
  if (typeof action.x === 'number' && typeof action.y === 'number') return `${round(action.x)}, ${round(action.y)}`;
  if (typeof action.scrollTop === 'number') return `${round(action.scrollTop)}px`;
  if (action.type === 'state') return 'filters';
  return 'timeline';
};

export const getActionLabel = (action: WalkthroughAction) => {
  if (action.type === 'state') return 'Dashboard state';
  if (action.type === 'type') return `Type "${truncateWorkflowText(action.text || '', 52)}"`;
  if (action.type === 'scroll') return `Scroll to ${getActionLocationLabel(action)}`;
  if (action.type === 'circle') return `Circle highlight${action.radius ? ` (${action.radius}px)` : ''}`;
  if (action.type === 'tooltip') return `Hover effects ${action.enabled === false ? 'off' : 'on'}`;
  return `${action.type.charAt(0).toUpperCase()}${action.type.slice(1)}`;
};

export const getActionMeta = (action: WalkthroughAction, sceneId = 'timeline') => {
  const duration = action.durationMs ? `${round(action.durationMs)}ms` : 'default timing';
  const pause = action.pauseMs ? `${round(action.pauseMs)}ms pause` : 'default pause';
  return `${sceneId} - ${getActionLocationLabel(action)} - ${duration}, ${pause}`;
};

export const getActionLogEntry = (action: WalkthroughAction, sceneId?: string) => ({
  meta: getActionMeta(action, sceneId),
  title: getActionLabel(action),
});

export const flattenPlanFrames = (plan: WalkthroughPlan) => (
  plan.scenes.flatMap((scene, sceneIndex) => (
    scene.actions.map((action, actionIndex) => ({
      action,
      actionIndex,
      frameIndex: 0,
      sceneCaption: scene.caption,
      sceneId: scene.id,
      sceneIndex,
      totalFrames: 0,
    }))
  )).map((item, frameIndex, frames) => ({
    ...item,
    frameIndex,
    totalFrames: frames.length,
  }))
);

export const formatRecordingDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const getRecordingSummary = (recording: WalkthroughSavedRecording) => (
  `${recording.actionCount} actions - updated ${formatRecordingDate(recording.updatedAt)}`
);

export const getRecordingSignature = (
  actions: WalkthroughAction[],
  cursorSettings: WalkthroughCursorSettings,
  exportFrame: WalkthroughPlan['exportFrame'],
  name: string,
) => JSON.stringify({
  actions,
  cursorSettings,
  exportFrame,
  name: name.trim() || 'Recorded walkthrough',
});
