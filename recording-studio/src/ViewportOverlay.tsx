import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { overlayRoot } from './runtime';

export const getDocumentZoom = () =>
  [document.documentElement, document.body].reduce((zoom, element) => {
    const value = window.getComputedStyle(element).getPropertyValue('zoom');
    const scale = Number.parseFloat(value);
    return (
      zoom *
      (Number.isFinite(scale) && scale > 0
        ? scale / (value.endsWith('%') ? 100 : 1)
        : 1)
    );
  }, 1);

// Recorded points and DOMRects use viewport pixels. An inverse zoom prevents the
// overlay from scaling those coordinates a second time during CSS-zoom exports.
export const ViewportOverlay = ({ children }: { children: ReactNode }) => {
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const update = () => setZoom(getDocumentZoom());
    update();
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return createPortal(
    <div
      data-walkthrough-viewport-overlay
      style={
        {
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 999999,
          zoom: 1 / zoom,
        } as CSSProperties
      }
    >
      {children}
    </div>,
    overlayRoot || document.body
  );
};
