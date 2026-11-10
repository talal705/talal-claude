// The standing check of a topology: everything wrong with it right now, without sending a packet.
// Physical faults first, then addressing, then routing, then names; within a group, device order.
import { networkTarget, type NetworkDiagnostic, type NetworkEvaluationContext, type NetworkState } from "@ytl/contracts";
import { makeWorld } from "./connectivity";
import { SYMPTOM, diagnostic, evidence } from "./diagnostics";
import { duplicateFault, duplicatesOf, gatewayFault, linkFault, localRouter, noAddressFault, subnetMismatch, wanLanSwapped } from "./faults";
import { L, fill } from "./text";

export function diagnoseNetwork(state: NetworkState, context: NetworkEvaluationContext = {}): NetworkDiagnostic[] {
  const world = makeWorld(state, context);
  const found: NetworkDiagnostic[] = [];
  const seen = new Set<string>();
  const add = (item: NetworkDiagnostic | null) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    found.push(item);
  };

  // Physical: a cable plugged in at one end only, a faulty or wrong-type cable, Wi-Fi not joined, WAN and LAN swapped.
  for (const link of world.graph.links) {
    if (link.up || !link.problem) continue;
    if (link.problem.code === "link_disconnected" && link.problem.looseEnd === "both") continue;
    add(linkFault(world, link));
  }
  for (const device of state.devices) add(wanLanSwapped(world, device));

  // Addressing.
  for (const resolved of world.addressing.all) {
    const device = state.devices.find((d) => d.id === resolved.deviceId)!;
    if (!device.powered) continue;
    if (resolved.ip === undefined) {
      const config = device.config[resolved.interface as "nic" | "wan" | "lan"];
      if (config?.mode === "none") continue;
      add(noAddressFault(world, resolved));
      continue;
    }
    const twins = duplicatesOf(world, resolved);
    if (twins.length) {
      const group = [resolved, ...twins].sort((a, b) => state.devices.findIndex((d) => d.id === a.deviceId) - state.devices.findIndex((d) => d.id === b.deviceId));
      add(duplicateFault(world, group[0], group.slice(1)));
    }
    if (resolved.interface === "nic") add(subnetMismatch(world, resolved));
  }

  // Routing.
  for (const resolved of world.addressing.all) {
    if (resolved.interface !== "nic" || resolved.ip === undefined) continue;
    const router = localRouter(world, resolved);
    if (router && (resolved.gatewayIp === undefined || resolved.gatewayIp !== router.ip)) add(gatewayFault(world, resolved));
  }
  for (const device of state.devices) {
    if (device.powered && device.roles.includes("nat") && device.config.nat === false && world.addressing.of(device.id, "wan")?.ip !== undefined) {
      add(
        diagnostic(
          {
            code: "nat_disabled",
            subject: device.id,
            observation: SYMPTOM.localOnly,
            message: fill(L("NAT is off on {device}, so devices behind it cannot get replies from the internet.", "NAT مقفل في {device}، فالأجهزة اللي وراه ما يجيها رد من الإنترنت."), { device: device.name }),
            explanation: L(
              "Private addresses are reused in every home, so they mean nothing outside it. The router swaps them for its one outside address on the way out and swaps back on the way in. That swap is NAT.",
              "العناوين الخاصة تتكرر في كل بيت، فما لها معنى برّاه. الراوتر يبدّلها بعنوانه الخارجي الوحيد وهي طالعة، ويرجّعها وهي راجعة. هذا التبديل هو NAT.",
            ),
            evidence: [evidence("NAT", "NAT", "off", "on")],
            target: networkTarget.setting(device.id, "nat"),
          },
          world.stamp,
        ),
      );
    }
  }

  // Names.
  for (const resolved of world.addressing.all) {
    if (resolved.interface !== "nic" || resolved.ip === undefined || resolved.dns?.length) continue;
    const device = state.devices.find((d) => d.id === resolved.deviceId)!;
    add(
      diagnostic(
        {
          code: "dns_not_configured",
          subject: device.id,
          severity: "warning",
          observation: SYMPTOM.nameFails,
          message: fill(L("{device} has no DNS server set, so names will not work on it. Numeric addresses still will.", "{device} ما انضبط له خادم DNS، فالأسماء ما راح تشتغل عليه. العناوين الرقمية تشتغل."), { device: device.name }),
          explanation: L("A name is turned into an address by asking a DNS server. That is a separate step from reaching the address.", "الاسم يتحوّل لعنوان بسؤال خادم DNS. وهذي خطوة غير الوصول للعنوان نفسه."),
          evidence: [evidence("DNS server", "خادم DNS", "(none)")],
          target: networkTarget.setting(device.id, "nic.dns"),
        },
        world.stamp,
      ),
    );
  }
  return found;
}
