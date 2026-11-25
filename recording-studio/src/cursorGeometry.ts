import nativePointingHand from './nativePointingHand.json';
import type { WalkthroughCursorSettings } from './types';

export type CursorShape = WalkthroughCursorSettings['shape'] | 'pointer';

// Native hand alpha bounds are (64, 56)-(182, 207) in its 256px image.
// Match the arrow's 90-unit visible height, rather than its padded canvas.
export const POINTER_ARTWORK = {
  scale: 90 / (151 / 256 * 100),
  x: 8 - (64 / 256 * 100) * (90 / (151 / 256 * 100)),
  y: 6 - (56 / 256 * 100) * (90 / (151 / 256 * 100)),
};

// Coordinates are fractions of the SVG viewBox. Click scaling pivots at the tip.
export const getCursorHotspot = (shape: CursorShape) => {
  if (shape === 'arrow') return { x: 0.1, y: 0.06 };
  if (shape === 'pointer') return {
    x: nativePointingHand.hotspot.x * POINTER_ARTWORK.scale + POINTER_ARTWORK.x / 100,
    y: nativePointingHand.hotspot.y * POINTER_ARTWORK.scale + POINTER_ARTWORK.y / 100,
  };
  return { x: 0.5, y: 0.5 };
};

export const getPlaybackCursorShape = (shape: WalkthroughCursorSettings['shape'], _clickable: boolean): CursorShape => (
  shape
);
