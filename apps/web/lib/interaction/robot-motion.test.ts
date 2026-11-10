import { describe, expect, it } from "vitest";
import {
  ARM_MS,
  EXPLAIN_MS,
  FLOAT_MAX_MS,
  FLOAT_MIN_MS,
  PRESENCE_MS,
  RESIZE_MS,
  createActiveClock,
  createFrameGate,
  createRobotMotion,
  floatDuration,
} from "./robot-motion";

describe("robot motion", () => {
  it("float-to takes the same time and follows the same path at 60 and 30 frames per second", () => {
    const run = (frameMs: number) => {
      const motion = createRobotMotion({ x: 0, y: 0 });
      motion.moveTo({ x: 400, y: 300 }, 0);
      const samples = new Map<number, number>();
      let arrivedAt = -1;
      for (let frame = 0; frame * frameMs <= 1200; frame += 1) {
        const clock = frame * frameMs;
        const pose = motion.sample(clock);
        samples.set(Math.round(clock), pose.x);
        if (arrivedAt < 0 && pose.x === 400 && pose.y === 300) arrivedAt = clock;
      }
      return { samples, arrivedAt };
    };
    const at60 = run(1000 / 60);
    const at30 = run(1000 / 30);
    const duration = floatDuration(500);
    // Each run arrives on its first frame at or after the duration; no frame-count dependence.
    expect(at60.arrivedAt).toBeGreaterThanOrEqual(duration);
    expect(at60.arrivedAt - duration).toBeLessThan(1000 / 60);
    expect(at30.arrivedAt).toBeGreaterThanOrEqual(duration);
    expect(at30.arrivedAt - duration).toBeLessThan(1000 / 30);
    // Every 30 fps sample equals the 60 fps sample taken at the same moment.
    let compared = 0;
    for (const [clock, x] of at30.samples) {
      const other = at60.samples.get(clock);
      if (other === undefined) continue;
      expect(other).toBeCloseTo(x, 6);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(30);
  });

  it("float duration grows with distance within fixed bounds", () => {
    expect(floatDuration(0)).toBe(FLOAT_MIN_MS);
    expect(floatDuration(500)).toBeCloseTo(550);
    expect(floatDuration(5000)).toBe(FLOAT_MAX_MS);
  });

  it("idle floats gently and a pointing robot barely moves", () => {
    const motion = createRobotMotion({ x: 100, y: 100 });
    const idle = [0, 400, 800, 1200, 1600, 2400].map((clock) => motion.sample(clock).bob);
    expect(Math.max(...idle.map(Math.abs))).toBeGreaterThan(3);
    expect(Math.max(...idle.map(Math.abs))).toBeLessThanOrEqual(4);
    motion.setMode("point");
    expect(Math.abs(motion.sample(800).bob)).toBeLessThan(1.5);
  });

  it("arms reach their angle after ARM_MS and retarget from where they are", () => {
    const motion = createRobotMotion({ x: 0, y: 0 });
    motion.setArms({ left: 0, right: -90 }, 0);
    const half = motion.sample(ARM_MS / 2).armRight;
    expect(half).toBeLessThan(0);
    expect(half).toBeGreaterThan(-90);
    motion.setArms({ left: 0, right: 0 }, ARM_MS / 2);
    expect(motion.sample(ARM_MS / 2).armRight).toBeCloseTo(half);
    expect(motion.sample(ARM_MS * 2).armRight).toBe(0);
  });

  it("explaining moves the head for EXPLAIN_MS and then stops", () => {
    const motion = createRobotMotion({ x: 0, y: 0 });
    expect(motion.sample(500).head).toBe(0);
    motion.explain(1000);
    const during = [1200, 1400, 1600, 2200].map((clock) => Math.abs(motion.sample(clock).head));
    expect(Math.max(...during)).toBeGreaterThan(1);
    expect(motion.sample(1000 + EXPLAIN_MS + 1).head).toBe(0);
  });

  it("hide and return fade over PRESENCE_MS", () => {
    const motion = createRobotMotion({ x: 0, y: 0 }, { present: false });
    expect(motion.sample(0).presence).toBe(0);
    motion.setPresence(true, 0);
    expect(motion.sample(PRESENCE_MS / 2).presence).toBeCloseTo(0.5);
    expect(motion.sample(PRESENCE_MS).presence).toBe(1);
    motion.setPresence(false, 1000);
    expect(motion.sample(1000 + PRESENCE_MS).presence).toBe(0);
  });

  it("reduced motion: jumps to the destination with a static pose and nothing left to animate", () => {
    const motion = createRobotMotion({ x: 0, y: 0 }, { reducedMotion: true });
    motion.moveTo({ x: 400, y: 300 }, 0);
    motion.setArms({ left: 45, right: 0 }, 0);
    motion.explain(0);
    for (const clock of [0, 1, 500, 1777]) {
      expect(motion.sample(clock)).toEqual({
        x: 400, y: 300, bob: 0, lean: 0, head: 0, armLeft: 45, armRight: 0, presence: 1, eyes: 1, size: 1,
      });
    }
    expect(motion.isMoving(0)).toBe(false);
  });

  it("turning reduced motion on mid-slide finishes the slide at once", () => {
    const motion = createRobotMotion({ x: 0, y: 0 });
    motion.moveTo({ x: 400, y: 0 }, 0);
    expect(motion.sample(100).x).toBeLessThan(400);
    motion.setReducedMotion(true);
    expect(motion.sample(100).x).toBe(400);
    expect(motion.sample(100).bob).toBe(0);
  });

  it("shrinks and grows over RESIZE_MS, and at once with reduced motion", () => {
    const motion = createRobotMotion({ x: 0, y: 0 });
    motion.setSize(0.5, 0);
    expect(motion.sample(RESIZE_MS / 2).size).toBeCloseTo(0.75);
    expect(motion.sample(RESIZE_MS).size).toBe(0.5);
    const reduced = createRobotMotion({ x: 0, y: 0 }, { reducedMotion: true });
    reduced.setSize(0.5, 0);
    expect(reduced.sample(0).size).toBe(0.5);
  });

  it("asking again for the same destination does not restart a slide in flight", () => {
    const motion = createRobotMotion({ x: 0, y: 0 });
    expect(motion.moveTo({ x: 400, y: 300 }, 0)).toBe(true);
    const planned = motion.slideRemaining(0);
    const before = motion.sample(200).x;
    expect(motion.moveTo({ x: 400, y: 300 }, 200)).toBe(false);
    expect(motion.moveTo({ x: 400.2, y: 300 }, 200)).toBe(false);
    expect(motion.sample(200).x).toBe(before);
    expect(motion.slideRemaining(200)).toBeCloseTo(planned - 200);
    expect(motion.sample(planned).x).toBe(400);
    expect(motion.moveTo({ x: 100, y: 300 }, planned)).toBe(true);
  });

  it("an instant move does not slide", () => {
    const motion = createRobotMotion({ x: 0, y: 0 });
    motion.moveTo({ x: 0, y: 250 }, 10, { instant: true });
    expect(motion.sample(10).y).toBe(250);
    expect(motion.sample(10).lean).toBe(0);
  });

  it("following a scrolling target moves by exactly the scroll amount, at rest and mid-slide", () => {
    const resting = createRobotMotion({ x: 300, y: 400 });
    resting.moveTo({ x: 300, y: 250 }, 10, { follow: true });
    expect(resting.sample(10)).toMatchObject({ x: 300, y: 250 });

    const sliding = createRobotMotion({ x: 0, y: 0 });
    sliding.moveTo({ x: 400, y: 300 }, 0);
    const before = sliding.sample(200);
    sliding.moveTo({ x: 400, y: 180 }, 200, { follow: true });
    const after = sliding.sample(200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y - 120);
    expect(sliding.sample(2000)).toMatchObject({ x: 400, y: 180 });
  });
});

describe("active clock", () => {
  it("does not advance while paused, so hidden time is not animated", () => {
    const clock = createActiveClock(1000);
    expect(clock.read(1500)).toBe(500);
    clock.pause(1500);
    expect(clock.read(9000)).toBe(500);
    clock.resume(9000);
    expect(clock.read(9100)).toBe(600);
  });

  it("a slide interrupted by a hidden tab resumes where it stopped", () => {
    const clock = createActiveClock(0);
    const motion = createRobotMotion({ x: 0, y: 0 });
    motion.moveTo({ x: 400, y: 0 }, clock.read(0));
    const before = motion.sample(clock.read(200)).x;
    clock.pause(200);
    clock.resume(60_000);
    expect(motion.sample(clock.read(60_000)).x).toBe(before);
  });
});

describe("frame gate", () => {
  const paints = (frameRate: 60 | 30, displayHz: number) => {
    const gate = createFrameGate(frameRate);
    let count = 0;
    for (let frame = 0; frame < displayHz; frame += 1) if (gate((frame * 1000) / displayHz)) count += 1;
    return count;
  };

  it("paints every frame at 60 and every other frame at 30 on a 60 Hz display", () => {
    expect(paints(60, 60)).toBe(60);
    expect(paints(30, 60)).toBe(30);
  });

  it("stays at 30 paints per second on a 120 Hz display", () => {
    expect(paints(30, 120)).toBe(30);
  });
});
