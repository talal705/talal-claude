import { describe, expect, it } from "vitest";
import { createFrameProbe, summarizeIntervals } from "./frame-probe";
import { createFrameGate, createRobotMotion, floatDuration } from "./robot-motion";

describe("interval statistics", () => {
  it("gives median, p95 and max of the gaps between paints", () => {
    const stamps = [0];
    for (let i = 0; i < 99; i += 1) stamps.push(stamps[stamps.length - 1] + (i === 50 ? 50 : 16));
    const stats = summarizeIntervals(stamps);
    expect(stats.count).toBe(99);
    expect(stats.medianMs).toBe(16);
    expect(stats.p95Ms).toBe(16);
    expect(stats.maxMs).toBe(50);
    expect(stats.fps).toBeCloseTo(62.5);
  });

  it("p95 rises when more than five percent of the frames are slow", () => {
    const stamps = [0];
    for (let i = 0; i < 100; i += 1) stamps.push(stamps[stamps.length - 1] + (i % 10 === 0 ? 40 : 16));
    expect(summarizeIntervals(stamps).p95Ms).toBe(40);
  });

  it("is all zeros for fewer than two paints", () => {
    expect(summarizeIntervals([])).toEqual({ count: 0, medianMs: 0, p95Ms: 0, maxMs: 0, fps: 0 });
    expect(summarizeIntervals([5]).count).toBe(0);
  });
});

describe("frame probe", () => {
  it("records nothing until started and returns null when stopped without a start", () => {
    const probe = createFrameProbe(() => 0);
    probe.painted(1);
    probe.slideStarted(1, 500);
    expect(probe.isRecording()).toBe(false);
    expect(probe.stop()).toBeNull();
  });

  /** Drives the real motion engine and frame gate on a simulated 60 Hz display, the way Robot.tsx does. */
  function measureSlide(frameRate: 60 | 30) {
    let time = 0;
    const probe = createFrameProbe(() => time);
    probe.configure({ frameRate, reducedMotion: false });
    const gate = createFrameGate(frameRate);
    const motion = createRobotMotion({ x: 0, y: 0 });
    probe.start(`slide at ${frameRate}`);
    time = 100;
    motion.moveTo({ x: 400, y: 300 }, time);
    probe.slideStarted(time, motion.slideRemaining(time));
    let sliding = true;
    for (let frame = 7; frame < 120; frame += 1) {
      time = (frame * 1000) / 60;
      if (!gate(time)) continue;
      motion.sample(time);
      probe.painted(time);
      if (sliding && motion.slideRemaining(time) === 0) {
        sliding = false;
        probe.slideEnded(time);
      }
    }
    return probe.stop()!;
  }

  it("a slide takes the planned time at 60 and at 30 fps, within one frame of each setting", () => {
    const planned = floatDuration(500);
    const at60 = measureSlide(60);
    const at30 = measureSlide(30);
    expect(at60.slides).toHaveLength(1);
    expect(at30.slides).toHaveLength(1);
    expect(at60.slides[0].plannedMs).toBeCloseTo(planned);
    expect(at30.slides[0].plannedMs).toBeCloseTo(planned);
    expect(at60.slides[0].measuredMs - planned).toBeGreaterThanOrEqual(0);
    expect(at60.slides[0].measuredMs - planned).toBeLessThan(1000 / 60 + 1);
    expect(at30.slides[0].measuredMs - planned).toBeGreaterThanOrEqual(0);
    expect(at30.slides[0].measuredMs - planned).toBeLessThan(1000 / 30 + 1);
    expect(at30.slides[0].frames).toBeLessThan(at60.slides[0].frames * 0.6);
  });

  it("reports the frame rate the loop held and the setting in force", () => {
    const at60 = measureSlide(60);
    const at30 = measureSlide(30);
    expect(at60.frameRateSetting).toBe(60);
    expect(at60.intervals.medianMs).toBeCloseTo(1000 / 60, 3);
    expect(at30.frameRateSetting).toBe(30);
    expect(at30.intervals.medianMs).toBeCloseTo(1000 / 30, 3);
    expect(at30.intervals.fps).toBeCloseTo(30, 1);
    expect(at60.label).toBe("slide at 60");
  });

  it("counts a slide that was replaced or still in flight as unfinished instead of inventing a duration", () => {
    let time = 0;
    const probe = createFrameProbe(() => time);
    probe.start();
    probe.slideStarted(0, 500);
    probe.slideStarted(100, 400);
    time = 200;
    const report = probe.stop()!;
    expect(report.slides).toEqual([]);
    expect(report.unfinishedSlides).toBe(2);
    expect(report.durationMs).toBe(200);
  });

  it("a new start discards the previous recording", () => {
    const probe = createFrameProbe(() => 0);
    probe.start("a");
    probe.painted(1);
    probe.painted(2);
    probe.start("b");
    probe.painted(3);
    expect(probe.stop()).toMatchObject({ label: "b", paints: 1 });
  });
});
