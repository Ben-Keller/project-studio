import type { WalkthroughCursorSettings } from './types';
import { WALKTHROUGH_STORAGE_KEYS } from './config';

export const DEFAULT_CURSOR_SETTINGS: WalkthroughCursorSettings = {
  borderColor: '#111111',
  clickColor: '#ffd166',
  fillColor: '#ffffff',
  opacity: 1,
  outlineWidth: 4,
  shadow: 'none',
  shape: 'arrow',
  size: 24,
};

export const CURSOR_SHAPE_OPTIONS: Array<{ label: string; value: WalkthroughCursorSettings['shape'] }> = [
  { label: 'Arrow', value: 'arrow' },
  { label: 'Dot', value: 'dot' },
  { label: 'Ring', value: 'ring' },
  { label: 'Crosshair', value: 'crosshair' },
];

export const CURSOR_SHADOW_OPTIONS: Array<{ label: string; value: WalkthroughCursorSettings['shadow'] }> = [
  { label: 'None', value: 'none' },
  { label: 'Soft', value: 'soft' },
  { label: 'Strong', value: 'strong' },
];

export const getCursorShadow = (shadow: WalkthroughCursorSettings['shadow']) => {
  if (shadow === 'none') return 'none';
  if (shadow === 'soft') return 'drop-shadow(0 0.45rem 0.7rem rgba(0, 0, 0, 0.24))';
  return 'drop-shadow(0 0.8rem 1.2rem rgba(0, 0, 0, 0.35))';
};

const clamp = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, value))
);

const normalizeColor = (value: unknown, fallback: string) => (
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
);

export const normalizeCursorSettings = (settings: Partial<WalkthroughCursorSettings>) => ({
  ...DEFAULT_CURSOR_SETTINGS,
  ...settings,
  borderColor: normalizeColor(settings.borderColor, DEFAULT_CURSOR_SETTINGS.borderColor),
  clickColor: normalizeColor(settings.clickColor, DEFAULT_CURSOR_SETTINGS.clickColor),
  fillColor: normalizeColor(settings.fillColor, DEFAULT_CURSOR_SETTINGS.fillColor),
  opacity: Number.isFinite(settings.opacity)
    ? clamp(Number(settings.opacity), 0.2, 1)
    : DEFAULT_CURSOR_SETTINGS.opacity,
  outlineWidth: Number.isFinite(settings.outlineWidth)
    ? clamp(Number(settings.outlineWidth), 0, 12)
    : DEFAULT_CURSOR_SETTINGS.outlineWidth,
  shadow: (settings.shape === 'arrow' && settings.size === 58 && settings.shadow === 'strong')
    ? 'none'
    : settings.shadow && CURSOR_SHADOW_OPTIONS.some((option) => option.value === settings.shadow)
    ? settings.shadow
    : DEFAULT_CURSOR_SETTINGS.shadow,
  shape: settings.shape && CURSOR_SHAPE_OPTIONS.some((option) => option.value === settings.shape)
    ? settings.shape
    : DEFAULT_CURSOR_SETTINGS.shape,
  size: Number.isFinite(settings.size) ? clamp(settings.shape === 'arrow' && settings.size === 58 ? 24 : Number(settings.size), 24, 128) : DEFAULT_CURSOR_SETTINGS.size,
});

export const loadCursorSettings = () => {
  if (typeof window === 'undefined') return DEFAULT_CURSOR_SETTINGS;
  let stored: string | null | undefined;
  try {
    stored = window.localStorage.getItem(WALKTHROUGH_STORAGE_KEYS.cursorSettings);
  } catch {
    stored = undefined;
  }
  if (!stored) return DEFAULT_CURSOR_SETTINGS;
  try {
    return normalizeCursorSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_CURSOR_SETTINGS;
  }
};

export const saveCursorSettings = (settings: WalkthroughCursorSettings) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WALKTHROUGH_STORAGE_KEYS.cursorSettings, JSON.stringify(normalizeCursorSettings(settings)));
  } catch {
    // Storage can be unavailable in restricted documents; cursor changes still apply in memory.
  }
};

export const resolveCursorSettings = (settings?: Partial<WalkthroughCursorSettings>) => (
  settings ? normalizeCursorSettings(settings) : loadCursorSettings()
);
