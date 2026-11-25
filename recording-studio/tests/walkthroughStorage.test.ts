import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  DEFAULT_CURSOR_SETTINGS,
  loadCursorSettings,
  saveCursorSettings,
} from '../src/cursorSettings';
import {
  loadSavedRecordings,
  savePreviewPlan,
  saveRecording,
} from '../src/storage';
import { WalkthroughPlan } from '../src/types';

const testPlan: WalkthroughPlan = {
  defaults: {
    circleDurationMs: 1200,
    circleRadius: 50,
    moveDurationMs: 500,
    pauseMs: 300,
    scrollDurationMs: 700,
  },
  scenes: [
    {
      actions: [],
      caption: '',
      id: 'test',
    },
  ],
  start: {
    x: 0,
    y: 0,
  },
  title: 'Test walkthrough',
};

describe('walkthrough storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('falls back safely when localStorage reads are denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(loadSavedRecordings()).toEqual([]);
    expect(loadCursorSettings()).toEqual(DEFAULT_CURSOR_SETTINGS);
  });

  it('does not throw when localStorage writes are denied', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    expect(() => savePreviewPlan(testPlan)).not.toThrow();
    expect(() => saveCursorSettings(DEFAULT_CURSOR_SETTINGS)).not.toThrow();
    expect(await saveRecording(testPlan, 'Denied storage')).toBeUndefined();
  });
});


describe('central recording library consistency', () => {
  afterEach(() => {
    delete window.__projectStudioRecording;
    delete window.__projectStudioRequest;
    window.localStorage.clear();
    vi.resetModules();
  });

  it('serializes refresh, save and approval against the authoritative library', async () => {
    vi.resetModules();
    const storage = await import('../src/storage');
    window.__projectStudioRecording = { appId: 'test', appUrl: 'http://localhost/' };
    let records: any[] = [];
    let release: (() => void) | undefined;
    let blockRead = false;
    window.__projectStudioRequest = vi.fn(async ({ method, body }) => {
      if (method === 'GET') {
        const snapshot = structuredClone(records);
        if (blockRead) await new Promise<void>(resolve => { release = resolve; });
        return snapshot;
      }
      const value = body as any;
      const current = records.find(item => item.id === value.id);
      expect(value.revision || 0).toBe(current?.revision || 0);
      const saved = { ...value, revision: (current?.revision || 0) + 1 };
      records = [saved];
      return saved;
    });
    await storage.hydrateRecordingLibrary();
    const first = await storage.saveRecording(testPlan, 'First');
    blockRead = true;
    const refresh = storage.refreshRecordingLibrary();
    await Promise.resolve();
    const save = storage.saveRecording(testPlan, 'Edited', first!.id);
    expect(records[0].name).toBe('First');
    release!();
    await refresh;
    await save;
    expect(storage.loadSavedRecordings()[0].name).toBe('Edited');
    await storage.updateSavedRecordingApproval(first!.id, true);
    expect(records[0].approvedAt).toBeTruthy();
    expect(records[0].revision).toBe(3);
  });

  it('retains unsaved drafts on failure and lets subsequent operations proceed', async () => {
    vi.resetModules();
    const storage = await import('../src/storage');
    window.__projectStudioRecording = { appId: 'test', appUrl: 'http://localhost/' };
    window.__projectStudioRequest = vi.fn(async ({ method }) => {
      if (method === 'GET') return [];
      throw new Error('Service unavailable');
    });
    await storage.hydrateRecordingLibrary();
    await expect(storage.saveRecording(testPlan, 'Unsaved')).rejects.toThrow('Service unavailable');
    expect(JSON.parse(window.localStorage.getItem('project-studio-draft:test')!).name).toBe('Unsaved');
    await expect(storage.refreshRecordingLibrary()).resolves.toEqual([]);
  });
});
