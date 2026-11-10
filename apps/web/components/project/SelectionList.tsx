"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { keyToSelectionEvent, rovingTabIndex, type SelectionCandidate, type SelectionEvent, type SelectionState, type SelectionSubject } from "@/lib/interaction/selection";
import { CheckIcon, WarningIcon } from "../icons";

/**
 * The destinations for something the learner picked up, as the shared selection machine lists
 * them: a listbox with roving focus. Rejected rows stay, with the engine's reason. Arrow keys
 * move, Enter places, Escape cancels; a click or tap on a row does the same as Enter on it.
 * Tab is never captured.
 */
export function SelectionList<S extends SelectionSubject, A>({
  state,
  focus,
  send,
  heading,
  keysHelp,
  labels,
  extra,
}: {
  state: SelectionState<S, A>;
  /** The machine's latest focus request; `seq` changes on every request. */
  focus: { seq: number; to: "candidate"; candidateId: string } | { seq: number; to: "subject" } | null;
  send: (event: SelectionEvent<S, A>) => void;
  heading: (subject: string) => string;
  keysHelp: string;
  labels: { available: string; unavailable: string; cancel: string; placing: string };
  /** More to show under a rejected row while it is the active one, e.g. the engine's fuller explanation. */
  extra?: (candidate: SelectionCandidate<A>) => ReactNode;
}) {
  const locale = useLocale() as "en" | "ar";
  const options = useRef(new Map<string, HTMLLIElement>());
  const list = useRef<HTMLUListElement>(null);
  const activeId = state.phase === "idle" ? null : (state.candidates[state.activeIndex]?.id ?? null);

  useEffect(() => {
    if (focus?.to === "candidate") options.current.get(focus.candidateId)?.focus();
  }, [focus]);

  // Arrow keys move the machine's active row; DOM focus follows while it is inside the list.
  useEffect(() => {
    if (activeId && list.current?.contains(document.activeElement)) options.current.get(activeId)?.focus();
  }, [activeId]);

  if (state.phase === "idle") return null;
  const { subject, candidates, activeIndex } = state;

  function onKeyDown(event: KeyboardEvent) {
    const machineEvent = keyToSelectionEvent(event);
    if (!machineEvent) return;
    event.preventDefault();
    send(machineEvent);
  }

  return (
    <section aria-labelledby="selection-heading" className="panel pc-destinations">
      <h4 id="selection-heading" className="subheading">
        {heading(subject.label[locale])}
      </h4>
      <p className="settings-hint">{keysHelp}</p>
      <ul ref={list} role="listbox" aria-labelledby="selection-heading" className="pc-option-list" onKeyDown={onKeyDown}>
        {candidates.map((candidate, index) => {
          const more = !candidate.ok && index === activeIndex ? extra?.(candidate) : null;
          const describedBy = candidate.ok ? undefined : more ? `selection-reason-${index} selection-more-${index}` : `selection-reason-${index}`;
          return (
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
              // Label and status name the option; the reason is its description, read once.
              aria-labelledby={`selection-label-${index} selection-status-${index}`}
              aria-describedby={describedBy}
              className="pc-option"
              data-ok={candidate.ok}
              onClick={() => send({ type: "pick", candidateId: candidate.id })}
              onFocus={() => {
                if (index !== activeIndex) send({ type: "focus", index });
              }}
            >
              <span id={`selection-label-${index}`} className="pc-option-label">
                {candidate.label[locale]}
              </span>
              <span id={`selection-status-${index}`} className="pc-option-status">
                {candidate.ok ? <CheckIcon /> : <WarningIcon />}
                {candidate.ok ? labels.available : labels.unavailable}
              </span>
              {!candidate.ok && candidate.reason && (
                <span id={`selection-reason-${index}`} className="pc-option-reason">
                  {candidate.reason[locale]}
                </span>
              )}
              {more && (
                <span id={`selection-more-${index}`} className="pc-option-reason">
                  {more}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="button-row">
        <button type="button" className="button button-small" disabled={state.phase === "placing"} onClick={() => send({ type: "cancel" })}>
          {state.phase === "placing" ? labels.placing : labels.cancel}
        </button>
      </div>
    </section>
  );
}
