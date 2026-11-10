"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConnectivityResult, NetworkDiagnostic, NetworkResolvedInterface, NetworkState } from "@ytl/contracts";
import { network } from "@ytl/simulation";
import { useReducedMotion } from "@/lib/interaction";
import { PLAYBACK_SPEEDS, createPlaybackState, playbackReducer, renderPlaybackAnnouncement, viewOf, type PlaybackEvent, type PlaybackState } from "@/lib/interaction/playback";
import { CheckIcon, InfoIcon, WarningIcon } from "../icons";
import { highlightStore } from "./highlight";

type Locale = "en" | "ar";

export interface TestRun {
  id: string;
  result: ConnectivityResult;
  /** The network exactly as it was when the test ran. */
  state: NetworkState;
}

function Diagnostic({ diagnostic }: { diagnostic: NetworkDiagnostic }) {
  const t = useTranslations("netLab.diagnostics");
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

/** Plays the journey the engine returned: exactly its events, in its order, ending where it ended. */
function Journey({ run }: { run: TestRun }) {
  const t = useTranslations("netLab.test");
  const tp = useTranslations("tutor.playback");
  const locale = useLocale() as Locale;
  const reducedMotion = useReducedMotion();
  const [playback, setPlayback] = useState<PlaybackState>(() => createPlaybackState(run.result.journey, { reducedMotion }));
  const current = useRef(playback);

  function send(event: PlaybackEvent) {
    current.current = playbackReducer(current.current, event);
    setPlayback(current.current);
  }

  useEffect(() => {
    send({ type: "set-reduced-motion", reduced: reducedMotion });
    // `send` only touches the ref and the setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const view = viewOf(playback);

  // Time enters only here, and only while the controller says it is playing.
  useEffect(() => {
    if (!view.needsTicks) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      send({ type: "tick", elapsedMs: now - last });
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.needsTicks]);

  // The device, port or cable of the current step is marked in the lists beside this panel.
  const targetId = view.target?.id ?? null;
  useEffect(() => {
    highlightStore.setState({ id: targetId });
    return () => highlightStore.setState({ id: null });
  }, [targetId]);

  const { events } = run.result.journey;
  const announcement = playback.announcement ? renderPlaybackAnnouncement(playback.announcement, locale, (key, values) => tp(`announce.${key}`, values)) : "";
  const assertive = playback.announcement?.politeness === "assertive";

  return (
    <div className="net-journey">
      <h4 id="journey-heading" className="output-label">
        {t("journey")}
      </h4>
      {events.length === 0 ? (
        <p className="lab-status-empty">{t("noEvents")}</p>
      ) : (
        <>
          <div className="button-row">
            {view.canPause ? (
              <button type="button" className="button button-small button-primary" onClick={() => send({ type: "pause" })}>
                {tp("controls.pause")}
              </button>
            ) : (
              <button type="button" className="button button-small button-primary" disabled={!view.canPlay || !view.canStepForward} onClick={() => send({ type: "play" })}>
                {tp("controls.play")}
              </button>
            )}
            <button type="button" className="button button-small" disabled={!view.canStepBack} onClick={() => send({ type: "step-back" })}>
              {tp("controls.stepBack")}
            </button>
            <button type="button" className="button button-small" disabled={!view.canStepForward} onClick={() => send({ type: "step-forward" })}>
              {tp("controls.stepForward")}
            </button>
            <button type="button" className="button button-small" disabled={!view.canRestart} onClick={() => send({ type: "restart" })}>
              {tp("controls.restart")}
            </button>
          </div>
          <div className="field">
            <label htmlFor="playback-speed">{tp("controls.speed")}</label>
            <select id="playback-speed" className="input" value={playback.speed} onChange={(event) => send({ type: "set-speed", speed: Number(event.target.value) as (typeof PLAYBACK_SPEEDS)[number] })}>
              {PLAYBACK_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {tp("controls.speedValue", { speed })}
                </option>
              ))}
            </select>
          </div>
          <p className="state-meta">{view.position > 0 ? tp("controls.position", { current: view.position, total: view.total }) : tp("controls.ready")}</p>

          <ol className="pc-stage-list" aria-labelledby="journey-heading">
            {events.map((event, index) => {
              const reached = index < view.position;
              return (
                <li
                  key={event.id}
                  className="pc-stage net-step"
                  data-status={!reached ? undefined : event.result === "ok" ? "passed" : event.result === "failed" ? "failed" : undefined}
                  data-reached={reached}
                  aria-current={index === view.position - 1 ? "step" : undefined}
                >
                  <p>
                    {reached && (event.result === "ok" ? <CheckIcon /> : event.result === "failed" ? <WarningIcon /> : <InfoIcon />)} {event.message[locale]}
                  </p>
                  {event.reason && reached && (
                    <p className="state-meta">
                      {t("why")}: {event.reason[locale]}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {view.outcome && view.summary && (
            <p className={`notice${view.outcome === "delivered" ? " notice-success" : ""}`}>
              {view.outcome === "delivered" ? <CheckIcon /> : <WarningIcon />}
              <span>
                <strong>{tp(`outcome.${view.outcome}`)}.</strong> {view.summary[locale]}
              </span>
            </p>
          )}
        </>
      )}
      <p className="visually-hidden" aria-live="polite">
        {assertive ? "" : announcement}
      </p>
      <p className="visually-hidden" aria-live="assertive">
        {assertive ? announcement : ""}
      </p>
    </div>
  );
}

/**
 * A virtual ping or name lookup from one of the network's devices, the journey it took, why it
 * failed when it did, what the engine finds wrong with the network as it stands, and the address
 * every interface has. All of it is the engine's output; nothing is sent anywhere real.
 */
export function TestPanel({
  net,
  run,
  onRun,
  diagnostics,
  interfaces,
}: {
  net: NetworkState;
  run: TestRun | null;
  onRun: (request: ConnectivityResult["request"]) => void;
  diagnostics: readonly NetworkDiagnostic[];
  interfaces: readonly NetworkResolvedInterface[];
}) {
  const t = useTranslations("netLab");
  const locale = useLocale() as Locale;
  const senders = net.devices.filter((device) => device.roles.includes("client"));
  const [fromId, setFromId] = useState("");
  const [kind, setKind] = useState<"ping" | "lookup">("ping");
  const [to, setTo] = useState("school.test");
  const from = senders.find((device) => device.id === fromId) ?? senders[0];
  // Names and addresses that exist in this simulation, offered as suggestions.
  const isp = net.devices.find((device) => device.config.isp)?.config.isp;
  const suggestions = [...(isp ? [...isp.dnsRecords.map((record) => record.name), ...isp.hosts, isp.dnsAddress] : []), ...interfaces.flatMap((item) => (item.address ? [item.address] : []))];
  const nameOf = (deviceId: string) => net.devices.find((device) => device.id === deviceId)?.name[locale] ?? deviceId;
  const stale = run !== null && run.state !== net;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!from || to.trim() === "") return;
    onRun(kind === "ping" ? { kind: "ping", fromDeviceId: from.id, to: to.trim() } : { kind: "lookup", fromDeviceId: from.id, name: to.trim() });
  }

  return (
    <section aria-labelledby="test-heading" className="studio-output net-test">
      <h3 id="test-heading" className="subheading">
        {t("test.heading")}
      </h3>
      {senders.length === 0 ? (
        <p className="lab-status-empty">{t("test.noClients")}</p>
      ) : (
        <form onSubmit={submit} className="studio-form">
          <div className="field">
            <label htmlFor="test-from">{t("test.from")}</label>
            <select id="test-from" className="input" value={from?.id ?? ""} onChange={(event) => setFromId(event.target.value)}>
              {senders.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name[locale]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="test-kind">{t("test.kind")}</label>
            <select id="test-kind" className="input" value={kind} onChange={(event) => setKind(event.target.value as "ping" | "lookup")}>
              <option value="ping">{t("test.ping")}</option>
              <option value="lookup">{t("test.lookup")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="test-to">{kind === "ping" ? t("test.to") : t("test.name")}</label>
            <input id="test-to" className="input code-name" dir="ltr" autoComplete="off" spellCheck={false} list="test-suggestions" value={to} onChange={(event) => setTo(event.target.value)} />
            <datalist id="test-suggestions">
              {[...new Set(suggestions)].map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
          <div className="button-row">
            <button type="submit" className="button button-primary">
              {t("test.run")}
            </button>
          </div>
        </form>
      )}

      {run && (
        <>
          <div role="status">
            <p className={`notice${run.result.succeeded ? " notice-success" : ""}`}>
              {run.result.succeeded ? <CheckIcon /> : <WarningIcon />}
              <span>
                <strong>{t("test.result")}:</strong> {run.result.succeeded ? t("test.succeeded") : t("test.failed")}{" "}
                {run.result.resolvedAddress && t("test.resolved", { address: `⁦${run.result.resolvedAddress}⁩` })}
              </span>
            </p>
            {stale && (
              <p className="notice">
                <InfoIcon />
                <span>{t("test.stale")}</span>
              </p>
            )}
          </div>
          <Journey key={run.id} run={run} />
          {run.result.diagnostics.length > 0 && (
            <>
              <h4 id="test-reasons-heading" className="output-label">
                {t("test.reasons")}
              </h4>
              <ul className="diagnostic-list" aria-labelledby="test-reasons-heading">
                {run.result.diagnostics.map((diagnostic) => (
                  <Diagnostic key={diagnostic.id} diagnostic={diagnostic} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <h4 id="net-diagnostics-heading" className="output-label">
        {t("diagnostics.heading")}
      </h4>
      {diagnostics.length === 0 ? (
        <p className="lab-status-empty">{t("diagnostics.none")}</p>
      ) : (
        <ul className="diagnostic-list" aria-labelledby="net-diagnostics-heading">
          {diagnostics.map((diagnostic) => (
            <Diagnostic key={diagnostic.id} diagnostic={diagnostic} />
          ))}
        </ul>
      )}

      <h4 className="output-label">{t("addresses.heading")}</h4>
      {interfaces.length === 0 ? (
        <p className="lab-status-empty">{t("addresses.none")}</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t("addresses.heading")}>
          <table className="net-table">
            <caption className="visually-hidden">{t("addresses.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("addresses.device")}</th>
                <th scope="col">{t("addresses.interface")}</th>
                <th scope="col">{t("addresses.source")}</th>
                <th scope="col">{t("addresses.address")}</th>
                <th scope="col">{t("addresses.mask")}</th>
                <th scope="col">{t("addresses.gateway")}</th>
                <th scope="col">{t("addresses.dns")}</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.map((item) => (
                <tr key={`${item.deviceId}/${item.interface}`}>
                  <th scope="row">{nameOf(item.deviceId)}</th>
                  <td>{t(`addresses.interfaces.${item.interface}`)}</td>
                  <td>
                    {t(`addresses.sources.${item.source}`)}
                    {item.leasedBy && <> ({t("addresses.leasedBy", { name: nameOf(item.leasedBy) })})</>}
                  </td>
                  <td dir="ltr">{item.address ?? "—"}</td>
                  <td dir="ltr">{item.mask ?? "—"}</td>
                  <td dir="ltr">{item.gateway ?? "—"}</td>
                  <td dir="ltr">{item.dns?.length ? item.dns.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Runs a test through the engine. Kept beside the panel so the workspace owns the result. */
export function runTest(net: NetworkState, request: ConnectivityResult["request"], projectRevision: number): TestRun {
  const id = crypto.randomUUID();
  return { id, state: net, result: network.runConnectivity(net, request, { projectRevision, executionId: id }) };
}
