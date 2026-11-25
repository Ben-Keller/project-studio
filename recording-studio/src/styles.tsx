import type { CSSProperties } from 'react';
import styled, { createGlobalStyle, css, keyframes } from 'styled-components';
import { getCursorShadow } from './cursorSettings';
import { getCursorHotspot } from './cursorGeometry';

const pulse = keyframes`
  0% {
    opacity: 0.22;
    transform: translate(-50%, -50%) scale(0.72);
  }
  55% {
    opacity: 0.55;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.35);
  }
`;

const dropRipple = keyframes`
  0% {
    opacity: 0.9;
    transform: translate(-50%, -50%) scale(0.55);
  }
  70% {
    opacity: 0.42;
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.75);
  }
`;

const subtleSweep = keyframes`
  0% {
    left: -125%;
  }
  100% {
    left: 150%;
  }
`;

const radialRevealHalo = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.42) rotate(-18deg);
  }
  42% {
    opacity: 0.7;
  }
  100% {
    opacity: 0;
    transform: scale(1.18) rotate(0deg);
  }
`;

const radialSizeButtonReveal = keyframes`
  0% {
    filter: blur(0.4px);
    opacity: 0;
    transform:
      translate(-50%, -50%)
      translate(var(--walkthrough-circle-size-start-x), var(--walkthrough-circle-size-start-y))
      scale(0.68);
  }
  68% {
    opacity: 1;
    transform:
      translate(-50%, -50%)
      translate(var(--walkthrough-circle-size-x), var(--walkthrough-circle-size-y))
      scale(1.08);
  }
  100% {
    filter: blur(0);
    opacity: 1;
    transform:
      translate(-50%, -50%)
      translate(var(--walkthrough-circle-size-x), var(--walkthrough-circle-size-y))
      scale(1);
  }
`;

export const GlobalHoverEffectStyle = createGlobalStyle`
  html,
  body,
  #root {
    overscroll-behavior: none !important;
    scroll-behavior: auto !important;
  }
  html,
  body,
  #root,
  #root > * {
    overflow-anchor: none !important;
  }
  html[data-walkthrough-hover-effects='disabled'] .select-tooltip,
  html[data-walkthrough-hover-effects='disabled'] .undp-stacked-chart-tooltip,
  html[data-walkthrough-hover-effects='disabled'] .undp-map-tooltip,
  html[data-walkthrough-hover-effects='disabled'] .ant-tooltip {
    display: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }
`;

export const PlayerOverlay = styled.div`
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 999999;
`;

type PlayerCursorProps = {
  $clicking: boolean;
  $opacity: number;
  $shadow: 'none' | 'soft' | 'strong';
  $shape: 'arrow' | 'dot' | 'ring' | 'crosshair' | 'pointer';
  $size: number;
  $visible: boolean;
  $x: number;
  $y: number;
};

export const PlayerCursor = styled.div.attrs<PlayerCursorProps>((props) => ({
  style: {
    '--walkthrough-cursor-x': `${props.$x}px`,
    '--walkthrough-cursor-y': `${props.$y}px`,
    opacity: props.$visible ? props.$opacity : 0,
  } as CSSProperties,
}))<PlayerCursorProps>`
  filter: ${(props) => getCursorShadow(props.$shadow)};
  height: ${(props) => props.$size}px;
  left: 0;
  position: absolute;
  top: 0;
  transform: ${(props) => {
    const hotspot = getCursorHotspot(props.$shape);
    return `translate3d(var(--walkthrough-cursor-x), var(--walkthrough-cursor-y), 0) translate(${-props.$size * hotspot.x}px, ${-props.$size * hotspot.y}px)`;
  }};
  transform-origin: ${(props) => {
    const hotspot = getCursorHotspot(props.$shape);
    return `${props.$size * hotspot.x}px ${props.$size * hotspot.y}px`;
  }};
  transition: opacity 220ms ease;
  will-change: opacity, transform;
  width: ${(props) => props.$size}px;
  z-index: 2;
  svg {
    display: block;
    height: 100%;
    width: 100%;
  }
`;

export const RecorderCursorPreviewOverlay = styled.div`
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 999998;
`;

export const RecorderCursorPreview = styled.div<{
  $opacity: number;
  $shadow: 'none' | 'soft' | 'strong';
  $shape: 'arrow' | 'dot' | 'ring' | 'crosshair';
  $size: number;
}>`
  filter: ${(props) => getCursorShadow(props.$shadow)};
  height: ${(props) => props.$size}px;
  left: 50%;
  opacity: ${(props) => props.$opacity};
  position: absolute;
  top: 50%;
  transform: ${(props) => (
    props.$shape === 'arrow'
      ? `translate(${-props.$size * 0.1}px, ${-props.$size * 0.06}px)`
      : `translate(${-props.$size / 2}px, ${-props.$size / 2}px)`
  )};
  width: ${(props) => props.$size}px;
  svg {
    display: block;
    height: 100%;
    width: 100%;
  }
