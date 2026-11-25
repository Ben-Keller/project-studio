import { WalkthroughPlan } from './types';
import { studioRequest } from './runtime';
import {
  DEFAULT_WALKTHROUGH_EXPORT_FPS,
  DEFAULT_WALKTHROUGH_EXPORT_QUALITY,
} from './config';

const EXPORT_SERVICE_BASE_URL = '/api/walkthrough-export';

export type WalkthroughExportJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface WalkthroughExportJob {
  completedLanguages: number;
  createdAt: string;
  currentLanguage?: string;
  error?: string;
  id: string;
  languages: string[];
  log: string[];
  logPath?: string;
  name: string;
  outputDir: string;
  outputPath?: string;
  progress: number;
  phase?: string;
  encoding?: { frames: number; totalFrames: number; encoder: string };
  progressEstimated?: boolean;
  settings?: WalkthroughExportSettings;
  status: WalkthroughExportJobStatus;
  updatedAt: string;
}

export interface WalkthroughExportSettings {
  fps: number;
  quality: string;
  resolution?: string;
}

export const checkWalkthroughExportService = async () => {
  return studioRequest<{ ok: boolean; outputRoot: string }>(`${EXPORT_SERVICE_BASE_URL}/health`);
};

export const createWalkthroughExportJob = async (
  plan: WalkthroughPlan,
  name: string,
  languages: string[],
  settings: WalkthroughExportSettings = {
    fps: DEFAULT_WALKTHROUGH_EXPORT_FPS,
    quality: DEFAULT_WALKTHROUGH_EXPORT_QUALITY,
  },
) => {
  return studioRequest<WalkthroughExportJob>(`${EXPORT_SERVICE_BASE_URL}/jobs`, 'POST', {
      languages,
      name,
      plan,
      settings,
      url: typeof window === 'undefined' ? undefined : window.location.href,
  });
};

export const getWalkthroughExportJob = async (id: string) => {
  return studioRequest<WalkthroughExportJob>(`${EXPORT_SERVICE_BASE_URL}/jobs/${id}`);
};

export const cancelWalkthroughExportJob = async (id: string) => {
  return studioRequest<WalkthroughExportJob>(`${EXPORT_SERVICE_BASE_URL}/jobs/${id}/cancel`, 'POST');
};
