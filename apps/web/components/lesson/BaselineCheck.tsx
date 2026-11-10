"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { LabType } from "@ytl/contracts";
import { DONT_KNOW, scoreBaseline, type Baseline, type BaselineResult } from "@ytl/curriculum";
import { baselines } from "../../../../content/lessons/baselines";
import { lessonById } from "./lesson-catalog";

/**
 * "Not sure where to start?": a few questions that suggest one lesson. It only suggests; nothing
 * is locked, no score is shown, and "I don't know" is always an answer.
 */
export function BaselineCheck({ lab, onOpen }: { lab: LabType; onOpen(lessonId: string): void }) {
  const t = useTranslations("lessons.baseline");
  const locale = useLocale() as "en" | "ar";
  const available = baselines.filter((item) => item.lab === lab);
  const [chosenId, setChosenId] = useState(available[0]?.id ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BaselineResult | null>(null);
  const baseline: Baseline | undefined = available.find((item) => item.id === chosenId);

  if (available.length === 0) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (baseline) setResult(scoreBaseline(baseline, answers));
  }

  /** A skill's name as the lesson that teaches it calls it. */
  const skillName = (skill: string) => {
    const question = baseline?.questions.find((item) => item.skill === skill);
    return lessonById(question?.lessonId ?? "")?.skills[skill]?.[locale] ?? skill;
  };
  const suggested = result ? lessonById(result.suggestion.lessonId) : undefined;

  return (
    <details className="pc-details lesson-box">
      <summary>{t("toggle")}</summary>
      {available.length > 1 && (
        <div className="field">
          <label htmlFor="baseline-choice">{t("choose")}</label>
          <select
            id="baseline-choice"
            className="input"
            value={chosenId}
            onChange={(event) => {
              setChosenId(event.target.value);
              setAnswers({});
              setResult(null);
            }}
          >
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title[locale]}
              </option>
            ))}
          </select>
        </div>
      )}
      {baseline && !result && (
        <form onSubmit={submit} className="studio-form">
          <p className="settings-hint">{baseline.intro[locale]}</p>
          {baseline.questions.map((question) => (
            <fieldset key={question.id} className="settings-group">
              <legend>{question.question[locale]}</legend>
              {[...question.options.map((option) => ({ id: option.id, text: option.text[locale] })), { id: DONT_KNOW, text: t("dontKnow") }].map((option) => (
                <label key={option.id} className="settings-option">
                  <input
                    type="radio"
                    name={`baseline-${question.id}`}
                    value={option.id}
                    checked={answers[question.id] === option.id}
                    onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: option.id }))}
                  />
                  <span>{option.text}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="button-row">
            <button type="submit" className="button button-primary">
              {t("submit")}
            </button>
          </div>
        </form>
      )}
      {result && suggested && (
        <div role="status" className="studio-form">
          <h4 className="output-label">{t("result")}</h4>
          <p>{t(result.suggestion.kind, { title: suggested.title[locale] })}</p>
          {result.known.length > 0 && (
            <p className="state-meta">
              {t("known")}: {result.known.map(skillName).join(locale === "ar" ? "، " : ", ")}
            </p>
          )}
          {result.toLearn.length > 0 && (
            <p className="state-meta">
              {t("toLearn")}: {result.toLearn.map(skillName).join(locale === "ar" ? "، " : ", ")}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={() => onOpen(suggested.id)}>
              {t("open")}
              <span className="visually-hidden">: {suggested.title[locale]}</span>
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setAnswers({});
                setResult(null);
              }}
            >
              {t("again")}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