`;

export const ClickPulse = styled.div<{ $active: boolean; $color: string; $x: number; $y: number }>`
  animation: ${(props) => (props.$active ? pulse : 'none')} 520ms ease-out;
  border: 0.28rem solid ${(props) => props.$color};
  border-radius: 999px;
  height: 4.2rem;
  left: ${(props) => props.$x}px;
  opacity: 0;
  position: absolute;
  top: ${(props) => props.$y}px;
  transform: translate(-50%, -50%);
  width: 4.2rem;
  z-index: 1;
`;

export const Caption = styled.div`
  background: rgba(0, 0, 0, 0.78);
  border-left: 0.35rem solid var(--dark-yellow, #D4A418);
  bottom: 2rem;
  color: #fff;
  font-size: clamp(1rem, 1.8vw, 1.35rem);
  font-weight: 700;
  left: 50%;
  line-height: 1.35;
  max-width: min(58rem, calc(100vw - 3rem));
  padding: 1rem 1.15rem;
  position: fixed;
  transform: translateX(-50%);
  width: max-content;
  z-index: 3;
  @media (max-width: 640px) {
    bottom: 1rem;
    max-width: calc(100vw - 1.5rem);
  }
`;

export const StatusPill = styled.div`
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 999px;
  color: #111;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.35rem 0.7rem;
  position: fixed;
  right: 1rem;
  text-transform: uppercase;
  top: 1rem;
  z-index: 3;
`;

export const RecorderPanel = styled.div<{ $x: number; $y: number }>`
  pointer-events: auto;
  backdrop-filter: blur(18px) saturate(1.08);
  background:
    radial-gradient(circle at 12% -8%, rgba(255, 209, 102, 0.18), rgba(255, 209, 102, 0) 32%),
    linear-gradient(145deg, rgba(21, 25, 34, 0.97), rgba(8, 10, 15, 0.96));
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 1.15rem;
  box-sizing: border-box;
  box-shadow: 0 1.4rem 3.4rem rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  color: #fff;
  font-family: 'Space Grotesk', 'Aptos Display', sans-serif;
  left: ${(props) => props.$x}px;
  max-height: calc(100vh - 2rem);
  min-height: 11rem;
  overscroll-behavior: contain;
  overflow: auto;
  padding: 0.82rem;
  position: fixed;
  scrollbar-gutter: stable;
  top: ${(props) => props.$y}px;
  width: min(26.75rem, calc(100vw - 1.25rem));
  z-index: 1000000;
`;

export const RecorderHeader = styled.div`
  align-items: center;
  cursor: grab;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin: -0.08rem -0.05rem 0;
  padding: 0.05rem 0.05rem 0.72rem;
  position: relative;
  user-select: none;
  &::after {
    background: linear-gradient(90deg, rgba(255, 209, 102, 0.28), rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0));
    bottom: 0;
    content: '';
    height: 1px;
    left: 0;
    position: absolute;
    right: 0;
  }
  &:active {
    cursor: grabbing;
  }
`;

export const RecorderHeaderLeft = styled.div`
  align-items: center;
  display: inline-flex;
  gap: 0.54rem;
  min-width: 0;
`;

export const RecorderHeaderActions = styled.div`
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.38rem;
  position: relative;
`;

export const RecorderHeaderMenuWrap = styled.div`
  display: inline-flex;
  position: relative;
`;

export const RecorderHeaderMenuButton = styled.button<{ $active?: boolean }>`
  align-items: center;
  background: ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.18)' : 'rgba(255, 255, 255, 0.1)')};
  border: 1px solid ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.48)' : 'rgba(255, 255, 255, 0.18)')};
  border-radius: 999px;
  color: ${(props) => (props.$active ? '#ffd166' : '#fff')};
  cursor: pointer;
  display: inline-flex;
  height: 2rem;
  justify-content: center;
  padding: 0;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
  width: 2rem;
  &:hover {
    background: rgba(255, 209, 102, 0.16);
    border-color: rgba(255, 209, 102, 0.38);
    color: #ffd166;
  }
  &:focus-visible {
    outline: 2px solid rgba(255, 209, 102, 0.72);
    outline-offset: 2px;
  }
  svg {
    height: 1rem;
    width: 1rem;
  }
`;

export const RecorderHeaderMenuPopover = styled.div`
  backdrop-filter: blur(16px) saturate(1.08);
  background:
    radial-gradient(circle at 12% 0%, rgba(255, 209, 102, 0.12), rgba(255, 209, 102, 0) 42%),
    linear-gradient(145deg, rgba(22, 26, 35, 0.99), rgba(8, 10, 15, 0.99));
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 0.95rem;
  box-shadow: 0 1.1rem 2.8rem rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  cursor: default;
  min-width: min(23.25rem, calc(100vw - 2.25rem));
  padding: 0.78rem;
  position: absolute;
  right: 0;
  top: calc(100% + 0.55rem);
  user-select: auto;
  z-index: 6;
`;

export const RecorderExportBackdrop = styled.div`
  align-items: center;
  backdrop-filter: blur(9px) saturate(0.86);
  background: rgba(3, 6, 11, 0.46);
  cursor: default;
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1.25rem;
  pointer-events: auto;
  position: fixed;
  user-select: auto;
  z-index: 1000001;
