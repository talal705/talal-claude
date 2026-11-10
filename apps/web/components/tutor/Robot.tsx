"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { TargetRect } from "@ytl/contracts";
import { armAngle, nearestPointOn, type Point, type Size } from "@/lib/interaction/placement";
import { createFrameProbe, type FrameProbe } from "@/lib/interaction/frame-probe";
import {
  createActiveClock,
  createFrameGate,
  createRobotMotion,
  type RobotMotion,
  type RobotPose,
} from "@/lib/interaction/robot-motion";
import styles from "./tutor.module.css";

// Drawing units of the SVG below. The arms turn around the shoulders, the head around the neck.
const VIEW = { width: 120, height: 164 };
const SHOULDER = { left: { x: 31, y: 82 }, right: { x: 89, y: 82 } };
const NECK = { x: 60, y: 64 };
const BASE = { x: 60, y: 150 };
const EYE_Y = 40;

declare global {
  interface Window {
    /** Set to true before the page loads (a test harness does this) to expose the frame probe. */
    __YTL_PROBE__?: boolean;
    __ytlRobotProbe?: Pick<FrameProbe, "start" | "stop" | "isRecording">;
  }
}

export interface RobotHandle {
  /** Full size in CSS pixels, before any `scale` (it is smaller on narrow screens). */
  size(): Size;
  /**
   * Go to `position` (top-left corner, viewport pixels). With `aim` the robot raises the arm
   * nearer to that rectangle and points at it; without it the arms rest.
   * `follow` keeps the robot glued to a destination that moved because the page scrolled.
   * `scale` shrinks it to fit a narrow free spot; `position` is the corner of the scaled robot.
   */
  goTo(position: Point, options?: { aim?: TargetRect; follow?: boolean; scale?: number }): void;
  /** Small head movement while a new explanation is shown. */
  explain(): void;
  /** Fade out before the robot is removed. */
  leave(): void;
}

interface RobotProps {
  ref: Ref<RobotHandle>;
  reducedMotion: boolean;
  frameRate: 60 | 30;
}

/**
 * The 2D tutor character. Decorative: everything it communicates is also text in the help panel.
 * Movement is written straight to the DOM from one animation loop; React never re-renders per frame.
 */
