// Robot motion as a pure function of elapsed time. Nothing here counts frames, so the
// 30 fps option shows fewer samples of exactly the same movement. No DOM, no React.
import type { Point } from "./placement";

export const FLOAT_MIN_MS = 320;
export const FLOAT_MAX_MS = 900;
const FLOAT_MS_PER_PX = 1.1;
export const ARM_MS = 280;
export const PRESENCE_MS = 240;
export const RESIZE_MS = 280;
export const EXPLAIN_MS = 2400;
const BOB_PERIOD_MS = 3200;
const BOB_PX = 4;
const NOD_PERIOD_MS = 800;
const NOD_DEG = 5;
const LEAN_DEG = 7;
const BLINK_EVERY_MS = 4600;
const BLINK_MS = 160;

export type RobotMode = "idle" | "point";

export interface RobotPose {
  x: number;
  y: number;
  /** Vertical float offset in pixels; the renderer adds it to `y`. */
  bob: number;
  /** Whole-body lean in degrees while sliding. */
  lean: number;
  /** Head rotation in degrees. */
  head: number;
  /** Arm rotations in degrees; 0 hangs down. `armLeft` is the arm on the viewer's left. */
  armLeft: number;
  armRight: number;
  /** 0 = gone, 1 = fully present. Drives opacity and scale. */
  presence: number;
  /** Eye openness, 1 = open. */
  eyes: number;
  /** Size factor, 1 = full size. The robot shrinks to fit a narrow free spot. */
  size: number;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

const still = (value: number): Tween => ({ from: value, to: value, start: 0, duration: 0 });
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const progress = (tween: Tween, clock: number) =>
  tween.duration <= 0 ? 1 : Math.min(1, Math.max(0, (clock - tween.start) / tween.duration));
const valueOf = (tween: Tween, clock: number) => tween.from + (tween.to - tween.from) * ease(progress(tween, clock));
const done = (tween: Tween, clock: number) => progress(tween, clock) >= 1;

export function floatDuration(distance: number): number {
  return Math.min(FLOAT_MAX_MS, Math.max(FLOAT_MIN_MS, distance * FLOAT_MS_PER_PX));
}

export interface RobotMotion {
  /**
   * Slide to a point. `instant` skips the slide. `follow` moves the destination and any slide
   * in flight by the same amount, which keeps the robot glued to a target that is scrolling.
   * Returns true when a new slide started. Asking for the destination it is already heading to
   * changes nothing, so a slide in flight is not restarted.
   */
  moveTo(point: Point, clock: number, options?: { instant?: boolean; follow?: boolean }): boolean;
  setArms(angles: { left: number; right: number }, clock: number): void;
  setMode(mode: RobotMode): void;
  setSize(size: number, clock: number): void;
  /** Small head movement for EXPLAIN_MS starting now. */
  explain(clock: number): void;
  setPresence(present: boolean, clock: number, options?: { instant?: boolean }): void;
  /** With reduced motion every change is immediate and the pose is static. */
  setReducedMotion(reduced: boolean): void;
  sample(clock: number): RobotPose;
  /** Clock time left until the slide in flight arrives; 0 when the robot is not sliding. */
  slideRemaining(clock: number): number;
  /** False when the pose will not change until the next command; the frame loop can stop. */
  isMoving(clock: number): boolean;
  destination(): Point;
}

export function createRobotMotion(
  start: Point,
  options: { reducedMotion?: boolean; present?: boolean; size?: number } = {},
): RobotMotion {
  let reduced = options.reducedMotion ?? false;
  let x = still(start.x);
  let y = still(start.y);
  let armLeft = still(0);
  let armRight = still(0);
  let presence = still(options.present === false ? 0 : 1);
  let size = still(options.size ?? 1);
  let mode: RobotMode = "idle";
  let explainFrom = Number.NEGATIVE_INFINITY;

  const retarget = (tween: Tween, to: number, clock: number, duration: number): Tween => {
    if (reduced || duration <= 0) return still(to);
    const from = valueOf(tween, clock);
    return from === to ? still(to) : { from, to, start: clock, duration };
  };
  const explaining = (clock: number) => !reduced && clock >= explainFrom && clock < explainFrom + EXPLAIN_MS;

  return {
    moveTo(point, clock, moveOptions) {
      if (moveOptions?.follow) {
        const dx = point.x - x.to;
        const dy = point.y - y.to;
        x = { ...x, from: x.from + dx, to: point.x };
        y = { ...y, from: y.from + dy, to: point.y };
        return false;
      }
      if (!moveOptions?.instant && Math.abs(point.x - x.to) < 0.5 && Math.abs(point.y - y.to) < 0.5) return false;
      const fromX = valueOf(x, clock);
      const fromY = valueOf(y, clock);
      const duration = moveOptions?.instant ? 0 : floatDuration(Math.hypot(point.x - fromX, point.y - fromY));
      x = retarget(x, point.x, clock, duration);
      y = retarget(y, point.y, clock, duration);
      return x.duration > 0 || y.duration > 0;
    },
    setArms(angles, clock) {
      armLeft = retarget(armLeft, angles.left, clock, ARM_MS);
      armRight = retarget(armRight, angles.right, clock, ARM_MS);
    },
    setMode(next) {
      mode = next;
    },
    setSize(next, clock) {
      size = retarget(size, next, clock, RESIZE_MS);
    },
    explain(clock) {
      explainFrom = clock;
    },
    setPresence(present, clock, presenceOptions) {
      presence = retarget(presence, present ? 1 : 0, clock, presenceOptions?.instant ? 0 : PRESENCE_MS);
    },
    setReducedMotion(next) {
      if (next === reduced) return;
      reduced = next;
      if (!reduced) return;
      // Finish everything in flight at its destination.
      x = still(x.to);
      y = still(y.to);
      armLeft = still(armLeft.to);
      armRight = still(armRight.to);
      presence = still(presence.to);
      size = still(size.to);
      explainFrom = Number.NEGATIVE_INFINITY;
    },
    sample(clock) {
      const sliding = !done(x, clock) || !done(y, clock);
      const slide = Math.max(progress(x, clock), progress(y, clock));
      const direction = Math.sign(x.to - x.from);
      const pose: RobotPose = {
        x: valueOf(x, clock),
        y: valueOf(y, clock),
        bob: 0,
        lean: 0,
        head: 0,
        armLeft: valueOf(armLeft, clock),
        armRight: valueOf(armRight, clock),
        presence: valueOf(presence, clock),
        eyes: 1,
        size: valueOf(size, clock),
      };
      if (reduced) return pose;
      // A pointing robot holds still so the arm stays on the target.
      const float = mode === "point" && !sliding ? 0.35 : 1;
      pose.bob = Math.sin((clock / BOB_PERIOD_MS) * Math.PI * 2) * BOB_PX * float;
      if (sliding) pose.lean = direction * LEAN_DEG * Math.sin(Math.PI * slide);
      if (explaining(clock)) {
        const t = clock - explainFrom;
        const envelope = Math.sin((Math.PI * t) / EXPLAIN_MS);
        pose.head = Math.sin((t / NOD_PERIOD_MS) * Math.PI * 2) * NOD_DEG * envelope;
      }
      const sinceBlink = clock % BLINK_EVERY_MS;
      if (sinceBlink < BLINK_MS) pose.eyes = 0.15 + 0.85 * Math.abs(1 - (2 * sinceBlink) / BLINK_MS);
      return pose;
    },
    slideRemaining(clock) {
      const ends = Math.max(x.duration > 0 ? x.start + x.duration : 0, y.duration > 0 ? y.start + y.duration : 0);
      return Math.max(0, ends - clock);
    },
    isMoving(clock) {
      if (!reduced) return true;
      return ![x, y, armLeft, armRight, presence, size].every((tween) => done(tween, clock));
    },
    destination: () => ({ x: x.to, y: y.to }),
  };
}

/**
 * A clock that stands still while the page is hidden, so a slide that was half done
 * when the tab went to the background resumes from the same place.
 */
export function createActiveClock(now: number) {
  let offset = now;
  let pausedAt: number | null = null;
  return {
    read: (time: number) => (pausedAt ?? time) - offset,
    pause(time: number) {
      if (pausedAt === null) pausedAt = time;
    },
    resume(time: number) {
      if (pausedAt === null) return;
      offset += time - pausedAt;
      pausedAt = null;
    },
    isPaused: () => pausedAt !== null,
  };
}

/**
 * Decides which animation frames paint. At 60 every frame paints; at 30 a frame paints
 * only when a full 1/30 s has passed, whatever the display refresh rate is.
 */
export function createFrameGate(frameRate: 60 | 30) {
  const interval = frameRate === 30 ? 1000 / 30 : 0;
  let last = Number.NEGATIVE_INFINITY;
  return (time: number): boolean => {
    // 1.5 ms of slack: frame timestamps jitter around the nominal interval.
    if (time - last < interval - 1.5) return false;
    last = time;
    return true;
  };
}
