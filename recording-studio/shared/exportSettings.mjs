// Shared by the panel, HTTP service, and CLI. Keep export behavior identical.
export const DEFAULT_EXPORT_FPS = 30;
export const DEFAULT_EXPORT_QUALITY = 'standard';
export const EXPORT_FPS_OPTIONS = [30, 60, 120];
export const EXPORT_QUALITY_OPTIONS = [
  { label: 'Standard', value: 'standard' },
  { label: 'High', value: 'high' },
  { label: 'Maximum', value: 'maximum' },
];
export const DEFAULT_EXPORT_RESOLUTION = '1080p';
export const EXPORT_RESOLUTION_OPTIONS = ['1080p', '1440p', '4k'];
export const getFrameCaptureTimeScale = (fps, quality = DEFAULT_EXPORT_QUALITY) => (
  quality === 'maximum' ? (fps >= 120 ? 8 : fps >= 60 ? 6 : 4) : (fps >= 120 ? 5 : fps >= 60 ? 3 : 2)
);

// Fit inside the selected resolution, preserving the recorded viewport's aspect ratio.
export const getExportDimensions = (viewport, resolution = DEFAULT_EXPORT_RESOLUTION) => {
  const width = Number(viewport?.width) || 1470;
  const height = Number(viewport?.height) || 956;
  const longEdge = resolution === '4k' ? 3840 : resolution === '1440p' ? 2560 : 1920;
  const shortEdge = longEdge * 9 / 16;
  const scale = Math.min((width >= height ? longEdge : shortEdge) / width, (width >= height ? shortEdge : longEdge) / height);
  const even = value => Math.max(2, Math.floor(value / 2) * 2);
  return { width: even(width * scale), height: even(height * scale), scale };
};
