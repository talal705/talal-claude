"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { networkTarget, type NetworkDeviceKind } from "@ytl/contracts";
import { TargetBox } from "../pc/TargetBox";
import { DeviceSettings } from "./DeviceSettings";
import { useHighlighted } from "./highlight";
import { networkStore } from "./network-client";
import type { DeviceRow, PortRow } from "./network-model";

const KINDS = ["router", "fiber_gateway", "ont", "switch", "access_point", "wired_client", "wifi_client", "isp"] as const satisfies readonly NetworkDeviceKind[];
type Locale = "en" | "ar";
type Announce = (text: string) => void;

function Port({ deviceId, row, announce }: { deviceId: string; row: PortRow; announce: Announce }) {
  const t = useTranslations("netLab");
  const target = networkTarget.port({ deviceId, portId: row.port.id });
  const highlighted = useHighlighted(target.id);
  return (
    <TargetBox as="li" target={target} className="pc-port" data-highlight={highlighted || undefined}>
      <span>
        <bdi dir="ltr">{row.port.label}</bdi> · {t(`medium.${row.port.medium}`)}
      </span>
      {row.plugged ? (
        <>
          <span>{t("devices.portPlugged", { number: row.plugged.cableNumber, end: row.plugged.endId.toUpperCase() })}</span>
          <button
            type="button"
            className="button button-small"
            aria-label={t("devices.unplugNamed", { number: row.plugged.cableNumber, port: row.port.label })}
            onClick={() => {
              const { cableId, endId } = row.plugged!;
              if (networkStore.getState().act({ type: "disconnect_cable_end", cableId, endId })?.ok) announce(t("devices.unplugged"));
            }}
          >
            {t("devices.unplug")}
          </button>
        </>
      ) : (
        <span className="state-meta">{t("devices.portEmpty")}</span>
      )}
    </TargetBox>
  );
}

function DeviceCard({ row, announce, onRemoved }: { row: DeviceRow; announce: Announce; onRemoved: () => void }) {
  const t = useTranslations("netLab");
  const locale = useLocale() as Locale;
  const { device } = row;
  const target = networkTarget.device(device.id);
  const highlighted = useHighlighted(target.id);
  const wifiHighlighted = useHighlighted(networkTarget.wifiLink(device.id).id);
  const name = device.name[locale];
  const act = networkStore.getState().act;

  return (
    <TargetBox as="li" target={target} className="pc-card" data-highlight={highlighted || undefined}>
      <h4 className="pc-card-name">
        {name}
        <span className="pc-tag">{t(`kinds.${device.kind}`)}</span>
      </h4>
      <p className="state-meta">
        {t("devices.rolesLabel")}: {device.roles.map((role) => t(`roles.${role}`)).join(locale === "ar" ? "، " : ", ")}
      </p>
      <label className="settings-option">
        <input type="checkbox" checked={device.powered} onChange={(event) => act({ type: "set_power", deviceId: device.id, powered: event.target.checked })} />
        <span>{t("devices.power")}</span>
      </label>

      {row.ports.length === 0 ? (
        <p className="state-meta">{t("devices.noPorts")}</p>
      ) : (
        <details className="pc-details" open>
          <summary>{t("devices.ports", { count: row.ports.length })}</summary>
          <ul className="pc-facts">
            {row.ports.map((port) => (
              <Port key={port.port.id} deviceId={device.id} row={port} announce={announce} />
            ))}
          </ul>
        </details>
      )}
      {device.config.wifiClient && (
        <TargetBox target={networkTarget.wifiLink(device.id)} className="state-meta" data-highlight={wifiHighlighted || undefined}>
          {t("devices.wifiLink")}: <bdi dir="ltr">{device.config.wifiClient.ssid || "—"}</bdi>
        </TargetBox>
      )}

      {Object.keys(device.config).some((key) => key !== "isp") && (
        <details className="pc-details">
          <summary>{t("devices.settings")}</summary>
          <DeviceSettings device={device} announce={announce} />
        </details>
      )}

      <div className="button-row">
        <button
          type="button"
          className="button button-small button-danger"
          aria-label={t("devices.removeNamed", { name })}
          onClick={() => {
            if (!act({ type: "remove_device", deviceId: device.id })?.ok) return;
            announce(t("devices.removed", { name }));
            onRemoved();
          }}
        >
          {t("devices.remove")}
        </button>
      </div>
    </TargetBox>
  );
}

/** Add devices, switch them on and off, see their ports and what is plugged in, and change their settings. */
export function DevicePanel({ rows, announce }: { rows: DeviceRow[]; announce: Announce }) {
  const t = useTranslations("netLab");
  const locale = useLocale() as Locale;
  const [kind, setKind] = useState<NetworkDeviceKind>("router");
  const [fixedPorts, setFixedPorts] = useState(false);

  function add(event: FormEvent) {
    event.preventDefault();
    const result = networkStore.getState().act({ type: "add_device", kind, ...(fixedPorts ? { variant: "no_auto_mdix" as const } : {}) });
    if (!result?.ok) return;
    const added = result.state.devices.find((device) => device.id === result.created?.deviceId);
    announce(t("devices.added", { name: added ? added.name[locale] : t(`kinds.${kind}`) }));
  }

  return (
    <section aria-labelledby="devices-heading" className="studio-files net-devices">
      <h3 id="devices-heading" tabIndex={-1} className="subheading">
        {t("devices.heading")}
      </h3>
      <form onSubmit={add} className="file-form">
        <label htmlFor="device-kind">{t("devices.addLabel")}</label>
        <select id="device-kind" className="input" value={kind} onChange={(event) => setKind(event.target.value as NetworkDeviceKind)}>
          {KINDS.map((item) => (
            <option key={item} value={item}>
              {t(`kinds.${item}`)}
            </option>
          ))}
        </select>
        <label className="settings-option">
          <input type="checkbox" checked={fixedPorts} onChange={(event) => setFixedPorts(event.target.checked)} />
          <span>{t("devices.noAutoMdix")}</span>
        </label>
        <div className="button-row">
          <button type="submit" className="button button-small button-primary">
            {t("devices.add")}
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="lab-status-empty">{t("devices.empty")}</p>
      ) : (
        <ul className="pc-card-list" aria-labelledby="devices-heading">
          {rows.map((row) => (
            <DeviceCard key={row.device.id} row={row} announce={announce} onRemoved={() => document.getElementById("devices-heading")?.focus()} />
          ))}
        </ul>
      )}
    </section>
  );
}
