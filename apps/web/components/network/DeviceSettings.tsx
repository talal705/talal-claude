"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  networkTarget,
  type NetworkAction,
  type NetworkDevice,
  type NetworkDhcpServerConfig,
  type NetworkInterfaceConfig,
  type NetworkWifiConfig,
} from "@ytl/contracts";
import { TargetBox } from "../pc/TargetBox";
import { networkStore } from "./network-client";
import { splitAddresses } from "./network-model";

type Announce = (text: string) => void;

/** One labelled text field, registered under the setting name the engine's diagnostics point at. */
function Field({
  deviceId,
  setting,
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  deviceId: string;
  /** e.g. `nic.gateway`, `dhcp.poolStart`. */
  setting: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = `setting-${deviceId}-${setting}`;
  return (
    <TargetBox target={networkTarget.setting(deviceId, setting)} className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input code-name"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="settings-hint">
          {hint}
        </p>
      )}
    </TargetBox>
  );
}

function SettingsForm({ legend, action, announce, children }: { legend: string; action: () => NetworkAction; announce: Announce; children: ReactNode }) {
  const t = useTranslations("netLab.settings");
  function submit(event: FormEvent) {
    event.preventDefault();
    // A refusal (an address that is not valid, say) is shown at the top of the workspace with the engine's reason.
    if (networkStore.getState().act(action())?.ok) announce(t("applied"));
  }
  return (
    <form onSubmit={submit}>
      <fieldset className="settings-group net-settings">
        <legend>{legend}</legend>
        {children}
        <div className="button-row">
          <button type="submit" className="button button-small">
            {t("apply")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function InterfaceForm({ device, name, config, announce }: { device: NetworkDevice; name: "nic" | "wan" | "lan"; config: NetworkInterfaceConfig; announce: Announce }) {
  const t = useTranslations("netLab.settings");
  const [mode, setMode] = useState(config.mode);
  const [address, setAddress] = useState(config.address ?? "");
  const [mask, setMask] = useState(config.mask ?? "");
  const [gateway, setGateway] = useState(config.gateway ?? "");
  const [dns, setDns] = useState((config.dns ?? []).join(", "));
  const typed = mode === "static";
  // A router's home side is always typed by hand.
  const modes = name === "lan" ? (["static"] as const) : (["dhcp", "static", "none"] as const);
  const modeId = `setting-${device.id}-${name}-mode`;

  return (
    <SettingsForm
      legend={t(`interface.${name}`)}
      announce={announce}
      action={() => ({
        type: "set_interface",
        deviceId: device.id,
        interface: name,
        config: typed
          ? { mode, address: address.trim(), mask: mask.trim(), ...(gateway.trim() ? { gateway: gateway.trim() } : {}), ...(splitAddresses(dns).length ? { dns: splitAddresses(dns) } : {}) }
          : { mode },
      })}
    >
      <TargetBox target={networkTarget.setting(device.id, `${name}.mode`)} className="field">
        <label htmlFor={modeId}>{t("mode")}</label>
        <select id={modeId} className="input" value={mode} onChange={(event) => setMode(event.target.value as NetworkInterfaceConfig["mode"])}>
          {modes.map((item) => (
            <option key={item} value={item}>
              {t(`modes.${item}`)}
            </option>
          ))}
        </select>
      </TargetBox>
      {typed && (
        <>
          <Field deviceId={device.id} setting={`${name}.address`} label={t("address")} value={address} onChange={setAddress} />
          <Field deviceId={device.id} setting={`${name}.mask`} label={t("mask")} value={mask} onChange={setMask} />
          {name !== "lan" && (
            <>
              <Field deviceId={device.id} setting={`${name}.gateway`} label={t("gateway")} value={gateway} onChange={setGateway} />
              <Field deviceId={device.id} setting={`${name}.dns`} label={t("dns")} value={dns} onChange={setDns} hint={t("dnsHint")} />
            </>
          )}
        </>
      )}
    </SettingsForm>
  );
}

function DhcpForm({ device, config, announce }: { device: NetworkDevice; config: NetworkDhcpServerConfig; announce: Announce }) {
  const t = useTranslations("netLab.settings");
  const [enabled, setEnabled] = useState(config.enabled);
  const [poolStart, setPoolStart] = useState(config.poolStart);
  const [poolEnd, setPoolEnd] = useState(config.poolEnd);
  const [mask, setMask] = useState(config.mask);
  const [gateway, setGateway] = useState(config.gateway);
  const [dns, setDns] = useState(config.dns.join(", "));
  return (
    <SettingsForm
      legend={t("dhcp")}
      announce={announce}
      action={() => ({
        type: "set_dhcp_server",
        deviceId: device.id,
        config: { enabled, poolStart: poolStart.trim(), poolEnd: poolEnd.trim(), mask: mask.trim(), gateway: gateway.trim(), dns: splitAddresses(dns) },
      })}
    >
      <TargetBox target={networkTarget.setting(device.id, "dhcp.enabled")}>
        <label className="settings-option">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>{t("dhcpEnabled")}</span>
        </label>
      </TargetBox>
      {/* The engine points at the range as a whole when it is invalid or used up. */}
      <TargetBox target={networkTarget.setting(device.id, "dhcp.pool")} className="net-setting-group">
        <Field deviceId={device.id} setting="dhcp.poolStart" label={t("poolStart")} value={poolStart} onChange={setPoolStart} />
        <Field deviceId={device.id} setting="dhcp.poolEnd" label={t("poolEnd")} value={poolEnd} onChange={setPoolEnd} />
      </TargetBox>
      <Field deviceId={device.id} setting="dhcp.mask" label={t("mask")} value={mask} onChange={setMask} />
      <Field deviceId={device.id} setting="dhcp.gateway" label={t("gateway")} value={gateway} onChange={setGateway} />
      <Field deviceId={device.id} setting="dhcp.dns" label={t("dns")} value={dns} onChange={setDns} hint={t("dhcpDnsHint")} />
    </SettingsForm>
  );
}

function WifiForm({ device, config, announce }: { device: NetworkDevice; config: NetworkWifiConfig; announce: Announce }) {
  const t = useTranslations("netLab.settings");
  const [enabled, setEnabled] = useState(config.enabled);
  const [ssid, setSsid] = useState(config.ssid);
  const [passphrase, setPassphrase] = useState(config.passphrase);
  return (
    <SettingsForm legend={t("wifi")} announce={announce} action={() => ({ type: "set_wifi", deviceId: device.id, config: { enabled, ssid, passphrase } })}>
      <TargetBox target={networkTarget.setting(device.id, "wifi.enabled")}>
        <label className="settings-option">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>{t("wifiEnabled")}</span>
        </label>
      </TargetBox>
      <Field deviceId={device.id} setting="wifi.ssid" label={t("ssid")} value={ssid} onChange={setSsid} />
      <Field deviceId={device.id} setting="wifi.passphrase" label={t("passphrase")} value={passphrase} onChange={setPassphrase} hint={t("passphraseNote")} />
    </SettingsForm>
  );
}

function WifiClientForm({ device, config, announce }: { device: NetworkDevice; config: { ssid: string; passphrase: string }; announce: Announce }) {
  const t = useTranslations("netLab.settings");
  const [ssid, setSsid] = useState(config.ssid);
  const [passphrase, setPassphrase] = useState(config.passphrase);
  return (
    <SettingsForm legend={t("wifiClient")} announce={announce} action={() => ({ type: "set_wifi_client", deviceId: device.id, ssid, passphrase })}>
      {/* "Has not joined a Wi-Fi network" points at the pair, not at one field. */}
      <TargetBox target={networkTarget.setting(device.id, "wifiClient")} className="net-setting-group">
        <Field deviceId={device.id} setting="wifiClient.ssid" label={t("ssid")} value={ssid} onChange={setSsid} />
        <Field deviceId={device.id} setting="wifiClient.passphrase" label={t("passphrase")} value={passphrase} onChange={setPassphrase} hint={t("passphraseNote")} />
      </TargetBox>
    </SettingsForm>
  );
}

/**
 * The settings a device has, by what it does: address settings, DHCP server, NAT, Wi-Fi. Each
 * group is a small form applied as one engine action. A form is rebuilt when its stored settings
 * change from elsewhere (undo, a restore), so it never shows stale values.
 */
export function DeviceSettings({ device, announce }: { device: NetworkDevice; announce: Announce }) {
  const t = useTranslations("netLab.settings");
  const { config } = device;
  const key = (value: unknown) => JSON.stringify(value);
  return (
    <div className="net-settings-list">
      {(["nic", "wan", "lan"] as const).map((name) => {
        const item = config[name];
        return item ? <InterfaceForm key={`${name}:${key(item)}`} device={device} name={name} config={item} announce={announce} /> : null;
      })}
      {config.dhcpServer && <DhcpForm key={`dhcp:${key(config.dhcpServer)}`} device={device} config={config.dhcpServer} announce={announce} />}
      {config.nat !== undefined && (
        <TargetBox target={networkTarget.setting(device.id, "nat")}>
          <label className="settings-option">
            <input
              type="checkbox"
              checked={config.nat}
              onChange={(event) => {
                if (networkStore.getState().act({ type: "set_nat", deviceId: device.id, enabled: event.target.checked })?.ok) announce(t("applied"));
              }}
            />
            <span>{t("nat")}</span>
          </label>
        </TargetBox>
      )}
      {config.wifi && <WifiForm key={`wifi:${key(config.wifi)}`} device={device} config={config.wifi} announce={announce} />}
      {config.wifiClient && <WifiClientForm key={`wifiClient:${key(config.wifiClient)}`} device={device} config={config.wifiClient} announce={announce} />}
    </div>
  );
}
