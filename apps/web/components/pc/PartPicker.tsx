"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { pcTarget, type CatalogEntry, type RgbPreference } from "@ytl/contracts";
import { pc } from "@ytl/simulation";
import { InfoIcon } from "../icons";
import { NOT_OFFERED_IDS, entryName, offeredEntries, pcCatalog, suppliedPartActions } from "./catalog";
import { pcStore, usePC } from "./pc-client";
import { pickerEntries } from "./pc-model";
import { TargetBox } from "./TargetBox";

// Cables come with the parts that supply them; no monitor is part of the lab (decision 11).
const CATEGORIES = pc.PC_PART_CATEGORIES;
type Category = (typeof CATEGORIES)[number];
type LightingFilter = "all" | "with" | "without";

function Entry({ entry, announce }: { entry: CatalogEntry; announce: (text: string) => void }) {
  const t = useTranslations("pcLab.picker");
  const locale = useLocale() as "en" | "ar";
  const name = entryName(entry);

  function add() {
    const store = pcStore.getState();
    const result = store.act({ type: "add_part", catalogId: entry.id });
    // A refusal is shown by the build view, with the engine's reason.
    if (!result?.ok) return;
    // A case arrives with its factory-fitted fans in place; they are parts of their own from then on.
    const caseId = result.created?.instanceId;
    if (entry.category === "case" && caseId) {
      for (const action of suppliedPartActions(entry.id, caseId, result.state.nextSerial).actions) store.act(action);
    }
    announce(t("added", { name }));
  }

  return (
    <li className="pc-entry">
      <h4 className="pc-entry-name">
        <bdi dir="ltr">{name}</bdi>
      </h4>
      <p>{entry.description[locale]}</p>
      <ul className="pc-facts">
        <li>
          {t("formFactor")}: <bdi dir="ltr">{entry.formFactor}</bdi>
        </li>
        <li>{entry.rgb ? t("hasLighting") : t("noLighting")}</li>
        {entry.generic && <li>{t("generic")}</li>}
        <li>{t(`verification.${entry.verification}`)}</li>
        {/* No drawing stands in for a picture that does not exist. */}
        {(entry.asset.quality === "missing" || entry.asset.quality === "placeholder") && <li>{t("noPicture")}</li>}
      </ul>
      <details className="pc-details">
        <summary>{t("details")}</summary>
        <h5 className="output-label">{t("sources")}</h5>
        {entry.sources.length === 0 ? (
          <p>{t("noSources")}</p>
        ) : (
          <ul className="pc-facts">
            {entry.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} className="text-link" target="_blank" rel="noreferrer noopener" dir="ltr">
                  {source.publisher}: {source.title}
                </a>{" "}
                <span className="state-meta">
                  ({t("retrieved", { date: source.retrievedOn })})
                </span>
              </li>
            ))}
          </ul>
        )}
        {entry.unverifiedFields.length > 0 && (
          <>
            <h5 className="output-label">{t("unverified")}</h5>
            <ul className="pc-facts">
              {entry.unverifiedFields.map((field) => (
                <li key={field}>
                  <code dir="ltr">{field}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
      <div className="button-row">
        <button type="button" className="button button-small button-primary" aria-label={t("addNamed", { name })} onClick={() => add()}>
          {t("add")}
        </button>
      </div>
    </li>
  );
}

/** The catalog by kind of part, with the build's lighting preference and a lighting filter. */
export function PartPicker({ announce }: { announce: (text: string) => void }) {
  const t = useTranslations("pcLab");
  const preference = usePC((state) => state.history?.present.rgbPreference);
  const [category, setCategory] = useState<Category>("case");
  const [lighting, setLighting] = useState<LightingFilter>("all");
  const entries = pickerEntries(pcCatalog, category, lighting, NOT_OFFERED_IDS);
  const available = CATEGORIES.filter((item) => offeredEntries.some((entry) => entry.category === item));

  return (
    <section aria-labelledby="picker-heading" className="studio-files pc-picker">
      <h3 id="picker-heading" className="subheading">
        {t("picker.heading")}
      </h3>

      <TargetBox target={pcTarget.setting("rgb-preference")}>
        <fieldset className="settings-group">
          <legend>{t("starter.lightingLegend")}</legend>
          {(["with_rgb", "without_rgb"] as const satisfies readonly RgbPreference[]).map((value) => (
            <label key={value} className="settings-option">
              <input
                type="radio"
                name="build-rgb-preference"
                value={value}
                checked={preference === value}
                onChange={() => pcStore.getState().act({ type: "set_rgb_preference", preference: value })}
              />
              <span>{t(value === "with_rgb" ? "starter.withRgb" : "starter.withoutRgb")}</span>
            </label>
          ))}
        </fieldset>
      </TargetBox>

      <div className="field">
        <label htmlFor="pc-category">{t("picker.categoryLabel")}</label>
        <select id="pc-category" className="input" value={category} onChange={(event) => setCategory(event.target.value as Category)}>
          {available.map((item) => (
            <option key={item} value={item}>
              {t(`categories.${item}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="pc-lighting-filter">{t("picker.lightingLabel")}</label>
        <select id="pc-lighting-filter" className="input" value={lighting} onChange={(event) => setLighting(event.target.value as LightingFilter)}>
          <option value="all">{t("picker.lightingAll")}</option>
          <option value="with">{t("picker.lightingWith")}</option>
          <option value="without">{t("picker.lightingWithout")}</option>
        </select>
      </div>

      <p className="state-meta" role="status">
        {t("picker.count", { count: entries.length })}
      </p>
      {entries.length === 0 ? (
        <p className="notice">
          <InfoIcon />
          <span>{t("picker.empty")}</span>
        </p>
      ) : (
        <ul className="pc-entry-list" aria-labelledby="picker-heading">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} announce={announce} />
          ))}
        </ul>
      )}
    </section>
  );
}
