#!/usr/bin/env node

import express from 'express';
import { readFileSync } from 'fs';
import { appendFile, mkdir, readdir, readFile, rename, statfs, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'url';
import { asyncRoute, installRecordingStudio } from './recording-sessions.mjs';
import { DEFAULT_EXPORT_FPS, DEFAULT_EXPORT_QUALITY, DEFAULT_EXPORT_RESOLUTION, EXPORT_RESOLUTION_OPTIONS, getExportDimensions, getFrameCaptureTimeScale } from '../shared/exportSettings.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const localWalkthroughRoot = path.resolve(__dirname, '..');

const normalizeAppPath = (value) => {
  const pathValue = String(value || '/').trim() || '/';
  const withLeadingSlash = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

const readPackageHomepagePath = () => {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    if (!packageJson.homepage) return '/';
    return new URL(packageJson.homepage).pathname || '/';
  } catch {
    return '/';
  }
};

const DEFAULT_APP_PATH = normalizeAppPath(process.env.WALKTHROUGH_APP_PATH || readPackageHomepagePath());
const PORT = Number(process.env.WALKTHROUGH_EXPORT_PORT || 3015);
const HOST = '127.0.0.1';
const OUTPUT_ROOT = path.resolve(process.env.WALKTHROUGH_EXPORT_OUTPUT_DIR || path.join(localWalkthroughRoot, 'outputs', 'exports'));
const HOVER_REINFORCE_DELAY_MS = 180;
const MIN_HOVER_DWELL_MS = 1400;
const COMPLETION_HOLD_MS = 2200;
const EXPORT_FPS_OPTIONS = new Set([30, 60, 120]);
const EXPORT_QUALITY_OPTIONS = new Set(['standard', 'high', 'maximum']);

const app = express();
const jobs = new Map();
let preparingExport = false;

app.use(express.json({ limit: '25mb' }));
const studio = installRecordingStudio(app, { packageRoot: repoRoot, port: PORT });

const now = () => new Date().toISOString();

const pad = (value) => String(value).padStart(2, '0');

const createDateTimeCode = () => {
  const date = new Date();
  return [
    String(date.getFullYear()).slice(2),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
};

const createJobId = () => (
  `${createDateTimeCode()}-${Math.round(Math.random() * 999).toString().padStart(3, '0')}`
);

const getPlanActions = (plan) => (
  Array.isArray(plan?.scenes)
    ? plan.scenes.flatMap((scene) => (Array.isArray(scene.actions) ? scene.actions : []))
    : []
);

const normalizeExportSettings = (settings = {}) => {
  const fps = Number(settings.fps);
  const quality = String(settings.quality || DEFAULT_EXPORT_QUALITY).toLowerCase();
  return {
    fps: EXPORT_FPS_OPTIONS.has(fps) ? fps : DEFAULT_EXPORT_FPS,
    quality: EXPORT_QUALITY_OPTIONS.has(quality) ? quality : DEFAULT_EXPORT_QUALITY,
    resolution: EXPORT_RESOLUTION_OPTIONS.includes(settings.resolution) ? settings.resolution : DEFAULT_EXPORT_RESOLUTION,
  };
};

const estimateActionDurationMs = (action, defaults = {}) => {
  const pauseMs = Number(action?.pauseMs ?? defaults.pauseMs ?? 1000);
  const moveDurationMs = Number(defaults.moveDurationMs ?? 780);
  const scrollDurationMs = Number(defaults.scrollDurationMs ?? 950);
  const circleDurationMs = Number(defaults.circleDurationMs ?? 2400);
  const durationMs = Number(action?.durationMs);
  const safePauseMs = Number.isFinite(pauseMs) ? pauseMs : 1000;
  const safeDurationMs = Number.isFinite(durationMs) ? durationMs : undefined;
  switch (action?.type) {
    case 'wait':
      return safeDurationMs ?? safePauseMs;
    case 'scroll':
      return (safeDurationMs ?? scrollDurationMs) + safePauseMs;
    case 'tooltip':
    case 'state':
      return safePauseMs;
    case 'circle':
      return Math.min(500, safeDurationMs ? safeDurationMs * 0.25 : 420)
        + (safeDurationMs ?? circleDurationMs)
        + safePauseMs;
    case 'hover':
      return (safeDurationMs ?? moveDurationMs)
        + HOVER_REINFORCE_DELAY_MS
        + Math.max(safePauseMs, MIN_HOVER_DWELL_MS);
    case 'click':
      return (safeDurationMs ?? moveDurationMs) + 100 + safePauseMs;
    case 'type': {
      const textLength = typeof action.text === 'string' ? action.text.length : 0;
      return (safeDurationMs ?? Math.max(800, textLength * 45)) + safePauseMs;
    }
    case 'move':
      return safeDurationMs ?? moveDurationMs;
    default:
      return (safeDurationMs ?? moveDurationMs) + safePauseMs;
  }
};

const estimatePlanPlaybackMs = (plan) => {
  const defaults = plan?.defaults || {};
  return 420 + COMPLETION_HOLD_MS + getPlanActions(plan).reduce(
    (total, action) => total + estimateActionDurationMs(action, defaults),
    0,
  );
};

const getQualityEstimateMultiplier = (quality) => {
  if (quality === 'standard') return 0.45;
  if (quality === 'high') return 0.72;
  return 1.0;
};

const createExportEstimate = (plan, languages, settings) => {
  const actionCount = getPlanActions(plan).length;
  const frameCaptureTimeScale = getFrameCaptureTimeScale(settings.fps, settings.quality);
  const playbackMs = estimatePlanPlaybackMs(plan) * frameCaptureTimeScale;
  const setupMs = 7500 + Math.min(4500, actionCount * 180);
  const fpsMultiplier = Math.max(0.35, settings.fps / DEFAULT_EXPORT_FPS);
  const qualityMultiplier = getQualityEstimateMultiplier(settings.quality);
  const encodeMs = Math.round(
    (25000 + Math.min(45000, actionCount * 2200) + Math.round(playbackMs * 0.8))
      * fpsMultiplier
      * qualityMultiplier,
  );
  const languageMs = Math.max(18000, setupMs + playbackMs + encodeMs);
  return {
    actionCount,
    encodeMs,
    frameCaptureTimeScale,
    fps: settings.fps,
    languageMs,
    playbackMs,
    quality: settings.quality,
    setupMs,
    totalMs: languageMs * Math.max(1, languages.length),
  };
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const estimateScratchBytes = (plan, languages, settings) => {
  const frame = plan?.exportFrame || {};
  const viewport = frame.viewport || {};
  const { width: captureWidth, height: captureHeight } = getExportDimensions(viewport, settings.resolution);
  // Languages render sequentially: reserve one scratch set plus all final videos.
  // Estimate compressed PNGs conservatively, and retain a separate free-space buffer.
  const durationSeconds = estimatePlanPlaybackMs(plan) / 1000;
  const capturedFrames = durationSeconds * getFrameCaptureTimeScale(settings.fps, settings.quality) * 60;
  const bytesPerFrame = captureWidth * captureHeight * (settings.quality === 'standard' ? 0.12 : 0.4);
  const scratchBytes = capturedFrames * bytesPerFrame;
  const videoBytes = durationSeconds * 4 * 1024 * 1024 * Math.max(1, languages.length);
  return Math.ceil(scratchBytes + videoBytes + 512 * 1024 * 1024);
};

const getAvailableBytes = async (targetPath) => {
  await mkdir(targetPath, { recursive: true });
  const stats = await statfs(targetPath);
  return Number(stats.bavail) * Number(stats.bsize);
};

const assertEnoughDiskSpace = async ({ plan, languages, outputDir, settings }) => {
  const availableBytes = await getAvailableBytes(path.dirname(outputDir));
  const requiredBytes = estimateScratchBytes(plan, languages, settings);
  if (availableBytes >= requiredBytes) {
    return {
      availableBytes,
      availableText: formatBytes(availableBytes),
      ok: true,
      requiredBytes,
      requiredText: formatBytes(requiredBytes),
    };
  }
  const message = [
    'Not enough free disk space for this walkthrough export.',
    `Available: ${formatBytes(availableBytes)}.`,
    `Estimated required: ${formatBytes(requiredBytes)}.`,
    'Reduce resolution/FPS/quality or free disk space before exporting.',
  ].join(' ');
  const error = new Error(message);
  error.statusCode = 507;
  error.disk = {
    availableBytes,
    availableText: formatBytes(availableBytes),
    requiredBytes,
    requiredText: formatBytes(requiredBytes),
  };
  throw error;
};

const resolveJobUrl = (request, url) => {
  if (typeof url === 'string' && url.trim()) return url.trim();
  if (request.headers.origin && isAllowedOrigin(request.headers.origin)) {
    try {
      return new URL(DEFAULT_APP_PATH, request.headers.origin).href;
    } catch {
      // Fall through to the configured/default URL.
    }
  }
  return process.env.WALKTHROUGH_URL || `http://localhost:3000${DEFAULT_APP_PATH}`;
};

const summarizeJob = (job) => job.archived ? job : ({
  appId: job.appId,
  completedLanguages: job.completedLanguages,
  createdAt: job.createdAt,
  currentLanguage: job.currentLanguage,
  error: job.error,
  id: job.id,
  languages: job.languages,
  log: job.log.slice(-80),
  logPath: job.logPath,
  name: job.name,
  outputDir: job.outputDir,
  outputPath: path.relative(repoRoot, job.outputDir),
  progress: getJobProgress(job),
  phase: job.phase,
  encoding: job.encoding,
  progressEstimated: job.phase !== 'encode',
  settings: job.settings,
  status: job.status,
  updatedAt: job.updatedAt,
});

const persistJob = (job) => {
  const snapshot = JSON.stringify(summarizeJob(job), null, 2);
  job.persist = (job.persist || Promise.resolve()).catch(() => {}).then(async () => {
    await writeFile(path.join(job.outputDir, 'job.json.tmp'), snapshot, { mode: 0o600 });
    await rename(path.join(job.outputDir, 'job.json.tmp'), path.join(job.outputDir, 'job.json'));
  }).catch(error => console.error('[recording-studio] Could not save export status:', error.message));
};

const average = (values, fallback) => {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return fallback;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
};

const getPhaseEstimate = (job, phase) => {
  const estimate = job.estimate || {};
  const setupMs = Math.max(1000, average(job.observedDurations?.setupMs || [], estimate.setupMs || 9000));
  const playbackMs = Math.max(1000, average(job.observedDurations?.playbackMs || [], estimate.playbackMs || 12000));
  const encodeMs = Math.max(1000, average(job.observedDurations?.encodeMs || [], estimate.encodeMs || 9000));
  const finalizeMs = Math.max(1000, average(job.observedDurations?.finalizeMs || [], estimate.finalizeMs || 20000));
  switch (phase) {
    case 'playback':
      return {
        durationMs: playbackMs,
        end: 0.72,
        start: 0.35,
      };
    case 'encode':
      return {
        durationMs: encodeMs,
        end: 0.96,
        start: 0.72,
      };
    case 'finalizing':
      return {
        durationMs: finalizeMs,
        end: 0.985,
        start: 0.96,
      };
    case 'setup':
    default:
      return {
        durationMs: setupMs,
        end: 0.35,
        start: 0,
      };
  }
};

const getEstimatedCompletedLanguageUnits = (job) => {
  const languageCount = Math.max(1, job.languages.length);
  if (!job.currentLanguage) {
    return job.completedLanguages;
  }
  const currentIndex = Math.max(0, job.languages.indexOf(job.currentLanguage));
  const phase = getPhaseEstimate(job, job.phase);
  const phaseStartedAtMs = job.phaseStartedAtMs || job.currentLanguageStartedAtMs || job.startedAtMs || Date.now();
  const elapsedPhaseMs = Math.max(0, Date.now() - phaseStartedAtMs);
  const phaseRatio = job.phase === 'encode'
    ? Math.min(1, (job.encoding?.frames || 0) / Math.max(1, job.encoding?.totalFrames || 1))
    : Math.min(0.98, elapsedPhaseMs / phase.durationMs);
  const currentLanguageFraction = Math.min(
    phase.end,
    phase.start + ((phase.end - phase.start) * phaseRatio),
  );
  const phaseUnits = currentIndex + currentLanguageFraction;
  return Math.max(job.completedLanguages, phaseUnits);
};

const getJobProgress = (job) => {
  if (job.status === 'completed') return 100;
  if (job.status === 'failed' || job.status === 'canceled') {
    return job.languages.length
      ? Math.round((job.completedLanguages / job.languages.length) * 100)
      : 0;
  }
  if (job.status === 'queued') return 0;
  if (!job.languages.length) return 0;
  const estimatedUnits = getEstimatedCompletedLanguageUnits(job);
  const nextProgress = Math.min(98, Math.max(1, Math.floor((estimatedUnits / job.languages.length) * 100)));
  job.lastProgress = Math.max(job.lastProgress || 0, nextProgress);
  return job.lastProgress;
};

const markCurrentLanguageComplete = (job) => {
  const language = job.currentLanguage || job.languages[job.completedLanguages];
  if (!language) return;
  if (!job.completedLanguageCodes.has(language)) {
    job.completedLanguageCodes.add(language);
    job.completedLanguages = Math.min(job.languages.length, job.completedLanguageCodes.size);
  }
};

const appendJobLog = (job, line) => {
  if (!job.logPath || !line) return;
  appendFile(job.logPath, `${line}\n`).catch((error) => {
    console.error(`[walkthrough-export] Could not write job log: ${error.message}`);
  });
};

const writeJobLogLine = (job, message) => {
  const line = `${now()} ${message}`;
  job.log.push(line);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  appendJobLog(job, line);
  job.updatedAt = now();
  persistJob(job);
};

const updateJobFromLine = (job, line) => {
  if (!line) return;
  const timestampedLine = `${now()} ${line}`;
  job.log.push(timestampedLine);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  appendJobLog(job, timestampedLine);
  const phaseMatch = line.match(/^\[walkthrough:phase\]\s+(.+)$/);
  if (phaseMatch) {
    try {
      const detail = JSON.parse(phaseMatch[1]);
      if (detail.language) {
        job.currentLanguage = detail.language;
        job.currentLanguageStartedAtMs ||= Date.now();
      }
      if (detail.phase === 'launch-start') {
        job.encoding = undefined;
        job.phase = 'setup';
        job.phaseStartedAtMs = Date.now();
        job.currentLanguageStartedAtMs = Date.now();
      }
      if (detail.phase === 'playback-start') {
        if (Number.isFinite(detail.setupMs)) {
          job.observedDurations.setupMs.push(detail.setupMs);
        }
        job.phase = 'playback';
        job.phaseStartedAtMs = Date.now();
      }
      if (detail.phase === 'playback-complete') {
        const playbackMs = Number(detail.elapsedMs) - Number(job.currentPlaybackStartedElapsedMs || 0);
        if (Number.isFinite(playbackMs) && playbackMs > 0) {
          job.observedDurations.playbackMs.push(playbackMs);
        }
        job.phase = 'encode';
        job.phaseStartedAtMs = Date.now();
        job.currentFinalizeStartedAtMs = Date.now();
      }
      if (detail.phase === 'encode-start') {
        job.currentEncodeStartedAtMs = Date.now();
        job.phase = 'encode';
        job.phaseStartedAtMs = Date.now();
      }
      if (detail.phase === 'encode-progress') {
        job.encoding = { frames: detail.frames, totalFrames: detail.totalFrames, encoder: detail.encoder };
      }
      if (detail.phase === 'encode-complete') {
        const encodeMs = Date.now() - (job.currentEncodeStartedAtMs || Date.now());
        if (encodeMs > 0) {
          job.observedDurations.encodeMs.push(encodeMs);
        }
        job.phase = 'finalizing';
        job.phaseStartedAtMs = Date.now();
        job.currentFinalizeStartedAtMs = Date.now();
      }
      if (detail.phase === 'language-complete') {
        const finalizeMs = Date.now() - (job.currentFinalizeStartedAtMs || Date.now());
        if (finalizeMs > 0) {
          job.observedDurations.finalizeMs.push(finalizeMs);
        }
        markCurrentLanguageComplete(job);
        job.phase = 'complete';
        job.phaseStartedAtMs = Date.now();
      }
      if (detail.phase === 'playback-start') {
        job.currentPlaybackStartedElapsedMs = detail.elapsedMs;
      }
    } catch (error) {
      writeJobLogLine(job, `[walkthrough-export] Could not parse phase timing: ${error.message}`);
    }
  }
  const languageMatch = line.match(/^\[walkthrough\] Language\s+([a-z]{2,3}(?:-[A-Za-z0-9]+)*)$/);
  if (languageMatch) {
    job.currentLanguage = languageMatch[1].trim();
    job.currentLanguageStartedAtMs = Date.now();
    job.phase = 'setup';
    job.phaseStartedAtMs = Date.now();
  }
  if (!phaseMatch && (line.includes('[walkthrough] Capturing frames') || line.includes('[walkthrough] Playback start'))) {
    job.phase = 'playback';
    job.phaseStartedAtMs = Date.now();
  }
  if (!phaseMatch && (line.includes('[walkthrough] Result: complete') || line.includes('[walkthrough] Captured frames:'))) {
    job.phase = 'encode';
    job.phaseStartedAtMs = Date.now();
  }
  if (line.includes('[walkthrough] Language complete')) {
    markCurrentLanguageComplete(job);
    job.phase = 'complete';
    job.phaseStartedAtMs = Date.now();
  }
  job.updatedAt = now();
};

const runJob = async (job) => {
  job.preparing = true;
  job.status = 'running';
  job.startedAtMs = Date.now();
  job.updatedAt = now();
  await mkdir(job.outputDir, { recursive: true });
  await writeFile(job.planPath, JSON.stringify(job.plan, null, 2));
  const sessionStatePath = path.join(job.outputDir, '.browser-state.json');
  if (job.browserState) await writeFile(sessionStatePath, JSON.stringify(job.browserState), { mode: 0o600 });
  await writeFile(job.logPath, [
    `${now()} [walkthrough-export] Job ${job.id} started.`,
    `${now()} [walkthrough-export] Name: ${job.name}`,
    `${now()} [walkthrough-export] URL: ${job.url}`,
    `${now()} [walkthrough-export] Languages: ${job.languages.join(', ')}`,
    `${now()} [walkthrough-export] Settings: ${job.settings.fps}fps, ${job.settings.quality} quality`,
    `${now()} [walkthrough-export] Output: ${job.outputDir}`,
    `${now()} [walkthrough-export] Plan: ${job.planPath}`,
  ].join('\n') + '\n');

  const args = [
    path.join(repoRoot, 'scripts/run-walkthrough-playwright.mjs'),
    '--plan',
    job.planPath,
    '--url',
    job.url,
    '--languages',
    job.languages.join(','),
    '--output-dir',
    job.outputDir,
    '--fps',
    String(job.settings.fps),
    '--quality',
    job.settings.quality,
    '--resolution', job.settings.resolution,
    '--headless',
    '1',
  ];

  if (job.status === 'canceled') {
    await unlink(sessionStatePath).catch(() => {});
    job.browserState = undefined;
    job.preparing = false;
    persistJob(job);
    return;
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    cwd: repoRoot,
    env: {
      ...process.env,
      WALKTHROUGH_HEADLESS: '1',
      WALKTHROUGH_RUNTIME_CONFIG: JSON.stringify(job.runtimeConfig),
      WALKTHROUGH_BROWSER_STATE: job.browserState ? sessionStatePath : '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  job.child = child;
  job.preparing = false;
  job.processId = child.pid;
  writeJobLogLine(job, `[walkthrough-export] Spawned process ${child.pid}: ${process.execPath} ${args.join(' ')}`);

  createInterface({ input: child.stdout }).on('line', line => updateJobFromLine(job, line));
  createInterface({ input: child.stderr }).on('line', line => updateJobFromLine(job, line));
  child.on('error', (error) => {
    void unlink(sessionStatePath).catch(() => {});
    if (job.status === 'canceled') return;
    job.error = error.stack || error.message;
    job.status = 'failed';
    job.updatedAt = now();
    writeJobLogLine(job, `[walkthrough-export] Spawn failed: ${job.error}`);
  });
  child.on('close', (code, signal) => {
    void unlink(sessionStatePath).catch(() => {});
    job.browserState = undefined;
    job.child = undefined;
    job.processId = undefined;
    if (job.status === 'canceled') {
      job.updatedAt = now();
      writeJobLogLine(job, `[walkthrough-export] Process canceled with code ${code ?? 'none'}${signal ? ` and signal ${signal}` : ''}. Status: ${job.status}`);
      return;
    }
    if (code === 0) {
      job.completedLanguages = job.languages.length;
      job.status = 'completed';
      job.error = undefined;
    } else {
      job.status = 'failed';
      job.error = `Playwright export exited with code ${code}.`;
    }
    job.updatedAt = now();
    writeJobLogLine(job, `[walkthrough-export] Process exited with code ${code}. Status: ${job.status}`);
  });
};

app.get('/api/walkthrough-export/health', (_request, response) => {
  response.json({
    logFiles: true,
    ok: true,
    outputRoot: OUTPUT_ROOT,
  });
});

app.use('/api/walkthrough-export/jobs', (request, response, next) => {
  if (!request.recordingSession) return response.status(401).json({ error: 'Open Recording Studio first' });
  const id = request.path.split('/')[1];
  if (id && jobs.get(id)?.appId !== request.recordingSession.appId) return response.status(404).json({ error: 'Job not found' });
  next();
});

app.get('/api/walkthrough-export/jobs', (request, response) => {
  response.json({
    jobs: [...jobs.values()].filter(job => job.appId === request.recordingSession.appId).map(summarizeJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
});

app.get('/api/walkthrough-export/jobs/:id', (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'Job not found.' });
    return;
  }
  response.json(summarizeJob(job));
});

app.post('/api/walkthrough-export/jobs/:id/cancel', (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (['completed', 'failed', 'canceled'].includes(job.status)) {
    response.json(summarizeJob(job));
    return;
  }
  job.status = 'canceled';
  job.error = undefined;
  job.phase = 'canceled';
  job.updatedAt = now();
  writeJobLogLine(job, '[walkthrough-export] Cancel requested by browser.');
  if (job.child && !job.child.killed) {
    const child = job.child;
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        writeJobLogLine(job, '[walkthrough-export] Cancel escalation: SIGKILL.');
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
    }, 2500);
    killTimer.unref();
    child.once('close', () => clearTimeout(killTimer));
  }
  response.json(summarizeJob(job));
});

app.post('/api/walkthrough-export/jobs', asyncRoute(async (request, response) => {
  if (!request.recordingSession.videoExportEnabled) return response.status(403).json({ error: 'Video export is disabled for this app profile' });
  if (preparingExport || [...jobs.values()].some(job => job.preparing || job.child || ['running', 'queued'].includes(job.status))) return response.status(409).json({ error: 'Another export is running. Wait for it to finish before starting the next.' });
  const {
    languages,
    name,
    plan,
    settings: rawSettings,
    url,
  } = request.body || {};
  if (!plan || !Array.isArray(plan.scenes)) {
    response.status(400).json({ error: 'A walkthrough plan with scenes is required.' });
    return;
  }
  const selectedLanguages = Array.isArray(languages) && languages.length
    ? languages.map((language) => String(language).trim()).filter(Boolean)
    : ['en'];
  if (selectedLanguages.length > 12 || selectedLanguages.some(value => !/^[a-z]{2,3}(?:-[a-zA-Z0-9]+)?$/.test(value))) return response.status(400).json({ error: 'Invalid export languages' });
  preparingExport = true;
  try {
  const id = createJobId();
  const outputDir = path.join(OUTPUT_ROOT, id);
  const settings = normalizeExportSettings(rawSettings);
  const estimate = createExportEstimate(plan, selectedLanguages, settings);
  try {
    const disk = await assertEnoughDiskSpace({
      languages: selectedLanguages,
      outputDir,
      plan,
      settings,
    });
    estimate.disk = disk;
  } catch (error) {
    response.status(error.statusCode || 500).json({
      disk: error.disk,
      error: error.message || 'Could not verify disk space for export.',
    });
    return;
  }
  const job = {
    browserState: request.recordingSession.browser ? await request.recordingSession.browser.storageState() : undefined,
    appId: request.recordingSession.appId,
    runtimeConfig: { appId: request.recordingSession.appId, appUrl: request.recordingSession.appUrl,
      readySelector: request.recordingSession.readySelector, exportOnly: true },
    completedLanguages: 0,
    createdAt: now(),
    currentLanguage: undefined,
    completedLanguageCodes: new Set(),
    error: undefined,
    id,
    languages: selectedLanguages,
    log: [],
    logPath: path.join(outputDir, 'export.log'),
    name: name || plan.title || 'Walkthrough export',
    outputDir,
    estimate,
    lastProgress: 0,
    observedDurations: {
      encodeMs: [],
      finalizeMs: [],
      playbackMs: [],
      setupMs: [],
    },
    phase: 'queued',
    phaseStartedAtMs: undefined,
    plan,
    planPath: path.join(outputDir, 'plan.json'),
    settings,
    status: 'queued',
    updatedAt: now(),
    url: request.recordingSession.appUrl,
  };
  jobs.set(id, job);
  response.status(202).json(summarizeJob(job));
  runJob(job).catch((error) => {
    job.preparing = false;
    job.browserState = undefined;
    void unlink(path.join(job.outputDir, '.browser-state.json')).catch(() => {});
    if (job.status === 'canceled') return;
    job.error = error.stack || error.message;
    job.status = 'failed';
    job.updatedAt = now();
    writeJobLogLine(job, `[walkthrough-export] Job failed before Playwright completed: ${job.error}`);
  });
  } finally { preparingExport = false; }
}));

app.use((error, _request, response, _next) => {
  console.error('[recording-studio]', error);
  response.status(error.status || 400).json({ error: error.message || 'Recording operation failed' });
});

await mkdir(OUTPUT_ROOT, { recursive: true });
for (const directory of await readdir(OUTPUT_ROOT, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  await unlink(path.join(OUTPUT_ROOT, directory.name, '.browser-state.json')).catch(() => {});
  try {
    const saved = JSON.parse(await readFile(path.join(OUTPUT_ROOT, directory.name, 'job.json'), 'utf8'));
    if (['running', 'queued'].includes(saved.status)) {
      saved.status = 'failed'; saved.error = 'Export interrupted by service restart. Start a new export.';
    }
    jobs.set(saved.id, { ...saved, archived: true });
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Could not read export job:', directory.name, error.message); }
}

const server = app.listen(PORT, HOST, () => {
  console.log(`[walkthrough-export] Listening on http://${HOST}:${PORT}`);
  console.log(`[walkthrough-export] Outputs: ${OUTPUT_ROOT}`);
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const job of jobs.values()) {
    if (job.child?.pid) { try { process.kill(-job.child.pid, 'SIGTERM'); } catch {} }
  }
  const deadline = setTimeout(() => process.exit(1), 5000);
  deadline.unref();
  await studio.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.on('error', (error) => {
  if (['EADDRINUSE', 'EPERM'].includes(error.code)) {
    console.error(`[walkthrough-export] Could not bind ${HOST}:${PORT} (${error.code}).`);
    console.error(`[walkthrough-export] If export is already connected in the browser, leave it running.`);
    console.error(`[walkthrough-export] To restart it: kill $(lsof -tiTCP:${PORT} -sTCP:LISTEN)`);
    process.exit(1);
  }
  throw error;
});
