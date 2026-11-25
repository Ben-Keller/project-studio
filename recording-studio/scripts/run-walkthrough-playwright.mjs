#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
} from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { createInterface } from 'node:readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_EXPORT_FPS as OUTPUT_VIDEO_FPS, DEFAULT_EXPORT_QUALITY, DEFAULT_EXPORT_RESOLUTION, EXPORT_RESOLUTION_OPTIONS, getExportDimensions, getFrameCaptureTimeScale } from '../shared/exportSettings.mjs';
import { createCaptureClock, createFrameList, resampleFramesToOutputTimeline } from './frameTimeline.mjs';
import { installExportStabilityGuards, installPageTemporalSupersampling } from './exportRuntime.mjs';

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

const FRAME_CAPTURE_FPS = 60;
const FRAME_CAPTURE_FIRST_FRAME_TIMEOUT_MS = 1500;
const EXPORT_FPS_OPTIONS = new Set([30, 60, 120]);
const EXPORT_QUALITY_PRESETS = {
  standard: {
    crf: '18',
    frameFormat: 'jpeg',
    frameQuality: 92,
    pixelFormat: 'yuv420p',
    profile: 'high',
    scaleFlags: 'lanczos',
    x264Metadata: undefined,
  },
  high: {
    crf: '14',
    frameFormat: 'png',
    frameQuality: undefined,
    pixelFormat: 'yuv444p',
    profile: 'high444',
    scaleFlags: 'lanczos+accurate_rnd+full_chroma_int',
    x264Metadata: 'h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=0',
  },
  maximum: {
    crf: '10',
    frameFormat: 'png',
    frameQuality: undefined,
    pixelFormat: 'yuv444p',
    profile: 'high444',
    scaleFlags: 'lanczos+accurate_rnd+full_chroma_int',
    x264Metadata: 'h264_metadata=colour_primaries=1:transfer_characteristics=13:matrix_coefficients=1:video_full_range_flag=0',
  },
};

const DEFAULTS = {
  baseUrl: `http://localhost:3000${DEFAULT_APP_PATH}`,
  channel: 'chrome',
  deviceScaleFactor: 1,
  outputDir: 'outputs/playwright',
  timeoutMs: 180000,
  fontTimeoutMs: 15000,
  viewport: { width: 1470, height: 956 },
  zoom: 0.8,
};