export function Robot({ ref, reducedMotion, frameRate }: RobotProps) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<SVGGElement>(null);
  const head = useRef<SVGGElement>(null);
  const armLeft = useRef<SVGGElement>(null);
  const armRight = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);

  const motion = useRef<RobotMotion | null>(null);
  const clock = useRef<ReturnType<typeof createActiveClock> | null>(null);
  const gate = useRef(createFrameGate(frameRate));
  const raf = useRef(0);
  const reduced = useRef(reducedMotion);
  /** Present only when a test harness asked for it; otherwise every probe call below is a skipped null check. */
  const probe = useRef<FrameProbe | null>(null);
  const sliding = useRef(false);

  const now = () => clock.current!.read(performance.now());

  const paint = (pose: RobotPose) => {
    const element = root.current;
    if (!element) return;
    // The origin is the top-left corner; appearing grows from the middle of the body.
    const grow = 0.7 + 0.3 * pose.presence;
    const scale = pose.size * grow;
    const x = pose.x + element.offsetWidth * pose.size * (1 - grow) * 0.5;
    const y = pose.y + pose.bob * pose.size + element.offsetHeight * pose.size * (1 - grow) * 0.6;
    element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
    element.style.opacity = pose.presence.toFixed(3);
    element.style.visibility = "visible";
    body.current?.setAttribute("transform", `rotate(${pose.lean.toFixed(2)} ${BASE.x} ${BASE.y})`);
    head.current?.setAttribute("transform", `rotate(${pose.head.toFixed(2)} ${NECK.x} ${NECK.y})`);
    armLeft.current?.setAttribute("transform", `rotate(${pose.armLeft.toFixed(2)} ${SHOULDER.left.x} ${SHOULDER.left.y})`);
    armRight.current?.setAttribute("transform", `rotate(${pose.armRight.toFixed(2)} ${SHOULDER.right.x} ${SHOULDER.right.y})`);
    eyes.current?.setAttribute("transform", `translate(0 ${(EYE_Y * (1 - pose.eyes)).toFixed(2)}) scale(1 ${pose.eyes.toFixed(3)})`);
  };

  const frame = (time: number) => {
    raf.current = 0;
    const current = motion.current;
    if (!current || !clock.current || document.hidden) return;
    const elapsed = clock.current.read(time);
    if (gate.current(time)) {
      paint(current.sample(elapsed));
      probe.current?.painted(time);
      if (sliding.current && current.slideRemaining(elapsed) === 0) {
        sliding.current = false;
        probe.current?.slideEnded(time);
      }
    }
    if (current.isMoving(elapsed)) raf.current = requestAnimationFrame(frame);
  };

  /** After any command: paint now when motion is reduced, otherwise make sure the loop runs. */
  const wake = () => {
    if (!motion.current || !clock.current) return;
    if (reduced.current) paint(motion.current.sample(now()));
    if (!raf.current && !document.hidden) raf.current = requestAnimationFrame(frame);
  };

  useImperativeHandle(ref, () => ({
    size() {
      const element = root.current;
      return element ? { width: element.offsetWidth, height: element.offsetHeight } : { width: 72, height: 98 };
    },
    goTo(position, options) {
      clock.current ??= createActiveClock(performance.now());
      const first = motion.current === null;
      if (!motion.current) {
        motion.current = createRobotMotion(position, { reducedMotion: reduced.current, present: false, size: options?.scale });
        motion.current.setPresence(true, now());
      }
      const current = motion.current;
      if (current.moveTo(position, now(), { follow: !first && options?.follow })) {
        sliding.current = true;
        probe.current?.slideStarted(performance.now(), current.slideRemaining(now()));
      }
      const scale = options?.scale ?? 1;
      current.setSize(scale, now());
      const aim = options?.aim;
      if (aim) {
        const width = (root.current?.offsetWidth ?? 72) * scale;
        const unit = width / VIEW.width;
        const centre = position.x + width / 2;
        const useLeft = aim.x + aim.width / 2 < centre;
        const local = useLeft ? SHOULDER.left : SHOULDER.right;
        const shoulder = { x: position.x + local.x * unit, y: position.y + local.y * unit };
        const angle = armAngle(shoulder, nearestPointOn(aim, shoulder));
        current.setMode("point");
        current.setArms(useLeft ? { left: angle, right: 0 } : { left: 0, right: angle }, now());
      } else {
        current.setMode("idle");
        current.setArms({ left: 0, right: 0 }, now());
      }
      wake();
    },
    explain() {
      if (!motion.current || !clock.current) return;
      motion.current.explain(now());
      wake();
    },
    leave() {
      if (!motion.current || !clock.current) return;
      motion.current.setPresence(false, now());
      wake();
    },
  }));

  useEffect(() => {
    reduced.current = reducedMotion;
    motion.current?.setReducedMotion(reducedMotion);
    wake();
  });

  useEffect(() => {
    gate.current = createFrameGate(frameRate);
  }, [frameRate]);

  useEffect(() => {
    probe.current?.configure({ frameRate, reducedMotion });
  }, [frameRate, reducedMotion]);

  useEffect(() => {
    if (!window.__YTL_PROBE__) return;
    const created = createFrameProbe(() => performance.now());
    created.configure({ frameRate, reducedMotion });
    probe.current = created;
    window.__ytlRobotProbe = { start: created.start, stop: created.stop, isRecording: created.isRecording };
    return () => {
      probe.current = null;
      delete window.__ytlRobotProbe;
    };
    // The settings are kept current by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Hidden tab: stop the loop and stop the clock, so nothing runs and nothing is skipped.
    const onVisibility = () => {
      if (document.hidden) {
        clock.current?.pause(performance.now());
        cancelAnimationFrame(raf.current);
        raf.current = 0;
      } else {
        clock.current?.resume(performance.now());
        wake();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  return (
    <div ref={root} className={styles.robot} aria-hidden="true" data-testid="tutor-robot">
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} width="100%" height="100%" focusable="false">
        <defs>
          <linearGradient id="ytl-robot-shell" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#eef1f6" />
            <stop offset="1" stopColor="#c3cad6" />
          </linearGradient>
          <linearGradient id="ytl-robot-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#15171c" />
            <stop offset="1" stopColor="#030304" />
          </linearGradient>
          <radialGradient id="ytl-robot-eye" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#b9f3ff" />
            <stop offset="0.55" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#1d6fe0" />
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="158" rx="22" ry="4" fill="#000000" opacity="0.35" />
        <g ref={body}>
          <g ref={armLeft}>
            <path d="M31 76c5 0 8 4 7.4 10l-3 30c-.5 5-3 8-6.4 8s-5.6-3-5.4-8l1.4-30c.3-6 2.2-10 6-10z" fill="url(#ytl-robot-shell)" stroke="#aab2c0" strokeWidth="0.8" />
          </g>
          <g ref={armRight}>
            <path d="M89 76c-5 0-8 4-7.4 10l3 30c.5 5 3 8 6.4 8s5.6-3 5.4-8l-1.4-30c-.3-6-2.2-10-6-10z" fill="url(#ytl-robot-shell)" stroke="#aab2c0" strokeWidth="0.8" />
          </g>
          <path d="M60 68c21 0 31 13 29 34-2.200 25-15 48-29 48s-26.800-23-29-48c-2-21 8-34 29-34z" fill="url(#ytl-robot-shell)" stroke="#aab2c0" strokeWidth="0.8" />
          <path d="M44 78c-6 6-8 16-6 28" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.85" />
          <circle cx="60" cy="92" r="3.200" fill="#22d3ee" opacity="0.9" />
          <g ref={head}>
            <ellipse cx="60" cy="36" rx="35" ry="27" fill="url(#ytl-robot-shell)" stroke="#aab2c0" strokeWidth="0.8" />
            <path d="M34 24c5-8 14-12 24-12.500" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
            <rect x="35" y="25" width="50" height="30" rx="15" fill="url(#ytl-robot-face)" />
            <path d="M42 31c4-3 12-4.500 20-4.500" fill="none" stroke="#ffffff" strokeWidth="1.600" strokeLinecap="round" opacity="0.18" />
            <g ref={eyes}>
              <ellipse cx="49" cy={EYE_Y} rx="5.500" ry="6.500" fill="url(#ytl-robot-eye)" transform={`rotate(-8 49 ${EYE_Y})`} />
              <ellipse cx="71" cy={EYE_Y} rx="5.500" ry="6.500" fill="url(#ytl-robot-eye)" transform={`rotate(8 71 ${EYE_Y})`} />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
