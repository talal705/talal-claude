import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runConnectivity } from "./index";
import { HOME_WITH_ONT, build } from "./test-helpers";

const folder = fileURLToPath(new URL(".", import.meta.url));
const sources = readdirSync(folder)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "test-helpers.ts")
  .map((name) => ({ name, text: readFileSync(`${folder}${name}`, "utf8") }));

describe("the network engine never touches a real network", () => {
  it("has engine files to check", () => {
    expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(["connectivity.ts", "addressing.ts", "links.ts", "reducer.ts", "wiremap.ts", "index.ts"]));
  });

  it("imports only the contracts package and its own files", () => {
    for (const { name, text } of sources) {
      const imported = [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of imported) {
        expect(specifier === "@ytl/contracts" || specifier.startsWith("./"), `${name} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("names no module or global that can open a connection or run a system command", () => {
    const forbidden = [
      /node:(net|dgram|dns|tls|http|https|http2|child_process|worker_threads)/,
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](net|dgram|dns|tls|http|https|http2|child_process)["']/,
      /\bfetch\s*\(/,
      /\bWebSocket\b/,
      /\bXMLHttpRequest\b/,
      /\bEventSource\b/,
      /\bsendBeacon\b/,
      /\bRTCPeerConnection\b/,
      /\bexec(File|Sync)?\s*\(/,
      /\bspawn(Sync)?\s*\(/,
    ];
    for (const { name, text } of sources) {
      for (const pattern of forbidden) expect(pattern.test(text), `${name} matches ${pattern}`).toBe(false);
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  it("a ping and a name lookup run to the end with every network global made to throw", () => {
    const trap = () => {
      throw new Error("real network use");
    };
    vi.stubGlobal("fetch", trap);
    vi.stubGlobal("WebSocket", trap);
    vi.stubGlobal("XMLHttpRequest", trap);
    const home = build(HOME_WITH_ONT);
    expect(runConnectivity(home, { kind: "ping", fromDeviceId: "pc-1", to: "school.test" }).succeeded).toBe(true);
    expect(runConnectivity(home, { kind: "lookup", fromDeviceId: "phone-1", name: "library.test" }).succeeded).toBe(true);
  });

  it("uses only reserved addresses and names for the virtual provider and internet", () => {
    const isp = build(HOME_WITH_ONT).devices.find((d) => d.kind === "isp")!.config.isp!;
    const all = [isp.address, isp.poolStart, isp.poolEnd, isp.dnsAddress, ...isp.hosts, ...isp.dnsRecords.map((r) => r.address)];
    // 100.64.0.0/10 is shared address space (RFC 6598); 203.0.113.0/24 is for documentation (RFC 5737).
    expect(all.every((address) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) || address.startsWith("203.0.113."))).toBe(true);
    // `.test` is reserved and never resolves on the real internet (RFC 2606).
    expect(isp.dnsRecords.every((r) => r.name.endsWith(".test"))).toBe(true);
  });
});
