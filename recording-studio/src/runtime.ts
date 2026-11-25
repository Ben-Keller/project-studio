export interface StudioRuntimeConfig {
  appId: string;
  appUrl: string;
  recordingId?: string;
  language?: string;
  languages?: string[];
  readySelector?: string;
  videoExportEnabled?: boolean;
  serviceBase?: string;
  sessionToken?: string;
  exportOnly?: boolean;
}

declare global {
  interface Window {
    __projectStudioRecording?: StudioRuntimeConfig;
    __projectStudioRequest?: (request: { path: string; method: string; body?: unknown }) => Promise<unknown>;
    __projectStudioAdapter?: { getState: () => unknown; applyState: (state: any) => void | Promise<void> };
  }
}

export const runtimeConfig = () => window.__projectStudioRecording;
export let overlayRoot: HTMLElement | undefined;
export const setOverlayRoot = (root: HTMLElement) => { overlayRoot = root; };

export async function studioRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (window.__projectStudioRequest) {
    return window.__projectStudioRequest({ path, method, body }) as Promise<T>;
  }
  const config = runtimeConfig();
  const response = await fetch(`${config?.serviceBase || 'http://127.0.0.1:3015'}${path}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(config?.sessionToken ? { Authorization: `Bearer ${config.sessionToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Recording service returned ${response.status}`);
  return result as T;
}
