"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useStore } from "zustand";
import type { TargetResolution, TutorTargetRef } from "@ytl/contracts";
import { QUESTION_MAX, tutor } from "@/lib/interaction/advisor";
import { connectAiAdvisor, createFetchTransport } from "@/lib/interaction/ai-advisor";
import { activeTopic, currentTarget, hintLadder, type HintText } from "@/lib/interaction/hint-ladder";
import { collectContentRects, isAreaFree } from "@/lib/interaction/obstacles";
import { overlapArea, placeHome, placeRobot, relevantObstacles, type Direction } from "@/lib/interaction/placement";
import { usePreferences, useReducedMotion } from "@/lib/interaction/preferences";
import { PRESENCE_MS } from "@/lib/interaction/robot-motion";
import { topicForPath } from "@/lib/interaction/shell-hints";
import { getTargetRegistry } from "@/lib/targets/dom";
import { Robot, type RobotHandle } from "./Robot";
import styles from "./tutor.module.css";

const RING_PADDING = 5;

/** A dock at least this share of the viewport width hides content below it (phones). */
const WIDE_DOCK = 0.6;
/** Empty space kept between the last page content and the Help button at the end of the scroll. */
const LAUNCHER_CLEARANCE = 8;
/** Below this viewport width the page fills the screen and the idle robot rests inside the Help button. */
const NARROW_VIEWPORT = 600;

/**
 * What the robot was last sent to: its offset from the thing it stands next to. An unchanged
 * offset means the page scrolled under it, so it follows; a changed one means it slides.
 */
type Goal = { kind: "home" | "point"; id: string | null; dx: number; dy: number; scale: number };

/**
 * The tutor: help button, text help panel with the three-level hint ladder, the robot and
 * the marker it draws around a target. Mount once in the root layout, inside NextIntlClientProvider.
 */
export interface TutorRootProps {
  /**
   * True when the server has an AI provider configured (decided on the server, from its own
   * settings). Only then does the tutor ask its API for the AI status; otherwise no request is
   * made and the panel says that the AI assistant is not configured.
   */
  aiConfigured?: boolean;
}

