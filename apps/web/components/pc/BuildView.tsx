"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { pcTarget, type PCDiagnostic } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { keyToAssemblyEvent, rovingTabIndex, type AssemblyCandidate } from "@/lib/interaction/assembly";
import { CheckIcon, WarningIcon } from "../icons";
import { pcCatalog } from "./catalog";
import { pcStore, usePC } from "./pc-client";
import { buildRows, type CableRow, type PartRow } from "./pc-model";
import { sceneStore, selectPart, useScene } from "./scene/scene-store";
import { AttachmentControls, PartSettings, ltr, type Run } from "./part-controls";
import { TargetBox } from "./TargetBox";

type Locale = "en" | "ar";

/** Hands an element to the view's focus map under a key such as `part:ram-2` or `end:cable-4/device`. */
type Register = (key: string) => (element: HTMLElement | null) => void;

/**
 * The places the picked-up part or cable end could go, as the selection machine lists them.
 * Rejected places stay in the list with the engine's reason. Arrow keys move, Enter places,
 * Escape cancels; a click or tap on a row does the same as Enter on it.
 */
function DestinationList() {
  const t = useTranslations("tutor.assembly.list");
  const tl = useTranslations("pcLab.destination");
  const locale = useLocale() as Locale;
  const assembly = usePC((state) => state.assembly);
  const focus = usePC((state) => state.focus);
  const options = useRef(new Map<string, HTMLLIElement>());
  const list = useRef<HTMLUListElement>(null);
  const activeId = assembly.phase === "idle" ? null : (assembly.candidates[assembly.activeIndex]?.id ?? null);

  useEffect(() => {
    // A pick started in the 3D view keeps focus there; the live region says what happened.
    if (focus?.to === "candidate" && !sceneStore.getState().pickInScene) options.current.get(focus.candidateId)?.focus();
  }, [focus]);

  // Arrow keys move the machine's active row; DOM focus follows while it is inside the list.
  useEffect(() => {
    if (activeId && list.current?.contains(document.activeElement)) options.current.get(activeId)?.focus();
  }, [activeId]);

  if (assembly.phase === "idle") return null;
  const { subject, candidates, activeIndex } = assembly;
  const send = pcStore.getState().send;

  function onKeyDown(event: KeyboardEvent) {
    const machineEvent = keyToAssemblyEvent(event);
    // The key map never produces a `result`; that one comes from the engine, through the store.
    if (!machineEvent || machineEvent.type === "result") return;
    event.preventDefault();
    send(machineEvent);
  }

  return (
    <section aria-labelledby="destinations-heading" className="panel pc-destinations">
      <h4 id="destinations-heading" className="subheading">
        {t("destinations", { subject: subject.label[locale] })}
      </h4>
      <p className="settings-hint">{t("keys")}</p>
      <ul ref={list} role="listbox" aria-labelledby="destinations-heading" className="pc-option-list" onKeyDown={onKeyDown}>
        {candidates.map((candidate, index) => (
          <li
            key={candidate.id}
            ref={(element) => {
              if (element) options.current.set(candidate.id, element);
              else options.current.delete(candidate.id);
            }}
            role="option"
            tabIndex={rovingTabIndex(index, activeIndex)}
            aria-selected={index === activeIndex}
            aria-disabled={candidate.ok ? undefined : true}
            aria-labelledby={`destination-label-${index} destination-status-${index}`}
            aria-describedby={candidate.ok ? undefined : index === activeIndex ? `destination-reason-${index} destination-why-${index}` : `destination-reason-${index}`}
            className="pc-option"
            data-candidate={candidate.id}
            data-ok={candidate.ok}
            onClick={() => send({ type: "pick", candidateId: candidate.id })}
            onFocus={() => {
              if (index !== activeIndex) send({ type: "focus", index });
            }}
          >
            <span id={`destination-label-${index}`} className="pc-option-label">
              {candidate.label[locale]}
            </span>
            <span id={`destination-status-${index}`} className="pc-option-status">
              {candidate.ok ? <CheckIcon /> : <WarningIcon />}
              {candidate.ok ? t("available") : t("unavailable")}
            </span>
            {!candidate.ok && candidate.reason && (
              <span id={`destination-reason-${index}`} className="pc-option-reason">
                {candidate.reason[locale]}
              </span>
            )}
            {/* The fuller explanation, for the row the learner is on. */}
            {!candidate.ok && index === activeIndex && (candidate as AssemblyCandidate).rejection && (
              <span id={`destination-why-${index}`} className="pc-option-reason">
                <strong>{tl("why")}:</strong> {(candidate as AssemblyCandidate).rejection!.explanation[locale]}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button type="button" className="button button-small" disabled={assembly.phase === "placing"} onClick={() => send({ type: "cancel" })}>
          {assembly.phase === "placing" ? tl("placing") : tl("cancel")}
        </button>
      </div>
    </section>
  );
}


function PartCard({
  row,
  register,
  run,
  lightingProblem,
}: {
  row: PartRow;
  register: Register;
  run: Run;
  /** The engine's finding that this part's lighting is not connected, when there is one. */
  lightingProblem: PCDiagnostic | undefined;
}) {
  const t = useTranslations("pcLab");
  const locale = useLocale() as Locale;
  const { part, entry, name } = row;
  const id = part.instanceId;
  const card = `card:${id}`;
  const selected = useScene((state) => state.selectedPartId === id);
  // The visible words first, then the part, so voice control and button lists both work.
  const named = (label: string) => `${label}: ${name}`;

  return (
    <TargetBox
      as="li"
      target={pcTarget.part(id)}
      className="pc-card"
      // The same part is marked in the 3D view; working on its card here selects it there.
      data-highlight={selected || undefined}
      onFocus={() => selectPart(id)}
    >
      <h5 ref={register(card)} tabIndex={-1} className="pc-card-name">
        <bdi dir="ltr">{name}</bdi>
        <span className="pc-tag">{t(`categories.${entry.category}`)}</span>
      </h5>

      {entry.mounting.length === 0 ? (
        entry.category === "case" && <p className="state-meta">{t("build.isCase")}</p>
      ) : row.attachments.length === 0 ? (
        <p className="state-meta">{t("build.onBench")}</p>
      ) : (
        <AttachmentControls row={row} run={run} focusKey={card} />
      )}

      <PartSettings row={row} run={run} focusKey={card} lightingProblem={lightingProblem} idPrefix="list" />

      <div className="button-row">
        {row.canPlace && (
          <button
            ref={register(`part:${id}`)}
            type="button"
            className="button button-small button-primary"
            aria-label={`${t("build.place")} ${name}`}
            onClick={() => {
              sceneStore.setState({ pickInScene: false });
              pcStore.getState().selectPart(id);
            }}
          >
            {t("build.place")}
          </button>
        )}
        <button
          type="button"
          className="button button-small button-danger"
          aria-label={named(t("build.remove"))}
          onClick={() => run({ type: "remove_part", instanceId: id }, t("build.done.remove", { name }), "build")}
        >
          {t("build.remove")}
        </button>
      </div>

      {row.mountPoints.length > 0 && (
        <details className="pc-details" open>
          <summary>{t("build.positions", { count: row.mountPoints.length })}</summary>
          <ul className="pc-facts">
            {row.mountPoints.map((point) => (
              <TargetBox as="li" key={point.spec.id} target={pcTarget.mount(point.ref)}>
                {point.spec.label[locale]}:{" "}
                {point.occupant ? t("build.positionHolds", { name: ltr(point.occupant.name) }) : t("build.positionEmpty")}
              </TargetBox>
            ))}
          </ul>
        </details>
      )}

      {row.ports.length > 0 && (
        <details className="pc-details" open>
          <summary>{t("build.ports", { count: row.ports.length })}</summary>
          <ul className="pc-facts">
            {row.ports.map((port) => (
              <TargetBox as="li" key={port.spec.id} target={pcTarget.port(port.ref)} className="pc-port">
                <span>
                  <bdi dir="ltr">{port.spec.label[locale]}</bdi> · <bdi dir="ltr">{pc.CONNECTOR_NAME[port.spec.connector]}</bdi> ·{" "}
                  {t(`build.requirement.${port.spec.requirement}`)}
                </span>
                {port.plugged ? (
                  <>
                    <span>{t("build.portPlugged", { cable: port.plugged.cableLabel[locale], end: port.plugged.endLabel[locale] })}</span>
                    <button
                      type="button"
                      className="button button-small"
                      aria-label={t("build.disconnectNamed", { end: port.plugged.endLabel[locale], cable: port.plugged.cableLabel[locale] })}
                      onClick={() =>
                        run({ type: "disconnect_cable_end", cableId: port.plugged!.cableId, endId: port.plugged!.endId }, t("build.done.disconnect"), card)
                      }
                    >
                      {t("build.disconnect")}
                    </button>
                  </>
                ) : (
                  <span className="state-meta">{t("build.portEmpty")}</span>
                )}
              </TargetBox>
            ))}
          </ul>
        </details>
      )}
    </TargetBox>
  );
}

function CableCard({ row, register, run }: { row: CableRow; register: Register; run: Run }) {
  const t = useTranslations("pcLab.build");
  const locale = useLocale() as Locale;
  const { cable } = row;
  const card = `card:${cable.id}`;
  const label = row.label[locale];

  return (
    <li className="pc-card" data-cable={cable.id}>
      <h5 ref={register(card)} tabIndex={-1} className="pc-card-name">
        {label}
      </h5>
      <p className="state-meta">{row.ownerName ? t("cableOwner", { name: ltr(row.ownerName) }) : t("cableLoose")}</p>
      <ul className="pc-facts">
        {row.ends.map((end) => (
          <TargetBox as="li" key={end.spec.id} target={pcTarget.cableEnd(cable.id, end.spec.id)} className="pc-port">
            <span>
              {end.label[locale]} · <bdi dir="ltr">{pc.CONNECTOR_NAME[end.spec.connector]}</bdi>
            </span>
            {end.pluggedInto ? (
              <>
                <span>{t("endPlugged", { owner: ltr(end.pluggedInto.owner), label: ltr(end.pluggedInto.label[locale]) })}</span>
                <button
                  type="button"
                  className="button button-small"
                  aria-label={t("disconnectNamed", { end: end.label[locale], cable: label })}
                  onClick={() => run({ type: "disconnect_cable_end", cableId: cable.id, endId: end.spec.id }, t("done.disconnect"), card)}
                >
                  {t("disconnect")}
                </button>
              </>
            ) : (
              <>
                <span className="state-meta">{t("endLoose")}</span>
                <button
                  ref={register(`end:${cable.id}/${end.spec.id}`)}
                  type="button"
                  className="button button-small button-primary"
                  aria-label={t("connectNamed", { end: end.label[locale], cable: label })}
                  onClick={() => {
                    sceneStore.setState({ pickInScene: false });
                    pcStore.getState().selectCableEnd(cable.id, end.spec.id);
                  }}
                >
                  {t("connect")}
                </button>
              </>
            )}
          </TargetBox>
        ))}
      </ul>
      <label className="settings-option">
        <input
          type="checkbox"
          checked={cable.tidied}
          onChange={(event) => run({ type: "set_cable_tidy", cableId: cable.id, tidied: event.target.checked }, t("done.tidy"), card)}
        />
        <span>{t("tidy")}</span>
      </label>
      {!cable.ownerInstanceId && (
        <div className="button-row">
          <button type="button" className="button button-small button-danger" onClick={() => run({ type: "remove_cable", cableId: cable.id }, t("done.removeCable"), "build")}>
            {t("removeCable")}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The build as a list: every part with where it sits, how far it is seated and what is secured,
 * its positions and ports, and every cable with both ends. The equivalent of the 3D scene for
 * people who do not use it; nothing here needs dragging.
 */
export function BuildView({ diagnostics, announce }: { diagnostics: readonly PCDiagnostic[]; announce: (text: string) => void }) {
  const t = useTranslations("pcLab");
  const locale = useLocale() as Locale;
  const present = usePC((state) => state.history?.present);
  const refusal = usePC((state) => state.refusal);
  const focus = usePC((state) => state.focus);
  const rows = useMemo(() => (present ? buildRows(present, pcCatalog) : null), [present]);
  const controls = useRef(new Map<string, HTMLElement>());
  const [focusKey, setFocusKey] = useState<{ key: string; n: number } | null>(null);

  const register: Register = (key) => (element) => {
    if (element) controls.current.set(key, element);
    else controls.current.delete(key);
  };

  // The selection machine hands focus back to where the part or cable end was picked up; if that
  // button is gone (the part is placed, the end is plugged), its card takes focus instead.
  useEffect(() => {
    if (focus?.to !== "subject" || sceneStore.getState().pickInScene) return;
    const { subject } = focus;
    const keys = subject.kind === "part" ? [`part:${subject.instanceId}`, `card:${subject.instanceId}`] : [`end:${subject.cableId}/${subject.endId}`, `card:${subject.cableId}`];
    (keys.map((key) => controls.current.get(key)).find(Boolean) ?? controls.current.get("build"))?.focus();
  }, [focus]);

  useEffect(() => {
    if (focusKey) (controls.current.get(focusKey.key) ?? controls.current.get("build"))?.focus();
  }, [focusKey]);

  if (!rows) return null;

  const run: Run = (action, done, key) => {
    const result = pcStore.getState().act(action);
    if (!result?.ok) return;
    announce(done);
    setFocusKey((previous) => ({ key, n: (previous?.n ?? 0) + 1 }));
  };

  const groups = [
    { key: "standalone", parts: rows.parts.filter((row) => row.entry.mounting.length === 0) },
    { key: "bench", parts: rows.parts.filter((row) => row.entry.mounting.length > 0 && row.attachments.length === 0) },
    { key: "installed", parts: rows.parts.filter((row) => row.attachments.length > 0) },
  ] as const;

  return (
    <section aria-labelledby="build-heading" className="studio-editor pc-build">
      <h3 id="build-heading" ref={register("build")} tabIndex={-1} className="subheading">
        {t("build.heading")}
      </h3>

      {refusal && (
        <div key={refusal.seq} className="state-panel state-panel-block state-panel-warning" role="alert">
          <h4 className="subheading state-heading">
            <WarningIcon />
            {t("refusal.heading")}
          </h4>
          <p>{refusal.diagnostic.message[locale]}</p>
          <details className="pc-details">
            <summary>{t("refusal.why")}</summary>
            <p>{refusal.diagnostic.explanation[locale]}</p>
            {refusal.diagnostic.evidence.length > 0 && (
              <>
                <h5 className="output-label">{t("refusal.evidence")}</h5>
                <ul className="pc-facts">
                  {refusal.diagnostic.evidence.map((item, index) => (
                    <li key={index}>
                      {item.label[locale]}: {t("refusal.observed")} <bdi dir="ltr">{item.observed}</bdi>
                      {item.expected !== undefined && (
                        <>
                          , {t("refusal.expected")} <bdi dir="ltr">{item.expected}</bdi>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </div>
      )}

      <DestinationList />

      {rows.parts.length === 0 && <p className="lab-status-empty">{t("build.empty")}</p>}
      {groups.map(
        (group) =>
          group.parts.length > 0 && (
            <div key={group.key} className="pc-group">
              <h4 id={`pc-group-${group.key}`} className="output-label">
                {t(`build.${group.key}`)}
              </h4>
              <ul className="pc-card-list" aria-labelledby={`pc-group-${group.key}`}>
                {group.parts.map((row) => (
                  <PartCard
                    key={row.part.instanceId}
                    row={row}
                    register={register}
                    run={run}
                    lightingProblem={diagnostics.find(
                      (item) => item.code === "lighting_not_connected" && item.relatedTargets.some((target) => target.id === pcTarget.part(row.part.instanceId).id),
                    )}
                  />
                ))}
              </ul>
            </div>
          ),
      )}

      <div className="pc-group">
        <h4 id="pc-group-cables" className="output-label">
          {t("build.cables")}
        </h4>
        {rows.cables.length === 0 ? (
          <p className="lab-status-empty">{t("build.noCables")}</p>
        ) : (
          <ul className="pc-card-list" aria-labelledby="pc-group-cables">
            {rows.cables.map((row) => (
              <CableCard key={row.cable.id} row={row} register={register} run={run} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
