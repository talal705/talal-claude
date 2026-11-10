// Measures the robot's animation loop: how far apart its paints are and how long a slide
// really takes. Pure bookkeeping over timestamps; the robot feeds it and a test harness reads it.
// It exists only when a page asks for it (see Robot.tsx), and it draws nothing.

export interface IntervalStats {
  /** Number of intervals (paints minus one). */
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  /** 1000 / median: the frame rate the loop actually held. */
  fps: number;
}

export interface SlideMeasurement {
  /** What the motion engine planned for this slide, from the distance. Identical at 60 and 30 fps. */
  plannedMs: number;
  /** From the command to the first paint that showed the robot at its destination. */
  measuredMs: number;
  /** Paints during the slide. */
  frames: number;
}

export interface ProbeReport {
  label: string;
  frameRateSetting: 60 | 30;
  reducedMotion: boolean;
  /** Wall time between start and stop. */
  durationMs: number;
  paints: number;
  intervals: IntervalStats;
  slides: SlideMeasurement[];
  /** Slides still in flight at stop; their end was not seen. */
  unfinishedSlides: number;
}

export function summarizeIntervals(timestamps: readonly number[]): IntervalStats {
  const intervals: number[] = [];
  for (let index = 1; index < timestamps.length; index += 1) intervals.push(timestamps[index] - timestamps[index - 1]);
  if (intervals.length === 0) return { count: 0, medianMs: 0, p95Ms: 0, maxMs: 0, fps: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  // Nearest-rank percentile.
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  const medianMs = at(0.5);
  return { count: sorted.length, medianMs, p95Ms: at(0.95), maxMs: sorted[sorted.length - 1], fps: medianMs > 0 ? 1000 / medianMs : 0 };
}

export interface FrameProbe {
  /** Begins a recording, discarding any previous one. */
  start(label?: string): void;
  /** Ends the recording and returns its report; null when none was started. */
  stop(): ProbeReport | null;
  isRecording(): boolean;
  /** The robot painted at this time. */
  painted(time: number): void;
  /** A slide was commanded at this time; the motion engine planned `plannedMs` for it. */
  slideStarted(time: number, plannedMs: number): void;
  /** The paint at this time showed the robot at its destination. */
  slideEnded(time: number): void;
  /** The setting in force, copied into the report. */
  configure(setting: { frameRate: 60 | 30; reducedMotion: boolean }): void;
}

export function createFrameProbe(now: () => number): FrameProbe {
  let recording = false;
  let label = "";
  let startedAt = 0;
  let paints: number[] = [];
  let slides: SlideMeasurement[] = [];
  let open: { at: number; plannedMs: number; frames: number } | null = null;
  let unfinished = 0;
  let setting: { frameRate: 60 | 30; reducedMotion: boolean } = { frameRate: 60, reducedMotion: false };

  return {
    start(name = "") {
      recording = true;
      label = name;
      startedAt = now();
      paints = [];
      slides = [];
      open = null;
      unfinished = 0;
    },
    stop() {
      if (!recording) return null;
      recording = false;
      return {
        label,
        frameRateSetting: setting.frameRate,
        reducedMotion: setting.reducedMotion,
        durationMs: now() - startedAt,
        paints: paints.length,
        intervals: summarizeIntervals(paints),
        slides,
        unfinishedSlides: unfinished + (open ? 1 : 0),
      };
    },
    isRecording: () => recording,
    painted(time) {
      if (!recording) return;
      paints.push(time);
      if (open) open.frames += 1;
    },
    slideStarted(time, plannedMs) {
      if (!recording) return;
      // A new command before the last slide arrived replaces it; that one never ended.
      if (open) unfinished += 1;
      open = { at: time, plannedMs, frames: 0 };
    },
    slideEnded(time) {
      if (!recording || !open) return;
      slides.push({ plannedMs: open.plannedMs, measuredMs: time - open.at, frames: open.frames });
      open = null;
    },
    configure(next) {
      setting = next;
    },
  };
}