export function TutorRoot({ aiConfigured = false }: TutorRootProps) {
  const t = useTranslations("tutor");
  const locale = useLocale() as "en" | "ar";
  const pathname = usePathname();
  const panelId = useId();
  const { preferences, ready, error, update } = usePreferences();
  const reducedMotion = useReducedMotion();

  const ladder = useStore(hintLadder);
  const topic = activeTopic(ladder);
  const target = currentTarget(ladder);
  const { level, pointing, notice, panelOpen, pageTopics, topicIndex } = ladder;
  const ai = useStore(tutor.status, (state) => state.ai);
  const question = useStore(tutor.status, (state) => state.question);
  const askId = useId();

  const dock = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const perch = useRef<HTMLSpanElement>(null);
  const robot = useRef<RobotHandle>(null);
  const resolution = useRef<TargetResolution | null>(null);
  const goal = useRef<Goal | null>(null);
  const pointingId = useRef<string | null>(null);
  const panelIsOpen = useRef(false);
  /** Target just revealed on request; checked once it is visible, in case it landed under the panel. */
  const settling = useRef<string | null>(null);
  /** Pixels at the bottom of the viewport hidden by a wide open panel (0 otherwise). */
  const reserved = useRef(0);
  /** Current height of the end-of-page spacer. */
  const clearance = useRef(-1);

  const showRobot = ready && preferences.robotVisible;
  const reducedNow = useRef(reducedMotion);
  reducedNow.current = reducedMotion;
  const [robotMounted, setRobotMounted] = useState(false);
  // Only the status word is React state; rectangles go straight to the DOM.
  const [pointStatus, setPointStatus] = useState<"visible" | "offscreen" | null>(null);

  const text = (value: HintText) => ("key" in value ? t(value.key, value.values) : value[locale]);
  /** The latest renderer and language, for the AI advisor, which outlives a render. */
  const wording = useRef({ locale, render: text });
  wording.current = { locale, render: text };

  useEffect(() => {
    if (!aiConfigured) return;
    void connectAiAdvisor(tutor, createFetchTransport(), { locale: () => wording.current.locale, render: (value) => wording.current.render(value) });
  }, [aiConfigured]);

  /**
   * Puts the marker and the robot where they belong right now. Reads layout, sets no React state.
   * `slide` is for changes the learner caused (the panel opened); otherwise an unchanged goal is followed.
   */
  const layout = useCallback((options?: { slide?: boolean }) => {
    const dockElement = dock.current;
    if (!dockElement) return;
    const current = resolution.current;
    const aim = pointingId.current && current?.status === "visible" ? current.rect : null;

    const marker = ring.current;
    if (marker) {
      if (aim) {
        marker.style.display = "block";
        marker.style.transform = `translate3d(${aim.x - RING_PADDING}px, ${aim.y - RING_PADDING}px, 0)`;
        marker.style.width = `${aim.width + RING_PADDING * 2}px`;
        marker.style.height = `${aim.height + RING_PADDING * 2}px`;
      } else {
        marker.style.display = "none";
      }
    }

    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const direction: Direction = document.documentElement.dir === "rtl" ? "rtl" : "ltr";
    const box = dockElement.getBoundingClientRect();
    const dockRect = { x: box.x, y: box.y, width: box.width, height: box.height };

    // A wide open panel hides the lower part of the page. Give the page room to scroll its content
    // out from under it, and tell the browser that area is covered (for reveal and for keyboard focus).
    const hiddenBelow = panelIsOpen.current && dockRect.width >= viewport.width * WIDE_DOCK ? Math.max(0, Math.round(viewport.height - dockRect.y)) : 0;
    if (hiddenBelow !== reserved.current) {
      reserved.current = hiddenBelow;
      if (hiddenBelow > 0) document.documentElement.style.scrollPaddingBottom = `${hiddenBelow}px`;
      else document.documentElement.style.removeProperty("scroll-padding-bottom");
    }
    // The Help button is fixed over the page. The spacer at the end of the page is always at least
    // as tall as the strip the button occupies, so at the end of the scroll nothing is left under it.
    const launcherTop = launcher.current?.getBoundingClientRect().top ?? dockRect.y;
    const needed = Math.max(hiddenBelow, Math.ceil(viewport.height - launcherTop) + LAUNCHER_CLEARANCE);
    if (needed !== clearance.current && spacer.current) {
      clearance.current = needed;
      spacer.current.style.height = `${needed}px`;
    }

    const character = robot.current;
    const slotElement = perch.current;
    if (!character || !slotElement) {
      slotElement?.setAttribute("data-occupied", "false");
      return;
    }
    const size = character.size();
    const own = [dockElement, ring.current, spacer.current];

    let position: { x: number; y: number };
    let scale = 1;
    const anchor = aim ?? dockRect;
    if (aim) {
      const id = pointingId.current ?? undefined;
      const content = collectContentRects(own);
      const obstacles = relevantObstacles([...getTargetRegistry().rectsInView(id), ...content], aim, viewport);
      const placed = placeRobot({ target: aim, viewport, robot: size, direction, obstacles: [...obstacles, dockRect] });
      position = placed;
      scale = placed.scale;
      marker?.setAttribute("data-robot-rule", placed.rule);
      slotElement.setAttribute("data-occupied", "false");
    } else {
      const slotBox = slotElement.getBoundingClientRect();
      const others = getTargetRegistry().rectsInView();
      const home = placeHome({
        dock: dockRect,
        slot: { x: slotBox.x, y: slotBox.y, width: slotBox.width, height: slotBox.height },
        viewport,
        robot: size,
        direction,
        narrow: viewport.width < NARROW_VIEWPORT,
        isFree: (rect) => others.every((other) => overlapArea(rect, other) === 0) && isAreaFree(rect, own),
      });
      position = home;
      scale = home.scale;
      dockElement.setAttribute("data-robot-home", home.rule);
      slotElement.setAttribute("data-occupied", String(home.rule === "in-launcher"));
    }
    const next: Goal = { kind: aim ? "point" : "home", id: aim ? pointingId.current : null, dx: position.x - anchor.x, dy: position.y - anchor.y, scale };
    const previous = goal.current;
    const follow =
      !options?.slide &&
      previous !== null &&
      previous.kind === next.kind &&
      previous.id === next.id &&
      previous.scale === next.scale &&
      Math.abs(previous.dx - next.dx) < 0.75 &&
      Math.abs(previous.dy - next.dy) < 0.75;
    goal.current = next;
    character.goTo(position, { aim: aim ?? undefined, follow, scale });
  }, []);

  useEffect(() => {
    hintLadder.getState().setFallbackTopic(topicForPath(pathname));
  }, [pathname]);

  // Hide and return: the robot fades out before it is removed.
  useEffect(() => {
    if (showRobot) {
      setRobotMounted(true);
      return;
    }
    robot.current?.leave();
    const timer = window.setTimeout(() => setRobotMounted(false), reducedMotion ? 0 : PRESENCE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [showRobot, reducedMotion]);

  useEffect(() => {
    if (!robotMounted) goal.current = null;
    layout();
  }, [robotMounted, layout]);

  // Scroll, resize, layout and direction changes arrive through the registry, at most once per frame.
  useEffect(() => {
    const registry = getTargetRegistry();
    const stopLayout = registry.subscribeLayout(() => layout());
    const observer = new ResizeObserver(() => layout({ slide: true }));
    if (dock.current) observer.observe(dock.current);
    return () => {
      stopLayout();
      observer.disconnect();
    };
  }, [layout]);

  // While pointing, follow the target. A target that goes away ends the pointing.
  useEffect(() => {
    pointingId.current = pointing?.id ?? null;
    if (!pointing) {
      resolution.current = null;
      setPointStatus(null);
      layout();
      return;
    }
    return getTargetRegistry().subscribe(pointing.id, (next) => {
      resolution.current = next;
      if (next.status === "unknown" || next.status === "hidden") {
        hintLadder.getState().stopPointing("unavailable");
        return;
      }
      setPointStatus(next.status);
      // A reveal centres the target in the window, which can be exactly where the panel sits.
      // Once the scroll has had time to finish, for the reveal the learner asked for: if the
      // target is under the panel, move it to the top of the window instead.
      if (next.status === "visible" && settling.current === pointing.id) {
        settling.current = null;
        const id = pointing.id;
        window.setTimeout(
          () => {
            const registry = getTargetRegistry();
            const now = registry.resolve(id);
            const box = dock.current?.getBoundingClientRect();
            if (pointingId.current !== id || now.status !== "visible" || !box) return;
            if (overlapArea(now.rect, { x: box.x, y: box.y, width: box.width, height: box.height }) > 0) {
              registry.reveal(id, { reducedMotion: reducedNow.current, block: "start" });
            }
          },
          reducedNow.current ? 0 : 700,
        );
      }
      layout();
    });
  }, [pointing, layout]);

  useEffect(() => {
    if (level > 0) robot.current?.explain();
  }, [level]);

  useEffect(() => {
    panelIsOpen.current = panelOpen;
    layout({ slide: true });
  }, [panelOpen, layout]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("scroll-padding-bottom");
    },
    [],
  );

  const setOpen = (open: boolean) => {
    const state = hintLadder.getState();
    // The marker and the pointing arm never stay on screen without their text.
    if (!open) state.stopPointing();
    state.setPanelOpen(open);
  };

  /** Points at a target the way "Show me where" does: checked first, scrolled into a clear place if needed. */
  const showTarget = (ref: TutorTargetRef) => {
    const registry = getTargetRegistry();
    const result = hintLadder.getState().pointAt(ref, registry.checkGuidance);
    if (!result.ok || !("rect" in result.resolution)) return;
    const box = dock.current?.getBoundingClientRect();
    const covered = box ? overlapArea(result.resolution.rect, { x: box.x, y: box.y, width: box.width, height: box.height }) > 0 : false;
    settling.current = result.resolution.status === "offscreen" ? ref.id : null;
    if (result.resolution.status === "offscreen" || covered) {
      // Under a wide panel the browser centres the target in the part of the page left uncovered
      // (scroll padding). Beside a corner panel, the top of the viewport is the clear place.
      registry.reveal(ref.id, { reducedMotion, block: reserved.current > 0 || !covered ? "center" : "start" });
    }
  };
  const showMe = () => {
    if (target) showTarget(target);
  };
  const showAnswerTarget = () => {
    if (question.status === "answered" && question.answer.target) showTarget(question.answer.target);
  };
  const showTargetRef = useRef(showTarget);
  showTargetRef.current = showTarget;
  // "Show me where" from outside the panel (a lesson hint) points the same way.
  useEffect(() => {
    if (ladder.pointRequest) showTargetRef.current(ladder.pointRequest.target);
  }, [ladder.pointRequest]);

  const noticeText =
    notice === "stale"
      ? t("point.stale")
      : notice === "unavailable"
        ? t("point.unavailable")
        : pointing && pointStatus === "offscreen"
          ? t("point.offscreen")
          : pointing && pointStatus === "visible"
            ? t("point.pointing")
            : null;
  const canShow = target !== null && (!pointing || pointStatus === "offscreen");

  return (
    <>
      <div ref={ring} className={styles.ring} data-reduced={reducedMotion} aria-hidden="true" data-testid="tutor-ring" />
      {robotMounted ? <Robot ref={robot} reducedMotion={reducedMotion} frameRate={preferences.robotFrameRate} /> : null}
      <div ref={spacer} className={styles.spacer} aria-hidden="true" data-testid="tutor-spacer" />
      <aside ref={dock} className={styles.dock} aria-label={t("panel.title")}>
        {panelOpen ? (
          <div
            id={panelId}
            className={styles.panel}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setOpen(false);
              launcher.current?.focus();
            }}
          >
            <div className={styles.header}>
              <h2 className={styles.title}>{t("panel.title")}</h2>
              <button type="button" className={styles.quiet} onClick={() => setOpen(false)}>
                {t("panel.close")}
              </button>
            </div>

            {/* The help itself. Always text, announced politely; the robot only accompanies it. */}
            <div className={styles.help} aria-live="polite">
              {topic ? (
                <>
                  {pageTopics.length > 1 ? (
                    <p className={styles.small}>{t("panel.problem", { current: topicIndex + 1, total: pageTopics.length })}</p>
                  ) : null}
                  {topic.title ? <p className={styles.topic}>{text(topic.title)}</p> : null}
                  {level === 0 ? <p className={styles.soft}>{t("panel.intro")}</p> : null}
                  <ol className={styles.levels}>
                    {topic.levels.slice(0, level).map((content, index) => (
                      <li key={index} className={styles.level}>
                        <span className={styles.levelLabel}>{t(`ladder.label${index + 1}`)}</span>
                        {text(content.text)}
                        {content.evidence ? (
                          <code className={styles.evidence} dir="ltr" lang="en">
                            {content.evidence}
                          </code>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className={styles.soft}>{t("panel.noTopic")}</p>
              )}
              {noticeText ? (
                <p className={`${styles.notice} ${pointing && pointStatus === "visible" ? styles.noticeOk : ""}`}>{noticeText}</p>
              ) : null}
            </div>

            {pageTopics.length > 1 ? (
              <div className={styles.actions}>
                <button type="button" className={styles.quiet} disabled={topicIndex === 0} onClick={() => hintLadder.getState().selectTopic(topicIndex - 1)}>
                  {t("panel.previous")}
                </button>
                <button
                  type="button"
                  className={styles.quiet}
                  disabled={topicIndex >= pageTopics.length - 1}
                  onClick={() => hintLadder.getState().selectTopic(topicIndex + 1)}
                >
                  {t("panel.next")}
                </button>
              </div>
            ) : null}

            {topic ? (
              <div className={styles.actions}>
                {level < 3 && level >= ladder.levelCap ? <p className={styles.small}>{t("ladder.locked")}</p> : null}
                {level < 3 && level < ladder.levelCap ? (
                  <button type="button" className={styles.primary} onClick={() => hintLadder.getState().requestNextLevel()}>
                    {t(`ladder.ask${level + 1}`)}
                  </button>
                ) : null}
                {canShow ? (
                  <button type="button" className={styles.button} onClick={showMe}>
                    {t("point.show")}
                  </button>
                ) : null}
                {pointing ? (
                  <button type="button" className={styles.button} onClick={() => hintLadder.getState().stopPointing()}>
                    {t("point.stop")}
                  </button>
                ) : null}
                {level > 0 ? (
                  <button type="button" className={styles.quiet} onClick={() => hintLadder.getState().resetLadder()}>
                    {t("ladder.reset")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Shown only when a provider is really configured and reachable. Nothing here imitates an AI. */}
            {ai === "available" ? (
              <div className={styles.ask}>
                <form
                  className={styles.askForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const field = event.currentTarget.elements.namedItem("question") as HTMLInputElement | null;
                    if (!field || field.value.trim() === "") return;
                    void tutor.ask(field.value);
                    field.value = "";
                  }}
                >
                  <label htmlFor={askId} className={styles.levelLabel}>
                    {t("ask.label")}
                  </label>
                  <div className={styles.askRow}>
                    <input id={askId} name="question" type="text" className={styles.askInput} maxLength={QUESTION_MAX} placeholder={t("ask.placeholder")} autoComplete="off" />
                    <button type="submit" className={styles.button} disabled={question.status === "thinking"}>
                      {t("ask.send")}
                    </button>
                  </div>
                </form>
                <div aria-live="polite" className={styles.help}>
                  {question.status !== "idle" ? (
                    <p className={styles.small}>
                      {t("ask.youAsked")} <bdi>{question.question}</bdi>
                    </p>
                  ) : null}
                  {question.status === "thinking" ? <p className={styles.soft}>{t("ask.thinking")}</p> : null}
                  {question.status === "answered" ? (
                    <div className={styles.level}>
                      <span className={styles.levelLabel}>{t("ask.answerLabel")}</span>
                      <p className={styles.answer}>{question.answer.text}</p>
                      {question.answer.confidence !== "certain" ? <p className={styles.small}>{t("ask.possible")}</p> : null}
                      <p className={styles.small}>{t("ask.caution")}</p>
                    </div>
                  ) : null}
                  {question.status === "error" ? <p className={styles.notice}>{t(question.reason === "busy" ? "ask.busy" : "ask.error")}</p> : null}
                  {question.status === "discarded" ? <p className={styles.notice}>{t("ask.discarded")}</p> : null}
                </div>
                {question.status === "answered" || question.status === "error" || question.status === "discarded" ? (
                  <div className={styles.actions}>
                    {question.status === "answered" && question.answer.target ? (
                      <button type="button" className={styles.button} onClick={showAnswerTarget}>
                        {t("ask.showTarget")}
                      </button>
                    ) : null}
                    <button type="button" className={styles.quiet} onClick={() => tutor.clearQuestion()}>
                      {t("ask.clear")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className={styles.footer}>
              {ready ? (
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => void update({ robotVisible: !preferences.robotVisible })}>
                    {preferences.robotVisible ? t("robot.hide") : t("robot.show")}
                  </button>
                </div>
              ) : null}
              {ready && !preferences.robotVisible ? <p className={styles.small}>{t("robot.hiddenNote")}</p> : null}
              {error ? (
                <p className={styles.small} role="status">
                  {t("robot.notSaved")}
                </p>
              ) : null}
              {ai === "not_configured" ? <p className={styles.small}>{t("aiUnavailable")}</p> : null}
              {ai === "error" ? <p className={styles.small}>{t("aiError")}</p> : null}
            </div>
          </div>
        ) : null}
        <button
          ref={launcher}
          type="button"
          className={styles.launcher}
          aria-expanded={panelOpen}
          aria-controls={panelOpen ? panelId : undefined}
          onClick={() => setOpen(!panelOpen)}
        >
          <span ref={perch} className={styles.perch}>
            <svg className={styles.launcherIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <ellipse cx="12" cy="12" rx="11" ry="9" fill="#f1f3f7" />
            <rect x="4" y="7.500" width="16" height="9" rx="4.500" fill="#050506" />
            <ellipse cx="8.500" cy="12" rx="1.700" ry="2.100" fill="#38bdf8" />
            <ellipse cx="15.500" cy="12" rx="1.700" ry="2.100" fill="#38bdf8" />
            </svg>
          </span>
          {panelOpen ? t("launcher.close") : t("launcher.open")}
        </button>
      </aside>
    </>
  );
}
