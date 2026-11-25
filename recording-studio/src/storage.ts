import {
  WalkthroughPlan,
  WalkthroughSavedRecording,
} from './types';
import { WALKTHROUGH_STORAGE_KEYS } from './config';
import { runtimeConfig, studioRequest } from './runtime';

// Serialize library reads and mutations so a slow refresh cannot undo a save.
let libraryQueue: Promise<unknown> = Promise.resolve();
const serializeLibrary = <T,>(operation: () => Promise<T>): Promise<T> => {
  const result = libraryQueue.then(operation);
  libraryQueue = result.catch(() => undefined);
  return result;
};

let centralRecordings: WalkthroughSavedRecording[] | undefined;
export const hydrateRecordingLibrary = async () => {
  if (!runtimeConfig() || runtimeConfig()?.exportOnly) return;
  const migrationKey = `project-studio-imported:${runtimeConfig()?.appId}`;
  const legacy = loadSavedRecordings();
  if (legacy.length && !getStoredValue(migrationKey)) {
    await studioRequest('/api/recording-studio/library/import', 'POST', { recordings: legacy });
    setStoredValue(migrationKey, '1');
  }
  centralRecordings = await studioRequest<WalkthroughSavedRecording[]>('/api/recording-studio/library');
  const draftKey = `project-studio-draft:${runtimeConfig()?.appId}`;
  const rawDraft = getStoredValue(draftKey);
  if (rawDraft) {
    const draft = JSON.parse(rawDraft) as WalkthroughSavedRecording;
    const recovered = { ...draft, id: createRecordingId(), name: `${draft.name} (recovered draft)` };
    await studioRequest('/api/recording-studio/library/import', 'POST', { recordings: [recovered] });
    setStoredValue(draftKey, '');
    centralRecordings = await studioRequest<WalkthroughSavedRecording[]>('/api/recording-studio/library');
  }
};

export const refreshRecordingLibrary = () => serializeLibrary(async () => {
  if (runtimeConfig() && !runtimeConfig()?.exportOnly) {
    centralRecordings = await studioRequest<WalkthroughSavedRecording[]>('/api/recording-studio/library');
  }
  return loadSavedRecordings();
});

const getActionCount = (plan: WalkthroughPlan) => (
  plan.scenes.reduce((sum, scene) => sum + scene.actions.length, 0)
);

const createRecordingId = () => {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `recording-${Date.now()}-${Math.round(Math.random() * 100000)}`;
};

const sortRecordings = (recordings: WalkthroughSavedRecording[]) => (
  [...recordings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
);

const getStoredValue = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return undefined;
  }
};

const setStoredValue = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const savePreviewPlan = (plan: WalkthroughPlan) => {
  if (typeof window === 'undefined') return;
  setStoredValue(WALKTHROUGH_STORAGE_KEYS.previewPlan, JSON.stringify(plan));
};

export const loadPreviewPlan = () => {
  if (typeof window === 'undefined') return undefined;
  const storedPlan = getStoredValue(WALKTHROUGH_STORAGE_KEYS.previewPlan);
  if (!storedPlan) return undefined;
  try {
    return JSON.parse(storedPlan) as WalkthroughPlan;
  } catch {
    return undefined;
  }
};

export const loadSavedRecordings = () => {
  if (centralRecordings) return sortRecordings(centralRecordings);
  if (typeof window === 'undefined') return [];
  const storedRecordings = getStoredValue(WALKTHROUGH_STORAGE_KEYS.savedRecordings);
  if (!storedRecordings) return [];
  try {
    const parsed = JSON.parse(storedRecordings) as WalkthroughSavedRecording[];
    if (!Array.isArray(parsed)) return [];
    return sortRecordings(parsed.filter((recording) => recording?.id && recording?.plan));
  } catch {
    return [];
  }
};

export const saveRecording = (
  plan: WalkthroughPlan,
  name: string,
  existingId?: string,
) => serializeLibrary(async () => {
  if (typeof window === 'undefined') return undefined;
  const currentRecordings = loadSavedRecordings();
  const now = new Date().toISOString();
  const existingRecording = existingId
    ? currentRecordings.find((recording) => recording.id === existingId)
    : undefined;
  const recording: WalkthroughSavedRecording = {
    actionCount: getActionCount(plan),
    approvedAt: existingRecording?.approvedAt,
    createdAt: existingRecording?.createdAt || now,
    id: existingRecording?.id || createRecordingId(),
    name: name.trim() || plan.title || 'Untitled walkthrough',
    plan,
    updatedAt: now,
  };
  const nextRecordings = sortRecordings([
    recording,
    ...currentRecordings.filter((item) => item.id !== recording.id),
  ]);
  if (centralRecordings) {
    setStoredValue(`project-studio-draft:${runtimeConfig()?.appId}`, JSON.stringify(recording));
    const saved = await studioRequest<WalkthroughSavedRecording>('/api/recording-studio/library', 'POST', {
      ...recording, revision: (existingRecording as WalkthroughSavedRecording & { revision?: number })?.revision || 0,
    });
    centralRecordings = sortRecordings([saved, ...centralRecordings.filter((item) => item.id !== saved.id)]);
    setStoredValue(`project-studio-draft:${runtimeConfig()?.appId}`, '');
    return saved;
  }
  return setStoredValue(WALKTHROUGH_STORAGE_KEYS.savedRecordings, JSON.stringify(nextRecordings))
    ? recording
    : undefined;
});

export const updateSavedRecordingApproval = (id: string, approved: boolean) => serializeLibrary(async () => {
  if (typeof window === 'undefined') return [];
  const now = new Date().toISOString();
  const nextRecordings = loadSavedRecordings().map((recording) => (
    recording.id === id
      ? {
        ...recording,
        approvedAt: approved ? now : undefined,
        updatedAt: now,
      }
      : recording
  ));
  if (centralRecordings) {
    const updated = nextRecordings.find(recording => recording.id === id);
    if (!updated) return loadSavedRecordings();
    const saved = await studioRequest<WalkthroughSavedRecording>('/api/recording-studio/library', 'POST', updated);
    centralRecordings = sortRecordings([saved, ...centralRecordings.filter(recording => recording.id !== id)]);
    return loadSavedRecordings();
  }
  return setStoredValue(WALKTHROUGH_STORAGE_KEYS.savedRecordings, JSON.stringify(nextRecordings))
    ? sortRecordings(nextRecordings)
    : loadSavedRecordings();
});

export const deleteSavedRecording = (id: string) => serializeLibrary(async () => {
  if (typeof window === 'undefined') return [];
  const nextRecordings = loadSavedRecordings().filter((recording) => recording.id !== id);
  if (centralRecordings) {
    await studioRequest(`/api/recording-studio/library/${encodeURIComponent(id)}`, 'DELETE');
    centralRecordings = nextRecordings;
    return nextRecordings;
  }
  return setStoredValue(WALKTHROUGH_STORAGE_KEYS.savedRecordings, JSON.stringify(nextRecordings))
    ? nextRecordings
    : loadSavedRecordings();
});