`;

export const RecorderExportModal = styled.div`
  backdrop-filter: blur(18px) saturate(1.08);
  background:
    radial-gradient(circle at 16% 0%, rgba(255, 209, 102, 0.14), rgba(255, 209, 102, 0) 43%),
    linear-gradient(145deg, rgba(22, 26, 35, 0.98), rgba(8, 10, 15, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 1.1rem;
  box-shadow: 0 1.4rem 4.2rem rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  max-height: min(38rem, calc(100vh - 2.5rem));
  max-width: min(25rem, calc(100vw - 2.5rem));
  overflow: auto;
  padding: 0.9rem;
  width: 25rem;
`;

export const RecorderBackButton = styled.button`
  align-items: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  height: 2rem;
  justify-content: center;
  padding: 0;
  width: 2rem;
  &:hover {
    background: rgba(255, 209, 102, 0.16);
    border-color: rgba(255, 209, 102, 0.38);
  }
  svg {
    height: 1rem;
    width: 1rem;
  }
`;

export const RecorderTitle = styled.div<{ $prominent?: boolean }>`
  color: ${(props) => (props.$prominent ? '#ffd166' : '#fff')};
  font-size: ${(props) => (props.$prominent ? '1.34rem' : '0.9rem')};
  font-weight: ${(props) => (props.$prominent ? 950 : 850)};
  letter-spacing: ${(props) => (props.$prominent ? '-0.055em' : '-0.018em')};
  line-height: 1.05;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: ${(props) => (props.$prominent ? '0 0.6rem 1.2rem rgba(255, 209, 102, 0.16)' : 'none')};
  white-space: nowrap;
`;

export const RecorderCount = styled.div`
  background: #ffd166;
  border-radius: 999px;
  color: #111;
  font-size: 0.66rem;
  font-weight: 700;
  padding: 0.16rem 0.42rem;
`;

export const RecorderHeaderMeta = styled.div`
  color: rgba(255, 255, 255, 0.56);
  font-size: 0.6rem;
  line-height: 1.25;
  margin-top: 0.08rem;
`;

export const RecorderHelp = styled.div`
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 0.8rem;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.72rem;
  line-height: 1.35;
  margin-top: 0.64rem;
  padding: 0.72rem;
`;

export const RecorderToolbar = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.32rem;
  margin-top: 0.5rem;
`;

export const RecorderToolDock = styled.div`
  align-items: center;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  display: grid;
  gap: 0.16rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 0.66rem;
  padding: 0.32rem;
  position: relative;
  > * {
    justify-self: center;
  }
`;

export const RecorderToolbarGroup = styled.div`
  align-items: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  display: inline-flex;
  gap: 0.18rem;
  padding: 0.18rem;
`;

export const RecorderSectionTitle = styled.div`
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.075em;
  text-transform: uppercase;
`;

export const RecorderControlGrid = styled.div`
  display: grid;
  gap: 0.52rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
`;

export const RecorderField = styled.label`
  color: rgba(255, 255, 255, 0.72);
  display: grid;
  font-size: 0.66rem;
  font-weight: 800;
  gap: 0.32rem;
  grid-template-columns: minmax(0, 1fr) auto;
  letter-spacing: 0.02em;
  input,
  select {
    grid-column: 1 / -1;
  }
`;

export const RecorderSelect = styled.select`
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 0.58rem;
  color: #fff;
  font-size: 0.74rem;
  min-height: 2rem;
  padding: 0.36rem 0.46rem;
`;

export const RecorderTextInput = styled.input`
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 0.75rem;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 750;
  height: 2.18rem;
  min-width: 0;
  padding: 0 0.66rem;
  width: 100%;
  &::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }
  &:focus {
    border-color: rgba(255, 209, 102, 0.58);
    outline: none;
  }
`;

export const RecorderRangeInput = styled.input`
  accent-color: #ffd166;
  cursor: pointer;
  width: 100%;
`;

export const RecorderColorInput = styled.input`
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 0.58rem;
  cursor: pointer;
  height: 2rem;
  padding: 0.18rem;
  width: 100%;
`;

export const RecorderFieldValue = styled.span`
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.6rem;
  font-weight: 800;
  justify-self: end;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const RecorderInlineForm = styled.div`
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 1fr) auto auto;
  margin-top: 0.82rem;
`;

export const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.42rem;
  margin-top: 0.12rem;
`;

export const RecorderButton = styled.button`
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  color: #fff;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.38rem 0.62rem;
  text-align: center;
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }
  &:disabled:hover {
    background: rgba(255, 255, 255, 0.12);
  }
`;

export const RecorderIconButton = styled(RecorderButton)`
  align-items: center;
  display: inline-flex;
  gap: 0.22rem;
  justify-content: center;
  min-height: 1.8rem;
  min-width: 1.8rem;
  padding: 0.25rem 0.42rem;
`;

export const RecorderCircleButton = styled(RecorderButton)`
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.7rem;
  font-weight: 950;
  height: 2.05rem;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 2.05rem;
  svg {
    height: 1.04rem;
    width: 1.04rem;
  }
`;

export const RecorderPlayButton = styled(RecorderCircleButton)`
  background: #18a957;
  border-color: rgba(85, 230, 150, 0.8);
  box-shadow: 0 0.35rem 1rem rgba(24, 169, 87, 0.22);
  color: #fff;
  &:hover {
    background: #20bd66;
    border-color: rgba(111, 244, 172, 0.9);
    box-shadow: 0 0.45rem 1.1rem rgba(24, 169, 87, 0.3);
  }
  &:disabled,
  &:disabled:hover {
    background: #18a957;
    border-color: rgba(85, 230, 150, 0.8);
    box-shadow: none;
  }
`;

export const RecorderRecordButton = styled(RecorderCircleButton)`
  background: #e53935;
  border-color: rgba(255, 118, 118, 0.92);
  box-shadow: 0 0.35rem 1rem rgba(229, 57, 53, 0.28), inset 0 0 0 0.18rem rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 0;
  position: relative;
  &:hover {
    background: #f04a45;
    border-color: rgba(255, 154, 154, 0.95);
    box-shadow: 0 0.45rem 1.1rem rgba(229, 57, 53, 0.34), inset 0 0 0 0.18rem rgba(255, 255, 255, 0.14);
  }
  &:disabled,
  &:disabled:hover {
    background: #e53935;
    border-color: rgba(255, 118, 118, 0.92);
  }
  &::before {
    background: #fff;
    border-radius: 999px;
    content: '';
    height: 0.56rem;
    opacity: 0.9;
    transition: border-radius 140ms ease, height 140ms ease, width 140ms ease;
    width: 0.56rem;
  }
  &[aria-pressed='true'] {
    background: #c62828;
    box-shadow: 0 0 0 0.22rem rgba(229, 57, 53, 0.22), 0 0.45rem 1.1rem rgba(229, 57, 53, 0.32);
  }
  &[aria-pressed='true']::before {
    border-radius: 0.13rem;
    height: 0.62rem;
    width: 0.62rem;
  }
`;

export const RecorderIcon = styled.span`
  align-items: center;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.58rem;
  font-weight: 950;
  height: 1.08rem;
  justify-content: center;
  line-height: 1;
  min-width: 1.08rem;
`;

export const DragToolButton = styled(RecorderButton)`
  border-color: rgba(255, 209, 102, 0.52);
  cursor: grab;
  transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  &:hover {
    background: rgba(255, 209, 102, 0.16);
    border-color: rgba(255, 209, 102, 0.72);
    box-shadow: 0 0.4rem 1rem rgba(255, 209, 102, 0.14);
    transform: translateY(-1px);
  }
  &:active {
    cursor: grabbing;
    transform: translateY(0) scale(0.98);
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
    transform: none;
  }
  &:disabled:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 209, 102, 0.52);
    box-shadow: none;
  }
`;

export const RecorderCircleDragButton = styled(DragToolButton)`
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.7rem;
  font-weight: 950;
  height: 2.05rem;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 2.05rem;
  svg {
    height: 1.04rem;
    width: 1.04rem;
  }
`;

export const RecorderCircleSizeHandle = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  color: rgba(255, 226, 138, 0.95);
  cursor: pointer;
  display: inline-flex;
  height: 1.4rem;
  justify-content: center;
  opacity: 1;
  padding: 0;
  position: absolute;
  right: -0.78rem;
  top: 50%;
  transform: translate(0, -50%) scale(1);
  transition:
    color 150ms ease,
    filter 150ms ease,
    opacity 150ms ease,
    transform 170ms cubic-bezier(0.18, 0.88, 0.28, 1.1);
  width: 0.85rem;
  z-index: 7;
  svg {
    filter: drop-shadow(0 0.18rem 0.28rem rgba(0, 0, 0, 0.22));
    height: 0.68rem;
    stroke-width: 2.6;
    transition: filter 150ms ease, stroke-width 150ms ease, transform 150ms ease;
    width: 0.68rem;
  }
  &:hover,
  &:focus-visible,
  &[aria-expanded='true'] {
    color: #ffeaa6;
    filter: drop-shadow(0 0 0.45rem rgba(255, 209, 102, 0.34));
    opacity: 1;
    transform: translate(0.03rem, -50%) scale(1.12);
    svg {
      filter:
        drop-shadow(0 0.18rem 0.28rem rgba(0, 0, 0, 0.24))
        drop-shadow(0 0 0.34rem rgba(255, 209, 102, 0.46));
      stroke-width: 3.25;
    }
  }
  &:focus-visible {
    outline: 1px solid rgba(255, 236, 168, 0.55);
    outline-offset: 3px;
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.38;
    transform: translate(0, -50%) scale(1);
  }
`;

export const RecorderCircleSizeButton = styled(RecorderCircleDragButton).attrs<{ $x: number; $y: number }>((props) => ({
  style: {
    '--walkthrough-circle-size-x': `${props.$x}rem`,
    '--walkthrough-circle-size-y': `${props.$y}rem`,
    '--walkthrough-circle-size-start-x': `${Number((props.$x * 0.34).toFixed(2))}rem`,
    '--walkthrough-circle-size-start-y': `${Number((props.$y * 0.34).toFixed(2))}rem`,
  } as CSSProperties,
}))<{ $x: number; $y: number }>`
  left: 50%;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  top: 50%;
  filter: blur(0.3px);
  transform:
    translate(-50%, -50%)
    translate(var(--walkthrough-circle-size-start-x), var(--walkthrough-circle-size-start-y))
    scale(0.68);
  transition:
    background 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease,
    filter 220ms cubic-bezier(0.18, 0.88, 0.28, 1),
    opacity 190ms ease,
    transform 260ms cubic-bezier(0.18, 0.88, 0.28, 1.18);
  will-change: filter, opacity, transform;
  z-index: 5;
  &:hover {
    transform:
      translate(-50%, -50%)
      translate(var(--walkthrough-circle-size-x), var(--walkthrough-circle-size-y))
      translateY(-1px);
  }
  &:active {
    transform:
      translate(-50%, -50%)
      translate(var(--walkthrough-circle-size-x), var(--walkthrough-circle-size-y))
      scale(0.98);
  }
  &:disabled,
  &:disabled:hover {
    transform:
      translate(-50%, -50%)
      translate(var(--walkthrough-circle-size-x), var(--walkthrough-circle-size-y));
  }
`;

export const RecorderCircleSizeMenu = styled.div<{ $visible: boolean }>`
  height: 6.45rem;
  left: 50%;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  pointer-events: ${(props) => (props.$visible ? 'auto' : 'none')};
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%) scale(${(props) => (props.$visible ? 1 : 0.92)});
  transition: opacity 120ms ease, transform 180ms cubic-bezier(0.18, 0.88, 0.28, 1);
  width: 6.45rem;
  z-index: 4;
  &::before {
    animation: ${(props) => (props.$visible ? css`${radialRevealHalo} 420ms ease-out both` : 'none')};
    background:
      conic-gradient(
        from -90deg,
        rgba(255, 209, 102, 0),
        rgba(255, 209, 102, 0.34),
        rgba(255, 209, 102, 0),
        rgba(255, 209, 102, 0.24),
        rgba(255, 209, 102, 0)
      );
    border-radius: 999px;
    content: '';
    inset: 0.42rem;
    pointer-events: none;
    position: absolute;
  }
  ${RecorderCircleSizeButton} {
    animation: ${(props) => (props.$visible ? css`${radialSizeButtonReveal} 310ms cubic-bezier(0.18, 0.88, 0.28, 1.18) both` : 'none')};
    animation-delay: ${(props) => (props.$visible ? '28ms' : '0ms')};
    filter: ${(props) => (props.$visible ? 'blur(0)' : 'blur(0.3px)')};
    opacity: ${(props) => (props.$visible ? 1 : 0)};
    pointer-events: ${(props) => (props.$visible ? 'auto' : 'none')};
    transform:
      translate(-50%, -50%)
      ${(props) => (props.$visible
    ? 'translate(var(--walkthrough-circle-size-x), var(--walkthrough-circle-size-y)) scale(1)'
    : 'translate(var(--walkthrough-circle-size-start-x), var(--walkthrough-circle-size-start-y)) scale(0.68)')};
  }
  ${RecorderCircleSizeButton}:nth-child(2) {
    animation-delay: ${(props) => (props.$visible ? '44ms' : '0ms')};
  }
  ${RecorderCircleSizeButton}:nth-child(3) {
    animation-delay: ${(props) => (props.$visible ? '60ms' : '0ms')};
  }
  ${RecorderCircleSizeButton}:nth-child(4) {
    animation-delay: ${(props) => (props.$visible ? '76ms' : '0ms')};
  }
  ${RecorderCircleSizeButton}:nth-child(5) {
    animation-delay: ${(props) => (props.$visible ? '92ms' : '0ms')};
  }
  ${RecorderCircleSizeButton}:nth-child(6) {
    animation-delay: ${(props) => (props.$visible ? '108ms' : '0ms')};
  }
  ${RecorderCircleSizeButton}:nth-child(7) {
    animation-delay: ${(props) => (props.$visible ? '124ms' : '0ms')};
  }
  ${RecorderCircleSizeButton}:nth-child(8) {
    animation-delay: ${(props) => (props.$visible ? '140ms' : '0ms')};
  }
  @media (prefers-reduced-motion: reduce) {
    transform: translate(-50%, -50%);
    transition: opacity 80ms ease;
    &::before {
      animation: none;
    }
    ${RecorderCircleSizeButton} {
      animation: none;
      transition: opacity 80ms ease;
    }
  }