const HELP = `
Playwright walkthrough capture

Usage:
  npm run walkthrough:playwright -- [options]

Options:
  --url <url>                 Local app URL. Default: ${DEFAULTS.baseUrl}
  --resolution <value>        1080p, 1440p, or 4k (default: 1080p)
  --viewport <width>x<height> Viewport. Default: 1470x956
  --zoom <number>             CSS zoom applied to the page. Default: 0.8
  --device-scale-factor <n>   Legacy frame metadata; export pixel density follows --resolution
  --speed <number>            Walkthrough playback speed. Default: 1
  --captions <0|1>            Show captions. Default: 1
  --strict <0|1>              Fail on missing walkthrough targets. Default: 1
  --headless <0|1>            Run headless. Default: 0
  --video <0|1>               Record video. Default: 1
  --fps <30|60|120>           Output video frame rate. Default: ${OUTPUT_VIDEO_FPS}
  --quality <name>            Output quality: standard, high, or maximum. Default: ${DEFAULT_EXPORT_QUALITY}
  --capture <method>          Video capture method: auto, screencast, or screenshot. Default: auto
  --trace <0|1>               Save Playwright trace zip. Default: 0
  --trim-loading <0|1>        Write final MP4 without page-load lead-in. Default: 1
  --manifest <0|1>            Write walkthrough-run.json for successful runs. Default: 0
  --screenshot <0|1>          Write walkthrough-final.png for successful runs. Default: 0
  --keep-open <0|1>           Keep browser open after run. Default: 0
  --output-dir <path>         Output directory. Default: ${DEFAULTS.outputDir}
  --plan <path>               Walkthrough JSON plan to inject through localStorage.
  --language <code>           App language to set before playback, e.g. en or fr. Default: en
  --languages <codes>         Comma-separated language batch, e.g. en,es,fr,zh,pt,ru,ar
  --timeout-ms <number>       Max wait for walkthrough completion. Default: ${DEFAULTS.timeoutMs}
  --font-timeout-ms <number>  Max wait for web fonts before playback. Default: ${DEFAULTS.fontTimeoutMs}
  --channel <name>            Browser channel, e.g. chrome or chromium. Default: chrome
  --dry-run                   Validate config and plan without launching browser.
  --help                      Print this help.
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const withoutPrefix = item.slice(2);
    const equalIndex = withoutPrefix.indexOf('=');
    if (equalIndex >= 0) {
      args[withoutPrefix.slice(0, equalIndex)] = withoutPrefix.slice(equalIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[withoutPrefix] = next;
      index += 1;
    } else {
      args[withoutPrefix] = '1';
    }
  }
  return args;
};

const cliArgs = parseArgs(process.argv.slice(2));
const PREVIEW_PLAN_STORAGE_KEY = process.env.WALKTHROUGH_PREVIEW_PLAN_STORAGE_KEY || 'moonshot-walkthrough-preview-plan';
const APP_LANGUAGE_STORAGE_KEY = process.env.WALKTHROUGH_LANGUAGE_STORAGE_KEY || 'moonshot-language';
const WALKTHROUGH_COMPLETE_EVENT = process.env.WALKTHROUGH_COMPLETE_EVENT || 'moonshot-walkthrough-complete';
const WALKTHROUGH_ENTRY_SCRIPT_ID = process.env.WALKTHROUGH_ENTRY_SCRIPT_ID || 'local-walkthrough-studio-script';
const WALKTHROUGH_ERROR_EVENT = process.env.WALKTHROUGH_ERROR_EVENT || 'moonshot-walkthrough-error';
const WALKTHROUGH_READY_EVENT = process.env.WALKTHROUGH_READY_EVENT || 'moonshot-walkthrough-ready';
const WALKTHROUGH_READY_WINDOW_KEY = process.env.WALKTHROUGH_READY_WINDOW_KEY || '__moonshotWalkthroughReady';
const WALKTHROUGH_START_EVENT = process.env.WALKTHROUGH_START_EVENT || 'moonshot-walkthrough-start';
const WALKTHROUGH_STATE_WINDOW_KEY = process.env.WALKTHROUGH_STATE_WINDOW_KEY || '__moonshotWalkthroughState';

const getOption = (name, envName, defaultValue) => (
  cliArgs[name] ?? process.env[envName] ?? defaultValue
);

const parseBoolean = (value, defaultValue) => {
  if (value === undefined) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
};

const parseNumber = (value, defaultValue, label) => {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  throw new Error(`${label} must be a finite number. Received "${value}".`);
};

const parseExportFps = (value) => {
  const fps = Number(value ?? OUTPUT_VIDEO_FPS);
  if (EXPORT_FPS_OPTIONS.has(fps)) return fps;
  throw new Error(`FPS must be one of ${[...EXPORT_FPS_OPTIONS].join(', ')}. Received "${value}".`);
};

const parseExportQuality = (value) => {
  const quality = String(value || DEFAULT_EXPORT_QUALITY).toLowerCase();
  if (EXPORT_QUALITY_PRESETS[quality]) return quality;
  throw new Error(`Quality must be one of ${Object.keys(EXPORT_QUALITY_PRESETS).join(', ')}. Received "${value}".`);
};

const getExportDeviceScaleFactor = (value) => {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

const parseViewport = (value) => {
  const match = String(value || '').match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error(`Viewport must use WIDTHxHEIGHT format. Received "${value}".`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
};

const runProcess = (command, args, onLine) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (onLine) createInterface({ input: child.stdout }).on('line', onLine);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = (stdout + String(chunk)).slice(-65536);
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-65536);
  });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve({ stdout, stderr });
      return;
    }
    reject(new Error(`${command} exited with code ${code}.\n${stderr || stdout}`));
  });
});

const sleep = (durationMs) => new Promise((resolve) => {
  setTimeout(resolve, Math.max(0, durationMs));
});

const importPlaywright = async () => {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      'Playwright is not installed. Run `npm install --save-dev playwright`, then `npx playwright install chromium` if Chromium is missing.',
    );
  }
};

const resolvePath = (filePath) => (
  path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath)
);

const loadPlan = async (customPlanPath) => {
  const planPath = customPlanPath
    ? resolvePath(customPlanPath)
    : path.join(localWalkthroughRoot, 'src/walkthroughPlan.json');
  const rawPlan = await readFile(planPath, 'utf8');
  return {
    path: planPath,
    rawPlan,
    plan: JSON.parse(rawPlan),
  };
};

const withExportLanguageAppState = (appState, language) => {
  if (!appState || typeof appState !== 'object') return appState;
  return {
    ...appState,
    language,
  };
};

const RTL_EXPORT_LANGUAGES = new Set(['ar']);

const HORIZONTAL_ANCHOR_FLIPS = {
  left: 'right',
  right: 'left',
  'top-left': 'top-right',
  'top-right': 'top-left',
  'bottom-left': 'bottom-right',
  'bottom-right': 'bottom-left',
};

const isRtlExportLanguage = (language) => (
  RTL_EXPORT_LANGUAGES.has(String(language || '').toLowerCase().split('-')[0])
);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const mirrorValueAcrossWidth = (value, viewportWidth) => (
  isFiniteNumber(value) && isFiniteNumber(viewportWidth)
    ? Math.round(viewportWidth - value)
    : value
);

const flipHorizontalAnchor = (anchor) => HORIZONTAL_ANCHOR_FLIPS[anchor] || anchor;

const mirrorActionForRtlExport = (action, viewportWidth) => {
  const nextAction = { ...action };
  if (nextAction.targetPosition) {
    nextAction.targetPosition = { ...nextAction.targetPosition, x: 1 - nextAction.targetPosition.x };
  }
  if (typeof nextAction.anchor === 'string') {
    nextAction.anchor = flipHorizontalAnchor(nextAction.anchor);
  }
  if (isFiniteNumber(nextAction.offsetX)) {
    nextAction.offsetX = -nextAction.offsetX;
  }
  if (!nextAction.target && isFiniteNumber(nextAction.x)) {
    nextAction.x = mirrorValueAcrossWidth(nextAction.x, viewportWidth);
  }
  return nextAction;
};

const isLanguageControlSelector = (selector = '') => (
  selector === '#language-select'
  || selector === '#mobile-language-select'
  || selector.includes('[data-walkthrough-target="dashboard-language"] > select')
);

const localizeStateSnapshotForExport = (snapshot, language, viewportWidth) => {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return {
    ...snapshot,
    appState: withExportLanguageAppState(snapshot.appState, language),
    elements: Array.isArray(snapshot.elements)
      ? snapshot.elements.filter((element) => !isLanguageControlSelector(element?.selector))
      : snapshot.elements,
    setupActions: Array.isArray(snapshot.setupActions)
      ? snapshot.setupActions.map((setupAction) => localizeActionForExport(setupAction, language, viewportWidth))
      : snapshot.setupActions,
  };
};

const localizeActionForExport = (action, language, viewportWidth) => {
  let nextAction = { ...action };
  if (nextAction.appState) {
    nextAction.appState = withExportLanguageAppState(nextAction.appState, language);
  }
  if (nextAction.state) {
    nextAction.state = localizeStateSnapshotForExport(nextAction.state, language, viewportWidth);
  }
  if (isRtlExportLanguage(language)) {
    nextAction = mirrorActionForRtlExport(nextAction, viewportWidth);
  }
  return nextAction;
};

const localizePlanForExport = (plan, language, viewportWidth) => {
  const mirroredStart = isRtlExportLanguage(language) && plan.start
    ? {
      ...plan.start,
      x: mirrorValueAcrossWidth(plan.start.x, viewportWidth),
    }
    : plan.start;
  return {
    ...plan,
    start: mirroredStart,
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      actions: scene.actions.map((action) => localizeActionForExport(action, language, viewportWidth)),
    })),
  };
};

const getStartupTarget = (plan) => {
  const actions = Array.isArray(plan?.scenes)
    ? plan.scenes.flatMap((scene) => (Array.isArray(scene.actions) ? scene.actions : []))
    : [];
  const action = actions.find((item) => (
    item?.target
    && !['scroll', 'wait', 'tooltip', 'state'].includes(item.type)
  ));
  return action?.target;
};

const waitForWalkthroughTarget = async (page, target, timeout = 60000) => {
  if (!target) return;
  await page.waitForFunction((targetName) => {
    if (/^[#.[]/.test(targetName)) return Boolean(document.querySelector(targetName));
    return Array.from(document.querySelectorAll('[data-walkthrough-target]'))
      .some((element) => element.getAttribute('data-walkthrough-target') === targetName);
  }, target, { timeout });
};

const validatePlan = (plan) => {
  const errors = [];
  if (!plan || typeof plan !== 'object') errors.push('Plan must be a JSON object.');
  if (!plan.title) errors.push('Plan is missing title.');
  if (!plan.defaults) errors.push('Plan is missing defaults.');
  if (!plan.start || typeof plan.start.x !== 'number' || typeof plan.start.y !== 'number') {
    errors.push('Plan start must include numeric x and y.');
  }
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    errors.push('Plan must include at least one scene.');
  }
  plan.scenes?.forEach((scene, sceneIndex) => {
    if (!scene.id) errors.push(`Scene ${sceneIndex + 1} is missing id.`);
    if (!Array.isArray(scene.actions)) errors.push(`Scene ${scene.id || sceneIndex + 1} has no actions array.`);
    scene.actions?.forEach((action, actionIndex) => {
      if (!action.type) errors.push(`Scene ${scene.id || sceneIndex + 1}, action ${actionIndex + 1} is missing type.`);
      const canUseCoordinates = typeof action.x === 'number' && typeof action.y === 'number';
      const needsTargetOrPoint = !['wait', 'tooltip'].includes(action.type);
      if (needsTargetOrPoint && !action.target && !canUseCoordinates && typeof action.scrollTop !== 'number') {
        errors.push(`Scene ${scene.id || sceneIndex + 1}, action ${actionIndex + 1} needs target, coordinates, or scrollTop.`);
      }
    });
  });
  return errors;
};

const getConfig = () => {
  const configuredViewport = cliArgs.viewport ?? process.env.WALKTHROUGH_VIEWPORT;
  const viewportValue = configuredViewport || `${DEFAULTS.viewport.width}x${DEFAULTS.viewport.height}`;
  const viewport = parseViewport(viewportValue);
  const configuredZoom = cliArgs.zoom ?? process.env.WALKTHROUGH_ZOOM;
  const zoom = parseNumber(configuredZoom || DEFAULTS.zoom, DEFAULTS.zoom, 'Zoom');
  const configuredDeviceScaleFactor = cliArgs['device-scale-factor'] ?? process.env.WALKTHROUGH_DEVICE_SCALE_FACTOR;
  const deviceScaleFactor = configuredDeviceScaleFactor
    ? parseNumber(configuredDeviceScaleFactor, DEFAULTS.deviceScaleFactor, 'Device scale factor')
    : getExportDeviceScaleFactor(DEFAULTS.deviceScaleFactor);
  const speed = parseNumber(getOption('speed', 'WALKTHROUGH_SPEED', 1), 1, 'Speed');
  const timeoutMs = parseNumber(
    getOption('timeout-ms', 'WALKTHROUGH_TIMEOUT_MS', DEFAULTS.timeoutMs),
    DEFAULTS.timeoutMs,
    'Timeout',
  );
  const fontTimeoutMs = parseNumber(
    getOption('font-timeout-ms', 'WALKTHROUGH_FONT_TIMEOUT_MS', DEFAULTS.fontTimeoutMs),
    DEFAULTS.fontTimeoutMs,
    'Font timeout',
  );
  const outputDir = path.resolve(repoRoot, getOption('output-dir', 'WALKTHROUGH_OUTPUT_DIR', DEFAULTS.outputDir));
  const configuredUrl = cliArgs.url ?? process.env.WALKTHROUGH_URL;
  const baseUrl = configuredUrl || DEFAULTS.baseUrl;
  const customPlanPath = getOption('plan', 'WALKTHROUGH_PLAN_PATH', undefined);
  const language = getOption('language', 'WALKTHROUGH_LANGUAGE', 'en');
  const languages = String(getOption('languages', 'WALKTHROUGH_LANGUAGES', language))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const strict = parseBoolean(getOption('strict', 'WALKTHROUGH_STRICT', '1'), true);
  const showCaptions = parseBoolean(getOption('captions', 'WALKTHROUGH_CAPTIONS', '1'), true);
  const outputFps = parseExportFps(getOption('fps', 'WALKTHROUGH_FPS', OUTPUT_VIDEO_FPS));
  const exportQuality = parseExportQuality(getOption('quality', 'WALKTHROUGH_QUALITY', DEFAULT_EXPORT_QUALITY));
  const captureMethod = String(getOption('capture', 'WALKTHROUGH_CAPTURE_METHOD', 'auto')).toLowerCase();
  if (!['auto', 'screencast', 'screenshot'].includes(captureMethod)) {
    throw new Error(`Capture method must be one of auto, screencast, or screenshot. Received "${captureMethod}".`);
  }

  const resolution = String(getOption('resolution', 'WALKTHROUGH_RESOLUTION', DEFAULT_EXPORT_RESOLUTION)).toLowerCase();
  if (!EXPORT_RESOLUTION_OPTIONS.includes(resolution)) throw new Error('Resolution must be 1080p, 1440p, or 4k.');
  return {
    resolution,
    captureMethod,
    channel: getOption('channel', 'WALKTHROUGH_CHANNEL', DEFAULTS.channel),
    dryRun: parseBoolean(cliArgs['dry-run'], false),
    deviceScaleFactor,
    deviceScaleFactorWasDefaulted: !configuredDeviceScaleFactor,
    fontTimeoutMs,
    headless: parseBoolean(getOption('headless', 'WALKTHROUGH_HEADLESS', '0'), false),
    keepOpen: parseBoolean(getOption('keep-open', 'WALKTHROUGH_KEEP_OPEN', '0'), false),
    language,
    languages: languages.length ? languages : ['en'],
    locale: getOption('locale', 'WALKTHROUGH_LOCALE', 'en-US'),
    outputDir,
    outputFps,
    exportQuality,
    qualityPreset: EXPORT_QUALITY_PRESETS[exportQuality],
    planPath: customPlanPath ? resolvePath(customPlanPath) : undefined,
    recordTrace: parseBoolean(getOption('trace', 'WALKTHROUGH_TRACE', '0'), false),
    recordManifest: parseBoolean(getOption('manifest', 'WALKTHROUGH_MANIFEST', '0'), false),
    recordScreenshot: parseBoolean(getOption('screenshot', 'WALKTHROUGH_SCREENSHOT', '0'), false),
    trimLoading: parseBoolean(getOption('trim-loading', 'WALKTHROUGH_TRIM_LOADING', '1'), true),
    recordVideo: parseBoolean(getOption('video', 'WALKTHROUGH_VIDEO', '1'), true),
    screenshotPath: path.join(outputDir, 'walkthrough-final.png'),
    timeoutMs,
    showCaptions,
    speed,
    strict,
    url: baseUrl,
    urlWasDefaulted: !configuredUrl,
    viewport,
    viewportWasDefaulted: !configuredViewport,
    zoom,
    zoomWasDefaulted: !configuredZoom,
  };
};

const normalizePlanExportFrame = (frame) => {
  if (!frame || typeof frame !== 'object') return undefined;
  const width = Number(frame.viewport?.width);
  const height = Number(frame.viewport?.height);
  const zoom = Number(frame.zoom);
  const deviceScaleFactor = Number(frame.deviceScaleFactor);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return {
    deviceScaleFactor: getExportDeviceScaleFactor(deviceScaleFactor),
    viewport: {
      height: Math.round(Math.max(480, Math.min(2160, height))),
      width: Math.round(Math.max(640, Math.min(3840, width))),
    },
    zoom: Number.isFinite(zoom) ? Math.max(0.5, Math.min(1.5, zoom)) : DEFAULTS.zoom,
  };
};

const applyPlanExportFrame = (config, plan) => {
  const exportFrame = normalizePlanExportFrame(plan?.exportFrame);
  if (!exportFrame) return config;
  const nextConfig = { ...config };
  if (config.viewportWasDefaulted) {
    nextConfig.viewport = exportFrame.viewport;
  }
  if (config.zoomWasDefaulted) {
    nextConfig.zoom = exportFrame.zoom;
  }
  if (config.deviceScaleFactorWasDefaulted) {
    nextConfig.deviceScaleFactor = exportFrame.deviceScaleFactor;
  }
  nextConfig.planExportFrame = exportFrame;
  return nextConfig;
};

const getEvenDimension = (value) => {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
};

const getOutputVideoSize = (config) => ({
  height: getEvenDimension(config.viewport.height * config.deviceScaleFactor),
  width: getEvenDimension(config.viewport.width * config.deviceScaleFactor),
});

const findFfmpeg = async () => {
  const candidates = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await runProcess(candidate, ['-version']);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
};


const writeFrameVideo = async ({
  frames,
  outputDir,
  outputFps = OUTPUT_VIDEO_FPS,
  outputVideoSize,
  qualityPreset = EXPORT_QUALITY_PRESETS[DEFAULT_EXPORT_QUALITY],
  timeScale = 1,
  quality = DEFAULT_EXPORT_QUALITY,
  onProgress,
}) => {
  if (!frames.length) return undefined;
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    console.warn('[walkthrough] ffmpeg was not found. Keeping captured frames without MP4 post-processing.');
    return undefined;
  }
  let hardware = false;
  if (quality === 'standard' && process.platform === 'darwin') {
    try {
      await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=1',
        '-frames:v', '1', '-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-f', 'null', '-']);
      hardware = true;
    } catch {
      console.log('[walkthrough] Hardware encoder unavailable; using fast software encoding.');
    }
  }
  const encoder = hardware ? 'h264_videotoolbox' : 'libx264';
  console.log(`[walkthrough] Video encoder: ${encoder}`);
  const finalVideoPath = path.join(outputDir, 'walkthrough-video.mp4');
  const frameListPath = path.join(outputDir, 'walkthrough-frames.txt');
  const resampled = resampleFramesToOutputTimeline({
    frames,
    outputFps,
    timeScale,
  });
  console.log(`[walkthrough] Resampled frames: ${resampled.sampledFrames.length} output frames from ${frames.length} captured frames; ${resampled.uniqueFrames} unique, ${resampled.repeatedFrames} repeated; duration ${(resampled.outputDurationMs / 1000).toFixed(2)}s at ${outputFps}fps`);
  await writeFile(frameListPath, createFrameList({ ...resampled, outputFps }));
  // Chrome captures sRGB. Preserve that transfer curve while explicitly encoding
  // limited-range BT.709 YUV; matching tags prevent player-dependent gamma shifts.
  const ffmpegArgs = [
    '-y',
    '-progress', 'pipe:1', '-nostats',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    frameListPath,
    '-an',
    '-frames:v',
    String(resampled.sampledFrames.length),
    '-vf',
    `scale=${outputVideoSize.width}:${outputVideoSize.height}:flags=${qualityPreset.scaleFlags}:in_range=pc:out_range=tv:out_color_matrix=bt709,crop=trunc(iw/2)*2:trunc(ih/2)*2,format=${qualityPreset.pixelFormat},setparams=range=limited:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709`,
    '-c:v',
    encoder,
    '-profile:v',
    qualityPreset.profile,
    ...(hardware
      ? ['-allow_sw', '0', '-b:v', String(Math.round(outputVideoSize.width * outputVideoSize.height * outputFps * 0.16))]
      : ['-preset', quality === 'maximum' ? 'medium' : 'veryfast', '-crf', qualityPreset.crf]),
    '-pix_fmt',
    qualityPreset.pixelFormat,
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'iec61966-2-1',
    '-movflags',
    '+faststart+write_colr',
    '-r',
    String(outputFps),
    '-fps_mode',
    'cfr',
    '-video_track_timescale',
    String(outputFps * 1000),
    finalVideoPath,
  ];
  if (qualityPreset.x264Metadata) {
    ffmpegArgs.splice(ffmpegArgs.indexOf('-movflags'), 0, '-bsf:v', qualityPreset.x264Metadata);
  }
  const totalFrames = resampled.sampledFrames.length;
  onProgress?.({ frames: 0, totalFrames, encoder });
  let framesDone = 0;
  await runProcess(ffmpeg, ffmpegArgs, line => {
    if (line.startsWith('frame=')) framesDone = Math.min(totalFrames, Number(line.slice(6)) || 0);
    if (line.startsWith('progress=')) onProgress?.({ frames: framesDone, totalFrames, encoder });
  });
  onProgress?.({ frames: totalFrames, totalFrames, encoder });
  console.log(`[walkthrough] Compatibility MP4: ${finalVideoPath}`);
  await rm(frameListPath, { force: true }).catch(() => undefined);
  return finalVideoPath;
};

const getFrameCaptureStats = (frames) => {
  if (frames.length < 2) {
    return {
      averageIntervalMs: 0,
      effectiveFps: frames.length,
      maxIntervalMs: 0,
      minIntervalMs: 0,
    };
  }
  const intervals = frames.slice(1).map((frame, index) => frame.capturedAt - frames[index].capturedAt);
  const durationMs = Math.max(1, frames[frames.length - 1].capturedAt - frames[0].capturedAt);
  return {
    averageIntervalMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
    effectiveFps: ((frames.length - 1) / durationMs) * 1000,
    maxIntervalMs: Math.max(...intervals),
    minIntervalMs: Math.min(...intervals),
  };
};

const startScreenshotFrameCapture = async ({
  framesDir,
  page,
  qualityPreset = EXPORT_QUALITY_PRESETS[DEFAULT_EXPORT_QUALITY],
}) => {
  const frames = [];
  let captureError;
  let frameIndex = 0;
  let stopped = false;
  const frameIntervalMs = 1000 / FRAME_CAPTURE_FPS;
  const captureLoop = (async () => {
    while (!stopped) {
      const capturedAt = Date.now();
      const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.${qualityPreset.frameFormat}`);
      frameIndex += 1;
      try {
        const screenshotOptions = {
          animations: 'allow',
          fullPage: false,
          path: framePath,
          type: qualityPreset.frameFormat,
        };
        if (qualityPreset.frameFormat === 'jpeg' && qualityPreset.frameQuality) {
          screenshotOptions.quality = qualityPreset.frameQuality;
        }
        await page.screenshot(screenshotOptions);
        frames.push({
          capturedAt,
          path: framePath,
        });
      } catch (error) {
        if (!stopped) captureError = error;
        break;
      }
      await sleep(frameIntervalMs - (Date.now() - capturedAt));
    }
  })();
  return {
    framesDir,
    method: 'screenshot-loop',
    stop: async () => {
      stopped = true;
      await captureLoop;
      if (captureError) throw captureError;
      return frames.slice();
    },
  };
};

