export interface Point {
  x: number;
  y: number;
}

export const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
);

export const round = (value: number) => Math.round(value);

export const easeInOutCubic = (value: number) => (
  value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2
);

export const interpolateCubicBezier = (
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  value: number,
) => {
  const inverse = 1 - value;
  return {
    x: (inverse ** 3 * start.x)
      + (3 * inverse ** 2 * value * controlA.x)
      + (3 * inverse * value ** 2 * controlB.x)
      + (value ** 3 * end.x),
    y: (inverse ** 3 * start.y)
      + (3 * inverse ** 2 * value * controlA.y)
      + (3 * inverse * value ** 2 * controlB.y)
      + (value ** 3 * end.y),
  };
};

export const getArcControls = (start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 64) {
    return {
      controlA: start,
      controlB: end,
    };
  }

  const normalX = -dy / distance;
  const normalY = dx / distance;
  const direction = end.x >= start.x ? 1 : -1;
  const arcHeight = Math.min(64, (distance - 64) * 0.075);
  const driftX = dx * 0.28;
  const driftY = dy * 0.28;

  return {
    controlA: {
      x: start.x + driftX + normalX * arcHeight * direction,
      y: start.y + driftY + normalY * arcHeight * direction,
    },
    controlB: {
      x: end.x - driftX + normalX * arcHeight * 0.35 * direction,
      y: end.y - driftY + normalY * arcHeight * 0.35 * direction,
    },
  };
};

export const getCircleSeed = (point: Point, radius: number) => (
  Math.abs(Math.sin(point.x * 12.9898 + point.y * 78.233 + radius * 37.719))
);

export const getIrregularOvalPoint = (
  center: Point,
  radius: number,
  angle: number,
  seed: number,
) => {
  const wobble = Math.sin(angle * 2 + seed * 4.1) * 0.08
    + Math.sin(angle * 3 + seed * 7.2) * 0.045;
  const horizontalRadius = radius * (1.22 + Math.sin(seed * 5.3) * 0.12);
  const verticalRadius = radius * (0.76 + Math.cos(seed * 4.7) * 0.1);
  const rotation = (seed - 0.5) * 0.7;
  const rawX = Math.cos(angle) * horizontalRadius * (1 + wobble);
  const rawY = Math.sin(angle) * verticalRadius * (1 - wobble * 0.45);

  return {
    x: center.x + rawX * Math.cos(rotation) - rawY * Math.sin(rotation),
    y: center.y + rawX * Math.sin(rotation) + rawY * Math.cos(rotation),
  };
};

export const getCircleRadiusForLevel = (level: number) => (
  Math.round(10 + clamp(level, 1, 9) * 10)
);

export { wait } from './playbackClock';

// A slightly front-loaded velocity profile: smooth departure, longer final approach.
export const easePointer = (progress: number) => {
  const t = clamp(progress, 0, 1);
  return 10 * t ** 2 - 20 * t ** 3 + 15 * t ** 4 - 4 * t ** 5;
};

export const getMoveDuration = (distance: number, defaultMs: number, explicitMs?: number) => (
  explicitMs !== undefined ? Math.max(0, explicitMs)
    : Math.round(defaultMs * clamp(Math.sqrt(Math.max(0, distance) / 400), 0.22, 1.7))
);

// Sample once per action, not every frame. Arc-length lookup keeps ovals and
// Bezier paths from speeding up merely because their curvature changes.
export const createDistancePath = (points: Point[]) => {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const length = lengths[lengths.length - 1] || 0;
  return {
    length,
    at(progress: number): Point {
      if (!points.length) return { x: 0, y: 0 };
      if (!length) return points[points.length - 1];
      const target = clamp(progress, 0, 1) * length;
      let low = 1;
      let high = points.length - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (lengths[middle] < target) low = middle + 1;
        else high = middle;
      }
      const before = points[low - 1];
      const after = points[low];
      const fraction = (target - lengths[low - 1]) / (lengths[low] - lengths[low - 1] || 1);
      return { x: before.x + (after.x - before.x) * fraction, y: before.y + (after.y - before.y) * fraction };
    },
  };
};

export const getTypingDelays = (text: string, durationMs: number) => {
  const characters = Array.from(text);
  const weights = characters.map((character, index) => {
    const variation = 0.88 + ((character.codePointAt(0)! * 17 + index * 31) % 25) / 100;
    return variation * (/[.,;:!?\n]/.test(character) ? 2.2 : /\s/.test(character) ? 1.3 : 1);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => Math.max(0, durationMs) * weight / total);
};
