import { POINTER_ARTWORK } from './cursorGeometry';
import nativePointingHand from './nativePointingHand.json';
import type { WalkthroughCursorSettings } from './types';

type CursorGraphicProps = Pick<
  WalkthroughCursorSettings,
  'borderColor' | 'fillColor' | 'outlineWidth'
> & {
  shape: WalkthroughCursorSettings['shape'] | 'pointer';
};

export const CursorGraphic = ({
  borderColor,
  fillColor,
  outlineWidth,
  shape,
}: CursorGraphicProps) => {
  const strokeProps = {
    stroke: borderColor,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: outlineWidth,
  };

  if (shape === 'dot') {
    return (
      <svg aria-hidden='true' viewBox='0 0 100 100'>
        <circle cx='50' cy='50' fill={fillColor} r='30' {...strokeProps} />
      </svg>
    );
  }

  if (shape === 'ring') {
    return (
      <svg aria-hidden='true' viewBox='0 0 100 100'>
        <circle cx='50' cy='50' fill='none' r='32' {...strokeProps} />
      </svg>
    );
  }

  if (shape === 'crosshair') {
    return (
      <svg aria-hidden='true' viewBox='0 0 100 100'>
        <circle cx='50' cy='50' fill='none' r='30' {...strokeProps} />
        <path d='M50 12V34 M50 66V88 M12 50H34 M66 50H88' fill='none' {...strokeProps} />
        <circle cx='50' cy='50' fill={fillColor} r='5' />
      </svg>
    );
  }

  if (shape === 'pointer') {
    // Scale the native artwork, including its hotspot, to match the visible arrow.
    return (
      <svg aria-hidden='true' viewBox='0 0 100 100'>
        <g transform={`translate(${POINTER_ARTWORK.x} ${POINTER_ARTWORK.y}) scale(${POINTER_ARTWORK.scale})`}>
          <image href={nativePointingHand.image} width='100' height='100' />
        </g>
      </svg>
    );
  }

  return (
    <svg aria-hidden='true' viewBox='0 0 100 100'>
      <path
        d='M10 6 L10 82 L32 62 L45 96 L61 90 L48 56 L78 56 Z'
        fill={fillColor}
        {...strokeProps}
      />
    </svg>
  );
};