const startCdpFrameCapture = async ({
  framesDir,
  page,
  qualityPreset = EXPORT_QUALITY_PRESETS[DEFAULT_EXPORT_QUALITY],
  videoSize,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const pendingWrites = new Set();
  let captureError;
  let firstFrameReceived = false;
  let frameIndex = 0;
  let stopped = false;
  let resolveFirstFrame;
  const captureTimestamp = createCaptureClock();
  const firstFramePromise = new Promise((resolve) => {
    resolveFirstFrame = resolve;
  });

  const handleFrame = (event) => {
    const acknowledge = () => {
      if (event?.sessionId !== undefined) void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
    };
    if (stopped || captureError) { acknowledge(); return; }
    // Bound disk pressure by holding compositor acknowledgments when writes lag.
    // Do not silently discard frames: Chrome applies its own backpressure.
    const deferAck = pendingWrites.size >= 4;
    if (!deferAck) acknowledge();
    firstFrameReceived = true;
    resolveFirstFrame();
    const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.${qualityPreset.frameFormat}`);
    frameIndex += 1;
    frames.push({
      capturedAt: captureTimestamp(event.metadata?.timestamp, Date.now()),
      path: framePath,
    });
    const pendingWrite = writeFile(framePath, Buffer.from(event.data, 'base64'))
      .catch((error) => {
        captureError = error;
      })
      .finally(() => {
        pendingWrites.delete(pendingWrite);
        if (deferAck) acknowledge();
      });
    pendingWrites.add(pendingWrite);
  };

  cdp.on('Page.screencastFrame', handleFrame);
  await cdp.send('Page.enable');
  const screencastOptions = {
    everyNthFrame: 1,
    format: qualityPreset.frameFormat,
    maxHeight: videoSize.height,
    maxWidth: videoSize.width,
  };
  if (qualityPreset.frameFormat === 'jpeg' && qualityPreset.frameQuality) {
    screencastOptions.quality = qualityPreset.frameQuality;
  }
  await cdp.send('Page.startScreencast', screencastOptions);

  await Promise.race([
    firstFramePromise,
    sleep(FRAME_CAPTURE_FIRST_FRAME_TIMEOUT_MS),
  ]);
  if (!firstFrameReceived) {
    stopped = true;
    cdp.off?.('Page.screencastFrame', handleFrame);
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    throw new Error('Chrome compositor screencast did not produce a first frame.');
  }

  return {
    framesDir,
    method: 'cdp-screencast',
    stop: async () => {
      // CDP emits only changed frames. Preserve the final static hold explicitly.
      if (!stopped && frames.length) frames.push({ ...frames[frames.length - 1], capturedAt: Date.now() });
      stopped = true;
      cdp.off?.('Page.screencastFrame', handleFrame);
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await Promise.allSettled([...pendingWrites]);
      await cdp.detach().catch(() => undefined);
      if (captureError) throw captureError;
      return frames.slice();
    },
  };
};

const startFrameCapture = async ({
  captureMethod,
  outputDir,
  page,
  qualityPreset,
  videoSize,
}) => {
  const framesDir = path.join(outputDir, '.walkthrough-frames');
  await rm(framesDir, { force: true, recursive: true });
  await mkdir(framesDir, { recursive: true });
  if (captureMethod === 'screenshot') {
    const screenshotCapture = await startScreenshotFrameCapture({
      framesDir,
      page,
      qualityPreset,
    });
    return {
      ...screenshotCapture,
      cleanup: () => rm(framesDir, { force: true, recursive: true }).catch(() => undefined),
    };
  }
  try {
    const cdpCapture = await startCdpFrameCapture({
      framesDir,
      page,
      qualityPreset,
      videoSize,
    });
    return {
      ...cdpCapture,
      cleanup: () => rm(framesDir, { force: true, recursive: true }).catch(() => undefined),
    };
  } catch (error) {
    if (captureMethod === 'screencast') throw error;
    console.warn(`[walkthrough] CDP screencast capture unavailable (${error.message}). Falling back to screenshot loop.`);
    await rm(framesDir, { force: true, recursive: true });
    await mkdir(framesDir, { recursive: true });
    const screenshotCapture = await startScreenshotFrameCapture({
      framesDir,
      page,
      qualityPreset,
    });
    return {
      ...screenshotCapture,
      cleanup: () => rm(framesDir, { force: true, recursive: true }).catch(() => undefined),
    };
  }
};

const withTrailingSlash = (url) => (url.endsWith('/') ? url : `${url}/`);

const getLocalDevUrlCandidates = (preferredUrl) => {
  const candidates = new Set([withTrailingSlash(preferredUrl)]);
  const appPaths = new Set([DEFAULT_APP_PATH]);
  try {
    appPaths.add(normalizeAppPath(new URL(preferredUrl).pathname));
  } catch {
    // Keep the configured default path only.
  }
  if (process.env.WALKTHROUGH_APP_PATH) {
    appPaths.add(normalizeAppPath(process.env.WALKTHROUGH_APP_PATH));
  }
  const ports = [
    3006,
    3005,
    3004,
    3003,
    3002,
    3001,
    3000,
    5173,
    5174,
    5175,
  ];

  ports.forEach((port) => {
    appPaths.forEach((appPath) => {
      candidates.add(`http://localhost:${port}${appPath}`);
      candidates.add(`http://127.0.0.1:${port}${appPath}`);
    });
  });

  return [...candidates];
};

