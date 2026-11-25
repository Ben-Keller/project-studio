// Compositor timestamps describe when pixels were painted, not when Node received
// them. Anchor that clock once; transport delays must not change video timing.
export const createCaptureClock = () => {
  let offset;
  let previous = -Infinity;
  return (timestampSeconds, receivedAt) => {
    if (Number.isFinite(timestampSeconds) && offset === undefined)
      offset = receivedAt - timestampSeconds * 1000;
    const timestamp = Number.isFinite(timestampSeconds)
      ? offset + timestampSeconds * 1000
      : receivedAt;
    previous = Math.max(previous, timestamp);
    return previous;
  };
};

export const resampleFramesToOutputTimeline = ({
  frames,
  outputFps,
  timeScale = 1,
}) => {
  if (!(outputFps > 0) || !(timeScale > 0))
    throw new Error('Frame rate and time scale must be positive.');
  const durationSeconds = 1 / outputFps;
  if (!frames.length)
    return {
      durationSeconds,
      outputDurationMs: 0,
      repeatedFrames: 0,
      sampledFrames: [],
      uniqueFrames: 0,
    };
  const first = frames[0].capturedAt;
  const last = frames[frames.length - 1].capturedAt;
  // Include the final captured instant, including when it lands on a frame boundary.
  const count = Math.max(
    1,
    Math.ceil(((last - first) * outputFps) / (1000 * timeScale)) + 1
  );
  const sampledFrames = [];
  const used = new Set();
  let index = 0;
  for (let outputIndex = 0; outputIndex < count; outputIndex += 1) {
    const target = first + (outputIndex * 1000 * timeScale) / outputFps;
    while (index < frames.length - 1 && frames[index + 1].capturedAt <= target)
      index += 1;
    // Holding the latest painted frame avoids showing future UI changes early.
    sampledFrames.push(frames[index]);
    used.add(index);
  }
  return {
    durationSeconds,
    outputDurationMs: count * durationSeconds * 1000,
    repeatedFrames: count - used.size,
    sampledFrames,
    uniqueFrames: used.size,
  };
};

export const createFrameList = ({
  sampledFrames,
  durationSeconds,
  outputFps,
}) => {
  const lines = ['ffconcat version 1.0'];
  for (const frame of sampledFrames) {
    lines.push(`file '${frame.path.replace(/'/g, "'\\''")}'`);
    // Still-image demuxers otherwise default to 25fps, quantizing 60/120fps timestamps.
    lines.push(`option framerate ${outputFps}`);
    lines.push(`duration ${durationSeconds.toFixed(9)}`);
  }
  return `${lines.join('\n')}\n`;
};