`;

export const RecorderCirclePicker = styled.div`
  align-items: center;
  display: inline-flex;
  isolation: isolate;
  justify-content: center;
  position: relative;
  z-index: 3;
  &:hover ${RecorderCircleSizeHandle},
  &:focus-within ${RecorderCircleSizeHandle} {
    color: #ffeaa6;
    filter: drop-shadow(0 0 0.45rem rgba(255, 209, 102, 0.34));
    opacity: 1;
    transform: translate(0.03rem, -50%) scale(1.12);
    svg {
      filter:
        drop-shadow(0 0.18rem 0.28rem rgba(0, 0, 0, 0.24))
        drop-shadow(0 0 0.34rem rgba(255, 209, 102, 0.46));
      stroke-width: 3.25;
    }
  }
`;

export const RecorderStatePill = styled.span<{ $warning?: boolean }>`
  background: ${(props) => (props.$warning ? 'rgba(255, 209, 102, 0.16)' : 'rgba(93, 214, 165, 0.14)')};
  border: 1px solid ${(props) => (props.$warning ? 'rgba(255, 209, 102, 0.34)' : 'rgba(93, 214, 165, 0.28)')};
  border-radius: 999px;
  color: ${(props) => (props.$warning ? '#ffd166' : '#8ff0c8')};
  display: inline-flex;
  font-size: 0.6rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  margin-left: 0.45rem;
  padding: 0.14rem 0.42rem;
  text-transform: uppercase;
  vertical-align: middle;