const probeUrl = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveRunnableUrl = async (config) => {
  if (!config.urlWasDefaulted) return config.url;

  for (const candidate of getLocalDevUrlCandidates(config.url)) {
    if (await probeUrl(candidate)) {
      if (candidate !== config.url) {
        console.log(`[walkthrough] Default URL ${config.url} was unreachable. Using detected local app URL ${candidate}`);
      }
      return candidate;
    }
  }

  return config.url;
};

const launchChromium = async (chromium, launchOptions, preferredChannel) => {
  if (!preferredChannel || preferredChannel === 'chromium') return chromium.launch(launchOptions);
  try {
    return await chromium.launch({ ...launchOptions, channel: preferredChannel });
  } catch (error) {
    console.warn(`[walkthrough] Could not launch channel "${preferredChannel}". Falling back to bundled Chromium.`);
    return chromium.launch(launchOptions);
  }
};

const writeManifest = async (outputDir, manifest) => {
  const manifestPath = path.join(outputDir, 'walkthrough-run.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
};

const serializeError = (error) => ({
  message: error?.message || String(error),
  name: error?.name,
  stack: error?.stack,
});

const armWalkthroughResult = (page, timeoutMs) => page.evaluate(({
  completeEvent,
  errorEvent,
  timeout,
}) => {
  window.__moonshotWalkthroughResult = new Promise((resolve) => {
  const nativeSetTimeout = window.__moonshotWalkthroughTemporalSupersampling?.nativeSetTimeout || window.setTimeout;
  const finish = (result) => {
    window.clearTimeout(timer);
    window.removeEventListener(completeEvent, complete);
    window.removeEventListener(errorEvent, error);
    resolve(result);
  };
  const complete = () => finish({ status: 'complete' });
  const error = (event) => finish({ status: 'error', detail: event.detail });
  const timer = nativeSetTimeout(() => finish({ status: 'timeout' }), timeout);
  window.addEventListener(completeEvent, complete);
  window.addEventListener(errorEvent, error);
  });
}, {
  completeEvent: WALKTHROUGH_COMPLETE_EVENT,
  errorEvent: WALKTHROUGH_ERROR_EVENT,
  timeout: timeoutMs,
});

const setPageLocalStorage = async (page, entries) => {
  const failures = await page.evaluate((items) => {
    const failedKeys = [];
    items.forEach(([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        failedKeys.push({
          key,
          message: error?.message || String(error),
          name: error?.name,
        });
      }
    });
    return failedKeys;
  }, entries);
  failures.forEach((failure) => {
    console.warn(`[walkthrough] Could not write localStorage key "${failure.key}": ${failure.name || 'Error'} ${failure.message || ''}`.trim());
  });
};

const forcePageLanguage = async (page, language) => {
  await page.evaluate(async ({ language: value, languageStorageKey, stateWindowKey }) => {
    try {
      window.localStorage.setItem(languageStorageKey, value);
    } catch {
      // Language is still applied through DOM attributes and app state below.
    }
    if (document.documentElement) {
      document.documentElement.lang = value;
      document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr';
    }
    if (document.body) {
      document.body.dir = value === 'ar' ? 'rtl' : 'ltr';
    }
    await (window.__projectStudioAdapter || window[stateWindowKey])?.applyState?.({ language: value });
  }, {
    language,
    languageStorageKey: APP_LANGUAGE_STORAGE_KEY,
    stateWindowKey: WALKTHROUGH_STATE_WINDOW_KEY,
  });
};

const getFontDiagnostics = async (page) => page.evaluate(() => {
  const getComputedFamily = (selector) => {
    const element = document.querySelector(selector);
    return element ? window.getComputedStyle(element).fontFamily : undefined;
  };
  return {
    body: getComputedFamily('body'),
    documentFontsStatus: document.fonts?.status,
    loadedFonts: document.fonts
      ? Array.from(document.fonts).map((font) => ({
        family: font.family,
        status: font.status,
        style: font.style,
        weight: font.weight,
      }))
      : [],
    pageTitle: getComputedFamily('.page-title, h1, h2'),
    sample: getComputedFamily('[data-walkthrough-target], h1, h2, body'),
  };
});

const waitForFontsReady = async (page, timeoutMs) => page.evaluate((timeout) => new Promise((resolve) => {
  const finish = (status) => {
    const fontFaces = document.fonts
      ? Array.from(document.fonts).map((font) => ({
        family: font.family,
        status: font.status,
        style: font.style,
        weight: font.weight,
      }))
      : [];
    resolve({
      fontFaces,
      status,
    });
  };

  if (!document.fonts) {
    finish('unsupported');
    return;
  }

  const timer = window.setTimeout(() => {
    finish(`timeout:${document.fonts.status}`);
  }, timeout);

  document.fonts.ready
    .then(() => {
      window.clearTimeout(timer);
      finish(document.fonts.status);
    })
    .catch((error) => {
      window.clearTimeout(timer);
      finish(`error:${error?.message || error}`);
    });
}), timeoutMs);

const ensureWalkthroughReady = async (page, appUrl) => {
  if (await page.evaluate(() => Boolean(window.__moonshotWalkthroughReady))) return;
  await page.evaluate((config) => { window.__projectStudioRecording = config; }, {
    ...JSON.parse(process.env.WALKTHROUGH_RUNTIME_CONFIG || '{}'), appUrl, exportOnly: true,
  });
  await page.addScriptTag({ content: readFileSync(path.join(localWalkthroughRoot, 'dist/recorder.js'), 'utf8') });
  await page.waitForFunction(() => window.__moonshotWalkthroughReady, { timeout: 15000 });
};


const runCapture = async ({
  chromium,
  config,
  language,
  loadedPlan,
}) => {
  let browser;
  let context;
  let page;
  let result = { status: 'not-started' };
  let fatalError;
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const failedResponses = [];
  const fontResources = [];
  let captureStats = getFrameCaptureStats([]);
  let capturedFrameCount = 0;
  let captureMethod;
  let frameCapture;
  let fontDiagnostics;
  let fontReadyResult;
  let finalVideoPath;
  let playbackStartedAt = 0;
  let rawVideoPath;
  let trimStartMs = 0;
  let videoStartedAt = 0;
  const startedAt = new Date().toISOString();
  const outputDir = config.languages.length > 1
    ? path.join(config.outputDir, language)
    : config.outputDir;
  const screenshotPath = path.join(outputDir, 'walkthrough-final.png');
  const outputVideoSize = getOutputVideoSize(config);
  const rawVideoSize = outputVideoSize;
  const exportPlan = localizePlanForExport(loadedPlan.plan, language, config.viewport.width);
  const rawExportPlan = JSON.stringify(exportPlan);
  const startupTarget = getStartupTarget(exportPlan);
  const captureTimeScale = config.recordVideo ? getFrameCaptureTimeScale(config.outputFps, config.exportQuality) : 1;
  const playbackSpeed = config.speed;
  const playbackTimeoutMs = config.recordVideo
    ? Math.round((config.timeoutMs * captureTimeScale) + 30000)
    : config.timeoutMs;
  const timingStartedAtMs = Date.now();
  const timings = {};
  const markTiming = (name, extra = {}) => {
    const elapsedMs = Date.now() - timingStartedAtMs;
    timings[name] = elapsedMs;
    console.log(`[walkthrough:phase] ${JSON.stringify({
      elapsedMs,
      language,
      phase: name,
      ...extra,
    })}`);
    return elapsedMs;
  };
  await mkdir(outputDir, { recursive: true });

  try {
    markTiming('launch-start');
    browser = await launchChromium(chromium, {
      args: [
        `--window-size=${config.viewport.width},${config.viewport.height}`,
        '--disable-infobars',
        '--force-color-profile=srgb',
        '--high-dpi-support=1',
      ],
      headless: config.headless,
    }, config.channel);
    markTiming('launch-complete');

    context = await browser.newContext({
      storageState: process.env.WALKTHROUGH_BROWSER_STATE || undefined,
      bypassCSP: true,
      colorScheme: 'light',
      deviceScaleFactor: config.deviceScaleFactor,
      locale: config.locale,
      viewport: config.viewport,
    });

    if (config.recordTrace) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }

    await installExportStabilityGuards(context);
    await context.addInitScript((pageZoom) => {
      const applyZoom = () => {
        if (document.documentElement) {
          document.documentElement.style.zoom = String(pageZoom);
        }
      };
      window.addEventListener('DOMContentLoaded', applyZoom, { once: true });
      applyZoom();
    }, config.zoom);
    if (config.planPath) {
      await context.addInitScript(({ key, rawPlan }) => {
        try {
          window.localStorage.setItem(key, rawPlan);
        } catch {
          // Some browser-created documents deny storage before the app origin exists.
        }
      }, {
        key: PREVIEW_PLAN_STORAGE_KEY,
        rawPlan: rawExportPlan,
      });
    }
    await context.addInitScript(({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // The app document is set explicitly after navigation.
      }
      if (document.documentElement) {
        document.documentElement.lang = value;
      }
    }, {
      key: APP_LANGUAGE_STORAGE_KEY,
      value: language,
    });

    videoStartedAt = Date.now();
    page = await context.newPage();
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        console.log(`[navigation] main frame ${frame.url()}`);
      }
    });
    page.on('pageerror', (error) => {
      const serialized = serializeError(error);
      pageErrors.push(serialized);
      console.error(`[pageerror] ${serialized.stack || serialized.message}`);
    });
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        const text = message.text();
        consoleErrors.push({
          location: message.location(),
          text,
          type: message.type(),
        });
        console.warn(`[browser:${message.type()}] ${text}`);
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      const entry = {
        errorText: failure?.errorText,
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      };
      failedRequests.push(entry);
      console.warn(`[requestfailed] ${entry.method} ${entry.url} ${entry.errorText || ''}`.trim());
    });
    page.on('response', (response) => {
      if (['font', 'stylesheet'].includes(response.request().resourceType())) {
        const entry = {
          requestMethod: response.request().method(),
          resourceType: response.request().resourceType(),
          status: response.status(),
          statusText: response.statusText(),
          url: response.url(),
        };
        fontResources.push(entry);
        console.log(`[resource:${entry.resourceType}:${entry.status}] ${entry.url}`);
      }
      if (response.status() < 400) return;
      const entry = {
        requestMethod: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
        url: response.url(),
      };
      failedResponses.push(entry);
      console.warn(`[response:${entry.status}] ${entry.requestMethod} ${entry.url}`);
    });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log(`[walkthrough] Opening ${config.url}`);
    console.log(`[walkthrough] Language ${language}`);
    console.log(`[walkthrough] Viewport ${config.viewport.width}x${config.viewport.height}, zoom ${config.zoom}, DPR ${config.deviceScaleFactor}, capture ${rawVideoSize.width}x${rawVideoSize.height}, final video ${outputVideoSize.width}x${outputVideoSize.height}@${config.outputFps}fps, quality ${config.exportQuality}, headless ${config.headless}`);

    markTiming('navigation-start');
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    markTiming('domcontentloaded');
    await setPageLocalStorage(page, [
      ...(config.planPath ? [[PREVIEW_PLAN_STORAGE_KEY, rawExportPlan]] : []),
      [APP_LANGUAGE_STORAGE_KEY, language],
    ]);
    await forcePageLanguage(page, language);
    await page.addStyleTag({
      content: `html { zoom: ${config.zoom} !important; }`,
    });
    await page.waitForSelector('body', { timeout: 60000 });
    markTiming('first-target-ready');
    await waitForWalkthroughTarget(page, startupTarget, 60000);
    markTiming('startup-target-ready', { target: startupTarget || null });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      markTiming('networkidle-timeout');
    });
    markTiming('network-settled');
    await ensureWalkthroughReady(page, config.url);
    markTiming('walkthrough-ready');
    await forcePageLanguage(page, language);
    fontReadyResult = await waitForFontsReady(page, config.fontTimeoutMs);
    fontDiagnostics = await getFontDiagnostics(page);
    markTiming('fonts-ready', {
      fontStatus: fontReadyResult.status,
    });
    console.log(`[walkthrough] Fonts ${fontReadyResult.status}; body ${fontDiagnostics.body || 'unknown'}; sample ${fontDiagnostics.sample || fontDiagnostics.pageTitle || 'unknown'}`);

    if (config.recordVideo && captureTimeScale > 1) {
      await installPageTemporalSupersampling(page, captureTimeScale);
      markTiming('temporal-supersampling-ready', {
        timeScale: captureTimeScale,
      });
    }

    if (config.recordVideo) {
      frameCapture = await startFrameCapture({
        captureMethod: config.captureMethod,
        outputDir,
        page,
        qualityPreset: config.qualityPreset,
        videoSize: rawVideoSize,
      });
      rawVideoPath = frameCapture.framesDir;
      captureMethod = frameCapture.method;
      markTiming('frame-capture-start', {
        captureMethod,
        frameFormat: config.qualityPreset.frameFormat,
        fps: FRAME_CAPTURE_FPS,
        height: rawVideoSize.height,
        outputFps: config.outputFps,
        quality: config.exportQuality,
        timeScale: captureTimeScale,
        width: rawVideoSize.width,
      });
      console.log(`[walkthrough] Capturing ${config.qualityPreset.frameFormat.toUpperCase()} frames at ${rawVideoSize.width}x${rawVideoSize.height}, ${FRAME_CAPTURE_FPS} fps target via ${captureMethod}; ${captureTimeScale}x temporal supersampling; output ${config.outputFps}fps ${config.exportQuality}`);
    }

    playbackStartedAt = Date.now();
    trimStartMs = Math.max(0, playbackStartedAt - videoStartedAt);
    markTiming('playback-start', {
      setupMs: trimStartMs,
    });
    console.log(`[walkthrough] Playback start after ${trimStartMs}ms setup`);
    await armWalkthroughResult(page, playbackTimeoutMs);
    await page.evaluate(({ detail, startEvent }) => {
      window.dispatchEvent(new CustomEvent(startEvent, { detail }));
    }, {
      detail: {
        plan: exportPlan,
        showCaptions: config.showCaptions,
        speed: playbackSpeed,
        strict: config.strict,
      },
      startEvent: WALKTHROUGH_START_EVENT,
    });

    result = await page.evaluate(() => window.__moonshotWalkthroughResult);
    markTiming('playback-complete', {
      result: result.status,
    });
    console.log(`[walkthrough] Result: ${result.status}`);
    const finalLanguage = await page.evaluate((languageStorageKey) => {
      let storedLanguage;
      try {
        storedLanguage = window.localStorage.getItem(languageStorageKey);
      } catch {
        storedLanguage = undefined;
      }
      return {
        htmlLang: document.documentElement.lang,
        storedLanguage,
      };
    }, APP_LANGUAGE_STORAGE_KEY);
    console.log(`[walkthrough] Final language ${finalLanguage.htmlLang || 'unknown'}; stored ${finalLanguage.storedLanguage || 'unknown'}`);

    if (frameCapture) {
      markTiming('frame-capture-stop-start');
      const frames = await frameCapture.stop();
      capturedFrameCount = frames.length;
      captureStats = getFrameCaptureStats(frames);
      markTiming('frame-capture-stop-complete', {
        averageIntervalMs: Number(captureStats.averageIntervalMs.toFixed(1)),
        captureMethod,
        effectiveFps: Number(captureStats.effectiveFps.toFixed(1)),
        finalSampleFps: Number((captureStats.effectiveFps * captureTimeScale).toFixed(1)),
        frames: capturedFrameCount,
        maxIntervalMs: captureStats.maxIntervalMs,
        timeScale: captureTimeScale,
      });
      console.log(`[walkthrough] Captured frames: ${capturedFrameCount}; effective ${captureStats.effectiveFps.toFixed(1)} fps capture, ${(captureStats.effectiveFps * captureTimeScale).toFixed(1)} fps final sampling; avg interval ${captureStats.averageIntervalMs.toFixed(1)}ms; max gap ${captureStats.maxIntervalMs}ms`);
      markTiming('encode-start', {
        captureMethod,
        colorRange: 'tv',
        colorTransfer: 'iec61966-2-1',
        outputFps: config.outputFps,
        outputPixelFormat: config.qualityPreset.pixelFormat,
        quality: config.exportQuality,
        frames: capturedFrameCount,
        inputFrameFormat: config.qualityPreset.frameFormat,
        timeScale: captureTimeScale,
      });
      finalVideoPath = await writeFrameVideo({
        frames,
        outputDir,
        outputFps: config.outputFps,
        outputVideoSize,
        qualityPreset: config.qualityPreset,
        timeScale: captureTimeScale,
        quality: config.exportQuality,
        onProgress: detail => markTiming('encode-progress', detail),
      });
      markTiming('encode-complete', {
        video: finalVideoPath,
      });
      markTiming('frame-cleanup-start');
      await frameCapture.cleanup();
      markTiming('frame-cleanup-complete');
      frameCapture = undefined;
      if (!finalVideoPath) {
        throw new Error('Could not write final walkthrough video from captured frames.');
      }
      console.log(`[walkthrough] Video: ${finalVideoPath}`);
    }

    if (config.recordScreenshot) {
      await page.screenshot({ fullPage: false, path: screenshotPath });
      console.log(`[walkthrough] Screenshot: ${screenshotPath}`);
    }

    if (config.recordTrace) {
      const tracePath = path.join(outputDir, 'walkthrough-trace.zip');
      await context.tracing.stop({ path: tracePath });
      console.log(`[walkthrough] Trace: ${tracePath}`);
    }

    if (!config.keepOpen || config.headless) {
      markTiming('page-close-start');
      if (page && !page.isClosed()) {
        await page.close({ runBeforeUnload: false }).catch(() => undefined);
      }
      page = undefined;
      markTiming('page-close-complete');
      markTiming('context-close-start');
      await context.close();
      context = undefined;
      markTiming('context-close-complete');
      markTiming('browser-close-start');
      await browser.close();
      browser = undefined;
      markTiming('browser-close-complete');
    } else {
      console.log('[walkthrough] Browser left open because keep-open is enabled.');
    }
    if (result.status === 'complete') {
      markTiming('language-complete');
      console.log(`[walkthrough] Language complete ${language}`);
    }
  } catch (error) {
    if (frameCapture) {
      await frameCapture.stop().catch(() => undefined);
      await frameCapture.cleanup();
      frameCapture = undefined;
    }
    fatalError = serializeError(error);
    result = {
      detail: fatalError,
      status: 'error',
    };
    console.error(`[walkthrough:error] ${fatalError.stack || fatalError.message}`);
    if (page) {
      const failureScreenshotPath = path.join(outputDir, 'walkthrough-error.png');
      await page.screenshot({ fullPage: true, path: failureScreenshotPath }).then(() => {
        console.error(`[walkthrough] Error screenshot: ${failureScreenshotPath}`);
      }).catch((screenshotError) => {
        console.error(`[walkthrough] Could not capture error screenshot: ${screenshotError.message}`);
      });
    }
    throw error;
  } finally {
    if (frameCapture) {
      await frameCapture.stop().catch(() => undefined);
      await frameCapture.cleanup();
      frameCapture = undefined;
    }
    if (page && (!config.keepOpen || config.headless) && !page.isClosed()) await page.close({ runBeforeUnload: false }).catch(() => undefined);
    if (context && (!config.keepOpen || config.headless)) await context.close().catch(() => undefined);
    if (browser && (!config.keepOpen || config.headless)) await browser.close().catch(() => undefined);
    if (existsSync(config.outputDir)) {
      const manifest = {
        config,
        consoleErrors,
        failedRequests,
        failedResponses,
        fatalError,
        fontDiagnostics,
        fontReadyResult,
        fontResources,
        finishedAt: new Date().toISOString(),
        language,
        pageErrors,
        plan: {
          path: loadedPlan.path,
          scenes: loadedPlan.plan.scenes.length,
          totalActions: loadedPlan.plan.scenes.reduce((sum, scene) => sum + scene.actions.length, 0),
        },
        result,
        startedAt,
        timings,
        trimStartMs,
        video: {
          captureMethod,
          captureStats,
          captureTimeScale,
          capturedFrameCount,
          finalPath: finalVideoPath,
          finalSampleFps: captureStats.effectiveFps * captureTimeScale,
          rawPath: rawVideoPath,
          trimLoading: config.trimLoading,
        },
      };
      if (config.recordManifest || fatalError || result.status !== 'complete') {
        const manifestPath = await writeManifest(outputDir, manifest);
        console.log(`[walkthrough] Manifest: ${manifestPath}`);
      }
      if (fatalError || result.status !== 'complete') {
        const debugPath = path.join(outputDir, 'walkthrough-debug.json');
        await writeFile(debugPath, JSON.stringify(manifest, null, 2));
        console.log(`[walkthrough] Debug: ${debugPath}`);
      }
    }
  }

  if (result.status !== 'complete') {
    throw new Error(`Walkthrough did not complete successfully: ${JSON.stringify(result)}`);
  }
};

