export const WALKTHROUGH_EVENTS = {
  appStateChange: 'moonshot-walkthrough-app-state-change',
  complete: 'moonshot-walkthrough-complete',
  error: 'moonshot-walkthrough-error',
  openRecorder: 'moonshot-walkthrough-open-recorder',
  ready: 'moonshot-walkthrough-ready',
  start: 'moonshot-walkthrough-start',
} as const;

export const WALKTHROUGH_STORAGE_KEYS = {
  cursorSettings: 'moonshot-walkthrough-cursor-settings',
  previewPlan: 'moonshot-walkthrough-preview-plan',
  savedRecordings: 'moonshot-walkthrough-saved-recordings',
} as const;

export const WALKTHROUGH_LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const WALKTHROUGH_EXPORT_LANGUAGES = ['en', 'es', 'fr', 'zh', 'pt', 'ru', 'ar'] as const;

export {
  EXPORT_FPS_OPTIONS as WALKTHROUGH_EXPORT_FPS_OPTIONS,
  EXPORT_QUALITY_OPTIONS as WALKTHROUGH_EXPORT_QUALITY_OPTIONS,
  DEFAULT_EXPORT_FPS as DEFAULT_WALKTHROUGH_EXPORT_FPS,
  DEFAULT_EXPORT_QUALITY as DEFAULT_WALKTHROUGH_EXPORT_QUALITY,
} from '../shared/exportSettings.mjs';

export const DEFAULT_RECORDED_PLAN_FILE_NAME = 'walkthroughPlan.recorded.json';