`;

export const RecorderActionLog = styled.div`
  display: grid;
  gap: 0.38rem;
  margin-top: 0.48rem;
  max-height: min(18rem, calc(100vh - 17rem));
  overflow: auto;
  padding-right: 0.15rem;
  scroll-behavior: smooth;
  scroll-padding-block: 0.85rem;
`;

export const RecorderActionLogItem = styled.div<{ $active?: boolean }>`
  align-items: center;
  background: ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.16)' : 'rgba(255, 255, 255, 0.075)')};
  border: 1px solid ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.46)' : 'rgba(255, 255, 255, 0.13)')};
  border-radius: 0.82rem;
  cursor: pointer;
  display: grid;
  gap: 0.48rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 0.48rem;
  scroll-margin-block: 0.85rem;
  text-align: left;
  transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  &:hover {
    background: ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.2)' : 'rgba(255, 255, 255, 0.105)')};
    border-color: ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.58)' : 'rgba(255, 255, 255, 0.2)')};
    transform: translateY(-1px);
  }
  &:focus-visible {
    outline: 2px solid rgba(255, 209, 102, 0.7);
    outline-offset: 2px;
  }
`;

export const RecorderActionIndex = styled.div`
  align-items: center;
  background: rgba(255, 209, 102, 0.92);
  border-radius: 999px;
  color: #111;
  display: inline-flex;
  font-size: 0.6rem;
  font-weight: 900;
  height: 1.35rem;
  justify-content: center;
  min-width: 1.35rem;
