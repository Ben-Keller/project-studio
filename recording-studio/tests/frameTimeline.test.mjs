import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCaptureClock, createFrameList, resampleFramesToOutputTimeline } from '../scripts/frameTimeline.mjs';

test('capture timestamps ignore variable transport latency', () => {
  const timestamp = createCaptureClock();
  assert.equal(timestamp(1, 1000), 1000);
  assert.equal(timestamp(1.016, 1100), 1016);
  assert.equal(timestamp(1.032, 1101), 1032);
});

test('resampling preserves the last frame and holds static sections without anticipating changes', () => {
  const frames = [{ path: 'first', capturedAt: 0 }, { path: 'last', capturedAt: 1000 }];
  const output = resampleFramesToOutputTimeline({ frames, outputFps: 60 });
  assert.equal(output.sampledFrames.length, 61);
  assert.equal(output.sampledFrames[59].path, 'first');
  assert.equal(output.sampledFrames[60].path, 'last');
  assert.equal(output.uniqueFrames, 2);
});

test('actual MP4 encoding preserves timing and the final frame at 30/60/120fps', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'walkthrough-encode-'));
  try {
    const red = path.join(dir, 'red.ppm');
    const blue = path.join(dir, 'blue.ppm');
    const ppm = (rgb) => Buffer.concat([Buffer.from('P6\n16 16\n255\n'), Buffer.from(Array(256).fill(rgb).flat())]);
    await writeFile(red, ppm([255, 0, 0]));
    await writeFile(blue, ppm([0, 0, 255]));
    for (const fps of [30, 60, 120]) {
      const output = resampleFramesToOutputTimeline({ frames: [{ path: red, capturedAt: 0 }, { path: blue, capturedAt: 200 }], outputFps: fps });
      const list = path.join(dir, 'frames.txt');
      const video = path.join(dir, `${fps}.mp4`);
      await writeFile(list, createFrameList({ ...output, outputFps: fps }));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-frames:v', String(output.sampledFrames.length), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr', video]);
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=nb_frames,duration', '-of', 'json', video]));
      assert.equal(Number(info.streams[0].nb_frames), output.sampledFrames.length);
      assert.ok(Math.abs(Number(info.streams[0].duration) - output.outputDurationMs / 1000) < 0.002);
      const last = execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', `select=eq(n\\,${output.sampledFrames.length - 1})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      assert.ok(last[2] > 200 && last[0] < 30, 'final frame must be blue');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('resolution fits preserve aspect ratio, even dimensions, and portrait orientation', async () => {
  const { getExportDimensions, getFrameCaptureTimeScale } = await import('../shared/exportSettings.mjs');
  for (const [resolution, width] of [['1080p', 1920], ['1440p', 2560], ['4k', 3840]]) {
    const landscape = getExportDimensions({ width: 1600, height: 900 }, resolution);
    assert.equal(landscape.width, width);
    assert.equal(landscape.height, width * 9 / 16);
    const portrait = getExportDimensions({ width: 900, height: 1600 }, resolution);
    assert.equal(portrait.height, width);
    assert.equal(portrait.width, landscape.height);
  }
  const odd = getExportDimensions({width: 1633, height: 907}, '1080p');
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height % 2, 0);
  assert.equal(getFrameCaptureTimeScale(30, 'standard'), 2);
  assert.equal(getFrameCaptureTimeScale(60, 'high'), 3);
  assert.equal(getFrameCaptureTimeScale(60, 'maximum'), 6);
});
