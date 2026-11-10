"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { pcTarget, type Localized, type PCDiagnostic, type StartupResult } from "@ytl/contracts";
import { hintLadder } from "@/lib/interaction";
import { CheckIcon, CrossIcon, InfoIcon, WarningIcon } from "../icons";
import { pcStore, usePC } from "./pc-client";
import { TargetBox } from "./TargetBox";

type Locale = "en" | "ar";

function DiagnosticItem({ diagnostic }: { diagnostic: PCDiagnostic }) {
  const t = useTranslations("pcLab.diagnostics");
  const locale = useLocale() as Locale;
  return (
    <li className="diagnostic" data-severity={diagnostic.severity === "blocking" ? "error" : diagnostic.severity}>
      <span className="diagnostic-severity">{t(`severity.${diagnostic.severity}`)}</span>
      <span>{diagnostic.message[locale]}</span>
      <details className="pc-details">
        <summary>{t("explain")}</summary>
        <p>{diagnostic.explanation[locale]}</p>
      </details>
    </li>
  );
}

/**
 * A red X's fault, revealed one hint at a time: first what can be observed, then what is wrong and
 * where (with "Show me where"), then the rule behind it. Every sentence is the engine's own.
 */
function FaultHint({ diagnostic, symptom }: { diagnostic: PCDiagnostic; symptom: Localized }) {
  const t = useTranslations("pcLab.faultHint");
  const locale = useLocale() as Locale;
  const [level, setLevel] = useState(0);
  const levels = [diagnostic.observation ?? symptom, diagnostic.message, diagnostic.explanation];
  return (
    <li className="diagnostic" data-severity="error">
      {level === 0 ? (
        <p>{t("prompt")}</p>
      ) : (
        <ol className="pc-hint-levels">
          {levels.slice(0, level).map((text, index) => (
            <li key={index}>
              <span className="state-meta">{t("level", { level: index + 1, total: 3 })}</span> {text[locale]}
            </li>
          ))}
        </ol>
      )}
      <div className="button-row">
        {level < 3 && (
          <button type="button" className="button button-small" onClick={() => setLevel(level + 1)}>
            {level === 0 ? t("first") : t("next")}
          </button>
        )}
        {level >= 2 && (
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              const ladder = hintLadder.getState();
              ladder.setPanelOpen(true);
              ladder.requestPoint(diagnostic.target);
            }}
          >
            {t("showWhere")}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The switches outside the build (side panel, mains, power supply switch, power button), what
 * the engine's startup model says happens, and what the engine still finds wrong. Everything
 * shown comes from `evaluateStartup` and `diagnoseBuild`; nothing is decided here.
 */
export function PowerPanel({
  startup,
  diagnostics,
  onPress,
  announce,
}: {
  startup: StartupResult;
  diagnostics: readonly PCDiagnostic[];
  /** Called when the power button press was accepted, so the run gets its own ID. */
  onPress: () => void;
  announce: (text: string) => void;
}) {
  const t = useTranslations("pcLab");
  const locale = useLocale() as Locale;
  const present = usePC((state) => state.history?.present);
  if (!present) return null;
  const act = pcStore.getState().act;
  const { power } = present;
  const lighting = startup.observable.lighting;

  return (
    <section aria-labelledby="power-heading" className="studio-output pc-power">
      <h3 id="power-heading" className="subheading">
        {t("power.heading")}
      </h3>

      <TargetBox target={pcTarget.setting("side-panel")}>
        <label className="settings-option">
          <input
            type="checkbox"
            checked={present.sidePanelOpen}
            onChange={(event) => {
              if (act({ type: "set_side_panel", open: event.target.checked })?.ok) announce(t("build.done.panel"));
            }}
          />
          <span>{t("power.sidePanel")}</span>
        </label>
      </TargetBox>
      <TargetBox target={pcTarget.setting("wall-power")}>
        <label className="settings-option">
          <input type="checkbox" checked={power.wallConnected} onChange={(event) => act({ type: "set_wall_power", connected: event.target.checked })} />
          <span>{t("power.wall")}</span>
        </label>
      </TargetBox>
      <TargetBox target={pcTarget.setting("psu-switch")}>
        <label className="settings-option">
          <input type="checkbox" checked={power.psuSwitchOn} onChange={(event) => act({ type: "set_psu_switch", on: event.target.checked })} />
          <span>{t("power.psuSwitch")}</span>
        </label>
      </TargetBox>

      <TargetBox target={pcTarget.setting("power-button")} className="button-row">
        <button
          type="button"
          className="button button-primary"
          disabled={power.pressed}
          onClick={() => {
            if (act({ type: "press_power" })?.ok) onPress();
          }}
        >
          {t("power.press")}
        </button>
        <button type="button" className="button" disabled={!power.pressed} onClick={() => act({ type: "power_off" })}>
          {t("power.off")}
        </button>
      </TargetBox>

      {/* The outcome is read out when it changes; the stage list below is there to be explored. */}
      <div role="status" className="pc-outcome">
        <p className="state-meta">{power.pressed ? t("power.pressed") : t("power.notPressed")}</p>
        <p className={`notice${startup.outcome === "operational" ? " notice-success" : ""}`}>
          {startup.outcome === "operational" ? <CheckIcon /> : startup.outcome === "idle" ? <InfoIcon /> : <WarningIcon />}
          <span>
            {t("power.outcomeLabel")}: <strong>{t(`power.outcome.${startup.outcome}`)}</strong>
          </span>
        </p>
      </div>

      <h4 id="stages-heading" className="output-label">
        {t("power.stagesLabel")}
      </h4>
      <ol className="pc-stage-list" aria-labelledby="stages-heading">
        {startup.stages.map((stage) => (
          <li key={stage.stage} className="pc-stage" data-status={stage.status}>
            <p>
              {/* Green check or red X, always with the word, so colour is never the only signal. */}
              {stage.status === "passed" && (
                <span className="pc-stage-mark pc-stage-pass">
                  <CheckIcon />
                </span>
              )}
              {stage.status === "failed" && (
                <span className="pc-stage-mark pc-stage-fail">
                  <CrossIcon />
                </span>
              )}
              <strong>{t(`power.stage.${stage.stage}`)}</strong>: {t(`power.status.${stage.status}`)}
            </p>
            <p className="state-meta">{stage.observation[locale]}</p>
            {stage.diagnostics.length > 0 && (
              <ul className="diagnostic-list">
                {stage.diagnostics.map((diagnostic) => (
                  <FaultHint key={diagnostic.id} diagnostic={diagnostic} symptom={stage.observation} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {power.pressed && (
        <ul className="pc-facts">
          <li>{t("power.spinning", { count: startup.observable.spinning.length })}</li>
          {lighting.length > 0 && <li>{t("power.lit", { lit: lighting.filter((item) => item.lit).length, total: lighting.length })}</li>}
          {startup.loadModel.psuRatedW !== null && (
            <li>{t("power.loadModel", { draw: Math.round(startup.loadModel.estimatedDrawW), rated: startup.loadModel.psuRatedW })}</li>
          )}
        </ul>
      )}

      <h4 id="diagnostics-heading" className="output-label">
        {t("diagnostics.heading")}
      </h4>
      {diagnostics.length === 0 ? (
        <p className="lab-status-empty">{t("diagnostics.none")}</p>
      ) : (
        <ul className="diagnostic-list" aria-labelledby="diagnostics-heading">
          {diagnostics.map((diagnostic) => (
            <DiagnosticItem key={diagnostic.id} diagnostic={diagnostic} />
          ))}
        </ul>
      )}

      <p className="notice">
        <InfoIcon />
        <span>{startup.disclaimer[locale]}</span>
      </p>
    </section>
  );
}