const main = async () => {
  if (cliArgs.help) {
    console.log(HELP.trim());
    return;
  }

  let config = getConfig();
  const loadedPlan = await loadPlan(config.planPath);
  config = applyPlanExportFrame(config, loadedPlan.plan);
  config.deviceScaleFactor = getExportDimensions(config.viewport, config.resolution).scale;
  const planErrors = validatePlan(loadedPlan.plan);
  if (planErrors.length) {
    throw new Error(`Invalid walkthrough plan:\n- ${planErrors.join('\n- ')}`);
  }

  if (config.dryRun) {
    console.log('[walkthrough] Dry run passed.');
    console.log(JSON.stringify({
      plan: loadedPlan.path,
      scenes: loadedPlan.plan.scenes.length,
      totalActions: loadedPlan.plan.scenes.reduce((sum, scene) => sum + scene.actions.length, 0),
      ...config,
    }, null, 2));
    return;
  }

  const { chromium } = await importPlaywright();
  await mkdir(config.outputDir, { recursive: true });
  config.url = await resolveRunnableUrl(config);
  for (const language of config.languages) {
    await runCapture({
      chromium,
      config,
      language,
      loadedPlan,
    });
  }
};

main().catch((error) => {
  console.error(`[walkthrough] ${error.stack || error.message}`);
  process.exit(1);
});