`;

export const RecorderActionBody = styled.div`
  min-width: 0;
`;

export const RecorderActionBadge = styled.span`
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.72);
  display: inline-flex;
  font-size: 0.52rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  margin-right: 0.32rem;
  padding: 0.08rem 0.34rem;
  text-transform: uppercase;
`;

export const RecorderActionText = styled.div`
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.25;
  min-width: 0;
`;

export const RecorderActionMeta = styled.div`
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.62rem;
  line-height: 1.25;
  margin-top: 0.18rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const RecorderActionControls = styled.div`
  display: grid;
  gap: 0.18rem;
  grid-template-columns: auto;
`;

export const RecorderActionControlButton = styled.button`
  align-items: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  display: inline-flex;
  font-size: 0.62rem;
  font-weight: 800;
  height: 1.52rem;
  justify-content: center;
  padding: 0;
  width: 1.52rem;
  svg {
    height: 0.76rem;
    stroke-width: 1.9;
    width: 0.76rem;
  }
  &:hover {
    background: rgba(255, 209, 102, 0.16);
    border-color: rgba(255, 209, 102, 0.36);
    color: #fff;
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.34;
  }
  &[data-danger='true']:hover {
    background: rgba(255, 106, 106, 0.24);
    border-color: rgba(255, 106, 106, 0.42);
  }
  &[data-danger='true'] {
    background: transparent;
    border-color: transparent;
    color: #ff7a7a;
  }
  &[data-danger='true']::before {
    background: #ff5d5d;
    border-radius: 999px;
    content: '';
    display: block;
    height: 0.12rem;
    width: 0.72rem;
  }
  &[data-danger='true']:hover::before {
    background: #ff8a8a;
  }
`;

export const RecorderTimelineHeader = styled.div`
  align-items: end;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  display: flex;
  gap: 0.45rem;
  justify-content: space-between;
  margin-top: 0.78rem;
  padding-top: 0.72rem;
`;

export const RecorderTimelineHint = styled.div`
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.58rem;
  line-height: 1.25;
  text-align: right;
`;

export const RecorderLibraryList = styled.div`
  display: grid;
  gap: 0.42rem;
  margin-top: 0.62rem;
  max-height: min(21rem, calc(100vh - 9.5rem));
  overflow: auto;
  padding-right: 0.15rem;
`;

export const RecorderLibraryItem = styled.div<{ $active?: boolean }>`
  align-items: center;
  background: ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.12)' : 'rgba(255, 255, 255, 0.075)')};
  border: 1px solid ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.42)' : 'rgba(255, 255, 255, 0.13)')};
  border-radius: 0.9rem;
  cursor: pointer;
  display: grid;
  gap: 0.46rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 0.54rem 0.5rem 0.54rem 0.62rem;
  transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  > div {
    min-width: 0;
  }
  &:hover {
    background: rgba(255, 255, 255, 0.105);
    border-color: rgba(255, 209, 102, 0.32);
    transform: translateY(-1px);
  }
  &:focus-visible {
    outline: 2px solid rgba(255, 209, 102, 0.7);
    outline-offset: 2px;
  }
`;

