import { afterEach, describe, expect, it, vi } from 'vitest';
import { animate, wait } from '../src/playbackClock';
import { buildTargetedAction, getActionPoint, isRecorderElement } from '../src/targeting';
import { compactActionSnapshots, createWalkthroughStateSnapshot } from '../src/stateSnapshot';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('playback cancellation', () => {
  it('prevents an action continuation after pause', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const click = vi.fn();
    const operation = wait(100, controller.signal).then(click);
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    await vi.runAllTimersAsync();
    expect(click).not.toHaveBeenCalled();
  });

  it('removes completed timer listeners and rejects already stopped work', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const operation = wait(100, controller.signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    await expect(wait(100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(animate(100, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels pending animation frames immediately', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const update = vi.fn();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const operation = animate(1000, update, controller.signal);
    const rejection = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    await vi.runAllTimersAsync();
    expect(cancel).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('portable recording targets', () => {
  it('keeps a recorded point proportional when the target changes size', () => {
    document.body.innerHTML = '<button data-walkthrough-target="filter">Filter</button>';
    const element = document.querySelector('button')!;
    const rect = vi.spyOn(element, 'getBoundingClientRect');
    rect.mockReturnValue(new DOMRect(100, 100, 100, 40));
    const action = buildTargetedAction('click', { element, x: 125, y: 120 });
    rect.mockReturnValue(new DOMRect(200, 50, 200, 80));
    expect(getActionPoint(action)).toEqual({ x: 250, y: 90 });
    element.remove();
    expect(getActionPoint(action)).toEqual({ x: 125, y: 120 });
  });

  it('does not double-apply offsets to legacy coordinate fallbacks', () => {
    expect(getActionPoint({ type: 'circle', target: 'gone', x: 70, y: 80, offsetX: 20, offsetY: 10 })).toEqual({ x: 70, y: 80 });
  });

  it('recognizes SVG icons inside the recorder as recorder UI', () => {
    document.body.innerHTML = '<div data-walkthrough-recorder><svg><path /></svg></div>';
    expect(isRecorderElement(document.querySelector('path'))).toBe(true);
  });

  it('compacts legacy snapshots without dropping wait or state actions', () => {
    const baseline = createWalkthroughStateSnapshot([], true);
    const actions = compactActionSnapshots([
      { type: 'wait', durationMs: 250, state: { ...baseline, setupActions: [{ type: 'click', target: 'filter' }] } },
      { type: 'state', appState: { selected: 'Africa' } },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions[0].durationMs).toBe(250);
    expect(actions[0].state?.setupActions).toEqual([]);
    expect(actions[1].appState).toEqual({ selected: 'Africa' });
  });
});

import { createDistancePath, easePointer, getArcControls, getIrregularOvalPoint, getMoveDuration, getTypingDelays, interpolateCubicBezier } from '../src/motion';

describe('natural deterministic motion', () => {
  it('keeps short moves straight and bounds long arcs', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 40, y: 0 };
    const short = getArcControls(start, end);
    expect(interpolateCubicBezier(start, short.controlA, short.controlB, end, 0.5).y).toBe(0);
    expect(Math.abs(getArcControls(start, { x: 2000, y: 0 }).controlA.y)).toBeLessThanOrEqual(64);
  });

  it('uses bounded distance-aware defaults but preserves explicit durations', () => {
    expect(getMoveDuration(20, 500)).toBeLessThan(getMoveDuration(400, 500));
    expect(getMoveDuration(10000, 500)).toBe(850);
    expect(getMoveDuration(2000, 500, 150)).toBe(150);
    expect(getMoveDuration(2000, 500, 0)).toBe(0);
  });

  it('has monotonic easing and no overshoot', () => {
    let previous = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const value = easePointer(i / 1000);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(value).toBeLessThanOrEqual(1 + 1e-12);
      previous = value;
    }
    expect(easePointer(0)).toBe(0);
    expect(easePointer(1)).toBe(1);
    expect(easePointer(0.5)).toBeGreaterThan(0.5);
  });

  it('uses distance instead of parameter position and handles stationary paths', () => {
    const path = createDistancePath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }]);
    expect(path.at(0.5)).toEqual({ x: 50, y: 0 });
    expect(path.at(0)).toEqual({ x: 0, y: 0 });
    expect(path.at(1)).toEqual({ x: 100, y: 0 });
    expect(createDistancePath([{ x: 3, y: 4 }, { x: 3, y: 4 }]).at(0.5)).toEqual({ x: 3, y: 4 });
  });

  it('closes each irregular circle without a seam over repeated loops', () => {
    for (const seed of [0, 0.5, 0.99]) {
      const first = getIrregularOvalPoint({ x: 50, y: 80 }, 90, 0.7, seed);
      const last = getIrregularOvalPoint({ x: 50, y: 80 }, 90, 0.7 + Math.PI * 6, seed);
      expect(last.x).toBeCloseTo(first.x, 8);
      expect(last.y).toBeCloseTo(first.y, 8);
    }
  });

  it('varies typing predictably, pauses at punctuation, and preserves total duration', () => {
    const text = 'Hello, world!';
    const delays = getTypingDelays(text, 1200);
    expect(delays).toEqual(getTypingDelays(text, 1200));
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBeCloseTo(1200, 8);
    expect(delays[5]).toBeGreaterThan(delays[4]);
    expect(getTypingDelays('', 1200)).toEqual([]);
    expect(getTypingDelays('A\u{1F600}B', 300)).toHaveLength(3);
  });
});