export const RecorderLibraryHeader = styled.div`
  align-items: baseline;
  display: flex;
  gap: 0.55rem;
  justify-content: space-between;
  margin-top: 0.78rem;
  padding: 0 0.04rem;
`;

export const RecorderPrimaryAction = styled(RecorderButton)`
  background: #ffd166;
  border-color: rgba(255, 209, 102, 0.88);
  color: #111;
  &:hover {
    background: #ffe08f;
  }
  &:disabled:hover {
    background: #ffd166;
  }
`;

export const RecorderAddButton = styled.button`
  align-items: center;
  background: rgba(255, 209, 102, 0.08);
  border: 1px solid rgba(255, 209, 102, 0.3);
  border-radius: 999px;
  color: #ffd166;
  cursor: pointer;
  display: inline-flex;
  height: 1.68rem;
  justify-content: center;
  min-width: 1.68rem;
  padding: 0;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;
  width: 1.68rem;
  svg {
    height: 0.88rem;
    stroke-width: 2.15;
    width: 0.88rem;
  }
  &:hover {
    background: rgba(255, 209, 102, 0.16);
    border-color: rgba(255, 209, 102, 0.48);
    color: #ffe08f;
    transform: translateY(-1px);
  }
  &:focus-visible {
    outline: 2px solid rgba(255, 209, 102, 0.72);
    outline-offset: 2px;
  }
`;

export const RecorderLibraryDeleteButton = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: #ff7a7a;
  cursor: pointer;
  display: inline-flex;
  height: 1.72rem;
  justify-content: center;
  padding: 0;
  width: 1.72rem;
  &::before {
    background: #ff5d5d;
    border-radius: 999px;
    content: '';
    display: block;
    height: 0.12rem;
    width: 0.72rem;
  }
  &:hover {
    background: rgba(255, 106, 106, 0.12);
    &::before {
      background: #ff8a8a;
    }
  }
  &:focus-visible {
    outline: 2px solid rgba(255, 106, 106, 0.62);
    outline-offset: 2px;
  }
`;

export const RecorderLibraryTitle = styled.div`
  color: rgba(255, 255, 255, 0.92);
  font-size: 0.82rem;
  font-weight: 850;
  line-height: 1.22;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const RecorderLibraryMeta = styled.div`
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.66rem;
  line-height: 1.25;
  margin-top: 0.12rem;
`;

export const RecorderExportLanguageGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.36rem;
  min-width: 0;
`;

export const RecorderExportHeaderRow = styled.div`
  align-items: center;
  display: flex;
  gap: 0.72rem;
  justify-content: space-between;
  ${RecorderPrimaryAction} {
    flex: 0 0 auto;
    min-width: 4.85rem;
  }
  @media (max-width: 520px) {
    align-items: flex-start;
    flex-direction: column;
    ${RecorderPrimaryAction} {
      width: 100%;
    }
  }
`;

export const RecorderExportOptionRow = styled.div`
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  ${RecorderField} {
    gap: 0.24rem;
  }
  ${RecorderSelect} {
    min-height: 1.95rem;
  }
  @media (max-width: 420px) {
    grid-template-columns: 1fr;
  }
`;

export const RecorderExportLanguageButton = styled.button<{ $active?: boolean; $exporting?: boolean; $progress?: number }>`
  background: ${(props) => (props.$active ? 'rgba(255, 209, 102, 0.18)' : 'rgba(255, 255, 255, 0.08)')};
  border: 1px solid ${(props) => {
    if ((props.$progress || 0) >= 100) return 'rgba(52, 211, 153, 0.82)';
    if ((props.$progress || 0) > 0) return 'rgba(52, 211, 153, 0.56)';
    return props.$active ? 'rgba(255, 209, 102, 0.48)' : 'rgba(255, 255, 255, 0.14)';
  }};
  border-radius: 999px;
  color: ${(props) => ((props.$progress || 0) > 42 ? '#07130f' : (props.$active ? '#ffd166' : 'rgba(255, 255, 255, 0.72)'))};
  cursor: pointer;
  display: inline-grid;
  font-size: 0.66rem;
  font-weight: 900;
  height: 2.05rem;
  isolation: isolate;
  overflow: hidden;
  padding: 0;
  place-items: center;
  position: relative;
  text-transform: uppercase;
  transition: border-color 160ms ease, color 160ms ease, transform 160ms ease;
  width: 2.05rem;
  &::before {
    background: linear-gradient(180deg, rgba(110, 231, 183, 0.98), rgba(16, 185, 129, 0.94));
    border-radius: inherit;
    bottom: 0;
    content: '';
    height: ${(props) => Math.max(0, Math.min(100, props.$progress || 0))}%;
    left: 0;
    opacity: ${(props) => ((props.$progress || 0) > 0 ? 1 : 0)};
    position: absolute;
    right: 0;
    transition: height 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease;
    z-index: -1;
  }
  &::after {
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.38), transparent);
    content: '';
    height: 100%;
    left: -125%;
    opacity: ${(props) => (props.$exporting ? 1 : 0)};
    position: absolute;
    top: 0;
    transform: skewX(-20deg);
    transition: opacity 180ms ease;
    width: 70%;
  }
  ${(props) => (props.$exporting ? css`
    &::after {
      animation: ${subtleSweep} 1.4s ease-in-out infinite;
    }
  ` : '')}
  &:hover {
    background: rgba(255, 209, 102, 0.14);
    border-color: rgba(255, 209, 102, 0.36);
    transform: translateY(-1px);
  }
  &:disabled {
    cursor: default;
  }
  &:disabled:hover {
    transform: none;
  }
`;

export const RecorderExportProgressCard = styled.div`
  background: rgba(255, 255, 255, 0.075);
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 0.82rem;
  display: grid;
  gap: 0.48rem;
  margin-top: 0.1rem;
  padding: 0.6rem;
`;

export const RecorderExportArea = styled.div`
  display: grid;
  gap: 0.62rem;
`;

export const RecorderExportProgressTrack = styled.div`
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  height: 0.42rem;
  overflow: hidden;
`;

export const RecorderExportProgressFill = styled.div<{ $progress: number }>`
  background: #ffd166;
  height: 100%;
  transform: scaleX(${(props) => Math.max(0, Math.min(100, props.$progress)) / 100});
  transform-origin: left center;
  transition: transform 220ms ease;
  width: 100%;
`;

export const RecorderExportLog = styled.pre`
  background: rgba(0, 0, 0, 0.32);
  border-radius: 0.45rem;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.58rem;
  line-height: 1.35;
  margin: 0;
  max-height: 5rem;
  overflow: auto;
  padding: 0.42rem;
  white-space: pre-wrap;
`;

export const RecorderPreview = styled.pre`
  background: rgba(0, 0, 0, 0.35);
  border-radius: 0.5rem;
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.68rem;
  line-height: 1.35;
  margin: 0.7rem 0 0;
  max-height: 8rem;
  overflow: auto;
  padding: 0.55rem;
  white-space: pre-wrap;
`;

export const RecorderConfirmation = styled.div<{ $visible: boolean }>`
  background: rgba(255, 209, 102, 0.96);
  border: 1px solid rgba(17, 17, 17, 0.16);
  border-radius: 999px;
  box-shadow: 0 0.8rem 1.8rem rgba(0, 0, 0, 0.24);
  color: #111;
  font-size: 0.78rem;
  font-weight: 800;
  left: min(30rem, calc(100vw - 18rem));
  letter-spacing: 0.01em;
  line-height: 1.3;
  max-width: min(34rem, calc(100vw - 2rem));
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  padding: 0.42rem 0.72rem;
  pointer-events: none;
  position: fixed;
  top: 0.7rem;
  transform: translateY(${(props) => (props.$visible ? 0 : '-0.45rem')});
  transition: opacity 160ms ease, transform 160ms ease;
  white-space: normal;
  word-break: break-word;
  z-index: 1000001;
`;

export const DragGhost = styled.div<{ $valid: boolean; $visible: boolean; $x: number; $y: number }>`
  background: ${(props) => (props.$valid ? 'rgba(93, 214, 165, 0.96)' : 'rgba(255, 209, 102, 0.96)')};
  border: 1px solid ${(props) => (props.$valid ? 'rgba(14, 95, 66, 0.38)' : 'rgba(17, 17, 17, 0.18)')};
  border-radius: 999px;
  box-shadow: 0 0.8rem 1.8rem rgba(0, 0, 0, 0.26), 0 0 0 0.32rem ${(props) => (props.$valid ? 'rgba(93, 214, 165, 0.18)' : 'rgba(255, 209, 102, 0.16)')};
  color: #111;
  font-size: 0.78rem;
  font-weight: 800;
  left: ${(props) => props.$x}px;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  padding: 0.42rem 0.72rem 0.42rem 1.85rem;
  pointer-events: none;
  position: fixed;
  top: ${(props) => props.$y}px;
  transform: translate(0.9rem, -50%) scale(${(props) => (props.$visible ? 1 : 0.88)});
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, transform 120ms ease;
  z-index: 1000002;
  &::before {
    background: ${(props) => (props.$valid ? '#0d7f58' : '#111')};
    border: 2px solid rgba(255, 255, 255, 0.72);
    border-radius: 999px;
    box-shadow: 0 0 0 0.38rem ${(props) => (props.$valid ? 'rgba(93, 214, 165, 0.24)' : 'rgba(255, 209, 102, 0.26)')};
    content: '';
    height: 0.82rem;
    left: 0.58rem;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 0.82rem;
  }
  &::after {
    border: 2px solid ${(props) => (props.$valid ? 'rgba(93, 214, 165, 0.92)' : 'rgba(255, 209, 102, 0.95)')};
    border-radius: 999px;
    content: '';
    height: 2.25rem;
    left: -0.9rem;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 2.25rem;
  }
`;

export const DragDropHalo = styled.div<{ $visible: boolean; $x: number; $y: number }>`
  animation: ${(props) => (props.$visible ? dropRipple : 'none')} 680ms ease-out forwards;
  border: 0.26rem solid rgba(93, 214, 165, 0.95);
  border-radius: 999px;
  height: 3.2rem;
  left: ${(props) => props.$x}px;
  opacity: 0;
  pointer-events: none;
  position: fixed;
  top: ${(props) => props.$y}px;
  transform: translate(-50%, -50%);
  width: 3.2rem;
  z-index: 1000001;
`;
